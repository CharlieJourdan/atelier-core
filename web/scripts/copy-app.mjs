/* global console, process */
// site:build, last step: put the web demo build of the app (dist-web/app) under the site's /app/.
// The app entry is web.html; it is also published as index.html so that /app/ opens it on any static host.
import { cpSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const from = resolve(root, 'dist-web/app')
const to = resolve(root, 'dist-web/site/app')

if (!existsSync(resolve(from, 'web.html'))) {
  console.error('dist-web/app/web.html is missing: run `npm run web:app` first')
  process.exit(1)
}
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
copyFileSync(resolve(to, 'web.html'), resolve(to, 'index.html'))
console.log('app copied to dist-web/site/app')
