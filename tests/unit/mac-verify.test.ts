import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM helper without type declarations
import { judgePlaywrightLog } from '../../scripts/e2e-gate.mjs'

const judge = judgePlaywrightLog as (text: string) => { ok: boolean; reason: string }
const script = readFileSync(path.resolve(__dirname, '../../scripts/mac-verify.sh'), 'utf8').replace(/\r\n/g, '\n')

describe('e2e gate (judgePlaywrightLog)', () => {
  it('accepts a run where everything passed', () => {
    expect(judge('Running 12 tests using 1 worker\n\n  12 passed (34.5s)\n').ok).toBe(true)
  })
  it('rejects skipped specs next to passed ones', () => {
    const v = judge('  10 passed (20.1s)\n  2 skipped\n')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('2 skipped')
  })
  it('rejects specs that did not run', () => {
    expect(judge('  1 failed\n  3 did not run\n').ok).toBe(false)
    expect(judge('  5 passed (9s)\n  3 did not run\n').ok).toBe(false)
  })
  it('rejects failures', () => {
    expect(judge('  1 failed\n    [chromium] › a.spec.ts:3:1 › x\n  4 passed (8s)\n').ok).toBe(false)
  })
  it('rejects a log with no passed count', () => {
    expect(judge('').ok).toBe(false)
    expect(judge('Error: e2e cannot run here\n').ok).toBe(false)
  })
  it('rejects an all-skipped run', () => {
    expect(judge('  9 skipped\n').ok).toBe(false)
  })
})

describe('scripts/mac-verify.sh', () => {
  it('unsets the e2e skip/force switches before the first step', () => {
    const firstStep = script.search(/^step \S/m)
    expect(firstStep).toBeGreaterThan(0)
    for (const v of ['ATELIER_E2E_SKIP', 'ATELIER_E2E_ALLOW_SKIP', 'ATELIER_E2E_FORCE']) {
      const m = new RegExp(`^unset .*\\b${v}\\b`, 'm').exec(script)
      expect(m, v).not.toBeNull()
      expect(m!.index, v).toBeLessThan(firstStep)
    }
  })
  it('judges the e2e and packaged logs through the gate', () => {
    expect(script).toMatch(/^\s*step e2e e2e_run e2e npm run test:e2e$/m)
    expect(script).toMatch(/^\s*step packaged e2e_run packaged npm run test:packaged$/m)
    expect(script).toContain('e2e-gate.mjs')
    expect(script).toMatch(/e2e-gate\.mjs" "\$gatelog" \|\| return 1/)
  })
  it('does not export FORCE_COLOR=0', () => {
    expect(script).not.toMatch(/export[^\n]*FORCE_COLOR=/)
  })
  it('compares the bundle id to fr.charlie.atelier', () => {
    expect(script).toMatch(/\[\[ "\$bid" == fr\.charlie\.atelier \]\]/)
  })
  it('no longer trusts an inherited copy variable', () => {
    expect(script).not.toContain('rm -f "$ATELIER_VERIFY_COPY"')
    expect(script).not.toMatch(/\bATELIER_VERIFY_COPY\b/)
    expect(script).toMatch(/if \[\[ "\$0" == "\$\{_ATELIER_MAC_VERIFY_SELF_COPY:-\}" \]\]/)
  })
  it('asks vitest and Playwright for JSON reports next to the logs, fresh for each run', () => {
    expect(script).toMatch(/rm -f "\$LOGS\/test\.json"\n\s*ATELIER_VITEST_JSON="\$LOGS\/test\.json" npm test/)
    expect(script).toMatch(/^step test unit_tests$/m)
    expect(script).toMatch(/rm -f "\$LOGS\/\$name\.json"\n\s*ATELIER_E2E_JSON="\$LOGS\/\$name\.json" "\$@" 2>&1 \| tee "\$gatelog" \|\| return 1/)
    for (const f of ['../../playwright.config.ts', '../../playwright.packaged.config.ts', '../../vitest.config.mts']) {
      const cfg = readFileSync(path.resolve(__dirname, f), 'utf8')
      expect(cfg, f).toMatch(/ATELIER_(E2E|VITEST)_JSON/)
    }
  })
  it('summarises every failed step in the report without touching the verdict', () => {
    const fn = /^failure_summary\(\) \{\n([\s\S]*?)\n\}/m.exec(script)
    expect(fn).not.toBeNull()
    expect(fn![1]).toContain('verify-summary.mjs')
    // only exit 0 (failures listed) skips the end of the log
    expect(fn![1]).toMatch(/if node "\$summariser"[^\n]*; then return 0; fi\n\s*echo\n\s*fi\n\s*echo "Last 15 lines/)
    expect(fn![1]).not.toMatch(/\b(FAILED|CODES)\b/)
    const media = /^media_tools\(\) \{\n([\s\S]*?)\n\}/m.exec(script)
    expect(media![1]).not.toMatch(/\b(FAILED|CODES)\b/)
    expect(script).toMatch(/failure_summary "\$\{NAMES\[\$i\]\}" \|\| true/)
    expect(script).toMatch(/media_tools \|\| true/)
    expect(script).toContain('## Failures')
  })
  it('rejects refs starting with a dash', () => {
    expect(script).toMatch(/"\$1" == -\*/)
  })
})
