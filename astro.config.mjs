// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Cloudflare-friendly by design: `static` output builds to plain HTML/CSS/JS in
// ./dist, which deploys straight to Cloudflare Pages/Workers Assets with no
// server runtime and no cold starts.
//
// FUTURE: when the evidence upload module gets a real backend (R2 for files,
// D1/KV for metadata), install `@astrojs/cloudflare` and switch to:
//
//   import cloudflare from '@astrojs/cloudflare';
//   output: 'server',
//   adapter: cloudflare(),
//
// then mark only the pages that need it with `export const prerender = false`.
// Nothing in this scaffold assumes a server, so that migration is additive.
export default defineConfig({
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
