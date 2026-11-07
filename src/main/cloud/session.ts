// The app's sign-in to Atelier Cloud (PLAN-V2-PRODUCTION §4.3): a device login approved in the browser, bound by PKCE
// S256, then an access token refreshed (and rotated) before it expires. Both tokens live in the SecretsStore (encrypted
// by safeStorage in the app); expiry, device id and the account's names live in settings. Nothing here ever hands a
// token to the renderer, a log or an error message. No Electron import: unit tests run it against an in-process Cloud.
import { createHash, randomBytes } from 'node:crypto'
import type { z } from 'zod'
import { CLOUD_DEV_HOST, CLOUD_DEV_PORT, DeviceStartResponse, MeResponse, OkResponse, TokenResponse, pkceChallenge } from '../../shared/cloud-api'
import type { CloudAccountRef, CloudLoginState, CloudStatus, JsonValue } from '../../shared/api'
import { CloudRefusal, cloudCaller, toEngine, UNREACHABLE, type CloudCaller } from '../../engine/cloud-http'
import { EngineError, isAbortError } from '../../engine/errors'
import type { SecretsStore } from '../secrets'
import type { SettingsStore } from '../settings'

type Tokens = z.infer<typeof TokenResponse>
type DeviceStart = z.infer<typeof DeviceStartResponse>
export type Me = z.infer<typeof MeResponse>

export const ACCESS_SECRET = 'cloud.accessToken'
export const REFRESH_SECRET = 'cloud.refreshToken'
export const BASE_URL_KEY = 'cloud.baseUrl'
export const EXPIRES_KEY = 'cloud.accessExpiresAt'
const DEVICE_KEY = 'cloud.deviceId'
const ACCOUNT_KEY = 'cloud.account'

export const DEFAULT_CLOUD_URL = `http://${CLOUD_DEV_HOST}:${CLOUD_DEV_PORT}`
/** The access token is refreshed when it expires within this margin. */
export const REFRESH_MARGIN_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000

export const MSG = {
  notConnected: 'L’app n’est pas connectée à Atelier Cloud : connecte-la dans Réglages.',
  expired: 'La connexion à Atelier Cloud a expiré : reconnecte l’app au Cloud.',
  loginExpired: 'La demande de connexion a expiré ou a été refusée : recommence.',
  loginFailed: 'La connexion à Atelier Cloud a échoué : recommence.',
  testKeyRefused: 'Atelier Cloud refuse la clé du cerveau de test (révoquée, expirée ou fausse) : demande une nouvelle clé.',
  badUrl: 'Adresse du Cloud invalide : https://…, ou http:// seulement sur cet ordinateur (127.0.0.1, localhost).'
} as const

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** The origin of a Cloud address, or null when it is not allowed (http only for a loopback host, else https). */
export function normaliseBaseUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname.toLowerCase())) return url.origin
  return null
}

/** Unreachable, timed out or aborted: the plain French message, without the transport's English detail. */
export function plainCloudError(e: unknown): unknown {
  if (isAbortError(e)) return new EngineError('transient', UNREACHABLE)
  if (e instanceof EngineError && e.message.startsWith(UNREACHABLE)) return new EngineError('transient', UNREACHABLE)
  if (e instanceof CloudRefusal) return toEngine(e)
  return e
}

/** The account names kept in settings, when they are well formed. */
function accountRef(v: JsonValue): CloudAccountRef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { email, name, teamName } = v
  return typeof email === 'string' && typeof name === 'string' && typeof teamName === 'string' ? { email, name, teamName } : null
}

export interface CloudSessionOptions {
  secrets: SecretsStore
  settings: SettingsStore
  fetchImpl?: typeof fetch
  /** Clock in ms (tests move it to make the access token expire). */
  now?: () => number
  /** Told when the connection changes (the app sends the 'cloud' change topic). */
  notify: () => void
  /** Overrides the poll interval the Cloud asks for (tests). */
  pollMs?: number
  /** The address used until one is set in settings (ignored when not allowed by normaliseBaseUrl). */
  defaultBaseUrl?: string
}

interface PendingLogin {
  generation: number
  deviceCode: string
  verifier: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalMs: number
  timer: ReturnType<typeof setTimeout> | null
}

export class CloudSession {
  private readonly now: () => number
  private pending: PendingLogin | null = null
  private loginError: string | null = null
  private generation = 0
  private refreshing: Promise<string> | null = null
  /** Bumped by every sign-out: a refresh that started before it must not write its tokens back. */
  private epoch = 0
  /** A test brain's key (record 0066): kept in memory only, exchanged for tokens again whenever they die. */
  private testKey: { key: string; deviceName: string } | null = null
  private closed = false

  constructor(private readonly o: CloudSessionOptions) {
    this.now = o.now ?? Date.now
  }

  baseUrl(): string {
    const v = this.o.settings.get<string | null>(BASE_URL_KEY, null)
    return (typeof v === 'string' && normaliseBaseUrl(v)) || this.defaultUrl()
  }

  /** The address of a new install: the build's (or launch's) default when it is allowed, else the local development Cloud. */
  defaultUrl(): string {
    return (this.o.defaultBaseUrl && normaliseBaseUrl(this.o.defaultBaseUrl)) || DEFAULT_CLOUD_URL
  }

  /** Changes the Cloud address; a different Cloud signs the app out of the previous one first. */
  async setBaseUrl(value: string): Promise<CloudStatus> {
    const url = normaliseBaseUrl(value)
    if (!url) throw new Error(MSG.badUrl)
    if (url !== this.baseUrl()) {
      this.cancelLogin()
      if (this.connected()) await this.logout()
      this.o.settings.set(BASE_URL_KEY, url)
      this.o.notify()
    }
    return this.status()
  }

  /** The HTTP caller of this Cloud with the user's token (refreshed when needed). */
  caller(): CloudCaller {
    return cloudCaller({ baseUrl: this.baseUrl(), token: () => this.token(), ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}) })
  }

  /** A caller for the routes that need no token (device login, refresh). */
  private anonymous(): CloudCaller {
    return cloudCaller({ baseUrl: this.baseUrl(), token: () => '', ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}) })
  }

  connected(): boolean {
    return this.o.secrets.has(ACCESS_SECRET) && this.o.secrets.has(REFRESH_SECRET)
  }

  status(): CloudStatus {
    const connected = this.connected()
    const account = connected ? accountRef(this.o.settings.get<JsonValue>(ACCOUNT_KEY, null)) : null
    return {
      connected,
      baseUrl: this.baseUrl(),
      deviceId: connected ? this.o.settings.get<string | null>(DEVICE_KEY, null) : null,
      ...(account ? { account } : {})
    }
  }

  // ---- device login -------------------------------------------------------------------------------------------------

  /** Starts a device login: the person types `userCode` on `verificationUri`; the app polls in the background. */
  async startLogin(deviceName: string): Promise<CloudLoginState> {
    this.cancelLogin()
    this.loginError = null
    const generation = ++this.generation
    const verifier = randomBytes(32).toString('base64url')
    const challenge = pkceChallenge(verifier, (s) => createHash('sha256').update(s).digest())
    let start: DeviceStart
    try {
      start = await this.anonymous().call('POST', '/v1/auth/device/start', DeviceStartResponse, AbortSignal.timeout(REQUEST_TIMEOUT_MS), {
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        deviceName: deviceName.slice(0, 100) || 'Atelier'
      })
    } catch (e) {
      throw plainCloudError(e)
    }
    if (generation !== this.generation) return this.loginState()
    this.pending = {
      generation,
      deviceCode: start.deviceCode,
      verifier,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: this.now() + start.expiresIn * 1000,
      intervalMs: this.o.pollMs ?? Math.max(1, start.interval) * 1000,
      timer: null
    }
    this.schedule(this.pending)
    this.o.notify()
    return this.loginState()
  }

  // ---- test brain (record 0066) ----------------------------------------------------------------------------------------

  /** A headless test brain signs in with its test team's key (`--token-file`) instead of a device login. The key stays in
   *  memory: when the Cloud cannot be reached now, the next call that needs a token exchanges it. */
  async useTestKey(key: string, deviceName: string): Promise<CloudStatus> {
    this.cancelLogin()
    this.testKey = { key: key.trim(), deviceName: deviceName.slice(0, 100) }
    await this.exchangeTestKey()
    await this.rememberAccount()
    this.o.notify()
    return this.status()
  }

  private async exchangeTestKey(): Promise<string> {
    const k = this.testKey
    if (!k) throw new EngineError('missing_tool', MSG.notConnected)
    const epoch = this.epoch
    let tokens: Tokens
    try {
      tokens = await this.anonymous().raw('POST', '/v1/auth/test-brain', TokenResponse, AbortSignal.timeout(REQUEST_TIMEOUT_MS), { key: k.key, deviceName: k.deviceName })
    } catch (e) {
      if (e instanceof CloudRefusal && (e.code === 'unauthorized' || e.code === 'forbidden')) throw new EngineError('missing_tool', MSG.testKeyRefused)
      throw plainCloudError(e)
    }
    if (epoch !== this.epoch || this.testKey !== k) throw new EngineError('missing_tool', MSG.notConnected)
    this.store(tokens)
    return tokens.accessToken
  }

  /** One exchange at a time (concurrent callers share it, like a refresh). */
  private shared(run: () => Promise<string>): Promise<string> {
    if (!this.refreshing) {
      const running: Promise<string> = run().finally(() => {
        if (this.refreshing === running) this.refreshing = null
      })
      this.refreshing = running
    }
    return this.refreshing
  }

  loginState(): CloudLoginState {
    if (this.pending) return { pending: true, userCode: this.pending.userCode, verificationUri: this.pending.verificationUri }
    if (this.loginError) return { error: true, message: this.loginError }
    return this.connected() ? 'connected' : 'idle'
  }

  cancelLogin(): void {
    this.generation++
    if (this.pending?.timer) clearTimeout(this.pending.timer)
    const had = this.pending !== null || this.loginError !== null
    this.pending = null
    this.loginError = null
    if (had) this.o.notify()
  }

  /** Stops the background poll (the app quits). */
  close(): void {
    this.closed = true
    if (this.pending?.timer) clearTimeout(this.pending.timer)
    this.pending = null
  }

  private schedule(p: PendingLogin): void {
    if (this.closed) return
    p.timer = setTimeout(() => void this.pollOnce(p), p.intervalMs)
  }

  private fail(p: PendingLogin, message: string): void {
    if (p.generation !== this.generation) return
    this.pending = null
    this.loginError = message
    this.o.notify()
  }

  private async pollOnce(p: PendingLogin): Promise<void> {
    if (p.generation !== this.generation || this.closed) return
    if (this.now() > p.expiresAt) return this.fail(p, MSG.loginExpired)
    let tokens: Tokens
    try {
      tokens = await this.anonymous().raw('POST', '/v1/auth/device/poll', TokenResponse, AbortSignal.timeout(REQUEST_TIMEOUT_MS), {
        deviceCode: p.deviceCode,
        codeVerifier: p.verifier
      })
    } catch (e) {
      if (p.generation !== this.generation) return
      if (e instanceof CloudRefusal) {
        if (e.code === 'authorization_pending') return this.schedule(p)
        if (e.code === 'rate_limited') {
          p.intervalMs += 5000
          return this.schedule(p)
        }
        if (e.code === 'gone' || e.code === 'unauthorized' || e.code === 'forbidden') return this.fail(p, MSG.loginExpired)
        if (e.status >= 500) return this.schedule(p)
        return this.fail(p, MSG.loginFailed)
      }
      // unreachable for a moment: keep trying until the login expires
      return this.schedule(p)
    }
    if (p.generation !== this.generation) return
    this.store(tokens)
    await this.rememberAccount()
    if (p.generation !== this.generation) return
    this.pending = null
    this.loginError = null
    this.o.notify()
  }

  /** Remembers the account's names for the status (best effort: a later status shows them once known). */
  async rememberAccount(): Promise<Me | null> {
    try {
      const me = await this.caller().call('GET', '/v1/me', MeResponse, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      this.o.settings.set(ACCOUNT_KEY, { email: me.account.email, name: me.account.name, teamName: me.team.name })
      return me
    } catch {
      return null
    }
  }

  // ---- tokens -------------------------------------------------------------------------------------------------------

  private store(t: Tokens): void {
    this.o.secrets.set(ACCESS_SECRET, t.accessToken)
    this.o.secrets.set(REFRESH_SECRET, t.refreshToken)
    this.o.settings.set(EXPIRES_KEY, this.now() + t.expiresIn * 1000)
    this.o.settings.set(DEVICE_KEY, t.deviceId)
  }

  /** The access token, refreshed first when it expires within a minute (concurrent callers share one refresh). */
  async token(): Promise<string> {
    const access = this.o.secrets.get(ACCESS_SECRET)
    const refresh = this.o.secrets.get(REFRESH_SECRET)
    if (!access || !refresh) {
      if (this.testKey) return this.shared(() => this.exchangeTestKey())
      throw new EngineError('missing_tool', MSG.notConnected)
    }
    const expiresAt = this.o.settings.get<number>(EXPIRES_KEY, 0)
    if (expiresAt - this.now() > REFRESH_MARGIN_MS) return access
    return this.shared(() => this.refresh(refresh))
  }

  /** The Cloud refused the access token before its time (revoked, clock skew): the next token() refreshes it. */
  expireAccess(): void {
    if (this.connected()) this.o.settings.set(EXPIRES_KEY, 0)
  }

  private async refresh(refreshToken: string): Promise<string> {
    const epoch = this.epoch
    let tokens: Tokens
    try {
      tokens = await this.anonymous().raw('POST', '/v1/auth/refresh', TokenResponse, AbortSignal.timeout(REQUEST_TIMEOUT_MS), { refreshToken })
    } catch (e) {
      if (e instanceof CloudRefusal && (e.code === 'unauthorized' || e.code === 'token_expired')) {
        this.clear()
        // a test brain signs in again with its key (a revoked key is refused there)
        if (this.testKey) return this.exchangeTestKey()
        throw new EngineError('missing_tool', MSG.expired)
      }
      throw plainCloudError(e)
    }
    // signed out (logout, another Cloud) while the refresh was on its way: its tokens are dropped
    if (epoch !== this.epoch) throw new EngineError('missing_tool', MSG.notConnected)
    this.store(tokens)
    return tokens.accessToken
  }

  /** Signs the device out on the Cloud (best effort), then forgets the tokens. */
  async logout(): Promise<void> {
    this.cancelLogin()
    // signed out on purpose: the test key is forgotten too (a restart with --token-file signs in again)
    this.testKey = null
    const access = this.connected() ? this.o.secrets.get(ACCESS_SECRET) : null
    if (access) {
      const signedOut = cloudCaller({ baseUrl: this.baseUrl(), token: () => access, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}) })
      await signedOut.raw('POST', '/v1/auth/logout', OkResponse, AbortSignal.timeout(5000)).catch(() => undefined)
    }
    this.clear()
  }

  /** Forgets the tokens and the account (the Cloud may still know the device: logout revokes it there). */
  clear(): void {
    this.epoch++
    this.refreshing = null
    const had = this.connected()
    this.o.secrets.clear(ACCESS_SECRET)
    this.o.secrets.clear(REFRESH_SECRET)
    for (const key of [EXPIRES_KEY, DEVICE_KEY, ACCOUNT_KEY]) this.o.settings.delete(key)
    if (had) this.o.notify()
  }
}
