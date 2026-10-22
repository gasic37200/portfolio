---
title: "OCI 서버 하나에 서비스 3개, Docker Compose와 Nginx로 직접 배포하기"
summary: "Calainder, Teammate, 공용 feedback-api를 컨테이너로 나누고 DNS부터 HTTPS까지 직접 구성하며 겪은 것들입니다."
date: "2026-05-31"
tags:
- 배포
- Docker
- Nginx
- OCI
projects: ["calainder", "teammate"]
troubleshooting:
  problem: "설정 하나만 빠져도 서비스가 뜨지 않았고, 인스턴스 재시작 후에는 도메인 연결이 끊겼다."
  cause: "Dockerfile, compose, 환경변수, 보안 그룹, Nginx, HTTPS, DNS가 모두 맞물려 있었고, 재시작 시 공인 IP가 바뀌었다."
  solution: "서비스별 Docker Compose와 .env 분리, 모듈별 .dockerignore 추가, DNS·방화벽·Nginx 리버스 프록시·HTTPS를 직접 구성했다."
  result: "OCI 서버 한 대에서 Calainder, Teammate, feedback-api를 컨테이너로 분리해 운영 중이다."
---

## 목표

포트폴리오 프로젝트를 "로컬에서 돌아가는 코드"가 아니라 **실제로 접속 가능한 서비스**로 만들고 싶었습니다. Oracle Cloud Infrastructure A1 Flex(Ubuntu 24.04 ARM) 서버 한 대에 세 서비스를 올렸습니다.

| 서비스 | 구성 |
| --- | --- |
| Calainder | Spring Boot 서버 + AI 모듈(FastAPI) + 크롤러 모듈 |
| Teammate | `teammate-web` + `teammate-ai-grading` |
| feedback-api | 두 서비스가 함께 쓰는 공용 FastAPI 모듈 (Firestore 저장) |

## 구성

- **서비스별 컨테이너 분리** — 각 서버·모듈을 Docker Compose 서비스로 나누고, 각자 자신의 `.env` 파일을 읽어 동작하도록 환경변수 구조를 정리
- **이미지 정리** — 모듈별 `.dockerignore`를 추가해 `.env`, 가상환경, 캐시, 빌드 결과가 이미지에 포함되지 않도록 함
- **네트워크** — DNS, Internet Gateway, Route Table, Security List, Linux 방화벽을 직접 설정
- **진입점** — Nginx 리버스 프록시로 도메인별 라우팅, HTTPS 인증서 적용 (`calainder.kr`, `teammate.o-r.kr`)

## 겪은 것들

**설정 하나만 빠져도 서비스가 뜨지 않는다**
`.gitignore`, Dockerfile, `docker-compose.yml`, 환경변수, 보안 그룹, Nginx, HTTPS, 도메인 연결이 모두 서로 연결되어 있었습니다. 작은 누락이나 경로 문제 하나로도 서비스가 바로 동작하지 않았습니다.

**공인 IP가 바뀌면 도메인도 고쳐야 한다**
초기 EC2 환경에서 인스턴스를 재시작하자 공인 IP가 바뀌었고, 도메인 A 레코드도 함께 수정해야 했습니다.

**외부 플랫폼은 서비스의 신뢰성까지 본다**
Calainder의 Google OAuth는 요청하는 권한 범위가 민감해서, 동의 화면 구성, 홈페이지 URL, 개인정보처리방침과 이용약관 링크, 민감 범위 사용 사유, 데모 영상까지 준비해야 했습니다.

## 배운 점

- 배포는 단순한 실행이 아니라 **코드, 인프라, 네트워크, 보안 설정이 함께 맞물려야** 완성된다.
- 시간이 걸리더라도 전체 구조를 한 번 끝까지 구성해본 덕분에, 이후에는 스스로 다시 구성할 수 있는 기반이 생겼다.
- 서비스마다 `.env`를 분리해두면 하나의 서버에서도 서비스 간 설정이 섞이지 않는다.
