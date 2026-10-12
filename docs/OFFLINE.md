# 완전 오프라인 실행 (Windows x64)

STT는 Whisper.cpp의 다국어 `small` 모델, 제목 추천·요약은 Ollama의 `qwen2.5:3b` 모델을 사용합니다. 키가 필요하지 않습니다. 모델과 런타임을 처음 다운로드할 때만 인터넷이 필요합니다. 다운로드 후 음성·원문 처리는 이 PC에서 수행하며 클라우드로 자동 전환하지 않습니다.

## 최초 설치

Node.js 22 이상, PowerShell, curl.exe가 필요합니다. 여유 공간은 약 10 GB 이상을 권장합니다. 초기 다운로드는 네트워크 속도에 따라 오래 걸릴 수 있습니다. 프로젝트 폴더 안에만 설치하며 관리자 권한이나 시스템 PATH 변경이 필요하지 않습니다.

```powershell
cd D:\Meetinglog
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-offline.ps1
```

설치 스크립트는 공식 Ollama·Whisper 배포 파일, FFmpeg 공식 다운로드 페이지가 안내하는 Windows 빌드, Whisper 모델을 다운로드합니다. 중단 시 같은 명령으로 다운로드를 이어갑니다. `.env`의 기존 API 키는 보존하고 `AI_PROVIDER=local` 및 로컬 경로를 설정합니다. 런타임과 모델은 `runtime/`에 두며 GitHub에 올리지 않습니다.

## 매번 실행

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-offline.ps1
```

브라우저에서 http://localhost:3000 을 열고 **오프라인 AI · 이 PC에서 처리**를 선택합니다. 인터넷 연결을 끊어도 음성 변환, 제목 추천, 요약, 저장·조회·내보내기를 사용할 수 있습니다. 웹 화면은 외부 폰트나 CDN을 사용하지 않습니다. 브라우저 주소의 localhost는 인터넷이 아니라 이 PC의 서버입니다.

종료 시 앱 터미널에서 Ctrl+C를 누릅니다. Ollama는 재사용할 수 있도록 백그라운드에서 유지됩니다. 작업 관리자에서 프로젝트 `runtime/ollama/ollama.exe` 프로세스를 종료하면 메모리를 회수할 수 있습니다.

## 범위와 제한

- 파일 최대 25 MB, 오프라인 요약 원문 최대 12,000자. 긴 회의는 나눠 처리하세요.
- CPU에서도 동작합니다. 긴 음성은 실제 녹음 길이보다 처리 시간이 오래 걸릴 수 있습니다.
- 로컬 소형 모델은 클라우드 모델보다 한국어 인식·요약 품질이 낮을 수 있습니다. 요약과 담당자·기한을 원문과 비교하세요.
- 음성은 변환 중 임시 파일로 처리한 뒤 삭제합니다. 앱을 강제 종료하면 임시 파일이 남을 수 있습니다.
- 회의록은 `data/`에 평문 JSON으로 저장합니다. GitHub에 포함하지 않습니다.
- 설치 스크립트는 로컬 Ollama 포트 11434를 사용합니다. 기존 Ollama 서버가 있다면 그 서버에 모델을 준비하고 해당 서버의 설정을 관리하세요.
- `OLLAMA_NO_CLOUD=1`로 프로젝트의 Ollama를 실행하고 로컬 모델을 사용합니다. 앱은 로컬 주소만 호출합니다.
- `qwen2.5:3b` 모델 배포 라이선스는 모델 공식 페이지에서 확인하세요. 런타임/모델은 저장소에 재배포하지 않습니다.

품질 개선을 위해 7B 모델을 설치하려면 인터넷 연결 중 다음을 실행하세요. 추가 저장공간과 메모리가 필요합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-offline.ps1 -SummaryModel qwen2.5:7b
```

공식 참고: [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Ollama Windows](https://docs.ollama.com/windows), [Ollama API](https://docs.ollama.com/api/generate), [Qwen2.5 모델](https://ollama.com/library/qwen2.5:3b), [FFmpeg 다운로드](https://ffmpeg.org/download.html).
