// Web demo of the app (no Electron): builds src/renderer/web.html into dist-web/app, served under /app/ by the
// marketing site. `npm run web:app` builds it, `npm run web:app:dev` serves it on http://localhost:5180/web.html.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist-web/app'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/web.html') }
  }
})
