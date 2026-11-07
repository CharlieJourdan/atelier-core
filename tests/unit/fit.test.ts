// Fit % (production-11, decision 0023, docs/specs/production-model.md §12): a pipeline built from a channel's own measured
// profile fits it at 100 %, and the fit drops on each changed dimension (only that dimension loses); under three measured
// videos there is no fit; the three biggest gaps come with the change that closes each and its cost.
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import type { PriceBook } from '../../src/engine/technologies/cost'
import { fitOf, predictProfile, type FitDimension, type VideoMeasure } from '../../src/engine/technologies/fit'
import { fitGaps, pipelineForProfile, withCloser } from '../../src/engine/technologies/fit-gaps'

const reg = technologyRegistry()
const ctx = { language: 'fr', channelHasSponsor: true }

/** Three videos of an avatar channel as the eyes would measure them (one measure per video). */
const CHANNEL: VideoMeasure[] = [
  { minutes: 12, presenterShare: 0.3, kinds: { clipAi: 0.25, imageAi: 0.75 }, shotS: 4.0, wordsPerMinute: 170, chapters: false, cta: true, look: 'clean-stock', captions: true, sponsor: true },
  { minutes: 14, presenterShare: 0.32, kinds: { clipAi: 0.3, imageAi: 0.7 }, shotS: 4.4, wordsPerMinute: 176, chapters: false, cta: true, look: 'clean-stock', captions: true, sponsor: true },
  { minutes: 13, presenterShare: 0.28, kinds: { clipAi: 0.28, imageAi: 0.72 }, shotS: 4.2, wordsPerMinute: 180, chapters: false, cta: true, look: 'clean-stock', captions: true, sponsor: true }
]

const fit = (doc: RecipeDoc, videos = CHANNEL, c = ctx) => {
  const p = predictProfile(doc, reg, c)
  if (!p) throw new Error('does not compile')
  return fitOf(videos, p)
}
const percent = (doc: RecipeDoc): number => {
  const r = fit(doc)
  if (!r.ok) throw new Error(r.reason)
  return r.percent
}
const lost = (doc: RecipeDoc): FitDimension[] => {
  const r = fit(doc)
  if (!r.ok) throw new Error(r.reason)
  return r.dimensions.filter((d) => d.score !== null && d.score < 0.999).map((d) => d.id)
}

describe('fit %', () => {
  const own = pipelineForProfile(fromBase(avatarBase), CHANNEL, reg, ctx)

  it('a pipeline built from the channel’s own measured profile fits it at 100 %, on all seven dimensions', () => {
    const r = fit(own)
    expect(r.ok && r.percent).toBe(100)
    expect(r.ok && r.dimensions.map((d) => [d.id, d.score])).toEqual([
      ['presenter', 1],
      ['kinds', 1],
      ['rhythm', 1],
      ['script', 1],
      ['look', 1],
      ['text', 1],
      ['sponsor', 1]
    ])
  })

  it('drops on each changed dimension, and only that one loses', () => {
    const changes: [FitDimension, RecipeDoc][] = [
      ['presenter', withCloser(own, { kind: 'mix', shares: { presenter: 0.6, clipAi: 0.112, imageAi: 0.288 } })],
      ['kinds', withCloser(own, { kind: 'option', option: 'clipShare', value: 0.05 })],
      ['rhythm', withCloser(own, { kind: 'rhythm', shotLengthS: { presenter: 9, clipAi: 8, imageAi: 8 } })],
      ['script', withCloser(own, { kind: 'minutes', minutes: 25 })],
      ['look', withCloser(own, { kind: 'look', style: 'phone-real' })],
      ['text', withCloser(own, { kind: 'option', option: 'captions', value: false })]
    ]
    for (const [dimension, doc] of changes) {
      expect(percent(doc), dimension).toBeLessThan(100)
      expect(lost(doc), dimension).toContain(dimension)
    }
    // one dimension alone, at the profile level (the sponsor option is « bientôt »: the channel has none any more)
    const noSponsor = fit(own, CHANNEL, { language: 'fr', channelHasSponsor: false })
    expect(noSponsor.ok && noSponsor.percent).toBe(90)
    // the pace: a slower voice
    expect(lost(withCloser(own, { kind: 'speed', speed: 0.7 }))).toEqual(['script'])
  })

  it('needs three measured videos (« pas assez de vidéos pour mesurer »)', () => {
    expect(fit(own, CHANNEL.slice(0, 2))).toEqual({ ok: false, reason: 'not-enough-videos', videos: 2 })
  })

  it('a dimension the eyes do not measure is left out, not counted as a miss', () => {
    const coarse = CHANNEL.map((v) => ({ minutes: v.minutes, shotS: v.shotS, kinds: { imageAi: 0.8, stock: 0.2 }, kindsCoarse: true }))
    const r = fit(own, coarse)
    expect(r.ok && r.dimensions.filter((d) => d.score === null).map((d) => d.id)).toEqual(['presenter', 'look', 'text', 'sponsor'])
    // made vs found only: the pipeline makes everything (100 % made) against 80 % made
    expect(r.ok && r.dimensions.find((d) => d.id === 'kinds')?.score).toBeLessThan(1)
  })
})

describe('the three biggest gaps, each with what closes it', () => {
  const book: PriceBook = {
    currency: 'credits',
    engines: {
      'presenter:infinitetalk-fast': { unit: 'second', perUnit: 1.8 },
      // production-10: the default presenter and voice are now these (decision 0038), at the same prices
      'presenter:heygen-mcp': { unit: 'second', perUnit: 1.8 },
      'voice:ai33': { unit: 'kchars', perUnit: 9.7 },
      'presenter:hedra-c3': { unit: 'second', perUnit: 3 },
      'image:gpt-image-25-low': { unit: 'image', perUnit: 0.7 },
      'image:gpt-image-25-medium': { unit: 'image', perUnit: 1.6 },
      'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 9, maxSecondsPerCall: 8 },
      'clip:veo31-lite-vertex': { unit: 'second', perUnit: 3.6 },
      'voice:elevenlabs-v2': { unit: 'kchars', perUnit: 9.7 },
      'voice:minimax-28-hd': { unit: 'kchars', perUnit: 12 },
      'music:library': { unit: 'minute', perUnit: 0 }
    },
    llm: null
  }

  it('lists at most three, biggest first, each closer actually closes its gap, with its cost per minute', () => {
    const base = fromBase(avatarBase)
    const gaps = fitGaps(base, CHANNEL, reg, ctx, { book, backend: 'subscription' })
    // the base wears « phone-real » (10 points lost), its shots are shorter (6), its presenter share a little lower (5)
    expect(gaps.map((g) => g.dimension)).toEqual(['look', 'rhythm', 'presenter'])
    for (const g of gaps) {
      expect(g.closer, g.dimension).not.toBeNull()
      expect(g.scoreAfter as number).toBeGreaterThan(g.score)
      expect(typeof g.costDelta).toBe('number')
    }
    expect(gaps[0]?.closer).toEqual({ kind: 'look', style: 'clean-stock' })
    expect(gaps[0]?.costDelta).toBe(0)
    // more presenter time costs more (the presenter is the dearest picture)
    expect(gaps[2]?.closer?.kind).toBe('mix')
    expect(gaps[2]?.costDelta as number).toBeGreaterThan(0)
    // captions come next: the option closes it at no cost
    const after = fitGaps(withCloser(withCloser(base, gaps[0]?.closer as never), gaps[1]?.closer as never), CHANNEL, reg, ctx, { book, backend: 'subscription' })
    expect(after.find((g) => g.dimension === 'text')?.closer).toEqual({ kind: 'option', option: 'captions', value: true })
  })

  it('a pipeline at 100 % has no gap', () => {
    expect(fitGaps(pipelineForProfile(fromBase(avatarBase), CHANNEL, reg, ctx), CHANNEL, reg, ctx)).toEqual([])
  })
})
