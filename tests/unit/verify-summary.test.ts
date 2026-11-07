// scripts/verify-summary.mjs: the failing tests and their first lines in the Mac report (lot P4M). The fixtures are
// real outputs of vitest 5 and Playwright (json reporter + plain log) on a small suite made to fail, with the paths
// rewritten to a Mac clone (/Users/me/dev/atelier).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM helper without type declarations
import * as summary from '../../scripts/verify-summary.mjs'

interface Failure {
  file: string
  name: string
  lines: string[]
}
const s = summary as {
  LIMITS: { lines: number; failures: number; chars: number }
  firstLines: (message: string, root?: string, max?: number) => string[]
  vitestFailures: (report: unknown, root?: string) => Failure[]
  playwrightFailures: (report: unknown, root?: string) => Failure[]
  vitestLogFailures: (log: string, root?: string) => Failure[]
  playwrightLogFailures: (log: string, root?: string) => Failure[]
  render: (kind: string, failures: Failure[], source: string) => string
  summarise: (kind: 'vitest' | 'playwright', json: string, log: string, root?: string) => string
}

const FIX = path.join(__dirname, 'fixtures', 'verify-summary')
const read = (f: string): string => readFileSync(path.join(FIX, f), 'utf8')
const ROOT = '/Users/me/dev/atelier'
const SCRIPT = path.resolve(__dirname, '../../scripts/verify-summary.mjs')

describe('verify-summary: vitest', () => {
  it('lists each failing test with its file, its describe path and its first lines (JSON report)', () => {
    const f = s.vitestFailures(JSON.parse(read('vitest.json')), ROOT)
    expect(f.map((x) => `${x.file} | ${x.name}`)).toEqual([
      'tests/unit/engine-demo-fixture.test.ts | engine render > renders the bottom band',
      'tests/unit/engine-demo-fixture.test.ts | throws an engine error'
    ])
    expect(f[1]!.lines.slice(0, 2)).toEqual(["Error: ffmpeg failed (exit 1): No such filter: 'ass'", 'Error initializing filters'])
    // runner internals are dropped, the clone's path is shortened
    const all = f.flatMap((x) => x.lines).join('\n')
    expect(all).not.toMatch(/node_modules|node:internal/)
    expect(all).not.toContain(ROOT)
    expect(all).toContain('at tests/unit/engine-demo-fixture.test.ts:5:40')
  })

  it('reads the same failures from the plain log, with the diff', () => {
    const f = s.vitestLogFailures(read('vitest.log'), ROOT)
    expect(f.map((x) => x.name)).toEqual(['engine render > renders the bottom band', 'throws an engine error'])
    expect(f[0]!.lines).toContain('-   "ok": true,')
  })

  it('prefers the log block (diff, code frame) for a test the JSON lists', () => {
    const out = s.summarise('vitest', read('vitest.json'), read('vitest.log'), ROOT)
    expect(out).toContain('Failing tests (2, from the JSON report)')
    expect(out).toContain('Files: `tests/unit/engine-demo-fixture.test.ts`')
    expect(out).toContain('-   "ok": true,')
    expect(out).toContain("No such filter: 'ass'")
  })

  it('falls back to the plain log when the JSON is missing or broken', () => {
    for (const json of ['', '{ not json']) {
      const out = s.summarise('vitest', json, read('vitest.log'), ROOT)
      expect(out).toContain('from the plain log (no readable JSON report)')
      expect(out).toContain('engine render > renders the bottom band')
    }
  })

  it('reports a test file that failed to load as one entry', () => {
    const report = { testResults: [{ name: `${ROOT}/tests/unit/x.test.ts`, status: 'failed', message: 'Failed to load url ./missing', assertionResults: [] }] }
    expect(s.vitestFailures(report, ROOT)).toEqual([{ file: 'tests/unit/x.test.ts', name: '(the file itself failed: no test ran)', lines: ['Failed to load url ./missing'] }])
  })
})

describe('verify-summary: Playwright', () => {
  it('lists the unexpected specs with file:line, describe path and the error (JSON report)', () => {
    const f = s.playwrightFailures(JSON.parse(read('playwright.json')), ROOT)
    expect(f.map((x) => `${x.file} | ${x.name}`).sort()).toEqual(['tests/e2e/shell.spec.ts:4 | shell › shows the conversations list', 'tests/e2e/shell.spec.ts:6 | boots without error'])
    const conv = f.find((x) => x.name.includes('conversations'))!
    expect(conv.lines).toContain('Expected: "Conversations"')
    expect(conv.lines).toContain('Received: "Accueil"')
  })

  it('reads the failures from the plain list-reporter log, without the indentation', () => {
    const f = s.playwrightLogFailures(read('playwright.log'), ROOT)
    expect(f.map((x) => `${x.file} | ${x.name}`)).toEqual(['shell.spec.ts:4:7 | shell › shows the conversations list', 'shell.spec.ts:6:5 | boots without error'])
    expect(f[0]!.lines[0]).toBe('Error: title of the window')
  })

  it('keeps errors outside any test (a config that does not load)', () => {
    const f = s.playwrightFailures({ suites: [], errors: [{ message: 'Error: Cannot find module x' }] }, ROOT)
    expect(f).toEqual([{ file: '(run)', name: 'error outside the tests', lines: ['Error: Cannot find module x'] }])
  })
})

describe('verify-summary: limits and the command line', () => {
  it('keeps at most LIMITS.lines lines per failure and says how many were cut', () => {
    const lines = s.firstLines(Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'))
    expect(lines).toHaveLength(s.LIMITS.lines + 1)
    expect(lines.at(-1)).toBe(`… (${40 - s.LIMITS.lines} more lines)`)
  })

  it('caps the number of failures and the size of a step', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ file: `tests/unit/f${i}.test.ts`, name: `test ${i}`, lines: Array.from({ length: 15 }, () => 'x'.repeat(120)) }))
    const out = s.render('vitest', many, 'JSON report')
    expect(out.length).toBeLessThanOrEqual(s.LIMITS.chars + 200)
    expect(out).toMatch(/… \d+ more failing tests not shown \(the log has them all\)\./)
  })

  it('never lets a ``` in a message close the Markdown block', () => {
    const out = s.render('vitest', [{ file: 'a.test.ts', name: 'x', lines: ['before ``` after'] }], 'JSON report')
    expect(out.match(/```/g)).toHaveLength(2)
  })

  it('says so when nothing failed inside the tests or nothing could be read', () => {
    expect(s.summarise('vitest', JSON.stringify({ testResults: [] }), '', ROOT)).toContain('the step failed outside the tests')
    expect(s.summarise('playwright', '', '', ROOT)).toContain('Neither a JSON report nor a log could be read')
  })

  it('exits 0 when it lists failures, 3 when it found none, 2 on bad usage', () => {
    const out = execFileSync(process.execPath, [SCRIPT, 'vitest', path.join(FIX, 'none.json'), path.join(FIX, 'vitest.log'), '--root', ROOT], { encoding: 'utf8' })
    expect(out).toContain('engine render > renders the bottom band')
    let code = 0
    try {
      execFileSync(process.execPath, [SCRIPT, 'jest'], { stdio: 'pipe' })
    } catch (e) {
      code = (e as { status: number }).status
    }
    expect(code).toBe(2)
    for (const files of [[path.join(FIX, 'none.json'), path.join(FIX, 'none.log')], [path.join(FIX, 'vitest.json'), path.join(FIX, 'none.log')].map((p, i) => (i === 0 ? path.join(FIX, 'playwright.json') : p))]) {
      let c = 0
      try {
        execFileSync(process.execPath, [SCRIPT, 'vitest', ...files], { stdio: 'pipe' })
      } catch (e) {
        c = (e as { status: number }).status
      }
      expect(c, files.join(' ')).toBe(3)
    }
  })
})
