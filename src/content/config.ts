import { defineCollection, z } from "astro:content"

// One troubleshooting case, rendered as a 현상 → 원인 분석 및 근거 → 해결 방안 → 결과 및 검증 box
const troubleshooting = z.object({
  title: z.string(),
  problem: z.string(),
  cause: z.string(),
  solution: z.string(),
  result: z.string(),
  post: z.string().optional(),
})

const work = defineCollection({
  type: "content",
  schema: z.object({
    company: z.string(),
    role: z.string(),
    dateStart: z.coerce.date(),
    dateEnd: z.union([z.coerce.date(), z.string()]),
  }),
})

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    draft: z.boolean().optional(),
    projects: z.array(z.string()).optional(),
    troubleshooting: troubleshooting.omit({ title: true, post: true }).optional(),
    // Decision record summary, rendered instead of the troubleshooting box when present
    decision: z.object({
      question: z.string(),
      choice: z.string(),
      reasons: z.array(z.string()),
      tradeoff: z.string(),
    }).optional(),
  }),
})

// Free-form blog posts (opinions, retrospectives). draft: true shows only in `astro dev`.
const posts = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    draft: z.boolean().optional(),
  }),
})

const projects = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    draft: z.boolean().optional(),
    demoUrl: z.string().optional(),
    repoUrl: z.string().optional(),
    troubleshooting: z.array(troubleshooting).optional(),
  }),
})

const legal = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
  }),
})

export const collections = { work, blog, posts, projects, legal }
