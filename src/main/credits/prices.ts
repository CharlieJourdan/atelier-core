// Local price grid (lot Z1): turns a node's estimate units into credits for the quote shown before a video is made.
// It mirrors Atelier Cloud's price grid version 1 (cloud/src/db/migrations/002_default_prices.ts, PLAN-V2-PRODUCTION
// §4.4: credits = ceil(provider cost × (1 + overhead) × (1 + margin) ÷ value of a credit), at least 1 per line). Every
// figure is a placeholder. Lot P5 replaces this with the Cloud's own quote (`Quoter`, GET quote) once the app is
// connected; nothing here imports `cloud/` (the Cloud is never in the app bundle).
import type { EstimateUnit } from '../../engine/types'

export interface LocalPriceItem {
  unit: EstimateUnit
  /** What the provider bills us for one unit, in dollars (placeholder). */
  providerCostUsd: number
  marginPct: number
}

export const LOCAL_PRICE_GRID = {
  version: 1,
  /** 1 credit = 0,01 € (§4.4). */
  creditValueEur: 0.01,
  usdToEur: 0.92,
  overheadPct: 5,
  items: [
    { unit: 'chars', providerCostUsd: 0.00018, marginPct: 10 }, // platform voice, per character
    { unit: 'images', providerCostUsd: 0.02, marginPct: 25 }, // generated or stock picture
    { unit: 'video_s', providerCostUsd: 0.05, marginPct: 25 }, // generated video, per second
    { unit: 'avatar_s', providerCostUsd: 0.02, marginPct: 25 }, // talking avatar, per second (grid v1 placeholder, like the Cloud's)
    { unit: 'gpu_s', providerCostUsd: 0.00031, marginPct: 25 }, // RunPod GPU, per second
    { unit: 'searches', providerCostUsd: 0.002, marginPct: 50 }, // stock search: our glue only (Pexels / Wikimedia bill nothing), cloud/src/pricing.ts LATE_ITEMS
    { unit: 'watch_min', providerCostUsd: 0.01, marginPct: 5 } // the eyes: one minute of a support video watched (grid item analysis.minutes)
  ] as readonly LocalPriceItem[]
} as const

/**
 * Credits per unit read from Atelier Cloud's engines (production-11, the estimator's price book): when given, a unit it
 * prices wins over the placeholder grid, so the quote of a run and the pipeline's estimate use the same numbers.
 */
export type UnitPrices = Partial<Record<EstimateUnit, number>> & {
  /** The same per engine id the Cloud lists (solidite): a brick that names its engine is quoted on that engine's price,
   *  not its family's default (the run was captured at the named engine and passed its quote). */
  byEngine?: Readonly<Record<string, Partial<Record<EstimateUnit, number>>>>
  /** Engines the Cloud publishes `health: 'down'` (a key or access refused on a real call; solidite). */
  down?: readonly string[]
}

/** Credits for one unit (not rounded). Claude Code calls and tokens are free (R9.1): 0. */
export function creditsPerUnit(unit: EstimateUnit, prices?: UnitPrices | null): number {
  const known = prices?.[unit]
  if (known !== undefined) return known
  const item = LOCAL_PRICE_GRID.items.find((i) => i.unit === unit)
  if (!item) return 0
  const g = LOCAL_PRICE_GRID
  return (item.providerCostUsd * g.usdToEur * (1 + g.overheadPct / 100) * (1 + item.marginPct / 100)) / g.creditValueEur
}

/**
 * Integer credits for a list of units (an estimate or a reported cost): each priced line is rounded up, with a minimum
 * of 1 credit for a non-zero line. `provider: 'claude'` is always free (the user's own Claude Code).
 */
export function creditsForUnits(units: readonly { unit: EstimateUnit; qty: number }[], provider?: string, prices?: UnitPrices | null): number {
  if (provider === 'claude') return 0
  let total = 0
  for (const u of units) {
    const per = creditsPerUnit(u.unit, prices)
    if (per === 0 || !Number.isFinite(u.qty) || u.qty <= 0) continue
    total += Math.max(1, Math.ceil(u.qty * per))
  }
  return total
}

/** Euros of a number of credits (display only). */
export function creditsToEur(credits: number): number {
  return Math.round(credits * LOCAL_PRICE_GRID.creditValueEur * 100) / 100
}
