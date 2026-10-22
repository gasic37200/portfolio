import { defineCollection, z } from "astro:content"

// One troubleshooting case, rendered as a 문제 → 원인 → 해결 과정 → 결과 box
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

export const collections = { work, blog, projects, legal }
