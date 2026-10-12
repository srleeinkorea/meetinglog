import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'meetinglog-test-'));
  const server = createApp({ dataDir, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  return { base, request: (route, options) => fetch(base + route, options) };
}
const json = value => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
test('sample can be saved, listed, retrieved and deleted', async t => {
  const { request } = await fixture(t);
  const sample = await (await request('/api/demo')).json(); assert.equal(sample.demo, true);
  let response = await request('/api/meetings', json(sample)); assert.equal(response.status, 201);
  const saved = await response.json(); assert.ok(saved.id);
  assert.equal((await (await request('/api/meetings')).json()).length, 1);
  assert.deepEqual((await (await request(`/api/meetings/${saved.id}`)).json()).summary, sample.summary);
  response = await request(`/api/meetings/${saved.id}`, { method: 'DELETE' }); assert.equal(response.status, 200);
  assert.equal((await request(`/api/meetings/${saved.id}`)).status, 404);
  assert.equal((await request('/api/meetings/..%2Fsecret')).status, 400);
});
test('reject foreign origin, missing key and malformed inputs', async t => {
  const { request } = await fixture(t, { apiKey: '' });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/api/config', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/summarize', json({ title: '회의', transcript: '짧음' }))).status, 400);
  assert.equal((await request('/api/summarize', json({ title: '회의', transcript: '회의 원문을 열 글자 이상 입력합니다.' }))).status, 503);
  const form = new FormData(); form.append('audio', new File(['test'], 'file.exe'));
  assert.equal((await request('/api/transcribe', { method: 'POST', body: form })).status, 400);
  assert.equal((await request('/api/meetings', json({ title: '회의', transcript: '원문', summary: {} }))).status, 502);
});
test('transcription forwards audio and language, summary uses strict schema', async t => {
  const calls = [];
  const summary = { overview: '요약', topics: [], decisions: ['결정'], actions: [{ task: '테스트', owner: '미정', due: '미정' }], questions: [] };
  const { request } = await fixture(t, { apiKey: 'fake-test-key', fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return Response.json(url.endsWith('transcriptions') ? { text: '다음 주까지 테스트를 진행하기로 결정했습니다.' } : { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ recommendedTitle: '테스트 일정 및 실행 계획 회의', summary }) }] }] });
  } });
  const form = new FormData(); form.append('audio', new File(['audio'], 'meeting.mp3', { type: 'audio/mpeg' })); form.append('language', 'ko');
  const transcript = await (await request('/api/transcribe', { method: 'POST', body: form })).json(); assert.ok(transcript.transcript);
  assert.equal(calls[0].opts.body.get('language'), 'ko'); assert.equal(calls[0].opts.body.get('file').name, 'meeting.mp3');
  const response = await request('/api/summarize', json({ title: '회의', transcript: transcript.transcript }));
  assert.equal(response.status, 200); const generated = await response.json(); assert.deepEqual(generated.summary, summary); assert.equal(generated.recommendedTitle, '테스트 일정 및 실행 계획 회의');
  const payload = JSON.parse(calls[1].opts.body); assert.equal(payload.store, false); assert.equal(payload.text.format.strict, true);
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer fake-test-key');
});
test('title recommendation works without a user title and rejects invalid model titles', async t => {
  let title = '서비스 MVP 범위 및 역할 분담'; let payload;
  const { request } = await fixture(t, { apiKey: 'fake', fetchImpl: async (_url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ recommendedTitle: title }) }] }] });
  } });
  let response = await request('/api/recommend-title', json({ transcript: '서비스 MVP의 기능 범위를 정하고 역할을 분담했습니다.' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).recommendedTitle, title);
  assert.deepEqual(payload.text.format.schema.required, ['recommendedTitle']);
  assert.equal(payload.text.format.strict, true);
  title = ' '; response = await request('/api/recommend-title', json({ transcript: '서비스 MVP의 기능 범위를 정하고 역할을 분담했습니다.' })); assert.equal(response.status, 502);
  title = '가'.repeat(61); response = await request('/api/recommend-title', json({ transcript: '서비스 MVP의 기능 범위를 정하고 역할을 분담했습니다.' })); assert.equal(response.status, 502);
  assert.equal((await request('/api/recommend-title', json({ transcript: '짧음' }))).status, 400);
});
test('upstream errors and incomplete or invalid summaries are surfaced', async t => {
  for (const [upstream, expected] of [[new Response('{}', { status: 429 }), '사용 한도'], [Response.json({ status: 'incomplete' }), '완료되지'], [Response.json({ status: 'completed', output: [] }), '읽지 못']]) {
    const { request } = await fixture(t, { apiKey: 'fake', fetchImpl: async () => upstream });
    const response = await request('/api/summarize', json({ title: '회의', transcript: '회의 원문을 열 글자 이상 입력합니다.' }));
    assert.equal(response.status, 502); assert.ok((await response.json()).error.includes(expected));
  }
});
