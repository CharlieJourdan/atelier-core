// The founder's money settings (decision 0040), changed from the console or `npm run cloud -- admin margin|fx`, never
// in code:
//   - the global PRICE MULTIPLIER: a credit line costs real cost × multiplier. 1.0 during the beta (sold and granted at
//     cost, margin 0 %). `null` hands pricing back to the grid's own margin per line (decision 0015's 20–50 %).
//   - the dated $ → € RATE the console converts provider costs with (provider costs are in dollars).
//   - the monthly FIXED COSTS (a plan, a server, a subscription), each in its own currency, in cents.
// Every change is audited.
import type { Audit } from './audit.ts'
import { iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId } from './ids.ts'

/** The beta rule: sold at cost. */
export const DEFAULT_PRICE_MULTIPLIER = 1
export const MAX_PRICE_MULTIPLIER = 5

export type Currency = 'USD' | 'EUR'

export interface FxRate {
  /** Euros for one dollar. */
  eurPerUsd: number
  /** The day the rate was read (YYYY-MM-DD). */
  asOf: string
}

export interface FixedCost {
  id: string
  label: string
  amountCents: number
  currency: Currency
  note: string | null
  updatedAt: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function read<T>(db: CloudDb, key: string): T | undefined {
  const row = db.prepare('SELECT value_json FROM finance_settings WHERE key = ?').get(key) as { value_json: string } | undefined
  return row ? (JSON.parse(row.value_json) as T) : undefined
}

/** The multiplier quotes are priced with now (`null`: the grid's margins). Read by pricing on every quote. */
export function priceMultiplier(db: CloudDb): number | null {
  const v = read<number | null>(db, 'price.multiplier')
  return v === undefined ? DEFAULT_PRICE_MULTIPLIER : v
}

/** The dated $ → € rate now (the founder's, else the newest grid's). Read by the console and by every job's capture. */
export function fxRate(db: CloudDb, today: () => string): FxRate {
  const v = read<{ rate: number; asOf: string }>(db, 'fx.eurPerUsd')
  if (v) return { eurPerUsd: v.rate, asOf: v.asOf }
  const grid = db.prepare('SELECT usd_to_eur, created_at FROM price_grids ORDER BY version DESC LIMIT 1').get() as { usd_to_eur: number; created_at: string } | undefined
  return { eurPerUsd: grid?.usd_to_eur ?? 0.92, asOf: (grid?.created_at ?? today()).slice(0, 10) }
}

/** What a job really cost us, in euros: what the provider billed in dollars, converted at the dated rate, plus the grid's
 *  overhead. The ONE formula of the capture (jobs.ts) and of the P&L (admin.ts), so a job charged at cost is never a loss job. */
export function jobCostEur(costUsd: number, eurPerUsd: number, overheadPct: number): number {
  return costUsd * eurPerUsd * (1 + overheadPct / 100)
}

export class FinanceSettings {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  constructor(db: CloudDb, clock: Clock, audit: Audit) {
    this.db = db
    this.clock = clock
    this.audit = audit
  }

  multiplier(): number | null {
    return priceMultiplier(this.db)
  }

  /** At least 1 (never under cost), at most MAX_PRICE_MULTIPLIER; `null` = the grid's margin per line. */
  setMultiplier(value: number | null, actor: string): void {
    if (value !== null && !(Number.isFinite(value) && value >= 1 && value <= MAX_PRICE_MULTIPLIER)) {
      throw new CloudError('bad_request', `the price multiplier is between 1 and ${MAX_PRICE_MULTIPLIER} (or the grid's margins)`)
    }
    this.write('price.multiplier', value, actor)
    this.audit.record(actor, 'finance.multiplier', 'price.multiplier', { value })
  }

  fx(): FxRate {
    return fxRate(this.db, () => iso(this.clock.now()))
  }

  setFx(eurPerUsd: number, asOf: string, actor: string): void {
    if (!(Number.isFinite(eurPerUsd) && eurPerUsd > 0 && eurPerUsd < 10)) throw new CloudError('bad_request', 'the rate is euros for one dollar, between 0 and 10')
    if (!DAY.test(asOf)) throw new CloudError('bad_request', 'the date of the rate is YYYY-MM-DD')
    this.write('fx.eurPerUsd', { rate: eurPerUsd, asOf }, actor)
    this.audit.record(actor, 'finance.fx', 'fx.eurPerUsd', { rate: eurPerUsd, asOf })
  }

  fixedCosts(): FixedCost[] {
    const rows = this.db
      .prepare('SELECT id, label, amount_cents, currency, note, updated_at FROM fixed_costs WHERE removed_at IS NULL ORDER BY created_at, id')
      .all() as { id: string; label: string; amount_cents: number; currency: Currency; note: string | null; updated_at: string }[]
    return rows.map((r) => ({ id: r.id, label: r.label, amountCents: r.amount_cents, currency: r.currency, note: r.note, updatedAt: r.updated_at }))
  }

  /** Adds a fixed cost, or changes one (`id`). */
  saveFixedCost(p: { id?: string | undefined; label: string; amountCents: number; currency: Currency; note?: string | null | undefined }, actor: string): FixedCost {
    const label = p.label.trim()
    if (label.length === 0 || label.length > 120) throw new CloudError('bad_request', 'a fixed cost needs a label (≤ 120 characters)')
    if (!Number.isSafeInteger(p.amountCents) || p.amountCents < 0) throw new CloudError('bad_request', 'the amount is a whole number of cents ≥ 0')
    const now = iso(this.clock.now())
    const note = p.note?.trim() || null
    let id = p.id
    if (id) {
      const done = this.db
        .prepare('UPDATE fixed_costs SET label = ?, amount_cents = ?, currency = ?, note = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL')
        .run(label, p.amountCents, p.currency, note, now, id)
      if (Number(done.changes) === 0) throw new CloudError('not_found', `no fixed cost ${id}`)
    } else {
      id = newId('fc')
      this.db
        .prepare('INSERT INTO fixed_costs (id, label, amount_cents, currency, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, label, p.amountCents, p.currency, note, now, now)
    }
    this.audit.record(actor, 'finance.fixed_cost', id, { label, amountCents: p.amountCents, currency: p.currency })
    return { id, label, amountCents: p.amountCents, currency: p.currency, note, updatedAt: now }
  }

  removeFixedCost(id: string, actor: string): void {
    const done = this.db.prepare('UPDATE fixed_costs SET removed_at = ? WHERE id = ? AND removed_at IS NULL').run(iso(this.clock.now()), id)
    if (Number(done.changes) === 0) throw new CloudError('not_found', `no fixed cost ${id}`)
    this.audit.record(actor, 'finance.fixed_cost_removed', id, {})
  }

  private write(key: string, value: unknown, actor: string): void {
    this.db
      .prepare(
        `INSERT INTO finance_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(key, JSON.stringify(value), iso(this.clock.now()), actor)
  }
}
