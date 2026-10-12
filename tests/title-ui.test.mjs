import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise browser event handlers without a browser or a paid API request.
async function ui() {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  class Element {
    value = ''; textContent = ''; children = []; hidden = false;
    classList = { toggle() {}, add() {}, remove() {} };
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {} addEventListener() {} focus() {}
  }
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const $ = id => { assert.ok(elements.has(id), `Missing element: ${id}`); return elements.get(id); };
  const saved = [];
  const summary = { overview: 'MVP 범위를 정했습니다.', topics: ['범위'], decisions: ['업로드 구현'], actions: [], questions: [] };
  const context = {
    document: { getElementById: $, createElement: () => new Element(), querySelectorAll: () => [] },
    fetch: async (url, options) => {
      let data;
      if (url === '/api/config') data = { configured: true };
      else if (url === '/api/meetings' && options?.method === 'POST') { const m = JSON.parse(options.body); saved.push(m); data = { ...m, id: 'saved-id' }; }
      else if (url === '/api/meetings') data = [];
      else data = { recommendedTitle: 'MVP 기능 범위 및 역할 분담 회의', summary };
      return { ok: true, json: async () => data };
    }, confirm: () => true, setTimeout, URL, Blob, FormData
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
