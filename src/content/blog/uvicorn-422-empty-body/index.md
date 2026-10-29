---
title: "FastAPI를 Uvicorn으로 띄우기: h11과 httptools 중 고르기"
summary: "Spring이 호출하는 FastAPI 모듈은 uvicorn[standard] 대신 uvicorn만 설치해, Uvicorn이 HTTP 파서를 설치 상태에 따라 고르지 않고 항상 h11을 쓰게 했습니다."
date: "2026-06-01"
tags:
- 설계
- FastAPI
- Spring Boot
projects: ["teammate"]
decision:
  question: "Spring Boot 서버가 호출하는 FastAPI 모듈을 Uvicorn으로 띄울 때, 어떤 HTTP 파서를 어떤 방법으로 정할까"
  choice: "requirements.txt의 uvicorn[standard]를 uvicorn으로 바꿔 httptools를 설치하지 않는다. 그러면 Uvicorn의 자동 선택이 항상 h11이 되므로 실행 옵션(--http h11)은 두지 않는다."
  reasons:
    - "두 모듈 모두 WebSocket을 쓰지 않아 [standard]가 더해 주는 선택 의존성이 필요 없다."
    - "파서를 고르는 기준이 '설치돼 있는가'라서, 설치하지 않는 것이 실행 명령마다 옵션을 붙이는 것보다 빠뜨릴 곳이 적다."
    - "Spring 쪽 HTTP 클라이언트 설정을 건드리지 않아, Calainder와 Teammate가 같은 기본 RestClient를 그대로 쓴다."
  tradeoff: "httptools의 성능 이점을 포기했다(측정은 하지 않았다). requirements.txt 버전을 아직 고정하지 않았고, Teammate 쪽 변경은 원격에 올리지 않았다. WebSocket이나 성능이 필요해지면 uvicorn[standard]로 돌아가고 --http h11을 명시한다."
---

> Teammate 보완 개발에서 Spring Boot 평가 웹 서버가 FastAPI AI 평가 모듈을 REST로 호출하는 구조를 만들었습니다. 로컬에서 Spring을 거친 요청만 FastAPI에 빈 본문으로 도착했고, 원인은 Uvicorn이 고른 HTTP 파서였습니다. 경위는 [Teammate 트러블슈팅](/projects/teammate)에 있고, 이 글은 **파서를 어떻게 정하기로 했는지**와 그 근거가 된 원리를 정리합니다.

## 배경과 제약

- **호출하는 쪽은 Spring Boot의 `RestClient`다.** `RestClient.builder().baseUrl(...).build()`로 만든 기본 클라이언트이고, 별도 HTTP 클라이언트 라이브러리는 넣지 않았다.
- **받는 쪽은 Uvicorn으로 띄운 FastAPI다.** 컨테이너 이미지는 `python:3.11-slim`에 `pip install -r requirements.txt`로 만든다.
- **`requirements.txt`는 버전 없이 `fastapi`, `uvicorn[standard]`였다.** 그래서 설치 시점마다 설치되는 버전이 달랐다.
- **같은 구조의 Calainder가 한 서버에서 함께 돈다.** 두 프로젝트를 같은 방식으로 맞춰 두고 싶었다.
- **WebSocket은 쓰지 않는다.** 두 모듈 모두 요청 한 번에 응답 한 번인 REST API다.

결정 기준은 세 가지로 잡았습니다.

1. **재현성** — 같은 `requirements.txt`와 Dockerfile이면 어디서 띄워도 같은 파서로 요청을 읽는다.
2. **변경 범위** — 고치는 곳이 한 곳이고, 빠뜨릴 수 있는 곳이 적다.
3. **두 프로젝트 통일** — Calainder와 Teammate가 같은 방식이다.

## 먼저 알아야 할 원리

### Uvicorn은 HTTP 파서를 바꿔 끼울 수 있다

Uvicorn은 HTTP/1.1 요청을 읽는 구현을 `--http` 옵션으로 고릅니다. [설정 문서](https://www.uvicorn.org/settings/)의 선택지는 `auto`, `h11`, `httptools`이고 **기본값은 `auto`**입니다(최신 문서에는 실험 단계인 `zttp`도 있습니다).

- **h11** — 순수 Python으로 만든 HTTP/1.1 구현.
- **httptools** — Node.js의 HTTP 파서를 Python에서 쓰게 한 바인딩. 문서는 성능이 더 좋지만 PyPy와는 맞지 않는다고 설명합니다.

### `auto`는 "httptools가 설치돼 있는가"로 정해진다

`auto`가 가리키는 [`uvicorn/protocols/http/auto.py`](https://github.com/encode/uvicorn/blob/master/uvicorn/protocols/http/auto.py)는 `httptools`를 import해 보고, 성공하면 httptools 구현을, 실패하면 h11 구현을 씁니다. [설치 문서](https://www.uvicorn.org/installation/)도 "httptools가 설치돼 있으면 HTTP/1.1 파싱에 기본으로 쓴다"고 적고 있습니다.

즉 **실행 명령이 같아도, 그 환경에 무엇이 설치돼 있느냐에 따라 파서가 달라집니다.**

### `uvicorn[standard]`가 httptools를 함께 설치한다

[설치 문서](https://www.uvicorn.org/installation/)에 따르면 `pip install uvicorn`은 최소 의존성(`h11`, `click`)만 설치합니다. `uvicorn[standard]`는 여기에 `uvloop`, `httptools`, `websockets`, `watchfiles`, `python-dotenv`, `PyYAML` 같은 선택 의존성을 더합니다.

그래서 `uvicorn[standard]`로 설치한 환경은 `auto`에서 httptools를, `uvicorn`만 설치한 환경은 h11을 씁니다. 실제로 두 프로젝트의 가상환경을 비교했을 때 Teammate에는 `httptools` 0.8.0과 `websockets` 16.0이 있었고, Calainder에는 둘 다 없었습니다.

### Spring `RestClient`의 기본 클라이언트는 HTTP/2 업그레이드를 시도한다

[`RestClient.builder()`](https://github.com/spring-projects/spring-framework/blob/v6.2.10/spring-web/src/main/java/org/springframework/web/client/DefaultRestClientBuilder.java)에 요청 팩토리를 지정하지 않으면, Apache HttpComponents·Jetty·Reactor Netty 클라이언트가 클래스패스에 있는지 차례로 보고, 없으면 JDK의 `java.net.http.HttpClient`(`JdkClientHttpRequestFactory`)를 씁니다. Teammate 웹 서버는 `spring-boot-starter-web`만 쓰므로 JDK 클라이언트가 선택됩니다.

[JDK `HttpClient.Builder.version()`](https://docs.oracle.com/en/java/javase/17/docs/api/java.net.http/java/net/http/HttpClient.Builder.html) 문서는 버전을 정하지 않으면 HTTP/2를 선호하고, **요청마다 HTTP/2로 업그레이드를 시도하며 실패하면 HTTP/1.1로 처리한다**고 설명합니다.

Uvicorn의 [httptools 구현](https://github.com/encode/uvicorn/blob/master/uvicorn/protocols/http/httptools_impl.py)은 WebSocket이 아닌 업그레이드 요청을 받으면 `Unsupported upgrade request.` 경고를 남기고 일반 요청으로 처리합니다. Teammate에서 본문이 빈 요청마다 이 경고가 함께 찍혔습니다. 다만 Spring이 실제로 보낸 헤더를 캡처하지는 않았고, httptools에서 본문이 비는 정확한 경로도 확인하지 않았습니다. 확인한 것은 **같은 요청이 httptools에서는 빈 본문, h11에서는 정상**이라는 비교까지입니다.

## 결정해야 했던 것

> **질문:** Spring이 호출하는 FastAPI 모듈에서 Uvicorn이 h11로 요청을 읽게 하려면, (1) 어디를 바꿀 것인가(Spring 클라이언트, Uvicorn 실행 옵션, 설치 의존성), (2) 그 설정이 환경이 바뀌어도 유지되게 하려면 무엇을 고정할 것인가.

## 검토한 선택지

아래는 작업 중 실제로 시도하거나 검토한 것입니다.

| 선택지 | 장점 | 단점 | 이 프로젝트에서 |
| --- | --- | --- | --- |
| Spring 클라이언트를 바꾸기 (`SimpleClientHttpRequestFactory`, 또는 JDK 클라이언트를 `HTTP_1_1`로 고정) | 업그레이드 시도 자체를 없앰 | 호출하는 클라이언트마다 설정이 필요하고, 파서 차이라는 원인을 가린다 | Teammate에서 실험했다가 원인이 섞인다고 보고 되돌림. Calainder에도 넣었다가 커밋 전에 되돌림 |
| 버전을 Calainder에 맞춰 고정 (`fastapi==0.124.0`, `uvicorn[standard]==0.38.0`) | 설치 시점에 따른 차이를 없앰 | `[standard]`가 그대로라 httptools도 그대로 설치됨 | 다시 설치해도 422가 그대로였음. 버전이 원인이 아니라는 근거가 됨 |
| `uvicorn[standard]` 유지 + `--http h11` | 의존성을 건드리지 않고, 파서가 명시적으로 보임 | 실행 명령(Dockerfile, 로컬 실행)마다 옵션을 붙여야 하고, 빠뜨리면 다시 `auto` | 원인 확인에 쓰고, Teammate v1.0.0 Dockerfile에 넣어 배포([#1](https://github.com/gasic37200/teammate/pull/1)) |
| **`uvicorn`만 설치** | httptools가 없으니 `auto`가 항상 h11. 고칠 곳이 `requirements.txt` 한 줄 | `[standard]`의 성능·WebSocket 의존성을 잃음 | **채택.** Calainder [PR #10](https://github.com/gasic37200/Calainder/pull/10), Teammate 로컬 커밋 |

**돌아보면** 비교해 볼 만한 것이 하나 더 있습니다. `uvicorn`만 설치하면서 `--http h11`도 함께 명시하는 방법입니다. 누군가 나중에 `[standard]`를 다시 넣어도 파서가 바뀌지 않습니다. 당시에는 옵션을 빼는 쪽으로 정해 검토하지 않았습니다.

## 이 방법을 고른 이유

- **기준 1(재현성):** `auto`의 기준은 "httptools가 import되는가"뿐이다. 의존성 목록에서 httptools를 빼면 Dockerfile을 어떻게 쓰든, 로컬에서 어떤 명령으로 띄우든 h11이 된다.
- **기준 2(변경 범위):** 고치는 곳이 `requirements.txt`의 `uvicorn[standard]` → `uvicorn` 한 줄이다. `--http h11`은 Dockerfile `CMD`와 로컬 실행 명령 양쪽에 붙여야 했고, 로컬에서 빠뜨려 다시 헤맬 수 있었다. Spring 코드는 바꾸지 않는다.
- **기준 3(두 프로젝트 통일):** 같은 정리를 Calainder의 AI 모듈과 크롤러 모듈, Teammate AI 모듈에 똑같이 적용했다. 공용 `feedback-api`는 이미 `uvicorn`만 쓰고 있어 바꿀 것이 없었다.
- **잃는 것이 작다:** 세 모듈 모두 WebSocket을 쓰지 않아, `[standard]`가 더해 주는 의존성 중 필요한 것이 없다.

## 구현 코드

**처음 배포한 방식 — 실행 옵션으로 파서 지정** (Teammate v1.0.0, [#1](https://github.com/gasic37200/teammate/pull/1))

```dockerfile
# teammate-ai-grading/Dockerfile
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010", "--http", "h11"]
```

**바꾼 방식 — 의존성에서 httptools 빼기** (Calainder [PR #10](https://github.com/gasic37200/Calainder/pull/10), Teammate 로컬 커밋 `45b72f9`)

```diff
 # requirements.txt
 fastapi
-uvicorn[standard]
+uvicorn
 python-dotenv
 openai
 python-multipart
```

```diff
 # teammate-ai-grading/Dockerfile
-CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010", "--http", "h11"]
+CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
```

## 구현하며 부딪힌 것

처음에는 422를 보고 요청 형식부터 의심해 `Content-Type`을 명시하고 Gradle을 다시 빌드했습니다. 그 뒤 FastAPI 검증 전에 원본 본문을 찍어 `raw body: b''`를 확인했고, Spring 전송 로그(`bodyLength=28`)와 비교해 본문이 Uvicorn이 읽는 단계에서 빈다는 것을 알았습니다. 정상이던 Calainder와 설치 패키지를 비교한 것이 httptools를 찾은 계기였습니다.

의존성을 바꾼 것만으로는 이미 만들어진 이미지가 바뀌지 않습니다. 그래서 운영 서버에서 이미지를 캐시 없이 다시 빌드하는 절차(`docker compose build --no-cache`)를 PR 본문 참고 사항에 남겼습니다.

## 검증

- 로컬: Spring 코드를 바꾸지 않고 AI 모듈만 `--http h11`로 띄우자, 같은 개발자 평가 요청이 422 없이 처리됐다. 파서 하나만 바꾼 비교라 원인 확인이 됐다.
- Calainder: 운영 서버에서 AI 컨테이너 안 직접 호출은 `200`인데 Spring을 거치면 본문이 비는 같은 증상이 나와, 이 결정을 [PR #10](https://github.com/gasic37200/Calainder/pull/10)으로 적용해 병합했다.
- 확인하지 못한 것: 의존성 정리 후 Calainder 이미지에서 `pip show httptools`로 빠진 것을 확인한 기록과, 그 뒤 Spring 경유 요청 결과는 남기지 않았다. 웹 서버 → AI 모듈 요청이 본문까지 전달되는지 보는 자동 테스트도 없다.

## 감수한 것과 다음

- **성능.** httptools 대신 순수 Python h11을 쓴다. 지금 요청 수에서는 문제가 없다고 봤지만 측정한 값은 없다.
- **버전 미고정.** 이 일은 버전 없는 `requirements.txt`가 설치 시점마다 다른 환경을 만든 데서 시작됐다. 파서는 고정했지만 버전은 아직 고정하지 않았다. 다음에 고정한다.
- **Teammate 원격 미반영.** Teammate의 변경은 로컬 커밋으로만 있어, 원격 저장소에는 v1.0.0의 `uvicorn[standard]` + `--http h11`이 남아 있다. 이 상태도 h11을 쓰므로 동작은 같다.
- **되돌릴 조건.** WebSocket이나 httptools의 성능이 필요해지면 `uvicorn[standard]`로 돌아가고, 그때는 `--http h11`을 실행 명령에 명시한다.

## 배운 점

- Uvicorn의 기본값 `--http auto`는 설치된 패키지로 파서를 고른다. 실행 명령이 같아도 설치 상태가 다르면 다른 서버가 된다.
- 동작을 정하는 것이 "설치 여부"라면, 실행 옵션보다 의존성 목록에서 정하는 편이 빠뜨릴 곳이 적다.
- 원인을 확인할 때는 한 번에 하나만 바꾼다. Spring 클라이언트 실험을 되돌리고 파서만 바꿨기 때문에 원인이 섞이지 않았다.
