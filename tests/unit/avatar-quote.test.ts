// The run quote of the base pipeline « Avatar » (avatar@1) agrees with the pipeline's estimate (devis-avatar): the support
// videos are priced by the minutes the eyes watch (none listed, none billed), the director's list is forecast before it is
// planned so the presenter, the clips and the pictures are quoted too, and the base's cap follows the video's length, so a
// 30-second, a 3-minute and a 12-minute project are all accepted at the estimator's price.
import { describe, expect, it } from 'vitest'
import { estimatePipeline } from '../../src/engine/estimate'
import { DEFAULT_SIMPLE_STYLE } from '../../src/engine/pipelines/simple-video'
import { withSpeakers } from '../../src/engine/pipelines/speakers'
import { productionRegistry } from '../../src/engine/nodes'
import { forecastGenlist } from '../../src/engine/nodes/director-forecast'
import { avatarBase, CAP_FIXED_CREDITS, capForMinutes, compileRecipe, fromBase, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { COST_DEFAULTS, estimateCost, type PriceBook } from '../../src/engine/technologies/cost'
import { validatePipeline } from '../../src/engine/validate'
import type { RecipeDocument } from '../../src/shared/api'
import { creditsForUnits } from '../../src/main/credits/prices'
import { creditsBook, nodeUnitPrices } from '../../src/main/production/estimates'
import { quoteMode } from '../../src/main/production/runs/quote'
import { cloudHelpers } from './cloud-app-helpers'
import { memoryCore } from './helpers'

const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): Parameters<typeof creditsBook>[0]
}

/** The price book of a fresh Cloud on its default grid (fakes, nothing paid): the estimator's and the quote's one source. */
function book(): PriceBook {
  const t = cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }
  return creditsBook(engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, t.cloud.pricing.current()), [])
}

const SUPPORT = 'sujet: https://youtu.be/AAAAAAAAAAA\nstructure: https://youtu.be/BBBBBBBBBBB'
const STYLE: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit' }

/** The pipeline a project of `minutes` on « Avatar » compiles to, validated like a run's. */
function compiled(minutes: number) {
  const doc = fromBase(avatarBase)
  const c = compileRecipe(doc, technologyRegistry(), { id: 'avatar-quote', project: { minutes } })
  if (!c.ok) throw new Error(`avatar@1 does not compile: ${c.errors.map((e) => e.code).join(', ')}`)
  const v = validatePipeline(withSpeakers(c.pipeline, STYLE), productionRegistry(), { styleFields: Object.keys(STYLE) })
  if (!v.ok) throw new Error('the avatar@1 pipeline is invalid')
  return { doc, pipeline: c.pipeline, plan: v.plan }
}

const quote = (minutes: number, prices: ReturnType<typeof nodeUnitPrices>, inputs: Record<string, { value: string }> = {}) => {
  const { plan } = compiled(minutes)
  return quoteMode(plan, 'usage_max', { minutes, style: STYLE, useFakes: true, prices, inputs: { topic: { value: 'Pourquoi le ciel est bleu' }, ...inputs } })
}

/** The support node's estimated units for a launch with these inputs. */
async function supportUnits(inputs: Record<string, { value: string }>) {
  const e = await estimatePipeline(compiled(0.5).plan, { budgetMode: 'usage_max', minutes: 0.5, style: STYLE, useFakes: true, inputs: { topic: { value: 'x' }, ...inputs } })
  return e.nodes.find((x) => x.nodeId === 'support')?.estimate.units
}

describe('idea.support is priced by the minutes the eyes watch', () => {
  it('quotes nothing with no support video (was ≈ 6 600 credits)', async () => {
    expect(await supportUnits({})).toEqual([])
    expect(await supportUnits({ supportVideos: { value: '' } })).toEqual([])
    expect(await supportUnits({ supportVideos: { value: '  \n ' } })).toEqual([])
    const q = await quote(0.5, nodeUnitPrices(book()))
    expect(q.nodes.find((n) => n.nodeId === 'support')?.credits).toBe(0)
  })

  it('bills the videos listed (at most the node’s three), the minutes watched, never the generation of video', async () => {
    expect(await supportUnits({ supportVideos: { value: SUPPORT } })).toEqual([{ unit: 'watch_min', qty: 30 }])
    const four = `${SUPPORT}\nhttps://youtu.be/CCCCCCCCCCC\nhttps://youtu.be/DDDDDDDDDDD`
    // supportMax is 3: the fourth is not read, so not billed
    expect(await supportUnits({ supportVideos: { value: four } })).toEqual([{ unit: 'watch_min', qty: 45 }])
    // priced like the Cloud's grid line « analysis.minutes » (about a credit a minute), not like generated video
    const q = await quote(0.5, nodeUnitPrices(book()), { supportVideos: { value: SUPPORT } })
    const credits = q.nodes.find((n) => n.nodeId === 'support')?.credits as number
    expect(credits).toBe(creditsForUnits([{ unit: 'watch_min', qty: 30 }]))
    expect(credits).toBeLessThan(40)
  })
})

describe('the director forecasts what it will ask for', () => {
  it('follows the estimator’s volumes: presenter seconds with handles, one generation per two clip shots', () => {
    const screen = { mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'flat' as const }, placement: 'short' as const, layouts: ['full' as const], people: 'not-presenter' as const, brands: 'real' as const }
    const avatar = { segments: ['hook', 'outro'], layout: 'full', hookS: 8, outroS: 8, creditsPerSecond: 4 }
    const meta = forecastGenlist(10, { screen, avatar, clipShotsPerGeneration: 2 } as never) as Record<string, number>
    const D = 600
    // production-10: the 0.1 s silence between stretches is counted too, as in the estimator
    expect(meta.avatarSeconds).toBeCloseTo(D * 0.26 * (1 + (2 * COST_DEFAULTS.handleS + COST_DEFAULTS.gapS) / COST_DEFAULTS.shotLengthS.presenter), 1)
    expect(meta.videoItems).toBeCloseTo((D * 0.21) / COST_DEFAULTS.shotLengthS.clipAi / 2, 1)
    expect(meta.sharedItems).toBeCloseTo(meta.videoItems as number, 1)
    // production-10: half the clip shots paired = three generations for four shots
    const half = forecastGenlist(10, { screen, avatar, clipShotsPerGeneration: 2, clipPairShare: 0.5 } as never) as Record<string, number>
    expect(half.videoItems).toBeCloseTo(((D * 0.21) / COST_DEFAULTS.shotLengthS.clipAi) * 0.75, 1)
    // nothing is forecast for the rhythm director (no mix)
    expect(forecastGenlist(10, {} as never)).toBeNull()
  })
})

describe('the forecast matches what the real runs billed (#108, decision 0078)', () => {
  // The director of the two real 3-minute runs of production-equipe (2026-11-03). They billed 155 and 142 credits of clips (mean
  // 148.5, at 1.963 a second: 75.6 s) and 35 and 31 of pictures (mean 33, at 0.57 each: 58 pictures); the quote was 115 and 24.
  const screen = { mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' as const }, layouts: ['full' as const, 'split' as const, 'pip' as const], placement: 'short' as const, people: 'not-presenter' as const, brands: 'real' as const }
  const recorded = { screen, avatar: { segments: ['hook', 'outro'], layout: 'full' }, clipShotsPerGeneration: 2, clipPairSameAction: true, clipMotionOnly: true, clipShortEngine: true }

  it('clips: the forecast seconds are within 5 % of the seconds billed', () => {
    const meta = forecastGenlist(3, recorded as never) as Record<string, number>
    expect(Math.abs((meta.videoSeconds as number) - 75.6) / 75.6).toBeLessThanOrEqual(0.05)
  })

  it('pictures: the forecast count is within 5 % of the pictures billed', () => {
    const meta = forecastGenlist(3, recorded as never) as Record<string, number>
    const pictures = (meta.items as number) - (meta.avatarItems as number) - (meta.sharedItems as number)
    expect(Math.abs(pictures - 58) / 58).toBeLessThanOrEqual(0.05)
  })
})

describe('the run quote of « Avatar » agrees with the pipeline’s estimate', () => {
  const TOLERANCE = 0.06

  for (const minutes of [0.5, 3, 12]) {
    it(`${minutes} min: accepted under its cap, within ${TOLERANCE * 100} % of the estimate, line by line`, async () => {
      const b = book()
      const prices = nodeUnitPrices(b)
      const { doc, pipeline } = compiled(minutes)
      const q = await quote(minutes, prices)
      const est = estimateCost(doc as RecipeDoc, technologyRegistry(), { book: b, backend: 'subscription', minutes })
      expect(est.ok).toBe(true)
      if (!est.ok) return
      const cap = pipeline.budget.capCredits as number
      expect(q.totalCredits).toBeLessThanOrEqual(cap)
      // with three support videos the cap still holds
      const withSupport = await quote(minutes, prices, { supportVideos: { value: `${SUPPORT}\nhttps://youtu.be/CCCCCCCCCCC` } })
      expect(withSupport.totalCredits).toBeLessThanOrEqual(cap)
      // the quote counts what is made once, the estimate's average adds its regenerations (5 % on what is generated)
      const avg = est.estimate.perVideo.avg
      expect(Math.abs(q.totalCredits - avg) / avg).toBeLessThanOrEqual(TOLERANCE)
      const line = (id: string): number => est.estimate.lines.find((l) => l.id === id)?.perVideo.avg ?? 0
      const node = (id: string): number => q.nodes.find((n) => n.nodeId === id)?.credits ?? 0
      const near = (got: number, want: number): void => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.max(2, want * 0.08))
      near(node('avatar'), line('presenter') / (1 + COST_DEFAULTS.regenRate))
      near(node('clips'), line('clips') / (1 + COST_DEFAULTS.regenRate))
      near(node('visuals'), line('images') / (1 + COST_DEFAULTS.regenRate))
      near(node('voice'), line('voice'))
      // the quote is no longer missing the presenter and the clips
      expect(node('avatar')).toBeGreaterThan(0)
      expect(node('clips')).toBeGreaterThan(0)
    })
  }
})

describe('the cap follows the video’s length', () => {
  it('capForMinutes: the cap is for the pipeline’s own length, pro rata, never below the fixed allowance', () => {
    expect(capForMinutes(1500, 12, 12)).toBe(1500)
    expect(capForMinutes(1500, 12, 6)).toBe(750)
    expect(capForMinutes(1500, 12, 30)).toBe(3750)
    expect(capForMinutes(1500, 12, 0.5)).toBe(CAP_FIXED_CREDITS)
    // a small cap is the owner’s: kept as it is
    expect(capForMinutes(100, 12, 0.5)).toBe(100)
    expect(capForMinutes(100, 12, 12)).toBe(100)
  })

  it('a compiled project carries the scaled cap; a pipeline without a cap stays without', () => {
    // production-10: the base's cap follows the estimator's max on the new chains, pro rata for 3; vrais-tests: 2 950 (the dearest
    // minute of 3 to 30 min: pairs only on one action leave more clips in the worst case); production-17: 4 600 (a short video is
    // the first minutes of a long one on the curve: more clips a minute); avatar-reglages-voix: 4 900 (the still beside a
    // half-screen or inset presenter is priced)
    // quote-calibration (#108): 4 900 -> 5 400 (clips and pictures as the real runs billed them)
    expect(compiled(12).pipeline.budget.capCredits).toBe(5400)
    expect(compiled(3).pipeline.budget.capCredits).toBe(1350)
    expect(compiled(0.5).pipeline.budget.capCredits).toBe(Math.max(CAP_FIXED_CREDITS, Math.round(5400 / 24)))
    const doc = { ...fromBase(avatarBase), capCredits: null }
    const c = compileRecipe(doc, technologyRegistry(), { id: 'x', project: { minutes: 3 } })
    expect(c.ok && 'capCredits' in c.pipeline.budget).toBe(false)
  })

  it('the base’s cap is the dearest minute of the estimator’s max over 30 s to 30 min, for its own length, rounded up to 50; every length keeps under it', () => {
    const b = book()
    const at = (minutes: number) => {
      const est = estimateCost(fromBase(avatarBase), technologyRegistry(), { book: b, backend: 'subscription', minutes })
      if (!est.ok) throw new Error('no estimate')
      return est.estimate.perVideo
    }
    // if the Cloud’s grid or the estimator move, this says the base’s cap must move with them
    // vrais-tests: a short video is mostly hook (more clips a minute), so its minute is the dearest; the cap per minute covers it
    // production-17: from 30 s (a short video is the first minutes of a long one: all hook, the dearest minute)
    expect(avatarBase.doc.capCredits).toBe(Math.ceil(Math.max(...[0.5, 3, 12, 30].map((m) => (at(m).max * 12) / m)) / 50) * 50)
    for (const minutes of [0.5, 3, 12, 30]) {
      const cap = compiled(minutes).pipeline.budget.capCredits as number
      expect(cap, minutes + ' min').toBeGreaterThanOrEqual(at(minutes).max)
    }
  })
})

describe('in the app: a project on « Avatar » starts at every length', () => {
  for (const minutes of [0.5, 3, 12]) {
    it(`${minutes} min with support videos`, async () => {
      const core = memoryCore()
      const api = core.api
      try {
        const ch = await api['channels.create']({ name: 'Le Labo', niche: 'sciences' })
        const r = await api['recipes.save']({ doc: fromBase(avatarBase) as unknown as RecipeDocument })
        const p = await api['projects.create']({
          recipeId: r.id,
          channelId: ch.id,
          title: 'Pourquoi le ciel est bleu',
          idea: 'Pourquoi le ciel est bleu, expliqué simplement',
          inputs: { supportVideos: SUPPORT },
          adjustments: { minutes }
        })
        const launched = await api['projects.run'](p.id)
        expect(launched.runId).not.toBeNull()
        await api['production.cancel'](launched.runId as number)
      } finally {
        core.close()
      }
    })
  }
})
