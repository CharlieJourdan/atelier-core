// The price book the estimator reads in the app (decision 0023, R8.3): the credits per unit Atelier Cloud publishes for each
// engine (`engines.list`, priced from its grid), kept in settings so the app can still estimate offline, and the model
// prices of the LLM line on « crédits Atelier » (the prices table of Settings, US $ per million tokens, turned into credits
// with the grid's money: dollar rate, overhead, our margin, value of a credit). Nothing here holds a price of its own.
import { DEFAULT_ENGINES, type EngineFamily, type EngineInfo } from '../../../shared/cloud-engines'
import type { JsonValue } from '../../../shared/api'
import { COST_DEFAULTS, type PriceBook } from '../../../engine/technologies/cost'
import { LOCAL_PRICE_GRID, type UnitPrices } from '../../credits/prices'

/** Settings key of the last engines list the Cloud answered. */
export const ENGINES_CACHE_KEY = 'engines.cache'

/** Our margin on the LLM work billed in credits (the Cloud's margin for an engine without a grid line, decision 0015). */
const LLM_MARGIN_PCT = 25

export interface EnginesCache {
  at: string
  engines: EngineInfo[]
}

/** Credits for one dollar of provider cost (the grid's money: 1 credit = 0,01 €, decision 0015). */
export function creditsPerUsd(marginPct: number = LLM_MARGIN_PCT): number {
  const g = LOCAL_PRICE_GRID
  return (g.usdToEur * (1 + g.overheadPct / 100) * (1 + marginPct / 100)) / g.creditValueEur
}

/** Value of one credit in euros (display only). */
export const CREDIT_EUR = LOCAL_PRICE_GRID.creditValueEur

/** The book in credits from the Cloud's engines and the model prices (US $ per million tokens by model id). */
export function creditsBook(engines: readonly EngineInfo[], models: readonly { model: string; inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number }[]): PriceBook {
  return {
    currency: 'credits',
    engines: Object.fromEntries(engines.map((e) => [e.id, { unit: e.unit, perUnit: e.priceCredits, maxSecondsPerCall: e.limits.maxSecondsPerCall, planMonthlyUsd: e.planMonthlyUsd ?? null }])),
    llm: {
      models: Object.fromEntries(models.map((m) => [m.model, { inputPerMTok: m.inputPerMTok, outputPerMTok: m.outputPerMTok, cacheReadPerMTok: m.cacheReadPerMTok }])),
      perUsd: creditsPerUsd()
    }
  }
}

/** Reads the cached list back (null when absent or not a list of engines). */
export function readEnginesCache(value: JsonValue | null): EnginesCache | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as { at?: unknown; engines?: unknown }
  if (typeof v.at !== 'string' || !Array.isArray(v.engines)) return null
  return { at: v.at, engines: v.engines as EngineInfo[] }
}

/**
 * The credits per unit of a run's node estimates (characters, images, seconds of video or presenter) from the same book,
 * on each family's default engine: the quote of a run and the estimate of its pipeline read the same prices (0015).
 */
export function nodeUnitPrices(book: PriceBook): UnitPrices {
  const out: UnitPrices = {}
  for (const family of ['voice', 'image', 'presenter', 'clip'] as const) Object.assign(out, unitPricesOf(family, book.engines[DEFAULT_ENGINES[family].engine]))
  const byEngine: Record<string, Omit<UnitPrices, 'byEngine'>> = {}
  for (const [id, entry] of Object.entries(book.engines)) {
    const family = id.split(':')[0] as EngineFamily
    const p = unitPricesOf(family, entry)
    if (Object.keys(p).length > 0) byEngine[id] = p
  }
  return { ...out, byEngine }
}

/** The estimate unit one engine's price stands for (characters, images, presenter or video seconds). */
function unitPricesOf(family: EngineFamily, e: PriceBook['engines'][string] | undefined): Omit<UnitPrices, 'byEngine'> {
  if (!e) return {}
  if (family === 'voice' && e.unit === 'kchars') return { chars: e.perUnit / 1000 }
  if (family === 'image' && e.unit === 'image') return { images: e.perUnit }
  if (family === 'presenter' && e.unit === 'second') return { avatar_s: e.perUnit }
  if (family === 'clip' && e.unit === 'second') return { video_s: e.perUnit }
  // a clip billed per call: one call per clip shot (avatar §2.7)
  if (family === 'clip' && (e.unit === 'clip' || e.unit === 'call')) return { video_s: e.perUnit / COST_DEFAULTS.shotLengthS.clipAi }
  return {}
}

/**
 * The node prices from the Cloud's engines read now (null: signed out, offline, nothing listed): the quote of a run asked
 * before any estimate kept the engines prices from the same list instead of the placeholder grid. Nothing is kept.
 */
export async function livePrices(liveEngines: () => Promise<EngineInfo[] | null>): Promise<UnitPrices | null> {
  const live = await liveEngines().catch(() => null)
  return live && live.length > 0 ? withDown(nodeUnitPrices(creditsBook(live, [])), live) : null
}

/** The node prices from the engines kept in settings, or null when none were ever read. */
export function cachedUnitPrices(value: JsonValue | null): UnitPrices | null {
  const cache = readEnginesCache(value)
  return cache ? withDown(nodeUnitPrices(creditsBook(cache.engines, [])), cache.engines) : null
}

/** The engines whose key or access the Cloud says is refused now, kept with the prices a quote reads. */
function withDown(prices: UnitPrices, engines: readonly EngineInfo[]): UnitPrices {
  const down = engines.filter((e) => e.health === 'down').map((e) => e.id)
  return down.length > 0 ? { ...prices, down } : prices
}
