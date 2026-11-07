// The founder console's money dashboard (ADMIN_FINANCE_ROUTES, decision 0040). Every figure is read from the ledgers
// themselves, nothing is cached:
//   - credits: the wallet's entries. Offered = admin grants and corrections, bought = billing's grants, spent = captures;
//     so offered + bought − spent is the balance, team by team (the tests hold it to that). Spending uses the offered
//     credits first: the offered credits left are max(0, offered − spent), all time.
//   - real cost: what the provider billed per call (`jobs.cost_usd`, dollars, written by the adapters); a succeeded
//     call whose adapter reported nothing counts at its quote's cost (and is marked estimated). Failed and cancelled
//     calls bill nothing. Calls answered by the fakes (`demo`) count only when asked (their cost is simulated).
//   - revenue: what billing charged (`billing_charges`, euro cents), so a free credit spent is a cost with no revenue.
//   - finished minutes: `finished_videos`, written when a video's kit reaches the platform with its length.
//   - fixed costs: the list the founder types in, plus two lines the Cloud computes: the HeyGen plan (config.json
//     `heygen.plan`, Pro 49 $ or Business 149 $) and the team computers' monthly cost.
import type {
  FinanceAlert,
  FinanceDashboard,
  FinanceFixedCost,
  FinancePeriod,
  FinanceProviderRow,
  FinanceSpendPoint,
  FinanceTeamRow,
  FinanceTotals
} from '../../src/shared/cloud-admin-finance.ts'
import { DAY_MS, iso } from './clock.ts'
import type { Cloud } from './cloud.ts'
import type { FixedCost } from './finance-settings.ts'
import { HEYGEN_PLANS } from './providers/engines.ts'

/** A call whose real cost passes its quote by more than this ratio raises an alert. */
export const OVERRUN_ALERT_RATIO = 1.1
/** The multiplier the break-even is also read at, to show what a margin would change. */
export const REFERENCE_MULTIPLIER = 1.3
const MAX_ALERTS = 50

const round2 = (x: number): number => Math.round(x * 100) / 100

/** The start of a period in UTC: today, the last 7 days (today included), this calendar month, or no start. */
export function periodStart(nowMs: number, period: FinancePeriod): string | null {
  const d = new Date(nowMs)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  if (period === 'day') return iso(day)
  if (period === 'week') return iso(day - 6 * DAY_MS)
  if (period === 'month') return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  return null
}

interface JobFact {
  id: string
  teamId: string
  provider: string
  engine: string | null
  state: 'succeeded' | 'failed' | 'cancelled'
  credits: number
  /** What the call cost us, in dollars (reported, or the quote's cost when the adapter reported none); 0 unless succeeded. */
  usd: number
  estimated: boolean
  demo: boolean
  at: string
}

function jobFacts(cloud: Cloud, from: string | null): JobFact[] {
  const rows = cloud.db
    .prepare(
      `SELECT j.id, j.team_id, j.provider, json_extract(q.input_json, '$.engine') AS engine, j.state, j.credits, j.cost_usd, j.demo,
              j.updated_at, q.cost_eur / (g.usd_to_eur * (1 + g.overhead_pct / 100.0)) AS quote_usd
       FROM jobs j JOIN quotes q ON q.id = j.quote_id JOIN price_grids g ON g.version = q.grid_version
       WHERE j.state IN ('succeeded', 'failed', 'cancelled') AND (? IS NULL OR j.updated_at >= ?)
       ORDER BY j.updated_at`
    )
    .all(from, from) as {
    id: string
    team_id: string
    provider: string
    engine: unknown
    state: JobFact['state']
    credits: number
    cost_usd: number | null
    demo: number
    updated_at: string
    quote_usd: number | null
  }[]
  return rows.map((r) => {
    const ok = r.state === 'succeeded'
    return {
      id: r.id,
      teamId: r.team_id,
      provider: r.provider,
      engine: typeof r.engine === 'string' ? r.engine : null,
      state: r.state,
      credits: ok ? r.credits : 0,
      usd: ok ? (r.cost_usd ?? r.quote_usd ?? 0) : 0,
      estimated: ok && r.cost_usd === null,
      demo: r.demo === 1,
      at: r.updated_at
    }
  })
}

interface Moves {
  offered: number
  bought: number
  spent: number
}

function walletMoves(cloud: Cloud, from: string | null): Map<string, Moves> {
  const rows = cloud.db
    .prepare(
      `SELECT team_id,
              COALESCE(SUM(CASE WHEN kind IN ('grant', 'adjust') AND COALESCE(funding, 'offered') = 'offered' THEN delta ELSE 0 END), 0) AS offered,
              COALESCE(SUM(CASE WHEN kind IN ('grant', 'adjust') AND funding = 'paid' THEN delta ELSE 0 END), 0) AS bought,
              COALESCE(SUM(CASE WHEN kind = 'capture' THEN -delta ELSE 0 END), 0) AS spent
       FROM wallet_entries WHERE (? IS NULL OR created_at >= ?) GROUP BY team_id`
    )
    .all(from, from) as { team_id: string; offered: number; bought: number; spent: number }[]
  return new Map(rows.map((r) => [r.team_id, { offered: r.offered, bought: r.bought, spent: r.spent }]))
}

function sumByTeam(cloud: Cloud, sql: string, ...args: (string | number | null)[]): Map<string, number> {
  const rows = cloud.db.prepare(sql).all(...args) as { team_id: string; v: number }[]
  return new Map(rows.map((r) => [r.team_id, r.v]))
}

const revenueByTeam = (cloud: Cloud, from: string | null): Map<string, number> =>
  sumByTeam(cloud, 'SELECT team_id, COALESCE(SUM(cents), 0) AS v FROM billing_charges WHERE (? IS NULL OR created_at >= ?) GROUP BY team_id', from, from)

interface Videos {
  videos: number
  minutes: number
}

function videosByTeam(cloud: Cloud, from: string | null, includeDemo: boolean): Map<string, Videos> {
  const rows = cloud.db
    .prepare(
      `SELECT team_id, COUNT(*) AS videos, COALESCE(SUM(duration_s), 0) / 60.0 AS minutes FROM finished_videos
       WHERE (? IS NULL OR first_at >= ?) AND (? = 1 OR demo = 0) GROUP BY team_id`
    )
    .all(from, from, includeDemo ? 1 : 0) as { team_id: string; videos: number; minutes: number }[]
  return new Map(rows.map((r) => [r.team_id, { videos: r.videos, minutes: r.minutes }]))
}

const sumVideos = (m: Map<string, Videos>): Videos => [...m.values()].reduce((a, v) => ({ videos: a.videos + v.videos, minutes: a.minutes + v.minutes }), { videos: 0, minutes: 0 })

/** All time is drawn by day while the history is shorter than this, by month after. */
const DAILY_HISTORY_MS = 92 * DAY_MS

/** The spend over time: hours for a day, days for a week, a month or a short history, months for a long one; empty
 *  buckets included. */
function spendSeries(facts: JobFact[], period: FinancePeriod, from: string | null, nowMs: number): FinanceSpendPoint[] {
  const first = facts[0]?.at ?? iso(nowMs)
  const firstDay = Date.parse(first.slice(0, 10) + 'T00:00:00.000Z')
  const monthly = period === 'all' && nowMs - firstDay > DAILY_HISTORY_MS
  const width = period === 'day' ? 13 : monthly ? 7 : 10
  const start = period === 'all' ? firstDay : Date.parse(from as string)
  const keys: string[] = []
  if (monthly) {
    const d = new Date(Date.parse(first.slice(0, 7) + '-01T00:00:00.000Z'))
    const end = iso(nowMs).slice(0, 7)
    for (let k = iso(d.getTime()).slice(0, 7); k <= end; ) {
      keys.push(k)
      d.setUTCMonth(d.getUTCMonth() + 1)
      k = iso(d.getTime()).slice(0, 7)
    }
  } else {
    const step = period === 'day' ? 3_600_000 : DAY_MS
    for (let t = start; t <= nowMs; t += step) keys.push(iso(t).slice(0, width))
  }
  const points = new Map(keys.map((k) => [k, { bucket: k, costUsdCents: 0, credits: 0 }]))
  for (const f of facts) {
    if (f.state !== 'succeeded') continue
    const p = points.get(f.at.slice(0, width))
    if (!p) continue
    p.costUsdCents += f.usd * 100
    p.credits += f.credits
  }
  return [...points.values()].map((p) => ({ ...p, costUsdCents: round2(p.costUsdCents) }))
}

function providerRows(facts: JobFact[], eurPerUsd: number): FinanceProviderRow[] {
  const out = new Map<string, FinanceProviderRow>()
  for (const f of facts) {
    const key = `${f.provider}\n${f.engine ?? ''}\n${f.demo ? 1 : 0}`
    const row = out.get(key) ?? {
      provider: f.provider,
      engine: f.engine,
      demo: f.demo,
      calls: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      creditsBilled: 0,
      costUsdCents: 0,
      costEurCents: 0,
      estimated: 0
    }
    row.calls += 1
    row[f.state] += 1
    row.creditsBilled += f.credits
    row.costUsdCents += f.usd * 100
    if (f.estimated) row.estimated += 1
    out.set(key, row)
  }
  return [...out.values()]
    .map((r) => ({ ...r, costUsdCents: round2(r.costUsdCents), costEurCents: round2(r.costUsdCents * eurPerUsd) }))
    .sort((a, b) => b.costUsdCents - a.costUsdCents || b.calls - a.calls)
}

function alerts(cloud: Cloud, includeDemo: boolean): { count: number; list: FinanceAlert[] } {
  const where = `FROM jobs j JOIN quotes q ON q.id = j.quote_id JOIN price_grids g ON g.version = q.grid_version JOIN teams t ON t.id = j.team_id
     WHERE j.state = 'succeeded' AND j.cost_usd IS NOT NULL AND q.cost_eur > 0 AND (? = 1 OR j.demo = 0)
       AND j.cost_usd > ? * q.cost_eur / (g.usd_to_eur * (1 + g.overhead_pct / 100.0))`
  const args = [includeDemo ? 1 : 0, OVERRUN_ALERT_RATIO] as const
  const count = (cloud.db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...args) as { n: number }).n
  const rows = cloud.db
    .prepare(
      `SELECT j.id, t.name, j.provider, json_extract(q.input_json, '$.engine') AS engine, j.updated_at, j.cost_usd,
              q.cost_eur / (g.usd_to_eur * (1 + g.overhead_pct / 100.0)) AS quote_usd
       ${where} ORDER BY j.updated_at DESC LIMIT ?`
    )
    .all(...args, MAX_ALERTS) as { id: string; name: string; provider: string; engine: unknown; updated_at: string; cost_usd: number; quote_usd: number }[]
  return {
    count,
    list: rows.map((r) => ({
      jobId: r.id,
      teamName: r.name,
      provider: r.provider,
      engine: typeof r.engine === 'string' ? r.engine : null,
      at: r.updated_at,
      quotedUsdCents: round2(r.quote_usd * 100),
      realUsdCents: round2(r.cost_usd * 100),
      overPct: Math.round((r.cost_usd / r.quote_usd - 1) * 1000) / 10
    }))
  }
}

function fixedCosts(cloud: Cloud, eurPerUsd: number): FinanceFixedCost[] {
  const typed: FinanceFixedCost[] = cloud.finance.fixedCosts().map(({ updatedAt: _, ...c }: FixedCost) => ({
    ...c,
    monthlyEurCents: round2(c.currency === 'USD' ? c.amountCents * eurPerUsd : c.amountCents),
    auto: false,
    demo: false
  }))
  const heygenCents = HEYGEN_PLANS[cloud.heygenPlan] * 100
  typed.push({
    id: 'auto:heygen',
    label: `Forfait HeyGen (${cloud.heygenPlan === 'business' ? 'Business' : 'Pro'})`,
    amountCents: heygenCents,
    currency: 'USD',
    note: 'heygen.plan dans config.json du Cloud',
    monthlyEurCents: round2(heygenCents * eurPerUsd),
    auto: true,
    demo: false
  })
  const machines = cloud.machines()
  const cost = machines.monthlyCost()
  if (cost.running + cost.hibernated === 0) return typed
  const cents = Math.round(cost.eur * 100)
  return [
    ...typed,
    {
      id: 'auto:machines',
      label: `Ordinateurs d’équipe (${cost.running} en marche, ${cost.hibernated} en veille)`,
      amountCents: cents,
      currency: 'EUR',
      note: null,
      monthlyEurCents: cents,
      auto: true,
      demo: machines.providerKind === 'fake'
    }
  ]
}

export function financeDashboard(cloud: Cloud, p: { period: FinancePeriod; includeDemo: boolean }): FinanceDashboard {
  const now = cloud.clock.now()
  const from = periodStart(now, p.period)
  const monthFrom = periodStart(now, 'month')
  const fx = cloud.finance.fx()
  const multiplier = cloud.finance.multiplier()
  const creditValueEur = cloud.pricing.current().creditValueEur
  const counted = (f: JobFact): boolean => p.includeDemo || !f.demo

  const allFacts = jobFacts(cloud, from)
  const facts = allFacts.filter(counted)
  const moves = walletMoves(cloud, from)
  const movesAll = walletMoves(cloud, null)
  const revenue = revenueByTeam(cloud, from)
  const videos = videosByTeam(cloud, from, p.includeDemo)

  const teamsRows = cloud.db
    .prepare(
      `SELECT t.id, t.name, t.internal, t.test,
              (SELECT a.email FROM members m JOIN accounts a ON a.id = m.account_id WHERE m.team_id = t.id ORDER BY m.role = 'owner' DESC, m.created_at LIMIT 1) AS email
       FROM teams t ORDER BY t.created_at`
    )
    .all() as { id: string; name: string; internal: number; test: number; email: string | null }[]

  const teams: FinanceTeamRow[] = teamsRows.map((t) => {
    const mv = moves.get(t.id) ?? { offered: 0, bought: 0, spent: 0 }
    const all = movesAll.get(t.id) ?? { offered: 0, bought: 0, spent: 0 }
    const mine = facts.filter((f) => f.teamId === t.id)
    const usd = mine.reduce((s, f) => s + f.usd, 0)
    const costEurCents = usd * 100 * fx.eurPerUsd
    const rev = revenue.get(t.id) ?? 0
    const v = videos.get(t.id) ?? { videos: 0, minutes: 0 }
    return {
      teamId: t.id,
      teamName: t.name,
      ownerEmail: t.email,
      internal: t.internal === 1,
      test: t.test === 1,
      creditsOffered: mv.offered,
      creditsBought: mv.bought,
      creditsSpent: mv.spent,
      balance: cloud.wallet.state(t.id).balance,
      offeredLeft: Math.max(0, all.offered - all.spent),
      jobs: mine.filter((f) => f.state === 'succeeded').length,
      costUsdCents: round2(usd * 100),
      costEurCents: round2(costEurCents),
      revenueEurCents: rev,
      marginEurCents: round2(rev - costEurCents),
      videos: v.videos,
      minutes: round2(v.minutes),
      costPerMinuteEurCents: v.minutes > 0 ? round2(costEurCents / v.minutes) : null
    }
  })

  const totals: FinanceTotals = teams.reduce<FinanceTotals>(
    (s, t) => ({
      creditsOffered: s.creditsOffered + t.creditsOffered,
      creditsBought: s.creditsBought + t.creditsBought,
      creditsSpent: s.creditsSpent + t.creditsSpent,
      balance: s.balance + t.balance,
      offeredLeft: s.offeredLeft + t.offeredLeft,
      jobs: s.jobs + t.jobs,
      costUsdCents: round2(s.costUsdCents + t.costUsdCents),
      costEurCents: round2(s.costEurCents + t.costEurCents),
      revenueEurCents: s.revenueEurCents + t.revenueEurCents,
      marginEurCents: round2(s.marginEurCents + t.marginEurCents),
      videos: s.videos + t.videos,
      minutes: round2(s.minutes + t.minutes),
      costPerMinuteEurCents: null
    }),
    { creditsOffered: 0, creditsBought: 0, creditsSpent: 0, balance: 0, offeredLeft: 0, jobs: 0, costUsdCents: 0, costEurCents: 0, revenueEurCents: 0, marginEurCents: 0, videos: 0, minutes: 0, costPerMinuteEurCents: null }
  )
  totals.costPerMinuteEurCents = totals.minutes > 0 ? round2(totals.costEurCents / totals.minutes) : null

  // This calendar month and all time, for the top line and the overall result.
  const monthFacts = jobFacts(cloud, monthFrom).filter(counted)
  const monthUsd = monthFacts.reduce((s, f) => s + f.usd, 0)
  const monthSpent = [...walletMoves(cloud, monthFrom).values()].reduce((s, m) => s + m.spent, 0)
  const monthRevenue = [...revenueByTeam(cloud, monthFrom).values()].reduce((s, v) => s + v, 0)
  const monthMinutes = sumVideos(videosByTeam(cloud, monthFrom, p.includeDemo)).minutes
  const ever = jobFacts(cloud, null).filter(counted)
  const everUsd = ever.reduce((s, f) => s + f.usd, 0)
  const everCredits = ever.reduce((s, f) => s + f.credits, 0)
  const everMinutes = sumVideos(videosByTeam(cloud, null, p.includeDemo)).minutes
  const everRevenue = [...revenueByTeam(cloud, null).values()].reduce((s, v) => s + v, 0)

  // What one credit costs us: 1 ÷ the multiplier at a fixed multiplier, else what the calls so far show.
  const everCostEur = everUsd * fx.eurPerUsd
  const markup = multiplier ?? (everCostEur > 0 && everCredits > 0 ? (everCredits * creditValueEur) / everCostEur : 1)
  const offeredLeft = teams.reduce((s, t) => s + t.offeredLeft, 0)

  const costs = fixedCosts(cloud, fx.eurPerUsd)
  const fixedEurCents = round2(costs.filter((c) => !c.demo || p.includeDemo).reduce((s, c) => s + c.monthlyEurCents, 0))
  const monthCostEurCents = monthUsd * 100 * fx.eurPerUsd
  const costPerMinute = everMinutes > 0 ? (everCostEur * 100) / everMinutes : null
  const marginPerMinute =
    costPerMinute === null ? null : multiplier !== null ? costPerMinute * (multiplier - 1) : (everRevenue - everCostEur * 100) / everMinutes
  const breakEven = (perMinute: number | null): number | null => (perMinute !== null && perMinute > 0 ? Math.ceil(fixedEurCents / perMinute) : null)
  const overruns = alerts(cloud, p.includeDemo)

  return {
    period: p.period,
    from,
    to: iso(now),
    includeDemo: p.includeDemo,
    demoCallsHidden: p.includeDemo ? 0 : allFacts.length - facts.length,
    paymentsSimulated: cloud.payments.kind === 'fake',
    settings: { priceMultiplier: multiplier, eurPerUsd: fx.eurPerUsd, fxAsOf: fx.asOf, creditValueEur },
    top: {
      offeredLeftCredits: offeredLeft,
      offeredLeftCostEurCents: round2((offeredLeft * creditValueEur * 100) / markup),
      monthCostUsdCents: round2(monthUsd * 100),
      monthCostEurCents: round2(monthCostEurCents),
      monthCreditsSpent: monthSpent,
      alerts: overruns.count
    },
    teams,
    totals,
    providers: providerRows(facts, fx.eurPerUsd),
    spend: spendSeries(facts, p.period, from, now),
    fixed: {
      costs,
      monthlyEurCents: fixedEurCents,
      month: {
        revenueEurCents: monthRevenue,
        providerCostEurCents: round2(monthCostEurCents),
        fixedEurCents,
        resultEurCents: round2(monthRevenue - monthCostEurCents - fixedEurCents),
        minutes: round2(monthMinutes)
      },
      costPerMinuteEurCents: costPerMinute === null ? null : round2(costPerMinute),
      marginPerMinuteEurCents: marginPerMinute === null ? null : round2(marginPerMinute),
      breakEvenMinutes: breakEven(marginPerMinute),
      breakEvenAt: { multiplier: REFERENCE_MULTIPLIER, minutes: breakEven(costPerMinute === null ? null : costPerMinute * (REFERENCE_MULTIPLIER - 1)) }
    },
    alerts: overruns.list
  }
}
