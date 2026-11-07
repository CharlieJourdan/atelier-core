// Real mode of the Monétisation screen: builds the screen's `Ledger` (the same shape the demo's maths gives) from what
// the main process measured — the P&L of the current month (`money.overview`), the model calls of the spend ledger,
// the subscriptions the user typed. No clock, no React. Never an invented number: the views of a video are unknown,
// so its revenue and its return are left out; expenses have no backend, so only measured costs are counted. With Google
// connected, the AdSense line of each linked channel is YouTube's estimated revenue of the month.
import { channelKey } from '@/proto/live/mapping'
import { videoCostEur, type LiveMoney } from '@/proto/live/mapping-money'
import type { Scope } from '@/proto/store'
import type { EngineAccount, ProtoChannel, ProtoVideo } from '@/proto/types'
import type { Kpis, Ledger, PnlRow, VideoReturn } from './money-model'

export interface LiveLedgerInput {
  money: LiveMoney
  channels: ProtoChannel[]
  accounts: EngineAccount[]
  scope: Scope
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

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

/** Monthly total of the subscriptions the user typed for the accounts he has. */
export function subscriptionsMonthly(accounts: readonly EngineAccount[], prices: Record<string, number>): number {
  return accounts.reduce((a, acc) => a + (prices[acc.id] ?? 0), 0)
}

/**
 * The P&L of the current month: one row per channel (and « Général » for what no channel owns), measured AI usage and
 * credits, the revenues entered, and the subscriptions as typed, shared out by the videos each channel published.
 */
export function liveLedger(input: LiveLedgerInput): Ledger {
  const { money, channels, accounts, scope } = input
  const { overview } = money
  const month = overview.month
  const mine = overview.rows.filter((r) => r.month === month && r.sources.margin !== 'example')
  const subs = subscriptionsMonthly(accounts, money.subscriptions)
  const totalVideos = sum(mine.map((r) => r.publishedVideos))

  const byKey = new Map<string, PnlRow>()
  const rowFor = (channelId: number | null): PnlRow => {
    const channel = channelId === null ? null : (channels.find((c) => c.id === channelKey(channelId)) ?? null)
    const key = channel ? channel.id : 'general'
    let row = byKey.get(key)
    if (!row) byKey.set(key, (row = emptyRow(channel)))
    return row
  }
  for (const r of mine) {
    const row = rowFor(r.channelId)
    row.videos += r.publishedVideos
    row.adsense += r.revenueByType.adsense / 100
    row.sponsors += r.revenueByType.sponsor / 100
    row.products += r.revenueByType.product / 100
    row.others += (r.revenueByType.affiliate + r.revenueByType.other) / 100
    row.credits += r.engineCents / 100
    row.claude += r.aiCents / 100
    row.pc += r.toolsCents / 100
  }
  // AdSense from Google: for each channel it feeds, YouTube's estimated revenue of this month replaces what was typed by
  // hand (never both, so nothing is counted twice). A channel Google gives no revenue for keeps the typed figure.
  for (const g of money.google?.rows ?? []) {
    if (g.channelId === null || g.stat.month !== month || g.stat.monthRevenueEur === null) continue
    rowFor(g.channelId).adsense = g.stat.monthRevenueEur
  }
  // Subscriptions: shared by published videos; with none published yet they stay on the « Général » row.
  if (subs > 0) {
    if (totalVideos > 0) for (const r of mine) rowFor(r.channelId).claude += (subs * r.publishedVideos) / totalVideos
    else rowFor(null).claude += subs
  }
  // « Général » last
  const all = [...byKey.values()].map(finish).sort((a, b) => Number(a.channel === null) - Number(b.channel === null))
  const rows = all.filter((r) => (scope === 'all' ? true : r.channel?.id === scope))
  const total = emptyRow(null)
  for (const r of rows) {
    total.videos += r.videos
    total.adsense += r.adsense
    total.sponsors += r.sponsors
    total.products += r.products
    total.others += r.others
    total.credits += r.credits
    total.claude += r.claude
    total.pc += r.pc
  }
  finish(total)

  // The weekly curve is the workspace's (the backend does not split it by channel).
  const weeks = {
    revenue: overview.weekly.map((w) => w.revenueCents / 100),
    cost: overview.weekly.map((w) => w.costCents / 100)
  }
  const prev4 = sum(weeks.revenue.slice(-8, -4))
  const last4 = sum(weeks.revenue.slice(-4))
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
  return { rows, total, kpis, weeks, subsMonthly: subs, anyEstimated: false, showOthers: rows.some((r) => r.others > 0) }
}

/** The ten newest videos that cost something: what they cost, nothing about what they bring (the views are unknown). */
export function liveVideoReturns(money: LiveMoney, channels: ProtoChannel[], videos: readonly ProtoVideo[], scope: Scope): VideoReturn[] {
  return money.videoCosts
    .filter((c) => scope === 'all' || c.channelId === scope)
    .slice(0, 10)
    .map((c) => {
      const v = videos.find((x) => x.id === `vid-${c.videoId}`)
      const costEuro = videoCostEur(c, money.overview.usdToEur)
      return {
        video: { id: `lv-${c.videoId}`, title: c.title, channelId: c.channelId ?? '', format: v?.format === 'short' ? 'short' : 'long', views: 0, credits: c.credits, daysAgo: 0, thumbHue: v?.thumbHue ?? 0 },
        channel: channels.find((ch) => ch.id === c.channelId),
        costCredits: c.credits,
        costEuro,
        revenue: 0,
        estimated: false,
        roi: 0,
        known: false
      }
    })
}
