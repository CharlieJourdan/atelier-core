// Monétisation overview: gathers the facts (revenues, spend ledger, engine credits, published videos) and feeds the pure
// P&L of src/shared/money.ts. The engine's `video_runs` table is created by another lot: when it is not there (or has
// another shape) the engine cost is simply 0. Demo runs (demo = 1) and example runs (example = 1) never count.
import type { MoneyChannel, MoneyOverview, WeekPoint } from '../../shared/api/money'
import {
  DEFAULT_USD_TO_EUR,
  CENTS_PER_CREDIT,
  computePnl,
  lastMonths,
  lastWeeks,
  monthOf,
  revenueCounts,
  totalsFor,
  usdToEurCents,
  weekStart,
  type PnlRevenue
} from '../../shared/money'
import type { Db } from '../db'
import type { SettingsStore } from '../settings'

export const RATE_KEY = 'money.usdToEur'

export function readRate(settings: SettingsStore): number {
  const v = settings.get<number>(RATE_KEY, DEFAULT_USD_TO_EUR)
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_TO_EUR
}

interface Facts {
  channels: MoneyChannel[]
  revenues: PnlRevenue[]
  ledger: { channelId: number | null; at: string; usd: number }[]
  credits: { channelId: number | null; at: string; credits: number }[]
  published: { channelId: number | null; at: string }[]
}

function hasTable(db: Db, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
}

/** Credits spent by real engine runs. Defensive: no table, or an unexpected shape, means 0. */
export function readCredits(db: Db, sinceIso: string): Facts['credits'] {
  if (!hasTable(db, 'video_runs')) return []
  try {
    // example runs (example = 1) are seeded figures, never real spend; an older shape without the column has none
    const cols = db.prepare('PRAGMA table_info(video_runs)').all() as { name: string }[]
    const real = cols.some((c) => c.name === 'example') ? ' AND example = 0' : ''
    const rows = db
      .prepare(`SELECT channel_id, finished_at AS at, spent_credits AS credits FROM video_runs WHERE demo = 0${real} AND finished_at IS NOT NULL AND finished_at >= ?`)
      .all(sinceIso) as { channel_id: number | null; at: string; credits: number | null }[]
    return rows.map((r) => ({ channelId: r.channel_id, at: r.at, credits: r.credits ?? 0 }))
  } catch {
    return []
  }
}

function loadFacts(db: Db, sinceDate: string): Facts {
  const channels = (db.prepare('SELECT id, name, example FROM channels WHERE archived_at IS NULL ORDER BY id').all() as { id: number; name: string; example: number }[]).map(
    (c) => ({ id: c.id, name: c.name, example: c.example === 1 })
  )
  const revenues = (
    db.prepare('SELECT date, channel_id, type, amount_cents, currency, source FROM revenues WHERE date >= ?').all(sinceDate) as {
      date: string
      channel_id: number | null
      type: PnlRevenue['type']
      amount_cents: number
      currency: PnlRevenue['currency']
      source: PnlRevenue['source']
    }[]
  ).map((r) => ({ date: r.date, channelId: r.channel_id, type: r.type, amountCents: r.amount_cents, currency: r.currency, source: r.source }))
  const ledger = (
    db
      .prepare(
        `SELECT channel_id, created_at AS at, amount_usd AS usd FROM ledger WHERE status IN ('settled','adjustment') AND created_at >= ?`
      )
      .all(sinceDate) as { channel_id: number | null; at: string; usd: number }[]
  ).map((r) => ({ channelId: r.channel_id, at: r.at, usd: r.usd }))
  const published = (
    db.prepare("SELECT channel_id, updated_at AS at FROM videos WHERE status = 'published' AND updated_at >= ?").all(sinceDate) as { channel_id: number; at: string }[]
  ).map((r) => ({ channelId: r.channel_id, at: r.at }))
  return { channels, revenues, ledger, credits: readCredits(db, sinceDate), published }
}

function group<T extends { channelId: number | null }>(rows: readonly T[], at: (r: T) => string, value: (r: T) => number) {
  const m = new Map<string, { channelId: number | null; month: string; total: number }>()
  for (const r of rows) {
    const month = monthOf(at(r))
    const key = `${r.channelId}|${month}`
    const cur = m.get(key) ?? { channelId: r.channelId, month, total: 0 }
    cur.total += value(r)
    m.set(key, cur)
  }
  return [...m.values()]
}

export function buildOverview(db: Db, settings: SettingsStore, now: Date): MoneyOverview {
  const months = lastMonths(now, 6)
  const weeks = lastWeeks(now, 8)
  const since = `${months[0]}-01`
  const sinceAll = weeks[0]! < since ? weeks[0]! : since
  const usdToEur = readRate(settings)
  const f = loadFacts(db, sinceAll)
  const pnl = computePnl({
    months,
    channels: f.channels,
    revenues: f.revenues,
    aiUsd: group(f.ledger, (r) => r.at, (r) => r.usd).map((g) => ({ channelId: g.channelId, month: g.month, usd: g.total })),
    credits: group(f.credits, (r) => r.at, (r) => r.credits).map((g) => ({ channelId: g.channelId, month: g.month, credits: g.total })),
    published: group(f.published, (r) => r.at, () => 1).map((g) => ({ channelId: g.channelId, month: g.month, count: g.total })),
    views: null,
    usdToEur
  })
  // Weekly curve: counted revenues against AI + engine costs. REAL channels only; the example channels' weeks are
  // kept apart (`totals.example.weekly`) and drawn as their own badged series.
  const exampleIds = new Set(f.channels.filter((c) => c.example).map((c) => c.id))
  const isEx = (id: number | null): boolean => id !== null && exampleIds.has(id)
  const blank = (): Map<string, WeekPoint> => new Map(weeks.map((w) => [w, { week: w, revenueCents: 0, costCents: 0 }]))
  const real = blank()
  const demo = blank()
  const pick = (id: number | null): Map<string, WeekPoint> => (isEx(id) ? demo : real)
  for (const r of f.revenues) {
    const p = pick(r.channelId).get(weekStart(r.date))
    if (!p || !revenueCounts(r, exampleIds)) continue
    p.revenueCents += r.currency === 'USD' ? usdToEurCents(r.amountCents, usdToEur) : r.amountCents
  }
  for (const l of f.ledger) {
    const p = pick(l.channelId).get(weekStart(l.at))
    if (p) p.costCents += Math.round(l.usd * 100 * usdToEur)
  }
  for (const c of f.credits) {
    const p = pick(c.channelId).get(weekStart(c.at))
    if (p) p.costCents += Math.round(c.credits * CENTS_PER_CREDIT)
  }
  // Only rows with something to show, so a fresh install is an empty state rather than a table of zeros.
  const month = months[months.length - 1]!
  const rows = pnl.filter((r) => r.channelId !== null || r.revenueCents !== 0 || r.costCents !== 0)
  const totals = totalsFor(rows, month)
  if (totals.example) totals.example.weekly = weeks.map((w) => ({ ...demo.get(w)! }))
  return {
    month,
    months,
    channels: f.channels,
    rows,
    totals,
    weekly: weeks.map((w) => real.get(w)!),
    usdToEur,
    viewsKnown: false
  }
}
