// production-10: the cost ladder of Charlie's providers (2026-11-01, docs/specs/pipeline-avatar.md §6). With the Cloud's own
// engines registry as the price book (real cost, US $), the options of `avatar@1` reproduce Charlie's table within 0.01 $ per
// finished minute (the table counts no regeneration: the estimator's `min`), the costs going up, and the HeyGen plan shown
// apart as a fixed monthly cost.
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { estimateCost, type CostEstimate, type PriceBook } from '../../src/engine/technologies/cost'
import { COST_DEFAULTS } from '../../src/engine/technologies/cost-defaults'
import { HOOK_HEAVY } from '../../src/engine/technologies/mix'

const reg = technologyRegistry()

// the Cloud's registry, imported at run time (its files import with `.ts`, outside the app's type check)
interface EngineDeclLike {
  id: string
  unit: PriceBook['engines'][string]['unit']
  costUsdPerUnit: number
  limits: { maxSecondsPerCall?: number }
  planMonthlyUsd?: number
}
const ENGINES_MODULE = 'engines'
const { FAKE_ENGINES } = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as { FAKE_ENGINES: EngineDeclLike[] }

/** The registry of the Cloud as a price book in US $ (what `GET /v1/engines` is built from). */
const GRID_2026_11_01: PriceBook = {
  currency: 'usd',
  engines: Object.fromEntries(
    FAKE_ENGINES.map((d) => [d.id, { unit: d.unit, perUnit: d.costUsdPerUnit, maxSecondsPerCall: d.limits.maxSecondsPerCall ?? null, planMonthlyUsd: d.planMonthlyUsd ?? null }])
  ),
  llm: null
}

/** Charlie's profile: 26 / 21 / 53 with 3.9 clip shots a minute (12.6 s ÷ 3.9 = 3.23 s each; avatar@1's director makes 3.7 s). */
const CLIP_SHOT_S = (60 * 0.21) / 3.9

function estimate(options: Record<string, string>): CostEstimate {
  const doc = fromBase(avatarBase)
  doc.options = { ...TABLE, ...doc.options, ...options }
  if (doc.mix) doc.mix = { ...doc.mix, shotLengthS: { clipAi: CLIP_SHOT_S } }
  const r = estimateCost(doc, reg, { book: GRID_2026_11_01, backend: 'subscription' })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.estimate
}

const line = (e: CostEstimate, id: string): number => e.lines.find((l) => l.id === id)?.perMinute.min ?? 0

/** The cheap clip rules of vrais-tests turned off: the production-10 ladder is measured without them. */
const OFF = { motionShots: 'all', shortClips: 'same' }
/** What Charlie's table of 01/11 assumed (avatar-reglages-voix prices it since): no still priced apart beside a half-screen
 *  presenter (its 53 % of stills is screen time). The new pricing is in avatar-settings-price.test.ts. */
const TABLE = { presenterLayouts: 'full' }

/** Charlie's table: options of avatar@1 → $ per finished minute. */
const LADDER: [string, Record<string, string>, number][] = [
  ['base (presenter continuous, one shot per clip)', { ...OFF, presenterGeneration: 'continuous', clipPairs: 'none' }, 0.7],
  ['+ presenter once then cut', { ...OFF, clipPairs: 'none' }, 0.62],
  ['+ half the clips give two shots', { ...OFF, clipPairs: 'half' }, 0.54],
  ['+ all the clips give two shots', { ...OFF, clipPairs: 'all' }, 0.46]
]

describe('the production-10 ladder on the new grid (pipeline-avatar §6)', () => {
  for (const [name, options, target] of LADDER) {
    it(`${name}: ${target} $/min`, () => {
      const e = estimate(options)
      expect(Math.abs(e.perMinute.min - target)).toBeLessThanOrEqual(0.01)
      // avg adds the 5 % regeneration on what is generated; LLM 0 on « mon abonnement »; every engine priced
      expect(e.perMinute.avg).toBeGreaterThan(e.perMinute.min)
      expect(e.lines.flatMap((l) => l.unpriced)).toEqual([])
      expect(e.lines.find((l) => l.id === 'llm')?.perMinute.avg ?? 0).toBe(0)
    })
  }

  it('the volumes behind it: 23.9 s or 17.5 s of presenter, 3.9 / 2.9 / 1.95 generations, voice 0.006 $', () => {
    const rate = (16 * 0.05) / 60
    expect(line(estimate({ ...OFF, presenterGeneration: 'continuous', clipPairs: 'none' }), 'presenter') / rate).toBeCloseTo(23.9, 1)
    expect(line(estimate({ ...OFF, clipPairs: 'none' }), 'presenter') / rate).toBeCloseTo(17.55, 1)
    expect(line(estimate({ ...OFF, clipPairs: 'none' }), 'clips') / 0.075).toBeCloseTo(3.9, 1)
    expect(line(estimate({ ...OFF, clipPairs: 'half' }), 'clips') / 0.075).toBeCloseTo(2.93, 1)
    expect(line(estimate({ ...OFF, clipPairs: 'all' }), 'clips') / 0.075).toBeCloseTo(1.95, 1)
    expect(line(estimate({ ...OFF, clipPairs: 'none' }), 'images') / 0.0059).toBeCloseTo(13.2, 0)
    expect(line(estimate({}), 'voice')).toBeCloseTo(0.006, 3)
  })

  it('vrais-tests: the default pairs only on one action (0.54 $, between no pairs 0.61 and forced pairs 0.46), short shots per second save 0.02 $', () => {
    // forced pairs across subjects were the cheapest rung but showed the previous scene on a cut (research note reference-video-2026-11 (old repository))
    expect(estimate({}).perMinute.min).toBeCloseTo(0.535, 2)
    expect(estimate({ ...OFF, clipPairs: 'none' }).perMinute.min).toBeGreaterThan(estimate({}).perMinute.min)
    expect(estimate({ ...OFF, clipPairs: 'all' }).perMinute.min).toBeLessThan(estimate({}).perMinute.min)
    expect(estimate({ shortClips: 'same' }).perMinute.min - estimate({}).perMinute.min).toBeCloseTo(0.022, 3)
    // pairs on one action: about a third of the clip shots (17 pairs among the reference's 101 moving shots)
    expect(line(estimate({ shortClips: 'same' }), 'clips') / 0.075).toBeCloseTo(3.9 * (1 - 34 / 101 / 2), 1)
  })

  it('Charlie’s rule (01/11): the default is Headcast’s measured mix 26 / 21 / 53 on its curve and shot lengths, never the reference’s 64 % clips', () => {
    expect(avatarBase.doc.mix).toMatchObject({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' })
    expect(HOOK_HEAVY.map((r) => [r.fromS, r.shares.presenter, r.shares.clipAi, r.shares.imageAi])).toEqual([
      [0, 0.5, 0.5, 0],
      [30, 0.28, 0.6, 0.12],
      [120, 0.25, 0.35, 0.4],
      [300, 0.26, 0.14, 0.6],
      [600, 0.24, 0.03, 0.73]
    ])
    expect(COST_DEFAULTS.shotLengthS).toEqual({ presenter: 4, clipAi: 3.7, imageAi: 3.4 })
  })

  it('a 12-minute video on that curve, at the measured prices: 0.50 $/min, under the ladder’s 0.57 $ (presenter cut, no pairs) and level with « la moitié » (0.50 $) without cutting across subjects', () => {
    const twelve = (o: Record<string, string>): number => {
      const doc = fromBase(avatarBase)
      doc.options = { ...TABLE, ...doc.options, ...o }
      const r = estimateCost(doc, reg, { book: GRID_2026_11_01, backend: 'subscription', minutes: 12 })
      if (!r.ok) throw new Error(r.errors.join('; '))
      return r.estimate.perMinute.min
    }
    expect(twelve({})).toBeCloseTo(0.505, 2)
    expect(twelve({ ...OFF, clipPairs: 'none' })).toBeCloseTo(0.57, 2)
    expect(twelve({ ...OFF, clipPairs: 'half' })).toBeCloseTo(0.5, 2)
  })

  it('vrais-tests: Charlie’s clip-heavy style (25 % presenter, clips at the slider’s 50 %) is 0.63 $/min with the rules, 0.70 $ without', () => {
    const style = (o: Record<string, string>): CostEstimate => {
      const doc = fromBase(avatarBase)
      // these figures were measured with the clip slider at its default 0.21, which until solidite silently replaced the
      // mix's own 0.5 below; the slider is now named, so the same configuration is priced (decision 0078)
      doc.options = { ...TABLE, clipShare: 0.21, ...doc.options, ...o }
      doc.mix = { presenter: 0.25, clipAi: 0.5, imageAi: 0.25, curve: 'hook-heavy', shotLengthS: { clipAi: 3.38, imageAi: 3.4 } }
      const r = estimateCost(doc, reg, { book: GRID_2026_11_01, backend: 'subscription' })
      if (!r.ok) throw new Error(r.errors.join('; '))
      return r.estimate
    }
    expect(style({}).perMinute.min).toBeCloseTo(0.63, 2)
    expect(style({ ...OFF, clipPairs: 'none' }).perMinute.min).toBeCloseTo(0.7, 2)
  })

  it('the costs going up: images medium +0.10 $, Veo Lite without « relaxed » +0.29 $, HeyGen API instead of its plan +0.64 $', () => {
    const base = { ...OFF, presenterGeneration: 'continuous', clipPairs: 'none' }
    expect(estimate({ ...base, 'quality.images': 'standard' }).perMinute.min - estimate(base).perMinute.min).toBeCloseTo(0.1, 1)
    expect(estimate({ ...base, 'quality.clips': 'standard' }).perMinute.min - estimate(base).perMinute.min).toBeCloseTo(0.29, 2)
    const cut = { ...OFF, clipPairs: 'none' }
    expect(estimate({ ...cut, 'quality.presenter': 'standard' }).perMinute.min - estimate(cut).perMinute.min).toBeCloseTo(0.64, 2)
  })

  it('the HeyGen plan is a fixed monthly cost, apart from the price per minute (Pro by default; config.json says Business)', () => {
    const e = estimate({})
    expect(e.fixedMonthly).toEqual([{ engine: 'presenter:heygen-mcp', usd: 49 }])
    expect(estimate({ 'quality.presenter': 'standard' }).fixedMonthly).toEqual([])
  })
})
