// The agent's proposal and the diff of an edit (production-12, decisions 0024 and 0032): from a fake channel profile the
// proposal has three variants built from the base by visible edit operations, priced by the estimator (cheap < faithful <
// premium) and scored by the fit; the references' open points become questions whose answers are operations; an edit is
// shown as a diff with Δ cost and Δ fit, and an invalid operation is refused with a typed error.
import { describe, expect, it } from 'vitest'
import { applyOps, avatarBase, fromBase, optionProblem, technologyRegistry } from '../../src/engine/technologies'
import { estimateCost, type PriceBook } from '../../src/engine/technologies/cost'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { diffPipelines, tryEdit } from '../../src/engine/technologies/pipeline-diff'
import { proposePipelines, unmeasuredDimensions } from '../../src/engine/technologies/propose'

const reg = technologyRegistry()
const ctx = { language: 'fr', channelHasSponsor: true }
const book: PriceBook = {
  currency: 'credits',
  engines: {
    'presenter:infinitetalk-fast': { unit: 'second', perUnit: 1.8 },
    'presenter:hedra-c3': { unit: 'second', perUnit: 3 },
    'presenter:heygen-avatar4': { unit: 'second', perUnit: 5 },
    'presenter:kling-avatar2-std': { unit: 'second', perUnit: 5.6 },
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

/** A fake avatar channel as the eyes measure it: presenter ≈ 20 %, clips and stills, ~4 s shots, no captions. */
const CHANNEL: VideoMeasure[] = [
  { minutes: 14, presenterShare: 0.2, kinds: { clipAi: 0.3, imageAi: 0.7 }, shotS: 3.8, captions: false, sponsor: true },
  { minutes: 16, presenterShare: 0.22, kinds: { clipAi: 0.28, imageAi: 0.72 }, shotS: 4.1, captions: false, sponsor: true },
  { minutes: 15, presenterShare: 0.18, kinds: { clipAi: 0.32, imageAi: 0.68 }, shotS: 4, captions: false, sponsor: true }
]

describe('the agent proposes pipelines', () => {
  const p = proposePipelines({ videos: CHANNEL, ctx, cost, name: 'Grand-mère cuisine' }, reg)

  it('offers three variants made from the base by edit operations, the faithful one recommended', () => {
    expect(p.base).toBe('avatar@1')
    expect(p.variants.map((v) => v.kind)).toEqual(['faithful', 'cheap', 'premium'])
    expect(p.recommended).toBe('faithful')
    const checkOption = (o: string, v: unknown) => optionProblem(avatarBase.options, o, v)
    for (const v of p.variants) {
      const start = { ...fromBase(avatarBase, 'Grand-mère cuisine'), format: v.doc.format, language: 'fr' }
      const r = applyOps(start, v.ops, reg, { checkOption })
      expect(r.ok && r.doc).toEqual(v.doc)
      expect(v.doc.format.minutes).toBe(15)
    }
  })

  it('prices every variant with the estimator: cheap < faithful < premium', () => {
    const avg = p.variants.map((v) => v.estimate?.perMinute.avg ?? NaN)
    for (const [i, v] of p.variants.entries()) {
      const e = estimateCost(v.doc, reg, cost)
      expect(e.ok && e.estimate.perMinute.avg).toBe(avg[i])
    }
    expect(avg[1]).toBeLessThan(avg[0] as number)
    expect(avg[0]).toBeLessThan(avg[2] as number)
  })

  it('fits the faithful variant to the channel better than the base does', () => {
    const faithful = p.variants[0]
    expect(faithful?.fit).toBeGreaterThanOrEqual(90)
    const base = proposePipelines({ videos: [], ctx, cost }, reg)
    expect(base.variants[0]?.fit).toBeNull()
  })

  it('asks only what the references do not show, and an answer is operations in every variant', () => {
    expect(p.questions.map((q) => q.id)).toEqual(['script'])
    const blank = proposePipelines({ videos: [], ctx: { language: 'fr' }, cost, answers: { presenter: 'high', sponsor: 'no' } }, reg)
    expect(blank.questions.map((q) => [q.id, q.answer])).toEqual([
      ['script', null],
      ['sponsor', 'no'],
      ['captions', null],
      ['presenter', 'high']
    ])
    for (const v of blank.variants) {
      expect(v.doc.options.sponsor).toBe('off')
      expect(v.doc.mix?.presenter).toBeCloseTo(0.45, 3)
    }
    expect(unmeasuredDimensions([])).toEqual(['presenter', 'kinds', 'rhythm', 'script', 'look', 'text', 'sponsor'])
  })
})

describe('an edit is shown as a diff with Δ cost and Δ fit', () => {
  const doc = proposePipelines({ videos: CHANNEL, ctx, cost }, reg).variants[0]?.doc ?? fromBase(avatarBase)
  const apply = { checkOption: (o: string, v: unknown) => optionProblem(avatarBase.options, o, v) }

  it('« moins cher »: eco pictures and fewer clips lower the average and the diff lists exactly those changes', () => {
    const r = tryEdit(doc, [{ op: 'setOption', option: 'quality.images', value: 'eco' }, { op: 'setOption', option: 'clipShare', value: 0.1 }], reg, apply, { cost, videos: CHANNEL, ctx })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    // in the document's order of options (the faithful variant already set the clip share)
    expect(r.changes.map((c) => [c.kind, c.key])).toEqual([
      ['option', 'clipShare'],
      ['option', 'quality.images']
    ])
    expect(r.perMinute?.after.avg).toBeLessThan(r.perMinute?.before.avg as number)
    expect(r.fit.before).not.toBeNull()
    expect(r.fit.after).toBeLessThan(r.fit.before as number)
  })

  it('an invalid operation is refused with a typed error, and nothing changes', () => {
    const r = tryEdit(doc, [{ op: 'setEngine', brick: 'avatar.speak', engine: 'image:nano-banana-2' }, { op: 'teleport' }], reg, apply, { cost })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.map((e) => [e.op, e.code])).toEqual([
      [0, 'engine_family'],
      [1, 'bad_op']
    ])
  })

  it('names bricks added, removed and moved', () => {
    const r = applyOps(doc, [{ op: 'removeBrick', brick: 'sound.music' }, { op: 'addBrick', tech: 'script.factcheck@1' }, { op: 'moveBrick', brick: 'qc.check', after: null }], reg, apply)
    if (!r.ok) throw new Error('refused')
    expect(diffPipelines(doc, r.doc).map((c) => c.kind)).toEqual(['brick-added', 'brick-removed', 'order'])
  })
})
