import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalAI } from '../local-ai.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'meetinglog-speed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { LOCAL_TEMP_DIR: root, WHISPER_THREADS: '8', LOCAL_STT_MODE: 'fast' };
  for (const key of ['WHISPER_BIN', 'FFMPEG_BIN', 'WHISPER_MODEL', 'WHISPER_FAST_MODEL', 'WHISPER_TURBO_MODEL']) {
    env[key] = path.join(root, key); await writeFile(env[key], 'fixture');
  }
  const calls = [];
  const ai = createLocalAI({ env, fetchImpl: async () => Response.json({ models: [] }), executeImpl: async (bin, args, options) => {
    calls.push({ bin, args, options });
    if (bin === env.FFMPEG_BIN) await writeFile(args.at(-1), new Uint8Array(100));
    else await writeFile(args[args.indexOf('-of') + 1] + '.txt', '회의 원문을 변환했습니다.');
  } });
  return { root, env, calls, ai, file: new File(['audio'], 'meeting.wav') };
}

test('fast and turbo use their own models, accurate preserves beam search, and jobs clean up their audio', async t => {
  const { root, env, calls, ai, file } = await fixture(t);
  const readiness = await ai.status(); assert.equal(readiness.defaultSttMode, 'fast'); assert.deepEqual(readiness.sttModes, ['fast', 'turbo', 'accurate']);
  for (const [mode, key, beams] of [['fast', 'WHISPER_FAST_MODEL', '1'], ['turbo', 'WHISPER_TURBO_MODEL', '1'], ['accurate', 'WHISPER_MODEL', '5']]) {
    const result = await ai.transcribe(file, 'ko', () => {}, { mode }); assert.ok(result.includes('변환'));
    const call = calls.at(-1); assert.equal(call.args[call.args.indexOf('-m') + 1], env[key]); assert.equal(call.args[call.args.indexOf('-bs') + 1], beams);
    assert.equal(call.args.includes('-nf'), mode !== 'accurate');
    assert.equal(call.args.includes('--vad'), false); assert.ok(call.args.includes('ko'));
    assert.equal((await readdir(root)).some(name => name.startsWith('meetinglog-audio-')), false);
  }
  const before = calls.length;
  await assert.rejects(ai.transcribe(file, 'ko', () => {}, { mode: '../../bad' }), { status: 400 }); assert.equal(calls.length, before);
  await rm(env.WHISPER_FAST_MODEL); await assert.rejects(ai.transcribe(file, 'ko', () => {}, { mode: 'fast' }), { status: 503 }); assert.equal(calls.length, before);
});

test('request cancellation reaches both local processes without exposing a shell', async t => {
  const { calls, ai, file } = await fixture(t);
  const controller = new AbortController(); await ai.transcribe(file, 'ko', () => {}, { mode: 'fast', signal: controller.signal });
  for (const call of calls) { assert.equal(call.options.signal, controller.signal); assert.equal(call.options.windowsHide, true); }
});
