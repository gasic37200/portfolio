---
title: "휴대폰 번호를 HMAC으로 비교하고 AES-256-GCM으로 암호화해 보관하기"
summary: "중복 비교에는 HMAC SHA-256 해시를, 화면에는 마지막 4자리만, 당첨자 연락에는 AES-256-GCM 암호문을 쓰고 복호화는 관리자 인증을 거친 당첨자 CSV에서만 하도록 나눴습니다."
date: "2026-06-09"
tags:
- 설계
- 보안
- 개인정보
projects: ["korea-score-predictor"]
decision:
  question: "중복 참여 판단, 당첨자 연락, 최소 노출이라는 세 요구를 휴대폰 번호 하나로 어떻게 동시에 만족시킬까"
  choice: "정규화한 번호를 서버 secret으로 HMAC SHA-256 해시해 비교에 쓰고, 화면은 마지막 4자리로 마스킹하며, 원본은 키가 설정된 경우에만 AES-256-GCM으로 암호화해 두고 관리자 인증을 거친 당첨자 CSV에서만 복호화한다."
  reasons:
    - "HMAC은 같은 번호와 같은 키에서 늘 같은 값을 내 중복 비교에 쓸 수 있고, 키 없이는 후보 번호를 해시해 맞춰 볼 수 없다."
    - "GCM은 매번 새 IV로 암호화해 같은 번호도 다른 암호문이 되므로 비교에는 못 쓰지만, 인증 태그로 변조나 다른 키를 복호화 단계에서 잡아낸다."
    - "복호화를 부르는 곳을 당첨자 CSV 조회 한 곳으로 묶어, 원본 번호가 보이는 경로를 하나로 줄였다."
  tradeoff: "암호화 키를 넣기 전에 제출된 행은 원본을 되살릴 수 없고, 운영 중에 키를 바꾸면 기존 행을 복호화할 수 없다. 키와 해시 secret이 서버 환경 변수에만 있어, 배포 환경에 키가 빠지면 CSV가 조용히 마스킹 번호로 나간다."
---

> Korea Score Predictor는 매장 고객이 QR로 접속해 경기 스코어를 예측하는 이벤트 웹앱이고, 참여할 때 휴대폰 번호를 받습니다. 이 글은 번호 하나에 걸린 세 요구를 어떤 원리의 도구로 나눴는지 정리합니다. 구현은 Codex와 함께 했고, 근거는 저장소의 [`src/lib/crypto.ts`](https://github.com/gasic37200/korea-score-predictor/blob/main/src/lib/crypto.ts), [`PRIVACY.md`](https://github.com/gasic37200/korea-score-predictor/blob/main/PRIVACY.md), PR [#1](https://github.com/gasic37200/korea-score-predictor/pull/1)입니다.

## 배경과 제약

휴대폰 번호에는 성격이 다른 요구 세 가지가 걸려 있었습니다.

| 요구 | 필요한 것 |
| --- | --- |
| 같은 번호의 중복 참여 판단 | 번호끼리 **같은지 비교**할 수 있어야 함 |
| 당첨자에게 알림 문자 | **원본 번호**가 필요함 |
| 관리자 화면·결과 화면 | 번호가 **최소한으로만** 보여야 함 |

그리고 처음부터 정해 둔 조건이 있었습니다.

- **프로젝트 규칙(`AGENTS.md`).** "원본 휴대폰 번호는 기본적으로 저장하지 않는다", "당첨자 연락 등으로 원본 번호가 꼭 필요하면 암호화해서 저장한다", "해시 secret과 암호화 key는 브라우저에 노출하지 않는다".
- **번호 형식이 좁다.** 입력은 숫자만 남겨 정규화하고, `^010\d{8}$`만 받는다([`validation.ts`](https://github.com/gasic37200/korea-score-predictor/blob/main/src/lib/validation.ts)). 가능한 번호는 1억(10^8)개다.
- **민감한 처리는 서버에서만.** 제출은 Next.js Server Action, 관리자 조회는 `server-only` helper에서 하고, 키는 서버 환경 변수로만 둔다.

결정 기준은 세 가지로 잡았습니다.

1. **비교** — 원본을 저장하지 않고도 같은 번호인지 판단할 수 있다.
2. **복원** — 당첨자에게만, 필요할 때만 원본을 되살릴 수 있다.
3. **노출 경로** — 원본이 보이는 곳이 하나뿐이다.

## 먼저 알아야 할 원리

### HMAC은 비밀 키를 섞은 해시다

RFC 2104는 HMAC을 암호학적 해시 함수와 비밀 공유 키를 함께 쓰는 메시지 인증 방식으로 정의하고, 키는 무작위로 고르고 비밀로 지켜야 한다고 적습니다([RFC 2104](https://datatracker.ietf.org/doc/html/rfc2104)). Node.js에서는 `crypto.createHmac(algorithm, key)`로 만들고, 문서는 무작위 원천에서 만든 키라면 길이가 해시의 블록 크기(SHA-256은 512비트)를 넘지 않는 것이 좋다고 안내합니다([Node.js crypto: createHmac](https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options)).

해시이므로 같은 입력과 같은 키는 늘 같은 값을 냅니다. 그래서 `phone_hash`끼리 비교하면 원본 없이도 같은 번호인지 알 수 있습니다.

### 키 없는 해시는 번호 형식이 좁으면 맞춰 볼 수 있다

가능한 번호가 `010`으로 시작하는 1억 개뿐이므로, 키 없이 SHA-256만 썼다면 DB를 본 사람이 1억 개 후보를 모두 해시해 표와 맞춰 볼 수 있습니다. 이 부분은 문서 인용이 아니라 검증 규칙으로 계산한 경우의 수입니다. HMAC은 같은 계산에 서버의 `PHONE_HASH_SECRET`이 필요해, DB만으로는 후보를 맞춰 볼 수 없습니다.

### GCM은 암호화와 함께 인증 태그를 만든다

AES-256-GCM은 인증 암호화(AEAD) 방식입니다. Node.js 문서에 따르면 `cipher.getAuthTag()`는 `cipher.final()`로 암호화를 끝낸 뒤 부를 수 있고, GCM의 태그 길이는 기본 16바이트입니다. 복호화할 때는 `decipher.final()` 전에 `decipher.setAuthTag()`로 태그를 넣어야 하고, 태그가 없거나 암호문이 변조됐으면 `decipher.final()`이 예외를 던집니다([Node.js crypto: getAuthTag](https://nodejs.org/api/crypto.html#ciphergetauthtag), [setAuthTag](https://nodejs.org/api/crypto.html#deciphersetauthtagbuffer-encoding)). 다른 키로 복호화하면 태그 검증이 맞지 않으므로 같은 방식으로 실패합니다.

### GCM의 IV(nonce)는 같은 키에서 겹치면 안 된다

RFC 5116은 같은 키로 하는 서로 다른 암호화에는 nonce가 반드시 달라야 하고, 길이는 12옥텟이 권장이라고 적습니다. GCM에서 nonce를 다시 쓰면 두 평문의 XOR이 드러나고, 내부 해시 키가 알려져 이후 위조가 쉬워진다고 경고합니다([RFC 5116 §2.1, §5.1.1](https://datatracker.ietf.org/doc/html/rfc5116)). Node.js 문서는 IV가 보통 비밀일 필요는 없어 암호문과 함께 보내도 된다고 설명합니다([Node.js crypto: createCipheriv](https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options)).

그래서 암호화할 때마다 12바이트 IV를 새로 만들고 암호문 옆에 함께 저장합니다. 이 때문에 같은 번호도 매번 다른 암호문이 되어, 암호문으로는 중복 비교를 할 수 없습니다. 비교용 해시를 따로 두는 이유입니다.

## 결정해야 했던 것

**원본을 기본적으로 저장하지 않는다는 규칙을 지키면서, 비교·연락·최소 노출을 어떻게 함께 만족시킬까.**

처음 구현은 규칙대로 `phone_hash`와 `phone_last4`만 저장했습니다. 그런데 당첨자 CSV에도 `010-****-1234`만 나와 당첨자에게 연락할 방법이 없었습니다. 해시는 되돌릴 수 없어, 그때까지 제출된 행은 원본을 복구할 수 없었습니다(경위는 [프로젝트 페이지](/projects/korea-score-predictor) 트러블슈팅 박스).

## 검토한 선택지

### 원본 번호를 다루는 방법

| 선택지 | 장점 | 단점 | 이 프로젝트에서 |
| --- | --- | --- | --- |
| 원본 평문 저장 | 세 요구가 모두 쉬움 | DB와 관리자 화면에 원본이 늘 존재 | 규칙(`AGENTS.md`)상 처음부터 제외 |
| 해시 + 마지막 4자리만 저장 (MVP 첫 구현) | 원본이 저장소 어디에도 없음 | 당첨자 연락 불가 (기준 2 위반) | 시도 후 버림 |
| **해시 + 마지막 4자리 + 키가 있을 때만 AES-256-GCM 암호문** | 비교·표시는 그대로, 원본은 키를 가진 서버만 복원 | 키 관리 부담, 키 이전에 제출된 행은 복원 불가 | **채택** |

### 비교용 값

| 선택지 | 판단 |
| --- | --- |
| **HMAC SHA-256 + `PHONE_HASH_SECRET`** | 채택. 처음부터 `AGENTS.md`에 정해 둔 방식이다 |
| 키 없는 SHA-256 (돌아보면) | 당시 검토 기록은 없다. 지금 보면 1억 개 후보를 모두 해시해 맞춰 볼 수 있어 쓰지 않는 이유가 분명하다 |
| 암호문끼리 비교 | IV가 매번 달라 같은 번호도 암호문이 다르다. 비교에 쓸 수 없다 |

## 이 방법을 고른 이유

1. **비교** — 키를 섞은 HMAC은 같은 번호면 같은 값이 나와 중복 판단에 충분하고, DB만 가진 사람이 후보 번호를 맞춰 볼 수 없습니다.
2. **복원** — 원본은 GCM 암호문으로만 두고, 복호화는 실제 결과와 일치한 예측 행에만 합니다. 인증 태그 덕분에 변조되거나 다른 키로 만든 암호문은 잘못된 번호로 풀리지 않고 실패합니다.
3. **노출 경로** — `decryptPhoneNumber`를 부르는 곳은 `getAdminExportRows` 하나이고, 이 결과는 관리자 인증을 거친 `/admin/export`로만 나갑니다. 관리자 화면은 계속 마스킹 번호만 보여 줍니다.

## 구현 코드

암호화와 복호화([`src/lib/crypto.ts`](https://github.com/gasic37200/korea-score-predictor/blob/main/src/lib/crypto.ts))입니다. 저장 형식은 `v1.IV.인증태그.암호문`(각각 base64url)입니다.

```ts
export function hashPhoneNumber(normalizedPhone: string) {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) throw new Error("PHONE_HASH_SECRET is not configured.");
  return createHmac("sha256", secret).update(normalizedPhone).digest("hex");
}

export function encryptPhoneNumber(normalizedPhone: string) {
  const key = getEncryptionKey();
  if (!key) return null; // 키가 없으면 원본을 남기지 않는다

  const iv = randomBytes(12); // 암호화마다 새 96비트 IV
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedPhone, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag(); // final() 뒤에만 부를 수 있다

  return ["v1", iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptPhoneNumber(encryptedPhone: string | null) {
  const key = getEncryptionKey();
  if (!key || !encryptedPhone) return null;

  const [version, ivValue, authTagValue, encryptedValue] = encryptedPhone.split(".");
  if (version !== "v1" || !ivValue || !authTagValue || !encryptedValue) return null;

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  // 태그가 맞지 않으면(변조, 다른 키) final()이 예외를 던진다
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
```

키는 64자리 16진수면 그대로 32바이트로 쓰고, 아니면 문자열의 SHA-256 다이제스트(32바이트)를 키로 씁니다.

CSV 경로([`src/app/admin/export/route.ts`](https://github.com/gasic37200/korea-score-predictor/blob/main/src/app/admin/export/route.ts))는 관리자 인증이 없으면 `401 Unauthorized`를 돌려주고, 복호화하지 못한 행은 마스킹 번호로 내보냅니다.

```ts
if (!isAdminConfigured() || !(await isAdminAuthenticated())) {
  return new NextResponse("Unauthorized", { status: 401 });
}
const rows = await getAdminExportRows(); // 실제 결과와 일치한 예측만, 여기서만 복호화
// 번호 칸: row.exportPhone ?? row.maskedPhone
```

## 구현하며 부딪힌 것

다음 날 CSV에서 번호가 다시 마스킹돼 나왔습니다. 당시 원인 후보로 배포 환경에 키가 없음, 키를 넣기 전에 제출된 행, 제출 때와 다른 키 세 가지를 짚었고, 배포 문서의 환경 변수 목록에 `PHONE_ENCRYPTION_KEY`가 빠진 것을 찾아 추가했습니다([bf75ebd](https://github.com/gasic37200/korea-score-predictor/commit/bf75ebd)). 지금 코드를 다시 보면, 마스킹으로 내보내는 경우는 키가 없거나 `encrypted_phone`이 null(또는 형식이 `v1`이 아님)일 때뿐입니다. 키가 다르면 `decipher.final()`이 예외를 던져 CSV 생성 자체가 실패하므로, "마스킹돼 나왔다"는 증상은 앞의 두 경우를 가리킵니다. 키를 넣은 뒤 번호가 풀린 것을 확인한 기록은 남아 있지 않습니다.

참여 동의 문구에는 "관리자 화면에는 마스킹된 번호만 표시되며, 실제 당첨자에게 알림 문자를 보내야 할 때에만 서버에서 복호화된 번호를 CSV로 확인한다"는 내용을 넣었습니다([72acb55](https://github.com/gasic37200/korea-score-predictor/commit/72acb55)).

## 검증

- 저장소에서 `decryptPhoneNumber`를 부르는 곳은 `src/lib/admin.ts`의 `getAdminExportRows` 한 곳이고, `encryptPhoneNumber`를 부르는 곳은 제출 Server Action 한 곳입니다(저장소 검색).
- `/admin/export`는 관리자 인증이 없으면 `401`을 돌려주고, CSV에는 실제 결과와 정확히 일치한 예측만 담습니다(`isWinningPrediction`).
- 변경 뒤 `npm run lint`, `npm run typecheck`, `npm run build`가 통과했습니다. 저장소에 테스트 코드는 없어, 암호화·복호화 왕복이나 다른 키로 복호화할 때의 실패는 자동화 테스트로 고정되어 있지 않습니다.

## 감수한 것과 다음

- **키 이전 행과 키 교체.** 키를 넣기 전에 제출된 행은 원본이 없고, 키를 바꾸면 기존 암호문은 복호화되지 않습니다. 운영 중에는 같은 키를 유지해야 하고, 키를 바꿔야 한다면 옛 키로 풀어 새 키로 다시 암호화하는 절차가 필요합니다(`v1` 버전 접두사는 그때 형식을 구분하는 데 쓸 수 있습니다).
- **키가 빠져도 조용히 동작.** 키가 없으면 암호화는 null, CSV는 마스킹으로 넘어갑니다. 서버를 띄울 때 키가 없으면 경고를 남기는 확인이 다음 과제입니다.
- **보관 기간.** `PRIVACY.md`에는 "연락 목적이 끝나면 암호화된 휴대폰 번호부터 삭제한다"고 적었지만, 이를 자동으로 하는 코드는 확인하지 못했습니다.

## 배운 점

- 번호 하나도 비교·표시·연락으로 나누면 요구마다 다른 도구(HMAC, 마스킹, AEAD 암호화)를 고를 수 있다.
- 입력 공간이 좁은 값은 키 없는 해시로 숨길 수 없다. 해시에 비밀 키를 섞어야 DB만으로 맞춰 볼 수 없다.
- GCM은 IV가 매번 달라 비교에는 못 쓰고, 인증 태그 때문에 다른 키로는 틀린 값이 아니라 예외가 난다. 이 차이를 알아야 "마스킹돼 나온다"는 증상에서 원인을 좁힐 수 있다.
