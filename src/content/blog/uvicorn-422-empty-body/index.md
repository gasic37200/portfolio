---
title: "Spring → FastAPI 요청 본문이 사라진 422 오류, 계층별로 원인 좁히기"
summary: "같은 JSON인데 Postman은 되고 Spring 경유는 422. DTO 문제가 아니라 uvicorn[standard]가 함께 설치한 httptools 파서를 Uvicorn이 자동으로 고른 실행 환경 차이였습니다."
date: "2026-05-31"
tags:
- 트러블슈팅
- FastAPI
- Spring Boot
projects: ["teammate"]
troubleshooting:
  problem: "Spring이 보낸 JSON 요청을 FastAPI가 422로 거절했고, Uvicorn은 본문을 비어 있는 것으로 처리했다."
  cause: "DTO 문제가 아니었다. 버전을 고정하지 않은 requirements.txt의 uvicorn[standard]가 httptools를 함께 설치했고, Uvicorn 기본값(--http auto)이 h11 대신 httptools를 HTTP 파서로 골랐다."
  solution: "검증 전 원본 본문 로그로 b''를 확인하고, Calainder 가상환경과 설치 패키지를 비교해 httptools 차이를 찾았다. --http h11로 실행해 원인을 확인한 뒤, uvicorn[standard]를 uvicorn으로 바꿔 h11이 기본으로 쓰이게 했다."
  result: "--http h11 실행에서 같은 요청이 정상 처리됐다. 같은 정리를 Calainder release/v1.5.1에 올렸고 Teammate에도 적용했다."
---

## 상황

Teammate 포트폴리오 보완 과정에서 Spring Boot 웹 서버가 FastAPI AI 평가 모듈을 REST API로 호출하는 구조를 만들었습니다. 그런데 로컬 Windows 환경에서 Spring이 보낸 요청이 FastAPI에서 **422 Unprocessable Entity**로 거절됐습니다.

Spring 쪽 로그로는 JSON 본문이 정상적으로 만들어지고 있었지만, Uvicorn은 요청 본문이 **비어 있는 것**으로 처리하고 있었습니다.

## 원인을 좁혀간 과정

422는 보통 요청 스키마가 맞지 않을 때 나오기 때문에, 처음에는 요청 형식 문제로 보고 Spring 쪽에 `Content-Type: application/json`을 명시하고 Gradle을 다시 빌드해 봤습니다. 결과는 같았습니다. 그다음부터는 추측으로 코드를 고치지 않고 **어느 계층에서 본문이 사라지는지**를 나눠서 확인했습니다.

1. **FastAPI 단독 검증** — Postman으로 FastAPI 엔드포인트를 직접 호출 → 정상 동작. FastAPI의 요청 모델 자체는 문제없음
2. **Spring 경유 검증** — 같은 데이터를 Spring 서버를 거쳐 호출 → 422 발생. `FastApiExceptionMapper` 로그에 `{"type":"missing","loc":["body","github_name"],"msg":"Field required"}`, Uvicorn 쪽에는 `Unsupported upgrade request`, `Invalid HTTP request received` 경고
3. **양 끝 비교** — FastAPI 검증 전에 content-type과 원본 본문을 찍는 임시 로그를 넣음 → `content-type: application/json`, `raw body: b''`. 같은 시점 Spring 전송 로그는 `bodyLength=28, body={"github_name":"..."}`로 정상
4. **정상 프로젝트와 비교** — 같은 구조로 동작하던 Calainder AI 모듈과 가상환경의 설치 패키지를 비교 → `requirements.txt`에 버전을 고정하지 않아 설치 시점마다 버전이 달랐고(uvicorn 0.38.0 / 0.48.0), Teammate에만 `httptools` 0.8.0이 있었음

애플리케이션 코드(DTO)는 양쪽 모두 정상이었고, 차이는 **Uvicorn이 고른 HTTP 파서**였습니다. Uvicorn은 기본값 `--http auto`로 설치된 파서를 자동 선택하는데, `uvicorn[standard]`가 함께 설치한 `httptools`가 Teammate에서만 선택되고 Calainder는 `h11`을 쓰고 있었습니다. Spring 코드는 그대로 두고 AI 모듈만 `--http h11`로 실행하자 같은 요청이 정상 처리돼 원인을 확인했습니다. `httptools`에서 본문이 왜 비는지까지는 확인하지 않았습니다.

## 해결

처음 배포한 Teammate v1.0.0([#1](https://github.com/gasic37200/teammate/pull/1))은 `uvicorn[standard]`를 그대로 두고 Dockerfile 실행 옵션에 `--http h11`을 넣었습니다.

다음 날 운영 서버의 Calainder에서도 컨테이너 안에서 직접 호출하면 200인데 Spring을 거치면 본문이 비는 같은 증상이 나왔습니다. 두 프로젝트 모두 WebSocket 같은 선택 의존성을 쓰지 않으므로, 실행 옵션으로 파서를 고정하는 대신 `uvicorn[standard]`를 `uvicorn`으로 바꿔 기본 파서인 `h11`이 쓰이게 정리했습니다. 이 변경은 Calainder `release/v1.5.1`([PR #10](https://github.com/gasic37200/Calainder/pull/10))로 올렸고, Teammate에도 같은 변경(`uvicorn[standard]` → `uvicorn`, `--http h11` 옵션 제거)을 적용했습니다. Teammate 변경은 아직 원격 저장소에 올리지 않아, 현재 저장소에는 v1.0.0의 `--http h11` 방식이 남아 있습니다.

남은 한계는 `requirements.txt`의 버전을 아직 고정하지 않았다는 점입니다. 이 문제도 설치 시점마다 버전이 달라진 데서 시작됐습니다.

## 배운 점

- 같은 코드라도 **실행 환경과 의존성 조합**에 따라 통신 결과가 달라질 수 있다.
- 오류 코드가 가리키는 "흔한 원인"을 바로 고치기보다, **클라이언트 → 네트워크 → 서버를 계층별로 나눠** 어디서 데이터가 달라지는지 확인하는 것이 더 빠르다.
- 재현 경로(Postman 직접 호출 vs 서버 경유)를 나눠두면 원인 범위를 줄일 수 있다.
- 의존성 버전을 고정하지 않으면 같은 `requirements.txt`로도 설치 시점마다 다른 환경이 만들어진다.
