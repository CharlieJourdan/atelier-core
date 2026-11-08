// After `vite build -c vite.demo.config.ts`: dist-demo/demo.html becomes dist-demo/index.html, so any static server
// opens the demo at the folder's root.
import { existsSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '..', 'dist-demo')
const from = resolve(dir, 'demo.html')
if (!existsSync(from)) {
  console.error('dist-demo/demo.html missing: run vite build -c vite.demo.config.ts first')
  process.exit(1)
}
renameSync(from, resolve(dir, 'index.html'))
console.log(`demo ready: ${resolve(dir, 'index.html')}`)
