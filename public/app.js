const $ = id => document.getElementById(id);
let current = null, selectedFile = null, busy = false, titleEdited = false, recommendedTitle = '';
let config = null;
const provider = () => $('provider').value || 'cloud';
function providerStatus() {
  const local = provider() === 'local';
  $('providerStatus').textContent = local ? (config?.local?.sttReady && config?.local?.summaryReady ? '● 로컬 모델 준비 완료 · 인터넷 없이 실행' : '로컬 모델 설치 또는 시작 필요') : (config?.configured ? '● 클라우드 API 키 설정됨' : '클라우드 API 키 설정 필요');
  $('privacy').textContent = local ? '오프라인 AI는 음성과 원문을 이 PC에서만 처리합니다. 음성 임시 파일은 처리 후 삭제합니다.' : '음성·원문은 처리 시 OpenAI로 전송됩니다. 음성 파일은 저장하지 않습니다.';
  $('apiStatus').textContent = local ? '오프라인 AI' : '클라우드 AI';
  $('transcript').maxLength = local ? 12000 : 80000;
}
$('provider').onchange = () => { providerStatus(); status(provider() === 'local' ? '오프라인 모드입니다. 모델 최초 설치 후 인터넷 없이 사용할 수 있습니다.' : '클라우드 모드입니다. 인터넷 연결과 API 키가 필요합니다.'); };
async function api(url, options = {}) {
  const res = await fetch(url, options); const data = await res.json();
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}
const post = (url, value) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function setBusy(value) {
  busy = value;
  for (const id of ['transcribe', 'summarize', 'save', 'demo', 'newMeeting', 'title', 'transcript', 'audio', 'language', 'audioTab', 'textTab', 'recommendTitle', 'applyTitle', 'provider']) $(id).disabled = value;
  document.querySelectorAll('.history button').forEach(b => b.disabled = value);
}
async function run(message, fn) {
  if (busy) return;
  setBusy(true); status(message);
  try { await fn(); } catch (e) { status(e.message, true); } finally { setBusy(false); }
}
function tab(audio) {
  $('audioPanel').hidden = !audio;
  $('audioTab').classList.toggle('selected', audio); $('textTab').classList.toggle('selected', !audio);
  $('audioTab').setAttribute('aria-selected', String(audio)); $('textTab').setAttribute('aria-selected', String(!audio));
}
$('audioTab').onclick = () => tab(true);
$('textTab').onclick = () => { tab(false); $('transcript').focus(); };
function selectFile(file) {
  if (busy || !file) return;
  if (!/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(file.name)) { status('지원하지 않는 파일 형식입니다.', true); return; }
  if (file.size > 25_000_000 || file.size === 0) { status('0바이트 초과, 25 MB 이하의 파일을 선택해 주세요.', true); return; }
  selectedFile = file; $('fileLabel').textContent = `${file.name} · ${(file.size / 1_000_000).toFixed(1)} MB`;
  status('파일을 선택했습니다. 음성을 텍스트로 변환해 주세요.');
}
$('audio').onchange = e => selectFile(e.target.files[0]);
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => { e.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.remove('dragging'); if (event === 'drop') selectFile(e.dataTransfer.files[0]); });
function invalidate() { current = null; $('empty').hidden = false; $('result').hidden = true; $('resultActions').hidden = true; $('resultBadge').textContent = '준비 중'; }
function updateChars() { $('chars').textContent = `${$('transcript').value.length.toLocaleString()}자`; }
function clearRecommendation() {
  recommendedTitle = ''; $('titleSuggestion').hidden = true;
  $('titleHelp').textContent = '회의 내용에 어울리는 제목을 추천해 드립니다. 직접 입력해도 좋아요.';
  if (!titleEdited) $('title').value = '';
}
$('transcript').oninput = () => { updateChars(); clearRecommendation(); if (current) { invalidate(); status('원문이 변경되었습니다. 다시 요약해 주세요.'); } };
function syncTitle() { if (current && $('title').value.trim()) { current.title = $('title').value.trim(); delete current.id; render(); } }
$('title').oninput = () => {
  titleEdited = Boolean($('title').value.trim());
  if (current && !titleEdited) { invalidate(); status('제목을 비웠습니다. 다시 정리하면 자동 추천됩니다.'); }
  else syncTitle();
};
function offerTitle(title, force = false) {
  recommendedTitle = title; $('applyTitle').textContent = title;
  if (force || !titleEdited || !$('title').value.trim()) {
    $('title').value = title; titleEdited = false; syncTitle();
    $('titleSuggestion').hidden = true; $('titleHelp').textContent = '✦ 회의 내용으로 추천한 제목입니다. 자유롭게 수정해 주세요.';
  } else {
    $('titleSuggestion').hidden = $('title').value.trim() === title;
    $('titleHelp').textContent = '직접 입력한 제목을 유지했어요. 추천 제목을 누르면 적용됩니다.';
  }
}
$('applyTitle').onclick = () => { if (recommendedTitle && !busy) { offerTitle(recommendedTitle, true); status('추천 제목을 적용했습니다.'); } };
$('recommendTitle').onclick = () => run('회의 내용에 어울리는 제목을 찾고 있습니다.', async () => {
  const { recommendedTitle: title } = await post('/api/recommend-title', { transcript: $('transcript').value.trim(), provider: provider() });
  offerTitle(title); status(titleEdited ? '추천 제목을 확인하고 눌러서 적용해 주세요.' : '회의 제목을 추천했습니다.');
});
$('transcribe').onclick = () => run('음성을 텍스트로 변환하고 있습니다. 파일 길이에 따라 몇 분 걸릴 수 있습니다.', async () => {
  if (!selectedFile) throw new Error('먼저 음성 파일을 선택해 주세요.');
  if ($('transcript').value.trim() && !confirm('현재 원문을 새 변환 결과로 바꿀까요?')) { status('변환을 취소했습니다.'); return; }
  const form = new FormData(); form.append('audio', selectedFile); form.append('language', $('language').value); form.append('provider', provider());
  const result = await api('/api/transcribe', { method: 'POST', body: form });
  $('transcript').value = result.transcript; updateChars(); invalidate(); clearRecommendation();
  status('변환 완료. 회의 제목을 추천하고 있습니다.');
  try {
    const { recommendedTitle: title } = await post('/api/recommend-title', { transcript: result.transcript, provider: provider() }); offerTitle(title);
    status('변환과 제목 추천 완료. 원문을 확인하고 회의록을 정리해 주세요.');
  } catch (e) { status(`음성 변환은 완료했습니다. 제목 추천: ${e.message} 원문은 유지됩니다.`, true); }
});
$('summarize').onclick = () => run('핵심 내용, 결정 사항, 할 일을 정리하고 있습니다.', async () => {
  const title = $('title').value.trim();
  const transcript = $('transcript').value.trim();
  const { summary, recommendedTitle: suggestion } = await post('/api/summarize', { title, transcript, provider: provider() });
  offerTitle(suggestion);
  current = { title: $('title').value.trim(), transcript, summary, demo: false }; render(); status('제목 추천과 요약 완료. 내용을 확인하고 저장해 주세요.');
});
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function render() {
  const result = $('result'); result.replaceChildren();
  const s = current.summary;
  result.append(element('h3', current.title, 'result-title'));
  const meta = element('div', undefined, 'result-meta');
  meta.append(element('span', `결정 ${s.decisions.length}건`), element('span', `할 일 ${s.actions.length}건`), element('span', current.demo ? '샘플 회의' : 'AI 회의록'));
  result.append(meta);
  for (const [key, title] of [['overview', '핵심 요약'], ['topics', '논의 주제'], ['decisions', '결정 사항'], ['actions', '다음 할 일'], ['questions', '확인할 사항']]) {
    const section = element('section', undefined, 'summary-section'); section.append(element('h3', title));
    if (key === 'overview') section.append(element('p', s[key]));
    else if (key === 'actions') {
      if (!s[key].length) section.append(element('p', '명시된 할 일이 없습니다.'));
      for (const action of s[key]) { const row = element('div', undefined, 'action'); row.append(element('strong', action.task), element('small', `담당 ${action.owner}  ·  기한 ${action.due}`)); section.append(row); }
    } else {
      const list = element('ul'); for (const text of s[key].length ? s[key] : ['명시된 내용이 없습니다.']) list.append(element('li', text)); section.append(list);
    }
    result.append(section);
  }
  $('resultBadge').textContent = current.demo ? '샘플 · 고정 예시' : '요약 완료';
  $('empty').hidden = true; result.hidden = false; $('resultActions').hidden = false;
  $('save').textContent = current.id ? '저장됨' : '회의록 저장';
}
function load(meeting) { titleEdited = true; clearRecommendation(); current = meeting; $('title').value = meeting.title; $('transcript').value = meeting.transcript; updateChars(); render(); }
$('demo').onclick = () => run('샘플을 불러오고 있습니다.', async () => {
  if (($('transcript').value || current) && !confirm('현재 화면을 샘플 회의로 바꿀까요? 저장하지 않은 내용은 사라집니다.')) { status('취소했습니다.'); return; }
  load(await api('/api/demo')); tab(false); status('샘플은 미리 준비한 고정 결과입니다. 실제 AI 변환·요약은 API 키 설정 후 사용할 수 있습니다.');
});
$('newMeeting').onclick = () => {
  if (busy) return;
  if ($('transcript').value && !confirm('새 회의를 시작할까요? 저장하지 않은 내용은 사라집니다.')) return;
  $('title').value = ''; $('transcript').value = ''; $('audio').value = ''; selectedFile = null;
  titleEdited = false; clearRecommendation();
  $('fileLabel').textContent = '회의 음성을 여기에 놓아주세요'; updateChars(); invalidate(); tab(true); status('');
};
async function history() {
  const meetings = await api('/api/meetings'); $('count').textContent = meetings.length;
  $('history').replaceChildren();
  if (!meetings.length) $('history').append(element('p', '저장한 회의록이 여기에 표시됩니다.', 'history-empty'));
  for (const m of meetings) {
    const row = element('div', undefined, 'history-entry'); const open = element('button', undefined, 'history-item');
    open.append(element('strong', `${m.demo ? '[샘플] ' : ''}${m.title}`), element('small', new Date(m.createdAt).toLocaleDateString('ko-KR')));
    open.onclick = () => run('회의록을 불러오고 있습니다.', async () => {
      if ($('transcript').value && !current?.id && !confirm('저장한 회의록을 열까요? 저장하지 않은 내용은 사라집니다.')) { status('취소했습니다.'); return; }
      load(await api(`/api/meetings/${m.id}`)); tab(false); status('저장한 회의록을 불러왔습니다.');
    });
    const del = element('button', '×', 'delete'); del.setAttribute('aria-label', `${m.title} 삭제`);
    del.onclick = () => run('회의록을 삭제하고 있습니다.', async () => {
      if (!confirm(`“${m.title}” 회의록을 삭제할까요?`)) { status('삭제를 취소했습니다.'); return; }
      await api(`/api/meetings/${m.id}`, { method: 'DELETE' });
      if (current?.id === m.id) { delete current.id; render(); }
      await history(); status('회의록을 삭제했습니다.');
    });
    row.append(open, del); $('history').append(row);
  }
}
$('save').onclick = () => run('이 PC에 회의록을 저장하고 있습니다.', async () => {
  if (!current) return;
  if (current.id) { status('이미 저장한 회의록입니다.'); return; }
  current = await post('/api/meetings', current); render(); await history(); status(config?.hosted ? '회의록을 온라인 서버에 저장했습니다. 중요한 내용은 파일로도 내보내세요.' : '회의록을 이 PC에 저장했습니다.');
});
function markdown() {
  const s = current.summary;
  const bullet = values => values.length ? values.map(v => `- ${v}`).join('\n') : '- 명시된 내용 없음';
  return `# ${current.title}\n${current.demo ? '\n> 샘플 회의 · 미리 준비한 예시\n' : ''}\n## 핵심 요약\n${s.overview}\n\n## 논의 주제\n${bullet(s.topics)}\n\n## 결정 사항\n${bullet(s.decisions)}\n\n## 다음 할 일\n${bullet(s.actions.map(a => `${a.task} (담당: ${a.owner}, 기한: ${a.due})`))}\n\n## 확인할 사항\n${bullet(s.questions)}\n\n## 회의 원문\n${current.transcript}\n`;
}
$('download').onclick = () => {
  if (!current) return; const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }));
  const link = element('a'); link.href = url; link.download = `${current.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('Markdown 파일을 내보냈습니다.');
};
$('copy').onclick = async () => { if (!current) return; try { await navigator.clipboard.writeText(markdown()); status('회의록을 클립보드에 복사했습니다.'); } catch { status('복사 권한이 없습니다. Markdown 내보내기를 사용해 주세요.', true); } };
try {
  config = await api('/api/config'); $('provider').value = config.defaultProvider || 'cloud';
  if (config.hosted) $('provider').querySelector('option[value="local"]').disabled = true;
  $('storageLabel').textContent = config.hosted ? '온라인 서버에 저장' : '내 PC에 저장';
  $('storageDescription').textContent = config.hosted ? '중요한 회의록은 파일로도 내보내세요' : '나만의 로컬 워크스페이스';
  providerStatus();
  await history();
} catch (e) { status(e.message, true); }
