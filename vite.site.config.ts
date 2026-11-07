// Marketing site + account pages + founder console (web/). `npm run site:dev` serves it on http://localhost:5190,
// `npm run site:build` builds the web demo of the app (dist-web/app), then the site into dist-web/site, then copies the
// app under dist-web/site/app (web/scripts/copy-app.mjs) so that /app/ hosts the demo.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: '/',
  plugins: [react(), tailwindcss()],
  // fs.strict off: node_modules may be a junction to another checkout (git worktrees), its fonts live outside the root
  server: { port: 5190, strictPort: true, fs: { strict: false } },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist-web/site'),
    emptyOutDir: true
  }
})
