// GoogleService: what the `google.*` IPC methods call. Connects the owner's Google account read-only (oauth.ts), reads his
// channels and their daily figures (analytics.ts), keeps them in the SQLite cache (store.ts) and serves them per channel.
// The client secret and the refresh token are in the encrypted secrets store; the access token only in memory. A token
// Google refuses (revoked, expired) is forgotten and the status says « reconnect ». Refreshed once a day and on demand.
import type { GoogleChannelLink, GoogleChannelStat, GoogleChannelStats, GoogleClientInput, GoogleStatus } from '../../shared/api/google'
import type { Db } from '../db'
import type { SecretsStore } from '../secrets'
import type { SettingsStore } from '../settings'
import { channelDays, listMyChannels, matchChannel, reportWindow, summarise, type AtelierChannelRef, type DayRow, type Get, type YtChannel } from './analytics'
import {
  authUrl,
  awaitRedirect,
  checkScopes,
  exchangeCode,
  GoogleError,
  newPkce,
  newState,
  refreshAccess,
  revokeToken,
  type ClientCreds,
  type FetchLike,
  type PendingRedirect
} from './oauth'
import { GoogleCache, GoogleStateStore, SECRET_CLIENT, SECRET_REFRESH } from './store'

export interface GoogleServiceOptions {
  db: Db
  settings: SettingsStore
  secrets: SecretsStore
  /** The Atelier channels and the YouTube id (or handle) typed for each. */
  channels: () => AtelierChannelRef[]
  notify: () => void
  /** Opens the sign-in address in the system browser (shell.openExternal in the app). */
  openExternal: (url: string) => void | Promise<void>
  /** Tests pass a fake Google; the app uses the real `fetch`. */
  fetch?: FetchLike
  env?: Record<string, string | undefined>
  now?: () => number
  /** How long the browser sign-in may take (default 5 minutes). */
  connectTimeoutMs?: number
}

const DAY_MS = 86_400_000
const CLIENT_ID = /^[\w.-]{8,200}$/
const CLIENT_SECRET = /^[\w.-]{6,200}$/

export class GoogleService {
  readonly cache: GoogleCache
  readonly state: GoogleStateStore
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private access: { token: string; expiresAt: number } | null = null
  private pending: PendingRedirect | null = null
  private running: Promise<GoogleStatus> | null = null
  private timers: NodeJS.Timeout[] = []

  constructor(private readonly o: GoogleServiceOptions) {
    this.cache = new GoogleCache(o.db)
    this.state = new GoogleStateStore(o.settings)
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init))
    this.now = o.now ?? Date.now
  }

  /* ---------- the OAuth client ---------- */

  private secret(name: string): string | null {
    try {
      return this.o.secrets.has(name) ? this.o.secrets.get(name) : null
    } catch {
      return null
    }
  }

  /** The client pasted in Réglages wins; else ATELIER_GOOGLE_CLIENT_ID / ATELIER_GOOGLE_CLIENT_SECRET. */
  private client(): { creds: ClientCreds; source: 'settings' | 'env' } | null {
    const id = this.state.clientId()
    if (id) return { creds: { clientId: id, clientSecret: this.secret(SECRET_CLIENT) }, source: 'settings' }
    const env = this.o.env ?? process.env
    const envId = env.ATELIER_GOOGLE_CLIENT_ID?.trim()
    if (envId && CLIENT_ID.test(envId)) return { creds: { clientId: envId, clientSecret: env.ATELIER_GOOGLE_CLIENT_SECRET?.trim() || null }, source: 'env' }
    return null
  }

  setClient(input: GoogleClientInput): GoogleStatus {
    const id = typeof input?.clientId === 'string' ? input.clientId.trim() : ''
    const secret = typeof input?.clientSecret === 'string' ? input.clientSecret.trim() : ''
    if (!CLIENT_ID.test(id)) throw new GoogleError('noClient')
    if (secret && !CLIENT_SECRET.test(secret)) throw new GoogleError('client')
    const before = this.client()?.creds.clientId ?? null
    this.state.setClientId(id)
    if (secret) this.o.secrets.set(SECRET_CLIENT, secret)
    // tokens belong to the client that issued them: another client means connecting again
    if (before !== null && before !== id) this.forget()
    return this.changed()
  }

  clearClient(): GoogleStatus {
    const before = this.client()?.creds.clientId ?? null
    this.state.setClientId(null)
    this.o.secrets.clear(SECRET_CLIENT)
    if (before !== (this.client()?.creds.clientId ?? null)) this.forget()
    return this.changed()
  }

  /* ---------- status ---------- */

  private connected(): boolean {
    return this.secret(SECRET_REFRESH) !== null
  }

  private links(): GoogleChannelLink[] {
    const channels = this.o.channels()
    return this.cache.channels().map((c) => {
      const m = matchChannel(c, channels)
      return { youtubeChannelId: c.id, title: c.title, handle: c.handle, atelierChannelId: m?.id ?? null, atelierChannelName: m?.name ?? null, revenueAvailable: c.revenueAvailable }
    })
  }

  status(): GoogleStatus {
    const client = this.client()
    const st = this.state.get()
    return {
      clientIdSet: client !== null,
      clientId: client?.creds.clientId ?? null,
      clientSecretSet: client?.creds.clientSecret ? true : false,
      clientSource: client?.source ?? null,
      connected: this.connected(),
      needsReconnect: st.needsReconnect,
      connecting: this.pending !== null,
      scopes: st.scopes,
      lastRefreshAt: st.lastRefreshAt,
      lastError: st.lastError,
      channels: this.links()
    }
  }

  private changed(): GoogleStatus {
    this.o.notify()
    return this.status()
  }

  /* ---------- connect / disconnect ---------- */

  /** The browser sign-in: PKCE + state, loopback redirect, code exchange, scope check, then a first read of the figures. */
  async connect(): Promise<GoogleStatus> {
    const client = this.client()
    if (!client) throw new GoogleError('noClient')
    this.pending?.cancel()
    const pkce = newPkce()
    const state = newState()
    const pending = await awaitRedirect({ state, timeoutMs: this.o.connectTimeoutMs ?? 5 * 60_000 })
    this.pending = pending
    this.o.notify()
    let code: string
    try {
      await this.o.openExternal(authUrl({ clientId: client.creds.clientId, redirectUri: pending.redirectUri, challenge: pkce.challenge, state }))
      code = await pending.code
    } catch (err) {
      throw this.failed(err)
    } finally {
      if (this.pending === pending) this.pending = null
      pending.cancel()
    }
    let scopes: string[]
    try {
      const tokens = await exchangeCode(this.fetchImpl, client.creds, { code, verifier: pkce.verifier, redirectUri: pending.redirectUri }, this.now())
      try {
        scopes = checkScopes(tokens.rawScope)
      } catch (err) {
        // a grant we cannot use (a scope refused, or more than read-only) is handed back at once
        await revokeToken(this.fetchImpl, tokens.refreshToken ?? tokens.accessToken)
        throw err
      }
      if (!tokens.refreshToken) {
        await revokeToken(this.fetchImpl, tokens.accessToken)
        throw new GoogleError('noRefresh')
      }
      this.o.secrets.set(SECRET_REFRESH, tokens.refreshToken)
      this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    } catch (err) {
      throw this.failed(err)
    }
    this.state.patch({ scopes, needsReconnect: false, lastError: null })
    // the connection holds even if this first read fails (quota…): the error is in the status
    await this.refresh().catch(() => undefined)
    return this.changed()
  }

  /** Records a failure in the status (never a token in it) and gives back the error to throw. */
  private failed(err: unknown): GoogleError {
    const e = err instanceof GoogleError ? err : new GoogleError('network')
    if (e.code === 'reconnect') this.revoked()
    this.state.patch({ lastError: { code: e.code, message: e.message } })
    this.o.notify()
    return e
  }

  /** Google no longer takes the refresh token: forget it, keep the cached figures, ask to reconnect. */
  private revoked(): void {
    this.access = null
    this.o.secrets.clear(SECRET_REFRESH)
    this.state.patch({ needsReconnect: true })
  }

  /** Drops the tokens and the cached figures locally. */
  private forget(): void {
    this.access = null
    this.o.secrets.clear(SECRET_REFRESH)
    this.cache.clear()
    this.state.reset()
  }

  async disconnect(): Promise<GoogleStatus> {
    this.pending?.cancel()
    this.pending = null
    const token = this.secret(SECRET_REFRESH)
    if (token) await revokeToken(this.fetchImpl, token)
    this.forget()
    return this.changed()
  }

  /* ---------- reading the figures ---------- */

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > this.now()) return this.access.token
    const client = this.client()
    if (!client) throw new GoogleError('noClient')
    const refresh = this.secret(SECRET_REFRESH)
    if (!refresh) throw new GoogleError(this.state.get().needsReconnect ? 'reconnect' : 'notConnected')
    const fresh = await refreshAccess(this.fetchImpl, client.creds, refresh, this.now())
    this.access = { token: fresh.accessToken, expiresAt: fresh.expiresAt }
    return fresh.accessToken
  }

  /** One authenticated GET; a 401 gets one new access token and one retry. */
  private readonly get: Get = async (url) => {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken()
      let res: Response
      try {
        res = await this.fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
      } catch {
        throw new GoogleError('network')
      }
      if (res.status === 401 && attempt === 0) {
        this.access = null
        continue
      }
      return { status: res.status, json: await res.json().catch(() => ({})) }
    }
  }

  /** Reads the channels of the account and their daily figures now; concurrent calls share one read. */
  refresh(): Promise<GoogleStatus> {
    if (!this.running) {
      this.running = this.read().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async read(): Promise<GoogleStatus> {
    if (!this.client()) throw this.failed(new GoogleError('noClient'))
    if (!this.connected()) throw new GoogleError(this.state.get().needsReconnect ? 'reconnect' : 'notConnected')
    const now = this.now()
    const window = reportWindow(now)
    const entries: { channel: YtChannel; revenue: boolean; days: DayRow[] }[] = []
    try {
      const channels = await listMyChannels(this.get)
      for (const channel of channels) {
        const ids = channels.length === 1 ? 'channel==MINE' : `channel==${channel.id}`
        const { rows, revenue } = await channelDays(this.get, { ids, startDate: window.startDate, endDate: window.endDate })
        entries.push({ channel, revenue, days: rows })
      }
    } catch (err) {
      throw this.failed(err)
    }
    this.cache.save(entries, new Date(now).toISOString())
    this.state.patch({ lastRefreshAt: new Date(now).toISOString(), lastError: null, needsReconnect: false })
    return this.changed()
  }

  channelStats(): GoogleChannelStats {
    const st = this.state.get()
    const channels = this.o.channels()
    const now = this.now()
    const out: GoogleChannelStat[] = this.cache.channels().map((c) => {
      const s = summarise(this.cache.days(c.id), now, c.revenueAvailable)
      return {
        youtubeChannelId: c.id,
        title: c.title,
        handle: c.handle,
        atelierChannelId: matchChannel(c, channels)?.id ?? null,
        subscribers: c.subscribers,
        ...s,
        fetchedAt: c.fetchedAt
      }
    })
    return { connected: this.connected(), needsReconnect: st.needsReconnect, lastRefreshAt: st.lastRefreshAt, channels: out }
  }

  /* ---------- the daily refresh ---------- */

  /** Refreshes when connected and the last read is a day old (or never happened). Errors stay in the status. */
  async tick(): Promise<void> {
    if (!this.connected() || !this.client()) return
    const last = this.state.get().lastRefreshAt
    if (last !== null && this.now() - Date.parse(last) < DAY_MS) return
    await this.refresh().catch(() => undefined)
  }

  /** App start: a first look after 30 s, then every hour (each look refreshes only once a day). */
  start(): void {
    const first = setTimeout(() => void this.tick(), 30_000)
    const hourly = setInterval(() => void this.tick(), 3_600_000)
    first.unref()
    hourly.unref()
    this.timers.push(first, hourly)
  }

  close(): void {
    for (const tm of this.timers) clearTimeout(tm)
    this.timers = []
    this.pending?.cancel()
    this.pending = null
  }
}
