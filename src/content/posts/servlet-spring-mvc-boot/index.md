---
title: "서블릿, Spring MVC, Spring Boot는 어디까지가 어디인가"
summary: "매번 헷갈리던 서블릿, Spring MVC, Spring Boot를 요청 하나가 지나가는 층으로 나눠 정리했습니다. 필터와 인터셉터, 비동기 디스패치까지 RePlant SSE 사례와 함께 봅니다."
date: "2026-10-28"
tags:
- Spring
- 서블릿
- 백엔드 기초
draft: true
---

<!--
  ✏️ 임시 글 작성 메모 (사이트에는 보이지 않음)
  - 그림은 public/images/posts/servlet-spring-mvc-boot/ 에 있습니다.
  - 공개할 때는 frontmatter의 draft: true 줄을 지우세요.
-->

> **한눈에 보기**
>
> - **서블릿**은 HTTP 요청을 자바 객체로 받는 **자바 표준(Jakarta Servlet)** 이고, **Tomcat**은 그 표준을 실행해 주는 서블릿 컨테이너다.
> - **Spring MVC**는 `DispatcherServlet`이라는 **서블릿 하나**로 모든 요청을 받아 내 컨트롤러로 나눠 준다. 서블릿을 대신하는 게 아니라 서블릿 **위에서** 돈다.
> - **Spring Boot**는 Spring MVC와 Tomcat을 **설정 없이 바로 실행되는 앱**으로 묶어 준다. 새 웹 기술이 아니다.
> - 필터는 서블릿 층, 인터셉터는 Spring MVC 층, AOP는 빈 층에서 돈다. 이 층을 구분하면 Spring Security와 SSE 비동기 디스패치 문제도 읽힌다.

![브라우저에서 DB까지 요청이 지나가는 층을 서블릿 스펙, 스프링, 내 코드로 색을 나눠 표시한 그림](/images/posts/servlet-spring-mvc-boot/01-layers.svg)

이 글은 위 그림을 아래에서 위로, 즉 **서블릿 → Spring MVC → Spring Boot** 순서로 쌓아 올립니다. 그림에서 초록은 서블릿 스펙, 파랑은 스프링이 만든 부품, 주황은 내가 쓰는 코드입니다.

## 1. 서블릿: HTTP를 자바로 받는 표준

브라우저가 보내는 HTTP 요청은 그냥 글자입니다. 자바 코드가 이걸 다루려면 누군가 글자를 읽어 **자바 객체로 바꿔 줘야** 합니다. 그 약속이 서블릿입니다.

- **서블릿 스펙(Jakarta Servlet)** — "요청은 `HttpServletRequest`, 응답은 `HttpServletResponse` 객체로 준다", "요청을 처리할 클래스는 `Servlet`을 구현한다" 같은 **규격**이다. 예전 이름은 Java EE의 `javax.servlet`이고, 지금은 `jakarta.servlet` 패키지를 쓴다.
- **서블릿 컨테이너(Tomcat)** — 이 규격대로 **실제로 동작하는 프로그램**이다. 소켓으로 HTTP를 받고, 글자를 해석해 요청 객체를 만들고, 알맞은 서블릿을 불러 준다.

서블릿 하나는 이렇게 생겼습니다.

```java
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

@WebServlet("/hello")
public class HelloServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String name = req.getParameter("name");          // 쿼리 파라미터 꺼내기
        resp.setContentType("text/plain;charset=UTF-8"); // 응답 형식 직접 지정
        resp.getWriter().write("안녕하세요, " + name);     // 응답 바디 직접 쓰기
    }
}
```

### 생명주기와 스레드는 컨테이너가 관리한다

서블릿 객체는 내가 `new`로 만들지 않습니다. **Tomcat이 만들고, 부르고, 없앱니다.**

| 단계 | 메서드 | 언제 |
| --- | --- | --- |
| 초기화 | `init()` | 서블릿을 처음 쓰기 전 **한 번** |
| 요청 처리 | `service()` → `doGet()`, `doPost()` … | 요청이 올 때마다 |
| 종료 | `destroy()` | 서버가 내려갈 때 **한 번** |

스레드도 Tomcat 몫입니다. Tomcat은 **스레드 풀**을 두고, 요청이 오면 스레드 하나를 꺼내 그 요청을 끝까지 맡깁니다(요청당 스레드). 끝나면 스레드는 풀로 돌아갑니다.

여기서 중요한 점이 하나 있습니다. 서블릿 객체는 **하나**인데 여러 스레드가 **동시에** 그 객체의 `service()`를 부릅니다. 그래서 서블릿의 필드에 요청마다 달라지는 값(로그인 사용자 등)을 저장하면 다른 요청과 섞입니다. 이 규칙은 뒤에 나올 **스프링 빈에도 그대로** 적용됩니다.

> 비유하면 Tomcat은 **식당 건물과 홀 직원**입니다. 손님(요청)이 오면 직원(스레드)을 한 명 붙여 주고, 주문서(요청 객체)를 만들어 주방(서블릿)에 넘깁니다. 서블릿 스펙은 "주문서는 이 양식으로 쓴다"는 약속입니다.

### 서블릿만으로 만들면 생기는 문제

- **URL마다 서블릿 클래스**를 만들어야 한다. `/members`, `/orders`, `/notifications`… 각각 `HttpServlet`을 상속하고 등록해야 한다.
- 파라미터 꺼내기, 형변환, JSON 변환, 응답 형식 지정을 **매번 직접** 한다.
- 인증 확인, 예외 처리, 로깅 같은 **공통 처리가 서블릿마다 반복**된다.

이 반복을 걷어 내려고 나온 것이 Spring MVC입니다.

## 2. Spring MVC: 서블릿 하나가 모든 요청을 받는다

Spring MVC는 **프론트 컨트롤러 패턴**을 씁니다. 회사 1층 **안내 데스크**처럼, 모든 방문객이 일단 한 곳으로 들어오고 거기서 담당자에게 안내받는 구조입니다. 그 안내 데스크가 `DispatcherServlet`입니다.

- `DispatcherServlet`은 **그 자체가 서블릿**이다(`HttpServlet`을 상속한다). 보통 `/` 경로에 하나 등록해 모든 요청을 받는다.
- 그래서 Spring MVC는 서블릿을 **대체하지 않는다.** Tomcat 입장에서는 서블릿이 하나 있을 뿐이고, 그 서블릿이 안에서 내 컨트롤러들에게 일을 나눠 준다.

같은 기능을 Spring MVC로 쓰면 이렇습니다. 요청 객체를 직접 다루는 코드가 사라졌습니다.

```java
@RestController
@RequestMapping("/hello")
public class HelloController {

    @GetMapping
    public String hello(@RequestParam String name) { // 파라미터는 스프링이 꺼내 준다
        return "안녕하세요, " + name;                   // 응답 쓰기도 스프링이 한다
    }
}
```

### DispatcherServlet이 요청을 처리하는 순서

![DispatcherServlet이 HandlerMapping, 인터셉터, HandlerAdapter, 반환값 처리 순서로 요청을 처리하고 예외는 HandlerExceptionResolver로 보내는 그림](/images/posts/servlet-spring-mvc-boot/02-dispatcher-servlet.svg)

| 부품 | 하는 일 | 비유 |
| --- | --- | --- |
| `HandlerMapping` | URL·HTTP 메서드를 보고 담당 컨트롤러 메서드를 찾는다. `@GetMapping`을 읽는 게 이 부품이다 | 안내 데스크의 담당자 명단 |
| `HandlerInterceptor` | 컨트롤러 호출 앞뒤에 끼어든다(있을 때만) | 담당자 방 앞의 확인 절차 |
| `HandlerAdapter` | 찾은 컨트롤러를 **실제로 호출**한다. 메서드 인자(`@RequestParam`, `@RequestBody` 등)를 준비해 넣는다 | 담당자에게 서류를 맞춰 전달 |
| `HttpMessageConverter` | HTTP 바디 ↔ 자바 객체 변환. JSON은 Jackson이 맡는다 | 번역가 |
| `ViewResolver` | 반환값이 뷰 이름이면 실제 화면 템플릿을 찾는다 | 양식 보관함 |
| `HandlerExceptionResolver` | 처리 중 예외가 나면 에러 응답으로 바꾼다. `@ControllerAdvice`의 `@ExceptionHandler`가 여기서 불린다 | 민원 창구 |

### @Controller와 @RestController

| | `@Controller` | `@RestController` |
| --- | --- | --- |
| 반환값의 뜻 | **뷰 이름** (`"members/list"` → HTML 템플릿) | **응답 바디 그 자체** |
| 거치는 부품 | `ViewResolver` → View 렌더링 | `HttpMessageConverter` → JSON |
| 정체 | 기본 컨트롤러 | `@Controller` + `@ResponseBody` |

REST API 서버는 대부분 `@RestController`를 씁니다. `@ResponseBody`가 붙으면 반환값을 뷰로 해석하지 않고 `HttpMessageConverter`로 **바디에 바로 씁니다.**

`@RequestBody`는 반대 방향입니다. 요청 바디의 JSON을 `HttpMessageConverter`가 읽어 DTO 객체로 바꿔 줍니다.

```java
@PostMapping
public MemberResponse create(@RequestBody MemberCreateRequest request) { // JSON → 객체
    return memberService.create(request);                                // 객체 → JSON
}
```

`Content-Type`이 맞지 않거나 JSON 형식이 깨지면 컨트롤러까지 오지도 못하고 에러가 납니다. 변환이 컨트롤러 **호출 전**, `HandlerAdapter` 단계에서 일어나기 때문입니다.

## 3. 필터, 인터셉터, AOP는 서는 층이 다르다

세 가지 모두 "요청 처리 앞뒤에 공통 코드를 끼워 넣는" 도구라서 헷갈립니다. 차이는 **어느 층에 서 있느냐**입니다.

![서블릿 컨테이너 안의 필터 체인과 DispatcherServlet 안의 인터셉터 위치, 그리고 Spring Security의 DelegatingFilterProxy, FilterChainProxy, SecurityFilterChain 구조를 보여 주는 그림](/images/posts/servlet-spring-mvc-boot/03-filter-vs-interceptor.svg)

| | 필터 | 인터셉터 | AOP |
| --- | --- | --- | --- |
| 누가 정한 규격 | 서블릿 스펙 (`jakarta.servlet.Filter`) | Spring MVC (`HandlerInterceptor`) | 스프링 AOP (프록시) |
| 어디서 동작 | `DispatcherServlet` **앞** | `DispatcherServlet` **안**, 컨트롤러 앞뒤 | 스프링 빈의 **메서드 호출** 앞뒤 |
| 무엇을 알 수 있나 | 요청·응답 원본. 어느 컨트롤러로 갈지는 **모른다** | 실행될 **컨트롤러 메서드**(핸들러)를 안다 | 메서드 **인자·반환값·예외**를 안다 |
| 흐름을 멈추는 법 | `chain.doFilter()`를 부르지 않는다 | `preHandle()`에서 `false` 반환 | 대상 메서드를 호출하지 않는다 |
| 주 용도 | 인증(Spring Security), CORS, 인코딩, 요청 로깅 | 컨트롤러 단위 공통 검사, 로깅 | `@Transactional`, 캐시, 실행 시간 측정 |

AOP는 웹 요청과 관계가 없습니다. 서비스 빈을 **프록시**가 감싸서 메서드 호출을 가로채는 방식이라, 웹 요청이 아닌 Kafka 리스너에서 서비스를 불러도 `@Transactional`이 적용됩니다. 반대로 같은 클래스 안에서 `this.다른메서드()`로 부르면 프록시를 거치지 않아 적용되지 않습니다.

### Spring Security는 왜 필터일까

Spring Security는 스프링 프로젝트인데도 인터셉터가 아니라 **서블릿 필터 체인**에 들어갑니다.

- **컨트롤러에 닿기 전에 막아야 한다.** 인증이 안 된 요청은 `DispatcherServlet`까지 갈 이유가 없다.
- **Spring MVC 밖의 요청도 지켜야 한다.** 필터는 그 서블릿 컨테이너로 들어오는 요청 전체에 걸 수 있다.

그런데 Tomcat은 스프링 빈을 모릅니다. 그래서 다리가 하나 필요합니다.

1. **`DelegatingFilterProxy`** — Tomcat에 등록되는 평범한 서블릿 필터. 스스로 일하지 않고 스프링 빈에게 일을 넘긴다.
2. **`FilterChainProxy`** — 그 일을 받는 스프링 빈. 요청에 맞는 보안 필터 체인을 고른다.
3. **`SecurityFilterChain`** — 실제 보안 필터 목록. 내가 `@Bean`으로 구성하는 그것이다. RePlant의 `JwtAuthenticationFilter`도 이 목록에 들어가고, 목록 끝의 `AuthorizationFilter`가 `authorizeHttpRequests` 규칙을 검사한다.

Spring Boot를 쓰면 1번 등록을 자동으로 해 줍니다. 그래서 평소에는 3번만 보게 됩니다.

## 4. 디스패치 타입과 비동기 요청

필터를 "요청이 들어올 때 한 번 지나는 곳"으로만 알면 놓치는 게 있습니다. 서블릿 컨테이너는 **같은 요청을 여러 번 디스패치**할 수 있고, 그때마다 필터를 다시 지날 수 있습니다. 몇 번째, 어떤 이유의 디스패치인지가 **디스패치 타입**입니다.

![디스패치 타입 네 가지와, SseEmitter를 반환한 요청이 REQUEST와 ASYNC 디스패치에서 JWT 필터와 인가 규칙을 각각 어떻게 지나는지 비교한 그림](/images/posts/servlet-spring-mvc-boot/04-dispatcher-types.svg)

| 타입 | 언제 |
| --- | --- |
| `REQUEST` | 클라이언트 요청이 처음 들어올 때 |
| `FORWARD` | 서버 안에서 다른 경로로 넘길 때 |
| `INCLUDE` | 다른 자원의 결과를 응답에 포함할 때 |
| `ERROR` | 에러 처리 경로(Spring Boot의 `/error` 등)로 보낼 때 |
| `ASYNC` | 비동기로 시작한 요청을 이어서 마무리할 때 |

### SseEmitter를 반환하면 요청이 비동기로 바뀐다

컨트롤러가 `SseEmitter`를 반환하면 Spring MVC는 **서블릿 비동기 처리**를 시작합니다.

1. 처음 요청(`REQUEST`)이 필터와 컨트롤러를 지나 `SseEmitter`를 돌려준다.
2. 요청을 처리하던 Tomcat 스레드는 풀로 돌아가고, **응답은 열린 채로** 남는다.
3. 그 사이 `emitter.send()`는 열린 응답에 데이터를 바로 쓴다.
4. 연결이 끝날 때(완료, 타임아웃, 에러) 컨테이너가 **같은 요청을 `ASYNC`로 다시 디스패치**해 마무리한다. 이때 필터 체인을 다시 지난다.

### OncePerRequestFilter는 ASYNC 디스패치를 건너뛴다

`OncePerRequestFilter`는 이름 그대로 **요청당 한 번만** 돌도록 만든 스프링의 필터 기반 클래스입니다. 기본값으로 `ASYNC` 디스패치와 `ERROR` 디스패치에서는 다시 돌지 않습니다(`shouldNotFilterAsyncDispatch()`, `shouldNotFilterErrorDispatch()`가 `true`).

반면 Spring Security의 인가 규칙(`AuthorizationFilter`)은 모든 디스패치 타입에 적용됩니다. 둘이 만나면 이렇게 됩니다.

| | 처음 요청 (`REQUEST`) | 비동기 마무리 (`ASYNC`) |
| --- | --- | --- |
| JWT 필터 (`OncePerRequestFilter`) | 실행. 토큰을 검사해 인증 정보를 채움 | **건너뜀** |
| 인가 규칙 (`AuthorizationFilter`) | 인증됨 → 통과 | 다시 검사. 인증 정보가 비어 있으면 **401·403** |

### RePlant에서 실제로 만난 경우

[RePlant Market](/projects/replant)의 SSE 알림이 정확히 이 구조였습니다. `JwtAuthenticationFilter`는 `OncePerRequestFilter`를 상속하고, 서버는 세션 없이 요청마다 토큰을 검사합니다. 그래서 `ASYNC` 디스패치에서는 JWT 필터가 돌지 않아 인증 정보가 비고, 인가 규칙에 걸려 **401·403이 날 수 있었습니다.**

`SecurityConfig`에 한 줄을 넣어 해결했습니다.

```java
.authorizeHttpRequests(auth -> auth
    .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
    ...
```

풀어 준 것은 `ASYNC` 디스패치뿐입니다. `ASYNC` 디스패치는 밖에서 보낼 수 있는 요청이 아니라, **처음 `REQUEST`에서 인증을 통과해 열린 연결 안에서만** 생깁니다. 구독 경로 자체는 그대로 인증이 필요합니다. 자세한 결정 과정은 [JWT로 인증하는 서버에 SSE 실시간 알림 붙이기](/blog/sse-jwt-async-dispatch)에 정리했습니다.

이 문제는 서블릿(디스패치 타입), Spring MVC(`SseEmitter` 비동기 처리), Spring Security(필터 체인과 인가 규칙)라는 **세 층이 만나는 곳**에서 생겼습니다. 층을 구분해 두지 않으면 "인증은 됐는데 왜 403이지?"에서 멈추게 됩니다.

## 5. 스프링 컨테이너, 빈, IoC/DI

여기서 "컨테이너"가 하나 더 나옵니다. **서블릿 컨테이너(Tomcat)와 스프링 컨테이너(ApplicationContext)는 다른 것**입니다.

| | 서블릿 컨테이너 | 스프링 컨테이너 |
| --- | --- | --- |
| 예 | Tomcat | `ApplicationContext` |
| 관리하는 것 | 서블릿, 필터, 스레드, HTTP 연결 | 빈(스프링이 만들고 관리하는 객체) |
| 하는 일 | HTTP를 받아 서블릿을 부른다 | 객체를 만들고 서로 연결해 준다 |

- **빈** — 스프링 컨테이너가 만들고 보관하는 객체. `@Component`, `@Service`, `@RestController`, `@Bean`으로 등록한다. 기본은 **싱글톤**이라 서블릿처럼 여러 스레드가 동시에 쓴다. 필드에 요청별 상태를 두면 안 되는 이유가 같다.
- **IoC(제어의 역전)** — 객체를 만들고 연결하는 일을 내가 아니라 컨테이너가 한다.
- **DI(의존성 주입)** — 필요한 객체를 생성자로 받기만 하면 컨테이너가 넣어 준다.

```java
@Service
public class NotificationService {
    private final NotificationRepository repository;

    public NotificationService(NotificationRepository repository) { // 컨테이너가 넣어 준다
        this.repository = repository;
    }
}
```

**MVC 부품이 빈인 이유**도 여기서 나옵니다. `DispatcherServlet`은 `HandlerMapping`, `HandlerAdapter`, `ViewResolver`, `HandlerExceptionResolver` 같은 부품을 **스프링 컨테이너에서 찾아 씁니다.** 내 컨트롤러도 빈이라서 `HandlerMapping`이 빈들 중 `@RequestMapping`이 붙은 메서드를 모아 둘 수 있습니다. 부품을 바꾸거나 더하고 싶으면 빈을 등록하면 됩니다. `@ControllerAdvice`가 동작하는 것도, `@Transactional` 프록시가 끼어드는 것도 모두 빈이기 때문입니다.

## 6. Spring Boot: 앱이 서버를 띄운다

![main() 실행부터 내장 Tomcat 시작까지의 순서와 Spring Boot가 해 주는 자동 설정, starter, 설정 파일을 정리한 그림](/images/posts/servlet-spring-mvc-boot/05-spring-boot.svg)

Spring Boot 전에는 Spring MVC를 쓰려면 할 일이 많았습니다. Tomcat을 따로 설치하고, `web.xml`(또는 자바 설정)에 `DispatcherServlet`을 등록하고, 필요한 빈을 하나하나 설정하고, WAR 파일로 묶어 Tomcat에 배포했습니다.

Spring Boot는 이 순서를 **뒤집었습니다.** Tomcat이 앱을 띄우는 게 아니라, **앱의 `main()`이 내장 Tomcat을 띄웁니다.**

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

1. `main()` 실행 (`java -jar app.jar`)
2. `SpringApplication.run()`이 `ApplicationContext`를 만든다.
3. 컴포넌트 스캔으로 내 빈을, 자동 설정으로 스프링 부품 빈을 등록한다.
4. 내장 Tomcat을 시작하고 `DispatcherServlet`을 등록한다.
5. 포트(기본 8080)를 열고 요청을 기다린다.

### Boot가 해 주는 네 가지

- **`@SpringBootApplication`** = `@SpringBootConfiguration`(설정 클래스) + `@EnableAutoConfiguration`(자동 설정 켜기) + `@ComponentScan`(이 패키지 아래에서 빈 찾기).
- **자동 설정** — 조건을 보고 빈을 대신 등록한다. `@ConditionalOnClass`는 "이 클래스가 classpath에 있으면", `@ConditionalOnMissingBean`은 "내가 같은 타입의 빈을 만들지 않았으면"이다. 그래서 **내가 빈을 직접 만들면 자동 설정이 물러난다.** 어떤 자동 설정이 켜졌는지는 `--debug`로 실행하면 조건 평가 보고서로 볼 수 있다.
- **starter 의존성** — 웹 MVC용 starter 하나(`spring-boot-starter-web`, RePlant은 Boot 4.1.1에서 이 이름을 쓴다)에 Spring MVC, 내장 Tomcat, Jackson이 함께 들어온다. 라이브러리끼리 맞는 버전도 Boot가 관리한다.
- **`application.yml`과 프로파일** — `server.port`, `spring.datasource.url` 같은 값을 코드 밖에서 바꾼다. `spring.profiles.active=prod`면 `application-prod.yml`을 추가로 읽는다.

### Spring vs Spring Boot

| 할 일 | Spring만 쓸 때 (예전 방식) | Spring Boot |
| --- | --- | --- |
| 서버 | Tomcat을 설치하고 WAR 배포 | 내장 Tomcat, `java -jar`로 실행 |
| `DispatcherServlet` 등록 | `web.xml` 또는 자바 설정으로 직접 | 자동 설정 |
| 의존성 | 라이브러리마다 버전을 맞춤 | starter + Boot의 버전 관리 |
| 빈 설정 | 필요한 부품을 직접 등록 | 조건부 자동 설정, 내 빈이 있으면 물러남 |
| 환경별 설정 | 직접 구성 | `application.yml` + 프로파일 |
| 누가 누구를 띄우나 | Tomcat이 앱을 띄움 | 앱이 Tomcat을 띄움 |

Spring Boot는 Spring을 **대신하지 않습니다.** 요청을 처리하는 건 여전히 Spring MVC의 `DispatcherServlet`이고, 그 밑에는 여전히 서블릿 컨테이너가 있습니다.

### RePlant에서는

RePlant는 Java 25, Spring Boot 4로 만들었고, Spring Modulith로 나눈 **모듈러 모놀리스**입니다. 모듈은 코드 안의 경계일 뿐이라, 실행되는 것은 **Boot 앱 하나**, 그 안의 `ApplicationContext` 하나, **내장 Tomcat 하나**입니다. 이 앱이 Docker 컨테이너에서 돌고, 앞에 Nginx가 리버스 프록시로 서서 요청을 넘겨 줍니다. Nginx는 자바 밖의 프로그램이라 서블릿이나 스프링과는 관계가 없습니다.

## 7. 요청 하나가 응답이 되기까지

설명을 위해 `POST /api/v1/notifications`라는 요청 하나를 예로 들어 처음부터 끝까지 따라가 보겠습니다.

1. 브라우저가 `Authorization: Bearer <JWT>` 헤더와 JSON 바디를 담아 요청을 보낸다.
2. **Nginx**가 받아 Docker 컨테이너 안의 Boot 앱으로 넘긴다.
3. **Tomcat**이 HTTP를 해석해 `HttpServletRequest`·`HttpServletResponse`를 만들고, 스레드 풀에서 **스레드 하나**를 배정한다. 디스패치 타입은 `REQUEST`.
4. **필터 체인**을 지난다. `DelegatingFilterProxy` → `FilterChainProxy` → `SecurityFilterChain` 순서로 들어가, `JwtAuthenticationFilter`가 토큰을 검사해 인증 정보를 채우고, `AuthorizationFilter`가 인가 규칙을 확인한다.
5. **`DispatcherServlet`** 이 요청을 받는다.
6. **`HandlerMapping`** 이 `@PostMapping`이 붙은 컨트롤러 메서드를 찾는다.
7. 등록된 **인터셉터**가 있으면 `preHandle()`이 실행된다.
8. **`HandlerAdapter`** 가 인자를 준비한다. `@RequestBody` JSON은 `HttpMessageConverter`(Jackson)가 DTO로 바꾼다. 그리고 컨트롤러를 호출한다.
9. 컨트롤러가 **서비스**를 부른다. 서비스 빈을 감싼 `@Transactional` 프록시가 트랜잭션을 연다.
10. 서비스가 **리포지토리**를 통해 **DB**에 저장한다.
11. 서비스 메서드가 정상으로 끝나면 프록시가 트랜잭션을 **커밋**한다.
12. 컨트롤러가 응답 DTO를 반환하면 `@RestController`이므로 `HttpMessageConverter`가 **JSON으로 바디에** 쓴다.
13. 중간에 예외가 났다면 `HandlerExceptionResolver`가 `@ControllerAdvice`의 `@ExceptionHandler`를 불러 에러 응답을 만든다.
14. 응답이 필터를 거꾸로 빠져나가 Tomcat → Nginx → 브라우저로 간다. **스레드는 풀로 돌아간다.**

이 중 내가 쓴 코드는 4번의 JWT 필터와 보안 설정, 9~10번, 13번의 예외 처리기 정도입니다. 나머지는 서블릿 컨테이너와 스프링이 합니다.

## 헷갈릴 때 정리

- **서블릿**은 규격, **Tomcat**은 그 규격을 실행하는 프로그램이다.
- **Spring MVC는 서블릿 위에서 돈다.** `DispatcherServlet`도 서블릿이다.
- **Spring Boot는 웹 기술이 아니라 조립·실행 도구다.** 요청 처리는 여전히 Spring MVC가 한다.
- **컨테이너가 두 개다.** 서블릿 컨테이너(Tomcat)는 서블릿과 스레드를, 스프링 컨테이너(`ApplicationContext`)는 빈을 관리한다.
- **필터는 `DispatcherServlet` 앞, 인터셉터는 안, AOP는 빈 메서드 앞뒤**에서 돈다.
- **Spring Security는 필터 체인**이다. `DelegatingFilterProxy`가 Tomcat과 스프링 빈 사이의 다리다.
- `@RestController` = `@Controller` + `@ResponseBody`. 반환값은 뷰가 아니라 **바디**가 되고, `HttpMessageConverter`가 JSON으로 바꾼다.
- **같은 요청이 필터를 여러 번 지날 수 있다.** `OncePerRequestFilter`는 기본적으로 `ASYNC`·`ERROR` 디스패치를 건너뛰니, 비동기 응답(`SseEmitter` 등)에서는 인증 정보가 빌 수 있다.
- 서블릿도 빈도 **하나를 여러 스레드가 함께 쓴다.** 필드에 요청별 상태를 두지 않는다.

## 참고

- [Spring Framework — Spring Web MVC](https://docs.spring.io/spring-framework/reference/web/webmvc.html)
- [Spring Framework — DispatcherServlet](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html)
- [Spring Security — Servlet Applications: Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Spring Boot — Auto-configuration](https://docs.spring.io/spring-boot/reference/using/auto-configuration.html)
