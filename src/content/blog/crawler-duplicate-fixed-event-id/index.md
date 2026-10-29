---
title: "크롤링한 과제를 Google Calendar 이벤트 ID로 중복 없이 등록하기"
summary: "다시 크롤링해도 같은 과제가 하나만 남도록, 중복 키를 따로 저장하지 않고 과목+과제 제목으로 만든 Google Calendar 이벤트 id를 직접 지정해 있으면 수정, 없으면 등록하게 했습니다."
date: "2026-05-31"
tags:
- 설계
- 크롤링
- Google Calendar API
projects: ["calainder", "dding"]
decision:
  question: "E-Class에서 크롤링한 과제를 Google Calendar에 바로 등록할 때, 다시 크롤링해도 같은 과제가 하나만 남게 하려면 '이미 등록된 과제'를 무엇으로 알아볼까"
  choice: "과목(sub)+과제 제목(title)을 SHA-256으로 해시해 Google Calendar 이벤트 id로 직접 지정하고, 기존 등록 함수(addEvent)가 id로 조회해 있으면 update, 없으면 insert한다."
  reasons:
    - "Calainder는 일정을 Google Calendar에만 저장해 자체 DB가 없다. 이벤트 id 자체를 키로 쓰면 중복 키를 보관할 곳을 따로 만들 필요가 없다."
    - "id 재료에서 마감일을 빼 마감이 바뀌어도 id가 그대로라, 새 일정이 아니라 기존 일정이 수정된다."
    - "id로 바로 조회(events.get)하므로 날짜 범위로 찾는 기존 조회 함수와 달리 마감일이 옮겨 간 과제도 찾는다."
    - "등록 경로를 새로 만들지 않고 addEvent 안에서 분기해, id가 없는 AI 일정 등록은 그대로 insert로 간다."
  tradeoff: "같은 과목에 제목이 같은 과제가 생기면 id가 겹친다. events.update는 이벤트 전체를 바꾸므로 사용자가 캘린더에서 고친 내용은 다시 크롤링하면 덮어써진다. 크롤링을 두 번 돌려 update로 가는지는 아직 확인하지 않았다."
---

> E-Class 과제 크롤링([#7](https://github.com/gasic37200/Calainder/issues/7))을 다시 실행해도 캘린더에 같은 과제가 쌓이지 않게 한 결정입니다. 앞서 DDING!에서 같은 문제를 풀지 못한 경험이 출발점이었습니다. 구현은 AI(Codex)와 함께 했고, 어떤 방법을 왜 골랐는지를 기록합니다.

## 배경과 제약

**먼저 실패한 경험 (DDING!).** 학교 홈페이지의 학식 메뉴를 크롤링해 MySQL에 저장하는 서비스였습니다. 메뉴 테이블에 메뉴 이름·날짜의 unique 제약이 없었고, 스케줄러 없이 크롤러를 손으로 실행했습니다. 실행할 때마다 같은 메뉴가 다시 저장돼, **매번 테이블 데이터를 지운 뒤 다시 돌리는** 방식으로 버텼습니다.

**Calainder의 조건.**

- 크롤링 결과는 초안 확인 없이 **바로 Google Calendar에 등록**된다. 등록 뒤 결과를 조회 카드로 다시 보여 준다.
- 일정의 최종 저장소가 Google Calendar라 **자체 DB가 없다.**
- 등록 함수 `CalendarService.addEvent`는 AI가 분석한 일정 등록에도 쓰이고, 항상 `events.insert`만 호출했다.
- 기존 조회 함수(`lookupEvent`)는 **날짜 범위**로 일정을 찾는다.
- 크롤러가 화면에서 읽는 값은 과제 제목(`title`), 과목(`sub`), 기간 문자열이다.

결정 기준은 세 가지로 잡았습니다.

1. **다시 실행해도 안전** — 몇 번을 돌려도 과제 하나당 일정 하나.
2. **변경 반영** — 마감일이 바뀐 과제는 새 일정이 아니라 기존 일정이 바뀐다.
3. **작은 변경** — 저장소를 새로 두지 않고, AI 일정 등록 흐름은 건드리지 않는다.

## 먼저 알아야 할 원리

### 이벤트 id는 클라이언트가 정할 수 있다

Google Calendar API의 [`events.insert` 문서](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)에 따르면, 이벤트를 만들 때 `id`를 직접 넣을 수 있고 넣지 않으면 서버가 만듭니다. 직접 넣을 때 규칙은 다음과 같습니다.

- 문자는 base32hex에 쓰이는 **소문자 a~v와 숫자 0~9**만
- 길이 **5~1024자**
- **캘린더 안에서 유일**해야 함

SHA-256 해시를 16진수로 쓰면 `0-9`, `a-f`만 나오므로 이 규칙 안에 들어갑니다. 한글 과목명이나 `:` 같은 문자를 그대로 쓸 수 없어서 해시를 거칩니다.

같은 문서는 "id 충돌이 생성 시점에 감지된다고 보장할 수 없다"고 적고 있습니다. 같은 id로 다시 insert했을 때 실패하리라 기대하기보다, **먼저 조회해서 있는지 확인하는 편**이 문서와 맞습니다.

### `events.update`는 이벤트 전체를 바꾼다

[`events.update` 문서](https://developers.google.com/workspace/calendar/api/v3/reference/events/update)는 이 메서드가 patch 방식이 아니라 **이벤트 리소스 전체를 갱신**한다고 적습니다. 일부만 바꾸려면 get 뒤 update를 etag와 함께 쓰라고 안내합니다. 크롤링 결과로 update하면 크롤러가 채우지 않은 필드는 크롤링 결과 기준으로 덮어써진다는 뜻입니다.

## 결정해야 했던 것

> **질문:** 크롤링한 과제를 바로 캘린더에 등록하면서, 다시 크롤링했을 때 같은 과제를 어떻게 알아보고, 알아본 뒤에는 무엇을 할까.

v1.4.0 작업 중 "한 번 돌리고 또 돌리면 중복으로 일정이 생기지 않나"를 짚은 것이 시작이었습니다. 실제로 중복이 쌓인 것을 본 것이 아니라 코드를 따라가 미리 찾은 문제입니다.

## 검토한 선택지

### 같은 과제를 알아보는 방법

AI가 처음 내놓은 세 가지와, 제가 되물은 방법입니다.

| 선택지 | 장점 | 단점 | 이 프로젝트에서 |
| --- | --- | --- | --- |
| 중복 키(dedupKey)를 따로 저장해 비교 | 키를 자유롭게 설계 | 키를 보관할 저장소가 필요 | 자체 DB가 없어 쓰지 않음 |
| 이벤트 `extendedProperties`에 키를 넣고 비교 | 저장소 없이 이벤트에 붙음 | 등록 전에 키로 이벤트를 찾는 과정이 따로 필요 | 쓰지 않음 |
| 제목 + 날짜로 비교 | 가장 단순 | 제목이 비슷하면 오탐, 마감일이 바뀌면 못 찾음 | 쓰지 않음 |
| **이벤트 `id`를 직접 지정** | 키가 곧 이벤트 id라 id로 바로 조회 | id 문자 규칙을 맞춰야 함 | **채택** |

### 이미 있을 때 무엇을 할지, 어디서 할지

| 선택지 | 판단 |
| --- | --- |
| id만 넣고 insert 그대로 | 같은 id 재등록이 실패할 수 있고, 바뀐 마감일이 반영되지 않음. 쓰지 않음 |
| insert를 시도하고 실패하면 update | AI가 제안. 문서상 충돌 감지가 보장되지 않아 지금 보면 기대기 어려움. 쓰지 않음 |
| 크롤링용 `upsertEvent`를 새로 만들기 | AI가 제안. 등록 경로가 두 개가 됨 |
| **기존 `addEvent` 안에서 id가 있으면 get → update, 없으면 insert** | 채택. 흐름이 "서버 요청 → 크롤러 → 등록" 하나라 등록 함수 한 곳에서 분기 |

AI가 처음 짠 코드는 기존 `lookupEvent`를 쓰려 했는데, 이 함수는 날짜 범위 조회라 마감일이 바뀐 과제를 못 찾습니다. 그래서 id로 직접 조회(`events.get`)하게 했습니다.

### id 재료

| 선택지 | 판단 |
| --- | --- |
| 과목 + 과제 제목 + 마감일 | 마감일이 바뀌면 id도 바뀌어 다시 중복. 쓰지 않음 |
| 제목 + 과목 + 시작일 | AI의 첫 제안. 날짜가 바뀌면 같은 문제. 쓰지 않음 |
| 과제 링크(`href`)의 고유값 | AI가 제안. 가장 안정적일 수 있지만 그 값이 과제마다 고정인지 확인하지 않음 |
| **과목(`sub`) + 과제 제목(`title`)** | 채택. 한 과목 안에서 과제 제목이 겹칠 일이 거의 없다고 판단 |

## 이 방법을 고른 이유

- **기준 1(다시 실행해도 안전):** 같은 과목·제목이면 항상 같은 id가 나오고, 등록 전에 그 id로 조회하므로 두 번째부터는 insert가 아니라 update로 간다.
- **기준 2(변경 반영):** 마감일을 id 재료에서 뺐기 때문에, 마감이 바뀐 과제도 같은 id로 찾아 시작·종료 시각만 새 값으로 바뀐다.
- **기준 3(작은 변경):** 키 저장소 없이 Google Calendar의 id 필드를 그대로 쓴다. `addEvent`는 id가 있을 때만 분기하고, AI가 분석한 일정은 id가 비어 있어 예전처럼 insert된다.

## 구현 코드

**크롤러 — 고정 id 만들기** (`calainder-crawl/main.py`, [#7](https://github.com/gasic37200/Calainder/issues/7))

```python
def make_calendar_event_id(sub, title):
    raw = f"calainder-crawl|{normalize_text(sub)}|{normalize_text(title)}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]   # 0-9a-f만 나옴
    return f"calainder{digest}"                                      # 41자, a~v·0~9 규칙 안

def normalize_text(value):
    return " ".join((value or "").strip().split())   # 공백 차이로 id가 달라지지 않게
```

**서버 — 등록 함수에서 분기** (`CalendarService.addEvent`)

```java
Event event = req.toGoogleEvent();
if (event.getId() != null && !event.getId().isBlank()) {
    try {
        service.events().get("primary", event.getId()).execute();          // 있으면
        Event updatedEvent = service.events().update("primary", event.getId(), event).execute();
        return new ScheduleDTO().toScheduleDTO(updatedEvent);
    } catch (GoogleJsonResponseException e) {
        if (e.getStatusCode() != 404) throw e;                           // 404면 아래로 내려가 새로 등록
    }
}
Event createdEvent = service.events().insert("primary", event).execute();
```

## 구현하며 부딪힌 것

처음 로컬에서 크롤링을 눌렀을 때는 `ResourceAccessException: I/O error on POST request for "http://localhost:9000/api/crawl/schedule"`가 났습니다. 크롤러 모듈을 띄우지 않은 채 Spring만 실행했기 때문이었고, 이때 크롤링 결과가 초안 없이 바로 캘린더에 들어간다는 것을 다시 떠올렸습니다. 그래서 등록 뒤 결과를 조회 카드로 한 번 더 보여 주도록 했습니다.

## 검증

- PR [#7](https://github.com/gasic37200/Calainder/issues/7)의 확인 사항은 "크롤링 일정 고정 ID 생성 확인"까지입니다.
- AI가 남은 확인으로 적은 "크롤링 2번 실행해서 중복 생성 대신 update 되는지 확인"을 실행한 기록은 없습니다. 자동 테스트도 없습니다.

## 감수한 것과 다음

- **id 충돌.** 같은 과목에 같은 제목의 과제가 생기면 두 과제가 한 일정으로 합쳐집니다. 과제 링크 안의 고유값이 과제마다 고정이라는 것을 확인하면 그 값으로 바꿀 수 있습니다.
- **사용자 수정이 덮어써짐.** `events.update`는 이벤트 전체를 바꾸므로, 사용자가 캘린더에서 설명이나 알림을 고친 뒤 다시 크롤링하면 크롤링 값으로 돌아갑니다. 막으려면 바뀐 필드만 보내는 `patch`나 문서가 안내하는 etag 방식이 필요합니다.
- **확인되지 않은 재실행.** 크롤링을 두 번 돌려 update로 가는지 확인하는 것이 가장 먼저 할 일입니다.

## 배운 점

- 외부 데이터를 가져오는 기능은 **"다시 실행해도 안전한가"**를 먼저 정해야 한다. DDING!에서는 이걸 정하지 않아 매번 데이터를 지웠다.
- 중복 판단의 키는 **바뀌지 않는 값**으로 만든다. 마감일처럼 바뀌는 값은 키가 아니라 갱신할 내용이다.
- 저장소가 이미 키를 받아 준다면(Google Calendar의 id) 키를 보관할 곳을 따로 만들지 않아도 된다.
