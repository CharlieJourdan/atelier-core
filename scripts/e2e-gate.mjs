// Judges the tail of a Playwright run: a green exit code is not enough, because skipped specs also exit 0.
// A run is accepted only when it reports "N passed" (N > 0) and no failed / skipped / did not run / flaky /
// interrupted count.
//
//   node scripts/e2e-gate.mjs <log>    exit 0 when accepted, else exit 1 with the reason on stderr
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const COUNT = /^\s*(\d+)\s+(passed|failed|skipped|flaky|did not run|interrupted)\b/gm

export function judgePlaywrightLog(text) {
  const counts = {}
  for (const m of String(text ?? '').matchAll(COUNT)) {
    counts[m[2]] = (counts[m[2]] ?? 0) + Number(m[1])
  }
  const bad = ['failed', 'skipped', 'did not run', 'flaky', 'interrupted'].filter((k) => (counts[k] ?? 0) > 0)
  if (bad.length > 0) {
    return { ok: false, reason: bad.map((k) => `${counts[k]} ${k}`).join(', ') + ' (every spec must run and pass)' }
  }
  if (!counts.passed) return { ok: false, reason: 'no "N passed" count in the log: the specs did not run' }
  return { ok: true, reason: `${counts.passed} passed, nothing skipped` }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node e2e-gate.mjs <playwright-log>')
    process.exit(2)
  }
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    console.error(`e2e gate: cannot read ${file}: ${e.message}`)
    process.exit(1)
  }
  const verdict = judgePlaywrightLog(text)
  if (verdict.ok) {
    console.log(`e2e gate: ${verdict.reason}`)
  } else {
    console.error(`e2e gate: ${verdict.reason}`)
    process.exit(1)
  }
}
