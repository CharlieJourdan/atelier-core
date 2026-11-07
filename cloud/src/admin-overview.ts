// The founder console's real figures (PLAN-COMPLEXITE §E.9): accounts and teams, active plans and the monthly
// recurring revenue, what was charged this month, the team computers and what they cost, credits granted and spent.
import { PLANS, type BillingPeriod } from './billing/catalog.ts'
import type { Cloud } from './cloud.ts'
import type { PlanId } from './machines/plans.ts'

export interface AdminOverview {
  accounts: number
  teams: number
  plans: { plan: string; active: number }[]
  /** Monthly recurring revenue of the active plans (a yearly plan counts a twelfth), euro cents excl. VAT. */
  mrrCents: number
  /** Charged since the 1st of this month. */
  monthRevenueCents: { subscription: number; pack: number; topup: number }
  machines: { running: number; hibernated: number; monthlyCostEur: number; demo: boolean }
  creditsThisMonth: { granted: number; spent: number }
  paymentsProvider: 'stripe' | 'fake'
  providerAlerts: { provider: string; message: string; raisedAt: string }[]
}

export function adminOverview(cloud: Cloud): AdminOverview {
  const now = new Date(cloud.clock.now())
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  const count = (sql: string): number => (cloud.db.prepare(sql).get() as { n: number }).n
  const subs = cloud.db.prepare("SELECT plan, period FROM billing_subscriptions WHERE status = 'active'").all() as { plan: PlanId; period: BillingPeriod }[]
  const byPlan = new Map<string, number>()
  let mrr = 0
  for (const s of subs) {
    byPlan.set(s.plan, (byPlan.get(s.plan) ?? 0) + 1)
    const p = PLANS[s.plan]
    if (p) mrr += s.period === 'year' ? Math.round(p.yearlyCents / 12) : p.monthlyCents
  }
  const machines = cloud.machines()
  const cost = machines.monthlyCost()
  const moved = cloud.db
    .prepare("SELECT COALESCE(SUM(CASE WHEN kind = 'grant' THEN delta ELSE 0 END), 0) AS granted, COALESCE(SUM(CASE WHEN kind = 'capture' THEN -delta ELSE 0 END), 0) AS spent FROM wallet_entries WHERE created_at >= ? AND created_at < ?")
    .get(monthStart, nextMonth) as { granted: number; spent: number }
  return {
    accounts: count('SELECT COUNT(*) AS n FROM accounts'),
    teams: count('SELECT COUNT(*) AS n FROM teams'),
    plans: [...byPlan.entries()].map(([plan, active]) => ({ plan, active })).sort((a, b) => b.active - a.active),
    mrrCents: mrr,
    monthRevenueCents: cloud.billing.revenueCents(monthStart, nextMonth),
    machines: { running: cost.running, hibernated: cost.hibernated, monthlyCostEur: cost.eur, demo: machines.providerKind === 'fake' },
    creditsThisMonth: { granted: moved.granted, spent: moved.spent },
    paymentsProvider: cloud.payments.kind,
    providerAlerts: cloud.providerAlerts.list()
  }
}
