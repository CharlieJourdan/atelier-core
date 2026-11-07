// Turns a failed test step into a short Markdown section for the Mac report (scripts/mac-verify.sh): the failing test
// files, the failing test names and the first lines of each failure. Reads the JSON report of the run (vitest's `json`
// reporter, Playwright's `json` reporter) and falls back to the plain log when the JSON is missing or unreadable (the
// runner crashed before writing it). Exits 0, or 3 when it found no failing test (the caller then adds the end of the
// log, where the reason is), 2 on bad usage. mac-verify.sh never lets this code touch a verdict.
//
//   node scripts/verify-summary.mjs vitest|playwright <report.json> <plain.log> [--root <repo>]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Lines kept per failure, failures listed per step, characters per step (the report stays readable). */
export const LIMITS = { lines: 15, failures: 20, chars: 12_000 }

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g
const plain = (s) => String(s ?? '').replace(ANSI, '')

/** Paths shown relative to the clone; Windows separators made POSIX so the report reads the same on both OSes. */
function relative(file, root) {
  let f = String(file ?? '').replace(/\\/g, '/').replace(/^file:\/\//, '')
  const r = root ? String(root).replace(/\\/g, '/').replace(/\/+$/, '') + '/' : ''
  if (r && f.startsWith(r)) f = f.slice(r.length)
  return f
}

/** The first `max` useful lines of an error: runner and Node internals dropped, the clone's path shortened. */
export function firstLines(message, root, max = LIMITS.lines) {
  const r = root ? String(root).replace(/\\/g, '/').replace(/\/+$/, '') + '/' : ''
  const lines = plain(message)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => !/^\s*at .*(node_modules[\\/]|node:internal|\(<anonymous>\)|<anonymous>$)/.test(l))
    .map((l) => (r ? l.split(r).join('').split(r.replace(/\//g, '\\')).join('') : l))
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length))
  if (indent > 0 && Number.isFinite(indent)) for (let i = 0; i < lines.length; i++) lines[i] = lines[i].slice(indent)
  const kept = lines.slice(0, max)
  if (lines.length > max) kept.push(`… (${lines.length - max} more lines)`)
  return kept
}

/** vitest JSON (`--reporter=json`) → [{ file, name, lines }]. A file that failed to load has no tests: it is one entry. */
export function vitestFailures(report, root) {
  const out = []
  for (const file of report?.testResults ?? []) {
    const name = relative(file.name, root)
    const failed = (file.assertionResults ?? []).filter((a) => a.status === 'failed')
    for (const a of failed) {
      const title = [...(a.ancestorTitles ?? []), a.title].filter(Boolean).join(' > ')
      out.push({ file: name, name: title || a.fullName || '(unnamed test)', lines: firstLines((a.failureMessages ?? []).join('\n'), root) })
    }
    if (failed.length === 0 && file.status === 'failed') {
      out.push({ file: name, name: '(the file itself failed: no test ran)', lines: firstLines(file.message || 'no message', root) })
    }
  }
  return out
}

/** Playwright JSON (`json` reporter) → [{ file, name, lines }] for tests whose outcome is unexpected or flaky. */
export function playwrightFailures(report, root) {
  const out = []
  // spec files are relative to the config's rootDir (the testDir): shown relative to the clone instead
  const base = String(report?.config?.rootDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  const specPath = (file) => (base && file && !/^([A-Za-z]:)?\//.test(file) ? `${base}/${file}` : file)
  const walk = (suite, titles) => {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(suite.title) ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'unexpected' && t.status !== 'flaky') continue
        const last = [...(t.results ?? [])].reverse().find((r) => r.status !== 'passed' && r.status !== 'skipped') ?? {}
        const msg = last.error?.message ?? (last.errors ?? []).map((e) => e.message).join('\n') ?? ''
        const status = t.status === 'flaky' ? 'flaky' : last.status ?? 'failed'
        out.push({
          file: `${relative(specPath(spec.file ?? suite.file), root)}:${spec.line ?? '?'}`,
          name: `${[...here, spec.title].join(' › ')}${status === 'failed' ? '' : ` [${status}]`}`,
          lines: firstLines(msg || `(${status}, no error message)`, root)
        })
      }
    }
    for (const s of suite.suites ?? []) walk(s, here)
  }
  for (const s of report?.suites ?? []) walk(s, [])
  // errors outside any test (global setup, a config that does not load, the app that does not build)
  for (const e of report?.errors ?? []) out.push({ file: '(run)', name: 'error outside the tests', lines: firstLines(e.message ?? e.stack ?? '', root) })
  return out
}

/** The plain vitest log when no JSON exists: each ` FAIL  file > name` block up to the next separator. */
export function vitestLogFailures(log, root) {
  const out = []
  const lines = plain(log).replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*FAIL\s+(\S+)(?:\s+>\s+(.*))?$/.exec(lines[i])
    if (!m) continue
    const body = []
    for (let j = i + 1; j < lines.length && !/^\s*(FAIL\s|⎯{3,})/.test(lines[j]); j++) body.push(lines[j])
    out.push({ file: relative(m[1], root), name: m[2] ?? '(the file itself failed)', lines: firstLines(body.join('\n'), root) })
  }
  const unhandled = lines.findIndex((l) => /Unhandled (Error|Rejection)/.test(l))
  if (unhandled >= 0) out.push({ file: '(run)', name: 'unhandled error', lines: firstLines(lines.slice(unhandled, unhandled + 40).join('\n'), root) })
  return out
}

/** The plain Playwright log (`list` reporter) when no JSON exists: each `  N) file:line › title ───` block. */
export function playwrightLogFailures(log, root) {
  const out = []
  const lines = plain(log).replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{2}\d+\)\s+(\S+:\d+(?::\d+)?)\s+›\s+(.*?)\s*─*\s*$/.exec(lines[i])
    if (!m) continue
    const body = []
    for (let j = i + 1; j < lines.length && !/^\s{2}(\d+\)\s|\d+\s+(passed|failed|flaky|skipped|did not run|interrupted)\b)/.test(lines[j]); j++) body.push(lines[j])
    out.push({ file: relative(m[1], root), name: m[2], lines: firstLines(body.join('\n').replace(/^\n+/, ''), root) })
  }
  return out
}

/** Markdown for one step, capped at LIMITS.failures entries and LIMITS.chars characters. */
export function render(kind, failures, source) {
  const head = [`Failing tests (${failures.length}, from the ${source}):`]
  if (failures.length === 0) {
    head.push('', `No failing test found in the ${source}: the step failed outside the tests (see the end of its log).`)
    return head.join('\n')
  }
  const files = [...new Set(failures.map((f) => f.file.replace(/(:\d+)+$/, '')))]
  head.push('', `Files: ${files.map((f) => `\`${f}\``).join(', ')}`)
  const blocks = []
  let size = head.join('\n').length
  let shown = 0
  for (const f of failures.slice(0, LIMITS.failures)) {
    const block = [``, `- \`${f.file}\` — ${f.name}`, '  ```', ...f.lines.map((l) => `  ${l.replace(/```/g, "'''")}`), '  ```'].join('\n')
    if (size + block.length > LIMITS.chars) break
    blocks.push(block)
    size += block.length
    shown++
  }
  const rest = failures.length - shown
  if (rest > 0) blocks.push('', `… ${rest} more failing ${kind === 'vitest' ? 'tests' : 'specs'} not shown (the log has them all).`)
  return [...head, ...blocks].join('\n')
}

/** The whole summary: JSON first, the plain log when the JSON is missing, unreadable or empty of failures. */
export function summarise(kind, jsonText, logText, root) {
  let failures = []
  let source = 'JSON report'
  let report
  try {
    report = jsonText ? JSON.parse(jsonText) : null
  } catch {
    report = null
  }
  if (report) failures = kind === 'vitest' ? vitestFailures(report, root) : playwrightFailures(report, root)
  if (report && kind === 'vitest' && logText) {
    // vitest's JSON keeps only the message and the stack; its plain log has the diff and the code frame: prefer it
    const blocks = new Map(vitestLogFailures(logText, root).map((f) => [`${f.file} > ${f.name}`, f.lines]))
    failures = failures.map((f) => ({ ...f, lines: blocks.get(`${f.file} > ${f.name}`) ?? f.lines }))
  }
  if (!report && !logText) return 'Neither a JSON report nor a log could be read: see the step’s log by hand.'
  if (failures.length === 0 && logText) {
    const fromLog = kind === 'vitest' ? vitestLogFailures(logText, root) : playwrightLogFailures(logText, root)
    if (fromLog.length > 0 || !report) {
      failures = fromLog
      source = report ? 'plain log (the JSON report lists no failure)' : 'plain log (no readable JSON report)'
    }
  }
  return render(kind, failures, source)
}

const readOr = (file) => {
  try {
    return file ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [kind, json, log] = process.argv.slice(2)
  const i = process.argv.indexOf('--root')
  const root = i > 0 ? process.argv[i + 1] : undefined
  if ((kind !== 'vitest' && kind !== 'playwright') || json === undefined || log === undefined) {
    console.error('usage: node verify-summary.mjs vitest|playwright <report.json> <plain.log> [--root <repo>]')
    process.exit(2)
  }
  try {
    const text = summarise(kind, readOr(json), readOr(log), root)
    process.stdout.write(text + '\n')
    if (!text.startsWith('Failing tests (') || text.startsWith('Failing tests (0,')) process.exitCode = 3
  } catch (e) {
    process.stdout.write(`(the summary itself failed: ${e?.message ?? e}; read the log)\n`)
    process.exitCode = 3
  }
}
