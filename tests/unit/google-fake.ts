// An in-memory Google for the tests of src/main/google: the token endpoint (authorization code with its PKCE verifier,
// refresh, revoke), the Data API's channels.list and the Analytics API's reports. Never the network: the service gets this
// `fetch`. `browser()` plays the person in the browser: it reads the sign-in address and calls the app's loopback redirect.
import { createHash } from 'node:crypto'
import { GOOGLE_SCOPES } from '../../src/shared/api/google'

export interface FakeChannel {
  id: string
  title: string
  customUrl?: string
  subscribers?: number
  hidden?: boolean
  views?: number
}

export interface FakeDay {
  day: string
  views: number
  minutes: number
  gained: number
  lost: number
  revenue: number
}

type Init = { method: string; headers: Record<string, string>; body?: string }

export class FakeGoogle {
  /** The scopes the token endpoint says it granted (default: exactly ours). */
  grantScope: string = GOOGLE_SCOPES.join(' ')
  giveRefresh = true
  channels: FakeChannel[] = [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Histoires vraies', customUrl: '@histoiresvraies', subscribers: 12_400, views: 900_000 }]
  /** Days per channel id (the reports answer only the asked window). */
  days = new Map<string, FakeDay[]>()
  /** Next answers of the reports endpoint, consumed first (e.g. a quota 403). */
  reportFailures: { status: number; body: unknown }[] = []
  /** The channel is not in the Partner Program: a report asking estimatedRevenue gets a 403. */
  noMonetary = false
  /** The grant was revoked at Google: refreshing answers invalid_grant, the API answers 401. */
  revoked = false
  /** The next API call answers 401 once (an access token Google dropped early). */
  dropAccessOnce = false

  readonly calls: { method: string; url: string; body?: string }[] = []
  readonly revokedTokens: string[] = []
  authUrls: URL[] = []
  private challenge: string | null = null
  private issued = 0
  private access = new Set<string>()
  private refreshTokens = new Set<string>()
  private codes = new Map<string, { challenge: string; redirectUri: string }>()

  readonly fetch = async (url: string, init: Init): Promise<Response> => {
    this.calls.push({ method: init.method, url, ...(init.body !== undefined ? { body: init.body } : {}) })
    const u = new URL(url)
    if (u.origin === 'https://oauth2.googleapis.com' && u.pathname === '/token') return this.token(new URLSearchParams(init.body ?? ''))
    if (u.origin === 'https://oauth2.googleapis.com' && u.pathname === '/revoke') {
      this.revokedTokens.push(new URLSearchParams(init.body ?? '').get('token') ?? '')
      return json(200, {})
    }
    const auth = /^Bearer (.+)$/.exec(init.headers.authorization ?? '')?.[1] ?? ''
    if (this.revoked || !this.access.has(auth)) return json(401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'invalid credentials' } })
    if (this.dropAccessOnce) {
      this.dropAccessOnce = false
      this.access.delete(auth)
      return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } })
    }
    if (u.origin === 'https://www.googleapis.com' && u.pathname === '/youtube/v3/channels') {
      if (u.searchParams.get('mine') !== 'true') return json(400, { error: { code: 400 } })
      return json(200, {
        items: this.channels.map((c) => ({
          id: c.id,
          snippet: { title: c.title, ...(c.customUrl ? { customUrl: c.customUrl } : {}) },
          statistics: { subscriberCount: String(c.subscribers ?? 0), hiddenSubscriberCount: c.hidden === true, viewCount: String(c.views ?? 0) }
        }))
      })
    }
    if (u.origin === 'https://youtubeanalytics.googleapis.com' && u.pathname === '/v2/reports') return this.report(u.searchParams)
    return json(404, { error: { code: 404 } })
  }

  private token(form: URLSearchParams): Response {
    if (form.get('client_id') !== 'test-client.apps.googleusercontent.com') return json(401, { error: 'invalid_client' })
    const grant = form.get('grant_type')
    if (grant === 'authorization_code') {
      const code = this.codes.get(form.get('code') ?? '')
      if (!code) return json(400, { error: 'invalid_grant' })
      this.codes.delete(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      if (createHash('sha256').update(verifier).digest('base64url') !== code.challenge) return json(400, { error: 'invalid_grant', error_description: 'code verifier' })
      if (form.get('redirect_uri') !== code.redirectUri) return json(400, { error: 'redirect_uri_mismatch' })
      const access = this.newAccess()
      const refresh = `1//refresh-${++this.issued}`
      this.refreshTokens.add(refresh)
      return json(200, { access_token: access, expires_in: 3599, token_type: 'Bearer', scope: this.grantScope, ...(this.giveRefresh ? { refresh_token: refresh } : {}) })
    }
    if (grant === 'refresh_token') {
      if (this.revoked || !this.refreshTokens.has(form.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      return json(200, { access_token: this.newAccess(), expires_in: 3599, token_type: 'Bearer', scope: this.grantScope })
    }
    return json(400, { error: 'unsupported_grant_type' })
  }

  private newAccess(): string {
    const a = `ya29.access-${++this.issued}`
    this.access.add(a)
    return a
  }

  private report(q: URLSearchParams): Response {
    const fail = this.reportFailures.shift()
    if (fail) return json(fail.status, fail.body)
    const metrics = (q.get('metrics') ?? '').split(',')
    if (metrics.includes('estimatedRevenue') && this.noMonetary) return json(403, { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'forbidden' }] } })
    const ids = q.get('ids') ?? ''
    const id = ids === 'channel==MINE' ? (this.channels[0]?.id ?? '') : ids.replace(/^channel==/, '')
    const from = q.get('startDate') ?? ''
    const to = q.get('endDate') ?? ''
    const rows = (this.days.get(id) ?? [])
      .filter((d) => d.day >= from && d.day <= to)
      .map((d) => {
        const all: Record<string, unknown> = { day: d.day, views: d.views, estimatedMinutesWatched: d.minutes, subscribersGained: d.gained, subscribersLost: d.lost, estimatedRevenue: d.revenue }
        return ['day', ...metrics].map((m) => all[m])
      })
    return json(200, { kind: 'youtubeAnalytics#resultTable', columnHeaders: ['day', ...metrics].map((name) => ({ name })), rows })
  }

  /** The person in the browser: reads the sign-in address, approves, and lets Google redirect to the app's loopback. */
  browser(o: { state?: (s: string) => string; error?: string } = {}): (url: string) => Promise<void> {
    return async (raw) => {
      const url = new URL(raw)
      this.authUrls.push(url)
      this.challenge = url.searchParams.get('code_challenge')
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
      const state = url.searchParams.get('state') ?? ''
      const code = `4/code-${++this.issued}`
      this.codes.set(code, { challenge: this.challenge ?? '', redirectUri: redirect.toString() })
      const back = new URL(redirect)
      back.searchParams.set('state', o.state ? o.state(state) : state)
      if (o.error) back.searchParams.set('error', o.error)
      else back.searchParams.set('code', code)
      // like a browser: follow the redirect in the background
      void fetch(back).then((r) => r.text()).catch(() => undefined)
    }
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** `n` days of figures ending at `lastDay` (one a day, oldest first). */
export function daysEnding(lastDay: string, n: number, f: (i: number) => Omit<FakeDay, 'day'>): FakeDay[] {
  const end = Date.parse(`${lastDay}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => ({ day: new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), ...f(i) }))
}
