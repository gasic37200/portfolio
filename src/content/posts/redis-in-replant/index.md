---
title: "Redis를 처음부터 다시: TTL, eviction, 영속성, 그리고 RePlant에서 쓴 세 군데"
summary: "Redis가 왜 빠른지, 메모리가 차면 무엇을 지우는지, 꺼져도 데이터가 남는지를 정리했습니다. 팀 프로젝트 RePlant에서 운영 Redis를 직접 띄우고 키·TTL 규칙을 정하며 내린 결정과, Redis를 쓰지 않기로 한 것들도 함께 적었습니다."
date: "2026-10-13"
tags:
- Redis
- 인프라
- 백엔드 기초
---

> **한눈에 보기**
>
> - Redis는 **메모리에 두는 키-값 저장소**다. 명령을 **한 줄로 세워 하나씩** 실행하므로 명령 하나는 중간에 끼어들 틈이 없다.
> - 메모리가 차면 **지울지(eviction), 거절할지(noeviction)** 를 정해야 한다. 캐시라면 지워도 되지만, 인증번호·토큰처럼 **원본이 Redis에만 있으면 지우면 안 된다.**
> - [RePlant Market](/projects/replant)에서 Redis를 쓴 곳은 **이메일 인증, Refresh 토큰, 결제 대기 표시** 세 군데뿐이다.
> - 나는 팀 인프라를 맡아 **운영 Redis를 직접 띄우고 키·TTL 규칙을 정했다.** `noeviction`, 세 겹 차단, AOF가 그 결정이다.
> - 무엇을 Redis에 **넣지 않을지**도 결정이었다. Access 토큰 검사, 소셜 로그인 state, 주문서 잠금은 Redis 밖에 두었다.

## 1. Redis가 뭔가

Redis는 **데이터를 메모리(RAM)에 두는 키-값 저장소**입니다. `auth:email:a@b.com` 같은 **키**로 값을 넣고 꺼냅니다. 테이블도, SQL도 없습니다.

### 왜 빠른가

- **디스크가 아니라 메모리**에서 읽고 씁니다. 디스크를 거치지 않으니 한 번 읽는 데 걸리는 시간이 훨씬 짧습니다.
- **구조가 단순합니다.** 키로 바로 값을 찾습니다. SQL을 해석하거나 실행 계획을 세우는 단계가 없습니다.
- **명령을 한 스레드가 차례대로 처리합니다.** 스레드끼리 자원을 다투지 않아서 잠금(lock) 비용이 없습니다. 네트워크 입출력은 여러 연결을 한꺼번에 기다리는 방식(I/O 멀티플렉싱)으로 처리합니다.

### 명령 하나는 원자적이다

명령 실행이 **한 줄 서기**라서, 명령 하나가 실행되는 동안 다른 명령이 끼어들지 못합니다. 그래서 **"없으면 저장"(`SET NX`)이나 "꺼내면서 삭제"(`GETDEL`)를 명령 하나로 보내면 동시에 요청이 와도 한쪽만 성공**합니다.

반대로 **명령 두 개로 나누면 그 사이에 다른 요청이 끼어들 수 있습니다.** "조회 → 확인 → 삭제"를 따로 보내면 두 요청이 둘 다 조회에 성공할 수 있습니다. RePlant에서 Refresh 재발급을 `GETDEL`로 한 이유가 이것입니다(4장).

### 주요 자료형

값에 문자열만 넣을 수 있는 게 아닙니다. 키 하나에 아래 구조를 통째로 담을 수 있습니다.

| 자료형 | 모양 | 대표 명령 | 쓰임새 |
| --- | --- | --- | --- |
| **String** | 값 하나 (문자열·숫자) | `SET`, `GET`, `INCR`, `GETDEL` | 인증번호, 토큰, 카운터, 캐시한 JSON |
| **Hash** | 필드-값 묶음 | `HSET`, `HGET` | 객체 하나(회원 프로필 등)를 필드별로 저장 |
| **List** | 순서 있는 목록 | `LPUSH`, `RPOP`, `LRANGE` | 최근 본 상품, 간단한 작업 큐 |
| **Set** | 중복 없는 집합 | `SADD`, `SISMEMBER` | 좋아요 누른 회원, 태그 |
| **Sorted Set** | 점수로 정렬된 집합 | `ZADD`, `ZRANGE` | 랭킹, 시간순 목록 |

RePlant의 세 저장소는 모두 Spring의 `StringRedisTemplate`을 썼고, **String 자료형만** 썼습니다. 인증번호·토큰·표시값처럼 "키 하나에 값 하나"면 충분했기 때문입니다.

## 2. TTL과 만료, 메모리가 찼을 때

### TTL: 정해진 시간이 지나면 키가 사라진다

**TTL(Time To Live)** 은 키의 남은 수명입니다. `SET key value EX 300`처럼 저장하면 300초 뒤 키가 사라집니다. 인증번호처럼 **"잠깐만 필요한 값"을 지우는 코드를 따로 짤 필요가 없습니다.**

만료된 키는 두 가지 방식으로 지워집니다.

- **누군가 그 키를 읽으려 할 때** 만료됐는지 보고 지웁니다.
- **주기적으로 TTL 있는 키를 일부 골라** 만료된 것을 지웁니다.

만료 시각은 **"지금부터 몇 초"가 아니라 절대 시각**으로 저장됩니다. 그래서 Redis가 꺼져 있던 시간도 흐른 것으로 칩니다(3장에서 다시 나옵니다).

### maxmemory와 eviction 정책

메모리는 디스크보다 작습니다. `maxmemory`로 상한을 정하면, **상한에 도달한 상태에서 새 쓰기가 들어올 때** 무엇을 할지를 `maxmemory-policy`로 고릅니다. 이걸 **eviction(축출) 정책**이라고 합니다.

| 정책 | 지우는 대상 | 기준 | 맞는 경우 |
| --- | --- | --- | --- |
| `noeviction` | 안 지움 | 쓰기를 **오류로 거절** (읽기·삭제는 됨) | 지워지면 안 되는 데이터 |
| `allkeys-lru` | 모든 키 | 가장 오래 **안 쓴** 키 | 일반적인 캐시 |
| `allkeys-lfu` | 모든 키 | 가장 **덜 자주** 쓴 키 | 인기 키가 뚜렷한 캐시 |
| `allkeys-random` | 모든 키 | 무작위 | 접근 패턴이 고른 캐시 |
| `volatile-lru` | TTL 있는 키만 | 가장 오래 안 쓴 키 | 캐시와 영구 데이터를 한 Redis에 섞을 때 |
| `volatile-lfu` | TTL 있는 키만 | 가장 덜 자주 쓴 키 | 위와 같음 |
| `volatile-ttl` | TTL 있는 키만 | 만료가 **가장 가까운** 키 | 곧 사라질 키부터 버려도 될 때 |

`volatile-*` 정책은 **지울 후보(TTL 있는 키)가 없으면 `noeviction`처럼 쓰기를 거절**합니다.

![메모리가 찼을 때 캐시는 allkeys-lru로 지우고, 임시 저장소는 noeviction으로 쓰기를 거절하는 흐름을 비교한 그림](/images/posts/redis-in-replant/01-eviction-choice.svg)

### 캐시로 쓸 때 vs 임시 저장소로 쓸 때

고르는 기준은 하나입니다. **"이 키가 지워지면 되살릴 원본이 있는가?"**

- **캐시**: 원본이 DB에 있습니다. 지워지면 DB에서 다시 읽으면 됩니다. 느려질 뿐 틀리지는 않습니다. → `allkeys-lru`나 `allkeys-lfu`
- **임시 저장소**: 원본이 Redis에만 있습니다. Refresh 토큰이 지워지면 **사용자는 이유 없이 로그아웃**됩니다. 오류 로그도 남지 않습니다. → `noeviction`

`noeviction`의 대가는 **TTL 없는 키가 쌓이면 언젠가 쓰기가 막힌다**는 것입니다. 그래서 **모든 키에 TTL을 반드시 건다**는 규칙이 같이 따라옵니다.

## 3. 영속성: RDB와 AOF

메모리는 전원이 꺼지면 비워집니다. Redis는 디스크에 남기는 방법을 두 가지 제공합니다.

| | RDB (스냅숏) | AOF (명령 기록) |
| --- | --- | --- |
| 무엇을 남기나 | 특정 시점의 **메모리 전체 사진** | 들어온 **쓰기 명령을 순서대로** 이어 붙인 기록 |
| 언제 쓰나 | 설정한 간격마다 (예: N초 동안 M개 변경 시) | 쓰기마다 기록, 디스크 반영(fsync)은 기본 **1초마다** |
| 잃을 수 있는 양 | 마지막 스냅숏 **이후 전부** (분 단위) | 기본 설정에서 **최대 약 1초** |
| 파일 크기·재시작 | 작고, 다시 띄울 때 빠름 | 크고, 다시 띄울 때 명령을 재생 (주기적으로 압축) |
| 켜는 법 | `save` 설정 | `appendonly yes` |

둘 다 켜 둘 수도 있습니다. 둘 다 켜져 있으면 **재시작할 때 더 완전한 AOF로 복구**합니다.

RePlant 운영 Redis는 `appendonly yes`로 AOF를 켜고, `/data`를 Docker 볼륨에 연결했습니다. 컨테이너를 지우고 다시 만들어도 볼륨의 AOF 파일에서 키가 돌아옵니다.

## 4. RePlant에서 Redis를 쓴 곳

[RePlant Market](/projects/replant)은 직접 키운 식물을 사고파는 C2C 마켓 팀 프로젝트입니다. 나는 팀 인프라를 맡아 **운영 Redis 구성과 Redis 키·TTL 규칙 문서**(`docs/infrastructure-todo.md`)를 PR #10에서 만들었습니다. 그 규칙을 따라 **저장소 클래스를 구현한 것은 팀원**입니다. 팀원 코드 주석에 내가 정한 규칙이 그대로 적혀 있습니다.

```java
// EmailVerificationRedisStore.java
// 이메일 인증 관련 Redis 키 관리(키규칙 도메인:용도:식별자)
```

### 내가 정한 키 규칙

`docs/infrastructure-todo.md`에 적은 규칙은 네 줄입니다.

1. 키 이름은 **`도메인:용도:식별자`**, 소문자, 콜론으로 구분한다. → `auth:email:cooldown:{email}`만 봐도 무엇인지 안다.
2. **모든 키에 TTL을 건다.** → `noeviction`이라서 TTL 없는 키는 영원히 메모리를 차지한다.
3. **이메일은 소문자로 바꾼 뒤** 키를 만든다. → `A@b.com`과 `a@b.com`이 다른 키가 되면 재발송 제한이 뚫린다.
4. **토큰 원문 대신 해시**를 저장한다. → Redis 내용이 보여도 그 값으로 바로 로그인할 수 없다.

### 실제 코드가 쓰는 키

코드 전체에서 Redis를 직접 부르는 곳은 세 클래스뿐입니다.

![이메일 인증, Refresh 토큰, 주문 결제 대기 세 기능이 각 저장소 클래스를 거쳐 어떤 키와 TTL을 쓰는지, 그리고 Redis에 두지 않은 것들을 정리한 그림](/images/posts/redis-in-replant/02-replant-redis-map.svg)

| 키 | 값 | TTL | 명령 | 저장소 클래스 |
| --- | --- | --- | --- | --- |
| `auth:email:{email}` | 6자리 인증번호 | 5분 | `SET EX`, `GET`, `DEL` | `EmailVerificationRedisStore` |
| `auth:email:verified:{email}` | `"true"` | 30분 | `SET EX`, `EXISTS`, `DEL` | 〃 |
| `auth:email:cooldown:{email}` | `"1"` | 60초 | `SET NX EX`, `TTL`, `DEL` | 〃 |
| `auth:refresh:{SHA-256 해시}` | 회원 ID | 1일 | `SET EX`, `GETDEL`, `DEL` | `RefreshTokenRedisStore` |
| `order:payment:ttl:{orderId}` | `"1"` | 결제 마감까지 남은 시간 | `SET EX`, `DEL` | `OrderPaymentTtlStore` |

![이메일 인증의 발송·확인·가입 단계와 Refresh 토큰의 로그인·재발급·로그아웃 단계에서 보내는 Redis 명령을 나란히 그린 그림](/images/posts/redis-in-replant/03-command-flows.svg)

### 이메일 인증: 발송, 확인, 재발송 제한

발송할 때 **재발송 제한 키를 먼저 잡습니다.** `setIfAbsent`는 Redis의 `SET ... NX EX`로, 키가 없을 때만 저장합니다.

```java
// EmailVerificationRedisStore.java
// 키 없을 때만 저장(SET NX EX), 저장 성공 = 발송 가능, 실패 = 제한
Boolean saved = redisTemplate.opsForValue().setIfAbsent(key(COOLDOWN_KEY, email), "1", ttl);
```

"키가 있는지 확인 → 없으면 저장"을 두 명령으로 나누면, 버튼을 연타한 두 요청이 둘 다 "없다"를 보고 메일을 두 번 보낼 수 있습니다. `SET NX`는 명령 하나라서 **둘 중 하나만 성공**합니다. 실패한 쪽에는 `TTL`로 남은 초를 알려 줍니다.

그다음 인증번호를 `SET EX 300`으로 저장합니다. 재발송하면 **같은 키에 덮어써서 이전 번호는 자동으로 무효**가 됩니다. 메일 발송이 실패하면 두 키를 지워 바로 다시 시도할 수 있게 합니다.

확인 단계에서는 번호가 맞으면 번호 키를 지우고 `verified` 키를 30분짜리로 남깁니다. 회원가입은 이 키가 있는지만 보고, 가입이 끝나면 지웁니다. 이메일은 발송·확인·가입 세 곳 모두 `trim().toLowerCase(Locale.ROOT)`로 같은 방식으로 정규화합니다.

### Refresh 토큰: 저장, 재발급(회전), 로그아웃

로그인(일반·소셜·소셜 가입 완료)하면 32바이트 랜덤 토큰을 만들고, **SHA-256 해시를 키로** 회원 ID를 저장합니다. 원문은 쿠키로만 내려갑니다.

```java
// RefreshTokenIssuer.java
public static final Duration REFRESH_TOKEN_TTL = Duration.ofDays(1);
```

이 상수 하나가 **Redis TTL과 쿠키 `Max-Age`에 함께** 쓰입니다(`RefreshTokenCookieFactory`의 주석: "Redis TTL과 같은 Max-Age로 발급"). 두 값이 어긋나면 "쿠키는 있는데 Redis엔 없는" 상태가 생기기 때문입니다.

재발급은 `GETDEL`로 **꺼내면서 지웁니다.**

```java
// RefreshTokenRedisStore.java
// 따로 조회 → 삭제하면 동시에 들어온 두 요청이 둘 다 통과할 수 있음 → 원자 처리로 한 번만 성공
String memberId = redisTemplate.opsForValue().getAndDelete(key(refreshToken));
```

꺼낸 회원 ID로 새 Access 토큰과 **새 Refresh 토큰**을 발급하고, 새 토큰을 다시 `SET EX 1일`로 저장합니다. 이걸 **Refresh 토큰 회전**이라고 합니다. 한 번 쓴 Refresh 토큰은 다시 쓸 수 없습니다. 로그아웃은 `DEL`로 지우고, 쿠키도 `Max-Age=0`으로 지웁니다. JWT와 회전은 [JWT를 처음부터 다시](/posts/jwt-structure)에서 더 자세히 다룹니다.

### 결제 대기 시간

주문 생성 때 지갑 결제가 바로 성공하지 못하면, 주문은 결제 대기 상태가 됩니다. 이때 `order:payment:ttl:{orderId}`를 **DB 트랜잭션이 커밋된 뒤에** 저장합니다. TTL은 "주문 생성 시각 + 10분"까지 남은 시간입니다. 재결제가 성공하면 지웁니다.

```java
// OrderPaymentTtlStore.java
// DB 만료 검사도 수행하므로 Redis 장애로 이미 확정된 주문을 실패 처리하지 않는다.
log.warn("주문 결제대기 TTL 저장 실패: orderId={}", orderId, exception);
```

여기서 중요한 점은 **실제 만료 처리를 Redis가 하지 않는다**는 것입니다. 30초마다 도는 `OrderScheduler`가 DB에서 10분 지난 결제 대기 주문을 찾아 만료시키고 상품 예약을 풉니다. 현재 코드에서 이 Redis 키를 **읽는 곳은 없습니다.** 규칙 문서에도 "만료 리스너는 주문 만료 흐름이 정해지면 구현한다"는 TODO로 남겨 두었습니다. 그래서 Redis 저장이 실패해도 경고 로그만 남기고 주문은 그대로 진행됩니다.

### 규칙 문서와 실제 코드가 다른 곳

PR #10에서 문서를 쓴 시점은 기능 구현보다 앞이었습니다. 끝난 뒤 코드와 비교하니 네 군데가 달랐습니다.

| 문서에 적은 키 | 실제 코드 |
| --- | --- |
| `order:payment:ttl:{orderId}` 값 orderId, TTL **30분** | 값 `"1"`, TTL은 **생성 후 10분**까지 남은 시간 (`PAYMENT_WINDOW = Duration.ofMinutes(10)`) |
| `auth:signup:{token}` 소셜 가입 정보, 30분 | Redis를 쓰지 않음. 소셜 신규 회원에게 **JWT 가입 토큰**을 발급 (`signup-token-expiration: 10m`) |
| `idem:{api}:{memberId}:{key}` 처리 중 30초 / 완료 24시간 | **구현되지 않음** (6장) |
| 나머지 네 키 (`auth:email:*`, `auth:refresh:*`) | 문서와 같음 |

문서를 먼저 쓰고 코드가 다른 길로 간 뒤에 **문서를 고치지 않은 것**은 아쉬운 점입니다. 키 표는 코드가 바뀌는 PR에서 같이 고치는 게 맞았습니다.

## 5. 운영 Redis 설정과 이유

운영 서버(EC2 1대)의 `docker-compose.prod.yml`에서 Redis 부분입니다. PR #10에서 내가 구성했습니다.

```yaml
# docker-compose.prod.yml
redis:
  image: redis:8-alpine
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
    --maxmemory 256mb
    --maxmemory-policy noeviction
    --appendonly yes
  ports:
    - "127.0.0.1:6379:6379"
  volumes:
    - redis-data:/data
```

![AWS 보안 그룹, 127.0.0.1 포트 바인딩, requirepass 세 겹이 운영 Redis를 감싸고 있고 같은 서버의 앱만 비밀번호로 접속하는 구조를 그린 그림](/images/posts/redis-in-replant/04-prod-redis-layers.svg)

**ElastiCache 대신 EC2 위 컨테이너** — 교육 과정 공용 AWS 계정에서 ElastiCache 같은 관리형 서비스는 허용 목록 밖이었습니다. 직접 띄우면 보안·메모리·영속성 설정을 **스스로 정하게** 됩니다. 대신 장애 대응과 백업도 내가 책임져야 합니다.

**`maxmemory 256mb` + `noeviction`** — RePlant에서 Redis는 캐시가 아니라 **인증번호·토큰을 담는 TTL 임시 저장소**였습니다. 메모리가 차서 토큰이 몰래 지워지면 "가끔 로그인이 풀린다" 같은 **재현하기 어려운 조용한 버그**가 됩니다. 그래서 지우지 말고 **쓰기 실패로 드러나게** 했습니다. 그 대가로 4장의 "모든 키에 TTL" 규칙을 만들었습니다.

**외부 차단 세 겹** — ① 보안 그룹에서 6379를 열지 않고, ② 포트를 `127.0.0.1`(서버 자신)에만 바인딩하고, ③ `requirepass`로 비밀번호를 겁니다. 서버가 한 대라 Redis만 프라이빗 서브넷으로 떼어 놓을 대상이 없었습니다. 그래서 **한 겹이 실수로 열려도 나머지가 막도록** 겹쳤습니다. 비밀번호는 커밋하지 않는 `.env`에서 읽고, 값이 없으면 `:?` 문법으로 **컨테이너가 아예 뜨지 않게** 했습니다.

**`appendonly yes` + 볼륨** — 운영 서버는 **매일 18시에 꺼지고 09시에 켜졌습니다.** 디스크에 남기지 않으면 매일 아침 모든 Refresh 토큰이 사라져 전원이 로그아웃됩니다. 스냅숏(RDB)만 쓰면 마지막 스냅숏 이후 로그인한 사람의 토큰이 사라질 수 있어서, 쓰기마다 기록하는 AOF를 켰습니다. 만료 시각은 절대 시각이라, 전날 17시에 받은 1일짜리 토큰은 다음 날 09시에도 살아 있습니다.

**연결 타임아웃 2초** — `application-prod.yml`에 따로 넣었습니다.

```yaml
# application-prod.yml
# Redis가 멈춰도 요청 스레드가 오래 묶이지 않도록 짧게 (Lettuce 기본 60초)
timeout: 2s
connect-timeout: 2s
```

로컬용 `docker-compose.yml`은 비밀번호와 메모리 상한 없이 `--appendonly yes`만 켜고 6379를 그대로 엽니다. 로컬은 내 컴퓨터 안이라 막을 외부가 없기 때문입니다.

## 6. Redis를 쓰지 않기로 한 것들

Redis가 있으면 무엇이든 넣고 싶어집니다. 하지만 **Redis에 넣는 순간 그 기능은 Redis가 살아 있어야 동작합니다.** 그래서 넣지 않은 것도 결정이었습니다.

**Access 토큰 검사** — `JwtAuthenticationFilter`는 요청마다 **서명만** 검사하고 Redis를 보지 않습니다. 요청마다 Redis를 조회하면 JWT를 써도 결국 **세션 방식**이 됩니다. 이 과정에서 "Redis에는 **서버가 기억했다가 지울 수 있어야 하는 것만** 둔다"는 기준을 배웠습니다. Refresh 토큰은 로그아웃 때 지워야 하니 넣고, Access 토큰은 30분 뒤 스스로 만료되니 넣지 않았습니다.

**소셜 로그인 state** — 네이버·카카오 로그인의 `state` 값은 Redis 대신 **서명된 쿠키**(5분)에 담았습니다. Redis가 멈춰도 소셜 로그인의 인가 단계는 진행되게 하려는 결정이었습니다.

**주문서 진입 시 상품 잠금** — 주문서 화면에 들어오면 Redis TTL로 상품을 잠그는 안을 검토했다가 **기각**했습니다. 식물은 한 개체를 한 번만 팔기 때문에, **구경만 해도 상품이 잠깁니다.** 탭을 닫아도 TTL이 끝날 때까지 풀리지 않고, Redis와 DB의 상태를 계속 맞춰야 합니다. 그래서 **결제 시점에 DB로 예약**하는 방식을 유지했습니다.

**중복 요청 방지 키(`idem:*`)** — 노션 컨벤션 문서에는 프론트의 중복 요청을 막는 `idem:{api}:{memberId}:{key}` 키(처리 중 30초, 완료 24시간)를 "확정 키"로 적어 두었습니다. 하지만 **코드에는 구현되지 않았습니다.** 계획만 하고 만들지 않은 기능입니다. 면접에서 이 키를 "썼다"고 말하면 안 됩니다.

## 면접에서 물어보면

**Q. 왜 `noeviction`으로 했나요?**
A. Redis를 캐시가 아니라 인증번호와 Refresh 토큰을 담는 임시 저장소로 썼기 때문입니다. 이 값들은 Redis에만 있어서, 메모리가 차서 지워지면 사용자가 이유 없이 로그아웃되는 조용한 버그가 됩니다. 지우는 대신 쓰기 실패로 드러나게 했고, 메모리가 계속 차지 않도록 모든 키에 TTL을 거는 규칙을 같이 만들었습니다. 캐시가 주 용도였다면 `allkeys-lru`를 골랐을 것입니다.

**Q. 왜 ElastiCache를 쓰지 않았나요?**
A. 교육 과정 공용 AWS 계정에서 관리형 서비스가 허용 목록 밖이었습니다. 그래서 EC2에 `redis:8-alpine` 컨테이너로 띄웠습니다. 덕분에 비밀번호, 메모리 상한, eviction, 영속성을 직접 정했습니다. 대신 장애 대응과 백업을 직접 책임져야 한다는 비용이 있습니다.

**Q. Redis가 죽으면 무엇이 안 되나요?**
A. 코드 기준으로 일반·소셜 로그인과 소셜 가입 완료가 안 됩니다. 로그인할 때 Refresh 토큰을 Redis에 저장하기 때문입니다. 토큰 재발급, 로그아웃, 이메일 인증번호 발송·확인, 이메일 회원가입도 안 됩니다. 반대로 이미 로그인한 사용자는 Access 토큰을 서명만으로 검사하니 만료 전까지 API를 계속 씁니다. 주문은 Redis 저장 실패를 로그만 남기고 넘어가고, 결제 대기 만료는 DB 스케줄러가 처리하니 영향이 없습니다. 연결 타임아웃을 2초로 줄여서 장애 때 요청이 60초씩 묶이지 않게 했습니다.

**Q. Refresh 재발급은 왜 `GET` 다음 `DEL`이 아니라 `GETDEL`인가요?**
A. 두 명령으로 나누면 같은 토큰으로 동시에 들어온 두 요청이 둘 다 `GET`에 성공해서 새 토큰이 두 벌 발급될 수 있습니다. Redis는 명령을 한 스레드에서 하나씩 실행하므로, `GETDEL` 한 명령은 중간에 끼어들 수 없어 한 요청만 성공합니다. 참고로 인증번호 확인은 `GET` 다음 `DEL`인데, 동시에 두 번 성공해도 결과가 "인증 완료" 하나로 같아서 문제가 되지 않습니다.

**Q. 서버가 매일 꺼졌는데 로그인이 유지됐나요?**
A. 네. `appendonly yes`로 쓰기 명령을 디스크에 기록하고 `/data`를 Docker 볼륨에 연결해서, 아침에 서버가 켜지면 Refresh 토큰이 복구됩니다. TTL은 절대 시각으로 저장되므로 꺼져 있던 시간도 수명에서 빠집니다.

**Q. Refresh 토큰을 왜 해시로 저장했나요?**
A. Redis 내용이 유출되거나 운영자가 `KEYS`로 들여다봐도, 키에 있는 것은 SHA-256 해시라 그 값으로 재발급을 요청할 수 없습니다. 비밀번호를 해시로 저장하는 것과 같은 이유입니다.

**Q. 키·TTL 규칙에서 지금 보면 아쉬운 점은?**
A. 규칙 문서를 기능 구현 전에 썼는데, 구현이 달라진 뒤 표를 고치지 않았습니다. 결제 대기 TTL은 문서에 30분, 코드는 10분이고, 소셜 가입 키는 Redis 대신 JWT로 바뀌었습니다. 중복 요청 키는 계획만 하고 구현하지 않았습니다. 키 표는 코드를 바꾸는 PR에서 함께 고치도록 했어야 합니다.

## 헷갈릴 때 정리

- Redis는 **메모리 키-값 저장소**다. 명령은 **한 스레드가 하나씩** 실행하므로 **명령 하나는 원자적**이다. 두 명령 사이는 원자적이지 않다.
- `SET NX` = 없을 때만 저장. `GETDEL` = 꺼내면서 삭제. 둘 다 "확인하고 바꾸기"를 **한 명령**으로 만든다.
- **TTL은 절대 시각**으로 저장된다. Redis가 꺼져 있던 시간도 흐른다.
- `maxmemory-policy`는 **메모리가 찼을 때만** 의미가 있다. 캐시면 `allkeys-lru/lfu`, 지워지면 안 되는 데이터면 `noeviction` + 모든 키 TTL.
- `volatile-*` 정책은 TTL 있는 키만 지우고, 후보가 없으면 `noeviction`처럼 거절한다.
- **RDB는 사진, AOF는 일기.** AOF 기본 설정은 최대 약 1초를 잃는다.
- RePlant의 Redis는 **세 군데**: 이메일 인증, Refresh 토큰, 결제 대기 표시. 결제 대기 키는 쓰기만 하고 **만료 판단은 DB 스케줄러**가 한다.
- **Access 토큰 검사에는 Redis를 쓰지 않는다.** 쓰면 세션 방식이 된다.
- `idem:*` 키는 **계획만 했고 구현하지 않았다.**

## 참고

- [Redis — Key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis — Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis — Understand Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [JWT를 처음부터 다시](/posts/jwt-structure) — Access·Refresh 분리와 회전
- [RePlant Market 프로젝트](/projects/replant)
