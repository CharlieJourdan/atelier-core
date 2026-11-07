// Google OAuth 2.0 for installed apps (RFC 8252): the system browser, a loopback redirect on 127.0.0.1 and a random port,
// PKCE S256 (RFC 7636) and a random `state`. Read-only scopes only (GOOGLE_SCOPES): a grant that misses one of them, or
// carries any scope outside the read-only list, is refused and revoked. Tokens never appear in an error, a log or a result:
// errors are GoogleError with a code, their message is a fixed French sentence.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GOOGLE_SCOPES, type GoogleErrorCode } from '../../shared/api/google'
import { t, type MessageKey } from '../../shared/fr'

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const CALLBACK_PATH = '/oauth2/callback'

/** Scopes a grant may carry: ours, plus the identity scopes Google may add from an earlier consent. Nothing that writes. */
const ALLOWED_SCOPES = new Set<string>([
  ...GOOGLE_SCOPES,
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
])

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>

export class GoogleError extends Error {
  constructor(
    readonly code: GoogleErrorCode,
    /** HTTP status of Google's answer, when there was one. */
    readonly status: number | null = null
  ) {
    super(t(`google.err.${code}` as MessageKey))
    this.name = 'GoogleError'
  }
}

export interface Pkce {
  verifier: string
  challenge: string
}

export const pkceChallengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

/** A 43-character verifier (32 random bytes) and its S256 challenge. */
export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: pkceChallengeOf(verifier) }
}

export const newState = (): string => randomBytes(24).toString('base64url')

export function authUrl(p: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    // a refresh token, asked again at each connection so one always comes back
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${AUTH_URL}?${q.toString()}`
}

/** The granted scopes, once checked: every read-only scope we asked for, and nothing outside the read-only list. */
export function checkScopes(granted: string | undefined): string[] {
  const scopes = (granted ?? '').split(/\s+/).filter(Boolean)
  const have = new Set(scopes)
  if (GOOGLE_SCOPES.some((s) => !have.has(s))) throw new GoogleError('scopes')
  if (scopes.some((s) => !ALLOWED_SCOPES.has(s))) throw new GoogleError('scopes')
  return scopes
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const PAGE = (title: string, line: string): string =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Atelier</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${line}</p></body></html>`

export interface PendingRedirect {
  /** `http://127.0.0.1:<port>/oauth2/callback`, to put in the sign-in address. */
  redirectUri: string
  /** The authorization code once Google redirected the browser here with the right `state`. */
  code: Promise<string>
  /** Stops waiting (the promise rejects with `cancelled`) and closes the port. */
  cancel: () => void
}

/**
 * Listens on 127.0.0.1, on a port the system picks, for Google's one redirect. A wrong `state` or an `error` answer
 * settles the wait at once (the code is never accepted from another request); anything else on the port gets a 404.
 */
export async function awaitRedirect(p: { state: string; timeoutMs: number }): Promise<PendingRedirect> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (e: GoogleError) => void
  const code = new Promise<string>((ok, fail) => {
    resolveCode = ok
    rejectCode = fail
  })
  // a rejection nobody awaits yet (cancelled before the caller listens) must not crash the process
  code.catch(() => undefined)
  let done = false
  let server: Server | null = null
  let timer: NodeJS.Timeout | null = null
  const finish = (r: { code: string } | { error: GoogleError }): void => {
    if (done) return
    done = true
    if (timer) clearTimeout(timer)
    // let the answer page reach the browser, then free the port
    setTimeout(() => server?.close(), 50).unref()
    server?.closeIdleConnections?.()
    if ('code' in r) resolveCode(r.code)
    else rejectCode(r.error)
  }
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH || done) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    const state = url.searchParams.get('state') ?? ''
    const error = url.searchParams.get('error')
    const got = url.searchParams.get('code')
    const reply = (status: number, title: MessageKey, line: MessageKey): void => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE(t(title), t(line)))
    }
    if (!sameText(state, p.state)) {
      reply(400, 'google.page.failTitle', 'google.page.state')
      finish({ error: new GoogleError('state') })
    } else if (error) {
      reply(200, 'google.page.failTitle', 'google.page.denied')
      finish({ error: new GoogleError('denied') })
    } else if (!got) {
      reply(400, 'google.page.failTitle', 'google.page.state')
      finish({ error: new GoogleError('answer') })
    } else {
      reply(200, 'google.page.okTitle', 'google.page.ok')
      finish({ code: got })
    }
  })
  await new Promise<void>((ok, fail) => {
    server?.once('error', fail)
    server?.listen(0, '127.0.0.1', () => ok())
  })
  const port = (server.address() as AddressInfo).port
  timer = setTimeout(() => finish({ error: new GoogleError('timeout') }), p.timeoutMs)
  timer.unref()
  return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, code, cancel: () => finish({ error: new GoogleError('cancelled') }) }
}

export interface TokenAnswer {
  accessToken: string
  expiresAt: number
  refreshToken: string | null
  scopes: string[]
}

interface RawToken {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  error?: string
}

const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }

async function post(fetchImpl: FetchLike, url: string, form: Record<string, string>): Promise<{ status: number; json: RawToken }> {
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'POST', headers: FORM, body: new URLSearchParams(form).toString() })
  } catch {
    throw new GoogleError('network')
  }
  const json = (await res.json().catch(() => ({}))) as RawToken
  return { status: res.status, json }
}

function tokenError(status: number, json: RawToken): GoogleError {
  if (json.error === 'invalid_grant') return new GoogleError('reconnect', status)
  if (json.error === 'invalid_client' || json.error === 'unauthorized_client') return new GoogleError('client', status)
  if (status === 429) return new GoogleError('quota', status)
  return new GoogleError('answer', status)
}

function toAnswer(json: RawToken, now: number): TokenAnswer {
  if (typeof json.access_token !== 'string' || !json.access_token) throw new GoogleError('answer')
  const life = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600
  return {
    accessToken: json.access_token,
    // a minute early, so a call never starts with a token about to die
    expiresAt: now + Math.max(0, life - 60) * 1000,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    scopes: (json.scope ?? '').split(/\s+/).filter(Boolean)
  }
}

export interface ClientCreds {
  clientId: string
  clientSecret: string | null
}

/** The authorization code → tokens, with the PKCE verifier; the grant's scopes are checked by the caller. */
export async function exchangeCode(
  fetchImpl: FetchLike,
  client: ClientCreds,
  p: { code: string; verifier: string; redirectUri: string },
  now: number
): Promise<TokenAnswer & { rawScope: string }> {
  const { status, json } = await post(fetchImpl, TOKEN_URL, {
    grant_type: 'authorization_code',
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    client_id: client.clientId,
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {})
  })
  if (status !== 200) throw tokenError(status, json)
  return { ...toAnswer(json, now), rawScope: json.scope ?? '' }
}

/** A fresh access token from the stored refresh token. `invalid_grant` (revoked, expired) → `reconnect`. */
export async function refreshAccess(fetchImpl: FetchLike, client: ClientCreds, refreshToken: string, now: number): Promise<TokenAnswer> {
  const { status, json } = await post(fetchImpl, TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {})
  })
  if (status !== 200) throw tokenError(status, json)
  return toAnswer(json, now)
}

/** Tells Google to forget a token (and the grant behind it). Failures are ignored: the token is dropped locally anyway. */
export async function revokeToken(fetchImpl: FetchLike, token: string): Promise<void> {
  await post(fetchImpl, REVOKE_URL, { token }).catch(() => undefined)
}
