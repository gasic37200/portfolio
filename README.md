# 김윤관 포트폴리오

작은 개선을 꾸준히 쌓아 사용자 경험과 서비스 완성도를 높이는 백엔드 개발자 김윤관의 포트폴리오 사이트입니다.

[Astro Sphere](https://github.com/markhorn-dev/astro-sphere) 테마(MIT)를 기반으로 만들었습니다.

## 콘텐츠 수정

| 내용 | 위치 |
| --- | --- |
| 사이트 이름, 메뉴, 연락처 | `src/consts.ts` |
| 홈 화면 (소개, 스킬) | `src/pages/index.astro` |
| 이력 (학력, 자격증, 수상) | `src/content/work/*.md` |
| 프로젝트 | `src/content/projects/<이름>/index.mdx` |
| 기술 기록 | `src/content/blog/<이름>/index.md` |

프로젝트와 기술 기록의 트러블슈팅 박스는 각 파일 frontmatter의 `troubleshooting` 항목으로 관리합니다.

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm install` | 의존성 설치 |
| `npm run dev` | 개발 서버 실행 (`localhost:4321`) |
| `npm run build` | 타입 검사 후 `./dist/`에 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |

## 배포

`main` 브랜치에 push하면 Vercel이 자동으로 배포합니다. 사이트 주소(sitemap, RSS에 쓰임)는 Vercel의 `VERCEL_PROJECT_PRODUCTION_URL`을 사용하며, 커스텀 도메인을 쓰면 `SITE_URL` 환경 변수로 지정합니다.
