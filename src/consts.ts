import type { Site, Page, Links, Socials } from "@types"

// Global
export const SITE: Site = {
  TITLE: "김윤관",
  DESCRIPTION: "작은 개선을 꾸준히 쌓아 사용자 경험과 서비스 완성도를 높이는 백엔드 개발자 김윤관의 포트폴리오입니다.",
  AUTHOR: "김윤관",
}

// Work Page
export const WORK: Page = {
  TITLE: "이력",
  DESCRIPTION: "학력, 병역, 자격증, 수상, 봉사 이력입니다.",
}

// Blog Page
export const BLOG: Page = {
  TITLE: "기술 기록",
  DESCRIPTION: "프로젝트에서 겪은 트러블슈팅과 설계 결정을 기록합니다.",
}

// Projects Page
export const PROJECTS: Page = {
  TITLE: "프로젝트",
  DESCRIPTION: "직접 기획하고 구현하고 배포한 프로젝트입니다.",
}

// Search Page
export const SEARCH: Page = {
  TITLE: "Search",
  DESCRIPTION: "프로젝트와 기술 기록을 키워드로 검색합니다.",
}

// Links
export const LINKS: Links = [
  {
    TEXT: "Home",
    HREF: "/",
  },
  {
    TEXT: "이력",
    HREF: "/work",
  },
  {
    TEXT: "프로젝트",
    HREF: "/projects",
  },
  {
    TEXT: "기술 기록",
    HREF: "/blog",
  },
]

// Socials
export const SOCIALS: Socials = [
  {
    NAME: "Email",
    ICON: "email",
    TEXT: "dbsrhks2003@naver.com",
    HREF: "mailto:dbsrhks2003@naver.com",
  },
  {
    NAME: "Github",
    ICON: "github",
    TEXT: "gasic37200",
    HREF: "https://github.com/gasic37200"
  },
]
