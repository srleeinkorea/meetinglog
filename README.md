# Meetinglog

[온라인 앱](https://meetinglog.onrender.com) · [GitHub 저장소](https://github.com/srleeinkorea/meetinglog) · [Render로 온라인 배포](https://render.com/deploy?repo=https://github.com/srleeinkorea/meetinglog)

**온라인 + 완전 오프라인 AI 실행을 지원합니다.** 화면의 AI 실행 방식에서 클라우드(OpenAI)와 오프라인(Whisper.cpp + Ollama)을 선택합니다. 온라인 배포 서버는 클라우드 AI를, PC는 둘 중 원하는 방식을 사용합니다. 인터넷 없이 STT·제목 추천·요약까지 처리하려면 [오프라인 설치 안내](docs/OFFLINE.md)를 따라 모델을 한 번 다운로드하세요. API 키가 필요하지 않습니다. 온라인 URL 생성은 [Render 배포 안내](docs/DEPLOYMENT.md)를 참고하세요.

초기 설치 후 Windows에서는 `start-offline.cmd`를 더블클릭해 실행할 수 있습니다. 온라인 앱 로그인은 사용자명 `meetinglog`와 Render에서 생성한 `APP_PASSWORD`를 사용합니다. 실제 온라인 AI는 서비스에 OpenAI API 키를 설정해야 사용할 수 있습니다.

상용 OpenAI STT로 회의 음성을 텍스트로 바꾸고 핵심 내용, 결정 사항, 담당자·기한이 있는 할 일을 정리하는 로컬 웹앱 MVP입니다. 한국어 UI, 원문 편집, 회의록 저장·조회·삭제, Markdown 내보내기 및 복사를 제공합니다.

## 실행

Node.js 22 이상이 필요합니다. 이 프로젝트는 외부 npm 패키지를 사용하지 않으므로 설치 과정이 없습니다.

PowerShell에서:

```powershell
cd D:\Meetinglog
Copy-Item .env.example .env
notepad .env
```

`.env`의 `OPENAI_API_KEY=` 뒤에 본인의 API 키를 넣고 저장하세요. 키를 채팅 또는 소스 파일에 넣지 마세요. 이미 `.env`가 있다면 덮어쓰지 말고 수정하세요.

```powershell
node --env-file-if-exists=.env server.mjs
```

브라우저에서 http://localhost:3000 을 여세요. `npm start`도 같은 명령을 실행합니다. 종료는 터미널에서 Ctrl+C입니다. 포트가 사용 중이면 `.env`에 `PORT=3001`처럼 설정하세요.

API 키가 없어도 **샘플 회의 살펴보기**로 고정 예시의 저장·조회·내보내기를 사용할 수 있습니다. 샘플은 실제 STT 또는 AI 요약 결과가 아니며 화면과 내보내기에 샘플 표시가 붙습니다.

## 사용 흐름

1. 음성 파일을 입력하고 언어를 선택합니다. 회의 제목은 비워둬도 됩니다.
2. **음성을 텍스트로 변환**을 누릅니다. 기존 원문은 새 결과가 성공적으로 도착할 때까지 유지됩니다.
3. 인식 오류를 원문에서 수정합니다. 기존 텍스트만 있다면 **텍스트 입력** 탭을 사용하세요.
4. **회의록 정리하기**를 누르고 원문과 요약을 비교합니다. 핵심 주제를 바탕으로 제목도 자동 추천합니다.
5. **회의록 저장**으로 이 PC에 저장하거나 **Markdown ↓**으로 내보냅니다.

원문을 바꾸면 이전 요약과 추천 제목은 해제됩니다. 직접 입력한 제목은 유지합니다. 제목만 수정하면 요약을 유지하며 새 회의록으로 저장할 수 있습니다. 제목을 비우면 다시 정리할 때 자동 추천합니다.

음성 변환이 끝나면 제목 추천 API를 자동으로 호출합니다. 텍스트 입력 시에는 **제목 추천**으로 먼저 제목을 받아볼 수 있고, 정리할 때에도 요약과 제목을 한 번의 API 요청으로 생성합니다. 자동 추천은 API 키가 필요하며 별도 토큰 사용량이 발생합니다. 직접 입력한 제목이 있다면 덮어쓰지 않고 클릭해서 적용할 수 있는 추천안을 표시합니다. 제목은 저장·내보내기에도 반영됩니다. 제목 추천에 실패해도 변환된 원문은 유지됩니다.

## 구성과 데이터

- `server.mjs`: Node HTTP 서버, multipart 업로드, OpenAI API 호출, 구조화된 요약, JSON 파일 저장.
- `public/`: 외부 라이브러리 없는 HTML/CSS/JavaScript UI.
- `data/<id>.json`: 원문·요약·제목·저장 시각. 저장 버튼을 누를 때 생성합니다.
- `.env`: 서버에서만 읽는 API 키 및 모델 설정. 브라우저로 전달하지 않습니다.
- `tests/`: 외부 과금 없이 모의 API를 사용하는 연동 및 저장 검증.

서버는 `127.0.0.1`에서만 실행하며 외부 사이트의 요청을 거부합니다. 음성은 메모리에서 API로 전달한 뒤 디스크에 저장하지 않습니다. 음성과 원문은 OpenAI에 전송되므로 공유 가능한 자료를 사용하세요. 요약 API에는 `store: false`를 설정하지만 제공업체의 별도 데이터 보관 정책까지 비활성화하는 것은 아닙니다. 로컬 저장 파일은 암호화하지 않습니다.

## 모델과 범위

기본 STT는 `gpt-4o-transcribe`, 요약은 `gpt-4o-mini`입니다. `.env`에서 교체할 수 있지만 STT는 `json` 응답을 지원하는 전사 모델, 요약은 Responses API의 strict JSON Schema를 지원하는 모델을 사용해야 합니다. API 사용에는 계정의 모델 접근 권한과 별도 비용이 필요합니다.

파일은 최대 25,000,000바이트이며 MP3, MP4, MPEG, MPGA, M4A, WAV, WEBM을 지원합니다. 원문은 최대 80,000자입니다. 긴 녹음은 압축하거나 문장 경계를 고려해 여러 파일로 나눠 처리하세요. 자동 분할·합치기, 실시간 녹음, 화자 구분, 계정 인증, 팀 공유 및 여러 STT 제공업체 선택은 이 MVP에 포함하지 않았습니다. 담당자·기한은 원문에 없으면 미정, 상대 날짜는 그대로 남깁니다.

공식 API 문서: [음성 전사](https://developers.openai.com/api/docs/guides/speech-to-text), [구조화된 출력](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## 검증

```powershell
node --test
```

테스트는 샘플, 저장·조회·삭제, 파일 검증, API 키 누락, 전사 요청, 구조화된 요약, 제목 추천·수정·저장, 오프라인 API 선택 및 온라인 인증을 검증합니다. 클라우드 실제 API 호출은 키와 음성 파일을 설정한 뒤 따로 확인해야 합니다. 실제 로컬 모델 검증에는 오프라인 초기 설치가 필요합니다.
