---
title: "Spring Security에서 JWT 인증이 동작하는 흐름"
summary: "요청 하나가 Spring Security 필터 체인을 지나며 JWT로 인증되고, 401·403이 어디서 만들어지는지 RePlant 코드로 따라갔습니다. 로그인·재발급·로그아웃, 카카오 로그인, SSE 비동기 디스패치까지 정리했습니다."
date: "2026-10-28"
tags:
- Spring Security
- JWT
- 백엔드 기초
draft: true
---

<!--
  임시 글 작성 메모 (사이트에는 보이지 않음)
  - JWT 시리즈 2편. 1편은 /posts/jwt-structure (JWT 구조·서명·Access/Refresh).
  - 그림은 public/images/posts/spring-security-jwt/ 에 있습니다.
  - 코드 기준: 팀 백엔드 develop 브랜치 af39580.
  - 공개할 때는 frontmatter의 draft: true 줄을 지우세요. 1편보다 먼저 공개하지 않습니다.
-->

> **한눈에 보기**
>
> - Spring Security는 **서블릿 필터 체인 안에 들어간 필터 묶음**이다. JWT 인증도 그 묶음 안에 필터 하나(`JwtAuthenticationFilter`)를 끼워 넣는 일이다.
> - JWT 필터는 토큰을 검증해 **`SecurityContext`에 `Authentication`을 넣기만** 한다. 막을지 말지는 뒤에 있는 `AuthorizationFilter`가 정한다.
> - 거부되면 `ExceptionTranslationFilter`가 갈라 준다. **익명이면 `AuthenticationEntryPoint`(401), 로그인했는데 권한이 없으면 `AccessDeniedHandler`(403)** 다.
> - 컨트롤러의 `@AuthenticationPrincipal AuthMember`는 JWT 필터가 넣어 둔 `principal`을 꺼낸 것이다.
> - 이 글은 팀원이 구현한 로그인·JWT·보안 코드를 읽으며 정리했다. 내가 직접 넣은 부분은 SSE용 `ASYNC` 허용 한 줄과 택배 웹훅 `permitAll` 경로다.

[1편 JWT를 처음부터 다시](/posts/jwt-structure)에서는 JWT **그 자체**를 봤습니다. 세 부분, 서명, Access와 Refresh를 나누는 이유였습니다. 이번 글은 그 토큰이 **Spring Security 안에서 실제로 어떻게 쓰이는지**를 봅니다.

[RePlant Market](/projects/replant) 팀 프로젝트에서 로그인과 JWT, 보안 설정은 팀원이 맡았습니다. 나는 그 위에 SSE 알림과 택배 웹훅을 붙이면서 설정을 몇 줄 고쳤습니다. 고칠 때는 "이 줄이 왜 필요한지"를 정확히 몰랐습니다. 그래서 면접에서 설명할 수 있을 만큼 코드를 다시 따라가 봤습니다. 아래 코드는 팀 백엔드 저장소 `develop` 브랜치 기준입니다. 버전은 Spring Boot 4.1, 즉 Spring Security 7과 Jakarta Servlet입니다.

## 1. Spring Security의 큰 그림

![DelegatingFilterProxy, FilterChainProxy, SecurityFilterChain 순서와 RePlant 체인 안의 주요 필터를 보여 주는 그림](/images/posts/spring-security-jwt/01-security-filter-chain.svg)

Spring Security는 **서블릿 필터**로 동작합니다. 요청이 `DispatcherServlet`과 컨트롤러에 닿기 전에 막아야 하기 때문입니다. 필터와 인터셉터가 서는 층의 차이는 [서블릿, Spring MVC, Spring Boot 정리](/posts/servlet-spring-mvc-boot)에 따로 적었습니다.

들어가는 길은 세 단계입니다.

1. **`DelegatingFilterProxy`** — Tomcat에 등록되는 평범한 서블릿 필터. 스스로 일하지 않고 스프링 빈에게 넘긴다. Tomcat은 스프링 빈을 모르기 때문에 이런 다리가 필요하다.
2. **`FilterChainProxy`** — 일을 받는 스프링 빈. 요청에 맞는 `SecurityFilterChain`을 고른다.
3. **`SecurityFilterChain`** — 실제 보안 필터 목록. `SecurityConfig`에서 `@Bean`으로 만드는 그것이다.

RePlant는 `SecurityFilterChain`을 하나만 만듭니다. 그래서 모든 요청이 같은 필터 목록을 지납니다. 그 목록에서 이 글에 나오는 필터는 그림의 여섯 줄 정도입니다. 핵심은 순서입니다.

- **앞쪽**은 "누구인지 알아내는" 필터다. JWT 필터가 여기 있다.
- **뒤쪽**은 "들여보낼지 정하는" 필터다. `AuthorizationFilter`가 맨 끝에 있다.
- 그 사이의 `ExceptionTranslationFilter`가 거부를 401·403 응답으로 바꾼다.

## 2. 인증과 인가, 그리고 SecurityContext

### 2-1. 인증(Authentication) vs 인가(Authorization)

| 구분 | 인증 | 인가 |
| --- | --- | --- |
| 묻는 것 | 너는 **누구**인가 | 너는 이걸 **해도 되는가** |
| RePlant에서 하는 곳 | `JwtAuthenticationFilter` | `AuthorizationFilter` (`authorizeHttpRequests` 규칙) |
| 실패하면 | 401 Unauthorized | 403 Forbidden |

401의 이름이 Unauthorized라서 헷갈리지만, 실제 뜻은 "인증 안 됨"입니다. "누군지는 아는데 안 된다"가 403입니다.

### 2-2. 인증 결과를 담는 세 겹의 상자

![SecurityContextHolder 안의 SecurityContext 안의 Authentication과 principal, credentials, authorities가 어디서 쓰이는지 보여 주는 그림](/images/posts/spring-security-jwt/02-security-context.svg)

인증 결과는 세 겹의 상자에 담깁니다.

- **`SecurityContextHolder`** — 지금 요청을 처리하는 스레드의 보안 정보를 보관하는 곳. 기본은 `ThreadLocal`이라 스레드마다 따로 갖는다.
- **`SecurityContext`** — 그 안의 상자. `Authentication` 하나를 들고 있다.
- **`Authentication`** — "이 요청은 누구의 것인가"라는 결과물. 세 가지를 담는다.
  - `principal` — 누구인가. RePlant에서는 `AuthMember`.
  - `credentials` — 비밀번호 같은 증명 수단. 검증이 끝나면 필요 없어서 `null`.
  - `authorities` — 무엇을 할 수 있나. `ROLE_MEMBER` 같은 권한 목록.

RePlant의 `principal`은 아주 작은 record입니다.

```java
// common/security/AuthMember.java
public record AuthMember(Long memberId, String role) {
}
```

회원 엔티티를 통째로 넣지 않고 **토큰에 들어 있던 두 값만** 넣습니다. 요청마다 DB를 조회하지 않기 위해서입니다. 1편에서 말한 "Access 토큰은 서명만 본다"가 여기서도 지켜집니다.

## 3. RePlant SecurityConfig 해부

전체 설정은 `common/security/SecurityConfig.java`의 메서드 하나입니다. 위에서부터 끊어서 봅니다.

### 3-1. 쓰지 않는 기능을 끈다

```java
// SecurityConfig.java
// 세션·폼 로그인을 쓰지 않는 REST API이므로 끔
.csrf(AbstractHttpConfigurer::disable)
.httpBasic(AbstractHttpConfigurer::disable)
.formLogin(AbstractHttpConfigurer::disable)
.logout(AbstractHttpConfigurer::disable)
```

| 끈 것 | 원래 하는 일 | 끈 이유 |
| --- | --- | --- |
| `csrf` | 쿠키로 인증하는 요청에 CSRF 토큰을 요구 | Access 토큰은 쿠키가 아니라 `Authorization` 헤더로 온다. 다른 사이트가 이 헤더를 자동으로 붙일 수 없다 |
| `httpBasic` | `Authorization: Basic 아이디:비번` 인증 | 쓰지 않음 |
| `formLogin` | 로그인 HTML 폼과 `/login` 처리, 세션 저장 | 로그인은 JSON API(`/api/v1/auth/login`)로 직접 만든다 |
| `logout` | `/logout`에서 세션을 끊는 기본 필터 | 끊을 세션이 없다. 로그아웃은 Refresh 토큰을 지우는 API로 직접 만든다 |

CSRF를 끈 이유는 하나만 기억하면 됩니다. **CSRF는 "브라우저가 자동으로 실어 보내는 인증 정보"를 노린다.** 헤더에 직접 붙이는 Bearer 토큰은 자동으로 실리지 않습니다.

다만 Refresh 토큰은 쿠키입니다. 그래서 `/reissue`와 `/logout`은 CSRF와 완전히 무관하지는 않습니다. 이 부분은 쿠키의 `SameSite=Lax`가 받쳐 줍니다. `Lax` 쿠키는 다른 사이트에서 보낸 POST 요청에는 실리지 않습니다. 이 내용은 5장에서 다시 봅니다.

### 3-2. 세션을 만들지 않는다

```java
// 서버에 로그인 상태를 저장하지 않음. 매 요청 토큰으로 인증
.sessionManagement(session -> session
        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
```

`STATELESS`는 Spring Security가 **`HttpSession`을 만들지도, 거기서 인증 정보를 꺼내지도 않게** 합니다. 그래서 매 요청은 빈 `SecurityContext`로 시작하고, JWT 필터가 그때그때 채웁니다. 요청이 끝나면 비워집니다. 이게 "서버가 로그인 상태를 기억하지 않는다"는 말의 실제 모습입니다.

### 3-3. 401·403을 누가 쓸지 정한다

```java
// 401, 403 JSON 응답
.exceptionHandling(exception -> exception
        .authenticationEntryPoint(new JwtAuthenticationEntryPoint())
        .accessDeniedHandler(new JwtAccessDeniedHandler()))
```

기본값 그대로 두면 Spring Security가 만든 기본 응답이 나갑니다. 팀은 프론트가 다른 API와 같은 모양으로 받을 수 있게 **팀 공통 `ApiResponse` JSON**으로 바꿨습니다.

여기서 한 가지가 중요합니다. 이 단계는 **필터 안**입니다. 컨트롤러 예외를 처리하는 `@RestControllerAdvice`는 `DispatcherServlet` 안에서 동작해서 여기까지 오지 않습니다. 그래서 응답을 직접 씁니다.

```java
// handler/ErrorResponseWriter.java
// 필터 단계라 @RestControllerAdvice가 동작하지 않아서 직접 응답을 씀
response.setStatus(errorCode.getStatus().value());
response.setContentType(MediaType.APPLICATION_JSON_VALUE);
response.getWriter().write(JSON_MAPPER.writeValueAsString(ApiResponse.error(errorCode)));
```

### 3-4. 인가 규칙: 위에서부터 첫 번째로 맞는 규칙

```java
.authorizeHttpRequests(auth -> auth
        .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
        .requestMatchers(PUBLIC_PATHS).permitAll()
        .requestMatchers(HttpMethod.POST, "/api/v1/users", "/api/v1/users/social").permitAll()
        .requestMatchers(HttpMethod.GET, "/api/v1/users/checkNickname").permitAll()
        .requestMatchers(HttpMethod.GET, "/api/v1/users/checkPhone").permitAll()
        .requestMatchers(HttpMethod.GET, "/api/v1/products/me", "/api/v1/products/me/**").authenticated()
        .requestMatchers(HttpMethod.GET, "/api/v1/products", "/api/v1/products/**").permitAll()
        .requestMatchers(HttpMethod.GET, "/api/v1/species", "/api/v1/species/**").permitAll()
        .requestMatchers(HttpMethod.POST, "/api/v1/webhooks/courier").permitAll()
        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
        .anyRequest().authenticated())
```

(주석과 예전 규칙 주석 처리 부분은 뺐습니다.)

`authorizeHttpRequests`는 규칙을 **위에서부터 차례로 보고, 처음 맞는 규칙 하나만** 적용합니다. 그래서 순서가 곧 의미입니다.

| 순서 | 규칙 | 뜻 |
| --- | --- | --- |
| 1 | `ASYNC` 디스패치 → `permitAll` | SSE 연결이 끝날 때의 비동기 디스패치는 통과 (7장) |
| 2 | `PUBLIC_PATHS` → `permitAll` | 헬스 체크, Swagger, `/api/v1/auth/**`, OAuth2 경로 |
| 3 | 회원가입·중복 확인 → `permitAll` | 로그인 전에 써야 하는 API |
| 4 | `GET /api/v1/products/me/**` → `authenticated` | "내 판매 목록"은 로그인 필요 |
| 5 | `GET /api/v1/products/**` → `permitAll` | 상품 구경은 누구나 |
| 6 | `GET /api/v1/species/**` → `permitAll` | 품종 조회는 누구나 |
| 7 | `POST /api/v1/webhooks/courier` → `permitAll` | 택배사 서버가 부르는 웹훅 |
| 8 | `/api/v1/admin/**` → `hasRole("ADMIN")` | 관리자만 |
| 9 | 나머지 전부 → `authenticated` | 로그인 필요 |

4번과 5번이 순서의 의미를 잘 보여 줍니다. `/api/v1/products/me`는 5번의 `/api/v1/products/**`에도 맞습니다. 4번이 위에 있어서 "내 상품"만 먼저 잡아 로그인을 요구합니다. 둘의 순서를 바꾸면 내 판매 목록이 누구에게나 열립니다.

마지막 9번도 중요합니다. 팀은 처음에 `anyRequest().permitAll()`로 열어 두었다가 `authenticated()`로 바꿨습니다. **허용할 경로만 적고 나머지는 모두 막는** 쪽이 안전합니다. 새 API를 만들고 규칙 추가를 깜빡해도 열리지 않고 닫히기 때문입니다.

7번 웹훅 경로는 내가 추가했습니다. 택배사 서버는 우리 회원이 아니라 JWT가 없습니다. 그래서 Security에서는 통과시키고, 웹훅 쪽에서 별도의 API 키(`custom.courier.webhook-api-key`)로 확인합니다.

> `hasRole("ADMIN")`은 권한 목록에 **`ROLE_ADMIN`** 이 있는지 봅니다. `hasRole`이 앞에 `ROLE_`을 붙여 비교하기 때문입니다. 그래서 JWT 필터가 권한을 만들 때 `"ROLE_" + role`을 씁니다(4장).

### 3-5. JWT 필터를 어디에 넣었나

```java
// 아이디·비밀번호 필터보다 먼저 JWT 필터 실행
.addFilterBefore(new JwtAuthenticationFilter(jwtProvider),
        UsernamePasswordAuthenticationFilter.class)
```

`addFilterBefore(A, B)`는 "A를 B 앞에 둔다"입니다. `UsernamePasswordAuthenticationFilter`는 폼 로그인 필터라서, `formLogin`을 끈 RePlant에서는 **실제로 체인에 들어가지 않습니다.** 그래도 Spring Security 안에서 필터 순서 번호가 정해져 있어서 **위치 기준점**으로 쓸 수 있습니다.

이 위치가 중요한 이유는 두 가지입니다.

- **익명 필터보다 앞이어야 한다.** `AnonymousAuthenticationFilter`는 `SecurityContext`가 비어 있으면 "익명 사용자"를 채운다. JWT 필터가 그 뒤에 있으면 이미 익명이 들어간 뒤라 순서가 꼬인다.
- **인가 필터보다 앞이어야 한다.** `AuthorizationFilter`가 규칙을 검사할 때 이미 누구인지 알고 있어야 한다.

JWT 필터 클래스에는 `@Component`가 없다는 점도 봐 둘 만합니다.

```java
// jwt/JwtAuthenticationFilter.java
// @Component X -> SecurityConfig에서 직접 생성해 Security 필터 체인에만 등록
public class JwtAuthenticationFilter extends OncePerRequestFilter {
```

Spring Boot는 `Filter` 타입의 빈을 발견하면 **서블릿 필터로도 자동 등록**합니다. 빈으로 만들면 Security 체인 안에서 한 번, 바깥 서블릿 필터로 또 한 번 돌 수 있습니다. `new`로 직접 만들어 체인에만 넣으면 이 문제가 없습니다.

### 3-6. 카카오 로그인 연결

```java
.oauth2Login(oauth2 -> {
    // state를 서명 쿠키에 저장 (기본값 HttpSession 대신)
    oauth2.authorizationEndpoint(endpoint ->
            endpoint.authorizationRequestRepository(authorizationRequestRepository));
    // 핸들러 빈이 정확히 1개 있을 때만 연결
    oauth2SuccessHandler.ifUnique(oauth2::successHandler);
    oauth2FailureHandler.ifUnique(oauth2::failureHandler);
})
```

`oauth2Login`을 켜면 OAuth2 로그인 필터 두 개가 체인에 들어갑니다. 자세한 흐름은 6장에서 봅니다. 성공·실패 핸들러를 `ObjectProvider`로 받는 이유는 모듈 경계 때문입니다. 보안 설정은 `common` 모듈에 있고, 로그인 후 처리는 `member` 모듈에 있습니다. `common`이 `member` 클래스를 직접 알지 않게 **타입으로만 찾아서** 연결합니다.

## 4. 요청 하나의 흐름

이제 로그인한 사용자가 `GET /api/v1/cart`를 보냈다고 하고 따라가 봅니다.

### 4-1. JwtAuthenticationFilter: 꺼내고, 검증하고, 넣는다

```java
// jwt/JwtAuthenticationFilter.java
String token = resolveToken(request);   // "Bearer " 뒤의 문자열, 없으면 null

if (token != null) {
  try {
    AuthMember authMember = jwtProvider.parseAccessToken(token);

    // 권한은 "ROLE_" 접두사를 붙여야 hasRole("SELLER")가 인식함
    UsernamePasswordAuthenticationToken authentication =
            new UsernamePasswordAuthenticationToken(
                    authMember,
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + authMember.role()))
            );
    SecurityContextHolder.getContext().setAuthentication(authentication);

  } catch (TokenException e) {
    // 이유만 기록. 인증이 필요한 경로라면 EntryPoint가 401을 응답.
    request.setAttribute(TOKEN_ERROR_ATTRIBUTE, e.getReason());
  }
}

filterChain.doFilter(request, response);
```

순서대로 보면 이렇습니다.

1. `Authorization` 헤더에서 `Bearer ` 뒤의 토큰을 꺼낸다. 없으면 아무것도 안 한다.
2. `JwtProvider.parseAccessToken`으로 검증하고 `AuthMember`를 만든다.
3. `UsernamePasswordAuthenticationToken`에 `principal`, `null`, 권한 목록을 담는다. 인자 세 개짜리 생성자는 **"인증 완료" 상태**로 만들어진다.
4. `SecurityContextHolder`에 넣는다.
5. **성공하든 실패하든** 다음 필터로 넘긴다.

5번이 이 필터의 핵심입니다. JWT 필터는 **막지 않습니다.** 실패해도 이유만 `request`에 적어 두고 넘깁니다. 이렇게 한 이유가 주석에 있습니다. 상품 목록 같은 `permitAll` 경로는 토큰이 만료됐어도 비회원으로 볼 수 있어야 합니다. 막을지 말지를 JWT 필터가 정하면 이게 안 됩니다. **판단은 인가 규칙에 맡기고, JWT 필터는 "누구인지"만 채웁니다.**

검증은 `JwtProvider`가 합니다.

```java
// JwtProvider.java
// 토큰 공통 검증, 서명-> 만료-> 타입
private Claims parse(String token, TokenType expectedType) {
  Claims claims;
  try {
    claims = parser.parseSignedClaims(token).getPayload();
  } catch (ExpiredJwtException e) {
    throw new TokenException(TokenException.Reason.EXPIRED, e);
  } catch (JwtException | IllegalArgumentException e) {
    throw new TokenException(TokenException.Reason.INVALID, e);
  }

  if (!expectedType.name().equals(claims.get(CLAIM_TYPE, String.class))) {
    throw new TokenException(TokenException.Reason.INVALID);
  }
  return claims;
}
```

실패 이유는 두 가지로만 나뉩니다. 만료면 `EXPIRED`, 나머지(서명 불일치, 형식 오류 등)는 모두 `INVALID`입니다. 마지막의 `type` 검사도 봐 둘 만합니다. RePlant는 카카오 신규 회원에게 **가입용 토큰(SIGNUP)** 도 같은 키로 발급합니다. 이 토큰을 Access 자리에 넣어도 `type`이 달라서 `INVALID`로 막힙니다.

### 4-2. 뒤쪽 필터들: 익명 채우기, 인가 검사, 예외 번역

JWT 필터 다음부터는 Spring Security 기본 필터입니다.

1. **`AnonymousAuthenticationFilter`** — `SecurityContext`가 아직 비어 있으면 **익명 사용자**(`AnonymousAuthenticationToken`)를 넣는다. 토큰이 없거나 검증에 실패한 요청이 여기서 "익명"이 된다.
2. **`ExceptionTranslationFilter`** — 자기 뒤에서 던져진 인증·인가 예외를 잡을 준비를 하고 다음으로 넘긴다.
3. **`AuthorizationFilter`** — 3-4의 규칙을 위에서부터 보고 판단한다. 거부하면 `AccessDeniedException`을 던진다.

거부 예외를 받은 `ExceptionTranslationFilter`는 **지금 사용자가 익명인지**를 봅니다.

- 익명이면 → "먼저 인증하라"는 뜻으로 **`AuthenticationEntryPoint`** 를 부른다 → 401.
- 인증된 사용자면 → "인증은 됐지만 안 된다"는 뜻으로 **`AccessDeniedHandler`** 를 부른다 → 403.

그래서 401과 403은 **JWT 필터가 아니라 `ExceptionTranslationFilter`가 고른 핸들러**가 만듭니다.

### 4-3. 경우별로 정리하면

![정상 토큰, 토큰 없음, 만료·위조, 권한 부족 네 경우가 JWT 필터, SecurityContext, AuthorizationFilter를 지나 어떤 응답이 되는지 비교한 표](/images/posts/spring-security-jwt/03-request-cases.svg)

EntryPoint는 JWT 필터가 남긴 메모를 읽어서 401의 **이유**를 나눠 줍니다.

```java
// handler/JwtAuthenticationEntryPoint.java
// 필터가 기록해 둔 실패 이유 (토큰이 없었으면 null)
Object reason = request.getAttribute(JwtAuthenticationFilter.TOKEN_ERROR_ATTRIBUTE);

if (reason == TokenException.Reason.EXPIRED) {
  ErrorResponseWriter.write(response, SecurityErrorCode.TOKEN_EXPIRED);
} else if (reason == TokenException.Reason.INVALID) {
  ErrorResponseWriter.write(response, SecurityErrorCode.INVALID_TOKEN);
} else {
  ErrorResponseWriter.write(response, SecurityErrorCode.UNAUTHORIZED);
}
```

| 경우 | JWT 필터 | 인증 필요 경로의 응답 | `permitAll` 경로의 응답 |
| --- | --- | --- | --- |
| 정상 토큰 | `Authentication` 저장 | 200 | 200 |
| 토큰 없음 | 아무것도 안 함 | 401 `UNAUTHORIZED` | 200 (비회원) |
| 만료 | `jwt.error = EXPIRED` | 401 `TOKEN_EXPIRED` | 200 (비회원) |
| 위조·형식 오류·타입 다름 | `jwt.error = INVALID` | 401 `INVALID_TOKEN` | 200 (비회원) |
| 권한 부족 (MEMBER → `/api/v1/admin/**`) | `Authentication` 저장 | 403 `FORBIDDEN` | — |

`TOKEN_EXPIRED`를 따로 나눈 이유는 프론트 때문입니다. 프론트는 이 코드를 보고 **"재발급을 시도할지"** 를 정할 수 있습니다. 만료면 `/reissue`를 부르고, 위조면 바로 로그인 화면으로 보내는 식입니다. 상태 코드는 둘 다 401이고, 응답 JSON의 `code` 값으로 구분합니다.

### 4-4. 컨트롤러에서 꺼내 쓰기

모든 필터를 통과하면 컨트롤러가 이렇게 받습니다.

```java
// market/cart/presentation/CartController.java
public ResponseEntity<CartResponse> find(@AuthenticationPrincipal AuthMember member) {
```

`@AuthenticationPrincipal`은 마법이 아닙니다. Spring Security가 등록한 인자 해석기가 `SecurityContextHolder`에서 `Authentication`을 꺼내고, 그 `getPrincipal()`을 파라미터에 넣어 줍니다. 그 `principal`은 4-1에서 JWT 필터가 넣은 `AuthMember`입니다. 즉 **필터에서 넣은 값을 같은 스레드의 컨트롤러가 꺼내는** 구조입니다.

주의할 점이 하나 있습니다. `permitAll` 경로에서 비회원이 오면 `principal`은 `AuthMember`가 아니라 익명 사용자 값입니다. 이때 타입이 맞지 않으면 파라미터에는 `null`이 들어갑니다. 그래서 `permitAll` 경로에서 `@AuthenticationPrincipal`을 쓴다면 `null`을 처리해야 합니다.

## 5. 로그인 · 재발급 · 로그아웃

![로그인, Access 만료 후 재발급과 회전, 로그아웃 때 브라우저, 서버, Redis 사이에 오가는 요청을 보여 주는 시퀀스 그림](/images/posts/spring-security-jwt/04-login-reissue-logout.svg)

세 API는 모두 `/api/v1/auth/**` 아래에 있어서 `PUBLIC_PATHS`로 **`permitAll`** 입니다. 로그인 전에 불러야 하고, 재발급은 Access가 이미 만료된 상태에서 부르기 때문입니다. 이 API들은 Access 토큰이 아니라 **Refresh 쿠키**로 사람을 확인합니다.

### 5-1. 로그인: Access는 Body로, Refresh는 쿠키로

`LoginService`는 이메일로 회원을 찾고, BCrypt로 비밀번호를 확인하고, 토큰 두 개를 만듭니다.

```java
// member/auth/application/LoginService.java
String role = member.getRole().name();
String accessToken = jwtProvider.createAccessToken(member.getId(), role);
String refreshToken = refreshTokenIssuer.issue(member.getId());
```

여기서 처음 알게 된 점이 있습니다. **RePlant의 Refresh 토큰은 JWT가 아닙니다.** 32바이트 랜덤 값을 Base64URL로 적은 문자열입니다.

```java
// member/auth/application/RefreshTokenIssuer.java
public static final Duration REFRESH_TOKEN_TTL = Duration.ofDays(1);
private static final int REFRESH_TOKEN_BYTES = 32; // 256비트 랜덤
```

Refresh는 어차피 서버(Redis)에서 확인하는 토큰이라, 안에 정보를 담고 서명할 이유가 없습니다. Redis 키에는 원문이 아니라 SHA-256 해시를 씁니다(1편 7장).

컨트롤러는 Access를 응답 Body에, Refresh를 `Set-Cookie`에 담습니다.

```java
// member/auth/presentation/support/RefreshTokenCookieFactory.java
return ResponseCookie.from(COOKIE_NAME, refreshToken)   // "refreshToken"
        .httpOnly(true)
        .secure(secure)
        .path(COOKIE_PATH)                               // "/api/v1/auth"
        .maxAge(maxAge)                                  // 1일 = Redis TTL
        .sameSite("Lax")
        .build();
```

| 속성 | 값 | 이유 |
| --- | --- | --- |
| `HttpOnly` | true | JS가 읽지 못해 XSS로 값을 훔치기 어렵다 |
| `Secure` | 설정값 (`COOKIE_SECURE`) | HTTPS에서만 보내기. 로컬·HTTP 배포에서는 false |
| `Path` | `/api/v1/auth` | 재발급·로그아웃 요청에만 실린다. 일반 API 요청에는 실리지 않는다 |
| `Max-Age` | 1일 | Redis TTL과 같게 맞춰 "쿠키는 있는데 Redis엔 없는" 상태를 줄인다 |
| `SameSite` | `Lax` | 다른 사이트에서 보내는 POST에는 실리지 않는다 |

`Path`를 좁힌 것이 눈에 띕니다. Refresh 토큰이 상품 조회 같은 요청마다 따라다니지 않으니, 새어 나갈 기회가 줄어듭니다.

### 5-2. 재발급: GETDEL로 한 번만, 그리고 회전

Access가 만료되면 프론트는 `TOKEN_EXPIRED`를 보고 `POST /api/v1/auth/reissue`를 부릅니다. 쿠키는 브라우저가 자동으로 실어 줍니다.

```java
// member/auth/application/TokenReissueService.java
// 기존 토큰 폐기 → 같은 토큰으로 재발급 불가
Long memberId = refreshTokenStore.findAndDelete(refreshToken)
        .orElseThrow(() -> new BusinessException(MemberErrorCode.INVALID_REFRESH_TOKEN));

// role은 토큰이 아니라 DB에서 다시 조회(판매자 등록 후 SELLER 반영)
Member member = memberRepository.findById(memberId)
        .orElseThrow(() -> new BusinessException(MemberErrorCode.INVALID_REFRESH_TOKEN));
```

`findAndDelete`는 Redis `GETDEL` 하나로 **꺼내기와 지우기를 동시에** 합니다.

```java
// member/auth/infrastructure/redis/RefreshTokenRedisStore.java
// 따로 조회 → 삭제하면 동시에 들어온 두 요청이 둘 다 통과할 수 있음 → 원자 처리로 한 번만 성공
String memberId = redisTemplate.opsForValue().getAndDelete(key(refreshToken));
```

그다음 새 Access와 **새 Refresh**를 발급합니다. 옛 Refresh는 이미 지워졌으니, 누가 그것을 훔쳐 나중에 내밀어도 `INVALID_REFRESH_TOKEN`(401)입니다. 이게 1편에서 본 **회전**의 실제 코드입니다.

`role`을 DB에서 다시 읽는 것도 이유가 있습니다. 회원이 판매자로 등록하면 `MEMBER`에서 `SELLER`로 바뀝니다. 다음 재발급 때 새 Access에 바뀐 권한이 반영됩니다. 반대로 말하면 **재발급 전까지는 옛 Access의 role이 그대로** 쓰입니다. 요청마다 DB를 보지 않기로 한 대가입니다.

### 5-3. 로그아웃: Refresh만 지운다

```java
// member/auth/application/LogoutService.java
// 쿠키가 없거나 이미 만료삭제된 토큰이어도 예외 없이 끝냄(로그아웃은 항상 성공)
public void logout(String refreshToken) {
  if (refreshToken == null || refreshToken.isBlank()) {
    return;
  }
  refreshTokenStore.delete(refreshToken);
}
```

컨트롤러는 같은 이름·같은 `Path`로 `Max-Age=0`인 쿠키를 보내 브라우저에서도 지웁니다. `Path`가 다르면 브라우저가 다른 쿠키로 보고 지우지 않아서, 발급할 때와 같은 팩토리(`expire()`)를 씁니다.

이미 나간 Access 토큰은 건드리지 않습니다. 최대 30분 동안은 서명 검증을 통과합니다. RePlant는 블랙리스트를 두지 않고 이 30분을 받아들였습니다. 이유는 1편 5-3에 적었습니다.

## 6. 카카오 로그인과 state 쿠키

카카오 로그인은 직접 만든 API가 아니라 Spring Security의 `oauth2Login`이 처리합니다. 흐름은 이렇습니다.

1. 프론트가 `/oauth2/authorization/kakao`로 이동한다.
2. OAuth2 리다이렉트 필터가 **인가 요청(state 포함)** 을 만들어 저장하고, 카카오 로그인 화면으로 보낸다.
3. 사용자가 카카오에서 동의하면 카카오가 `/login/oauth2/code/kakao?code=...&state=...`로 돌려보낸다.
4. OAuth2 로그인 필터가 저장해 둔 인가 요청을 꺼내 **state가 같은지** 확인하고, `code`로 카카오 토큰과 사용자 정보를 받는다.
5. 성공 핸들러(`SocialLoginSuccessHandler`)가 우리 서비스 기준으로 처리한다.

2번의 "저장"이 문제였습니다. Spring Security는 기본으로 인가 요청을 **`HttpSession`** 에 저장합니다. 그런데 RePlant는 `STATELESS`라 세션을 쓰지 않습니다. 그래서 팀원은 저장 위치를 **서명한 쿠키**로 바꾼 `CookieOAuth2AuthorizationRequestRepository`를 만들었습니다.

```java
// common/security/oauth2/CookieOAuth2AuthorizationRequestRepository.java
// OAuth2 인가 요청(state 포함)을 세션 대신 서명된 쿠키에 저장 (STATELESS 유지)
// 쿠키 값 = Base64url(직렬화한 인가 요청) + "." + Base64url(HMAC-SHA256 서명)
static final String COOKIE_NAME = "oauth2_auth_request";
static final Duration COOKIE_MAX_AGE = Duration.ofMinutes(5);
```

- **서명(HMAC-SHA256)** — 쿠키는 사용자가 고칠 수 있다. 서명이 맞을 때만 역직렬화해서, 조작된 값은 아예 읽지 않는다. 서명 키는 `jwt.secret`에서 **용도별로 파생한 별도 키**다.
- **5분, `HttpOnly`, `SameSite=Lax`** — 로그인 한 번에만 쓰는 값이라 짧게 둔다. 카카오에서 우리 서버로 돌아오는 이동은 다른 사이트에서 넘어오는 GET이라, `Lax`면 쿠키가 실린다.
- **한 번만 사용** — 콜백 처리 때 꺼내면서 쿠키를 지운다(`removeAuthorizationRequest`).

5번의 성공 핸들러는 JSON이 아니라 **리다이렉트**로 끝납니다. 기존 회원이면 Refresh 쿠키만 심고 프론트 `/oauth/callback`으로 보냅니다. 프론트는 거기서 `/reissue`를 불러 Access를 받습니다. 신규 회원이면 10분짜리 가입 토큰을 URL `#` 뒤에 붙여 보냅니다. `#` 뒤는 서버로 전송되지 않아서 서버 로그에 남지 않습니다.

## 7. SSE와 ASYNC 디스패치

이 부분은 내가 직접 겪고 고친 곳입니다. 자세한 과정은 [JWT로 인증하는 서버에 SSE 실시간 알림 붙이기](/blog/sse-jwt-async-dispatch)에 있고, 여기서는 Security 관점만 짧게 봅니다.

알림 구독 API는 `SseEmitter`를 돌려줍니다.

```java
// notification/presentation/NotificationController.java
@GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter subscribe(@AuthenticationPrincipal AuthMember member, HttpServletResponse response) {
```

1. 처음 요청(`REQUEST` 디스패치)은 JWT 필터와 인가 규칙을 정상으로 지난다. 컨트롤러가 `SseEmitter`를 돌려주면 응답은 열린 채로 남는다.
2. 이후 알림이 생기면 `send()`가 **열려 있는 응답에 바로 이벤트를 쓴다.** 이때는 필터를 다시 지나지 않는다.
3. 연결이 **끝날 때(완료·타임아웃·에러)** 서블릿 컨테이너가 같은 요청을 **`ASYNC` 디스패치**로 다시 보내 마무리한다. 이때 필터 체인을 다시 지난다.
4. 그런데 `JwtAuthenticationFilter`는 `OncePerRequestFilter`를 상속한다. `OncePerRequestFilter`는 기본으로 **`ASYNC` 디스패치에서는 다시 돌지 않는다.** 그래서 `SecurityContext`가 비고, 익명 사용자가 된다.
5. `AuthorizationFilter`는 `ASYNC` 디스패치에도 규칙을 적용한다. 구독 경로는 `anyRequest().authenticated()`라서 거부되고 401·403이 난다.

그래서 규칙 맨 위에 한 줄을 넣었습니다.

```java
// SSE 응답을 보내는 비동기 디스패치는 처음 요청에서 이미 인증을 거쳤으므로 통과시킨다
.dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
```

`ASYNC` 디스패치는 **이미 인증을 통과한 요청의 뒷정리**입니다. 밖에서 새로 들어온 요청이 아니라서 열어도 안전합니다. 그리고 "첫 번째로 맞는 규칙"이 적용되니, 경로 규칙보다 **위에** 있어야 합니다.

## 면접에서 물어보면

**Q. CSRF는 왜 껐나요?**
CSRF는 브라우저가 쿠키 같은 인증 정보를 **자동으로** 실어 보내는 점을 노립니다. RePlant의 Access 토큰은 `Authorization` 헤더에 프론트가 직접 붙이니 자동으로 실리지 않습니다. 그리고 세션도 쓰지 않습니다. 다만 Refresh 토큰은 쿠키라서 재발급·로그아웃 API는 `SameSite=Lax`와 좁은 `Path`로 위험을 줄였습니다.

**Q. JWT 필터는 어디에 넣었고, 왜 거기인가요?**
`addFilterBefore(..., UsernamePasswordAuthenticationFilter.class)`로 넣었습니다. 그 필터는 폼 로그인을 꺼서 실제로는 없지만, 순서 기준점으로 씁니다. 익명 사용자를 채우는 필터와 인가를 검사하는 `AuthorizationFilter`보다 **앞**이어야, 인가 판단 때 누구인지 알 수 있습니다.

**Q. 401과 403은 누가 만드나요?**
JWT 필터는 만들지 않습니다. `AuthorizationFilter`가 거부하면 `ExceptionTranslationFilter`가 받아서, 익명이면 `AuthenticationEntryPoint`(401), 인증된 사용자면 `AccessDeniedHandler`(403)를 부릅니다. RePlant는 둘 다 직접 구현해서 팀 공통 JSON으로 응답합니다. 필터 단계라 `@RestControllerAdvice`로는 처리되지 않습니다.

**Q. 토큰이 만료됐는데 왜 JWT 필터에서 바로 401을 주지 않나요?**
`permitAll` 경로 때문입니다. 상품 목록은 토큰이 만료돼도 비회원으로 볼 수 있어야 합니다. 그래서 JWT 필터는 이유만 `request` 속성에 적고 넘기고, 막을지는 인가 규칙이 정합니다. 막히면 EntryPoint가 그 이유를 읽어 `TOKEN_EXPIRED`와 `INVALID_TOKEN`을 나눠 줍니다.

**Q. `@AuthenticationPrincipal`의 값은 어디서 오나요?**
JWT 필터가 `SecurityContextHolder`에 넣은 `Authentication`의 `principal`입니다. RePlant에서는 토큰의 `sub`와 `role`로 만든 `AuthMember`입니다. `SecurityContextHolder`는 기본이 `ThreadLocal`이라, 같은 요청 스레드의 컨트롤러가 꺼내 쓸 수 있습니다.

**Q. 세션을 안 쓰는데 Refresh 토큰은 왜 Redis에 두나요?**
Access는 요청마다 서명만 보고 저장소를 보지 않습니다. 대신 **취소할 수 있어야 하는 것**만 서버에 둡니다. Refresh가 그렇습니다. 재발급 때 `GETDEL`로 꺼내면서 지워서 한 번만 쓰이게 하고(회전), 로그아웃 때 지웁니다.

**Q. 관리자 권한은 어떻게 검사하나요?**
JWT 필터가 토큰의 `role`에 `ROLE_`을 붙여 권한으로 넣고, `requestMatchers("/api/v1/admin/**").hasRole("ADMIN")`이 `ROLE_ADMIN`이 있는지 봅니다. 권한이 바뀌면 다음 재발급 때 DB에서 다시 읽어 반영합니다.

## 헷갈릴 때 정리

- Spring Security는 서블릿 **필터**다. `DelegatingFilterProxy` → `FilterChainProxy` → `SecurityFilterChain`.
- **인증**은 누구인가(401), **인가**는 해도 되는가(403).
- 인증 결과는 `SecurityContextHolder` → `SecurityContext` → `Authentication`(`principal`, `credentials`, `authorities`)에 담긴다.
- JWT 필터는 **채우기만** 하고 막지 않는다. 막는 건 `AuthorizationFilter`, 응답을 고르는 건 `ExceptionTranslationFilter`.
- `authorizeHttpRequests`는 **위에서부터 첫 매칭**. 좁은 규칙을 위에, `anyRequest()`는 맨 아래.
- `STATELESS`면 매 요청이 빈 `SecurityContext`로 시작한다.
- `hasRole("ADMIN")`은 `ROLE_ADMIN`을 찾는다.
- `OncePerRequestFilter`는 기본으로 `ASYNC` 디스패치에서 돌지 않는다. SSE 뒷정리 디스패치는 따로 허용해야 한다.
- RePlant의 Refresh는 JWT가 아니라 랜덤 문자열이다. Redis에는 해시로, 쿠키는 `HttpOnly`·`Lax`·`Path=/api/v1/auth`.

## 참고

- [Spring Security Reference: Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Spring Security Reference: Servlet Authentication Architecture](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html)
- [Spring Security Reference: Authorize HttpServletRequests](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html)
