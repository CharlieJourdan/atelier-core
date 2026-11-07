// A budget as a setting of the mix (avatar-layouts, 2026-11-02): the curve of presenter / clip / still shares is made from what the
// video may cost, for its real length, from the end backwards; the director's forecast (the quote) and its run use the same rows.
import { describe, expect, it } from 'vitest'
import type { EditPlan } from '../../src/engine/formats/editplan'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { partsFor, planBudget, proposeBudgets, resolveBudget } from '../../src/engine/nodes/director-budget'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import { estimateShares } from '../../src/engine/technologies/cost-defaults'
import { BudgetSchema, curveRows, type CurveRow, type Mix } from '../../src/engine/technologies/mix'
import { avatarBase, technologyRegistry } from '../../src/engine/technologies'
import { proposeForStyle } from '../../src/engine/technologies/style-propose'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { art, makeCtx } from './engine-node-helpers'
import { makeFrenchFilm } from './film-fixture-fr12'

/** Marcel's measured curve (reference 2: hook 36 %, promise 18 %, after the card 32 %, then 24 %) and the pipeline's rules. */
const ROWS: CurveRow[] = [
  { fromS: 0, shares: { presenter: 0.36, clipAi: 0.64, imageAi: 0 } },
  { fromS: 51, shares: { presenter: 0.18, clipAi: 0.6833, imageAi: 0.1367 } },
  { fromS: 92, shares: { presenter: 0.32, clipAi: 0.5667, imageAi: 0.1133 } },
  { fromS: 150, shares: { presenter: 0.24, clipAi: 0.3547, imageAi: 0.4053 } },
  { fromS: 300, shares: { presenter: 0.24, clipAi: 0.1438, imageAi: 0.6162 } },
  { fromS: 600, shares: { presenter: 0.22, clipAi: 0.0308, imageAi: 0.7492 } }
]
const mix = { presenter: 0.2482, clipAi: 0.27, imageAi: 0.4818, curve: ROWS }
const params = (m: Record<string, unknown> = mix): DirectorParams =>
  directorPlan.params.parse({
    avatar: { segments: ['hook', 'outro'], layout: 'full' },
    clipShotsPerGeneration: 2,
    clipPairShare: 0.5,
    clipMotionOnly: true,
    clipShortEngine: true,
    screen: { mix: m, layouts: ['full', 'split', 'pip'] }
  }) as DirectorParams
const USD_PER_CREDIT = 0.0109

describe('the cost model', () => {
  it('lands within 8 % of the beta Cloud’s real quote of Marcel’s full script (878 credits for 16.6 minutes, 2026-11-02)', () => {
    // the quote ran on the curve as `curveRows` hands it to the director (rescaled to the mix's totals over 16.6 minutes)
    const rows = curveRows({ ...mix, curve: ROWS } as never, 16.6 * 60)
    const plan = planBudget(rows, 16.6 * 60, params(), { maxCredits: 999_999 })
    expect(Math.abs(plan.total - 878) / 878).toBeLessThan(0.08)
    // by engine: presenter 359, clips 367, pictures 140
    expect(Math.abs(plan.byKind.presenter - 359) / 359).toBeLessThan(0.05)
    expect(Math.abs(plan.byKind.clips - 367) / 367).toBeLessThan(0.2)
    expect(Math.abs(plan.byKind.stills - 140) / 140).toBeLessThan(0.1)
  })

  it('cuts the video in a hook, a setup, the body in thirds and an outro, whatever its length', () => {
    expect(partsFor(744).map((p) => p.part)).toEqual(['hook', 'setup', 'body', 'body', 'body', 'outro'])
    expect(partsFor(7200).at(-1)).toMatchObject({ part: 'outro', fromS: 7155, toS: 7200 })
    expect(partsFor(180).map((p) => p.part)).toEqual(['hook', 'setup', 'outro'])
  })
})

describe('the plan within a budget', () => {
  const D = 744
  const measured = planBudget(ROWS, D, params(), { maxCredits: 999_999 })

  it('keeps the measured curve when it fits', () => {
    expect(measured.steps).toEqual([])
    expect(measured.reachable).toBe(true)
    expect(measured.partRows[0]?.shares.presenter).toBeCloseTo(0.36, 2)
  })

  it('meets a lower target, gives the clips up first and from the end of the video, and leaves the hook alone', () => {
    const plan = planBudget(ROWS, D, params(), { maxCredits: measured.total * 0.88 })
    expect(plan.reachable).toBe(true)
    expect(plan.total).toBeLessThanOrEqual(measured.total * 0.88 + 1e-6)
    expect(plan.partRows[0]?.shares).toEqual(measured.partRows[0]?.shares)
    const last = plan.partRows.at(-1) as (typeof plan.partRows)[number]
    expect(last.shares.clipAi).toBe(0)
    // the end gave before the start of the body did
    const body = plan.partRows.filter((p) => p.part === 'body')
    expect(body[0]?.shares.clipAi).toBeGreaterThan(body.at(-1)?.shares.clipAi as number)
    // every part's shares still add to one
    for (const p of plan.partRows) expect(p.shares.presenter + p.shares.clipAi + p.shares.imageAi).toBeCloseTo(1, 3)
  })

  it('takes the presenter next, never under its floor, and says when the budget cannot be met', () => {
    const tight = planBudget(ROWS, D, params(), { maxCreditsPerMinute: 1, floors: { presenter: 0.1 } })
    expect(tight.reachable).toBe(false)
    expect(tight.floor).toBeGreaterThan(tight.target)
    for (const p of tight.partRows) expect(p.shares.presenter).toBeGreaterThanOrEqual(0.1 - 1e-9)
  })

  it('a longer video under a fixed budget is mostly stills (2 hours under 20 $)', () => {
    const credits = 20 / USD_PER_CREDIT
    const plan = planBudget(ROWS, 7200, params(), { maxCredits: credits })
    expect(plan.reachable).toBe(true)
    expect(plan.total).toBeLessThanOrEqual(credits + 1e-6)
    const body = plan.partRows.filter((p) => p.part === 'body')
    expect(body.every((p) => p.shares.imageAi > 0.9)).toBe(true)
  })

  it('proposes the measured curve, then the variants with what each changes per part', () => {
    const [m, balanced, lean] = proposeBudgets(ROWS, D, params(), { maxCreditsPerMinute: 0.5 / USD_PER_CREDIT })
    expect([m?.id, balanced?.id, lean?.id]).toEqual(['measured', 'balanced', 'lean'])
    expect(balanced?.plan.total).toBeLessThan(m?.plan.total as number)
    expect(balanced?.look.reduce((n, l) => n + l.credits, 0)).toBeLessThan(0)
    // balanced saves at the end and keeps the hook; lean spreads the savings, the hook gives too
    expect(balanced?.look[0]?.clipAi).toBe(0)
    expect(lean?.look[0]?.clipAi as number).toBeLessThan(0)
  })
})

describe('the budget in the mix', () => {
  it('is a setting of the mix: no unknown key', () => {
    expect(BudgetSchema.safeParse({ maxCreditsPerMinute: 50, saveFirst: 'end', protect: ['hook'] }).success).toBe(true)
    expect(BudgetSchema.safeParse({ maxCredits: 1800, wat: 1 }).success).toBe(false)
  })

  it('hands the director exactly the rows of the plan (the mix is their own average, nothing rescales them)', () => {
    const p = params({ ...mix, budget: { maxCreditsPerMinute: 45 } })
    const D = 1800
    const { screen: resolved, plan } = resolveBudget(p.screen as NonNullable<DirectorParams['screen']>, p, D)
    expect(plan).not.toBeNull()
    const rows = curveRows(resolved.mix, D)
    expect(rows[0]?.shares.presenter).toBeCloseTo(plan?.rows[0]?.shares.presenter as number, 2)
    expect(rows.at(-1)?.shares.clipAi ?? 0).toBeCloseTo((plan?.rows.at(-1)?.shares.clipAi as number) ?? 0, 2)
    expect(resolved.mix.budget).toBeUndefined()
  })

  it('the forecast (the quote) follows the budget: fewer clip seconds than the measured curve for the same video', () => {
    const open = params({ ...mix, budget: { maxCredits: 999_999 } })
    const capped = params({ ...mix, budget: { maxCreditsPerMinute: 30 } })
    const ctx = { minutes: 30 }
    type Forecast = (c: unknown, p: DirectorParams) => Record<string, Record<string, number>>
    const forecast = directorPlan.forecast as unknown as Forecast
    const a = forecast(ctx, open)
    const b = forecast(ctx, capped)
    expect(b.genlist?.videoSeconds ?? 0).toBeLessThan(a.genlist?.videoSeconds as number)
  })

  it('the pipeline estimate sees the budget too (fewer clips for a longer video under the same price a minute)', () => {
    const open = estimateShares({ ...mix, curve: ROWS } as Mix, true, 30).shares
    const capped = estimateShares({ ...mix, curve: ROWS, budget: { maxCreditsPerMinute: 30 } } as Mix, true, 30).shares
    expect(capped.clipAi ?? 0).toBeLessThan(open.clipAi as number)
    expect(capped.imageAi ?? 0).toBeGreaterThan(open.imageAi as number)
  })

  it('the director’s run reports the budget it made and the parts it was given', async () => {
    const film = makeFrenchFilm(720)
    const p = directorPlan.params.parse({
      avatar: { segments: ['hook', 'outro'], layout: 'full' },
      screen: { mix: { ...mix, budget: { maxCreditsPerMinute: 35 } }, layouts: ['full', 'split', 'pip'] }
    })
    const out = await directorPlan.fake(
      makeCtx({}),
      {
        beats: art('json.beats', { value: film.beats as never }),
        words: art('json.words', { value: film.words as never, meta: { durationS: film.durationS, alignment: 'provider', matched: 1, language: 'fr' } }),
        outline: art('json.outline', { value: film.outline as never })
      },
      p as never
    )
    const diag = (out.plan?.value as unknown as EditPlan).diagnostics
    expect(diag.some((d) => d.startsWith('budget: '))).toBe(true)
    expect(diag.some((d) => d.startsWith('shares 0:00'))).toBe(true)
  })
})

describe('the creation flow proposes within a budget', () => {
  const reg = technologyRegistry()
  const refs: VideoMeasure[] = [
    { minutes: 30, presenterShare: 0.3, layouts: ['full', 'split'], kinds: { clipAi: 0.3, imageAi: 0.7 }, shotS: 4, wordsPerMinute: 180, captions: false, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' }
  ]
  const book = {
    creditEur: 0.01,
    engines: {
      'presenter:heygen-mcp': { unit: 'second', perUnit: 1.29 },
      'image:gpt-image-25-low': { unit: 'image', perUnit: 0.57 },
      'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 9, maxSecondsPerCall: 8 },
      'voice:ai33': { unit: 'kchars', perUnit: 10 },
      'music:library': { unit: 'minute', perUnit: 0 }
    },
    llm: null
  }
  const cost = { book, backend: 'subscription' as const }

  it('every variant carries the owner’s budget as a setting of its mix, and the cheaper curve is what is priced', () => {
    const open = proposeForStyle({ refs, ctx: { language: 'fr' }, cost: cost as never }, reg)
    const budget = { maxCreditsPerMinute: 25, saveFirst: 'end' as const }
    const capped = proposeForStyle({ refs, ctx: { language: 'fr' }, cost: cost as never, budget }, reg)
    expect(avatarBase.id).toBe('avatar@1')
    for (const v of capped.variants) expect(v.doc.mix?.budget).toEqual(budget)
    const faithful = (p: typeof open): number => p.variants.find((v) => v.kind === 'faithful')?.estimate?.perMinute.avg ?? 0
    expect(faithful(capped)).toBeGreaterThan(0)
    expect(faithful(capped)).toBeLessThanOrEqual(faithful(open) + 1e-6)
  })
})
