// Clickable demo of the whole app in a browser, with no backend: builds src/renderer/demo.html into dist-demo/ (relative
// paths, hash routing: any static server works). `npm run demo:web` serves it on http://localhost:5181/demo.html.
// The demo bridge (src/renderer/web/demo/) answers every call from fictional data; it never touches a network.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
  server: { port: 5181, strictPort: true, open: '/demo.html' },
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/demo.html') } }
  }
})
