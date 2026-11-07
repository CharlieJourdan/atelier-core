// Prices and quotes (§4.4). One price grid is current (the highest version); every grid is kept, so a quote names the
// version it was priced with. The formula, per line:
//   real cost (€)  = quantity × provider cost ($/unit) × usd→eur × (1 + overhead)
//   percent item   : credits = ceil(real cost × (1 + margin) ÷ credit value)
//   fixed item     : credits = ceil(quantity × credits per unit)
//   then, if a reference price exists: never above it, credits ≤ floor(quantity × reference (€/unit) ÷ credit value)
//   and at least 1 credit, EXCEPT a line whose provider cost is 0 (a free source), which is 0 credit (decision 0105).
// Which rule wins: "never above the reference price" beats the 1-credit minimum, EXCEPT when the reference itself is
// under 1 credit (quantity × reference ÷ credit value < 1): then the line costs the minimum, 1 credit, and
// `aboveReference` is true so the caller can see the reference was exceeded.
// An internal team (Charlie's own, §4.10) pays the real cost with zero margin; fixed prices do not apply to it.
// The global price multiplier (finance-settings.ts, decision 0040), when set, replaces every line's margin and fixed
// price: credits = ceil(real cost × multiplier ÷ credit value), still never above the reference. 1.0 during the beta.
import {
  PriceGridInput,
  type EstimateResponse,
  type PriceGrid,
  type PriceItem,
  type Quote,
  type Usage
} from '../../src/shared/cloud-api.ts'
import type { Audit } from './audit.ts'
import { iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { priceMultiplier } from './finance-settings.ts'
import { newId } from './ids.ts'

export const QUOTE_TTL_MS = 30 * 60_000

/** The grid item each usage is measured in (see measureUsage); every grid must price all of them. */
export const USAGE_ITEM: Record<Usage, string> = {
  synthesize: 'voice.chars',
  generateImage: 'image.count',
  generateVideo: 'video.seconds',
  talkingAvatar: 'avatar.seconds',
  channelData: 'channel.request',
  analyseVideo: 'analysis.minutes',
  submitGpuJob: 'gpu.seconds',
  searchStock: 'stock.searches',
  cloneVoice: 'voice.clone',
  designVoice: 'voice.design'
}
const EPS = 1e-9

/** ceil / floor that ignore binary noise (0.1 × 3 = 0.30000000000000004 must stay 0.3). */
export const ceilCredits = (x: number): number => Math.ceil(x - EPS)
export const floorCredits = (x: number): number => Math.floor(x + EPS)

/**
 * A real job is charged what it cost, to the fraction of a credit: the whole credits of (the team's carry + the job's exact
 * credits) are charged, never more than the hold, and the rest is carried to the team's next job instead of being rounded up.
 * Over a long run the team pays the exact total (to under one credit). Over the hold the hold is the ceiling and the carry
 * starts again.
 */
export function takeCarry(carry: number, exact: number, hold: number): { charged: number; carry: number } {
  const total = Math.max(0, carry) + Math.max(0, exact)
  const whole = floorCredits(total)
  if (whole > hold) return { charged: hold, carry: 0 }
  return { charged: whole, carry: Math.max(0, total - whole) }
}

export interface GridMoney {
  creditValueEur: number
  usdToEur: number
  overheadPct: number
  /** The global price multiplier (null or absent: each line's own margin or fixed price). */
  priceMultiplier?: number | null
}

export interface LinePrice {
  credits: number
  costEur: number
  referenceEur: number | null
  /** The line earns less than our real cost (reference cap, fixed price or min-1 rounding not covering it). */
  belowCost: boolean
  capped: boolean
  /** The charge (in credits) exceeds the reference converted to credits: only possible through the 1-credit minimum. */
  aboveReference: boolean
}

export function priceLine(grid: GridMoney, item: PriceItem, quantity: number, internal = false): LinePrice {
  if (!(quantity >= 0) || !Number.isFinite(quantity)) throw new CloudError('bad_request', `bad quantity for ${item.item}`)
  const costEur = quantity * item.providerCostUsd * grid.usdToEur * (1 + grid.overheadPct / 100)
  let credits: number
  if (internal) credits = ceilCredits(costEur / grid.creditValueEur)
  else if (grid.priceMultiplier != null) credits = ceilCredits((costEur * grid.priceMultiplier) / grid.creditValueEur)
  else if (item.pricing.mode === 'percent') credits = ceilCredits((costEur * (1 + item.pricing.marginPct / 100)) / grid.creditValueEur)
  else credits = ceilCredits(quantity * item.pricing.creditsPerUnit)
  const referenceEur = item.referenceEur === null ? null : quantity * item.referenceEur
  let capped = false
  if (referenceEur !== null && !internal) {
    const ceiling = floorCredits(referenceEur / grid.creditValueEur)
    if (credits > ceiling) {
      credits = ceiling
      capped = true
    }
  }
  // A source that costs us nothing (provider cost 0: Pixabay, Pexels, the archives, the YouTube reads) costs the user nothing:
  // the one-credit minimum is for work we pay for (decision 0105). A fixed price is a decision and is charged as written.
  const free = item.providerCostUsd === 0 && item.pricing.mode === 'percent'
  credits = free ? 0 : Math.max(1, credits)
  const aboveReference = referenceEur !== null && !internal && credits > referenceEur / grid.creditValueEur + EPS
  return { credits, costEur, referenceEur, belowCost: credits * grid.creditValueEur + EPS < costEur, capped, aboveReference }
}

/** Margin tiers of §4.4 ("25 / 10 / 5", question 1 of the plan, taken with its default answer). HYPOTHESIS, tunable
 *  until Charlie answers: cost ÷ reference at or under TIER_FAR_RATIO → TIER_FAR_PCT; at or under TIER_MEDIUM_RATIO →
 *  TIER_MEDIUM_PCT; above → TIER_NEAR_PCT. The prices never exceed the reference whatever the tier. */
export const TIER_FAR_RATIO = 0.6
export const TIER_MEDIUM_RATIO = 0.85
export const TIER_FAR_PCT = 25
export const TIER_MEDIUM_PCT = 10
export const TIER_NEAR_PCT = 5

/** Margin tier for an item, from its real cost and reference price per unit (both €). Used by the admin tool when a
 *  new item is given no margin, and by `publish` to warn about items outside their tier. */
export function suggestedMarginPct(costEurPerUnit: number, referenceEurPerUnit: number | null): number {
  if (referenceEurPerUnit === null || referenceEurPerUnit <= 0) return TIER_FAR_PCT
  const ratio = costEurPerUnit / referenceEurPerUnit
  if (ratio <= TIER_FAR_RATIO) return TIER_FAR_PCT
  if (ratio <= TIER_MEDIUM_RATIO) return TIER_MEDIUM_PCT
  return TIER_NEAR_PCT
}

export interface MarginWarning {
  item: string
  /** The item's nominal margin: the percent margin, or the one a fixed price gives over the real cost. */
  marginPct: number
  tierPct: number
}

const MARGIN_TOLERANCE_PCT = 0.5

/** Items (with a reference price) whose margin is not the one of their tier. A warning, never a refusal. */
export function marginWarnings(grid: GridMoney & { items: PriceItem[] }): MarginWarning[] {
  const out: MarginWarning[] = []
  for (const item of grid.items) {
    if (item.referenceEur === null || item.referenceEur <= 0) continue
    const cost = item.providerCostUsd * grid.usdToEur * (1 + grid.overheadPct / 100)
    if (!(cost > 0)) continue
    const marginPct = item.pricing.mode === 'percent' ? item.pricing.marginPct : ((item.pricing.creditsPerUnit * grid.creditValueEur) / cost - 1) * 100
    const tierPct = suggestedMarginPct(cost, item.referenceEur)
    if (Math.abs(marginPct - tierPct) > MARGIN_TOLERANCE_PCT) out.push({ item: item.item, marginPct: Math.round(marginPct * 100) / 100, tierPct })
  }
  return out
}

/** What one usage's input is made of, in the grid's units (the providers' `measure`). */
export type Measure = { item: string; quantity: number }[]

interface GridRow {
  version: number
  credit_value_eur: number
  usd_to_eur: number
  overhead_pct: number
  note: string | null
  items_json: string
  created_at: string
  created_by: string
}

/**
 * Items added after grid v1 shipped. A grid stored before an item existed is read with the item appended at its default price
 * (and a grid published without it gets it too), so adding a usage needs no new grid version and no migration, and
 * `admin price show` lists it. Charlie changes it like any other price.
 *   stock.searches: Pixabay, Pexels, Wikimedia and the archives bill us nothing, and the glue (the search, the download of the
 *   chosen files, the attribution kept with them) is our own work: cost 0, so 0 credit per search (decision 0105). It was
 *   0.002 USD at 1.5x, which the one-credit minimum made 1 credit per search: 195 Pixabay searches billed for nothing.
 *   voice.design (production-5): one request of voice previews. ElevenLabs bills the characters of the preview text (at most
 *   1 000, USD 0.08 per 1 000 on elevenlabs.io/pricing/api, read 2026-11-01): 0.08 is the worst case. Saving a preview as a
 *   voice is measured 0 (no provider price; the one-credit minimum applies).
 */
export const LATE_ITEMS: readonly PriceItem[] = [
  { item: 'stock.searches', usage: 'searchStock', unit: 'search', providerCostUsd: 0, referenceEur: null, pricing: { mode: 'percent', marginPct: 0 } },
  { item: 'voice.design', usage: 'designVoice', unit: 'request', providerCostUsd: 0.08, referenceEur: null, pricing: { mode: 'percent', marginPct: 10 } }
]
const withLateItems = (items: PriceItem[]): PriceItem[] => [...items, ...LATE_ITEMS.filter((l) => !items.some((i) => i.item === l.item))]

const toGrid = (r: GridRow): PriceGrid => ({
  version: r.version,
  creditValueEur: r.credit_value_eur,
  usdToEur: r.usd_to_eur,
  overheadPct: r.overhead_pct,
  note: r.note,
  items: withLateItems(JSON.parse(r.items_json) as PriceItem[]),
  createdAt: r.created_at,
  createdBy: r.created_by
})

export interface StoredQuote extends Quote {
  teamId: string
  accountId: string
  input: unknown
  costEur: number
  /** The global multiplier the quote was priced with (null: the grid's margins). */
  priceMultiplier: number | null
}

export class Pricing {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  constructor(db: CloudDb, clock: Clock, audit: Audit) {
    this.db = db
    this.clock = clock
    this.audit = audit
  }

  /** The global price multiplier in force (null: the grid's margins). */
  multiplier(): number | null {
    return priceMultiplier(this.db)
  }

  current(): PriceGrid {
    const row = this.db.prepare('SELECT * FROM price_grids ORDER BY version DESC LIMIT 1').get() as GridRow | undefined
    if (!row) throw new CloudError('internal', 'no price grid')
    return toGrid(row)
  }

  grid(version: number): PriceGrid {
    const row = this.db.prepare('SELECT * FROM price_grids WHERE version = ?').get(version) as GridRow | undefined
    if (!row) throw new CloudError('not_found', `no price grid ${version}`)
    return toGrid(row)
  }

  versions(): { version: number; createdAt: string; note: string | null }[] {
    const rows = this.db.prepare('SELECT version, created_at, note FROM price_grids ORDER BY version DESC').all() as {
      version: number
      created_at: string
      note: string | null
    }[]
    return rows.map((r) => ({ version: r.version, createdAt: r.created_at, note: r.note }))
  }

  /** Writes a new grid version (grids are never edited in place). */
  publish(input: unknown, actor: string): PriceGrid {
    return this.publishChecked(input, actor).grid
  }

  /** `publish`, plus the margin warnings of the new grid (items outside their tier; nothing is refused for them). */
  publishChecked(input: unknown, actor: string): { grid: PriceGrid; warnings: MarginWarning[] } {
    const parsed = PriceGridInput.safeParse(input)
    if (!parsed.success) throw new CloudError('bad_request', `bad price grid: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    const g = { ...parsed.data, items: withLateItems(parsed.data.items) }
    const names = new Set<string>()
    for (const item of g.items) {
      if (names.has(item.item)) throw new CloudError('bad_request', `item ${item.item} listed twice`)
      names.add(item.item)
    }
    for (const [usage, item] of Object.entries(USAGE_ITEM)) {
      if (!g.items.some((i) => i.item === item && i.usage === usage)) throw new CloudError('bad_request', `the grid must price ${item} (${usage})`)
    }
    const grid = tx(this.db, () => {
      const version = (this.db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM price_grids').get() as { v: number }).v
      this.db
        .prepare(
          `INSERT INTO price_grids (version, credit_value_eur, usd_to_eur, overhead_pct, note, items_json, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(version, g.creditValueEur, g.usdToEur, g.overheadPct, g.note, JSON.stringify(g.items), iso(this.clock.now()), actor)
      return this.grid(version)
    })
    const warnings = marginWarnings(grid)
    this.audit.record(actor, 'price.grid', `v${grid.version}`, { items: grid.items.length, creditValueEur: grid.creditValueEur, marginWarnings: warnings.length })
    return { grid, warnings }
  }

  /** Prices a measured usage with the current grid and stores the quote (valid QUOTE_TTL_MS). */
  quote(p: {
    teamId: string
    accountId: string
    internal: boolean
    usage: Usage
    input: unknown
    measure: Measure
    demo: boolean
    /** The credits of a line on the engine the input names (null: the grid line prices it); reserve-devis, issue #89. */
    engineCredits?: (line: { item: string; quantity: number }, grid: PriceGrid & { priceMultiplier: number | null }) => number | null
  }): StoredQuote {
    const multiplier = this.multiplier()
    const grid = { ...this.current(), priceMultiplier: multiplier }
    if (p.measure.length === 0) throw new CloudError('bad_request', 'nothing to price')
    let costEur = 0
    let referenceEur: number | null = 0
    const lines = p.measure.map(({ item, quantity }) => {
      const priced = grid.items.find((i) => i.item === item && i.usage === p.usage)
      if (!priced) throw new CloudError('internal', `price grid v${grid.version} has no item ${item}`)
      const line = priceLine(grid, priced, quantity, p.internal)
      costEur += line.costEur
      referenceEur = referenceEur === null || line.referenceEur === null ? null : referenceEur + line.referenceEur
      const onEngine = p.engineCredits?.({ item, quantity }, grid) ?? null
      const credits = onEngine ?? line.credits
      // the engine's own cost stands for the line's when it prices the line (the finance overrun alert compares jobs to it)
      if (onEngine !== null && line.costEur > 0 && line.credits > 0) costEur -= line.costEur - (onEngine * grid.creditValueEur) / (p.internal ? 1 : (grid.priceMultiplier ?? 1 + (priced.pricing.mode === 'percent' ? priced.pricing.marginPct : 25) / 100))
      const aboveReference = onEngine === null ? line.aboveReference : line.referenceEur !== null && !p.internal && onEngine > line.referenceEur / grid.creditValueEur + 1e-9
      return { item, quantity, unit: priced.unit, credits, referenceEur: line.referenceEur, aboveReference }
    })
    const totalCredits = lines.reduce((s, l) => s + l.credits, 0)
    const now = this.clock.now()
    const quote: StoredQuote = {
      id: newId('qt'),
      usage: p.usage,
      gridVersion: grid.version,
      creditValueEur: grid.creditValueEur,
      lines,
      totalCredits,
      referenceEur,
      demo: p.demo,
      createdAt: iso(now),
      expiresAt: iso(now + QUOTE_TTL_MS),
      teamId: p.teamId,
      accountId: p.accountId,
      input: p.input,
      costEur,
      priceMultiplier: multiplier
    }
    this.db
      .prepare(
        `INSERT INTO quotes (id, team_id, account_id, usage, input_json, lines_json, total_credits, reference_eur, cost_eur,
           grid_version, demo, created_at, expires_at, price_multiplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        quote.id,
        quote.teamId,
        quote.accountId,
        quote.usage,
        JSON.stringify(p.input),
        JSON.stringify(lines),
        totalCredits,
        referenceEur,
        costEur,
        grid.version,
        p.demo ? 1 : 0,
        quote.createdAt,
        quote.expiresAt,
        multiplier
      )
    return quote
  }

  /** Prices engine estimates (one grid item per usage) on the current grid; nothing is stored. */
  estimate(p: {
    internal: boolean
    items: { key: string; usage: Usage; quantity: number; engine?: string }[]
    demo: (usage: Usage) => boolean
    /** The credits of an item on the engine it names (null: the grid line prices it); reserve-devis, issue #89. */
    engineCredits?: (usage: Usage, engine: string, quantity: number, grid: PriceGrid & { priceMultiplier: number | null }) => number | null
  }): EstimateResponse {
    const grid = { ...this.current(), priceMultiplier: this.multiplier() }
    const lines = p.items.map(({ key, usage, quantity, engine }) => ({
      key,
      credits:
        (engine !== undefined ? p.engineCredits?.(usage, engine, quantity, grid) : null) ??
        priceLine(grid, this.gridItem(grid, usage, USAGE_ITEM[usage]), quantity, p.internal).credits,
      demo: p.demo(usage)
    }))
    return { gridVersion: grid.version, creditValueEur: grid.creditValueEur, lines, totalCredits: lines.reduce((s, l) => s + l.credits, 0) }
  }

  /** What a measured usage costs in credits on a given grid version and multiplier (a job is settled on its quote's). */
  priceMeasure(p: { gridVersion: number; usage: Usage; measure: Measure; internal: boolean; priceMultiplier?: number | null }): number {
    const grid = { ...this.grid(p.gridVersion), priceMultiplier: p.priceMultiplier ?? null }
    return p.measure.reduce((sum, { item, quantity }) => sum + priceLine(grid, this.gridItem(grid, p.usage, item), quantity, p.internal).credits, 0)
  }

  private gridItem(grid: PriceGrid, usage: Usage, item: string): PriceItem {
    const priced = grid.items.find((i) => i.item === item && i.usage === usage)
    if (!priced) throw new CloudError('internal', `price grid v${grid.version} has no item ${item}`)
    return priced
  }

  getQuote(id: string): StoredQuote | null {
    const r = this.db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as
      | {
          id: string
          team_id: string
          account_id: string
          usage: Usage
          input_json: string
          lines_json: string
          total_credits: number
          reference_eur: number | null
          cost_eur: number
          grid_version: number
          demo: number
          created_at: string
          expires_at: string
          price_multiplier: number | null
        }
      | undefined
    if (!r) return null
    return {
      id: r.id,
      usage: r.usage,
      gridVersion: r.grid_version,
      creditValueEur: this.grid(r.grid_version).creditValueEur,
      // Quotes stored before `aboveReference` existed lack it: false.
      lines: (JSON.parse(r.lines_json) as (Omit<Quote['lines'][number], 'aboveReference'> & { aboveReference?: boolean })[]).map((l) => ({
        ...l,
        aboveReference: l.aboveReference ?? false
      })),
      totalCredits: r.total_credits,
      referenceEur: r.reference_eur,
      demo: r.demo === 1,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      teamId: r.team_id,
      accountId: r.account_id,
      input: JSON.parse(r.input_json) as unknown,
      costEur: r.cost_eur,
      priceMultiplier: r.price_multiplier
    }
  }
}
