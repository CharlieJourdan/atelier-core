// Real mode, the owner's YouTube figures read through Google (`google.channelStats`): which channel of the screens each
// YouTube channel of the account feeds (by the YouTube id or @handle typed in the channel, src/shared/youtube-ref.ts), the
// channel cards' figures, and the Monétisation lines. Pure functions, no IPC: unit-tested. Without Google, nothing changes:
// the channels stay « non connectées » and Monétisation keeps the revenues typed by hand.
import type { GoogleChannelStat, GoogleChannelStats } from '../../../shared/api/google'
import type { ChannelRow } from '../../../shared/workflow'
import { matchChannel } from '../../../shared/youtube-ref'
import type { ProtoChannel } from '../types'
import { channelKey } from './mapping'

export interface LiveGoogleRow {
  /** The Atelier channel (database id) this YouTube channel feeds; null when none is linked. */
  channelId: number | null
  stat: GoogleChannelStat
}

/** The Google side of a live snapshot. */
export interface LiveGoogle {
  connected: boolean
  needsReconnect: boolean
  lastRefreshAt: string | null
  rows: LiveGoogleRow[]
}

/** Each YouTube channel of the account with the Atelier channel (among `channels`) it feeds. */
export function mapGoogle(stats: GoogleChannelStats, channels: readonly Pick<ChannelRow, 'id' | 'youtubeChannelId'>[]): LiveGoogle {
  return {
    connected: stats.connected,
    needsReconnect: stats.needsReconnect,
    lastRefreshAt: stats.lastRefreshAt,
    rows: stats.channels.map((stat) => ({ stat, channelId: matchChannel({ id: stat.youtubeChannelId, handle: stat.handle }, channels)?.id ?? null }))
  }
}


/** The channel cards with the real figures of the channels Google feeds (« connectée »), the others untouched. */
export function withGoogle(channels: ProtoChannel[], google: LiveGoogle | null | undefined): ProtoChannel[] {
  if (!google || google.rows.length === 0) return channels
  return channels.map((c) => {
    const row = google.rows.find((r) => r.channelId !== null && channelKey(r.channelId) === c.id)
    if (!row) return c
    const s = row.stat
    return {
      ...c,
      connected: true,
      subscribers: s.subscribers ?? 0,
      views28d: s.views28d,
      revenue28d: s.revenue28dEur ?? 0,
      trend: s.trendPct ?? 0,
      ...(c.handle ? {} : s.handle ? { handle: s.handle } : {})
    }
  })
}
