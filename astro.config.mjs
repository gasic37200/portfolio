import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"
import tailwind from "@astrojs/tailwind"
import solidJs from "@astrojs/solid-js"

// Vercel exposes the production domain at build time; SITE_URL overrides it (e.g. a custom domain)
const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
const site = process.env.SITE_URL ?? (productionUrl ? `https://${productionUrl}` : "http://localhost:4321")

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [mdx(), sitemap(), solidJs(), tailwind({ applyBaseStyles: false })],
})