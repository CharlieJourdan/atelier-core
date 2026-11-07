/* global console, process */
// Copies the product screenshots from the main checkout (docs/screens/proto/*-dark.png and *-light.png) into
// web/public/shots/. The site references them by stable names (see web/src/shots.ts); a missing file shows a neutral
// placeholder frame. Usage: node web/scripts/sync-shots.mjs [source-dir]
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = resolve(process.argv[2] ?? resolve(root, 'docs/screens/proto'))
const dst = resolve(root, 'web/public/shots')
const NAMES = [
  'accueil',
  'accueil-agent-panel',
  'planning',
  'planning-detail',
  'production-apercu',
  'production-editor',
  'production-pipeline',
  'agents',
  'conversations',
  'conversations-group',
  'cerveau',
  'ordinateurs',
  'chaines-detail-competitors',
  'onboarding-3-translate',
  'onboarding-4',
  'onboarding-5'
]
mkdirSync(dst, { recursive: true })
let n = 0
for (const name of NAMES) {
  for (const theme of ['dark', 'light']) {
    const file = `${name}-${theme}.png`
    if (!existsSync(resolve(src, file))) {
      console.warn(`missing: ${file}`)
      continue
    }
    copyFileSync(resolve(src, file), resolve(dst, file))
    n++
  }
}
console.log(`${n} screenshots copied to web/public/shots`)
