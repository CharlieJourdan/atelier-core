// The cost estimator (production-11, decision 0023, docs/specs/production-model.md §8–§9): with the 2026-10-31 public
// prices of docs/specs/pipeline-avatar.md §9 loaded as a fixture grid (real cost, US $), a price change in the grid moves the
// estimate; per video adds the one-offs; the LLM line follows the team's backend; each option choice has its Δ cost. The
// table of pipeline-avatar §6 (production-10 grid) is reproduced in cost-ladder.test.ts.
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { estimateCost, optionCostDeltas, type CostAssumptions, type CostEstimate, type CostInput, type PriceBook } from '../../src/engine/technologies/cost'

const reg = technologyRegistry()

/** pipeline-avatar §9, read 2026-10-30 / 31: US $ per unit (HeyGen plan and Hedra 720p are fixture-only engine ids). */
const GRID_2026_10_31: PriceBook = {
  currency: 'usd',
  engines: {
    'presenter:heygen-avatar4': { unit: 'second', perUnit: 0.05 },
    'presenter:heygen-plan': { unit: 'second', perUnit: 0.013 },
    'presenter:hedra-c3': { unit: 'second', perUnit: 0.025 },
    'presenter:hedra-c3-720p': { unit: 'second', perUnit: 0.05 },
    'presenter:kling-avatar2-std': { unit: 'second', perUnit: 0.0562 },
    'presenter:infinitetalk-fast': { unit: 'second', perUnit: 0.015 },
    'presenter:infinitetalk-gpu': { unit: 'second', perUnit: 0.005 },
    'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 0.075, maxSecondsPerCall: 8 },
    'clip:veo31-lite-vertex': { unit: 'second', perUnit: 0.03 },
    'clip:veo31-lite': { unit: 'clip', perUnit: 0.15, maxSecondsPerCall: 8 },
    'image:gpt-image-25-low': { unit: 'image', perUnit: 0.0059 },
    'image:gpt-image-25-medium': { unit: 'image', perUnit: 0.0132 },
    'image:flux-schnell': { unit: 'image', perUnit: 0.003 },
    'image:nano-banana-2': { unit: 'image', perUnit: 0.067 },
    'voice:elevenlabs-v2': { unit: 'kchars', perUnit: 0.08 },
    'voice:minimax-28-hd': { unit: 'kchars', perUnit: 0.1 },
    'voice:fish-s2': { unit: 'kchars', perUnit: 0.015 },
    'music:library': { unit: 'minute', perUnit: 0 },
    'music:elevenlabs-music': { unit: 'minute', perUnit: 0.15 }
  },
  llm: {
    models: {
      'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
      'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 }
    },
    perUsd: 1
  }
}

type Engines = [string, ...string[]]
interface Preset {
  mix: RecipeDoc['mix']
  presenter: Engines | null
  clips: Engines | null
  images: Engines
  voice: Engines
  assumptions?: CostAssumptions
  /** pipeline-avatar §6: min, avg, max per finished minute, US $. */
  table: [number, number, number]
}

/** The presets of pipeline-avatar §6, as pipelines made from `avatar@1`. */
const PRESETS: Record<string, Preset> = {
  'avatar-eco': {
    mix: { presenter: 0.25, clipAi: 0.1, imageAi: 0.65, curve: 'hook-heavy' },
    presenter: ['presenter:infinitetalk-fast', 'presenter:hedra-c3'],
    clips: ['clip:veo31-lite-relaxed', 'clip:veo31-lite-vertex'],
    images: ['image:gpt-image-25-low', 'image:gpt-image-25-medium'],
    voice: ['voice:fish-s2', 'voice:elevenlabs-v2'],
    assumptions: { clipShotsPerGeneration: 2 },
    table: [0.4, 0.41, 0.96]
  },
  'avatar-mix HeyGen API': {
    mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' },
    presenter: ['presenter:heygen-avatar4', 'presenter:kling-avatar2-std'],
    clips: ['clip:veo31-lite-relaxed', 'clip:veo31-lite'],
    images: ['image:gpt-image-25-low', 'image:gpt-image-25-medium'],
    voice: ['voice:elevenlabs-v2', 'voice:minimax-28-hd'],
    table: [1.26, 1.32, 1.98]
  },
  'avatar-mix open model on a rented GPU': {
    mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' },
    presenter: ['presenter:infinitetalk-gpu', 'presenter:infinitetalk-fast'],
    clips: ['clip:veo31-lite-relaxed', 'clip:veo31-lite'],
    images: ['image:gpt-image-25-low', 'image:gpt-image-25-medium'],
    voice: ['voice:elevenlabs-v2', 'voice:minimax-28-hd'],
    table: [0.49, 0.51, 1.17]
  },
  'avatar-mix HeyGen plan credits': {
    mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' },
    presenter: ['presenter:heygen-plan', 'presenter:heygen-avatar4'],
    clips: ['clip:veo31-lite-relaxed', 'clip:veo31-lite'],
    images: ['image:gpt-image-25-low', 'image:gpt-image-25-medium'],
    voice: ['voice:elevenlabs-v2', 'voice:minimax-28-hd'],
    table: [0.63, 0.66, 1.86]
  },
  'avatar-premium': {
    mix: { presenter: 0.35, clipAi: 0.3, imageAi: 0.35, curve: 'hook-heavy' },
    presenter: ['presenter:heygen-avatar4', 'presenter:hedra-c3-720p', 'presenter:kling-avatar2-std'],
    clips: ['clip:veo31-lite', 'clip:veo31-lite-vertex'],
    images: ['image:gpt-image-25-medium', 'image:nano-banana-2'],
    voice: ['voice:elevenlabs-v2', 'voice:minimax-28-hd'],
    assumptions: { clipSecondsPerGeneration: 8 },
    table: [2.1, 2.2, 3.78]
  },
  'archives-mix': {
    mix: { presenter: 0.3, stock: 0.2, archive: 0.2, imageAi: 0.3, curve: 'flat', shotLengthS: { presenter: 8 } },
    presenter: ['presenter:infinitetalk-fast', 'presenter:hedra-c3'],
    clips: null,
    images: ['image:gpt-image-25-low', 'image:gpt-image-25-medium'],
    voice: ['voice:fish-s2', 'voice:elevenlabs-v2'],
    table: [0.33, 0.35, 0.7]
  }
}

function pipelineOf(p: Preset): { doc: RecipeDoc; assumptions: CostAssumptions } {
  const doc = fromBase(avatarBase)
  doc.mix = p.mix
  // the clip-share slider always sets the clip share (decision 0027): the preset's own
  doc.options.clipShare = p.mix?.clipAi ?? 0
  const set = (tech: string, e: Engines): void => {
    const b = doc.bricks.find((x) => x.tech === tech)
    if (!b) throw new Error(tech)
    b.engine = e[0]
    b.fallbacks = e.slice(1)
  }
  if (p.presenter) set('avatar.speak@1', p.presenter)
  else doc.bricks = doc.bricks.filter((b) => b.tech !== 'avatar.speak@1')
  set('visuals.fulfil@1', p.images)
  set('voice.tts@1', p.voice)
  // the clip brick (production-8) holds the clip engines and the shots per generation the presets once assumed
  const { clipShotsPerGeneration, ...assumptions } = p.assumptions ?? {}
  if (p.clips) {
    set('clip.make@1', p.clips)
    const b = doc.bricks.find((x) => x.tech === 'clip.make@1') as RecipeDoc['bricks'][number]
    b.settings = { ...b.settings, shotsPerGeneration: clipShotsPerGeneration ?? 1 }
  } else doc.bricks = doc.bricks.filter((b) => b.tech !== 'clip.make@1')
  return { doc, assumptions }
}

function estimate(doc: RecipeDoc, input: Partial<CostInput> = {}): CostEstimate {
  const r = estimateCost(doc, reg, { book: GRID_2026_10_31, backend: 'subscription', ...input })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.estimate
}

// The §6 table of 2026-10-31 these presets came from was replaced by the production-10 grid (Charlie's providers of 11-01) and
// the estimator now counts the 0.1 s silences between presenter stretches (a gap production-7 left open): the ladder of the new
// grid is tests/unit/cost-ladder.test.ts. The presets stay here as pipelines the tests below price.
describe('prices come from the grid', () => {
  const { doc, assumptions } = pipelineOf(PRESETS['avatar-mix HeyGen API'] as Preset)

  it('a price change in the grid moves the estimate, and only the lines that use it', () => {
    const before = estimate(doc, { assumptions })
    const dearer: PriceBook = { ...GRID_2026_10_31, engines: { ...GRID_2026_10_31.engines, 'presenter:heygen-avatar4': { unit: 'second', perUnit: 0.06 } } }
    const after = estimate(doc, { assumptions, book: dearer })
    // shown × (1 + (two handles + the silence) ÷ shot length)
    const presenterS = 60 * 0.26 * (1 + (2 * 0.2 + 0.1) / 4)
    expect(after.perMinute.min - before.perMinute.min).toBeCloseTo(presenterS * 0.01, 9)
    expect(after.lines.find((l) => l.id === 'images')).toEqual(before.lines.find((l) => l.id === 'images'))
  })

  it('an engine missing from the grid is reported, not guessed', () => {
    const engines = { ...GRID_2026_10_31.engines }
    delete engines['voice:minimax-28-hd']
    const e = estimate(doc, { assumptions, book: { ...GRID_2026_10_31, engines } })
    expect(e.lines.find((l) => l.id === 'voice')?.unpriced).toEqual(['voice:minimax-28-hd'])
  })

  it('a book in credits gives credits (the same quantities priced with the Cloud grid)', () => {
    const credits: PriceBook = {
      currency: 'credits',
      engines: Object.fromEntries(Object.entries(GRID_2026_10_31.engines).map(([id, p]) => [id, { ...p, perUnit: p.perUnit * 100 }])),
      llm: GRID_2026_10_31.llm
    }
    const usd = estimate(doc, { assumptions })
    const cr = estimate(doc, { assumptions, book: credits })
    expect(cr.currency).toBe('credits')
    expect(cr.perMinute.avg).toBeCloseTo(usd.perMinute.avg * 100, 6)
  })
})

describe('per video, per brick, backend and options', () => {
  it('per video = per minute × length + the thumbnails; a short video keeps its curve', () => {
    const doc = fromBase(avatarBase)
    const e = estimate(doc)
    const thumbs = e.lines.find((l) => l.id === 'thumbnails')
    expect(thumbs?.perMinute.avg).toBe(0)
    expect(thumbs?.perVideo.min).toBeCloseTo(3 * 0.0059, 9)
    expect(e.perVideo.min).toBeCloseTo(e.perMinute.min * 12 + 3 * 0.0059, 9)
    expect(e.minutes).toBe(12)
    // production-17 (Charlie's rule « comme sur une vidéo longue »): the curve is fitted on a long video; 12 min get the mix's
    // shares, a short one the long video's first rows: the hook-heavy opening, no stills, dearer a minute
    expect(e.shares.imageAi).toBeCloseTo(0.53, 2)
    const short = estimate(doc, { minutes: 0.5 })
    expect(short.shares.imageAi ?? 0).toBe(0)
    expect(short.shares.clipAi ?? 0).toBeGreaterThan(0.4)
    expect(short.perMinute.avg).toBeGreaterThan(e.perMinute.avg)
  })

  it('the LLM line: 0 on « mon abonnement », ≈ 0,05 $ per minute on « crédits Atelier », shown as the saving of Claude Code', () => {
    const doc = fromBase(avatarBase)
    const sub = estimate(doc)
    const credits = estimate(doc, { backend: 'credits' })
    const key = estimate(doc, { backend: 'api-key' })
    expect(sub.llm.tasks).toEqual(['script', 'director', 'metadata'])
    expect(sub.llm.onCreditsPerMinute.avg).toBeCloseTo(0.0524, 4)
    expect(credits.perMinute.avg - sub.perMinute.avg).toBeCloseTo(0.0524, 4)
    expect(key.perMinute.avg).toBeCloseTo(sub.perMinute.avg, 9)
    expect(key.llm.usdPerMinute.avg).toBeCloseTo(0.0524, 4)
  })

  it('every option choice that can be picked has its Δ cost; quality and the clip share move it, captions do not', () => {
    const doc = fromBase(avatarBase)
    const d = optionCostDeltas(doc, reg, { book: GRID_2026_10_31, backend: 'subscription' })
    expect(d['captions']).toEqual({ false: 0, true: 0 })
    expect(d['quality.images']?.eco).toBe(0)
    expect(d['quality.images']?.premium).toBeGreaterThan(0.5)
    expect(d['quality.presenter']?.standard).toBeGreaterThan(0.6)
    expect(d['clipShare']?.['+0.05']).toBeGreaterThan(0)
    // « bientôt » choices are not offered
    expect(d['music']).toEqual({ library: 0, none: 0 })
  })

  it('a pipeline that does not compile is not estimated', () => {
    const doc = { ...fromBase(avatarBase), options: { nope: true } }
    expect(estimateCost(doc, reg, { book: GRID_2026_10_31, backend: 'subscription' }).ok).toBe(false)
  })
})
