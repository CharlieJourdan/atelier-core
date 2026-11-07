// avatar-layouts: the presenter's layout follows the references shot by shot (research note avatar-layouts-2026-11 (old repository)) — as a
// setting of the pipeline (side, inset geometry and spacing, kinds of moment), never an engine rule.
import { describe, expect, it } from 'vitest'
import type { EditPlan } from '../../src/engine/formats/editplan'
import { insetBox, Inset } from '../../src/engine/formats/inset'
import { triggerOf } from '../../src/engine/nodes/director-layout-rules'
import { PresenterLayouts, plannedLayouts, type LayoutSlot } from '../../src/engine/nodes/director-layouts'
import { pipGraph } from '../../src/engine/render/final'

const ALL = ['full', 'split', 'pip'] as const
const LAYOUTS = PresenterLayouts.parse({ fromS: 77, full: 0, split: 0.78, pip: 0.22 })

/** Reference 2's presenter appearances: 35 runs, one every ≈ 17 s, 5.6 s long (two slots in a third of them). */
function appearances(n: number, kindAt?: (i: number) => LayoutSlot['kind']): LayoutSlot[] {
  const out: LayoutSlot[] = []
  for (let i = 0; i < n; i++) {
    const start = 5 + i * 17
    out.push({ start, end: start + 3, kind: kindAt?.(i) })
    if (i % 3 === 0) out.push({ start: start + 3, end: start + 5.6, kind: kindAt?.(i) })
  }
  return out
}

describe('the kinds of moment', () => {
  it('sorts a sentence by its words, French and English', () => {
    expect(triggerOf("Je m'appelle Marcel.")).toBe('intro')
    expect(triggerOf('Racontez-moi en commentaire celui de ces 5 gestes.')).toBe('cta')
    expect(triggerOf("Juste à côté du compteur, il y a souvent la troisième chose.")).toBe('item')
    expect(triggerOf('Mais il y a une deuxième erreur.')).toBe('item')
    expect(triggerOf('Votre compteur, il est où ?')).toBe('question')
    expect(triggerOf("Une dame à Cali n'a jamais pu le fermer.")).toBe('story')
    expect(triggerOf('Never turn it off for the winter.')).toBe('claim')
    expect(triggerOf('My name is Sam and I have been a plumber for 30 years.')).toBe('intro')
    expect(triggerOf('Please leave a comment below.')).toBe('cta')
    expect(triggerOf("Vous dévissez le tuyau d'arrosage et vous ouvrez le robinet.")).toBe('explain')
  })
})

describe('the planned layouts', () => {
  it('keeps the hook full frame, then split and inset in their shares, never full again', () => {
    const slots = appearances(40)
    const l = plannedLayouts(slots, LAYOUTS, ALL)
    slots.forEach((s, i) => s.start < 77 && expect(l[i]).toBe('full'))
    const after = slots.map((s, i) => ({ s, k: l[i] as string })).filter((x) => x.s.start >= 77)
    expect(after.some((x) => x.k === 'full')).toBe(false)
    const time = (k: string): number => after.filter((x) => x.k === k).reduce((t, x) => t + x.s.end - x.s.start, 0)
    const sum = time('split') + time('pip')
    expect(Math.abs(time('pip') / sum - 0.22)).toBeLessThan(0.06)
  })

  it('keeps two insets apart by insetGapS, and an inset goes on as a split inside the same appearance', () => {
    const slots = appearances(60)
    const l = plannedLayouts(slots, { ...LAYOUTS, insetGapS: 45 }, ALL)
    const insetStarts = slots.filter((_, i) => l[i] === 'pip').map((s) => s.start)
    expect(insetStarts.length).toBeGreaterThan(3)
    for (let i = 1; i < insetStarts.length; i++) expect((insetStarts[i] as number) - (insetStarts[i - 1] as number)).toBeGreaterThanOrEqual(45)
    // slots that follow each other are one appearance: an inset is never in the middle of one
    slots.forEach((s, i) => {
      const prev = slots[i - 1]
      if (prev && Math.abs(prev.end - s.start) < 1e-6 && s.start >= 77) expect(l[i]).not.toBe('pip')
    })
  })

  it('gives a kind of moment its own weights: « who I am » is a split, a call to act an inset', () => {
    const slots = appearances(30, (i) => (i % 2 === 0 ? 'intro' : 'cta'))
    const l = plannedLayouts(slots, PresenterLayouts.parse({ ...LAYOUTS, triggers: { intro: { split: 1 }, cta: { pip: 1 } } }), ALL)
    slots.forEach((s, i) => {
      if (s.start < 77) return
      const first = !slots[i - 1] || Math.abs((slots[i - 1] as LayoutSlot).end - s.start) > 1e-6
      if (first) expect(l[i]).toBe(s.kind === 'intro' ? 'split' : 'pip')
    })
  })

  it('does not place an inset when the pipeline does not allow it', () => {
    expect(plannedLayouts(appearances(40), LAYOUTS, ['full', 'split']).includes('pip')).toBe(false)
  })

  it('refuses shares that do not add to 1 and a kind of moment without a layout', () => {
    expect(PresenterLayouts.safeParse({ fromS: 0, full: 0.5, split: 0.1, pip: 0.1 }).success).toBe(false)
    expect(PresenterLayouts.safeParse({ ...LAYOUTS, triggers: { cta: {} } }).success).toBe(false)
  })
})

describe('the inset', () => {
  it('lands where reference 2 puts it: bottom left, 16:9, 37 % of the width, a 6 px white border', () => {
    const box = insetBox(Inset.parse({}), [1920, 1080])
    expect(box).toEqual({ x: 21, y: 635, w: 712, h: 406, border: 6 })
    expect(box.x + box.w).toBeLessThan(960)
    expect(Math.abs(box.w - 712)).toBeLessThanOrEqual(2)
  })

  it('goes to another corner as a setting', () => {
    const b = insetBox(Inset.parse({ corner: 'top-right' }), [1920, 1080])
    expect(b.x + b.w + 21).toBe(1920)
    expect(b.y).toBe(39)
  })

  it('is drawn as a bordered window over the picture; without an inset the older square stays', () => {
    const g = pipGraph({ startS: 1, endS: 4, inset: Inset.parse({}) }, 3, '[a]', '[b]', [1920, 1080])
    expect(g).toContain('scale=700:394')
    expect(g).toContain('pad=712:406:6:6:color=white')
    expect(g).toContain('overlay=x=21:y=635')
    expect(pipGraph({ startS: 1, endS: 4 }, 3, '[a]', '[b]', [1920, 1080])).toContain('boxblur')
  })
})

describe('the director with the measured layouts', () => {
  it('puts the presenter left in every split, frames each inset as the pipeline sets it, and spaces the insets', async () => {
    const { directorPlan } = await import('../../src/engine/nodes/director-plan')
    const { art, makeCtx } = await import('./engine-node-helpers')
    const { makeFrenchFilm } = await import('./film-fixture-fr12')
    const film = makeFrenchFilm(720)
    const inset = Inset.parse({})
    const layouts = { fromS: 77, full: 0, split: 0.78, pip: 0.22, presenterSide: 'left', inset, insetGapS: 45 }
    const params = directorPlan.params.parse({
      avatar: { segments: ['hook', 'outro'], layout: 'full' },
      screen: { mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' }, layouts: ['full', 'split', 'pip'], presenterLayouts: layouts }
    })
    const out = await directorPlan.fake(
      makeCtx({}),
      {
        beats: art('json.beats', { value: film.beats as never }),
        words: art('json.words', { value: film.words as never, meta: { durationS: film.durationS, alignment: 'provider', matched: 1, language: 'fr' } }),
        outline: art('json.outline', { value: film.outline as never })
      },
      params as never
    )
    const plan = out.plan?.value as unknown as EditPlan
    const splits = plan.shots.filter((s) => s.layout === 'split')
    const pips = plan.shots.filter((s) => s.layout === 'pip' && s.kind === 'avatar')
    expect(splits.length).toBeGreaterThan(5)
    expect(splits.every((s) => s.beside?.side === 'right')).toBe(true)
    expect(pips.length).toBeGreaterThan(1)
    expect(pips.every((s) => s.inset?.corner === 'bottom-left' && s.inset.widthFrac === 0.371)).toBe(true)
    const starts = pips.map((s) => s.startFrame / 30)
    for (let i = 1; i < starts.length; i++) expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(45)
    // the hook keeps the presenter full frame, and he is never full frame again after it
    const fulls = plan.shots.filter((s) => s.kind === 'avatar' && s.layout === 'full')
    expect(fulls.length).toBeGreaterThan(0)
    expect(fulls.every((s) => s.startFrame / 30 < 77)).toBe(true)
  })
})

describe('the end of the video', () => {
  it('lays the presenter out on its own shares in the last seconds (half inset, as both references)', () => {
    const l = PresenterLayouts.parse({ ...LAYOUTS, insetGapS: 0, outro: { lastS: 45, full: 0, split: 0.5, pip: 0.5 } })
    const slots: LayoutSlot[] = Array.from({ length: 28 }, (_, i) => ({ start: 100 + i * 6, end: 104 + i * 6 }))
    const total = 270
    const k = plannedLayouts(slots, l, ALL, total)
    const tail = slots.map((s, i) => ({ s, k: k[i] })).filter((x) => x.s.start >= total - 45)
    expect(tail.length).toBeGreaterThanOrEqual(4)
    expect(Math.abs(tail.filter((x) => x.k === 'pip').length - tail.length / 2)).toBeLessThanOrEqual(1)
    // the body keeps its 78 / 22
    const body = slots.map((s, i) => ({ s, k: k[i] })).filter((x) => x.s.start < total - 45)
    expect(body.filter((x) => x.k === 'pip').length / body.length).toBeLessThan(0.4)
    // without the total, no outro
    expect(plannedLayouts(slots, l, ALL).filter((x) => x === 'pip').length).toBeLessThan(k.filter((x) => x === 'pip').length)
  })
})

describe('where the full-frame hook ends', () => {
  it('stops at fullUntilS, before the first split (round 3: a slot at 52 s was full frame because fromS was 77)', () => {
    const slots: LayoutSlot[] = [
      { start: 0, end: 6.9 },
      { start: 8.9, end: 13.5 },
      { start: 43.4, end: 48.4 },
      { start: 52.3, end: 58.5 },
      { start: 90.8, end: 95.2 }
    ]
    const old = plannedLayouts(slots, PresenterLayouts.parse({ fromS: 77, full: 0, split: 0.78, pip: 0.22 }), ALL)
    expect(old.filter((k) => k === 'full').length).toBe(4)
    const fixed = plannedLayouts(slots, PresenterLayouts.parse({ fromS: 77, fullUntilS: 51, full: 0, split: 0.78, pip: 0.22 }), ALL)
    expect(fixed.slice(0, 3)).toEqual(['full', 'full', 'full'])
    expect(fixed[3]).not.toBe('full')
  })
})
