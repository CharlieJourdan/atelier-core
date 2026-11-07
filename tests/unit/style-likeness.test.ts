// Reproducing a style (production-15), the pure part: from two fake reference profiles the proposal's predicted measures
// land near the references; references without a presenter give the « sans présentateur » base `voiceover@1`, whose every
// option compiles; the sample is the pipeline cut down (no owner gate, an imported script, the average mix on a flat
// curve) and is quoted by the estimator; its measures are read from an edit plan; the likeness score moves up once a
// gap's edit is applied (predicted), and each gap carries its operations, Δ score and Δ cost.
import { describe, expect, it } from 'vitest'
import { applyOps, avatarBase, basePipeline, checkDeclarations, compileRecipe, fromBase, optionProblem, technologyRegistry, voiceoverBase, type RecipeDoc } from '../../src/engine/technologies'
import type { PriceBook } from '../../src/engine/technologies/cost'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { likeness, likenessGaps, lookOfStyle, predictStyle, shiftMeasure } from '../../src/engine/technologies/likeness'
import { baseForReferences, proposeForStyle } from '../../src/engine/technologies/style-propose'
import { measurePlan, sampleDoc, sampleFacts, sampleQuote, sampleScript } from '../../src/engine/technologies/style-sample'
import type { EditPlan } from '../../src/engine/formats/editplan'

const reg = technologyRegistry()
const book: PriceBook = {
  currency: 'credits',
  engines: {
    'presenter:infinitetalk-fast': { unit: 'second', perUnit: 1.8 },
    'presenter:hedra-c3': { unit: 'second', perUnit: 3 },
    'presenter:heygen-avatar4': { unit: 'second', perUnit: 5 },
    'image:gpt-image-25-low': { unit: 'image', perUnit: 0.7 },
    'image:gpt-image-25-medium': { unit: 'image', perUnit: 1.6 },
    'image:nano-banana-2': { unit: 'image', perUnit: 7 },
    'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 9, maxSecondsPerCall: 8 },
    'clip:veo31-lite-vertex': { unit: 'second', perUnit: 3.6 },
    'voice:elevenlabs-v2': { unit: 'kchars', perUnit: 9.7 },
    'voice:minimax-28-hd': { unit: 'kchars', perUnit: 12 },
    'music:library': { unit: 'minute', perUnit: 0 }
  },
  llm: null
}
const cost = { book, backend: 'subscription' as const }
const ctx = { language: 'fr' }

/** Two reference videos of an avatar channel: presenter ≈ 30 % (full and split), mostly stills, 5 s shots, 180 words / min. */
const AVATAR_REFS: VideoMeasure[] = [
  { minutes: 13, presenterShare: 0.32, layouts: ['full', 'split'], kinds: { clipAi: 0.15, imageAi: 0.85 }, shotS: 5.2, wordsPerMinute: 182, captions: false, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' },
  { minutes: 15, presenterShare: 0.28, layouts: ['full'], kinds: { clipAi: 0.1, imageAi: 0.9 }, shotS: 4.8, wordsPerMinute: 176, captions: false, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' }
]

/** Two reference videos of a voice-over channel: no presenter, real-looking stock, 7 s shots, captions. */
const VOICEOVER_REFS: VideoMeasure[] = [
  { minutes: 10, presenterShare: 0, kinds: { stock: 0.8, imageAi: 0.2 }, shotS: 7, wordsPerMinute: 150, captions: true, lookFamily: 'stock', look: 'clean-stock' },
  { minutes: 11, presenterShare: 0.01, kinds: { stock: 0.75, imageAi: 0.25 }, shotS: 7.4, wordsPerMinute: 156, captions: true, lookFamily: 'stock', look: 'clean-stock' }
]

const checkOption = (doc: RecipeDoc) => (o: string, v: unknown) => optionProblem(basePipeline(doc.base)?.options ?? [], o, v)

describe('the style agent proposes the closest pipeline', () => {
  const p = proposeForStyle({ refs: AVATAR_REFS, ctx, cost, name: 'Style de référence' }, reg)
  const faithful = p.variants.find((v) => v.kind === 'faithful')

  it('keeps the avatar base when the references show a presenter, with priced variants and a free estimate', () => {
    expect(p.base).toBe('avatar@1')
    expect(p.reason).toBe('presenter')
    expect(p.variants.length).toBeGreaterThanOrEqual(2)
    for (const v of p.variants) {
      expect(v.estimate?.perMinute.avg).toBeGreaterThan(0)
      expect(v.likeness).toBeGreaterThanOrEqual(0)
    }
  })

  it('lands the proposal’s measured dimensions near the references', () => {
    const m = predictStyle(faithful?.doc as RecipeDoc, reg, ctx) as VideoMeasure
    expect(m.presenterShare).toBeCloseTo(0.3, 1)
    expect(m.shotS as number).toBeGreaterThan(4.5)
    expect(m.shotS as number).toBeLessThan(5.5)
    expect(m.kinds?.imageAi as number).toBeGreaterThan(0.8)
    expect(Math.abs((m.wordsPerMinute as number) - 179)).toBeLessThan(12)
    expect(m.lookFamily).toBe('photoreal')
    expect(faithful?.likeness as number).toBeGreaterThanOrEqual(75)
    // the base itself is further from the references than the faithful variant
    const raw = predictStyle(fromBase(avatarBase), reg, ctx) as VideoMeasure
    expect(likeness(AVATAR_REFS, raw).score as number).toBeLessThan(faithful?.likeness as number)
  })

  it('gives the « sans présentateur » base to references without a presenter', () => {
    expect(baseForReferences(VOICEOVER_REFS)).toEqual({ baseId: 'voiceover@1', reason: 'no-presenter' })
    const v = proposeForStyle({ refs: VOICEOVER_REFS, ctx, cost }, reg)
    expect(v.base).toBe('voiceover@1')
    for (const variant of v.variants) {
      expect(variant.doc.bricks.some((b) => b.tech.startsWith('avatar.speak'))).toBe(false)
      const m = predictStyle(variant.doc, reg, ctx) as VideoMeasure
      expect(m.presenterShare).toBe(0)
      expect(m.kinds?.stock as number).toBeGreaterThan(0.6)
      expect(m.captions).toBe(true)
      expect(m.lookFamily).toBe('stock')
    }
  })

  it('ships `voiceover@1` with its options declared and every choice compiling', () => {
    expect(checkDeclarations(voiceoverBase.options)).toEqual([])
    expect(voiceoverBase.options.some((o) => o.subject === 'presenter' || o.id === 'presenterInBroll')).toBe(false)
    const doc = fromBase(voiceoverBase)
    expect(compileRecipe(doc, reg, { id: 't' }).ok).toBe(true)
    for (const decl of voiceoverBase.options) {
      const values = decl.kind === 'slider' ? [decl.min, decl.max] : decl.choices.filter((c) => !c.soon).map((c) => c.value)
      for (const value of values) {
        const r = compileRecipe({ ...doc, options: { [decl.id]: value } }, reg, { id: 't' })
        expect(r.ok, `${decl.id}=${String(value)}`).toBe(true)
      }
    }
  })
})

/** A sample's edit plan: 18 s, presenter 4 s in full, then stills and one clip, 5 shots, one label. */
function plan(presenterFrames: number): EditPlan {
  const shot = (id: string, kind: string, a: number, b: number, layout?: 'full' | 'split') => ({ id, track: 'base', startFrame: a, endFrame: b, kind, transitionIn: 'cut', role: 'scene', beat: 0, ...(layout ? { layout } : {}) })
  const p = presenterFrames
  return {
    schema: 'atelier.editplan/1',
    fps: 30,
    size: { w: 1920, h: 1080 },
    frames: 540,
    tracks: { base: [], overlay: [], labels: [] },
    captionsPreset: 'none',
    shots: [
      shot('a', 'avatar', 0, p, 'full'),
      shot('b', 'image.gen', p, p + 120),
      shot('c', 'video.gen', p + 120, p + 240),
      shot('d', 'image.gen', p + 240, 540),
      { id: 'l', track: 'labels', startFrame: 30, endFrame: 90, kind: 'label', transitionIn: 'cut', role: 'scene', beat: 0, text: 'n° 1' }
    ],
    chapters: [],
    diagnostics: []
  } as unknown as EditPlan
}

describe('the sample', () => {
  const variant = proposeForStyle({ refs: AVATAR_REFS, ctx, cost }, reg).variants[0] as { doc: RecipeDoc }

  it('is the pipeline cut down: imported script, no gate, no thumbnails, the average mix on a flat curve', () => {
    const s = sampleDoc(variant.doc, reg, { checkOption: checkOption(variant.doc) })
    expect(s.ok).toBe(true)
    if (!s.ok) return
    expect(s.doc.options.script).toBe('import')
    expect(s.doc.checkpoints).toEqual([])
    expect(s.doc.mix?.curve).toBe('flat')
    expect(s.doc.mix?.presenter).toBeCloseTo(variant.doc.mix?.presenter ?? 0, 2)
    const compiled = compileRecipe(s.doc, reg, { id: 'sample' })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const nodes = compiled.pipeline.nodes.map((n) => n.id)
    expect(nodes).not.toContain('thumbnails')
    expect(nodes).toContain('render')
    // a few credits, from the estimator
    const q = sampleQuote(s.doc, reg, cost)
    expect(q?.avg).toBeGreaterThan(0)
    expect(q?.avg).toBeLessThan(200)
  })

  it('writes its narration from the subject, cut at a sentence', () => {
    const text = 'Une phrase courte pour commencer. '.repeat(12)
    const s = sampleScript(text)
    expect(s.split(' ').length).toBeLessThanOrEqual(63)
    expect(s.endsWith('.')).toBe(true)
  })

  it('is measured from its edit plan', () => {
    const m = measurePlan(plan(120), { words: 54, captions: false, lookFamily: 'photoreal', curve: 'flat' })
    expect(m.presenterShare).toBeCloseTo(120 / 540, 5)
    expect(m.layouts).toEqual(['full'])
    expect(m.kinds?.clipAi).toBeCloseTo(120 / 420, 5)
    expect(m.shotS).toBeCloseTo(18 / 4, 5)
    expect(m.wordsPerMinute).toBeCloseTo(180, 5)
    expect(m.labelsPerMinute).toBeCloseTo(1 / 0.3, 5)
    expect(lookOfStyle('phone-real@2')).toBe('photoreal')
    expect(sampleFacts(variant.doc, reg, 54).lookFamily).toBe('photoreal')
  })
})

describe('the likeness score and its gaps', () => {
  const p = proposeForStyle({ refs: AVATAR_REFS, ctx, cost }, reg)
  const doc = (p.variants.find((v) => v.kind === 'faithful') as { doc: RecipeDoc }).doc
  // a sample that came out with too little presenter, a single layout and the wrong look
  const sample = measurePlan(plan(30), { words: 54, captions: false, lookFamily: 'stock', curve: 'flat' })

  it('scores the sample out of 100 and lists the three biggest gaps with the edit that closes each', () => {
    const now = likeness(AVATAR_REFS, sample)
    expect(now.score).not.toBeNull()
    expect(now.score as number).toBeLessThan(90)
    const gaps = likenessGaps(doc, AVATAR_REFS, sample, reg, { ctx, cost, apply: { checkOption: checkOption(doc) } })
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps.length).toBeLessThanOrEqual(3)
    const closable = gaps.filter((g) => g.ops.length > 0)
    expect(closable.length).toBeGreaterThan(0)
    for (const g of closable) {
      expect(g.scoreAfter as number).toBeGreaterThan(now.score as number)
      expect(typeof g.costDelta).toBe('number')
    }
  })

  it('moves the score up once a gap’s edit is applied', () => {
    const before = likeness(AVATAR_REFS, sample).score as number
    const [gap] = likenessGaps(doc, AVATAR_REFS, sample, reg, { ctx, cost, apply: { checkOption: checkOption(doc) } }).filter((g) => g.ops.length > 0)
    const r = applyOps(doc, gap?.ops ?? [], reg, { checkOption: checkOption(doc) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const moved = shiftMeasure(sample, predictStyle(doc, reg, ctx) as VideoMeasure, predictStyle(r.doc, reg, ctx) as VideoMeasure)
    expect(likeness(AVATAR_REFS, moved).score as number).toBeGreaterThan(before)
    expect(likeness(AVATAR_REFS, moved).score).toBe(gap?.scoreAfter)
  })
})
