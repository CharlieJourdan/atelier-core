// Demo build of the website (web/): no backend at all. VITE_ATELIER_DEMO=1 swaps the Atelier Cloud layer for the
// in-browser fake of web/src/demo/ (fictional data, never a network call), routes on the URL hash and uses relative
// assets, so the folder works from any static host and sub-path. Output: dist-demo/site, next to the demo app that is
// built into dist-demo/ first (only dist-demo/site is emptied; the site's « Ouvrir l'app » links go to ../index.html).
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: './',
  mode: 'demo',
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_ATELIER_DEMO': JSON.stringify('1'),
    // never a real Cloud address in the demo, whatever the environment says
    'import.meta.env.VITE_ATELIER_CLOUD': 'undefined'
  },
  server: { port: 5191, strictPort: true, fs: { strict: false } },
  preview: { host: '127.0.0.1', port: 4181, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist-demo/site'),
    emptyOutDir: true
  }
})
