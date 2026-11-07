// A budget as a setting of the pipeline's mix (avatar-layouts, 2026-11-02): « 30-minute videos, far more stills towards the end »
// or « a 2-hour video under 20 $ ». `mix.budget` says what the video may cost (credits in all, or a minute) and where the savings
// go first; at the director's run, and in its forecast (so the quote agrees), the curve of presenter / clip / still shares over
// the video's parts (hook, setup, body, outro) is made from it: the measured curve as far as the budget allows, then the lever
// that costs the least look, from the end of the video backwards. Never a rule of the engine: the base curve, the order of the
// parts, the floors and the prices are all data of the pipeline, and the owner (or the agent) changes them per part.
//
// Pure: the cost of a curve is the director's own forecast (`forecastGenlist`) of each part, priced per unit.
import { averageShares, curveRows, type Budget, type Curve, type CurveRow, type Mix, type Shares } from '../technologies/mix'
import type { DirectorParams } from './director-cuts'
import { forecastGenlist } from './director-forecast'
import { ScreenParams } from './director-screen'

/**
 * Credits per unit, calibrated on the beta Cloud's real quote of Marcel's full script (2026-11-02, 878 credits for 16.6 minutes
 * quoted: presenter 359 for 278 generated seconds, clips 367 for 187 video seconds, pictures 140 for 245, voice 10, thumbnails 2).
 * Only a guide for the curve: the quote of the run, with the Cloud's live prices, is what is paid.
 */
export const BUDGET_PRICES = { presenterPerS: 1.291, clipPerS: 1.963, stillEach: 0.571, voicePerMin: 0.6, fixed: 2 } as const
export type BudgetPrices = { -readonly [K in keyof typeof BUDGET_PRICES]: number }

/** The parts a video is cut into, and who is protected from the savings. */
export const BUDGET_PARTS = ['hook', 'setup', 'body', 'outro'] as const
export type BudgetPart = (typeof BUDGET_PARTS)[number]
export type { Budget }

export interface PartRow {
  part: BudgetPart
  fromS: number
  toS: number
  shares: { presenter: number; clipAi: number; imageAi: number }
}

export interface PartCost extends PartRow {
  credits: number
  presenterCredits: number
  clipCredits: number
  stillCredits: number
}

export interface BudgetQuote {
  parts: PartCost[]
  voice: number
  fixed: number
  total: number
  perMinute: number
  /** Credits by kind over the whole video. */
  byKind: { presenter: number; clips: number; stills: number; voice: number; fixed: number }
}

export interface BudgetPlan extends BudgetQuote {
  rows: CurveRow[]
  /** The curve as parts (the body split in thirds so the savings can sit at its end). */
  partRows: PartRow[]
  base: BudgetQuote
  /** What the plan had to give up, in order: « clips → stills in the outro (to 0 %) ». */
  steps: string[]
  reachable: boolean
  /** The target in credits. */
  target: number
  /** The cheapest the curve can go within its floors (the plan itself when reachable). */
  floor: number
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000
const STEP = 0.02
const SPLIT_BODY = 3

/** The parts of a video of `D` seconds: hook, setup, body (in thirds when long enough), outro; empty parts are left out. */
export function partsFor(D: number, b: Budget = {}): { part: BudgetPart; fromS: number; toS: number }[] {
  const outroS = Math.min(b.outroS ?? 45, D / 4)
  const hookS = Math.min(b.hookS ?? 51, D / 3)
  const setupS = Math.max(hookS, Math.min(b.setupS ?? 150, D - outroS))
  const bodyFrom = setupS
  const bodyTo = Math.max(bodyFrom, D - outroS)
  const out: { part: BudgetPart; fromS: number; toS: number }[] = [{ part: 'hook', fromS: 0, toS: hookS }]
  if (setupS > hookS) out.push({ part: 'setup', fromS: hookS, toS: setupS })
  if (bodyTo > bodyFrom) {
    const n = bodyTo - bodyFrom > 240 ? SPLIT_BODY : 1
    for (let i = 0; i < n; i++) out.push({ part: 'body', fromS: bodyFrom + ((bodyTo - bodyFrom) * i) / n, toS: bodyFrom + ((bodyTo - bodyFrom) * (i + 1)) / n })
  }
  out.push({ part: 'outro', fromS: bodyTo, toS: D })
  return out.filter((p) => p.toS - p.fromS > 1e-6)
}

/** The shares of the curve at the middle of each part: the base curve's own rows, cut at the parts. */
function partRowsOf(rows: readonly CurveRow[], parts: ReturnType<typeof partsFor>): PartRow[] {
  const at = (t: number): Shares => ([...rows].reverse().find((r) => r.fromS <= t) ?? (rows[0] as CurveRow)).shares
  return parts.map((p) => {
    // the time-weighted shares over the part (a part can straddle two rows)
    const acc = { presenter: 0, clipAi: 0, imageAi: 0, other: 0 }
    const cuts = [p.fromS, ...rows.map((r) => r.fromS).filter((t) => t > p.fromS && t < p.toS), p.toS]
    for (let i = 0; i + 1 < cuts.length; i++) {
      const w = ((cuts[i + 1] as number) - (cuts[i] as number)) / (p.toS - p.fromS)
      const s = at(cuts[i] as number)
      acc.presenter += (s.presenter ?? 0) * w
      acc.clipAi += (s.clipAi ?? 0) * w
      acc.imageAi += ((s.imageAi ?? 0) + (s.stock ?? 0) + (s.archive ?? 0) + (s.motion ?? 0) + (s.userFootage ?? 0)) * w
    }
    return { ...p, shares: { presenter: r4(acc.presenter), clipAi: r4(acc.clipAi), imageAi: r4(1 - acc.presenter - acc.clipAi) } }
  })
}

/** The credits of each part and of the video: the director's forecast of the part on a flat mix, at the unit prices. */
export function costOfParts(partRows: readonly PartRow[], D: number, p: DirectorParams, prices: BudgetPrices): BudgetQuote {
  const parts: PartCost[] = partRows.map((r) => {
    const mix: Mix = { presenter: r.shares.presenter, clipAi: r.shares.clipAi, imageAi: r.shares.imageAi, curve: 'flat' }
    const flat = { ...p, screen: { ...(p.screen as NonNullable<DirectorParams['screen']>), mix } } as DirectorParams
    const m = forecastGenlist((r.toS - r.fromS) / 60, flat, D / 60) as Record<string, number> | null
    const presenterCredits = (m?.avatarSeconds ?? 0) * prices.presenterPerS
    const clipCredits = (m?.videoSeconds ?? 0) * prices.clipPerS
    const stills = Math.max(0, (m?.items ?? 0) - (m?.avatarItems ?? 0) - (m?.sharedItems ?? 0) - (m?.stock ?? 0))
    const stillCredits = stills * prices.stillEach
    return { ...r, presenterCredits, clipCredits, stillCredits, credits: presenterCredits + clipCredits + stillCredits }
  })
  const voice = (D / 60) * prices.voicePerMin
  const sum = (k: 'presenterCredits' | 'clipCredits' | 'stillCredits'): number => parts.reduce((n, x) => n + x[k], 0)
  const total = parts.reduce((n, x) => n + x.credits, 0) + voice + prices.fixed
  return {
    parts,
    voice,
    fixed: prices.fixed,
    total,
    perMinute: total / (D / 60),
    byKind: { presenter: sum('presenterCredits'), clips: sum('clipCredits'), stills: sum('stillCredits'), voice, fixed: prices.fixed }
  }
}

/** The order the parts are asked to give: by `saveFirst`, from the end of the video backwards. */
function givingOrder(parts: readonly PartRow[], b: Budget): number[] {
  const idx = parts.map((_, i) => i)
  const protectedPart = (i: number): boolean => (b.protect ?? ['hook']).includes((parts[i] as PartRow).part)
  const rank = (i: number): number => {
    const part = (parts[i] as PartRow).part
    if (b.saveFirst === 'even') return 0
    if (b.saveFirst === 'body') return part === 'body' ? -1000 + -i : part === 'outro' ? -500 : part === 'setup' ? 100 : 200
    // end: the last part first, then the body from its end, then the setup, then the hook
    return -i
  }
  const order = idx.filter((i) => !protectedPart(i)).sort((x, y) => rank(x) - rank(y))
  return [...order, ...idx.filter(protectedPart).sort((x, y) => rank(x) - rank(y))]
}

/** Makes the curve fit the budget (pure): the cheapest levers first, from the end of the video backwards. */
export function planBudget(baseRows: readonly CurveRow[], D: number, p: DirectorParams, budget: Budget): BudgetPlan {
  const prices: BudgetPrices = { ...BUDGET_PRICES, ...(budget.prices ?? {}) }
  const target = budget.maxCredits ?? (budget.maxCreditsPerMinute !== undefined ? budget.maxCreditsPerMinute * (D / 60) : Infinity)
  const parts = partRowsOf(baseRows, partsFor(D, budget))
  const base = costOfParts(parts, D, p, prices)
  const presenterFloor = budget.floors?.presenter ?? 0.05
  const clipFloor = budget.floors?.clipAi ?? 0
  const steps: string[] = []
  const order = givingOrder(parts, budget)
  const work: PartRow[] = parts.map((x) => ({ ...x, shares: { ...x.shares } }))
  let cost = base
  const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  const give = (kind: 'clipAi' | 'presenter', floor: (i: number) => number): void => {
    const gave = new Map<number, number>()
    const take = (i: number): boolean => {
      const w = work[i] as PartRow
      const d = Math.min(STEP, w.shares[kind] - floor(i))
      if (d <= 1e-9) return false
      w.shares[kind] = r4(w.shares[kind] - d)
      w.shares.imageAi = r4(w.shares.imageAi + d)
      gave.set(i, (gave.get(i) ?? 0) + d)
      cost = costOfParts(work, D, p, prices)
      return true
    }
    if (budget.saveFirst === 'even') {
      // every part gives a step in turn, so the savings are spread
      for (let moved = true; moved && cost.total > target + 1e-9; ) {
        moved = false
        for (const i of order) if (cost.total > target + 1e-9 && take(i)) moved = true
      }
    } else {
      // one part after the other, the first of the order down to its floor before the next
      for (const i of order) {
        while (cost.total > target + 1e-9 && take(i));
        if (cost.total <= target + 1e-9) break
      }
    }
    for (const [i, d] of gave) {
      const w = work[i] as PartRow
      steps.push(`${kind === 'clipAi' ? 'clips' : 'presenter'} → stills, ${w.part} ${fmt(w.fromS)}–${fmt(w.toS)} (−${Math.round(d * 100)} points, now ${Math.round(w.shares[kind] * 100)} %)`)
    }
  }
  // 1. the clips are the dearest second on screen (≈ 2.0 credits against the presenter's 1.4 and a still's 0.17): they go first
  if (cost.total > target) give('clipAi', (i) => ((budget.protect ?? ['hook']).includes((work[i] as PartRow).part) ? (parts[i] as PartRow).shares.clipAi : clipFloor))
  // 2. then the presenter's time in the parts that are not protected, never under its floor
  if (cost.total > target) give('presenter', (i) => ((budget.protect ?? ['hook']).includes((work[i] as PartRow).part) ? (parts[i] as PartRow).shares.presenter : Math.min((parts[i] as PartRow).shares.presenter, presenterFloor)))
  // 3. the protected parts give last, the clips then the presenter, down to the floors
  if (cost.total > target) {
    give('clipAi', () => clipFloor)
    if (cost.total > target) give('presenter', (i) => Math.min((parts[i] as PartRow).shares.presenter, presenterFloor))
  }
  const floorPlan = work.map((x) => ({ ...x, shares: { ...x.shares } }))
  for (const w of floorPlan) {
    const hookLike = (budget.protect ?? ['hook']).includes(w.part)
    w.shares.imageAi = r4(w.shares.imageAi + w.shares.clipAi - (hookLike ? 0 : clipFloor) + Math.max(0, w.shares.presenter - presenterFloor))
    w.shares.presenter = Math.min(w.shares.presenter, presenterFloor)
    w.shares.clipAi = hookLike ? 0 : clipFloor
  }
  const reachable = cost.total <= target + 1e-6
  const rows: CurveRow[] = work.map((w) => ({ fromS: Math.round(w.fromS * 100) / 100, shares: { presenter: w.shares.presenter, clipAi: w.shares.clipAi, imageAi: w.shares.imageAi } }))
  return { ...cost, rows, partRows: work, base, steps, reachable, target, floor: costOfParts(floorPlan, D, p, prices).total }
}

/**
 * The screen a run uses when its mix has a budget: the mix's curve replaced by the budget's rows, and the mix's shares by their
 * own average over the same span, so `curveRows` hands the director exactly these rows (a mix that is not the average of its
 * curve is rescaled to it, which is what hid the measured curve in round 2). Without a budget: the screen as it is.
 */
export function resolveBudget(screen: NonNullable<DirectorParams['screen']>, p: DirectorParams, D: number): { screen: NonNullable<DirectorParams['screen']>; plan: BudgetPlan | null } {
  const budget = screen.mix.budget
  if (!budget) return { screen, plan: null }
  const { budget: _b, ...mixOnly } = screen.mix
  // a measured curve (explicit rows) is the base as it is: `curveRows` would rescale it to the mix's totals for this length
  const baseRows = Array.isArray(mixOnly.curve) ? (mixOnly.curve as unknown as CurveRow[]) : curveRows(mixOnly, D)
  const plan = planBudget(baseRows, D, { ...p, screen: { ...screen, mix: mixOnly } } as DirectorParams, budget)
  const fitS = Math.max(D, 720)
  const rows = plan.rows
  const avg = averageShares(rows, fitS)
  const curve = rows as unknown as Curve
  const mix: Mix = { ...mixOnly, presenter: avg.presenter ?? 0, clipAi: avg.clipAi ?? 0, imageAi: avg.imageAi ?? 0, curve }
  return { screen: { ...screen, mix }, plan }
}

/** What a proposal changes against the measured curve, per part, in points of screen time (look) and credits (price). */
export interface LookDelta {
  part: BudgetPart
  fromS: number
  toS: number
  presenter: number
  clipAi: number
  imageAi: number
  credits: number
}

export interface BudgetProposal {
  /** `measured` (the pipeline's curve as it is), `balanced` (savings from the end of the video), `lean` (nothing protected, savings spread). */
  id: 'measured' | 'balanced' | 'lean'
  plan: BudgetPlan
  /** Per part, against the measured curve. */
  look: LookDelta[]
  /** The mix and curve to write in the pipeline for this proposal: the `budget` itself, so it follows the video's length. */
  budget: Budget
}

/**
 * What the agent shows when the measured curve costs more than the budget: the measured curve (its price), then the cheapest
 * variants with what each changes per part and what it saves. The owner picks one and adjusts per part; nothing is applied here.
 */
export function proposeBudgets(baseRows: readonly CurveRow[], D: number, p: DirectorParams, budget: Budget): BudgetProposal[] {
  const measured = planBudget(baseRows, D, p, { ...budget, maxCredits: undefined, maxCreditsPerMinute: undefined })
  const out: BudgetProposal[] = [{ id: 'measured', plan: measured, look: lookOf(measured, measured), budget: { ...budget, maxCredits: undefined, maxCreditsPerMinute: undefined } }]
  const variants: [BudgetProposal['id'], Budget][] = [
    ['balanced', { ...budget, saveFirst: 'end', protect: budget.protect ?? ['hook'] }],
    ['lean', { ...budget, saveFirst: 'even', protect: [] }]
  ]
  for (const [id, b] of variants) {
    const plan = planBudget(baseRows, D, p, b)
    out.push({ id, plan, look: lookOf(plan, measured), budget: b })
  }
  return out
}

function lookOf(plan: BudgetPlan, measured: BudgetPlan): LookDelta[] {
  return plan.partRows.map((w, i) => {
    const m = measured.partRows[i] as PartRow
    return {
      part: w.part,
      fromS: w.fromS,
      toS: w.toS,
      presenter: r4(w.shares.presenter - m.shares.presenter),
      clipAi: r4(w.shares.clipAi - m.shares.clipAi),
      imageAi: r4(w.shares.imageAi - m.shares.imageAi),
      credits: Math.round(((plan.parts[i] as PartCost).credits - (measured.parts[i] as PartCost).credits) * 10) / 10
    }
  })
}

/**
 * The screen-time shares a budgeted mix gives over `minutes` (the pipeline estimate's view: `estimateShares`), with the estimator's
 * own defaults for the rules it cannot see (pairs, short engine). The quote of a run uses the pipeline's real rules instead.
 */
export function budgetShares(mix: Mix, hasPresenter: boolean, minutes: number): Shares | null {
  if (!mix.budget || !hasPresenter) return null
  const D = minutes * 60
  const params = {
    avatar: { segments: ['hook', 'outro'], layout: 'full' },
    clipShotsPerGeneration: 2,
    clipPairShare: 0.5,
    clipMotionOnly: true,
    clipShortEngine: true,
    screen: ScreenParams.parse({ mix, layouts: ['full', 'split', 'pip'] })
  } as unknown as DirectorParams
  const resolved = resolveBudget(params.screen as NonNullable<DirectorParams['screen']>, params, D)
  return resolved.plan ? averageShares(resolved.plan.rows, D) : null
}
