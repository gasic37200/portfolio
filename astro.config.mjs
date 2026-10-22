import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"
import tailwind from "@astrojs/tailwind"
import solidJs from "@astrojs/solid-js"

// Canonical address used in the sitemap, RSS and link-preview tags; set SITE_URL to change it (e.g. a custom domain)
const site = process.env.SITE_URL ?? "https://kimyoongwan.vercel.app"

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [mdx(), sitemap(), solidJs(), tailwind({ applyBaseStyles: false })],
})