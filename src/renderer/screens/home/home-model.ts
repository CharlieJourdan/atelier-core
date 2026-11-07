// Pure helpers behind the dashboard: greeting, what is in production, the week strip, the KPI figures and the
// sparklines. No React, no clock of its own (callers pass `now`), so the unit tests can pin everything.
import type { ProtoChannel, ProtoVideo, VideoStatus } from '@/proto/types'
import type { Scope } from '@/proto/store'

export type Daypart = 'morning' | 'afternoon' | 'evening'

export function daypart(now: Date): Daypart {
  const h = now.getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  return 'evening'
}

const ACTIVE: readonly VideoStatus[] = ['running', 'waiting', 'blocked', 'queued']

export function channelsInScope(channels: ProtoChannel[], scope: Scope): ProtoChannel[] {
  return scope === 'all' ? channels : channels.filter((c) => c.id === scope)
}

/** Videos still being made, the ones publishing first at the top (unscheduled last). */
export function productionVideos(videos: ProtoVideo[], scope: Scope): ProtoVideo[] {
  return videos
    .filter((v) => ACTIVE.includes(v.status) && (scope === 'all' || v.channelId === scope))
    .sort((a, b) => {
      const da = a.publishInDays ?? 999
      const db = b.publishInDays ?? 999
      if (da !== db) return da - db
      return a.publishTime.localeCompare(b.publishTime)
    })
}

export function runningCount(videos: ProtoVideo[]): number {
  return videos.filter((v) => v.status === 'running').length
}

/* ---------- week strip ---------- */

export interface WeekDay {
  offset: number
  /** One entry per video, in channel order, so equal colours sit together. */
  dots: { videoId: string; channelId: string | null }[]
}

export function weekStrip(videos: ProtoVideo[], scope: Scope, days = 7): WeekDay[] {
  const upcoming = videos.filter((v) => v.stage !== 'published' && v.publishInDays !== null && (scope === 'all' || v.channelId === scope))
  return Array.from({ length: days }, (_, offset) => ({
    offset,
    dots: upcoming
      .filter((v) => v.publishInDays === offset)
      .sort((a, b) => (a.channelId ?? '').localeCompare(b.channelId ?? '') || a.publishTime.localeCompare(b.publishTime))
      .map((v) => ({ videoId: v.id, channelId: v.channelId }))
  }))
}

/* ---------- KPIs ---------- */

export interface Kpis {
  views: number
  revenue: number
  subscribers: number
  published: number
  trendViews: number
  trendRevenue: number
  trendSubscribers: number
}

/** « 3 vidéos par semaine » → 12 over 28 days, « 3 shorts par jour » → 84. */
export function publishedIn28d(channel: ProtoChannel, videos: ProtoVideo[]): number {
  const m = /(\d+)\s+\S+\s+par\s+(jour|semaine)/i.exec(channel.cadence)
  if (m) return Number(m[1]) * (m[2]?.toLowerCase() === 'jour' ? 28 : 4)
  return videos.filter((v) => v.channelId === channel.id && v.stage === 'published' && (v.publishInDays ?? 0) >= -28).length
}

/** Sums over the channels with YouTube Analytics connected; null when none is. */
export function kpisOf(channels: ProtoChannel[], videos: ProtoVideo[]): Kpis | null {
  const connected = channels.filter((c) => c.connected)
  if (connected.length === 0) return null
  const views = connected.reduce((n, c) => n + c.views28d, 0)
  const revenue = connected.reduce((n, c) => n + c.revenue28d, 0)
  const subscribers = connected.reduce((n, c) => n + c.subscribers, 0)
  const weighted = (pick: (c: ProtoChannel) => number, weight: (c: ProtoChannel) => number): number => {
    const total = connected.reduce((n, c) => n + weight(c), 0)
    return total === 0 ? 0 : connected.reduce((n, c) => n + pick(c) * weight(c), 0) / total
  }
  const trendViews = Math.round(weighted((c) => c.trend, (c) => c.views28d))
  return {
    views,
    revenue,
    subscribers,
    published: connected.reduce((n, c) => n + publishedIn28d(c, videos), 0),
    trendViews,
    trendRevenue: Math.round(weighted((c) => c.trend * 0.7, (c) => c.revenue28d)),
    trendSubscribers: Math.max(1, Math.round(weighted((c) => Math.abs(c.trend) / 4 + 1, (c) => c.subscribers)))
  }
}

/* ---------- sparklines ---------- */

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

/** A believable 14-day curve ending where the trend says it should (deterministic per seed). */
export function sparkSeries(seed: string, trend: number, n = 14): number[] {
  const p = hash(seed) * 6.28
  return Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1)
    return 100 + trend * 1.1 * x + 7 * Math.sin(i * 1.3 + p) + 4 * Math.sin(i * 0.55 + p * 2)
  })
}

export function sparkPath(values: number[], w = 100, h = 24, pad = 2): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = pad + (1 - (v - min) / span) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}
