// production-17: the first real 60 s video showed one still for its last 34 s (nine pictures that could not be made, each
// filled with its neighbour's, played end to end). The render refuses such a film, and a node output with filled pictures is
// provisional: never reused, so the next run remakes only what is missing.
import { describe, expect, it } from 'vitest'
import { effectiveRun } from '../../src/engine/plan'
import { MAX_SAME_PICTURE_S, shotProblems, shotWarnings, type CheckedShot } from '../../src/engine/render/shot-check'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FsArtefactStore, isProvisional, MemoryArtefactStore } from '../../src/engine/store'

const shot = (id: string, startS: number, endS: number, source: string, o: Partial<CheckedShot> = {}): CheckedShot => ({ id, presenter: false, startS, endS, source, borrowed: false, ...o })

describe('the last check before the render', () => {
  it('refuses the first real run’s film: 8 shots of one picture from 0:31 to 0:58', () => {
    const shots = [
      shot('s001', 0, 4.4, 'p1', { presenter: true }),
      shot('s005', 4.4, 8.2, 'wardrobe'),
      shot('s004', 27.5, 31.5, 'p4', { presenter: true }),
      ...Array.from({ length: 8 }, (_, i) => shot(`s0${9 + i}`, 31.5 + i * 3.33, 31.5 + (i + 1) * 3.33, 'house', { borrowed: i > 0 }))
    ]
    const problems = shotProblems(shots)
    expect(problems[0]).toMatch(/27 s de suite montrent la même image \(8 plans, de 0:31 à 0:58\)/)
    expect(problems[1]).toMatch(/7 plans sur 9 n’ont pas leur propre image/)
  })

  it('lets a film through: different pictures, one planned long shot, a presenter between two equal pictures, one borrowed picture in eight', () => {
    expect(shotProblems([shot('a', 0, 3, 'x'), shot('b', 3, 6, 'y'), shot('c', 6, 9, 'x')])).toEqual([])
    expect(shotProblems([shot('a', 0, 12, 'x')])).toEqual([])
    expect(shotProblems([shot('a', 0, 5, 'x'), shot('p', 5, 9, 'p', { presenter: true }), shot('b', 9, 14, 'x')])).toEqual([])
    expect(shotProblems([shot('a', 0, 4, 'x'), shot('b', 4, MAX_SAME_PICTURE_S, 'x', { borrowed: true }), ...['c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => shot(id, 8 + i * 3, 11 + i * 3, id))])).toEqual([])
  })
})

describe('the Cloud fakes return one image for every shot (QA B2)', () => {
  const fakeFilm = Array.from({ length: 7 }, (_, i) => shot(`s${i}`, 4 + i * 2.3, 4 + (i + 1) * 2.3, 'fake-image'))
  it('does not stop the render when every shot has its own (identical) picture: it warns', () => {
    expect(shotProblems(fakeFilm)).toEqual([])
    expect(shotWarnings(fakeFilm)).toEqual([expect.stringMatching(/^16 s de suite montrent la même image \(7 plans, de 0:04 à 0:20\)$/)])
  })
  it('still stops it when some of those shots stand in for a missing picture', () => {
    const film = fakeFilm.map((s, i) => (i > 0 ? { ...s, borrowed: true } : s))
    expect(shotProblems(film)[0]).toMatch(/^16 s de suite/)
    expect(shotWarnings(film)).toEqual([])
  })
})

describe('a provisional output is never reused', () => {
  it('effectiveRun skips it, and the next run of the same fingerprint replaces it', async () => {
    const store = new MemoryArtefactStore()
    const fp = 'a'.repeat(64)
    const provisional = { fingerprint: fp, outputs: { images: { type: 'image.still[]', fingerprint: 'b'.repeat(64), meta: { provisional: true } } } } as never
    await store.putRun(provisional)
    expect(isProvisional((await store.getRun(fp)) as never)).toBe(true)
    expect(await effectiveRun(store, undefined, 'scope', 'visuals', fp)).toBeNull()
    const full = { fingerprint: fp, outputs: { images: { type: 'image.still[]', fingerprint: 'c'.repeat(64), meta: {} } } } as never
    const stored = await store.putRun(full)
    expect(stored.outputs.images?.fingerprint).toBe('c'.repeat(64))
    expect((await effectiveRun(store, undefined, 'scope', 'visuals', fp))?.outputs.images?.fingerprint).toBe('c'.repeat(64))
    // a full run stays (an existing run wins)
    expect((await store.putRun(provisional)).outputs.images?.fingerprint).toBe('c'.repeat(64))
  })

  it('the store on disk replaces a provisional run too', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atelier-provisional-'))
    try {
      const store = new FsArtefactStore(dir)
      const fp = 'd'.repeat(64)
      await store.putRun({ fingerprint: fp, outputs: { images: { type: 'image.still[]', fingerprint: 'e'.repeat(64), meta: { provisional: true } } } } as never)
      const next = await store.putRun({ fingerprint: fp, outputs: { images: { type: 'image.still[]', fingerprint: 'f'.repeat(64), meta: {} } } } as never)
      expect(next.outputs.images?.fingerprint).toBe('f'.repeat(64))
      expect(isProvisional((await new FsArtefactStore(dir).getRun(fp)) as never)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
