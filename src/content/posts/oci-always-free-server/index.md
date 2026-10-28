---
title: "OCI 무료 서버를 스크립트로 잡아 다섯 달째 운영하기"
summary: "Oracle Cloud Always Free의 ARM 서버는 재고가 없어 콘솔에서 만들 수 없었습니다. Cloud Shell에서 재시도 스크립트를 돌려 서버를 잡기까지 겪은 일과, 그 서버에서 Calainder·Teammate를 지금까지 운영하며 알게 된 것을 정리했습니다."
date: "2026-10-28"
tags:
- OCI
- 인프라
- 배포
draft: true
---

<!--
  ✏️ 임시 글 작성 메모 (사이트에는 보이지 않음)
  - 근거: Codex 작업 기록 2026-05-21(Always Free 질문), 2026-05-27 세션의 05-29~06-01 대화(생성·재시도·증설·네트워크).
  - 로그의 OCID, 공인 IP, SSH 키, 계정 이름은 일부러 뺐습니다.
  - 지금 사양은 2026-10-28 OCI 콘솔에서 확인: 인스턴스는 portfolio-server-prod-01 한 대, 1 OCPU / 6GB / 네트워크 1Gbps, 2026-05-29 20:22 UTC 생성(FD-3). 무료 한도 4 OCPU / 24GB를 나눠 쓰려고 이 사양으로 둔 것은 사용자 확인.
  - 공개할 때는 frontmatter의 draft: true 줄을 지우세요.
-->

> **한눈에 보기**
>
> - Oracle Cloud(OCI) Always Free의 ARM 서버(`VM.Standard.A1.Flex`)는 **공짜지만 재고가 없으면 만들 수 없다.** 콘솔에서 만들기를 누르자 `Out of capacity`가 떴다.
> - 재고는 콘솔에서 볼 수 없어서, **Cloud Shell에서 3분마다 생성을 다시 요청하는 스크립트**를 돌렸고 밤새 기다린 끝에 서버를 잡았다.
> - 그런데 **같은 이름의 서버가 2대** 생겼다. 재시도 스크립트가 "이미 만들어졌는지"를 확인하지 않았기 때문이다.
> - 사양을 올리려 할 때도 같은 벽(`Out of host capacity`)을 만났고, 이번에는 **사양 변경을 재시도하는 스크립트**를 만들었다.
> - 그 서버에서 [Calainder](/projects/calainder), [Teammate](/projects/teammate), 공용 피드백 API를 **2026년 6월부터 지금(10월 28일)까지** 운영하고 있다.

![OCI 무료 서버를 잡아 지금까지 쓰기까지의 흐름](/images/posts/oci-always-free-server/01-timeline.svg)

## 왜 OCI였나

Calainder와 Teammate를 한 서버에서 Docker Compose로 함께 돌릴 생각이었습니다. Spring 서버 2개, FastAPI 모듈 3개, 공용 피드백 API까지 올리려면 메모리가 넉넉해야 했고, 개인 프로젝트라 비용은 0원이어야 했습니다.

OCI의 Always Free는 이 조건에 맞았습니다. 무료 체험 기간이 끝나도 **Always Free 표시가 붙은 리소스는 계속 무료**이고, ARM Ampere A1은 **합쳐서 4 OCPU / 24GB까지** 무료입니다. 한 대에 몰아서 4 OCPU / 24GB로 만들 수도 있고, 1 OCPU / 6GB 네 대로 나눌 수도 있습니다.

| 조건 | OCI Always Free A1 |
| --- | --- |
| 비용 | 한도 안에서는 무료 (기간 제한 없음) |
| 메모리 | 최대 24GB (한 대 또는 여러 대로 나눠서) |
| 디스크 | 블록 볼륨 합계 200GB (부트 볼륨 포함) |
| 함정 | **재고가 없으면 만들 수 없다** |

마지막 줄이 이 글의 시작입니다.

## 콘솔에서는 만들 수 없었다

춘천 리전(`ap-chuncheon-1`)에서 Ubuntu 24.04 aarch64 이미지와 `VM.Standard.A1.Flex`를 골라 만들기를 누르자 이 오류가 떴습니다.

```text
API Error
Out of capacity for shape VM.Standard.A1.Flex in availability domain AD-1.
Create the instance in a different availability domain or try again later.
```

설정 문제가 아니라 **춘천 데이터센터에 A1 서버를 올릴 물리 자원이 없다**는 뜻입니다. 오류 문구가 권하는 해결책은 "다른 가용 도메인(AD)에서 만들거나 나중에 다시 시도하라"인데, 둘 다 쉽지 않았습니다.

- **AD를 바꿀 수 없었다.** 춘천 리전은 AD가 `AD-1` 하나뿐입니다. 그 안의 장애 도메인(FD-1~3)은 고를 수 있지만, "Oracle이 고르게 두기"가 오히려 유리하다고 해서 그대로 뒀습니다.
- **서울 리전도 고를 수 없었다.** 리전 목록에 서울이 나오지 않았습니다.
- **재고가 얼마나 남았는지 볼 방법이 없다.** 콘솔의 `Limits, Quotas and Usage`는 **내 계정이 쓸 수 있는 한도**를 보여 줄 뿐, 데이터센터의 실제 재고는 공개하지 않습니다.

남은 방법은 "나중에 다시 시도"뿐이었습니다. 문제는 **언제** 다시 해야 할지 모른다는 것이었습니다.

## 버튼 대신 스크립트로 다시 누르기

찾아보니 다들 스크립트로 잡는다고 했습니다. 처음에는 "크롬에서 만들기 버튼을 대신 눌러 주는 스크립트"를 생각했는데, Codex에게 물어보니 권하지 않았습니다.

| 방법 | 장점 | 문제 |
| --- | --- | --- |
| 크롬 자동 클릭 (Playwright·Selenium) | 콘솔에서 하던 그대로 | 화면이 바뀌면 깨짐, 로그인·2단계 인증, 잘못 누르면 원치 않는 리소스 생성, 성공 여부 판단이 애매 |
| **Cloud Shell + OCI CLI** (채택) | 브라우저 안 터미널이라 설치·인증이 이미 돼 있음, 결과를 명령 종료 코드로 판단 | 서브넷·이미지 같은 OCID를 직접 찾아 넣어야 함 |

**Cloud Shell**은 OCI 콘솔 오른쪽 위에서 여는 브라우저 터미널입니다. OCI CLI가 설치돼 있고 로그인한 계정으로 이미 인증돼 있어서, 키 파일을 따로 만들 필요가 없었습니다. 서버 생성은 `oci compute instance launch` 명령 하나입니다.

만든 스크립트(`create-a1-retry.sh`)는 이렇습니다. OCID와 SSH 키는 자리만 남겼습니다.

```bash
#!/usr/bin/env bash
set -u

COMPARTMENT_ID="ocid1.tenancy..."        # 테넌시(루트 구획) OCID
SUBNET_ID="ocid1.subnet..."              # 미리 만든 VCN의 공용 서브넷
IMAGE_ID="ocid1.image..."                # Ubuntu 24.04 aarch64 이미지
AVAILABILITY_DOMAIN="Bpmp:AP-CHUNCHEON-1-AD-1"
DISPLAY_NAME="portfolio-server-prod-01"

OCPUS=1                                  # 큰 사양보다 작은 사양이 잡히기 쉽다
MEMORY_GB=6
BOOT_VOLUME_GB=100
MAX_ATTEMPTS=100
SLEEP_SECONDS=180                        # 3분 간격 → 최대 약 5시간
SSH_PUBLIC_KEY='ssh-rsa ...'

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Attempt ${attempt}/${MAX_ATTEMPTS}"

  OUTPUT=$(oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$AVAILABILITY_DOMAIN" \
    --display-name "$DISPLAY_NAME" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config "{\"ocpus\": ${OCPUS}, \"memoryInGBs\": ${MEMORY_GB}}" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --assign-public-ip true \
    --metadata "{\"ssh_authorized_keys\": \"${SSH_PUBLIC_KEY}\"}" \
    --boot-volume-size-in-gbs "$BOOT_VOLUME_GB" \
    --wait-for-state RUNNING \
    --query 'data.id' --raw-output 2>&1)

  if [ $? -eq 0 ]; then
    echo "SUCCESS: instance created"
    echo "Instance OCID: $OUTPUT"
    exit 0                               # 잡히면 바로 멈춘다
  fi

  echo "$OUTPUT"
  if echo "$OUTPUT" | grep -Eqi "Out of capacity|Out of host capacity"; then
    echo "Out of capacity. Retrying in ${SLEEP_SECONDS}s..."
    sleep "$SLEEP_SECONDS"
    continue                             # 재고 부족만 다시 시도
  fi

  echo "Non-capacity error. Stopping."   # 그 밖의 오류(설정 실수 등)는 멈춘다
  exit 1
done
```

스크립트에서 신경 쓴 규칙은 세 가지입니다.

1. **재고 부족일 때만 다시 시도한다.** OCID를 잘못 넣은 것 같은 오류까지 계속 다시 보내면 실수가 가려집니다.
2. **횟수와 간격에 상한을 둔다.** 100번, 3분 간격입니다. 2분과 3분 중에 고민했는데, 재고는 초 단위로 생기는 게 아니라 가끔 풀리는 편이라 3분으로 정했습니다.
3. **처음에는 작게 잡는다.** 4 OCPU / 24GB를 한 번에 노리기보다 1 OCPU / 6GB로 먼저 잡고 나중에 늘리기로 했습니다.

### 스크립트를 만들며 막힌 것

- **`Attempt 1/100`에서 멈춘 것처럼 보였다.** `--wait-for-state RUNNING`이 서버가 켜질 때까지 기다리게 하는 옵션이라, 요청이 처리되는 동안 화면이 멈춘 것처럼 보였습니다. 오류가 아니었습니다.
- **오류 문구가 두 가지였다.** 처음에는 `Out of capacity`만 잡았는데, 같은 상황에서 `Out of host capacity`도 나왔습니다. 그래서 둘 다 잡도록 `grep -Eqi`로 바꿨습니다. 이걸 `sed`로 고치려다가 패턴 안의 `|`가 구분자와 겹쳐 `unknown option to 's'` 오류가 나서, 결국 파일을 통째로 다시 썼습니다.
- **`nano`가 처음이었다.** `Ctrl + O`(저장)를 누르니 파일 이름을 물어서 당황했는데, 그대로 `Enter`를 누르면 되는 것이었습니다.

## 밤새 돌렸더니 서버가 두 대

5월 29일 저녁에 스크립트를 돌려 두고, 다음 날 새벽에 확인하니 서버가 잡혀 있었습니다. 그런데 목록에 **같은 이름의 서버가 두 대**였습니다.

```text
portfolio-server-prod-01  Running  A1.Flex  1 OCPU  6GB  FD-1  생성 04:27 (KST)
portfolio-server-prod-01  Running  A1.Flex  1 OCPU  6GB  FD-3  생성 05:22 (KST)
```

왜 두 번 만들어졌는지는 기록이 남아 있지 않습니다. 확실한 것은 **스크립트가 "같은 이름의 서버가 이미 있는지"를 확인하지 않고 생성 요청을 보냈다**는 점입니다. 한 번 성공하면 바로 멈추게는 했지만, 요청이 처리됐는데 성공으로 판단하지 못하거나 스크립트를 다시 실행하면 두 번째 서버가 생길 수 있는 구조였습니다.

두 대 모두 무료 한도(4 OCPU / 24GB) 안이라 요금이 나오지는 않았습니다. 문제는 **디스크**였습니다. 부트 볼륨이 100GB씩, 합쳐서 200GB라 **무료 블록 볼륨 한도를 다 써 버린 상태**였습니다. 그래서 먼저 만든 서버를 지웠고, 삭제 창에서 `Permanently delete the attached boot volume`을 꼭 체크했습니다. 체크하지 않으면 서버만 지워지고 디스크 100GB가 남아 한도를 계속 차지합니다.

> 나중에 RePlant에서 결제·택배 예약에 멱등키를 넣으며 다시 만난 문제입니다. **"성공할 때까지 다시 보내는" 코드는, 이미 성공했는지 확인하는 장치가 함께 있어야 한다.** 이 스크립트라면 생성 전에 `oci compute instance list`로 같은 이름이 있는지 먼저 확인했어야 합니다.

## 사양을 올릴 때도 같은 벽

5월 31일, 서비스를 올리기 전에 1 OCPU / 6GB를 4 OCPU / 24GB로 늘리려 했습니다. 콘솔의 `Edit shape`에서 바꾸자 또 같은 오류가 났고, 중간 사양인 2 OCPU / 12GB도 마찬가지였습니다.

서버를 새로 만드는 게 아니라 **있는 서버의 사양만 바꾸는 것**도 재고가 있어야 합니다. 그래서 이번에는 `oci compute instance update`를 반복하는 스크립트(`resize-a1-retry.sh`)를 만들었습니다. 공인 IP와 디스크는 그대로 두고 사양만 바꾸는 명령입니다.

```bash
INSTANCE_ID="ocid1.instance..."
OCPUS=4
MEMORY_GB=24
WAIT_SECONDS=180

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Trying ${OCPUS} OCPU / ${MEMORY_GB}GB..."
  OUTPUT=$(oci compute instance update \
    --instance-id "$INSTANCE_ID" \
    --shape-config "{\"ocpus\": ${OCPUS}, \"memoryInGBs\": ${MEMORY_GB}}" \
    --force 2>&1)

  if [ $? -eq 0 ]; then echo "Resize succeeded."; exit 0; fi

  echo "$OUTPUT"
  if echo "$OUTPUT" | grep -Eqi "capacity"; then
    echo "No capacity. Retrying in ${WAIT_SECONDS}s..."
    sleep "$WAIT_SECONDS"
  else
    echo "Unexpected error. Stopping."; exit 1
  fi
done
```

다음 날 로그는 3분마다 같은 줄의 반복이었습니다.

```text
[2026-06-01 08:58:49] Trying 4 OCPU / 24GB...
ServiceError: { "code": "InternalError", "message": "Out of host capacity.",
                "operation_name": "update_instance", "status": 500, ... }
No capacity. Retrying in 180s...
```

여기서 알게 된 것이 두 가지 있습니다.

- **용량이 언제 풀릴지는 OCI도 알려 주지 않는다.** 몇 분 만에 풀릴 수도, 인기 있는 무료 A1이라면 며칠이 걸릴 수도 있습니다. `oci compute compute-capacity-report create`로 지금 용량을 조회할 수는 있지만, `AVAILABLE`이 나와도 다른 사람과 경쟁이라 확보가 보장되지는 않습니다.
- **사양 변경이 성공하는 순간 서버가 재부팅될 수 있다.** 서비스를 올린 뒤에 스크립트가 성공하면 운영 중인 서비스가 갑자기 끊깁니다. 그래서 늘리는 것을 기다리기보다, **있는 사양으로 먼저 배포하고 실제 메모리 사용량을 본 뒤 결정**하기로 했습니다. 그리고 생각을 바꿨습니다. 무료 한도를 서버 한 대에 몰아 주면 다음에 다른 서비스를 올릴 자리가 없어집니다. 그래서 포트폴리오 서버는 1 OCPU / 6GB로 두고, **나머지 한도는 나중에 쓸 곳을 위해 나눠 두기로** 했습니다.

## 서버는 켜졌는데 접속이 안 된다

6월 1일, 서버를 설정하려고 SSH로 접속했는데 연결이 되지 않았습니다. 콘솔에는 분명 `Running`이었습니다.

`Running`은 **전원이 켜졌다**는 뜻일 뿐, 바깥에서 들어올 길이 있다는 뜻이 아니었습니다. 막힌 곳은 세 군데였습니다.

| 막힌 곳 | 원인 | 한 일 |
| --- | --- | --- |
| 네트워크 경로 | VCN에 **인터넷 게이트웨이가 없고**, 라우팅 테이블에 `0.0.0.0/0` 경로가 없었다 | 인터넷 게이트웨이를 만들고 라우팅 규칙 추가 → `Test-NetConnection`으로 22번 포트 열림 확인 |
| SSH 키 파일 | Windows에서 키 파일 권한이 너무 넓어 `Bad permissions` | `icacls`로 상속 권한을 끊고 내 계정만 남김 |
| 서버 안 방화벽 | OCI Ubuntu 이미지의 iptables에 22번 다음 `REJECT` 규칙이 있어, 보안 목록에서 80·443을 열어도 막힘 | `REJECT`보다 앞에 80·443 허용 규칙을 넣고 `netfilter-persistent`로 저장 |

HTTPS 인증서에서도 한 번 더 막혔습니다. Teammate에 쓰려던 무료 도메인 `kro.kr`은 Let's Encrypt가 `too many certificates (50) already issued for "kro.kr"`로 발급을 거절했습니다. 같은 상위 도메인을 쓰는 사람이 많아 주간 발급 한도에 걸린 것이라, `teammate.o-r.kr`로 바꿔 발급받았습니다. 이 과정은 [OCI 서버 한 대에 서비스 여러 개를 Docker Compose로 배포하기](/blog/oci-docker-compose-deploy)에 더 자세히 적었습니다.

## 지금

그 서버에서 지금 세 가지 서비스가 돌고 있습니다.

| 서비스 | 주소 | 구성 |
| --- | --- | --- |
| [Calainder](/projects/calainder) | `calainder.kr` | Spring 서버 + AI 모듈 + 크롤러 모듈 |
| [Teammate](/projects/teammate) | `teammate.o-r.kr` | Spring 웹 + AI 평가 모듈 |
| 피드백 API | 내부용 | 두 서비스가 함께 쓰는 FastAPI + Firestore |

호스트의 Nginx가 도메인으로 요청을 나눠 각 컨테이너로 넘기고, 바깥에는 Spring 서버 두 개만 열어 두었습니다. 6월 1일 서버를 연 뒤 Calainder는 이 서버에서 v1.5.2(6월 11일)까지 배포했고, 2026년 10월 28일에 확인했을 때도 두 사이트 모두 정상 응답(`200`)을 돌려줬습니다.

<!-- [확인 필요] 그동안 요금이 0원이었는지, 서버를 다시 켜거나 손본 적이 있는지 적으면 "유지해 왔다"가 더 구체적이 됩니다. -->

서버 사양은 **1 OCPU / 메모리 6GB / 네트워크 1Gbps**입니다. 계정의 무료 한도 4 OCPU / 24GB 중 4분의 1만 이 서버에 배정했고, 남은 3 OCPU / 18GB는 다음에 올릴 서비스를 위해 비워 두었습니다. 포트폴리오 서비스 세 개는 그 4분의 1로 충분히 돌아가고 있습니다.

## 돌아보며

- **무료 클라우드의 비용은 돈이 아니라 시간이다.** 재고가 보이지 않으니 기다리는 것밖에 할 수 있는 게 없었고, 그 기다림을 사람 대신 스크립트가 하게 만든 것이 핵심이었다.
- **재시도에는 멈출 조건과 중복 확인이 함께 있어야 한다.** 재고 부족만 다시 시도하고 그 밖의 오류는 멈추게 한 것은 잘했지만, 이미 만들어졌는지 확인하지 않아 서버가 두 대 생겼다.
- **"켜졌다"와 "접속된다"는 다르다.** 클라우드 서버는 네트워크 경로(게이트웨이·라우팅), 클라우드 방화벽(보안 목록), 서버 안 방화벽(iptables)을 모두 열어야 바깥과 통한다.
- **크게 시작하지 말고 작게 잡아 재 보고 늘린다.** 4 OCPU / 24GB를 기다리는 대신 1 OCPU / 6GB로 먼저 띄운 덕분에 서비스를 늦추지 않았고, 다섯 달 동안 그 사양으로 충분했다. 무료 한도도 한 서버에 몰지 않고 나눠 두면 다음 프로젝트를 올릴 자리가 남는다. 다만 메모리 사용량을 실제로 재 보지는 않아서, 다음에는 `docker stats`로 컨테이너별 사용량부터 확인하려 한다.
