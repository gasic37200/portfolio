---
title: "JWT로 인증하는 서버에 SSE 실시간 알림 붙이기"
summary: "헤더로 JWT를 보내는 서버에 SSE를 붙이며 막힌 세 곳(브라우저 EventSource, 서블릿 비동기 디스패치, Nginx)을 어떤 원리로 막히는지부터 정리하고, 각각 어떤 방법을 골랐는지 기록했습니다."
date: "2026-10-18"
tags:
- 설계
- Spring Security
- SSE
projects: ["replant"]
decision:
  question: "Authorization 헤더로 JWT를 받는 서버에서, 로그인한 회원에게만 SSE 실시간 알림을 어떻게 보낼까"
  choice: "브라우저는 EventSource 대신 fetch 스트림으로 연결해 헤더에 토큰을 싣고, 서버는 첫 요청에서만 JWT를 검사한 뒤 그 연결의 비동기 디스패치(DispatcherType.ASYNC)는 통과시킨다. 연결은 토큰 수명과 같은 30분 뒤 닫혀 다시 인증받는다."
  reasons:
    - "토큰을 URL에 싣지 않아 서버·프록시 로그와 브라우저 기록에 남지 않는다."
    - "구독 경로는 그대로 인증이 필요하다. 풀어 준 것은 이미 인증을 통과한 연결 안에서만 생기는 비동기 디스패치뿐이다."
    - "연결 수명을 토큰 수명(30분)과 맞춰, 만료된 토큰으로 계속 알림을 받는 일이 없다."
    - "서버는 안 읽은 알림 수만 보내고 원본은 DB에서 다시 조회해, 연결이 끊겨도 다시 연결하면 맞춰진다."
  tradeoff: "연결 목록을 서버 메모리에 두어 서버 1대를 전제로 한다. 여러 대로 늘리면 Redis Pub/Sub 같은 장치가 필요하다. 끊긴 연결에 ping을 보낼 때 나는 Broken pipe 예외가 ERROR 로그로 남는 문제도 아직 정리하지 못했다."
---

> RePlant Market의 알림 배지는 처음에 화면이 안 읽은 알림 수를 조회하는 방식이었습니다([#176](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_BE/issues/176)). 이를 서버가 알림이 생길 때마다 밀어 주는 SSE로 바꾸면서([#177](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_BE/issues/177), 프론트 [#23](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_FE/pull/23), Nginx [#209](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_BE/issues/209)), **"헤더에 JWT를 싣는 인증"과 SSE가 세 군데서 맞지 않았습니다.** 구현은 AI와 함께 했기 때문에, 이 글은 각 지점이 **왜** 막히는지부터 정리합니다.

## 배경과 제약

- **인증은 `Authorization: Bearer <JWT>` 헤더다.** 서버는 세션 없이(stateless) 요청마다 헤더의 토큰을 검사한다. Access 토큰 수명은 30분이다.
- **알림은 Kafka 이벤트로 만들어진다.** 주문·배송 이벤트를 받으면 알림을 DB에 저장하고, 그 회원에게 알린다.
- **서버는 한 대이고 앞에 Nginx가 있다.**
- **한 회원이 탭을 여러 개 열 수 있다.**

결정 기준은 네 가지로 잡았습니다.

1. **토큰 노출** — 토큰이 URL, 로그, 브라우저 기록에 남지 않는다.
2. **인증 규칙** — 구독 경로를 포함해 기존 인증 규칙을 약하게 만들지 않는다.
3. **토큰 수명** — 연결이 토큰 수명보다 오래 살아 만료된 토큰으로 알림을 받는 일이 없다.
4. **실시간성** — 프록시를 거쳐도 알림이 바로 오고, 끊겨도 다시 맞춰진다.

## 먼저 알아야 할 원리

### SSE는 끝나지 않는 HTTP 응답이다

SSE(Server-Sent Events)는 새로운 프로토콜이 아니라 **응답을 끝내지 않고 열어 둔 HTTP 응답**입니다. `Content-Type: text/event-stream`으로 응답을 시작한 뒤, 서버가 아래 형식의 글을 필요할 때마다 이어서 씁니다.

```text
event: unread
data: 3

: ping
```

`event:`가 이벤트 이름, `data:`가 값이고, **빈 줄이 이벤트 하나의 끝**입니다. `:`로 시작하는 줄은 주석이라 클라이언트가 무시합니다. 서버 → 브라우저 한 방향만 필요한 알림에는 양방향인 WebSocket보다 단순합니다.

### 브라우저의 `EventSource`는 헤더를 붙일 수 없다

브라우저가 SSE용으로 주는 `EventSource`는 URL만 받고, **요청 헤더를 정할 수 없습니다.** 그래서 `Authorization` 헤더로 인증하는 서버에 연결하면 토큰이 없어 401이 납니다. 이것이 첫 번째 막힘입니다.

### Spring의 `SseEmitter`는 요청을 비동기로 바꾼다

컨트롤러가 `SseEmitter`를 반환하면 Spring MVC는 **서블릿 비동기 처리**를 시작합니다.

1. 처음 요청(디스패치 타입 `REQUEST`)이 필터와 컨트롤러를 지나 `SseEmitter`를 돌려준다.
2. 요청을 처리하던 스레드는 반납되고, 응답은 열린 채로 남는다.
3. 나중에 `emitter.send()`나 종료가 일어나면, 서블릿 컨테이너가 **같은 요청을 `ASYNC` 디스패치로 한 번 더 처리**한다. 이때 필터 체인을 다시 지난다.

### 그런데 JWT 필터는 `ASYNC` 디스패치에서 돌지 않는다

JWT 필터는 `OncePerRequestFilter`를 상속합니다. 이름 그대로 **요청당 한 번만** 돌도록 만든 필터라, 기본 설정에서는 `ASYNC` 디스패치를 건너뜁니다. 그리고 이 서버는 세션이 없어서, 인증 정보를 다른 곳에서 불러올 수도 없습니다.

반면 Spring Security의 인가 규칙(`authorizeHttpRequests`)은 `ASYNC` 디스패치에도 적용됩니다. 결과적으로 **인증 정보가 비어 있는 상태로 "로그인이 필요하다"는 규칙에 걸려** 401·403이 납니다. 연결은 성공하는데, 데이터를 보내는 순간 막히는 것입니다. 이것이 두 번째 막힘입니다. 실제로 겪기 전에 구현하며 미리 확인했습니다.

### Nginx는 기본적으로 응답을 모았다가 넘긴다

Nginx는 뒤쪽 서버의 응답을 **버퍼에 모았다가** 클라이언트에 넘기고, 응답이 **60초 동안 조용하면** 연결을 끊습니다. 둘 다 계속 흘러야 하는 SSE와 맞지 않습니다. 세 번째 막힘입니다.

## 결정해야 했던 것

> **질문:** 헤더로 토큰을 싣는 인증을 유지하면서, (1) 브라우저가 어떻게 토큰을 실어 연결하고, (2) 서버는 열린 연결로 데이터를 보낼 때 인증을 어떻게 다루며, (3) 토큰이 만료되면 연결은 어떻게 되는가.

## 검토한 선택지

### 브라우저에서 연결하는 방법

당시에는 `EventSource`가 헤더를 못 붙인다는 것을 확인하고 바로 fetch 스트림으로 갔습니다. 아래 두 대안은 당시 검토한 기록이 없고, **지금 기준으로 비교**한 것입니다.

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| `EventSource` 그대로 | 브라우저 기본 기능, 재연결 내장 | 헤더를 못 붙여 401 | 불가 |
| `EventSource` + URL에 `?token=` | 코드 변경이 작음 | 토큰이 서버·프록시 접근 로그와 브라우저 기록에 남음 (기준 1 위반) | 쓰지 않음 |
| SSE 경로만 쿠키 인증으로 | `EventSource`가 쿠키는 자동으로 보냄 | 인증 방식이 두 가지가 됨, CSRF 등 따질 것이 늘어남 | 쓰지 않음 |
| **fetch로 스트림을 직접 읽기** | 헤더에 토큰을 실을 수 있음, 401을 직접 처리할 수 있음 | 이벤트 파싱과 재연결을 직접 구현해야 함 | **채택** |

### 서버가 `ASYNC` 디스패치를 다루는 방법

| 선택지 | 판단 |
| --- | --- |
| 그대로 두기 | 데이터를 보낼 때마다 401·403. 불가 |
| JWT 필터가 `ASYNC` 디스패치에서도 다시 돌게 하기 | 당시 검토하지 않았다. 처음 요청에 남아 있는 헤더로 같은 토큰을 보낼 때마다 다시 검사하는 방식이라, 지금 보면 함께 비교해 볼 만하다 |
| **`ASYNC` 디스패치만 통과시키기** | 채택. `ASYNC` 디스패치는 외부에서 보낼 수 있는 요청이 아니라, 처음 `REQUEST`에서 JWT 검사를 통과해 열린 연결 안에서만 생긴다 |

### SSE로 무엇을 보낼지

| 선택지 | 판단 |
| --- | --- |
| 알림 본문을 SSE로 보내기 | 연결이 끊긴 사이의 알림을 놓친다 |
| **안 읽은 알림 수만 보내고, 목록은 화면이 DB에서 다시 조회** | 채택. 원본이 DB에 있어 다시 연결하면 그 순간의 수로 맞춰진다 |

## 이 방법을 고른 이유

- **기준 1(토큰 노출):** fetch는 헤더를 정할 수 있어 토큰이 URL에 들어가지 않는다. 기존 API 호출과 같은 방식으로 인증한다.
- **기준 2(인증 규칙):** 구독 경로 `/api/v1/notifications/subscribe`는 공개 경로 목록에 넣지 않아 그대로 인증이 필요하다. 풀어 준 것은 `DispatcherType.ASYNC` 하나이고, 이 디스패치는 인증을 통과해 열린 연결에서만 생긴다. 그래서 인증을 우회하는 입구가 새로 생기지 않는다.
- **기준 3(토큰 수명):** SSE 연결은 처음에 한 번만 인증한다. 그래서 연결 타임아웃을 Access 토큰 수명과 같은 30분으로 두었다. 30분이 지나면 서버가 연결을 닫고, 프론트가 다시 연결하면서 필요하면 토큰을 재발급받아 **다시 검사받는다.**
- **기준 4(실시간성):** 서버는 `X-Accel-Buffering: no` 헤더로 Nginx에 "이 응답은 모으지 말라"고 알리고, 30초마다 ping 주석을 보내 조용한 연결이 끊기지 않게 했다. 운영 Nginx에는 이 경로만 버퍼링을 끄고 타임아웃을 1시간으로 고정했다. 보내는 것은 안 읽은 수뿐이라, 끊겼다 이어져도 첫 이벤트로 현재 수가 다시 온다.

## 구현 코드

**프론트 — fetch 스트림으로 연결** (`src/api/sse.js`, 프론트 [#23](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_FE/pull/23))

```js
// 끊긴 뒤 다시 연결하기까지 기다리는 시간 (실패가 이어질수록 늘림)
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

const response = await fetch(url, {
  headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getAccessToken()}` },
  credentials: 'include',
  signal: controller.signal,
});
if (response.status === 401) {          // 토큰 만료
  if (reissuedOnce) return;             // 재발급 직후에도 401이면 멈춤 (무한 반복 방지)
  reissuedOnce = true;
  try { await reissueAccessToken(); } catch { return; } // 재발급 실패 = 로그아웃 상태
  connect(); return;
}
const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
// "event: 이름" / "data: 값" / 빈 줄 = 이벤트 하나, ":"로 시작하는 줄(ping)은 무시
```

`EventSource`가 해 주던 재연결을 직접 만들었습니다. 끊기면 1·2·5·10·30초 간격으로 다시 연결하고, 반환한 함수를 부르면 `abort()`로 연결을 끊고 재연결도 멈춥니다.

**서버 — 비동기 디스패치만 통과** (`SecurityConfig`)

```java
.authorizeHttpRequests(auth -> auth
    // SSE 응답을 보내는 비동기 디스패치는 처음 요청에서 이미 인증을 거쳤으므로 통과시킨다
    // (JWT 필터는 비동기 디스패치에서 다시 돌지 않아 막으면 알림 전송 때 401·403이 남)
    .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
    .requestMatchers(PUBLIC_PATHS).permitAll()   // 구독 경로는 여기에 없다
```

**서버 — 구독과 연결 목록**

```java
// NotificationController
@GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter subscribe(@AuthenticationPrincipal AuthMember member, HttpServletResponse response) {
    response.setHeader("X-Accel-Buffering", "no");      // Nginx가 응답을 모아 두지 않게
    return notificationService.subscribe(member.memberId());
}

// NotificationService
SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);    // 30분 = Access 토큰 수명
sseRegistry.add(memberId, emitter, unreadCount(memberId)); // 연결하자마자 현재 수 전송

// NotificationSseRegistry: 회원별 연결 목록 (탭 여러 개)
private final Map<Long, List<SseEmitter>> emitters = new ConcurrentHashMap<>(); // 목록은 CopyOnWriteArrayList

@Scheduled(fixedRate = 30_000)
void heartbeat() { /* 모든 연결에 SseEmitter.event().comment("ping") */ }
// 종료·타임아웃·에러, 그리고 send() 실패(IOException·IllegalStateException)는 브라우저가 끊은 것 → 목록에서 제거
```

알림이 만들어지는 흐름은 **Kafka 이벤트 → 알림 DB 저장 → 커밋 후 그 회원의 모든 탭에 `event: unread / data: N`** 입니다.

**운영 Nginx — 이 경로만 따로** ([#209](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_BE/issues/209))

```nginx
location = /api/v1/notifications/subscribe {   # "=" 정확 매칭이라 /api 정규식 location보다 먼저 적용
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;                     # 연결을 계속 유지하려면 HTTP/1.1
    proxy_set_header Connection "";
    proxy_buffering off;                        # 모았다가 넘기지 않음
    proxy_cache off;
    gzip off;                                   # 압축도 버퍼링을 일으킴
    proxy_read_timeout 1h;                      # 60초 기본 타임아웃 대신
}
```

30초 ping이 60초 기본 타임아웃보다 짧아서 이 설정 전에도 동작은 했습니다. 기본값에 기대지 않도록 명시적으로 고정한 것입니다.

## 검증

- 테스트 9개를 추가했다([#177](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_BE/issues/177)). 전체 521개 통과.
  - 연결하자마자 현재 수를 보낸다. 탭 두 개가 모두 받고 다른 회원은 받지 않는다. 끊긴 연결은 목록에서 빠진다.
  - 알림 저장·읽음·모두 읽음이 **커밋된 뒤에만** 보낸다(Testcontainers).
  - 구독 응답이 비동기로 시작되고 `X-Accel-Buffering` 헤더와 `event: unread`를 보낸다.
- 운영 Nginx 설정은 반영 전 `nginx -t`로 검사했다([#209](https://github.com/prgrms-be-adv-devcourse/beadv8_8_JustCommit_BE/issues/209)).
- 실제 보안 필터 체인을 모두 거친 `ASYNC` 디스패치 흐름을 자동 테스트로 확인하지는 못했다. PR에도 "로컬·배포 환경에서 확인 필요"로 남겼다.

## 감수한 것과 다음

- **서버 1대 전제.** 연결 목록이 서버 메모리의 `Map`에 있다. 서버를 여러 대로 늘리면 다른 서버에 붙은 탭에는 알림이 가지 않는다. 그때는 Redis Pub/Sub처럼 서버끼리 알림을 나누는 장치가 필요하다.
- **Broken pipe가 ERROR 로그로 남는다.** 탭을 닫거나 새로고침해 끊긴 연결에 ping을 보내면 `AsyncRequestNotUsableException`이 나고, 공통 예외 처리기가 이를 ERROR로 기록한다. 기능에는 영향이 없지만 로그 레벨 정리는 아직이다.
- **필터 체인 전체를 거치는 테스트.** `ASYNC` 디스패치 허용이 실제로 401·403을 막는지 보안 필터를 포함한 통합 테스트로 고정하는 것이 다음 과제다.

## 배운 점

- `SseEmitter`를 반환하면 같은 요청이 `ASYNC` 디스패치로 다시 필터를 지난다. "요청당 한 번" 필터와 "모든 디스패치에 적용되는" 인가 규칙이 만나는 곳에서 인증이 비게 된다.
- 인증 규칙을 풀 때는 **무엇이 그 입구로 들어올 수 있는지**를 먼저 따진다. `ASYNC` 디스패치는 외부에서 만들 수 없어서 풀어도 새 입구가 생기지 않았다.
- 연결을 오래 여는 기능은 인증 수명과 연결 수명을 맞춰야 한다.
- 보내는 내용을 "신호"로 줄이고 원본을 DB에 두면, 끊김과 재연결을 따로 복구하지 않아도 된다.
