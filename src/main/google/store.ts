// The Google side's persistence: the cached figures (migration 023, `google_channels` + `google_channel_days`) and the
// connection state kept in settings (client id, granted scopes, last refresh, last error, « reconnect »). The client
// secret and the refresh token are NOT here: they live in the encrypted secrets store under SECRET_* names.
import type { JsonValue } from '../../shared/api'
import type { GoogleErrorCode } from '../../shared/api/google'
import { transaction, type Db } from '../db'
import type { SettingsStore } from '../settings'
import type { DayRow, YtChannel } from './analytics'

export const SECRET_CLIENT = 'google.clientSecret'
export const SECRET_REFRESH = 'google.refreshToken'
const STATE_KEY = 'google.state'
const CLIENT_KEY = 'google.clientId'

export interface GoogleState {
  scopes: string[]
  lastRefreshAt: string | null
  lastError: { code: GoogleErrorCode; message: string } | null
  needsReconnect: boolean
}

const EMPTY: GoogleState = { scopes: [], lastRefreshAt: null, lastError: null, needsReconnect: false }

export class GoogleStateStore {
  constructor(private readonly settings: SettingsStore) {}

  get(): GoogleState {
    const value = this.settings.get<JsonValue>(STATE_KEY)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY }
    const raw = value as Record<string, unknown>
    const err = raw.lastError as GoogleState['lastError'] | undefined
    return {
      scopes: Array.isArray(raw.scopes) ? raw.scopes.filter((s): s is string => typeof s === 'string') : [],
      lastRefreshAt: typeof raw.lastRefreshAt === 'string' ? raw.lastRefreshAt : null,
      lastError: err && typeof err.code === 'string' && typeof err.message === 'string' ? { code: err.code, message: err.message } : null,
      needsReconnect: raw.needsReconnect === true
    }
  }

  patch(p: Partial<GoogleState>): GoogleState {
    const next = { ...this.get(), ...p }
    this.settings.set(STATE_KEY, { scopes: next.scopes, lastRefreshAt: next.lastRefreshAt, lastError: next.lastError, needsReconnect: next.needsReconnect })
    return next
  }

  reset(): void {
    this.settings.delete(STATE_KEY)
  }

  clientId(): string | null {
    const v = this.settings.get<string>(CLIENT_KEY)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }

  setClientId(id: string | null): void {
    if (id === null) this.settings.delete(CLIENT_KEY)
    else this.settings.set(CLIENT_KEY, id)
  }
}

export interface CachedChannel extends YtChannel {
  revenueAvailable: boolean
  fetchedAt: string
}

interface ChannelRow {
  youtube_channel_id: string
  title: string
  handle: string | null
  subscribers: number | null
  total_views: number | null
  revenue_available: number
  fetched_at: string
}

interface DayDbRow {
  day: string
  views: number
  watch_minutes: number
  subs_gained: number
  subs_lost: number
  revenue_eur: number | null
}

export class GoogleCache {
  constructor(private readonly db: Db) {}

  /** One refresh's answer: the account's channels as they are now (others dropped) and their days (upserted). */
  save(entries: readonly { channel: YtChannel; revenue: boolean; days: readonly DayRow[] }[], fetchedAt: string): void {
    transaction(this.db, () => {
      const keep = new Set(entries.map((e) => e.channel.id))
      const known = this.db.prepare('SELECT youtube_channel_id AS id FROM google_channels').all() as { id: string }[]
      for (const k of known) {
        if (keep.has(k.id)) continue
        this.db.prepare('DELETE FROM google_channel_days WHERE youtube_channel_id = ?').run(k.id)
        this.db.prepare('DELETE FROM google_channels WHERE youtube_channel_id = ?').run(k.id)
      }
      const upsertChannel = this.db.prepare(
        `INSERT INTO google_channels (youtube_channel_id, title, handle, subscribers, total_views, revenue_available, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(youtube_channel_id) DO UPDATE SET title = excluded.title, handle = excluded.handle, subscribers = excluded.subscribers,
           total_views = excluded.total_views, revenue_available = excluded.revenue_available, fetched_at = excluded.fetched_at`
      )
      const upsertDay = this.db.prepare(
        `INSERT INTO google_channel_days (youtube_channel_id, day, views, watch_minutes, subs_gained, subs_lost, revenue_eur)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(youtube_channel_id, day) DO UPDATE SET views = excluded.views, watch_minutes = excluded.watch_minutes,
           subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost, revenue_eur = excluded.revenue_eur`
      )
      for (const e of entries) {
        const c = e.channel
        upsertChannel.run(c.id, c.title, c.handle, c.subscribers, c.totalViews, e.revenue ? 1 : 0, fetchedAt)
        for (const d of e.days) upsertDay.run(c.id, d.day, d.views, d.watchMinutes, d.subsGained, d.subsLost, d.revenueEur)
      }
    })
  }

  channels(): CachedChannel[] {
    const rows = this.db.prepare('SELECT * FROM google_channels ORDER BY title, youtube_channel_id').all() as unknown as ChannelRow[]
    return rows.map((r) => ({
      id: r.youtube_channel_id,
      title: r.title,
      handle: r.handle,
      subscribers: r.subscribers,
      totalViews: r.total_views,
      revenueAvailable: r.revenue_available === 1,
      fetchedAt: r.fetched_at
    }))
  }

  days(youtubeChannelId: string): DayRow[] {
    const rows = this.db
      .prepare('SELECT day, views, watch_minutes, subs_gained, subs_lost, revenue_eur FROM google_channel_days WHERE youtube_channel_id = ? ORDER BY day')
      .all(youtubeChannelId) as unknown as DayDbRow[]
    return rows.map((r) => ({
      day: r.day,
      views: r.views,
      watchMinutes: r.watch_minutes,
      subsGained: r.subs_gained,
      subsLost: r.subs_lost,
      revenueEur: r.revenue_eur
    }))
  }

  clear(): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM google_channel_days').run()
      this.db.prepare('DELETE FROM google_channels').run()
    })
  }
}
