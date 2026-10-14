import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { createLocalAI } from '../local-ai.mjs';
import http from 'node:http';

const summary = { overview: '요약', topics: [], decisions: [], actions: [], questions: [] };
const json = value => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function app(t, options) {
  const server = createApp(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (route, options) => options?.headers?.Host ? new Promise((resolve, reject) => {
    const req = http.request(base + route, { method: options.method || 'GET', headers: options.headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    }); req.on('error', reject); req.end(options.body);
  }) : fetch(base + route, options);
}
test('local STT, title and summary do not require an API key or call cloud endpoints', async t => {
  let localCalls = 0;
  const request = await app(t, { apiKey: '', fetchImpl: async () => { throw new Error('Cloud must not be called'); }, localAI: {
    status: async () => ({ sttReady: true, summaryReady: true }),
    transcribe: async (_file, language) => { localCalls++; assert.equal(language, 'ko'); return '오프라인으로 회의 원문을 변환했습니다.'; },
    generate: async ({ schema }) => { localCalls++; return schema.properties.summary ? { recommendedTitle: '오프라인 회의', summary } : { recommendedTitle: '오프라인 회의' }; }
  } });
  const form = new FormData(); form.append('audio', new File(['test'], 'meeting.mp3')); form.append('provider', 'local'); form.append('language', 'ko');
  let response = await request('/api/transcribe', { method: 'POST', body: form }); assert.equal(response.status, 200);
  const transcript = (await response.json()).transcript;
  response = await request('/api/summarize', json({ transcript, provider: 'local' })); assert.equal(response.status, 200); assert.deepEqual((await response.json()).summary, summary);
  response = await request('/api/recommend-title', json({ transcript, provider: 'local' })); assert.equal(response.status, 200); assert.equal(localCalls, 3);
  response = await request('/api/summarize', json({ transcript: '가'.repeat(12001), provider: 'local' })); assert.equal(response.status, 413); assert.equal(localCalls, 3);
});

test('streamed STT sends real stages before completion and finishes with a usable result', async t => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const request = await app(t, { apiKey: '', localAI: {
    transcribe: async (_file, _language, progress) => { progress('음성 준비 중'); await gate; progress('음성 변환 중'); return '회의를 변환했습니다.'; }
  } });
  t.after(() => finish());
  const form = new FormData(); form.append('audio', new File(['test'], 'meeting.wav')); form.append('provider', 'local');
  const response = await request('/api/transcribe', { method: 'POST', headers: { Accept: 'application/x-ndjson' }, body: form });
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value); assert.equal(JSON.parse(first).message, '음성 준비 중');
  finish(); let rest = '';
  while (true) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
  const events = rest.trim().split('\n').map(JSON.parse);
  assert.equal(events[0].message, '음성 변환 중'); assert.deepEqual(events[1], { type: 'result', data: { transcript: '회의를 변환했습니다.' } });
});

test('stream errors terminate the response safely; invalid input stays a normal HTTP error', async t => {
  const request = await app(t, { localAI: { generate: async () => { throw new Error('secret internal detail'); } } });
  const options = json({ transcript: '충분히 긴 회의 원문입니다.', provider: 'local' }); options.headers.Accept = 'application/x-ndjson';
  let response = await request('/api/summarize', options);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].type, 'progress'); assert.equal(events[1].type, 'error'); assert.equal(events[1].status, 500); assert.doesNotMatch(events[1].error, /secret/);
  options.body = JSON.stringify({ transcript: '', provider: 'local' }); response = await request('/api/summarize', options);
  assert.equal(response.status, 400); assert.match(response.headers.get('content-type'), /application\/json/);
});
test('hosted deployment requires authentication, matching origin and cloud provider', async t => {
  const password = 'a-long-test-password';
  const request = await app(t, { appOrigin: 'https://meetinglog.example', password, localAI: { status: async () => { throw new Error('Hosted app cannot use local AI'); } } });
  assert.equal((await request('/healthz')).status, 200);
  const headers = { Host: 'meetinglog.example' };
  let response = await request('/api/config', { headers }); assert.equal(response.status, 401); assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal((await request('/', { headers })).status, 200);
  assert.equal((await request('/app.js', { headers })).status, 200);
  headers.Authorization = 'Basic ' + Buffer.from(`meetinglog:${password}`).toString('base64');
  response = await request('/api/config', { headers }); assert.equal(response.status, 200); const config = await response.json(); assert.equal(config.hosted, true); assert.equal(config.local, null);
  response = await request('/api/config', { headers: { ...headers, Origin: 'https://evil.example' } }); assert.equal(response.status, 403);
  response = await request('/api/summarize', { ...json({ transcript: '충분히 긴 회의 원문입니다.', provider: 'local' }), headers: { ...headers, 'Content-Type': 'application/json', Origin: 'https://meetinglog.example' } }); assert.equal(response.status, 400);
});
test('in-page login creates a protected session, rejects tampering, expires and logs out', async t => {
  let time = Date.now(); const password = 'a-long-test-password';
  const request = await app(t, { appOrigin: 'https://meetinglog.example', password, now: () => time });
  const headers = { Host: 'meetinglog.example', Origin: 'https://meetinglog.example', 'Content-Type': 'application/json' };
  const login = value => request('/api/login', { ...json({ password: value }), headers });
  assert.equal((await login('wrong')).status, 401);
  assert.equal((await request('/api/login', { ...json({ password }), headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  let response = await login(password); assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
  let session = setCookie.split(';')[0];
  response = await request('/api/config', { headers: { ...headers, Cookie: session } }); assert.equal(response.status, 200); assert.equal((await response.json()).requiresAuth, true);
  assert.equal((await request('/api/config', { headers: { ...headers, Cookie: session + 'x' } })).status, 401);
  time += 12 * 60 * 60 * 1000 + 1;
  assert.equal((await request('/api/config', { headers: { ...headers, Cookie: session } })).status, 401);
  response = await login(password); session = response.headers.get('set-cookie').split(';')[0];
  response = await request('/api/logout', { method: 'POST', headers: { ...headers, Cookie: session } }); assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/config', { headers: { ...headers, Cookie: session } })).status, 401);
  for (let i = 0; i < 8; i++) assert.equal((await login('wrong')).status, 401);
  assert.equal((await login(password)).status, 429);
  time += 10 * 60 * 1000 + 1; assert.equal((await login(password)).status, 200);
});
test('local model calls loopback with JSON schema and never accepts a remote endpoint', async () => {
  let called;
  const ai = createLocalAI({ env: { OLLAMA_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'qwen2.5:3b' }, fetchImpl: async (url, options) => {
    called = { url, body: JSON.parse(options.body) }; return Response.json({ done: true, done_reason: 'stop', response: '{"recommendedTitle":"회의 제목"}' });
  } });
  const schema = { type: 'object' }; const result = await ai.generate({ instructions: '회의 제목 생성', input: '회의 내용', schema });
  assert.equal(result.recommendedTitle, '회의 제목'); assert.equal(called.url, 'http://127.0.0.1:11434/api/generate'); assert.deepEqual(called.body.format, schema); assert.equal(called.body.stream, false);
  const remote = createLocalAI({ env: { OLLAMA_URL: 'https://cloud.example' }, fetchImpl: () => { throw new Error('Do not call network'); } });
  await assert.rejects(remote.generate({ instructions: '', input: '', schema }), /localhost/);
});
