import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { buildCloudUrl } from './src/shared/build-cloud'
import { CSP_DEV, CSP_PROD } from './src/shared/csp'

// node:sqlite is a prefix-only builtin; keep it external explicitly.
const nodeExternals = ['node:sqlite']

/** Writes the page's CSP: the permissive one for the dev server only, the strict one in every build. */
function cspPlugin(): Plugin {
  let serving = false
  return {
    name: 'atelier-csp',
    configResolved: (config) => {
      serving = config.command === 'serve'
    },
    transformIndexHtml: (html) => html.replace('__ATELIER_CSP__', serving ? CSP_DEV : CSP_PROD)
  }
}

// One app since v2: no build flavours.
export default defineConfig({
  main: {
    // The Atelier Cloud a new install signs in to: ATELIER_CLOUD_URL or ATELIER_BETA_CLOUD at build time (`npm run dist`
    // inherits it); empty = the local development Cloud (src/shared/build-cloud.ts).
    define: { __ATELIER_CLOUD_URL__: JSON.stringify(buildCloudUrl(process.env)) },
    build: {
      rollupOptions: {
        external: nodeExternals,
        // index = the app; mcp = the Atelier MCP server that Claude Code spawns for agent runs (out/main/mcp.js);
        // worker = the local worker, one engine node per process, run by Electron as Node (out/main/worker.js, lot P5).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          mcp: resolve(__dirname, 'src/main/mcp/main.ts'),
          worker: resolve(__dirname, 'src/engine/worker/main.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss(), cspPlugin()],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
    // Fonts are always files: Vite would inline the small @fontsource subsets as data: URLs, which the strict CSP
    // (font-src falls back to default-src 'self') blocks as soon as a glyph from such a subset is drawn (lot Z1).
    build: { assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined) }
  }
})
