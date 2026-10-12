import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function createLocalAI({ fetchImpl = fetch, env = process.env } = {}) {
  let running = false;
  async function exclusive(fn) {
    if (running) fail(409, '로컬 AI가 다른 요청을 처리 중입니다. 완료 후 다시 시도해 주세요.');
    running = true; try { return await fn(); } finally { running = false; }
  }
  async function available() {
    try { await Promise.all(['WHISPER_BIN', 'WHISPER_MODEL', 'FFMPEG_BIN'].map(key => access(env[key] || ''))); return true; } catch { return false; }
  }
  function ollamaURL() {
    const url = new URL(env.OLLAMA_URL || 'http://127.0.0.1:11434');
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) fail(503, '오프라인 요약 서버는 이 PC의 localhost 주소만 사용할 수 있습니다.');
    return url.origin;
  }
  return {
    async status() {
      let summaryReady = false;
      try {
        const res = await fetchImpl(`${ollamaURL()}/api/tags`, { signal: AbortSignal.timeout(2000) });
        const tags = await res.json(); summaryReady = Boolean(res.ok && tags.models?.some(m => m.name === (env.OLLAMA_MODEL || 'qwen2.5:3b')));
      } catch {}
      return { sttReady: await available(), summaryReady };
    },
    async transcribe(file, language) {
      return exclusive(async () => {
        if (!await available()) fail(503, '오프라인 STT가 준비되지 않았습니다. scripts/setup-offline.ps1을 먼저 실행해 주세요.');
        const temp = await mkdtemp(path.join(os.tmpdir(), 'meetinglog-audio-'));
        try {
          const wav = path.join(temp, 'input.wav'); const output = path.join(temp, 'transcript');
          // Distinct names prevent ffmpeg from trying to overwrite a WAV input.
          const source = path.join(temp, 'source' + path.extname(file.name).toLowerCase());
          await writeFile(source, Buffer.from(await file.arrayBuffer()));
          await execute(env.FFMPEG_BIN, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, timeout: 180_000, maxBuffer: 1_000_000 });
          await execute(env.WHISPER_BIN, ['-m', env.WHISPER_MODEL, '-f', wav, '-l', ['ko', 'en'].includes(language) ? language : 'auto', '-t', String(Math.min(os.availableParallelism(), 8)), '-otxt', '-of', output, '-np'], { windowsHide: true, timeout: 1_800_000, maxBuffer: 2_000_000 });
          const transcript = (await readFile(`${output}.txt`, 'utf8')).trim();
          if (!transcript) fail(502, '음성을 인식하지 못했습니다. 파일을 확인해 주세요.');
          return transcript;
        } catch (e) { if (e.status) throw e; fail(502, '오프라인 음성 변환에 실패했습니다. 음성 파일과 로컬 설치를 확인해 주세요.'); }
        finally { await rm(temp, { recursive: true, force: true }); }
      });
    },
    async generate({ instructions, input, schema }) {
      return exclusive(async () => {
        let res;
        try {
          res = await fetchImpl(`${ollamaURL()}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(900_000),
            body: JSON.stringify({ model: env.OLLAMA_MODEL || 'qwen2.5:3b', system: instructions + ' 결과는 지정한 JSON 형식으로만 출력하세요.', prompt: input, format: schema, stream: false, keep_alive: '5m', options: { temperature: 0.1, num_ctx: 16384, num_predict: 3500 } }) });
        } catch (e) { if (e.status) throw e; fail(503, '로컬 요약 서버에 연결할 수 없습니다. scripts/start-offline.ps1을 실행해 주세요.'); }
        if (res.status === 404) fail(503, '로컬 요약 모델이 없습니다. 오프라인 초기 설치를 완료해 주세요.');
        if (!res.ok) fail(502, '로컬 요약 모델 실행에 실패했습니다.');
        const data = await res.json();
        if (!data.done || data.done_reason === 'length') fail(502, '로컬 요약이 완료되지 않았습니다. 원문을 줄여 다시 시도해 주세요.');
        try { return JSON.parse(data.response); } catch { fail(502, '로컬 모델의 결과 형식이 올바르지 않습니다. 다시 시도해 주세요.'); }
      });
    }
  };
}
