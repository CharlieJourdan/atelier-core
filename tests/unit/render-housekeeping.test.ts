import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseHeadlessArgs } from '../../src/main/headless/config'
import { defaultBudgetBytes, housekeep } from '../../src/engine/render/housekeeping'

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)
const H = 3_600_000
let dir: string

async function file(rel: string, bytes: number, ageMs: number): Promise<string> {
  const p = path.join(dir, rel)
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, Buffer.alloc(bytes))
  const t = new Date(NOW - ageMs)
  await utimes(p, t, t)
  return p
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'hk-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('housekeep', () => {
  it('dry run reports and deletes nothing', async () => {
    const a = await file('cache/segments/a.mp4', 1000, 10 * H)
    const o = await file('scratch/999991-abc/001-render/joined.mp4', 500, 10 * H)
    const r = await housekeep(dir, { dryRun: true, budgetBytes: 100, now: NOW, isAlive: () => false })
    expect(existsSync(a)).toBe(true)
    expect(existsSync(o)).toBe(true)
    expect(r.applied).toBe(false)
    expect(r.freedBytes).toBe(1500)
  })

  it('removes the scratch of dead processes, keeps a live one and a fresh one', async () => {
    const dead = await file('scratch/111-aaa/x.bin', 10, 5 * H)
    const live = await file('scratch/222-bbb/x.bin', 10, 5 * H)
    const fresh = await file('scratch/333-ccc/x.bin', 10, 1000)
    const r = await housekeep(dir, { dryRun: false, now: NOW, budgetBytes: 1e9, isAlive: (pid) => pid === 222 })
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(existsSync(fresh)).toBe(true)
    expect(r.scratch.filter((s) => s.remove).map((s) => path.basename(s.path))).toEqual(['111-aaa'])
  })

  it('never removes this process\'s own scratch', async () => {
    const mine = await file(`scratch/${process.pid}-zzz/x.bin`, 10, 50 * H)
    await housekeep(dir, { dryRun: false, now: NOW, budgetBytes: 1e9, isAlive: () => false })
    expect(existsSync(mine)).toBe(true)
  })

  it('evicts re-creatable caches oldest first down to the budget', async () => {
    const old = await file('cache/segments/old.mp4', 400, 30 * H)
    const mid = await file('cache/segments/mid.mp4', 400, 20 * H)
    const mot = await file('cache/motion/m.mp4', 400, 10 * H)
    await housekeep(dir, { dryRun: false, now: NOW, budgetBytes: 800, isAlive: () => true })
    expect(existsSync(old)).toBe(false)
    expect(existsSync(mid)).toBe(true)
    expect(existsSync(mot)).toBe(true)
  })

  it('never evicts what cost money or the shot log', async () => {
    const paid = [
      await file('cache/visuals/pic.png', 5000, 99 * H),
      await file('cache/director/a.json', 5000, 99 * H),
      await file('cache/voice-chunks/v.wav', 5000, 99 * H),
      await file('cloud-keys/k.json', 50, 99 * H),
      await file('video-3/artefacts/h/video.mp4', 5000, 99 * H)
    ]
    await file('cache/segments/s.mp4', 100, 99 * H)
    await housekeep(dir, { dryRun: false, now: NOW, budgetBytes: 0, isAlive: () => true })
    for (const p of paid) expect(existsSync(p)).toBe(true)
  })

  it('spares a file used in the last hour (a run may be reading it) and temporary files being written', async () => {
    const recent = await file('cache/segments/new.mp4', 400, 1000)
    const tmp = await file('cache/segments/.tmp-abc.mp4', 400, 1000)
    await housekeep(dir, { dryRun: false, now: NOW, budgetBytes: 0, isAlive: () => true })
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(tmp)).toBe(true)
  })

  it('a missing data folder is an empty report', async () => {
    const r = await housekeep(path.join(dir, 'nope'), { dryRun: false, now: NOW, budgetBytes: 0 })
    expect(r.freedBytes).toBe(0)
  })

  it('stat after eviction shows the report matches the disk', async () => {
    const p = await file('cache/segments/a.mp4', 300, 40 * H)
    const r = await housekeep(dir, { dryRun: false, budgetBytes: 0, now: NOW, isAlive: () => true })
    expect(r.freedBytes).toBe(300)
    await expect(stat(p)).rejects.toThrow()
  })
})

describe('defaultBudgetBytes', () => {
  it('is a quarter of the room, between 2 and 20 GiB', () => {
    const G = 1024 ** 3
    expect(defaultBudgetBytes(4 * G, 0)).toBe(2 * G)
    expect(defaultBudgetBytes(40 * G, 0)).toBe(10 * G)
    expect(defaultBudgetBytes(1000 * G, 0)).toBe(20 * G)
    expect(defaultBudgetBytes(10 * G, 30 * G)).toBe(10 * G)
  })
})

describe('--clean-data (the brain command)', () => {
  it('is a dry run unless --apply, and stands alone', () => {
    const a = parseHeadlessArgs(['--clean-data', '--budget-gb', '5'], {})
    expect(a.cleanData).toBe(true)
    expect(a.cleanApply).toBe(false)
    expect(a.budgetGb).toBe(5)
    expect(parseHeadlessArgs(['--clean-data', '--apply'], {}).cleanApply).toBe(true)
    expect(() => parseHeadlessArgs(['--apply'], {})).toThrow(/clean-data/)
    expect(() => parseHeadlessArgs(['--clean-data', '--backup-now'], {})).toThrow(/seul/)
  })
})
