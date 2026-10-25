import { getCollection } from "astro:content"
import { LINKS } from "@consts"
import { isPublished } from "@lib/utils"

// Hide the 블로그 menu until at least one post is published (drafts count in dev)
export async function navLinks() {
  const hasPosts = (await getCollection("posts")).some(isPublished)
  return LINKS.filter((link) => hasPosts || link.HREF !== "/posts")
}
