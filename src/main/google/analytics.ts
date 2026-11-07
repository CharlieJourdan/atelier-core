// What the owner's channels say, read with his Google token: the YouTube Data API v3 `channels.list?mine=true` (which
// channels the account owns, their public counts) and the YouTube Analytics API v2 `reports.query` (views, minutes
// watched, subscribers gained and lost, estimated revenue, one row per day). Read-only. Pure parsing plus the figures
// the screens need (last 28 days, the 28 before, this month); the HTTP and the token are the caller's (`Get`).
import { GoogleError } from './oauth'

export const DATA_API = 'https://www.googleapis.com/youtube/v3'
export const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports'

/** One authenticated GET (the service adds the token, refreshes it on a 401 and retries once). */
export type Get = (url: string) => Promise<{ status: number; json: unknown }>

export interface YtChannel {
  id: string
  title: string
  handle: string | null
  subscribers: number | null
  totalViews: number | null
}

export interface DayRow {
  day: string
  views: number
  watchMinutes: number
  subsGained: number
  subsLost: number
  revenueEur: number | null
}

const QUOTA_REASONS = new Set(['quotaExceeded', 'rateLimitExceeded', 'dailyLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED'])

interface GoogleApiErrorBody {
  error?: { code?: number; status?: string; message?: string; errors?: { reason?: string }[] }
}

/** Google's error answer → our code: quota, a token Google no longer takes (401), not allowed (403), or anything else. */
export function apiError(status: number, json: unknown): GoogleError {
  const body = (json ?? {}) as GoogleApiErrorBody
  const reasons = [...(body.error?.errors ?? []).map((e) => e.reason ?? ''), body.error?.status ?? '']
  if (status === 429 || reasons.some((r) => QUOTA_REASONS.has(r))) return new GoogleError('quota', status)
  if (status === 401) return new GoogleError('reconnect', status)
  if (status === 403) return new GoogleError('forbidden', status)
  return new GoogleError('answer', status)
}

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

const normaliseHandle = (h: unknown): string | null => {
  if (typeof h !== 'string' || !h.trim()) return null
  const s = h.trim()
  return s.startsWith('@') ? s : `@${s}`
}

/** The channels of the signed-in account (`mine=true`). */
export async function listMyChannels(get: Get): Promise<YtChannel[]> {
  const { status, json } = await get(`${DATA_API}/channels?part=snippet,statistics&mine=true&maxResults=50`)
  if (status !== 200) throw apiError(status, json)
  const items = (json as { items?: unknown[] }).items
  if (items !== undefined && !Array.isArray(items)) throw new GoogleError('answer')
  const out: YtChannel[] = []
  for (const raw of items ?? []) {
    const it = raw as { id?: unknown; snippet?: { title?: unknown; customUrl?: unknown }; statistics?: { subscriberCount?: unknown; hiddenSubscriberCount?: unknown; viewCount?: unknown } }
    if (typeof it.id !== 'string' || !/^[\w-]{3,64}$/.test(it.id)) continue
    out.push({
      id: it.id,
      title: typeof it.snippet?.title === 'string' ? it.snippet.title.slice(0, 200) : '',
      handle: normaliseHandle(it.snippet?.customUrl),
      subscribers: it.statistics?.hiddenSubscriberCount === true ? null : int(it.statistics?.subscriberCount),
      totalViews: int(it.statistics?.viewCount)
    })
  }
  return out
}

const BASE_METRICS = ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost'] as const

function reportUrl(ids: string, startDate: string, endDate: string, revenue: boolean): string {
  const q = new URLSearchParams({
    ids,
    startDate,
    endDate,
    metrics: [...BASE_METRICS, ...(revenue ? ['estimatedRevenue'] : [])].join(','),
    dimensions: 'day',
    sort: 'day',
    currency: 'EUR'
  })
  return `${ANALYTICS_API}?${q.toString()}`
}

function parseReport(json: unknown, revenue: boolean): DayRow[] {
  const r = json as { columnHeaders?: { name?: unknown }[]; rows?: unknown[][] }
  if (!Array.isArray(r.columnHeaders)) throw new GoogleError('answer')
  const col = new Map(r.columnHeaders.map((h, i) => [String(h.name ?? ''), i]))
  const at = (row: unknown[], name: string): unknown => {
    const i = col.get(name)
    return i === undefined ? undefined : row[i]
  }
  const out: DayRow[] = []
  for (const row of r.rows ?? []) {
    if (!Array.isArray(row)) continue
    const day = at(row, 'day')
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const money = revenue ? at(row, 'estimatedRevenue') : undefined
    out.push({
      day,
      views: int(at(row, 'views')) ?? 0,
      watchMinutes: int(at(row, 'estimatedMinutesWatched')) ?? 0,
      subsGained: int(at(row, 'subscribersGained')) ?? 0,
      subsLost: int(at(row, 'subscribersLost')) ?? 0,
      revenueEur: typeof money === 'number' && Number.isFinite(money) ? Math.round(money * 100) / 100 : null
    })
  }
  return out
}

/**
 * The daily figures of one channel. `ids` is `channel==MINE` (the account's channel) or `channel==<id>` (another
 * channel the account owns). Estimated revenue is asked for first; a 403 on it (a channel outside the Partner Program, a
 * grant without the monetary scope) is retried without it, so views still come. Quota errors are never retried.
 */
export async function channelDays(get: Get, p: { ids: string; startDate: string; endDate: string }): Promise<{ rows: DayRow[]; revenue: boolean }> {
  const first = await get(reportUrl(p.ids, p.startDate, p.endDate, true))
  if (first.status === 200) return { rows: parseReport(first.json, true), revenue: true }
  const err = apiError(first.status, first.json)
  if (err.code !== 'forbidden') throw err
  const second = await get(reportUrl(p.ids, p.startDate, p.endDate, false))
  if (second.status !== 200) throw apiError(second.status, second.json)
  return { rows: parseReport(second.json, false), revenue: false }
}

/* ---------- dates and the figures the screens show ---------- */

const DAY_MS = 86_400_000
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** The window asked to Analytics: the 56 last days (28 + the 28 before) and the whole current month. */
export function reportWindow(now: number): { startDate: string; endDate: string; today: string } {
  const today = isoDay(now)
  const back = isoDay(now - 55 * DAY_MS)
  const monthStart = `${today.slice(0, 7)}-01`
  return { startDate: back < monthStart ? back : monthStart, endDate: today, today }
}

export interface Summary {
  views28d: number
  watchMinutes28d: number
  subscribersNet28d: number
  revenue28dEur: number | null
  viewsPrev28d: number
  trendPct: number | null
  month: string
  monthViews: number
  monthWatchMinutes: number
  monthRevenueEur: number | null
}

const sumOf = (rows: DayRow[], f: (r: DayRow) => number): number => rows.reduce((a, r) => a + f(r), 0)
const moneyOf = (rows: DayRow[], known: boolean): number | null => {
  if (!known) return null
  return Math.round(rows.reduce((a, r) => a + (r.revenueEur ?? 0), 0) * 100) / 100
}

/** Last 28 days (today included), the 28 before, this calendar month. Revenue is null when Google never gave any. */
export function summarise(days: readonly DayRow[], now: number, revenueKnown: boolean): Summary {
  const today = isoDay(now)
  const from28 = isoDay(now - 27 * DAY_MS)
  const from56 = isoDay(now - 55 * DAY_MS)
  const month = today.slice(0, 7)
  const last = days.filter((d) => d.day >= from28 && d.day <= today)
  const prev = days.filter((d) => d.day >= from56 && d.day < from28)
  const inMonth = days.filter((d) => d.day.startsWith(month) && d.day <= today)
  const views28d = sumOf(last, (r) => r.views)
  const viewsPrev28d = sumOf(prev, (r) => r.views)
  return {
    views28d,
    watchMinutes28d: sumOf(last, (r) => r.watchMinutes),
    subscribersNet28d: sumOf(last, (r) => r.subsGained - r.subsLost),
    revenue28dEur: moneyOf(last, revenueKnown),
    viewsPrev28d,
    trendPct: viewsPrev28d > 0 ? Math.round(((views28d - viewsPrev28d) / viewsPrev28d) * 100) : null,
    month,
    monthViews: sumOf(inMonth, (r) => r.views),
    monthWatchMinutes: sumOf(inMonth, (r) => r.watchMinutes),
    monthRevenueEur: moneyOf(inMonth, revenueKnown)
  }
}

/* ---------- which Atelier channel a YouTube channel feeds (shared with the renderer) ---------- */

export { matchChannel, parseYoutubeRef, type AtelierChannelRef } from '../../shared/youtube-ref'
