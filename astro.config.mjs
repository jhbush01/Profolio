// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// Static-first: every content page is still prerendered to plain HTML at build
// time. Only the routes that need R2/D1 opt in to on-demand rendering with
// `export const prerender = false`, so the marketing and teaching pages keep
// being served straight from Cloudflare's edge with no Worker invocation.
export default defineConfig({
  output: 'static',

  // Auth is Cloudflare Access, not Astro sessions. Left enabled, the adapter
  // injects a SESSION KV binding with no namespace id, which is one more
  // resource to provision for no benefit.
  session: false,

  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  vite: {
    plugins: [tailwindcss()],
  },
});
