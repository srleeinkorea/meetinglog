import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise browser event handlers without a browser or a paid API request.
async function ui({ requireLogin = false, aiResponse } = {}) {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  class Element {
    value = ''; textContent = ''; children = []; hidden = false;
    classList = { toggle() {}, add() {}, remove() {} };
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {} addEventListener() {} focus() {}
    click() { this.clicks = (this.clicks || 0) + 1; }
  }
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const $ = id => { assert.ok(elements.has(id), `Missing element: ${id}`); return elements.get(id); };
  const saved = [];
  let loggedIn = !requireLogin;
  const summary = { overview: 'MVP 범위를 정했습니다.', topics: ['범위'], decisions: ['업로드 구현'], actions: [], questions: [] };
  const context = {
    document: { getElementById: $, createElement: () => new Element(), querySelectorAll: () => [] },
    fetch: async (url, options) => {
      let data;
      if (url === '/api/login') { loggedIn = JSON.parse(options.body).password === 'test-password-long'; return { ok: loggedIn, status: loggedIn ? 200 : 401, json: async () => loggedIn ? { authenticated: true } : { error: '비밀번호 오류' } }; }
      if (url === '/api/logout') { loggedIn = false; return { ok: true, status: 200, json: async () => ({ authenticated: false }) }; }
      if (!loggedIn) return { ok: false, status: 401, json: async () => ({ error: '로그인이 필요합니다.' }) };
      if (aiResponse && ['/api/summarize', '/api/transcribe', '/api/recommend-title'].includes(url)) return aiResponse(url, options);
      if (url === '/api/config') data = { configured: true, requiresAuth: requireLogin };
      else if (url === '/api/meetings' && options?.method === 'POST') { const m = JSON.parse(options.body); saved.push(m); data = { ...m, id: 'saved-id' }; }
      else if (url === '/api/meetings') data = [];
      else data = { recommendedTitle: 'MVP 기능 범위 및 역할 분담 회의', summary };
      return { ok: true, json: async () => data };
    }, confirm: () => true, setTimeout, setInterval, clearInterval, TextDecoder, URL, Blob, FormData
  };
  await vm.runInNewContext(`(async () => { ${script}\n })()`, context);
  $('transcript').value = '음성 업로드 기반 MVP의 기능 범위와 역할을 정하기로 했습니다.';
  return { $, saved };
}
test('blank title gets automatic recommendation and is persisted', async () => {
  const { $, saved } = await ui();
  await $('summarize').onclick();
  assert.equal($('title').value, 'MVP 기능 범위 및 역할 분담 회의');
  assert.equal($('result').hidden, false);
  await $('save').onclick(); assert.equal(saved[0].title, $('title').value);
  $('transcript').value += ' 원문 수정'; $('transcript').oninput();
  assert.equal($('title').value, ''); assert.equal($('result').hidden, true);
});
test('401 opens an in-page login, successful login clears password, logout clears private content', async () => {
  const { $ } = await ui({ requireLogin: true });
  assert.equal($('loginGate').hidden, false);
  $('loginPassword').value = 'wrong'; await $('loginForm').onsubmit({ preventDefault() {} }); assert.equal($('loginError').textContent, '비밀번호 오류');
  $('loginPassword').value = 'test-password-long'; await $('loginForm').onsubmit({ preventDefault() {} });
  assert.equal($('loginGate').hidden, true); assert.equal($('loginPassword').value, ''); assert.equal($('logout').hidden, false);
  await $('logout').onclick(); assert.equal($('loginGate').hidden, false); assert.equal($('transcript').value, ''); assert.equal($('title').value, '');
});
test('manual title is preserved, recommendation can be applied and renamed without losing summary', async () => {
  const { $, saved } = await ui();
  $('title').value = '내가 정한 제목'; $('title').oninput();
  await $('summarize').onclick();
  assert.equal($('title').value, '내가 정한 제목'); assert.equal($('titleSuggestion').hidden, false);
  $('applyTitle').onclick(); assert.equal($('title').value, 'MVP 기능 범위 및 역할 분담 회의');
  $('title').value = '최종 회의록 제목'; $('title').oninput();
  assert.equal($('result').hidden, false);
  await $('save').onclick(); assert.equal(saved[0].title, '최종 회의록 제목'); assert.ok(saved[0].summary);
});

test('progress is visible before completion, handles split Korean text, and clears busy state on failure', async () => {
  let controller;
  const { $ } = await ui({ aiResponse: (_url, options) => {
    assert.equal(options.headers.Accept, 'application/x-ndjson');
    return new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  } });
  const running = $('summarize').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($('processing').hidden, false); assert.equal($('summarize').disabled, true);
  assert.equal($('processingTime').textContent, '0초 경과');
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'progress', message: '담당자와 할 일을 정리하고 있습니다.' }) + '\n');
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($('processingDetail').textContent, '담당자와 할 일을 정리하고 있습니다.');
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'error', status: 503, error: '모델을 시작해 주세요.' }) + '\n')); controller.close();
  await running;
  assert.equal($('processingTitle').textContent, '처리를 완료하지 못했습니다');
  assert.equal($('processingDetail').textContent, '모델을 시작해 주세요.');
  assert.equal($('processingTrack').hidden, true); assert.equal($('summarize').disabled, false);
  assert.equal($('transcript').value, '음성 업로드 기반 MVP의 기능 범위와 역할을 정하기로 했습니다.');
});

test('offline accepts a 100 MB recording, shows exact rejection reasons, and never reuses a rejected file', async () => {
  const { $ } = await ui();
  $('provider').value = 'local'; $('provider').onchange();
  assert.match($('uploadLimit').textContent, /200 MB/);
  $('audio').onchange({ target: { files: [{ name: 'meeting.wav', size: 100_000_000 }] } });
  assert.equal($('uploadError').hidden, true); assert.match($('fileLabel').textContent, /100.0 MB/);
  $('provider').value = 'cloud'; $('provider').onchange();
  assert.match($('uploadError').textContent, /100.0 MB/); assert.match($('uploadError').textContent, /25 MB/);
  await $('transcribe').onclick(); assert.equal($('audio').clicks, 1); assert.equal($('transcribe').disabled, undefined);
  $('audio').onchange({ target: { files: [{ name: 'empty.wav', size: 0 }] } }); assert.match($('uploadError').textContent, /0바이트/);
  $('provider').value = 'local'; $('provider').onchange();
  $('audio').onchange({ target: { files: [{ name: 'huge.wav', size: 200_000_001 }] } }); assert.match($('uploadError').textContent, /최대 200 MB/);
});
