// Pure maths behind the new Monétisation screen: revenue and cost per channel over 28 days, the 12-week series, the
// per-video return. No React, no clock: the unit tests pin everything.
import { COMPUTER_EUR, CREDIT_EUR, LEDGER_VIDEOS, SUB_PRICE, VIDEOS_28D, type EntryKind, type LedgerVideo, type MoneyEntry } from '@/proto/data-brain-money'
import type { Scope } from '@/proto/store'
import type { EngineAccount, ProtoChannel, ProtoPipeline } from '@/proto/types'

export interface PnlRow {
  /** null for the « Général » row (expenses tied to no channel). */
  channel: ProtoChannel | null
  videos: number
  adsense: number
  /** True when the channel is not connected to YouTube Analytics: the AdSense figure is an estimate. */
  estimated: boolean
  sponsors: number
  products: number
  /** Affiliate and other revenues (real mode only; 0 in the demo). */
  others: number
  revenue: number
  credits: number
  claude: number
  /** The computer share plus the expenses entered by hand. */
  pc: number
  cost: number
  margin: number
  revPerVideo: number
  costPerVideo: number
}

export interface Kpis {
  revenue: number
  cost: number
  margin: number
  marginPct: number
  costPerVideo: number
  revPerVideo: number
  videos: number
  /** Revenue of the last 4 weeks against the 4 before, in %. */
  trendRevenue: number
}

export interface Ledger {
  rows: PnlRow[]
  total: PnlRow
  kpis: Kpis
  weeks: { revenue: number[]; cost: number[] }
  subsMonthly: number
  anyEstimated: boolean
  /** True when some row has « other » revenue: the table then gets its column (real mode). */
  showOthers?: boolean
}

export interface LedgerInput {
  channels: ProtoChannel[]
  pipelines: ProtoPipeline[]
  accounts: EngineAccount[]
  entries: MoneyEntry[]
  scope: Scope
}

const WITHIN = 28
export const WEEKS = 12

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** 12 weekly values whose last four add up to `total`: older weeks follow the trend, with a little noise. */
export function weeklyShape(seed: string, trend: number, total: number): number[] {
  const g = Math.max(-0.3, Math.min(0.55, trend / 100))
  const p = hash(seed) * 6.28
  const raw = Array.from({ length: WEEKS }, (_, i) => Math.max(0.05, 1 + g * ((i - (WEEKS - 1)) / (WEEKS - 1)) * 1.4 + 0.07 * Math.sin(i * 1.7 + p)))
  const last4 = raw.slice(-4).reduce((a, b) => a + b, 0)
  return raw.map((v) => (v / last4) * total)
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

export function videosOf(channelId: string): number {
  return VIDEOS_28D[channelId] ?? 4
}

export function pipelineOf(channel: ProtoChannel, pipelines: ProtoPipeline[]): ProtoPipeline | undefined {
  return pipelines.find((p) => p.id === channel.pipelineIds[0])
}

function emptyRow(channel: ProtoChannel | null): PnlRow {
  return {
    channel,
    videos: 0,
    adsense: 0,
    estimated: false,
    sponsors: 0,
    products: 0,
    others: 0,
    revenue: 0,
    credits: 0,
    claude: 0,
    pc: 0,
    cost: 0,
    margin: 0,
    revPerVideo: 0,
    costPerVideo: 0
  }
}

function finish(r: PnlRow): PnlRow {
  r.revenue = r.adsense + r.sponsors + r.products + r.others
  r.cost = r.credits + r.claude + r.pc
  r.margin = r.revenue - r.cost
  r.revPerVideo = r.videos > 0 ? r.revenue / r.videos : 0
  r.costPerVideo = r.videos > 0 ? r.cost / r.videos : 0
  return r
}

const REVENUE_COLUMN: Record<EntryKind, 'sponsors' | 'products' | null> = {
  sponsor: 'sponsors',
  collab: 'sponsors',
  product: 'products',
  tool: null,
  freelance: null,
  hardware: null,
  other: null,
  adsense: null,
  affiliate: null
}

export function computeLedger(input: LedgerInput): Ledger {
  const { channels, pipelines, accounts, entries, scope } = input
  const inScope = scope === 'all' ? channels : channels.filter((c) => c.id === scope)
  const subsMonthly = accounts.reduce((a, acc) => a + (SUB_PRICE[acc.id] ?? 0), 0)

  // Subscriptions and the computer are shared by every channel of the workspace, on the work each one asks of the agents.
  const weight = (c: ProtoChannel): number => videosOf(c.id) * (pipelineOf(c, pipelines)?.subscriptionShare ?? 50)
  const totalWeight = channels.reduce((a, c) => a + weight(c), 0) || 1
  const videosAll = channels.reduce((a, c) => a + videosOf(c.id), 0) || 1

  const recent = entries.filter((e) => e.daysAgo <= WITHIN)
  const rows = inScope.map((c) => {
    const r = emptyRow(c)
    r.videos = videosOf(c.id)
    r.adsense = c.revenue28d
    r.estimated = !c.connected
    for (const e of recent.filter((x) => x.channelId === c.id)) {
      if (e.type === 'revenue') {
        const col = REVENUE_COLUMN[e.kind]
        if (col) r[col] += e.amount
      } else r.pc += e.amount
    }
    r.credits = r.videos * (pipelineOf(c, pipelines)?.creditsPerVideo ?? 0) * CREDIT_EUR
    r.claude = (subsMonthly * weight(c)) / totalWeight
    r.pc += (COMPUTER_EUR * r.videos) / videosAll
    return finish(r)
  })

  if (scope === 'all') {
    const general = recent.filter((e) => e.channelId === null && e.type === 'expense')
    const g = emptyRow(null)
    g.pc = general.reduce((a, e) => a + e.amount, 0)
    for (const e of recent.filter((x) => x.channelId === null && x.type === 'revenue')) {
      const col = REVENUE_COLUMN[e.kind]
      if (col) g[col] += e.amount
    }
    if (g.pc > 0 || g.sponsors > 0 || g.products > 0) rows.push(finish(g))
  }

  const total = emptyRow(null)
  for (const r of rows) {
    total.videos += r.videos
    total.adsense += r.adsense
    total.sponsors += r.sponsors
    total.products += r.products
    total.credits += r.credits
    total.claude += r.claude
    total.pc += r.pc
    total.estimated ||= r.estimated
  }
  finish(total)

  // 12 weeks: AdSense follows each channel's trend; costs are steady with the entries added where they happened.
  const revWeeks = Array.from({ length: WEEKS }, () => 0)
  for (const r of rows) {
    if (!r.channel) continue
    weeklyShape(r.channel.id, r.channel.trend, r.adsense).forEach((v, i) => (revWeeks[i] = (revWeeks[i] ?? 0) + v))
  }
  const base =
    total.credits +
    total.claude +
    (total.pc - recent.filter((e) => e.type === 'expense' && (scope === 'all' || inScope.some((c) => c.id === e.channelId))).reduce((a, e) => a + e.amount, 0))
  const costWeeks = weeklyShape(`cost-${scope}`, 4, Math.max(0, base))
  for (const e of entries) {
    const week = WEEKS - 1 - Math.floor(e.daysAgo / 7)
    if (week < 0 || week >= WEEKS) continue
    if (scope !== 'all' && !inScope.some((c) => c.id === e.channelId)) continue
    if (e.type === 'revenue') revWeeks[week] = (revWeeks[week] ?? 0) + e.amount
    else costWeeks[week] = (costWeeks[week] ?? 0) + e.amount
  }

  const prev4 = sum(revWeeks.slice(-8, -4))
  const last4 = sum(revWeeks.slice(-4))
  const kpis: Kpis = {
    revenue: total.revenue,
    cost: total.cost,
    margin: total.margin,
    marginPct: total.revenue > 0 ? (total.margin / total.revenue) * 100 : 0,
    costPerVideo: total.costPerVideo,
    revPerVideo: total.revPerVideo,
    videos: total.videos,
    trendRevenue: prev4 > 0 ? Math.round(((last4 - prev4) / prev4) * 100) : 0
  }
  return { rows, total, kpis, weeks: { revenue: revWeeks, cost: costWeeks }, subsMonthly, anyEstimated: rows.some((r) => r.estimated) }
}

export interface VideoReturn {
  video: LedgerVideo
  channel: ProtoChannel | undefined
  costCredits: number
  costEuro: number
  revenue: number
  estimated: boolean
  /** Revenue divided by cost. */
  roi: number
  /** False in real mode: the views of a video are unknown, so its revenue and return are not shown. */
  known?: boolean
}

/** The last ten videos with what they cost and what they bring (views × the channel's revenue per view). */
export function videoReturns(channels: ProtoChannel[], scope: Scope): VideoReturn[] {
  return LEDGER_VIDEOS.filter((v) => scope === 'all' || v.channelId === scope)
    .map((video) => {
      const channel = channels.find((c) => c.id === video.channelId)
      const perView = channel && channel.views28d > 0 ? channel.revenue28d / channel.views28d : 0
      const costEuro = video.credits * CREDIT_EUR
      const revenue = video.views * perView
      return { video, channel, costCredits: video.credits, costEuro, revenue, estimated: !channel?.connected, roi: costEuro > 0 ? revenue / costEuro : 0 }
    })
    .sort((a, b) => a.video.daysAgo - b.video.daysAgo)
}

/** « ×130 » (whole numbers from 10 up, one decimal below). */
export function fmtRoi(roi: number): string {
  return `×${roi >= 10 ? Math.round(roi).toLocaleString('fr-FR') : roi.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`
}

export function fmtEuro2(n: number): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

/** Euros: whole above 100, two decimals below, so a video that costs 0,10 € does not read as 0 €. */
export function fmtEuroSmart(n: number): string {
  return Math.abs(n) >= 100 ? `${Math.round(n).toLocaleString('fr-FR')} €` : fmtEuro2(n)
}
