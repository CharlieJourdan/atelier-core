// Regenerates the published JSON Schemas (resources/schemas/) from the engine's zod schemas, by running their test
// with ATELIER_WRITE_SCHEMAS=1 (the test writes the file, then checks it). Usage: npm run schemas
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
const res = spawnSync(process.execPath, [vitest, 'run', 'tests/unit/engine-schema.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ATELIER_WRITE_SCHEMAS: '1' }
})
process.exit(res.status ?? 1)
