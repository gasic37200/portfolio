---
title: "Postgres 유니크 제약으로 경기 단위 중복 참여 막기"
summary: "같은 휴대폰 번호가 같은 경기에는 한 번만, 다른 경기에는 다시 참여하도록 참여 행을 경기마다 만들고 (match_id, phone_hash) 유니크 제약으로 최종 판단을 DB에 맡겼습니다."
date: "2026-06-10"
tags:
- 설계
- 데이터 모델링
- Supabase
projects: ["korea-score-predictor"]
decision:
  question: "매장 QR 이벤트에서 같은 휴대폰 번호의 중복 참여를 어떤 단위로, 어디에서 막을까"
  choice: "참여 행을 경기마다 만들고 participants에 (match_id, phone_hash) 유니크 제약을 건다. 제출 전에 같은 경기·같은 번호를 조회해 안내하되, 최종 판단은 제약에 맡기고 위반(23505)은 안내 문구로 바꾼다."
  reasons:
    - "매장은 경기마다 다시 참여받는다. 제약의 단위가 운영 단위(경기)와 같아야 같은 경기 중복만 막고 다음 경기 참여는 열린다."
    - "조회 후 insert는 동시에 들어온 두 요청이 함께 통과할 수 있다. 유니크 인덱스는 커밋 전인 행과 충돌해도 기다렸다가 위반으로 처리한다."
    - "이미 만든 Supabase DB는 별도 마이그레이션(005)으로 기존 행을 첫 예측의 경기로 채운 뒤 제약을 바꿔, 새 설치와 기존 DB가 같은 스키마에 도착한다."
  tradeoff: "참여 행 insert와 예측 insert가 별도 요청이라 한 트랜잭션이 아니고, 예측 저장 실패 시 참여 행을 지우는 보상 처리에 기댄다. 마이그레이션은 SQL Editor에서 손으로 실행해야 해 코드 배포와 따로 움직이고, 자동화 테스트가 없어 동시 제출 차단은 실제 요청으로 확인하지 않았다."
---

> Korea Score Predictor는 매장 고객이 QR로 접속해 대한민국 경기 스코어를 예측하는 이벤트 웹앱입니다. 휴대폰 번호로 참여자를 구분하는데, 처음에는 "이벤트 하나에 한 번"으로 중복을 막았다가 배포 다음 날 "경기마다 한 번"으로 바꿨습니다([cfb088a](https://github.com/gasic37200/korea-score-predictor/commit/cfb088a)). 이 글은 그 단위를 어떻게 정했고, 왜 최종 판단을 DB 제약에 맡겼는지를 정리합니다. 구현은 Codex와 함께 했습니다.

## 배경과 제약

- **이벤트는 경기마다 다시 열린다.** 조별리그 1차전처럼 한 경기를 열어 예측을 받고, 16강·8강에 올라가면 관리자가 상대팀을 바꾼 새 경기를 연다. 이벤트 페이지에는 한 번에 한 경기만 보인다([039f1a1](https://github.com/gasic37200/korea-score-predictor/commit/039f1a1)).
- **참여자는 휴대폰 번호로 구분한다.** 원본 번호 대신 정규화한 번호의 HMAC 해시(`phone_hash`)를 저장한다([휴대폰 번호 글](/blog/phone-number-privacy)).
- **데이터는 Supabase Postgres, 제출은 Next.js Server Action에서 `supabase-js`로 처리한다.** 스키마 변경은 `supabase/migrations`의 SQL을 Supabase SQL Editor에서 직접 실행한다.
- **매장에서 짧은 시간에 여러 명이 제출한다.** 같은 번호로 두 번 누르거나 두 기기에서 동시에 내는 경우를 배제할 수 없다.

결정 기준은 세 가지로 잡았습니다.

1. **운영 단위** — 같은 경기에는 한 번만, 다른 경기에는 다시 참여할 수 있다.
2. **동시 요청** — 같은 번호의 요청 두 개가 동시에 들어와도 한 건만 남는다.
3. **기존 데이터** — 이미 만든 DB를 지우지 않고 새 기준으로 옮긴다.

## 먼저 알아야 할 원리

### 여러 열에 건 유니크 제약은 "조합"이 유일해야 한다

PostgreSQL 문서는 여러 열에 건 유니크 제약을 "지정한 열들의 값 조합이 테이블 전체에서 유일하다"고 설명하고, 각 열은 따로 유일할 필요가 없다고 덧붙입니다. 또 유니크 제약을 추가하면 그 열 묶음에 유니크 B-tree 인덱스가 자동으로 만들어집니다([PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS)).

그래서 `unique (event_id, phone_hash)`는 "한 이벤트에 한 번호 한 행", `unique (match_id, phone_hash)`는 "한 경기에 한 번호 한 행"을 뜻합니다. 같은 번호가 여러 행에 있어도 경기가 다르면 문제없습니다. 중복의 단위는 제약에 넣는 열이 정합니다.

### NULL끼리는 같지 않은 값으로 본다

같은 문서는 기본적으로 두 NULL을 같은 값으로 보지 않는다고 적습니다. 제약 열 중 하나라도 NULL이면 유니크 제약이 있어도 중복 행이 저장될 수 있습니다(`NULLS NOT DISTINCT`로 바꿀 수 있음).

기존 테이블에 `match_id`를 새로 붙이면 기존 행은 처음에 NULL입니다. 이 상태로 `(match_id, phone_hash)` 제약을 걸면 NULL인 행은 중복 검사를 빠져나갑니다. 그래서 마이그레이션에서 `match_id`를 먼저 채우고 `NOT NULL`을 건 다음에 제약을 바꿨습니다.

### 커밋 전인 충돌 행이 있으면 기다렸다가 판단한다

유니크 인덱스는 동시에 들어온 insert도 막습니다. PostgreSQL 문서에 따르면 충돌하는 행을 아직 커밋하지 않은 트랜잭션이 넣었다면, 새로 넣으려는 쪽은 그 트랜잭션이 끝나기를 기다립니다. 상대가 롤백하면 충돌이 아니고, 커밋하면 유일성 위반입니다([PostgreSQL: Index Uniqueness Checks](https://www.postgresql.org/docs/current/index-unique-checks.html)).

반대로 애플리케이션에서 "먼저 조회해서 없으면 insert"하는 방식은, 두 요청이 거의 동시에 조회하면 둘 다 "없음"을 보고 insert로 넘어갈 수 있습니다. 조회는 안내를 빨리 돌려주는 데는 쓸 수 있지만, 마지막 판단은 인덱스가 해야 합니다.

### 위반은 SQLSTATE `23505`로 돌아온다

유일성 위반의 SQLSTATE는 `23505`(`unique_violation`)입니다([PostgreSQL: Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)). Supabase의 REST 계층인 PostgREST는 PostgreSQL 오류의 SQLSTATE를 응답 JSON의 `code`에 그대로 담고, `23505`를 HTTP `409 Conflict`로 돌려줍니다([PostgREST: Errors](https://docs.postgrest.org/en/v12/references/errors.html)). 그래서 서버 코드는 `error.code === "23505"`로 중복 참여만 골라 사용자용 안내로 바꿀 수 있습니다.

## 결정해야 했던 것

**같은 휴대폰 번호의 중복 참여를 어떤 단위로 막고, 그 판단을 어디에 둘까.**

MVP([#1](https://github.com/gasic37200/korea-score-predictor/pull/1))는 `participants_event_phone_unique (event_id, phone_hash)` 제약을 두고 참여자 1행에 여러 경기 예측을 묶었습니다. 바로 전 커밋의 `SPEC.md`에도 "참여자 중복 확인은 경기 기준이 아니라 이벤트 기준으로 처리해야 하므로 `events`가 필요하다"고 적혀 있었습니다. 이 구조에서는 첫 경기에 참여한 번호가 같은 이벤트의 다음 경기에 참여할 수 없습니다(경위는 [프로젝트 페이지](/projects/korea-score-predictor) 트러블슈팅 박스).

## 검토한 선택지

### 중복의 단위

| 선택지 | 장점 | 단점 | 이 프로젝트에서 |
| --- | --- | --- | --- |
| `event_id + phone_hash` 유지 (MVP) | 이미 만든 스키마, 참여자 1행에 예측 여러 개 | 첫 경기 참여자가 다음 경기에 참여할 수 없음 (기준 1 위반) | 버림 |
| **참여 행을 경기마다 만들고 `match_id + phone_hash`** | 제약 단위가 운영 단위와 같음, `/result` 참여자 수도 경기 기준으로 셀 수 있음 | 같은 사람의 닉네임·번호 행이 경기 수만큼 생김 | **채택** |
| 참여자는 이벤트 단위로 두고, 예측에 경기 단위 제약 (돌아보면) | 참여자 행이 중복되지 않음 | 예측 테이블에 번호 해시를 다시 두거나 참여자와 묶은 제약을 따로 설계해야 함 | 당시 검토하지 않았다. 지금 보면 비교해 볼 만하다 |

### 중복 판단을 둘 곳

| 선택지 | 판단 |
| --- | --- |
| 애플리케이션 조회만 | 동시에 들어온 두 요청이 함께 통과할 수 있다(기준 2 위반) |
| DB 제약만 + `23505` 안내 | MVP의 방식. 동시 요청까지 막는다 |
| **조회로 먼저 안내 + DB 제약으로 최종 판단** | 채택(cfb088a). 조회를 추가한 이유는 작업 기록에 따로 남아 있지 않다. 제약은 그대로 두고 `23505` 안내를 경기 기준 문구로 바꿨다 |

### 이미 만든 DB를 옮기는 방법

| 선택지 | 판단 |
| --- | --- |
| `001_initial_schema.sql`만 고치기 | 새로 설치하는 DB에만 적용된다. 이미 만든 Supabase 프로젝트는 그대로 남는다(기준 3 위반) |
| **`001`은 새 설치용으로 고치고, 기존 DB용 `005`를 따로 추가** | 채택. 기존 행을 첫 예측의 경기로 채우고, 채울 수 없는 행만 지운다 |

## 이 방법을 고른 이유

1. **운영 단위** — 매장이 경기마다 참여받으므로 제약 열을 `event_id`에서 `match_id`로 바꿨습니다. 제약이 정책을 그대로 표현하게 되어, 같은 번호가 다른 경기에서 다시 참여하는 것은 막히지 않습니다.
2. **동시 요청** — 조회만으로는 동시 제출을 막지 못하므로, 커밋 전 충돌까지 기다렸다가 판단하는 유니크 인덱스에 최종 판단을 맡겼습니다. 조회는 흔한 경우에 insert 전에 안내를 돌려주는 경로로만 둡니다.
3. **기존 데이터** — 기존 행은 연결된 예측 중 가장 먼저 만든 예측의 경기로 `match_id`를 채웠습니다. NULL이 남으면 제약을 빠져나가므로, 채울 수 없는 행(예측이 없는 행)은 지우고 `NOT NULL`을 건 뒤 제약을 바꿨습니다.

## 구현 코드

기존 DB용 마이그레이션입니다([`005_participants_match_scope.sql`](https://github.com/gasic37200/korea-score-predictor/blob/main/supabase/migrations/005_participants_match_scope.sql)).

```sql
alter table public.participants
  add column if not exists match_id uuid references public.matches(id) on delete cascade;

-- 기존 행은 첫 예측의 경기로 채운다
update public.participants
set match_id = prediction_match.match_id
from (
  select distinct on (participant_id) participant_id, match_id
  from public.predictions
  order by participant_id, created_at asc
) as prediction_match
where participants.id = prediction_match.participant_id
  and participants.match_id is null;

-- NULL은 유니크 검사를 빠져나가므로 남기지 않는다
delete from public.participants where match_id is null;
alter table public.participants alter column match_id set not null;

alter table public.participants drop constraint if exists participants_event_phone_unique;
alter table public.participants
  add constraint participants_match_phone_unique unique (match_id, phone_hash);
```

제출 Server Action([`src/app/event/actions.ts`](https://github.com/gasic37200/korea-score-predictor/blob/main/src/app/event/actions.ts))은 먼저 조회하고, insert에서 `23505`가 나면 같은 안내를 돌려줍니다.

```ts
const { data: duplicateParticipants } = await supabase
  .from("participants")
  .select("id")
  .eq("phone_hash", phoneHash)
  .in("match_id", matchIds)
  .limit(1);

if ((duplicateParticipants ?? []).length > 0) {
  return { status: "error", message: "이미 이 경기에 참여한 휴대폰 번호입니다. 다른 경기는 다시 참여할 수 있습니다." };
}

const { data: participants, error: participantError } = await supabase
  .from("participants")
  .insert(matchPredictions.map(({ match }) => ({ event_id: eventId, match_id: match.id, phone_hash: phoneHash /* ... */ })))
  .select("id,match_id");

if (participantError?.code === "23505") {
  // 동시에 들어온 요청은 조회를 함께 통과할 수 있어, 최종 판단은 유니크 제약이 한다
  return { status: "error", message: "이미 이 경기에 참여한 휴대폰 번호입니다. 다른 경기는 다시 참여할 수 있습니다." };
}
```

(코드는 글에 맞게 줄였습니다. 실제 코드는 오류마다 입력값을 함께 돌려줍니다.)

## 구현하며 부딪힌 것

참여 행과 예측 행은 `supabase-js` 호출 두 번으로 따로 저장됩니다. 참여 행만 들어가고 예측이 실패하면, 그 번호는 예측 없이 "이미 참여한 번호"가 됩니다. 그래서 예측 insert가 실패하거나 돌려받은 참여 행과 경기를 짝지을 수 없으면, 방금 만든 참여 행을 `.delete().in("id", ...)`로 지우고 오류를 돌려주게 했습니다. 한 트랜잭션은 아니어서, 이 삭제마저 실패하는 경우는 막지 못합니다.

중복 단위를 바꾸면서 `/result`의 참여자 수도 이벤트 전체가 아니라 표시 중인 경기 기준으로 세도록 [`src/lib/results.ts`](https://github.com/gasic37200/korea-score-predictor/blob/main/src/lib/results.ts)를 함께 고쳤습니다. `SPEC.md`, `PRIVACY.md`, `AGENTS.md`의 "이벤트 기준" 문구도 같은 커밋에서 경기 기준으로 바꿨습니다.

## 검증

- cfb088a에서 `npm run lint`(eslint), `npm run typecheck`(`tsc --noEmit`), `npm run build`(`next build`)가 모두 오류 없이 끝났습니다.
- 저장소에 테스트 코드가 없어, 다른 경기 재참여 허용과 같은 경기 동시 제출 차단은 자동화 테스트로 고정되어 있지 않습니다.
- 배포된 코드는 `participants.match_id`를 쓰므로, Supabase SQL Editor에서 `005`를 실행하지 않으면 제출이 실패합니다. 운영 DB에 실행했는지는 기록이 남아 있지 않습니다.

## 감수한 것과 다음

- **보상 삭제에 기댄 부분 저장 방지.** 두 insert가 한 트랜잭션이 아닙니다. 실패가 잦아지거나 경기 여러 개를 한 번에 받게 되면, Postgres 함수 하나로 참여·예측을 함께 넣어 DB 트랜잭션으로 묶는 쪽을 검토합니다.
- **참여 행 중복.** 같은 사람이 경기마다 닉네임·번호 행을 새로 가집니다. 경기 수가 적은 이벤트라 받아들였습니다.
- **수동 마이그레이션.** 코드 배포와 스키마 변경이 따로 움직입니다. 마이그레이션 실행을 배포 절차에 넣는 것이 다음 과제입니다.

## 배운 점

- 유니크 제약에 넣는 열이 곧 운영 정책이다. 정책이 "경기마다"로 바뀌면 제약 열도 바뀌어야 한다.
- 먼저 조회하는 코드는 안내용이고, 동시에 들어온 요청을 막는 것은 커밋 전 충돌까지 기다리는 유니크 인덱스다.
- 기존 테이블에 제약 열을 추가할 때는 NULL이 유니크 검사를 빠져나간다는 점 때문에, 채우고 `NOT NULL`을 건 다음에 제약을 바꿔야 한다.
