---
name: portfolio-writing
description: 김윤관 포트폴리오 사이트(kimyoongwan.vercel.app)의 이력서·프로젝트·기술 기록 작성 규칙. 프로젝트 추가·수정, 트러블슈팅 정리, 기술 기록 글 작성, 이력 항목 추가, 사이트 반영(배포) 때 사용.
---

# 포트폴리오 작성 규칙

김윤관(백엔드 개발자, 신입)의 포트폴리오 사이트. Astro Sphere 테마 기반, GitHub `gasic37200/portfolio`의 `main`에 push하면 Vercel이 https://kimyoongwan.vercel.app 으로 자동 배포한다.

## 원칙

- **사실만.** 내용은 사용자가 준 자료(노션 원본, 대화, 코드)에 있는 것만 쓴다. 수치·원인·해결 과정이 자료에 없으면 사용자에게 묻고, 추론해서 쓴 문장은 완료 보고에서 따로 짚는다.
- **읽는 사람은 인사담당자와 면접관.** 인사담당자는 카드와 요약만 30초 안에 보고, 면접관은 트러블슈팅을 깊게 묻는다. 모든 문장은 "내가 무엇을 했고 무엇을 배웠는가"로 수렴한다.
- **연락처는 이메일과 GitHub만.** 전화번호는 공개 사이트에 넣지 않는다.
- 원본 자료: 노션 이력서 https://www.notion.so/96449c16438d833d88d801687a485021 (공개 페이지, JS 렌더링이라 브라우저로 읽어야 함. 긴 페이지는 뷰포트를 세로로 크게 키우고 스크린샷으로 렌더를 깨운 뒤 텍스트를 읽는다).

## 3단 구조

콘텐츠는 읽는 깊이에 따라 세 단으로 나눈다.

| 단 | 읽는 시간 | 위치 |
| --- | --- | --- |
| 카드 | 5초 | 프로젝트 frontmatter의 `summary`, `tags` |
| 상세 페이지 | 2분 | `src/content/projects/<slug>/index.mdx` 본문 (양식: project-template.md) |
| 기술 기록 | 5분+ | `src/content/blog/<slug>/index.md` |

### 카드 `summary`

한두 문장에 **무엇을 만들었는지 + 내 역할 또는 결과**를 함께 담는다. 예: "텍스트·이미지 속 일정을 AI가 분석해 Google Calendar에 자동 등록하는 서비스. 백엔드와 OCI 배포를 맡아 calainder.kr로 운영 중입니다."

### 상세 페이지 양식

섹션 순서, 섹션별 양식, 트러블슈팅 박스 양식은 [project-template.md](project-template.md)에 있다. 프로젝트 페이지를 쓰거나 고치기 전에 먼저 읽는다. 기준 페이지는 RePlant다.

노션 목차, 형상관리 버전 전체 목록, 긴 향후 계획은 상세 페이지에 옮기지 않는다(형상관리는 "release 브랜치로 v1.0~v1.5 관리" 한 줄로 요약).

## AI 활용 섹션

채용 쪽에서 "AI로 어떻게 기획했고 프롬프트를 어떻게 썼는지"를 묻는다. 프로젝트마다 다음 중 자료가 있는 것만 `###` 소제목으로 쓴다.

- **기획 방식** — 어떤 스킬·워크플로로 요구사항을 구체화했는지 (예: `grill-me`로 AI가 질문하고 사람은 결정)
- **프롬프트** — 대표 프롬프트 원문 발췌를 표(단계 | 프롬프트 | 결과)나 인용으로. 오타는 고치지 않고 짧게 발췌해 `…`로 줄인다
- **AI에게 거는 규칙** — 승인 게이트, "미실행" 보고, 범위 좁히기, 세션 분리, 컨텍스트 절약 방법
- **사람과 AI의 역할 나누기** — 직접 결정한 것 | AI에 맡긴 것 표
- **AI가 틀린 것을 바로잡은 사례** — 사례가 약하면 넣지 않는다 (RePlant에서는 빼기로 함)

실제로 쓰지 않은 방법(예: RePlant의 "컨텍스트를 아끼는 방법")이나 효율이 낮았던 프롬프트 패턴은 쓰지 않는다. 길게 쓸 내용은 블로그(`/posts`) 글로 두고 `<PostLink slug="...">한 줄 소개</PostLink>`로 잇는다. PostLink는 글이 공개됐을 때만 카드를 그리므로, 초안 글을 가리켜도 공개 사이트에는 링크가 나타나지 않는다.

팀이 FigJam 같은 보드에 남긴 기획 자료(이벤트 스토밍, 바운디드 컨텍스트, ERD 변천)는 링크만 걸지 말고 `get_screenshot`으로 받은 이미지를 sharp로 잘라 WebP로 `<Planning>` 토글에 넣고, 보드 링크는 토글 끝에 둔다. 다른 프로젝트 자료가 섞인 부분(예: 다른 저장소의 커밋 예시)은 뺀다.

자료는 해당 프로젝트를 작업한 다른 Claude 세션에 `SendMessage`로 요청해 받는다(세션 목록은 `list_sessions`). 받은 내용은 저장소 git log, GitHub PR(`gh`), 테스트 실행으로 숫자와 작성자를 확인한 뒤 쓴다. 팀 프로젝트는 팀원 작업과 본인 작업을 구분하고, 팀원 이름은 쓰지 않는다.

## 이슈·PR 번호

본문의 `#123`은 그대로 두지 말고 `[#123](저장소/issues/123)` 링크로 쓴다(GitHub가 PR 번호면 /pull/로 넘겨 준다). 면접관이 눌러서 확인할 수 있어야 한다. 트러블슈팅 박스는 `<Troubleshooting items={frontmatter.troubleshooting} repo={frontmatter.repoUrl} />`로 쓰면 frontmatter 문장 안의 `#123`이 자동으로 링크가 된다.

## 트러블슈팅 박스

프로젝트 frontmatter의 `troubleshooting` 배열이 **문제 → 원인 → 해결 과정 → 결과** 박스로 렌더된다. 칸마다 들어갈 요소와 순서, 체크리스트, 예시는 [project-template.md](project-template.md) "2. 트러블슈팅 양식"을 따른다. `post`로 연결한 글은 프로젝트 하단 "관련 기술 기록" 목록에서 자동으로 빠진다(중복 방지).

## 기술 기록 글

트러블슈팅 박스가 "무슨 일이 있었고 어떻게 고쳤나"라면, 기술 기록은 **"여러 방법 중 왜 이 방법을 골랐나"**를 쓰는 결정 기록이다(2026-10-27 멘토 피드백). 양식은 [project-template.md](project-template.md) "3. 기술 기록 양식"을 따른다. 기준 글은 `payment-commit-then-courier`.

- frontmatter: `title`(결정의 질문을 드러내는 제목), `summary`, `date`, `tags`, `projects: ["slug", …]`, `decision:`(question·choice·reasons·tradeoff, 글 상단 요약 상자). 예전 글의 `troubleshooting:` 상자는 `decision`이 없을 때만 그려진다.
- 선택지는 실제로 검토한 것만. 작업 세션(`SendMessage`)·PR 코멘트에서 확인하고, 없으면 사용자에게 묻는다.
- 아직 결정 기록으로 바꾸지 않은 글: `crawler-duplicate-fixed-event-id`, `llm-relative-time`, `oci-docker-compose-deploy`, `participation-scope-by-match`, `phone-number-privacy`, `uvicorn-422-empty-body`, `grill-me-planning`. 바꿀 때 같은 양식으로.

## 블로그 (임시 글)

프로젝트와 묶이지 않는 생각·고찰은 `src/content/posts/<slug>/index.md`의 **블로그**(`/posts`)에 쓴다. 기술 기록(`/blog`)과 다르게 형식이 자유롭고 트러블슈팅 박스나 `projects` 연결이 없다.

- frontmatter: `title`, `summary`, `date`, `tags`, `draft`.
- `draft: true`는 임시 글이다. `npm run dev`에서만 "임시 글" 표시와 함께 보이고, 빌드(실제 사이트)·검색·RSS에서는 빠진다. 공개는 `draft` 줄을 지우는 것.
- 임시 글도 `draft: true`인 채로 git에 올린다(2026-10-26 사용자 결정: 백업과 클라우드 세션 작업을 위해). 실제 사이트에는 나오지 않지만 저장소가 공개라 GitHub에서는 원문이 보인다. 그래서 올리기 전에 팀원 이름·연락처·내부 경로·키가 없는지 확인한다. 공개는 `draft` 줄을 지우는 것.
- 지금 임시 글: `session-orchestration-1`, `session-orchestration-2` (시리즈, 그림은 `public/images/posts/session-orchestration/`). 1편을 먼저 공개한다.
- 사용자는 블로그를 처음 쓴다. 초안을 잡을 때는 대화에서 나온 사실과 사용자의 생각만 쓰고, 직접 경험이 필요한 자리는 `- [ ]` 체크 항목으로 비워 둔다. 맨 위 HTML 주석에 작성 메모를 남긴다.
- 사용자의 의견을 대신 결론 내리지 않는다. 결론·소감 섹션은 비워 둔다.

## 이력 항목

`src/content/work/<slug>.md` 하나가 이력 페이지 한 줄이다. 최신 `dateStart` 순으로 정렬된다.

- 학력·병역처럼 기간이 있는 항목: `dateStart`, `dateEnd`(재학 중이면 `"Now"`).
- 자격증·수상·봉사처럼 한 시점인 항목: `dateEnd: ""` → 날짜가 하나만 표시된다.
- `company`에 항목명, `role`에 분류(`자격증`, `수상`, `봉사`, `병역`, 학과명 등), 본문에 bullet 1~2개.
- 홈 화면 Profile 요약(`src/pages/index.astro`의 `highlights`)에도 대표 항목을 한 줄 반영한다.

## 반영 절차

1. 개발 서버가 떠 있으면 확인용으로 쓰고, `npm run build`는 개발 서버를 끈 상태에서 돌린다. 둘을 동시에 돌리면 Vite 의존성 캐시가 꼬여 SolidJS 컴포넌트(프로젝트 목록·검색)가 로드되지 않는다. 꼬였으면 `node_modules/.vite`를 지우고 개발 서버를 재시작한다.
2. `npm run build`가 `0 errors`로 끝나야 한다.
3. 커밋 후 `main`에 push. 사용자 확인 없이 push하지 않는다.
4. 1~2분 뒤 https://kimyoongwan.vercel.app 에서 바뀐 페이지를 열어 내용이 보이는 것까지 확인해야 완료다.

## 구조상 주의점

- 개발 서버(`astro dev`)는 `/projects/404-express`처럼 경로에 `404`가 든 주소를 404 페이지로 가로챈다. 빌드 결과(`dist/`)와 실제 사이트에서는 정상이므로 그 페이지는 배포 후 실제 사이트에서 확인한다.
- 프로젝트 파일은 `.mdx`다(`<Troubleshooting>` 컴포넌트 사용). 컴포넌트는 `ArticleBottomLayout`에서 주입되므로 import 줄이 필요 없다. 블로그 글은 `.md`.
- 날짜는 `"YYYY-MM-DD"`로 쓴다. 표시는 한국어(`2026년 5월 31일`), 이력은 `2024.12` 형식으로 자동 변환된다.
- 사이트 주소(sitemap, RSS, 링크 미리보기)는 `astro.config.mjs`의 기본값. 개인 도메인을 붙이면 Vercel 환경 변수 `SITE_URL`로 바꾼다.
- 이미지는 `src/assets/`에 두고 `astro:assets`의 `Image`로 쓴다(빌드 시 WebP로 압축). 링크 미리보기 이미지는 `public/open-graph.jpg`(960×480).

## 미결 사항

- 기술 기록 글 6편의 `date`는 노션 프로젝트 날짜 기준 임시값. 사용자가 실제 시기를 주면 고친다.
- DDING!의 `date`(2026-01-23)는 노션 기록일로 보이며 실제 개발은 2025년 상반기일 수 있다(GitHub 저장소 생성 2025-05).
- RePlant 결과보고서(Google Slides, `결과보고서_6팀(일단커밋).pptx`)로 확인한 사실: 사용자는 **팀장**, 404-express는 **운영 EC2에 배포됨**, 결제 응답 8초 지연은 **타임아웃 합계(연결 3초 + 응답 5초)로 계산한 값이고 카오스 테스트는 아직 안 했다**(2026-10-26 사용자 확인, 결과보고서 표현과 다름), 자체평가 8/10. 본인 담당 슬라이드는 29(배송·알림 흐름)·34(트러블슈팅)·42(자체평가)이고, 팀원 담당 슬라이드는 쓰지 않는다. 사이트에 쓴 그림은 `public/images/projects/replant/`.
- 404-express의 "기획·결정·검증은 직접, 구현은 AI" 표기와 RePlant 기간(2026.10.06~10.22)은 사용자 확인 전 기본값이다.
- 빈틈(binteum_app, Flutter)은 사용자 요청으로 포트폴리오에서 제외.
- 배민·쿠팡 크롤링 경험: 코드를 찾으면 별도 프로젝트 카드 + 트러블슈팅으로 정리하기로 함. Calainder 트러블슈팅에는 붙이지 않는다. 이용약관상 자동 수집 제한이 있으니 "개인 학습 목적, 요청 간격 조절, 수집 데이터 미공개"처럼 책임 있게 다룬 점을 함께 쓴다.
- RePlant #129의 "행은 결제 트랜잭션 안, 예약은 커밋 후" 방식은 **사용자가 제안했다**(2026-10-26 사용자 확인). PR 본문의 To Reviewers에는 팀원이 제안한 것처럼 적혀 있지만 사용자 말을 따른다. 팀원 제안으로 고치지 않는다.
- RePlant SSE 401·403은 실제로 겪은 게 아니라 구현하며 미리 막은 것이다. 박스는 "막힐 수 있는 문제"로 쓴다.

## 다른 프로젝트 검토 대기 (2026-10-26)

프로젝트별 양식 검토 보고서가 `.claude/reviews/<slug>.md`에 있다(로컬 전용, git 제외). RePlant는 반영을 마쳤다. **나머지 5개(Calainder, Teammate, 404-express, DDING!, Korea Score Predictor)는 Codex 로컬 작업 기록과 검토 보고서를 함께 보고 고친다.** Codex 기록 위치: `D:/PC_Backup_2026-09-17/05_Codex/Local_State/sessions/YYYY/MM/DD/rollout-*.jsonl` (같은 폴더의 `auth.json`은 열지 않는다). 프로젝트별 세션: Calainder `2026-04-08T23-00-04`(기획~배포·OAuth·v1.x, 53MB), `2026-05-21T20-18-54`, `2026-05-27T19-49-43`(v1.4~1.5.1), `2026-06-12T04-19-55`(REST 경로 정리 → v1.5.2), `2026-05-22T17-26-05`·`2026-06-01T18-28-49`(OCI). Teammate `2026-05-21T20-18-54`, `2026-05-27T19-49-43`. Korea Score Predictor `2026-06-09T16-00-21`, `2026-06-09T16-05-02`. DDING!은 위 세션들에서 노션 정리 대화만. RePlant·404-express는 Codex 기록 없음(Claude로 작업). 그 전에는 페이지를 고치지 않는다.

사용자가 답한 사실 (반영할 때 그대로 쓴다):

| 프로젝트 | 확인된 사실 |
| --- | --- |
| 404-express | 운영 EC2에 실제로 배포됐다(저장소 `docs/OPERATIONS.md`의 10-16 "미실행"은 그 뒤에 배포됨). 페이지의 "운영 배포"는 유지 |
| Calainder | 팀원(커밋 26개)은 Docker 파일을 맡았다. Google OAuth 민감 범위 검증은 데모 영상까지 만들어 제출했지만 **반려됐다**. AI 분석 요청은 비동기가 아니다: 버튼을 누르면 fetch로 순차 처리되는 동기 흐름이고, 당시 비동기로 착각했다(크롤링만 `CompletableFuture` 비동기). 본인 PR #1~#11 링크를 단다 |
| Teammate | Flutter 앱과 디자인은 다른 팀원이 담당. **422 문제 확인됨(Codex 05-27 세션)**: Spring이 보낸 body가 FastAPI에서 `b''`로 받아지고 Uvicorn이 `Unsupported upgrade request`를 냄. 원인은 `uvicorn[standard]`가 함께 설치하는 `httptools` 파서(설치 시점에 따라 버전이 달라짐, Calainder 가상환경엔 httptools 없음). 먼저 `--http h11`로 실행해 확인한 뒤, `uvicorn[standard]` → `uvicorn`으로 바꾸고 `--http h11` 옵션을 뺐다. Calainder는 `release/v1.5.1`(PR #10)로 푸시됨. **Teammate 수정 커밋 `45b72f9`(release/v1.0.1)는 로컬에만 있고 원격에 푸시되지 않음** → 그래서 GitHub 저장소엔 아직 `uvicorn[standard]` + `--http h11`이 남아 있다 |
| DDING! | 크롤러가 멈춘 이유(Codex 04-08): 학교 학식이 푸드코트 형식으로 바뀌어 학식 정보를 크롤링할 수 없게 됐다. Codex에서 코드 작업은 없고 노션 정리만 했다. 게시판은 구현하지 못했다(코드는 있으나 미완성). README의 "문자 API로 피보팅해 완주"는 README가 틀렸다(알림 미구현). 날짜는 2025년으로(커밋 2025-05-15 ~ 06-06). 크롤러 코드는 저장소에 없으면 사용자가 나중에 찾아 준다 |
| 공통 | 원인·결과 근거가 부족한 박스는 회고로 옮긴다(후보: Calainder 박스 2·4, Teammate 박스 2, DDING! 박스 2·3, 404-express 박스 1·2, KSP 박스 3) |
