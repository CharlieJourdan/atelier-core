// production-8 (decision 0035): with `clipShotsPerGeneration` 2 the mix director pairs a generated-video shot with the next
// one close after it: one generation, the first shot's wide part then a tight crop for the second, priced once. And the
// recurring objects each picture shows are named on its item. Pure.
import { describe, expect, it } from 'vitest'
import { EDITPLAN_SCHEMA, checkSharedClips, type EditPlan, type GenItem, type GenList, type Shot } from '../../src/engine/formats/editplan'
import { markRecurring, shareClips } from '../../src/engine/nodes/director-clips'
import { billedSeconds } from '../../src/engine/nodes/director-run-mix'

/** Base shots end to end: [kind, seconds]. */
function planOf(spec: [Shot['kind'], number][]): { plan: EditPlan; list: GenList } {
  const shots: Shot[] = []
  const items: GenItem[] = []
  let at = 0
  spec.forEach(([kind, s], i) => {
    const frames = Math.round(s * 30)
    const id = `s${i + 1}`
    const gen = kind === 'video.gen' || kind === 'image.gen' ? `g${i + 1}` : undefined
    shots.push({ id, track: 'base', startFrame: at, endFrame: at + frames, kind, ...(gen ? { genItem: gen } : {}), transitionIn: 'cut', role: 'scene', beat: 0 })
    if (gen) {
      items.push({
        id: gen,
        kind: kind as GenItem['kind'],
        prompt: `medium shot of scene ${i + 1}, style`,
        shot: { size: 'medium shot', scene: `scene ${i + 1}` },
        constraints: { durationS: s, aspect: '16:9' },
        context: { beatText: `sentence ${i + 1}`, subject: `subject ${i + 1}`, keyTerms: [] },
        unitPrice: kind === 'video.gen' ? 12 : 2,
        units: kind === 'video.gen' ? Math.ceil(s) : 1,
        priority: 1,
        shotIds: [id]
      })
    }
    at += frames
  })
  const credits = items.reduce((n, it) => n + it.unitPrice * it.units, 0)
  return {
    plan: { schema: EDITPLAN_SCHEMA, fps: 30, size: [1920, 1080], frames: at, tracks: { base: shots.map((s) => s.id), overlay: [], labels: [] }, captionsPreset: 'highlight', shots, chapters: [], diagnostics: [] },
    list: { items, totals: { credits, items: items.length, byKind: {} }, budget: null }
  }
}

describe('two shots per clip', () => {
  it('pairs each clip shot with the next one close after it: one generation, the second priced 0 and showing the same scene', () => {
    const { plan, list } = planOf([
      ['video.gen', 3.5],
      ['image.gen', 3],
      ['video.gen', 3.5],
      ['video.gen', 3.7],
      ['video.gen', 3.6],
      ['image.gen', 20],
      ['video.gen', 3]
    ])
    const r = shareClips(plan, list)
    expect(r.pairs).toBe(2)
    const by = new Map(r.list.items.map((it) => [it.id, it]))
    expect(by.get('g3')?.sameAs).toBe('g1')
    expect(by.get('g5')?.sameAs).toBe('g4')
    // the last one is alone: its partner would be more than 12 s away
    expect(by.get('g7')?.sameAs).toBeUndefined()
    expect(by.get('g3')).toMatchObject({ units: 0, shot: { scene: 'scene 1' }, prompt: 'medium shot of scene 1, style' })
    // priced once: the second shots cost 0, the first ones as long as the pair (3.5 + 3.5 → 7 s, 3.7 + 3.6 → 8 s)
    expect(by.get('g1')?.units).toBe(7)
    expect(by.get('g4')?.units).toBe(8)
    expect(r.list.totals.credits).toBe(list.totals.credits - 12 * 4 - 12 * 4 + 12 * 3 + 12 * 4)
    expect(checkSharedClips(r.list)).toEqual([])
    // billed once: three generations, each as long as its shots end to end
    expect(billedSeconds(r.list)).toMatchObject({ videoItems: 3, sharedItems: 2, videoSeconds: 7 + 8 + 3 })
    // the input list is untouched
    expect(list.items.every((it) => it.sameAs === undefined)).toBe(true)
  })

  it('with a pair share of 0.5 pairs only half the clip shots, spread along the video (production-10)', () => {
    const { plan, list } = planOf(Array.from({ length: 8 }, () => ['video.gen', 3] as [Shot['kind'], number]))
    const r = shareClips(plan, list, { maxSeconds: 8, windowS: 12, pairShare: 0.5 })
    expect(r.pairs).toBe(2)
    const shared = r.list.items.filter((it) => it.sameAs).map((it) => `${it.sameAs}<${it.id}`)
    // single, single, pair, single, single, pair: 6 generations for 8 shots (3 for 4)
    expect(shared).toEqual(['g3<g4', 'g7<g8'])
    expect(billedSeconds(r.list).videoItems).toBe(6)
    expect(shareClips(plan, list, { maxSeconds: 8, windowS: 12, pairShare: 1 }).pairs).toBe(4)
    expect(shareClips(plan, list, { maxSeconds: 8, windowS: 12, pairShare: 0 }).pairs).toBe(0)
  })

  it('never pairs two shots longer together than one generation (8 s)', () => {
    const { plan, list } = planOf([
      ['video.gen', 5],
      ['video.gen', 4]
    ])
    expect(shareClips(plan, list).pairs).toBe(0)
  })

  it('the checker refuses a shared clip that points nowhere', () => {
    const { list } = planOf([['video.gen', 3]])
    const bad: GenList = { ...list, items: [{ ...(list.items[0] as GenItem), sameAs: 'nope' }] }
    expect(checkSharedClips(bad)).toEqual(['item g1 shares the clip of nope, which is not an earlier item'])
  })
})

describe('recurring objects', () => {
  it('names on each picture the recurring objects it shows (its fixed description heads the scene, or its name is said)', () => {
    const { list } = planOf([
      ['image.gen', 3],
      ['image.gen', 3],
      ['video.gen', 3]
    ])
    const items = list.items.map((it, i) => ({ ...it, shot: { size: 'medium shot', scene: ['a blue enamel casserole with a chipped lid; it simmers', 'a wooden spoon on the counter', 'the casserole is lifted'][i] as string } }))
    const out = markRecurring({ ...list, items }, [{ name: 'casserole', description: 'a blue enamel casserole with a chipped lid' }])
    expect(out.items.map((it) => it.recurring ?? [])).toEqual([['casserole'], [], ['casserole']])
  })
})
