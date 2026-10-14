import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function createLocalAI({ fetchImpl = fetch, env = process.env, executeImpl = execute } = {}) {
  const modelFor = mode => ({ fast: env.WHISPER_FAST_MODEL, turbo: env.WHISPER_TURBO_MODEL, accurate: env.WHISPER_MODEL })[mode];
  const defaultMode = () => env.LOCAL_STT_MODE || (env.WHISPER_FAST_MODEL ? 'fast' : 'accurate');
  let running = false;
  async function exclusive(fn) {
    if (running) fail(409, '로컬 AI가 다른 요청을 처리 중입니다. 완료 후 다시 시도해 주세요.');
    running = true; try { return await fn(); } finally { running = false; }
  }
  async function available(mode = defaultMode()) {
    try { await Promise.all([env.WHISPER_BIN, modelFor(mode), env.FFMPEG_BIN].map(file => access(file || ''))); return true; } catch { return false; }
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
      const sttModes = (await Promise.all(['fast', 'turbo', 'accurate'].map(async mode => await available(mode) ? mode : null))).filter(Boolean);
      return { sttReady: sttModes.length > 0, summaryReady, sttModes, defaultSttMode: sttModes.includes(defaultMode()) ? defaultMode() : sttModes[0] };
    },
    async transcribe(file, language, onProgress = () => {}, { mode = defaultMode(), signal } = {}) {
      return exclusive(async () => {
        if (!['fast', 'turbo', 'accurate'].includes(mode)) fail(400, '올바른 음성 변환 속도를 선택해 주세요.');
        if (!await available(mode)) fail(503, '선택한 음성 모델이 준비되지 않았습니다. 다른 속도를 선택하거나 오프라인 설치를 완료해 주세요.');
        const model = modelFor(mode);
        // whisper.cpp Windows binaries can fail on a Unicode user-profile temp path.
        const tempRoot = env.LOCAL_TEMP_DIR || path.join(path.dirname(model), 'tmp');
        await mkdir(tempRoot, { recursive: true });
        const temp = await mkdtemp(path.join(tempRoot, 'meetinglog-audio-'));
        try {
          const wav = path.join(temp, 'input.wav'); const output = path.join(temp, 'transcript');
          // Distinct names prevent ffmpeg from trying to overwrite a WAV input.
          const source = path.join(temp, 'source' + path.extname(file.name).toLowerCase());
          onProgress('음성 파일을 변환하기 좋은 형식으로 준비하고 있습니다.');
          await writeFile(source, Buffer.from(await file.arrayBuffer()));
          await executeImpl(env.FFMPEG_BIN, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, signal, timeout: 180_000, maxBuffer: 1_000_000 });
          onProgress(`${{ fast: '빠른', turbo: '초고속', accurate: '정확도 우선' }[mode]} 모델로 대화를 텍스트로 변환하고 있습니다.`);
          const threads = Math.max(1, Math.min(os.availableParallelism(), Number(env.WHISPER_THREADS) || 8));
          const args = ['-m', model, '-f', wav, '-l', ['ko', 'en'].includes(language) ? language : 'auto', '-t', String(Math.floor(threads)), '-bs', mode === 'accurate' ? '5' : '1', '-bo', mode === 'accurate' ? '5' : '1', '-otxt', '-of', output, '-np'];
          if (mode !== 'accurate') args.push('-nf');
          await executeImpl(env.WHISPER_BIN, args, { windowsHide: true, signal, timeout: 1_800_000, maxBuffer: 2_000_000 });
          const transcript = (await readFile(`${output}.txt`, 'utf8')).trim();
          if (!transcript) fail(502, '음성을 인식하지 못했습니다. 파일을 확인해 주세요.');
          return transcript;
        } catch (e) { if (e.status) throw e; fail(502, '오프라인 음성 변환에 실패했습니다. 음성 파일과 로컬 설치를 확인해 주세요.'); }
        finally { await rm(temp, { recursive: true, force: true }); }
      });
    },
    async generate({ instructions, input, schema, onProgress = () => {}, signal }) {
      return exclusive(async () => {
        let res;
        const titleOnly = !schema.properties?.summary;
        const taskInstructions = titleOnly ? ' recommendedTitle 하나만 반환하세요. 60자 이내의 짧고 구체적인 회의 제목을 쓰고 설명은 덧붙이지 마세요.' : ' actions의 task에는 할 일만, owner에는 명시된 담당자 이름만, due에는 명시된 기한만 각각 넣으세요. 명시된 이름이나 기한을 미정으로 바꾸지 마세요. 예: "영희가 월요일까지 보고서를 공유한다"이면 task="보고서 공유", owner="영희", due="월요일"입니다. 이 예시를 결과에 포함하지 마세요.';
        try {
          res = await fetchImpl(`${ollamaURL()}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([AbortSignal.timeout(900_000), ...(signal ? [signal] : [])]),
            body: JSON.stringify({ model: env.OLLAMA_MODEL || 'qwen2.5:3b', system: instructions + ' 모든 문자열은 한국어로 작성하고 지정한 JSON 형식으로만 출력하세요.' + taskInstructions, prompt: input, format: schema, stream: true, keep_alive: '5m', options: { temperature: 0.1, num_ctx: 16384, num_predict: titleOnly ? 256 : 3500 } }) });
        } catch (e) { if (e.status) throw e; fail(503, '로컬 요약 서버에 연결할 수 없습니다. scripts/start-offline.ps1을 실행해 주세요.'); }
        if (res.status === 404) fail(503, '로컬 요약 모델이 없습니다. 오프라인 초기 설치를 완료해 주세요.');
        if (!res.ok) fail(502, '로컬 요약 모델 실행에 실패했습니다.');
        if (res.headers?.get('content-type')?.includes('application/x-ndjson')) {
          const reader = res.body.getReader(), decoder = new TextDecoder(); let pending = '', output = '', announced = false;
          try {
            while (true) {
              const { value, done } = await reader.read(); pending += decoder.decode(value, { stream: !done });
              const lines = pending.split('\n'); pending = lines.pop(); if (done && pending.trim()) { lines.push(pending); pending = ''; }
              for (const line of lines) {
                if (!line.trim()) continue;
                const event = JSON.parse(line); if (event.error) fail(502, '로컬 요약 모델 실행에 실패했습니다.');
                output += event.response || '';
                if (output.trim() && !announced) { announced = true; onProgress(titleOnly ? '회의 제목을 작성하고 있습니다.' : '핵심 요약과 결정 사항, 할 일을 작성하고 있습니다.'); }
                // Some local models continue producing whitespace after a complete JSON object.
                let generated; try { generated = JSON.parse(output); } catch {}
                if (generated && typeof generated === 'object' && !Array.isArray(generated)) return generated;
                if (event.done) fail(502, '로컬 요약이 완료되지 않았습니다. 원문을 줄여 다시 시도해 주세요.');
              }
              if (done) break;
            }
            fail(502, '로컬 모델의 응답이 끊겼습니다. 다시 시도해 주세요.');
          } catch (e) { if (e.status) throw e; fail(502, '로컬 모델의 결과를 읽지 못했습니다. 다시 시도해 주세요.'); }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const data = await res.json();
        if (!data.done || data.done_reason === 'length') fail(502, '로컬 요약이 완료되지 않았습니다. 원문을 줄여 다시 시도해 주세요.');
        try { return JSON.parse(data.response); } catch { fail(502, '로컬 모델의 결과 형식이 올바르지 않습니다. 다시 시도해 주세요.'); }
      });
    }
  };
}
