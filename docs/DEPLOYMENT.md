# 온라인 배포

GitHub 저장소는 소스 코드를 보관합니다. Node 서버와 AI API를 실행하려면 Render 같은 서버 호스팅이 필요합니다. GitHub Pages만으로는 이 서버를 실행할 수 없습니다.

## Render

[Render로 배포](https://render.com/deploy?repo=https://github.com/srleeinkorea/meetinglog)

1. Render 계정을 만들고 GitHub 계정으로 로그인합니다.
2. 위 링크로 Blueprint를 생성합니다. `render.yaml`은 무료 플랜을 사용합니다.
3. Blueprint 이름은 `meetinglog`, Branch는 `main`, Blueprint Path는 `render.yaml`로 두고 배포합니다. 추가 필수 입력값은 없습니다.
4. 서비스 주소는 Render의 `RENDER_EXTERNAL_URL`에서 자동으로 감지합니다. 별도 `APP_ORIGIN` 입력이 필요하지 않습니다. 사용자 지정 도메인은 `APP_ORIGIN`으로 지정하세요.
5. 생성된 `APP_PASSWORD`를 Render 환경변수 화면에서 확인합니다.
6. 앱을 열고 페이지의 로그인 화면에 `APP_PASSWORD`를 입력합니다. 사용자명은 입력하지 않습니다. 세션은 최대 12시간 유지되고 로그아웃 또는 서버 재시작 시 해제됩니다.

키가 없어도 앱을 배포하고 샘플 회의·저장·내보내기를 확인할 수 있습니다. 실제 온라인 AI 변환·요약을 사용하려면 서비스의 **Environment** 화면에서 `OPENAI_API_KEY`를 추가하고 재배포하세요. 키는 GitHub 코드에 올리지 않습니다. API 키 없는 온라인 앱은 실제 AI 기능을 실행하지 않습니다.

서버는 이 앱 주소의 요청만 받으며, 키와 회의록 접근에 비밀번호가 필요합니다. 인터넷 공개 주소에서 비밀번호를 해제하지 마세요. 한 사람/신뢰하는 소규모 그룹의 공유 워크스페이스이며 사용자별 데이터 분리는 없습니다.

**무료 플랜 데이터 주의:** Render 무료 서버의 로컬 파일은 재시작·재배포 시 사라질 수 있습니다. 중요한 회의록은 Markdown으로 내보내세요. 영구 저장이 필요하면 유료 persistent disk를 직접 선택하고 `DATA_DIR=/var/meetinglog/data`로 지정하세요. 기본 Blueprint는 유료 서비스를 자동 생성하지 않습니다. 온라인·PC 회의록은 자동 동기화하지 않습니다.

온라인 서버는 OpenAI STT·요약을 사용하므로 API 비용과 인터넷 연결이 필요합니다. 완전 오프라인 AI는 PC에서 `scripts/start-offline.ps1`으로 실행합니다.

## Docker

```powershell
docker build -t meetinglog .
docker run --env-file .env -e HOST=0.0.0.0 -p 3000:3000 -v meetinglog-data:/app/data meetinglog
```

`.env`에는 API 키 외에 `APP_ORIGIN=http://localhost:3000`, 16자 이상의 `APP_PASSWORD`, `AI_PROVIDER=cloud`를 지정해야 합니다. 인터넷 서버에서는 실제 HTTPS 주소와 reverse proxy를 사용하세요. 컨테이너 안의 `OLLAMA_URL`은 PC의 로컬 모델 주소와 다르므로 이 Docker 설정은 클라우드 실행용입니다.

공식 참고: [Render Blueprint](https://render.com/docs/blueprint-spec), [Deploy button](https://render.com/docs/deploy-button), [Persistent disk](https://render.com/docs/disks).
