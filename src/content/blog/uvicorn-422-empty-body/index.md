---
title: "Spring → FastAPI 요청 본문이 사라진 422 오류, 계층별로 원인 좁히기"
summary: "같은 JSON인데 Postman은 되고 Spring 경유는 422. DTO 문제가 아니라 Uvicorn 실행 환경과 선택 의존성 차이였습니다."
date: "2026-05-31"
tags:
- 트러블슈팅
- FastAPI
- Spring Boot
projects: ["teammate"]
troubleshooting:
  problem: "Spring이 보낸 JSON 요청을 FastAPI가 422로 거절했고, Uvicorn은 본문을 비어 있는 것으로 처리했다."
  cause: "DTO 문제가 아니라 uvicorn[standard]의 선택 의존성에 따른 실행 환경 차이였다."
  solution: "Postman 직접 호출과 Spring 경유 호출을 나누고, 전송 직전 body와 수신 결과를 비교해 범위를 좁힌 뒤 최소 uvicorn 의존성으로 정리했다."
  result: "정상 동작 확인. 요청을 계층별로 나눠 검증하는 디버깅 방식을 익혔다."
---

## 상황

Teammate 포트폴리오 보완 과정에서 Spring Boot 웹 서버가 FastAPI AI 평가 모듈을 REST API로 호출하는 구조를 만들었습니다. 그런데 로컬 Windows 환경에서 Spring이 보낸 요청이 FastAPI에서 **422 Unprocessable Entity**로 거절됐습니다.

Spring 쪽 로그로는 JSON 본문이 정상적으로 만들어지고 있었지만, Uvicorn은 요청 본문이 **비어 있는 것**으로 처리하고 있었습니다.

## 원인을 좁혀간 과정

422는 보통 요청 스키마가 맞지 않을 때 나오기 때문에, 처음에는 DTO 필드명이나 타입 불일치를 의심하기 쉬운 상황이었습니다. 그래서 추측으로 코드를 고치기 전에 **어느 계층에서 본문이 사라지는지**부터 나눠서 확인했습니다.

1. **FastAPI 단독 검증** — Postman으로 FastAPI 엔드포인트를 직접 호출 → 정상 동작. FastAPI의 요청 모델 자체는 문제없음
2. **Spring 경유 검증** — 같은 데이터를 Spring 서버를 거쳐 호출 → 422 발생
3. **양 끝 비교** — Spring이 전송 직전에 만든 body와 FastAPI가 실제로 받은 결과를 나란히 비교 → Spring은 올바른 JSON을 보내고 있었음

애플리케이션 코드(DTO)는 양쪽 모두 정상이었기 때문에, 범위를 **Uvicorn 실행 환경과 의존성 조합**으로 좁힐 수 있었습니다.

## 해결

`uvicorn[standard]`로 설치하면 선택 의존성이 함께 들어오면서 HTTP 처리 구성이 달라집니다. 이를 최소 `uvicorn` 의존성만 사용하도록 정리하자 같은 요청이 정상적으로 처리됐습니다.

이 정리는 Teammate의 `release/v1.0.1`, Calainder의 `release/v1.5.1`에 각각 반영했습니다.

## 배운 점

- 같은 코드라도 **실행 환경과 의존성 조합**에 따라 통신 결과가 달라질 수 있다.
- 오류 코드가 가리키는 "흔한 원인"을 바로 고치기보다, **클라이언트 → 네트워크 → 서버를 계층별로 나눠** 어디서 데이터가 달라지는지 확인하는 것이 더 빠르다.
- 재현 경로(Postman 직접 호출 vs 서버 경유)를 나눠두면 원인 범위를 절반씩 줄일 수 있다.
