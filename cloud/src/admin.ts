// The platform's P&L (§4.4, visible to platform admins only) and support requests. P&L rows come from settled jobs:
// credits sold × the credit value of the grid they were quoted with, against the provider's cost converted with the dated
// dollar rate (the one a job is captured at, finance-settings.ts) and that grid's overhead (the same `jobCostEur`). Internal teams (margin zero, §4.10) and demo jobs never count (PLAN-V2 §8.4),
// unless asked explicitly.
import { iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { fxRate, jobCostEur } from './finance-settings.ts'
import { newId } from './ids.ts'

export interface PnlRow {
  day: string
  provider: string
  jobs: number
  creditsSold: number
  revenueEur: number
  costEur: number
  marginEur: number
  lossJobs: number
}

const round2 = (x: number): number => Math.round(x * 100) / 100

export function pnl(db: CloudDb, p: { from: string; to: string; includeDemo?: boolean; includeInternal?: boolean }): PnlRow[] {
  if (p.from > p.to) throw new CloudError('bad_request', '`from` is after `to`')
  const rows = db
    .prepare(
      `SELECT substr(j.updated_at, 1, 10) AS day, j.provider, j.credits, COALESCE(j.cost_usd, 0) AS cost_usd,
              g.credit_value_eur, g.overhead_pct
       FROM jobs j
       JOIN quotes q ON q.id = j.quote_id
       JOIN price_grids g ON g.version = q.grid_version
       JOIN teams t ON t.id = j.team_id
       WHERE j.state = 'succeeded' AND substr(j.updated_at, 1, 10) BETWEEN ? AND ?
         AND (? = 1 OR j.demo = 0) AND (? = 1 OR t.internal = 0)
       ORDER BY day, j.provider`
    )
    .all(p.from, p.to, p.includeDemo ? 1 : 0, p.includeInternal ? 1 : 0) as {
    day: string
    provider: string
    credits: number
    cost_usd: number
    credit_value_eur: number
    overhead_pct: number
  }[]
  const out = new Map<string, PnlRow>()
  const eurPerUsd = fxRate(db, () => new Date().toISOString()).eurPerUsd
  for (const r of rows) {
    const key = `${r.day}\n${r.provider}`
    const row = out.get(key) ?? { day: r.day, provider: r.provider, jobs: 0, creditsSold: 0, revenueEur: 0, costEur: 0, marginEur: 0, lossJobs: 0 }
    const revenue = r.credits * r.credit_value_eur
    const cost = jobCostEur(r.cost_usd, eurPerUsd, r.overhead_pct)
    row.jobs += 1
    row.creditsSold += r.credits
    row.revenueEur += revenue
    row.costEur += cost
    // a credit is the smallest unit sold and the fraction under it is carried to the team's next job, so a shortfall under one
    // credit is rounding, not a loss
    if (revenue + r.credit_value_eur <= cost - 1e-9) row.lossJobs += 1
    out.set(key, row)
  }
  return [...out.values()].map((r) => ({
    ...r,
    revenueEur: round2(r.revenueEur),
    costEur: round2(r.costEur),
    marginEur: round2(r.revenueEur - r.costEur)
  }))
}

export class Support {
  private readonly db: CloudDb
  private readonly clock: Clock
  constructor(db: CloudDb, clock: Clock) {
    this.db = db
    this.clock = clock
  }

  create(p: { accountId: string; teamId: string; subject: string; body: string }): { id: string; createdAt: string } {
    const id = newId('sup')
    const createdAt = iso(this.clock.now())
    this.db
      .prepare('INSERT INTO support_requests (id, account_id, team_id, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, p.accountId, p.teamId, p.subject, p.body, createdAt)
    return { id, createdAt }
  }

  list(limit = 200): { id: string; accountId: string; subject: string; body: string; createdAt: string }[] {
    const rows = this.db
      .prepare('SELECT id, account_id, subject, body, created_at FROM support_requests ORDER BY created_at DESC LIMIT ?')
      .all(limit) as { id: string; account_id: string; subject: string; body: string; created_at: string }[]
    return rows.map((r) => ({ id: r.id, accountId: r.account_id, subject: r.subject, body: r.body, createdAt: r.created_at }))
  }
}
