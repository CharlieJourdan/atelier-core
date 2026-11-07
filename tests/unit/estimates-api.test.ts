// Estimates in the app (production-11, decision 0023): the pipeline's cost per minute priced with Atelier Cloud's engines
// (its grid: a new grid moves the estimate), kept for offline use, on the team's LLM backend; the fit % to a channel from
// its analysed videos (three needed); the cards; and the run quote reading the same prices (one source of numbers).
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase } from '../../src/engine/technologies'
import { ESTIMATES_METHODS, type EngineInfo, type RecipeDocument } from '../../src/shared/api'
import { DEFAULT_ENGINES } from '../../src/shared/cloud-engines'
import { creditsForUnits } from '../../src/main/credits/prices'
import { EyesStore } from '../../src/main/eyes/store'
import { cachedUnitPrices, ENGINES_CACHE_KEY, EstimatesService } from '../../src/main/production/estimates'
import type { AnalysisResult } from '../../src/shared/video-analysis'
import { appCore, cloudHelpers, connect, startCloud } from './cloud-app-helpers'
import { memoryCore } from './helpers'

interface CloudInternals {
  pricing: { current(): { creditValueEur: number; usdToEur: number; overheadPct: number; items: unknown[] }; publish(input: unknown, actor: string): unknown }
  engines?: unknown
}

const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}

/** The engines the Cloud would publish on its current grid (fakes, nothing paid). */
function cloudEngines(): { engines: () => EngineInfo[]; pricing: CloudInternals['pricing'] } {
  const t = cloudHelpers.makeCloud() as unknown as { cloud: CloudInternals }
  const pricing = t.cloud.pricing
  return { pricing, engines: () => engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, pricing.current()) }
}

const avatar = (): RecipeDocument => fromBase(avatarBase) as unknown as RecipeDocument

function service(o: { live: () => EngineInfo[] | null; now?: () => Date } = { live: () => null }) {
  const core = memoryCore()
  const ctx = core.context
  const s = new EstimatesService({ db: core.db, settings: ctx.settings, prices: ctx.prices, routes: ctx.routes, liveEngines: () => Promise.resolve(o.live()), ...(o.now ? { now: o.now } : {}) })
  return { core, ctx, s }
}

const analysis = (cuts: number): AnalysisResult => ({
  summary: '',
  hook: { text: '', endsAtS: 10, technique: '' },
  structure: [{ fromS: 0, toS: 720, kind: 'body', summary: '' }],
  pacing: { cutsPerMinute: cuts, tempo: 'medium', notes: '' },
  shotTypes: ['talking presenter', 'AI generated image', 'stock footage'],
  onScreenText: [],
  music: { present: true, mood: '', notes: '' },
  callsToAction: [{ atS: 80, text: 'Code promo dans la description' }]
})

describe('estimates.pipeline', () => {
  it('prices the base pipeline with the Cloud engines, in credits, per brick, with the Δ of each option', async () => {
    const cloud = cloudEngines()
    const { s } = service({ live: cloud.engines })
    const v = await s.pipeline(avatar())
    expect(v.available).toBe(true)
    expect(v.prices?.source).toBe('live')
    expect(v.minutes).toBe(12)
    expect(v.perMinute.min).toBeGreaterThan(0)
    expect(v.perMinute.min).toBeLessThanOrEqual(v.perMinute.avg)
    expect(v.perMinute.avg).toBeLessThanOrEqual(v.perMinute.max)
    // no music line: avatar@1 has none by default (avatar-qualite)
    expect(v.lines.map((l) => l.id)).toEqual(['presenter', 'clips', 'images', 'voice', 'thumbnails', 'llm'])
    expect(v.lines.flatMap((l) => l.unpriced)).toEqual([])
    // Claude Code is the default backend: the writing is free, its price on credits is the saving
    expect(v.llm).toMatchObject({ backend: 'subscription', included: false })
    expect(v.llm.onCreditsPerVideo).toBeGreaterThan(0)
    expect(v.optionDeltas['quality.presenter']?.standard).toBeGreaterThan(0)
    expect(v.fit).toEqual({ state: 'no-channel' })
  })

  it('a new price grid on the Cloud moves the estimate', async () => {
    const cloud = cloudEngines()
    let at = Date.parse('2026-11-01T10:00:00Z')
    const { s } = service({ live: cloud.engines, now: () => new Date(at) })
    const before = await s.pipeline(avatar())
    const g = cloud.pricing.current()
    cloud.pricing.publish({ creditValueEur: g.creditValueEur, usdToEur: g.usdToEur * 1.1, overheadPct: g.overheadPct, items: g.items, note: 'dollar up' }, 'test')
    at += 10 * 60_000 // the app reads the engines again after a few minutes
    const after = await s.pipeline(avatar())
    expect(after.perMinute.avg / before.perMinute.avg).toBeCloseTo(1.1, 2)
  })

  it('offline: the prices kept from the last time, else « prix inconnus »', async () => {
    const cloud = cloudEngines()
    let online = true
    const { s, ctx } = service({ live: () => (online ? cloud.engines() : null) })
    await s.pipeline(avatar())
    expect(ctx.settings.get(ENGINES_CACHE_KEY)).not.toBeNull()
    online = false
    const fresh = new EstimatesService({ db: ctx.db, settings: ctx.settings, prices: ctx.prices, routes: ctx.routes, liveEngines: () => Promise.resolve(null) })
    const v = await fresh.pipeline(avatar())
    expect(v.available).toBe(true)
    expect(v.prices?.source).toBe('cache')
    const never = service()
    expect(await never.s.pipeline(avatar())).toMatchObject({ available: false, reason: 'Prix inconnus : connecte Atelier Cloud une fois pour lire la grille de prix.' })
  })

  it('on the API key the writing is priced on the key, not in credits', async () => {
    const cloud = cloudEngines()
    const { s, ctx } = service({ live: cloud.engines })
    ctx.routes.setDefaultProvider('anthropic')
    const v = await s.pipeline(avatar())
    expect(v.llm).toMatchObject({ backend: 'api-key', included: false })
    expect(v.llm.apiKeyEurPerVideo).toBeGreaterThan(0.3)
    expect(v.llm.apiKeyEurPerVideo).toBeLessThan(1)
  })

  it('fit to a channel: three analysed videos needed, then a percent with its gaps', async () => {
    const cloud = cloudEngines()
    const { s, core } = service({ live: cloud.engines })
    const channelId = Number(core.db.prepare("INSERT INTO channels (name) VALUES ('Astuces')").run().lastInsertRowid)
    const eyes = new EyesStore(core.db)
    const save = (n: number): void =>
      eyes.saveAnalysis({ channelId, sourceKey: 0, videoId: `v${n}`, url: `https://youtu.be/v${n}`, title: `Vidéo ${n}`, durationS: 720, outlier: false, analysis: analysis(14 + n), demo: false, analysedAt: `2026-10-0${n}T10:00:00Z` })
    save(1)
    save(2)
    expect((await s.pipeline(avatar(), channelId)).fit).toEqual({ state: 'not-enough-videos', channelId, videos: 2 })
    save(3)
    const v = await s.pipeline(avatar(), channelId)
    if (v.fit.state !== 'ok') throw new Error(v.fit.state)
    expect(v.fit.percent).toBeGreaterThan(0)
    expect(v.fit.percent).toBeLessThanOrEqual(100)
    expect(v.fit.demo).toBe(false)
    // the eyes do not read the look nor the words yet: left out, not counted as a miss
    expect(v.fit.dimensions.find((d) => d.id === 'look')?.score).toBeNull()
    const cards = await s.cards(channelId)
    expect(cards.bases['avatar@1']?.fit).toBe(v.fit.percent)
    expect(cards.bases['avatar@1']?.perMinute.avg).toBeCloseTo(v.perMinute.avg, 9)
  })
})

describe('one source of numbers', () => {
  it('the run quote prices its units with the engines the estimate read', async () => {
    const cloud = cloudEngines()
    const { s, ctx } = service({ live: cloud.engines })
    await s.pipeline(avatar())
    const prices = cachedUnitPrices(ctx.settings.get(ENGINES_CACHE_KEY))
    const presenter = cloud.engines().find((e) => e.id === DEFAULT_ENGINES.presenter.engine)
    expect(prices?.avatar_s).toBe(presenter?.priceCredits)
    expect(creditsForUnits([{ unit: 'avatar_s', qty: 100 }], undefined, prices)).toBe(Math.ceil(100 * (presenter?.priceCredits ?? 0)))
    // without prices read, the placeholder grid as before
    expect(cachedUnitPrices(null)).toBeNull()
  })

  it('engines.list keeps the list it read for the estimates', async () => {
    const rig = await startCloud(1000)
    const app = appCore()
    await connect(app, rig)
    await app.core.api['engines.list']()
    expect(app.core.context.settings.get(ENGINES_CACHE_KEY)).toMatchObject({ engines: expect.any(Array) })
    const v = await app.core.api['estimates.pipeline'](avatar())
    expect(v.available).toBe(true)
  })

  it('the IPC contract lists both methods', () => {
    expect(ESTIMATES_METHODS).toEqual(['estimates.pipeline', 'estimates.cards'])
  })
})
