---
title: "OCI 서버 한 대에 서비스 여러 개를 Docker Compose로 배포하기"
summary: "Calainder·Teammate·공용 feedback-api를 OCI 무료 ARM 서버 한 대에 올리면서, 프로젝트별 Compose 대신 서버 최상위 Compose 하나로 컨테이너를 모으고, 호스트 Nginx가 도메인별로 나눠 주는 구조를 골랐습니다."
date: "2026-06-01"
tags:
- 배포
- Docker
- Nginx
- OCI
projects: ["calainder", "teammate"]
decision:
  question: "Spring Boot·FastAPI로 된 서비스 여러 개와 두 서비스가 함께 쓰는 feedback-api를 서버 한 대에서 어떻게 띄우고, 도메인별로 어떻게 나눠 받을까"
  choice: "OCI Always Free A1 Flex 한 대의 /opt/portfolio에 최상위 docker-compose.yml 하나를 두고 모든 컨테이너를 정의한다. 웹 서버만 호스트 포트로 열고 AI·크롤러·feedback-api는 내부 네트워크에만 둔다. 호스트에 설치한 Nginx가 server_name으로 도메인을 나눠 127.0.0.1의 서비스 포트로 넘기고, Certbot으로 HTTPS를 붙인다."
  reasons:
    - "Compose 파일이 하나라 feedback-api 컨테이너를 한 번만 띄우고 두 서비스가 서비스 이름(feedback-api:7000)으로 함께 쓴다."
    - "서비스 하나에 문제가 생겨도 같은 파일에서 그 서비스만 stop·up·build할 수 있어 관리 지점이 하나다."
    - "AI·크롤러·feedback-api는 expose만 해 호스트 밖으로 열리지 않고, 비밀값은 모듈별 .env와 읽기 전용 볼륨으로만 들어간다."
    - "Spring Boot·FastAPI 여러 개를 띄워야 해서 프론트 중심 호스팅(Vercel)보다, EC2에서 이미 해 본 Docker 방식을 그대로 옮기는 편이 맞았다."
  tradeoff: "모든 서비스가 1 OCPU·6GB 서버 하나를 나눠 써 한 서비스의 부하나 서버 장애가 전부에 번진다. 프로젝트 저장소의 Compose와 서버 Compose가 따로 있어 둘이 어긋날 수 있다. calainder-server는 8888을 모든 인터페이스에 열어 두었고, 지금은 OCI·iptables 규칙이 외부 접근을 막고 있다."
---

> Calainder는 처음에 AWS EC2 한 대에 Docker Compose로 올렸고, 이후 OCI 서버 한 대로 옮기면서 Teammate와 두 서비스가 함께 쓰는 feedback-api까지 같은 서버에 올렸습니다. 프로젝트 저장소의 Dockerfile·docker-compose는 팀원이 작성했고, 서버 구성(최상위 Compose, `.env`, Nginx, HTTPS, OCI 네트워크, 도메인)은 AI(Codex)의 안내를 받아 직접 했습니다. 이 글은 그때 고른 구조와 이유입니다.

## 배경과 제약

| 서비스 | 컨테이너 |
| --- | --- |
| Calainder | `calainder-server`(Spring Boot) · `calainder-ai`(FastAPI) · `calainder-crawl`(FastAPI·Playwright) |
| Teammate | `teammate-web`(Spring Boot) · `teammate-ai-grading`(FastAPI) |
| feedback-api | 두 서비스가 함께 쓰는 FastAPI, Firestore 저장 |

- **비용.** 무료 범위 안에서 운영한다. OCI의 Always Free 대상인 `VM.Standard.A1.Flex`(ARM)를 골랐고, 4 OCPU·24GB로 늘리려던 요청은 춘천 리전 용량 부족(`Out of host capacity`)으로 계속 실패했고, 이후 무료 한도를 한 서버에 몰지 않고 나눠 쓰기로 해 1 OCPU·6GB로 운영한다.
- **서버는 한 대, 도메인은 둘.** `calainder.kr`, Teammate 도메인.
- **비밀값이 많다.** Google OAuth 클라이언트, AES 키, OpenAI 키, Firebase 서비스 계정 파일.
- **프로젝트마다 이미 Compose가 있다.** 각 저장소에는 그 프로젝트만 띄우는 `docker-compose.yml`이 있다.

결정 기준은 네 가지였습니다.

1. **공용 서비스는 하나만** — feedback-api를 두 번 띄우지 않는다.
2. **노출 최소화** — 바깥에는 Nginx(80·443)만 연다.
3. **비밀값 분리** — 비밀값이 Git과 이미지에 들어가지 않는다.
4. **서비스별 조작** — 한 서비스만 다시 빌드·재시작할 수 있다.

## 먼저 알아야 할 원리

### Compose의 기본 네트워크와 `expose`·`ports`

[Compose 서비스 문서](https://docs.docker.com/reference/compose-file/services/)에 따르면 `networks`를 따로 정하지 않은 서비스는 모두 `default` 네트워크에 들어가고, 다른 서비스는 **서비스 이름**으로 찾아갑니다. 그래서 같은 Compose 파일 안에서는 `http://feedback-api:7000`처럼 부를 수 있습니다. 반대로 Compose 파일이 다르면 기본 네트워크도 달라집니다.

- `expose`: 다른 서비스에서만 닿고 호스트에는 열지 않는다.
- `ports`: 컨테이너 포트를 호스트 포트에 연결해 밖에서도 닿게 한다.
- `env_file`: 파일의 환경변수를 컨테이너에 넣는다.
- `restart: unless-stopped`: 종료 코드와 상관없이 다시 띄우되, 직접 멈춘 서비스는 다시 띄우지 않는다.

### `.dockerignore`는 빌드 컨텍스트에서 파일을 뺀다

[Docker 빌드 컨텍스트 문서](https://docs.docker.com/build/concepts/context/)에 따르면 빌드할 때 컨텍스트 루트의 `.dockerignore`에 적은 파일은 빌더로 보내지 않습니다. 모듈마다 `.dockerignore`를 두면 그 모듈 폴더의 `.env`가 이미지에 들어가지 않습니다.

### Nginx는 `Host` 헤더로 server 블록을 고른다

[Nginx 요청 처리 문서](https://nginx.org/en/docs/http/request_processing.html)에 따르면 Nginx는 요청이 들어온 IP·포트에 맞는 `listen`을 고른 뒤, `Host` 헤더를 `server_name`과 비교해 처리할 server 블록을 정합니다. 맞는 것이 없으면 그 포트의 기본 server로 갑니다. 그래서 80·443 하나로 도메인 둘을 나눠 받을 수 있습니다.

### Let's Encrypt 발급 한도는 등록 도메인 단위다

[Let's Encrypt 발급 한도](https://letsencrypt.org/docs/rate-limits/)는 **등록 도메인당 7일에 인증서 50개**이고, 등록 도메인은 Public Suffix List로 정합니다. 여러 사람이 하위 도메인을 나눠 쓰는 무료 도메인은 이 한도를 함께 씁니다.

## 결정해야 했던 것

> **질문:** 서비스 여섯 개(컨테이너 기준)와 도메인 둘을 서버 한 대에 올릴 때, (1) 컨테이너를 어떤 Compose로 묶고, (2) 무엇을 바깥에 열며, (3) 비밀값을 어디에 두고, (4) 도메인을 어떻게 나눌까.

## 검토한 선택지

### 어디에 올릴지

| 선택지 | 판단 |
| --- | --- |
| Vercel | "깃 연결로 끝"은 프론트 기준이고, Spring Boot·FastAPI 여러 개를 띄워야 해 맞지 않음 |
| Render·Railway | AI가 쉬운 대안으로 제안. 이미 EC2에서 Docker Compose·HTTPS를 해 봐서 같은 방식을 유지 |
| **OCI Always Free A1 Flex 한 대에 Docker Compose** | 채택. 무료 범위, EC2 때와 같은 방식 |

EC2에서 OCI로 옮긴 이유 자체는 기록으로 남아 있지 않습니다.

### 컨테이너를 묶는 방법

| 선택지 | 장점 | 단점 | 이 프로젝트에서 |
| --- | --- | --- | --- |
| 프로젝트별 Compose를 각자 실행 | 저장소 파일 그대로 | feedback-api를 어느 쪽이 띄울지 애매, 네트워크가 나뉘어 서비스 이름으로 못 부름, 같은 컨테이너 이름이면 충돌 | 쓰지 않음 |
| **서버 최상위 `/opt/portfolio/docker-compose.yml` 하나** | 공용 서비스 하나, 관리 지점 하나 | 저장소 Compose와 내용이 따로 감 | **채택** |

"Teammate만 끄려면 Teammate Compose를 쓰면 되나"를 물었을 때, 최상위 Compose에서 `docker compose stop teammate-web teammate-ai-grading`처럼 서비스 이름으로 다루면 된다는 것을 확인했습니다.

### Teammate 도메인

| 선택지 | 판단 |
| --- | --- |
| `teammate.kro.kr` | Certbot이 `too many certificates (50) already issued for "kro.kr" in the last 168h0m0s`로 거부. 무료 도메인 사용자 전체가 한도를 나눠 씀 |
| `teammate.calainder.kr` | AI가 가장 안정적이라고 추천 |
| **`teammate.o-r.kr`** | 채택. 같은 구조의 무료 도메인이라 같은 한도 문제가 다시 생길 수 있음을 알고 고름 |

## 이 방법을 고른 이유

- **기준 1(공용 서비스):** 최상위 Compose에 `feedback-api`를 한 번만 정의하고, `calainder-server`와 `teammate-web`이 `depends_on`으로 같은 컨테이너를 가리킨다. 둘 다 `http://feedback-api:7000`으로 부른다.
- **기준 2(노출):** `calainder-server`(8888)와 `teammate-web`(8889)만 `ports`로 호스트에 열고, 나머지는 `expose`만 했다. 바깥 요청은 Nginx가 80·443에서 받아 `127.0.0.1:8888`, `127.0.0.1:8889`로 넘긴다.
- **기준 3(비밀값):** 모듈마다 자기 `.env`를 `env_file`로 읽고([#7](https://github.com/gasic37200/Calainder/issues/7)), 모듈별 `.dockerignore`로 `.env`·가상환경·캐시·빌드 결과를 이미지에서 뺐다([#8](https://github.com/gasic37200/Calainder/issues/8)). Firebase 서비스 계정 파일은 서버의 `secrets/` 폴더(권한 600)에만 두고 읽기 전용 볼륨으로 연결했다.
- **기준 4(서비스별 조작):** 한 파일 안에서 서비스 이름으로 `up -d --build calainder-server`처럼 바뀐 서비스만 다시 빌드한다([#11](https://github.com/gasic37200/Calainder/issues/11)).

## 구현 코드

**서버 최상위 Compose** (`/opt/portfolio/docker-compose.yml`, Calainder·feedback-api 부분을 줄여 옮김)

```yaml
services:
  calainder-server:
    build: { context: ./calainder/calainder-server }
    ports: ["8888:8888"]                              # Nginx가 127.0.0.1:8888로 넘김
    env_file: [./calainder/calainder-server/.env]     # FASTAPI_AI_BASE_URL=http://calainder-ai:8000 등
    depends_on: [calainder-ai, calainder-crawl, feedback-api]
    restart: unless-stopped

  calainder-ai:
    build: { context: ./calainder/calainder-ai }
    expose: ["8000"]                                  # 내부 네트워크에서만
    env_file: [./calainder/calainder-ai/.env]
    restart: unless-stopped

  feedback-api:                                       # 한 번만 정의, 두 서비스가 함께 사용
    build: { context: ./feedback-api }
    expose: ["7000"]
    env_file: [./feedback-api/.env]
    volumes:
      - ./feedback-api/secrets/firebase-adminsdk.json:/run/secrets/firebase-adminsdk.json:ro
    restart: unless-stopped
  # calainder-crawl, teammate-web(8889), teammate-ai-grading도 같은 방식
```

**Nginx** (`/etc/nginx/sites-available/calainder`의 요지, `sites-enabled`에 링크하고 기본 `default`는 비활성화)

```nginx
server {
    server_name calainder.kr;               # Host 헤더로 이 블록 선택
    location / {
        proxy_pass http://127.0.0.1:8888;   # 같은 VM의 calainder-server
    }
    # listen 443 ssl 과 인증서 경로는 certbot --nginx -d calainder.kr 이 추가
}
```

## 구현하며 부딪힌 것

바깥에서 닿지 않는 문제가 층마다 한 번씩 나왔습니다. 인스턴스는 `Running`인데 SSH가 안 됐고, 서브넷 Route Table에 `0.0.0.0/0 → Internet Gateway` 규칙이 없어서였습니다. Security List에 80·443을 연 뒤에도 서버 안에서는 되는데 바깥에서 80이 닿지 않아 `iptables -L INPUT`을 보니, Ubuntu 이미지 기본 규칙이 22번만 허용하고 그 뒤에 `REJECT`가 있었습니다. 80·443 `ACCEPT`를 `REJECT` 앞에 넣고(한 번은 두 번 들어가 중복을 지움) `netfilter-persistent`로 저장한 뒤 인증서를 받았습니다.

EC2 때는 인스턴스를 껐다 켜자 공인 IP가 바뀌어 `calainder.kr`이 `ERR_CONNECTION_TIMED_OUT`이 났습니다. 서버 안(localhost·Docker·Nginx)은 정상이라 바깥을 보니 A 레코드가 예전 IP를 가리키고 있었고, 새 IP로 바꿔 해결했습니다.

## 검증

- `docker compose config`로 Compose 문법을, `sudo nginx -t`로 Nginx 설정을 검사했습니다.
- `docker compose ps`로 컨테이너가 모두 떠 있는 것과 서버 안 `curl -I http://localhost:8888` 응답을 확인했습니다.
- v1.5.2 반영 때 서버 안에서 `https://calainder.kr/` 200, `/api/auth/status` 응답을 확인했고([#11](https://github.com/gasic37200/Calainder/issues/11)), 브라우저 접속도 정상이었습니다.

## 감수한 것과 다음

- **한 서버에 모두.** 1 OCPU·6GB를 여섯 컨테이너가 나눠 씁니다. 메모리 사용량은 재 보지 않았습니다. Playwright 크롤링이나 AI 요청이 몰리면 다른 서비스도 느려질 수 있고, 서버가 멈추면 모두 멈춥니다.
- **두 벌의 Compose.** 저장소 Compose(로컬·단독 실행용)와 서버 최상위 Compose가 따로라, 한쪽만 고치면 어긋납니다. 서버 Compose를 별도 저장소로 관리하는 것이 다음 과제입니다.
- **돌아보면: 웹 서버 포트 바인딩.** `"8888:8888"`은 호스트의 모든 인터페이스에 열립니다. 지금은 OCI Security List와 iptables가 8888을 막고 있지만, `"127.0.0.1:8888:8888"`로 묶으면 Nginx만 닿게 할 수 있습니다.
- **무료 도메인 인증서.** `o-r.kr`도 다른 사용자와 발급 한도를 나눠 쓰므로, 갱신이 막히면 `teammate.calainder.kr` 같은 하위 도메인으로 옮깁니다.

## 배운 점

- 여러 서비스를 한 서버에 올릴 때는 "공용 서비스를 누가 띄우는가"가 Compose 구조를 정한다. 같은 네트워크·같은 파일에 있어야 서비스 이름으로 부를 수 있다.
- 바깥에서 안 닿을 때는 층을 나눠 본다. 서버 안(컨테이너·Nginx) → VM 방화벽(iptables) → 클라우드 네트워크(Security List·Route Table) → DNS 순으로 좁히면 어디서 막혔는지 보인다.
- 무료 자원은 비용 대신 다른 제약(용량 부족, 공유 발급 한도)을 가져온다. 고를 때 그 제약도 함께 적어 둔다.
