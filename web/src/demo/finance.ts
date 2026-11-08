// Demo fixtures of « Coûts et rentabilité »: an invented finance dashboard per period, built from the demo teams, plus the
// settings and fixed costs the page edits (kept in memory).
import type { FinanceDashboard, FinanceFixedCost, FinancePeriod, FinanceProviderRow, FinanceSettings, FinanceTeamRow, FinanceTotals } from '../admin/finance'
import { demoTeams } from './crm'

const settings: FinanceSettings = { priceMultiplier: null, eurPerUsd: 0.92, fxAsOf: '2026-11-01', creditValueEur: 0.01 }

const fixed: FinanceFixedCost[] = [
  { id: 'fx_demo1', label: 'Hébergement Atelier Cloud', amountCents: 4_900, currency: 'EUR', note: 'Serveur et sauvegardes', monthlyEurCents: 4_900, auto: false, demo: true },
  { id: 'fx_demo2', label: 'Stockage des rendus', amountCents: 2_300, currency: 'USD', note: null, monthlyEurCents: 2_116, auto: false, demo: true },
  { id: 'fx_demo3', label: 'Ordinateurs d’équipe (location)', amountCents: 18_600, currency: 'EUR', note: 'Calculé à partir des machines en marche', monthlyEurCents: 18_600, auto: true, demo: true }
]

const SCALE: Record<FinancePeriod, number> = { day: 1 / 30, week: 7 / 30, month: 1, all: 4.2 }

const PROVIDERS: { provider: string; engine: string | null; share: number; demo: boolean }[] = [
  { provider: 'minimax', engine: 'speech-2.8-hd', share: 0.24, demo: false },
  { provider: 'fal', engine: 'nano-banana', share: 0.3, demo: false },
  { provider: 'google', engine: 'gemini-3.1-flash-lite', share: 0.12, demo: false },
  { provider: 'anthropic', engine: 'claude-sonnet-5-5', share: 0.1, demo: false },
  { provider: 'heygen', engine: 'avatar', share: 0.13, demo: false },
  { provider: 'pexels', engine: null, share: 0, demo: false },
  { provider: 'fake', engine: 'démo', share: 0.11, demo: true }
]

const round = (n: number): number => Math.round(n)

function teamRows(scale: number): FinanceTeamRow[] {
  return demoTeams().map((t) => {
    const spent = round(t.spent * scale)
    const costUsd = round(spent * 0.62)
    const costEur = round(costUsd * settings.eurPerUsd)
    const revenue = round(spent * settings.creditValueEur * 100)
    const minutes = Math.round(spent / 55) / 10
    const offered = round(500 * Math.min(1, scale))
    return {
      teamId: t.id,
      teamName: t.name,
      ownerEmail: t.owner,
      internal: t.internal,
      ...(t.test ? { test: true } : {}),
      creditsOffered: offered,
      creditsBought: t.plan ? round(spent * 1.3) : 0,
      creditsSpent: spent,
      balance: round(spent * 2.4),
      offeredLeft: t.plan ? 0 : offered,
      jobs: round(spent / 40),
      costUsdCents: costUsd,
      costEurCents: costEur,
      revenueEurCents: revenue,
      marginEurCents: revenue - costEur,
      videos: round(spent / 450),
      minutes,
      costPerMinuteEurCents: minutes > 0 ? round(costEur / minutes) : null
    }
  })
}

function totals(rows: FinanceTeamRow[]): FinanceTotals {
  const sum = (k: keyof FinanceTotals): number => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
  const minutes = Math.round(sum('minutes') * 10) / 10
  const costEur = sum('costEurCents')
  return {
    creditsOffered: sum('creditsOffered'),
    creditsBought: sum('creditsBought'),
    creditsSpent: sum('creditsSpent'),
    balance: sum('balance'),
    offeredLeft: sum('offeredLeft'),
    jobs: sum('jobs'),
    costUsdCents: sum('costUsdCents'),
    costEurCents: costEur,
    revenueEurCents: sum('revenueEurCents'),
    marginEurCents: sum('marginEurCents'),
    videos: sum('videos'),
    minutes,
    costPerMinuteEurCents: minutes > 0 ? round(costEur / minutes) : null
  }
}

function spendBuckets(period: FinancePeriod, totalUsd: number, credits: number): FinanceDashboard['spend'] {
  const now = new Date()
  const iso = (d: Date): string => d.toISOString()
  const count = period === 'day' ? 24 : period === 'week' ? 7 : period === 'month' ? 30 : 6
  const out: FinanceDashboard['spend'] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    let bucket: string
    if (period === 'day') {
      d.setHours(now.getHours() - i)
      bucket = iso(d).slice(0, 13)
    } else if (period === 'all') {
      d.setMonth(now.getMonth() - i, 1)
      bucket = iso(d).slice(0, 7)
    } else {
      d.setDate(now.getDate() - i)
      bucket = iso(d).slice(0, 10)
    }
    const wave = 0.6 + 0.4 * Math.abs(Math.sin((count - i) * 1.7))
    out.push({ bucket, costUsdCents: round((totalUsd / count) * wave), credits: round((credits / count) * wave) })
  }
  return out
}

function providerRows(totalUsd: number, includeDemo: boolean): FinanceProviderRow[] {
  return PROVIDERS.filter((p) => includeDemo || !p.demo).map((p) => {
    const usd = round(totalUsd * p.share)
    const calls = p.provider === 'pexels' ? 140 : Math.max(1, round(usd / 9))
    return {
      provider: p.provider,
      engine: p.engine,
      demo: p.demo,
      calls,
      succeeded: Math.max(0, calls - Math.ceil(calls * 0.03)),
      failed: Math.ceil(calls * 0.02),
      cancelled: Math.ceil(calls * 0.01),
      creditsBilled: round(usd * 1.6),
      costUsdCents: usd,
      costEurCents: round(usd * settings.eurPerUsd),
      estimated: p.provider === 'heygen' ? Math.ceil(calls * 0.2) : 0
    }
  })
}

export function financeDashboard(params: URLSearchParams): FinanceDashboard {
  const raw = params.get('period')
  const period: FinancePeriod = raw === 'day' || raw === 'week' || raw === 'all' ? raw : 'month'
  const includeDemo = params.get('demo') === '1'
  const scale = SCALE[period]
  const teams = teamRows(scale).filter((t) => includeDemo || !t.test)
  const tot = totals(teams)
  const month = totals(teamRows(1))
  const fixedMonthly = fixed.reduce((n, c) => n + c.monthlyEurCents, 0)
  const marginPerMinute = month.minutes > 0 ? round((month.revenueEurCents - month.costEurCents) / month.minutes) : null
  const breakEven = marginPerMinute && marginPerMinute > 0 ? Math.ceil(fixedMonthly / marginPerMinute) : null
  return {
    period,
    from: period === 'all' ? null : new Date(Date.now() - scale * 30 * 86_400_000).toISOString(),
    to: new Date().toISOString(),
    includeDemo,
    demoCallsHidden: includeDemo ? 0 : 37,
    paymentsSimulated: true,
    settings: { ...settings },
    top: {
      offeredLeftCredits: tot.offeredLeft,
      offeredLeftCostEurCents: round(tot.offeredLeft * 0.4),
      monthCostUsdCents: month.costUsdCents,
      monthCostEurCents: month.costEurCents,
      monthCreditsSpent: month.creditsSpent,
      alerts: 2
    },
    teams,
    totals: tot,
    providers: providerRows(tot.costUsdCents, includeDemo),
    spend: spendBuckets(period, tot.costUsdCents, tot.creditsSpent),
    fixed: {
      costs: fixed.map((c) => ({ ...c })),
      monthlyEurCents: fixedMonthly,
      month: { revenueEurCents: month.revenueEurCents, providerCostEurCents: month.costEurCents, fixedEurCents: fixedMonthly, resultEurCents: month.revenueEurCents - month.costEurCents - fixedMonthly, minutes: month.minutes },
      costPerMinuteEurCents: month.costPerMinuteEurCents,
      marginPerMinuteEurCents: marginPerMinute,
      breakEvenMinutes: breakEven,
      breakEvenAt: { multiplier: settings.priceMultiplier ?? 1.6, minutes: breakEven === null ? null : round(breakEven * 0.8) }
    },
    alerts: [
      { jobId: 'job_demo41', teamName: 'Atelier Nuages', provider: 'heygen', engine: 'avatar', at: new Date(Date.now() - 5 * 3_600_000).toISOString(), quotedUsdCents: 180, realUsdCents: 236, overPct: 31 },
      { jobId: 'job_demo37', teamName: 'Mécanique Facile', provider: 'minimax', engine: 'speech-2.8-hd', at: new Date(Date.now() - 27 * 3_600_000).toISOString(), quotedUsdCents: 42, realUsdCents: 49, overPct: 17 }
    ]
  }
}

export function saveFinanceSettings(body: Record<string, unknown>): FinanceSettings {
  if ('priceMultiplier' in body) settings.priceMultiplier = typeof body.priceMultiplier === 'number' ? body.priceMultiplier : null
  if (typeof body.eurPerUsd === 'number' && body.eurPerUsd > 0) settings.eurPerUsd = body.eurPerUsd
  if (typeof body.fxAsOf === 'string') settings.fxAsOf = body.fxAsOf
  return { ...settings }
}

export function saveFixed(body: Record<string, unknown>): { ok: true; cost: FinanceFixedCost } {
  const currency = body.currency === 'USD' ? 'USD' : 'EUR'
  const amountCents = Math.max(0, Math.round(Number(body.amountCents) || 0))
  const existing = typeof body.id === 'string' ? fixed.find((c) => c.id === body.id) : undefined
  const cost: FinanceFixedCost = {
    id: existing?.id ?? `fx_demo${Date.now().toString(36)}`,
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Coût fixe',
    amountCents,
    currency,
    note: typeof body.note === 'string' && body.note ? body.note : null,
    monthlyEurCents: currency === 'USD' ? round(amountCents * settings.eurPerUsd) : amountCents,
    auto: false,
    demo: true
  }
  if (existing) Object.assign(existing, cost)
  else fixed.push(cost)
  return { ok: true, cost }
}

export function removeFixed(id: string): boolean {
  const i = fixed.findIndex((c) => c.id === id && !c.auto)
  if (i < 0) return false
  fixed.splice(i, 1)
  return true
}
