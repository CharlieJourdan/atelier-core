// The website talking to Atelier Cloud for real: sign-up, sign-in, the checkout (simulated payment unless the Cloud is
// set up for Stripe) and the team computers it creates. On only when the site is built with VITE_ATELIER_CLOUD (the
// Cloud's address, e.g. http://127.0.0.1:8787); otherwise the site keeps its fictive accounts (auth.ts). The demo build
// (VITE_ATELIER_DEMO=1) runs the same pages against the in-browser fake of demo/server.ts: no request ever leaves.
import { DEMO } from './demo/mode'

const BASE = DEMO ? null : (import.meta.env.VITE_ATELIER_CLOUD as string | undefined)?.replace(/\/+$/, '') || null
const TOKEN_KEY = 'atelier.site.cloud'
/** The founder console's session lives in this tab only: a stolen site page cannot reuse it later. */
let adminSession = false

export const cloudEnabled = (): boolean => DEMO || BASE !== null
/** The Cloud's address the site is built for (the console shows the update feed links with it), or null (also in the demo). */
export const cloudBase = (): string | null => BASE

export class CloudCallError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface Tokens {
  accessToken: string
  refreshToken: string
}

let memoryTokens: string | null = null
const store = (): Storage => (adminSession ? sessionStorage : localStorage)

function readTokens(): Tokens | null {
  let raw: string | null = memoryTokens
  try {
    raw = store().getItem(TOKEN_KEY) ?? memoryTokens
  } catch {
    // blocked storage: memory only
  }
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as Tokens
    return typeof t?.accessToken === 'string' ? t : null
  } catch {
    return null
  }
}
function writeTokens(t: Tokens | null): void {
  memoryTokens = t ? JSON.stringify(t) : null
  try {
    if (t) store().setItem(TOKEN_KEY, memoryTokens as string)
    else store().removeItem(TOKEN_KEY)
  } catch {
    // blocked storage: memory holds it
  }
}

/** The demo build: the fake answers, nothing goes on the network (the module is only loaded in that build). */
async function demoCall<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const { demoRespond } = await import('./demo/server')
  const res = await demoRespond(path, init.method ?? 'GET', init.body)
  const json = res.body as { error?: { code?: string; message?: string } } & T
  if (res.status >= 400) throw new CloudCallError(json.error?.message ?? `HTTP ${res.status}`, res.status, json.error?.code ?? 'error')
  return json
}

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}, retried = false): Promise<T> {
  if (DEMO) return demoCall<T>(path, init)
  if (!BASE) throw new CloudCallError('Atelier Cloud is not configured', 0, 'not_configured')
  const tokens = init.auth ? readTokens() : null
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    })
  } catch {
    throw new CloudCallError('network', 0, 'network')
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T
  if (res.status === 401 && json.error?.code === 'token_expired' && tokens && !retried) {
    const fresh = await call<Tokens>('/v1/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } }).catch(() => null)
    if (fresh) {
      writeTokens(fresh)
      return call<T>(path, init, true)
    }
  }
  if (!res.ok) throw new CloudCallError(json.error?.message ?? `HTTP ${res.status}`, res.status, json.error?.code ?? 'error')
  return json
}

/** Any authenticated call (the founder console). */
export const cloudCall = <T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> => call<T>(path, { ...init, auth: true })

/** Signs in and tells whether the account is a platform admin (the founder console's gate; the server checks again). */
export async function cloudAdminLogin(email: string, password: string): Promise<boolean> {
  adminSession = true
  writeTokens(await call<Tokens>('/v1/auth/login', { method: 'POST', body: { email, password } }))
  const me = await call<{ account: { platformAdmin: boolean } }>('/v1/me', { auth: true })
  if (!me.account.platformAdmin) writeTokens(null)
  return me.account.platformAdmin
}

/** The language of the e-mails the Cloud sends to this address: the one the visitor reads the site in. */
export async function cloudSignup(name: string, email: string, password: string, lang: 'fr' | 'en' = 'fr'): Promise<void> {
  writeTokens(await call<Tokens>('/v1/auth/signup', { method: 'POST', body: { name, email, password, lang } }))
}

export interface CloudMe {
  name: string
  email: string
  /** False until the link of the verification e-mail is used (paying and paid work wait for it). */
  emailVerified: boolean
}

export async function cloudMe(): Promise<CloudMe> {
  const me = await call<{ account: { name: string; email: string; emailVerified?: boolean } }>('/v1/me', { auth: true })
  return { name: me.account.name, email: me.account.email, emailVerified: me.account.emailVerified !== false }
}

/** The /verifier page: spends the single-use link of the verification e-mail. */
export const cloudVerifyEmail = (token: string): Promise<{ ok: true }> => call('/v1/auth/verify-email', { method: 'POST', body: { token } })

/** The banner's button: a new verification e-mail for the signed-in account. */
export const cloudResendVerification = (): Promise<{ ok: true; alreadyVerified: boolean }> =>
  call('/v1/auth/resend-verification', { method: 'POST', auth: true, body: {} })

/** « Mot de passe oublié »: the Cloud answers ok whether or not an account uses this address. */
export const cloudForgotPassword = (email: string, lang: 'fr' | 'en'): Promise<{ ok: true }> =>
  call('/v1/auth/forgot-password', { method: 'POST', body: { email, lang } })

/** The /nouveau-mot-de-passe page: the single-use link plus the new password; every device of the account is signed out. */
export const cloudResetPassword = (token: string, password: string): Promise<{ ok: true }> =>
  call('/v1/auth/reset-password', { method: 'POST', body: { token, password } })

// ---- team invitations (the /invitation page; the link's token is the credential) -----------------------------------

export interface InvitePreview {
  teamName: string
  email: string
  invitedBy: string
  role: 'admin' | 'member'
  /** The address already has an account: sign in, then accept. */
  hasAccount: boolean
}

export const cloudInvitePreview = (token: string): Promise<InvitePreview> => call('/v1/invites/preview', { method: 'POST', body: { token } })

/** No account yet: creates it from the invitation (its address is confirmed by the link) and signs in. */
export async function cloudInviteSignup(token: string, name: string, password: string, lang: 'fr' | 'en' = 'fr'): Promise<void> {
  writeTokens(await call<Tokens>('/v1/invites/signup', { method: 'POST', body: { token, name, password, lang } }))
}

/** The signed-in account (its address must be the invitation's) joins the team. */
export const cloudInviteAccept = (token: string): Promise<{ team: { id: string; name: string }; role: 'admin' | 'member' }> =>
  call('/v1/invites/accept', { method: 'POST', auth: true, body: { token } })

export async function cloudLogin(email: string, password: string): Promise<{ name: string }> {
  writeTokens(await call<Tokens>('/v1/auth/login', { method: 'POST', body: { email, password } }))
  const me = await call<{ account: { name: string } }>('/v1/me', { auth: true })
  return { name: me.account.name }
}

export function cloudSignOut(): void {
  const t = readTokens()
  if (t) void call('/v1/auth/logout', { method: 'POST', auth: true }).catch(() => undefined)
  writeTokens(null)
}

export interface CloudMachine {
  id: string
  status: 'creating' | 'running' | 'hibernating' | 'hibernated' | 'resuming' | 'deleted' | 'error'
  serverType: string
  location: string
  demo: boolean
}

export const cloudMachines = (): Promise<{ provider: 'hetzner' | 'fake'; machines: CloudMachine[] }> => call('/v1/team/machines', { auth: true })

/**
 * Pays a plan. With the simulated payment the Cloud answers a demo session that the site completes at once; with
 * Stripe the browser goes to Stripe's page and comes back to `/bienvenue?paid=1`.
 */
export async function cloudSubscribe(plan: string, billing: 'monthly' | 'yearly'): Promise<'paid' | 'redirected'> {
  const origin = window.location.origin
  const out = await call<{ url: string; sessionId: string }>('/v1/billing/checkout', {
    method: 'POST',
    auth: true,
    body: { item: { kind: 'subscription', plan, period: billing === 'yearly' ? 'year' : 'month' }, successUrl: `${origin}/bienvenue?paid=1`, cancelUrl: `${origin}/bienvenue` }
  })
  if (out.url.includes('demo_session=')) {
    await call('/v1/billing/demo-complete', { method: 'POST', auth: true, body: { sessionId: out.sessionId } })
    return 'paid'
  }
  window.location.assign(out.url)
  return 'redirected'
}

// ---- the team's publication kits (src/shared/cloud-kit.ts is the contract; a test parses real answers with it) -------

export interface SiteKitFile {
  name: string
  mime: string
  size: number
  sha256: string
  /** Only on a single kit's answer: a short-lived link straight to the storage service. */
  url?: string
}

export interface SiteKit {
  id: string
  videoId: string
  title: string
  alternatives: string[]
  description: string
  tags: string[]
  chapters: { at: number; title: string }[]
  language: string
  demo: boolean
  createdAt: string
  expiresAt: string
  files: SiteKitFile[]
}

/** The team's kits, newest first, without links. */
export const cloudKits = (): Promise<{ kits: SiteKit[] }> => call('/v1/team/kits', { auth: true })

/** One video's kit with a fresh link per file (asked when a person clicks, so a link never goes stale on the page). */
export const cloudKit = (videoId: string): Promise<SiteKit> => call(`/v1/team/videos/${encodeURIComponent(videoId)}/kit`, { auth: true })
