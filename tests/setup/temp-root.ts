// Every test file gets its own temporary root: os.tmpdir() (TEMP / TMP / TMPDIR, inherited by child processes) points
// into it, and it is removed after the file. A test that forgets to remove its `atelier-*` folder can no longer fill
// the disk: the folder dies with the file's root. Leaks are still reported : a file that leaves one fails (tests/setup/temp-leak-baseline.json
// lists the files that leaked before the guard; the list only shrinks).
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll } from 'vitest'
import { drainTracked } from './track-temp'

const BASELINE: Record<string, string[]> = JSON.parse(readFileSync(join(import.meta.dirname, 'temp-leak-baseline.json'), 'utf8'))

const KEYS = ['TEMP', 'TMP', 'TMPDIR'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
const realTmp = tmpdir()
const root = mkdtempSync(join(realTmp, 'atelier-vt-'))
for (const k of KEYS) process.env[k] = root

/** Removes the root, retrying: a child brain may still hold a file for a moment (Windows EBUSY/EPERM). */
function removeRoot(): void {
  for (let i = 0; i < 20 && existsSync(root); i++) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      const until = Date.now() + 250
      while (Date.now() < until) { /* wait for the holder to let go */ }
    }
  }
}

afterAll(() => {
  for (const d of drainTracked()) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  const left = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('atelier-')) : []
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  if (left.length > 0 && process.env.ATELIER_TEMP_REPORT) {
    appendFileSync(process.env.ATELIER_TEMP_REPORT, `${relative(process.cwd(), testFile()).split(sep).join("/")}: ${left.join(', ')}\n`)
  }
  removeRoot()
  // Ratchet: the files listed in temp-leak-baseline.json leaked before this guard existed (being fixed one by one);
  // any OTHER file that leaves an atelier-* folder behind fails.
  const file = relative(process.cwd(), testFile()).split(sep).join('/')
  if (left.length > 0 && !(file in BASELINE)) {
    throw new Error(`${file} left ${left.length} temporary folder(s) behind (${left.slice(0, 3).join(', ')}): remove them in afterEach/afterAll, or register them with trackTemp()`)
  }
}, 60_000)

function testFile(): string {
  return (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__?.filepath ?? '?'
}
