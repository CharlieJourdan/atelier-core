// Real mode, Monétisation: the facts the screen reads from the main process (`money.overview`, `spend.overview`,
// the cost of each video, the revenues entered) and the conversions between the screen's « revenue entries » and the
// database's revenue rows. Pure functions, no IPC: unit-tested. Nothing is invented: a figure the backend cannot give
// (views, a revenue per video, expenses entered by hand) is absent, never estimated.
import type { MoneyOverview } from '../../../shared/api/money'
import type { SpendOverview, SpendSummaryRow } from '../../../shared/api/spend'
import { t, type MessageKey } from '../../../shared/fr'
import type { RevenueInput, RevenueRow, RevenueType } from '../../../shared/money'
import { CENTS_PER_CREDIT } from '../../../shared/money'
import type { RunSummary } from '../../../shared/runs'
import type { VideoRow } from '../../../shared/workflow'
import type { EntryKind, MoneyEntry } from '../data-brain-money'
import { channelKey } from './mapping'
import { channelIdOf } from './mapping-brain'
import type { LiveGoogle } from './mapping-google'

/** What a video cost: the model calls of the spend ledger plus the credits of its real production runs. */
export interface LiveVideoCost {
  videoId: number
  title: string
  /** `db-<id>`, or null when the video is gone. */
  channelId: string | null
  usd: number
  credits: number
}

/** The money side of a live snapshot. */
export interface LiveMoney {
  overview: MoneyOverview
  /** The spend ledger of the month. */
  spend: SpendOverview
  videoCosts: LiveVideoCost[]
  /** Revenues entered (manual or CSV), example rows left out. */
  revenues: RevenueRow[]
  /** Monthly price in euros the user typed for each AI account (`acc-live-<id>`): the subscriptions « as configured ». */
  subscriptions: Record<string, number>
  /** The owner's YouTube figures through Google (absent when they could not be read; `connected: false` before Google). */
  google?: LiveGoogle
}

/** Where the typed subscription prices live (`settings.set`): `{ "<account id>": euros }`. */
export const SUBSCRIPTIONS_SETTING = 'money.subscriptions'

export const accountKey = (id: number): string => `acc-live-${id}`

/** The setting's value as prices by screen account id; anything that is not a price ≥ 0 is ignored. */
export function mapSubscriptions(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (/^\d+$/.test(id) && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[accountKey(Number(id))] = v
  }
  return out
}

/** Prices by screen account id → the setting's value (account ids as keys). */
export function subscriptionsSetting(prices: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, v] of Object.entries(prices)) {
    const m = /^acc-live-(\d+)$/.exec(key)
    if (m && Number.isFinite(v) && v >= 0) out[m[1]!] = v
  }
  return out
}

/**
 * Cost of each video: ledger spend of the month by video (`spend.summary('video')`) joined with the credits really
 * spent by its runs (demo and example runs debit nothing). Newest video first.
 */
export function mapVideoCosts(
  summary: readonly SpendSummaryRow[],
  runs: readonly Pick<RunSummary, 'videoId' | 'spentCredits' | 'demo' | 'example'>[],
  videos: readonly Pick<VideoRow, 'id' | 'title' | 'channelId'>[]
): LiveVideoCost[] {
  const usd = new Map<number, number>()
  for (const r of summary) {
    const id = Number(r.key)
    if (r.key !== '' && Number.isInteger(id)) usd.set(id, (usd.get(id) ?? 0) + r.spentUsd)
  }
  const credits = new Map<number, number>()
  for (const r of runs) if (!r.demo && !r.example) credits.set(r.videoId, (credits.get(r.videoId) ?? 0) + r.spentCredits)
  const ids = new Set([...usd.keys(), ...credits.keys()])
  const out: LiveVideoCost[] = []
  for (const id of ids) {
    const video = videos.find((v) => v.id === id)
    const u = usd.get(id) ?? 0
    const c = credits.get(id) ?? 0
    if (!video || (u <= 0 && c <= 0)) continue
    out.push({ videoId: id, title: video.title, channelId: channelKey(video.channelId), usd: u, credits: c })
  }
  return out.sort((a, b) => b.videoId - a.videoId)
}

/** Euros of a video's cost: model calls at the typed rate, credits at one cent each. */
export function videoCostEur(c: Pick<LiveVideoCost, 'usd' | 'credits'>, usdToEur: number): number {
  return c.usd * usdToEur + (c.credits * CENTS_PER_CREDIT) / 100
}

/* ---------- revenue entries ---------- */

const KIND_OF_TYPE: Record<RevenueType, EntryKind> = { adsense: 'adsense', sponsor: 'sponsor', product: 'product', affiliate: 'affiliate', other: 'other' }
const TYPE_OF_KIND: Partial<Record<EntryKind, RevenueType>> = {
  adsense: 'adsense',
  sponsor: 'sponsor',
  collab: 'sponsor',
  product: 'product',
  affiliate: 'affiliate',
  other: 'other'
}

/** The kinds the form offers for a revenue in real mode (one per revenue type of the database). */
export const LIVE_REVENUE_KINDS: readonly EntryKind[] = ['sponsor', 'product', 'affiliate', 'adsense', 'other']

const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function daysBetween(date: string, now: Date): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return 0
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.max(0, Math.round((a - new Date(y, m - 1, d).getTime()) / 86_400_000))
}

/** A revenue row of the database as an entry of the list (amounts in euros; USD at the typed rate). */
export function entryOfRevenue(r: RevenueRow, usdToEur: number, now: Date): MoneyEntry {
  const kind = KIND_OF_TYPE[r.type]
  return {
    id: `rev-${r.id}`,
    type: 'revenue',
    kind,
    label: r.note.trim() || t(`money2.kind.${kind}` as MessageKey),
    channelId: r.channelId === null ? null : channelKey(r.channelId),
    amount: (r.currency === 'USD' ? r.amountCents * usdToEur : r.amountCents) / 100,
    daysAgo: daysBetween(r.date, now)
  }
}

export function entriesOfRevenues(rows: readonly RevenueRow[], usdToEur: number, now: Date): MoneyEntry[] {
  return rows
    .filter((r) => r.source !== 'example' && !r.example)
    .map((r) => entryOfRevenue(r, usdToEur, now))
    .sort((a, b) => a.daysAgo - b.daysAgo)
}

/** The database id behind an entry (`rev-7` → 7), or null. */
export function revenueIdOf(entryId: string): number | null {
  const m = /^rev-(\d+)$/.exec(entryId)
  return m ? Number(m[1]) : null
}

/** What the « Ajouter un revenu » form sends to `money.revenues.save`: euros, on the chosen day. */
export function revenueInputOf(entry: Omit<MoneyEntry, 'id'>, now: Date): RevenueInput {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - entry.daysAgo)
  return {
    date: isoDay(day),
    channelId: entry.channelId === null ? null : channelIdOf(entry.channelId),
    type: TYPE_OF_KIND[entry.kind] ?? 'other',
    amountCents: Math.round(entry.amount * 100),
    currency: 'EUR',
    note: entry.label
  }
}
