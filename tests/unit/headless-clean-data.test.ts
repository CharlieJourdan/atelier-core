// `--clean-data` on a stopped brain frees the render leftovers made in the last hour (moteur-briques): the one-hour spare is for a
// brain that may be reading them, and a proof's segments are always that fresh when the chantier cleans right after it.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { brainRunningOn, cleanDataOptions } from '../../src/main/headless/clean-data'

function dataDir(pid?: string): string {
  const d = mkdtempSync(path.join(tmpdir(), 'clean-data-'))
  mkdirSync(path.join(d, 'production', 'cache', 'segments'), { recursive: true })
  writeFileSync(path.join(d, 'production', 'cache', 'segments', 'a.mp4'), Buffer.alloc(1000))
  if (pid !== undefined) writeFileSync(path.join(d, 'brain-run.pid'), pid)
  return d
}

describe('clean-data on a stopped brain', () => {
  it('reads the runner pid file (plain number) and the keeper one (JSON)', () => {
    expect(brainRunningOn(dataDir('4242'), (p) => p === 4242)).toBe(true)
    expect(brainRunningOn(dataDir('{"brain":77}'), (p) => p === 77)).toBe(true)
    expect(brainRunningOn(dataDir('4242'), () => false)).toBe(false)
    expect(brainRunningOn(dataDir(), () => true)).toBe(false)
    expect(brainRunningOn(dataDir('not a pid'), () => true)).toBe(false)
  })

  it('spares nothing on a stopped brain, one hour when one runs or when no pid file says (the app folder)', () => {
    expect(cleanDataOptions({ dataDir: dataDir('4242'), apply: true, budgetGb: 0 }, () => false)).toEqual({ dryRun: false, budgetBytes: 0, sparedMs: 0, brainRunning: false })
    expect(cleanDataOptions({ dataDir: dataDir(), apply: true, budgetGb: 0 }, () => false)).toEqual({ dryRun: false, budgetBytes: 0, sparedMs: 3_600_000, brainRunning: false })
    const live = cleanDataOptions({ dataDir: dataDir('9'), apply: false, budgetGb: null }, (p) => p === 9)
    expect(live).toEqual({ dryRun: true, sparedMs: 3_600_000, brainRunning: true })
  })

  it('frees a segment made a minute ago once the brain is stopped', async () => {
    const { housekeep } = await import('../../src/engine/render/housekeeping')
    const d = dataDir('4242')
    const o = cleanDataOptions({ dataDir: d, apply: true, budgetGb: 0 }, () => false)
    const r = await housekeep(path.join(d, 'production'), o)
    expect(r.freedBytes).toBe(1000)
    expect(r.evicted).toHaveLength(1)
  })
})
