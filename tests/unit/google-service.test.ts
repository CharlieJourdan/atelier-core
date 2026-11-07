// The Google connection end to end on an in-memory core (src/main/google): the IPC methods, the browser sign-in with PKCE
// and state through the loopback, the refused scopes, the token refresh, a revoked token that asks to reconnect, quota
// errors, the monetary fallback, the cache and the mapping to Atelier channels, the daily refresh. Google is a fake: never
// the network. The client secret and the refresh token go in and never come out.
import { afterEach, describe, expect, it } from 'vitest'
import { API_METHODS } from '../../src/shared/api'
import { GOOGLE_METHODS, GOOGLE_SCOPES, type GoogleChannelStats, type GoogleStatus } from '../../src/shared/api/google'
import { matchChannel, parseYoutubeRef } from '../../src/shared/youtube-ref'
import { LOCAL_WHEN_REMOTE } from '../../src/main/brain/route'
import { handleCall } from '../../src/main/ipc'
import { daysEnding, FakeGoogle } from './google-fake'
import { memoryCore } from './helpers'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const SECRET = 'GOCSPX-test-secret-value'
// 25 October 2026, noon UTC
const NOW = Date.parse('2026-10-25T12:00:00Z')

const open: ReturnType<typeof memoryCore>[] = []
afterEach(() => {
  for (const c of open.splice(0)) c.close()
})

function rig(o: { fake?: FakeGoogle; env?: Record<string, string>; browser?: (g: FakeGoogle) => (url: string) => Promise<void> } = {}) {
  const google = o.fake ?? new FakeGoogle()
  let now = NOW
  const clock = { set: (ms: number) => (now = ms), now: () => now }
  const core = memoryCore({
    google: { fetch: google.fetch, env: o.env ?? {}, now: () => now, connectTimeoutMs: 10_000 },
    openExternal: (url) => (o.browser ? o.browser(google) : google.browser())(url)
  })
  open.push(core)
  const results: unknown[] = []
  const call = async <T>(m: string, ...args: unknown[]): Promise<T> => {
    const res = await handleCall(core.api, m, args)
    if (!res.ok) throw Object.assign(new Error(`${m}: ${res.error.message}`), { code: res.error.code })
    results.push(res.value)
    return res.value as T
  }
  return { google, core, call, results, clock }
}

/** 56 days of figures ending today: the 28 older days have 100 views a day, the 28 last 150, revenue 2 € a day. */
function seedDays(g: FakeGoogle, id = 'UCaaaaaaaaaaaaaaaaaaaaaa'): void {
  g.days.set(id, daysEnding('2026-10-25', 56, (i) => ({ views: i < 28 ? 100 : 150, minutes: 300, gained: 5, lost: 1, revenue: 2 })))
}

describe('google IPC', () => {
  it('lists its 7 methods, all in the contract, all answered by this app even with a team computer connected', () => {
    expect([...GOOGLE_METHODS]).toEqual([
      'google.status', // client set / not set, connected, needs reconnect, scopes, last read, channels and their mapping
      'google.setClient', // the OAuth client pasted in Réglages (the secret encrypted)
      'google.clearClient', // forgets it (the environment's client, if any, again)
      'google.connect', // the browser sign-in: PKCE + state, loopback redirect, scope check, first read
      'google.disconnect', // revokes the token at Google, forgets it and the figures
      'google.refresh', // reads the channels and their figures now
      'google.channelStats' // the cached figures, per channel
    ])
    for (const m of GOOGLE_METHODS) {
      expect(API_METHODS).toContain(m)
      expect(LOCAL_WHEN_REMOTE.has(m)).toBe(true)
    }
  })

  it('connects through the browser, reads the figures, and never returns the secret or a token', async () => {
    const r = rig()
    seedDays(r.google)
    r.core.context.workflow.channels.create({ name: 'Histoires', youtubeChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' })
    expect(await r.call<GoogleStatus>('google.status')).toMatchObject({ clientIdSet: false, connected: false, needsReconnect: false })
    const noClient = await handleCall(r.core.api, 'google.connect', [])
    expect(noClient).toMatchObject({ ok: false, error: { code: 'noClient' } })
    const bad = await handleCall(r.core.api, 'google.setClient', [{ clientId: 'x' }])
    expect(bad.ok).toBe(false)
    expect(await r.call<GoogleStatus>('google.setClient', { clientId: CLIENT_ID, clientSecret: SECRET })).toMatchObject({
      clientIdSet: true,
      clientId: CLIENT_ID,
      clientSecretSet: true,
      clientSource: 'settings'
    })
    const st = await r.call<GoogleStatus>('google.connect')
    expect(st).toMatchObject({ connected: true, needsReconnect: false, connecting: false, lastError: null })
    expect([...st.scopes].sort()).toEqual([...GOOGLE_SCOPES].sort())
    expect(st.channels).toEqual([
      { youtubeChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Histoires vraies', handle: '@histoiresvraies', atelierChannelId: expect.any(Number), atelierChannelName: 'Histoires', revenueAvailable: true }
    ])
    // the sign-in address the browser got
    const auth = r.google.authUrls[0] as URL
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/)
    // the code exchange carried the verifier whose S256 is that challenge (the fake checked it) and the client secret
    const exchange = r.google.calls.find((c) => c.body?.includes('grant_type=authorization_code'))
    expect(exchange?.body).toContain('code_verifier=')
    expect(exchange?.body).toContain(`client_secret=${SECRET}`)

    const stats = await r.call<GoogleChannelStats>('google.channelStats')
    expect(stats.connected).toBe(true)
    expect(stats.lastRefreshAt).toBe('2026-10-25T12:00:00.000Z')
    expect(stats.channels).toHaveLength(1)
    expect(stats.channels[0]).toMatchObject({
      youtubeChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      subscribers: 12_400,
      views28d: 28 * 150,
      viewsPrev28d: 28 * 100,
      trendPct: 50,
      watchMinutes28d: 28 * 300,
      subscribersNet28d: 28 * 4,
      revenue28dEur: 56,
      month: '2026-10',
      monthViews: 25 * 150,
      monthRevenueEur: 50
    })
    // the cache is SQLite (migration 023)
    expect((r.core.db.prepare('SELECT COUNT(*) AS n FROM google_channel_days').get() as { n: number }).n).toBe(56)

    // nothing the renderer received holds a secret
    const everything = JSON.stringify(r.results)
    expect(everything).not.toContain(SECRET)
    expect(everything).not.toMatch(/1\/\/refresh|ya29\.|4\/code/)
    // both secrets are encrypted at rest
    const rows = r.core.db.prepare("SELECT name, ciphertext FROM secrets WHERE name LIKE 'google.%' ORDER BY name").all() as { name: string; ciphertext: Uint8Array }[]
    expect(rows.map((x) => x.name)).toEqual(['google.clientSecret', 'google.refreshToken'])
    for (const row of rows) expect(Buffer.from(row.ciphertext).toString('utf8')).not.toMatch(/GOCSPX|1\/\//)
    expect(JSON.stringify(r.core.context.settings.all())).not.toMatch(/GOCSPX|1\/\/|ya29/)

    // disconnect: revoked at Google, forgotten here
    const off = await r.call<GoogleStatus>('google.disconnect')
    expect(off).toMatchObject({ connected: false, channels: [], lastRefreshAt: null })
    expect(r.google.revokedTokens).toEqual([expect.stringMatching(/^1\/\/refresh-/)])
    expect((await r.call<GoogleChannelStats>('google.channelStats')).channels).toEqual([])
  })

  it('takes the client from ATELIER_GOOGLE_CLIENT_ID / _SECRET when none is pasted', async () => {
    const r = rig({ env: { ATELIER_GOOGLE_CLIENT_ID: CLIENT_ID, ATELIER_GOOGLE_CLIENT_SECRET: SECRET } })
    seedDays(r.google)
    expect(await r.call<GoogleStatus>('google.status')).toMatchObject({ clientIdSet: true, clientSource: 'env', clientSecretSet: true })
    expect(await r.call<GoogleStatus>('google.connect')).toMatchObject({ connected: true })
    expect(JSON.stringify(r.results)).not.toContain(SECRET)
  })

  it('a forged state on the redirect is refused: no code exchange, nothing stored', async () => {
    const r = rig({ browser: (g) => g.browser({ state: () => 'forged-state' }) })
    await r.call('google.setClient', { clientId: CLIENT_ID })
    const res = await handleCall(r.core.api, 'google.connect', [])
    expect(res).toMatchObject({ ok: false, error: { code: 'state' } })
    expect(r.google.calls.some((c) => c.url.includes('/token'))).toBe(false)
    expect(await r.call<GoogleStatus>('google.status')).toMatchObject({ connected: false, lastError: { code: 'state' } })
  })

  it('refused scopes: the grant is handed back to Google and nothing is kept', async () => {
    const g = new FakeGoogle()
    // the person unticked « revenus estimés » on Google's consent screen
    g.grantScope = GOOGLE_SCOPES.filter((s) => !s.includes('monetary')).join(' ')
    const r = rig({ fake: g })
    await r.call('google.setClient', { clientId: CLIENT_ID, clientSecret: SECRET })
    const res = await handleCall(r.core.api, 'google.connect', [])
    expect(res).toMatchObject({ ok: false, error: { code: 'scopes' } })
    expect(g.revokedTokens).toHaveLength(1)
    expect(await r.call<GoogleStatus>('google.status')).toMatchObject({ connected: false, lastError: { code: 'scopes' } })
    expect(r.core.context.secrets.has('google.refreshToken')).toBe(false)
    // and a grant with a write scope is refused the same way
    g.grantScope = `${GOOGLE_SCOPES.join(' ')} https://www.googleapis.com/auth/youtube.force-ssl`
    expect(await handleCall(r.core.api, 'google.connect', [])).toMatchObject({ ok: false, error: { code: 'scopes' } })
    expect(g.revokedTokens).toHaveLength(2)
  })

  it('a refusal in the browser is reported as such', async () => {
    const r = rig({ browser: (g) => g.browser({ error: 'access_denied' }) })
    await r.call('google.setClient', { clientId: CLIENT_ID })
    expect(await handleCall(r.core.api, 'google.connect', [])).toMatchObject({ ok: false, error: { code: 'denied' } })
  })
})

describe('reading the figures', () => {
  async function connected(o: { fake?: FakeGoogle } = {}) {
    const r = rig(o)
    seedDays(r.google)
    await r.call('google.setClient', { clientId: CLIENT_ID, clientSecret: SECRET })
    await r.call('google.connect')
    return r
  }
  const tokenCalls = (g: FakeGoogle): number => g.calls.filter((c) => c.body?.includes('grant_type=refresh_token')).length

  it('refreshes the access token once it expires, and once more when Google drops it early', async () => {
    const r = await connected()
    expect(tokenCalls(r.google)).toBe(0)
    await r.call('google.refresh')
    expect(tokenCalls(r.google)).toBe(0) // the first access token is still good
    r.clock.set(NOW + 2 * 3_600_000)
    await r.call('google.refresh')
    expect(tokenCalls(r.google)).toBe(1)
    r.google.dropAccessOnce = true
    expect(await r.call<GoogleStatus>('google.refresh')).toMatchObject({ lastError: null })
    expect(tokenCalls(r.google)).toBe(2)
  })

  it('a revoked token asks to reconnect: the token is forgotten, the last figures stay, nothing retries in a loop', async () => {
    const r = await connected()
    r.google.revoked = true
    r.clock.set(NOW + 2 * 3_600_000)
    const res = await handleCall(r.core.api, 'google.refresh', [])
    expect(res).toMatchObject({ ok: false, error: { code: 'reconnect' } })
    const st = await r.call<GoogleStatus>('google.status')
    expect(st).toMatchObject({ connected: false, needsReconnect: true, lastError: { code: 'reconnect' } })
    expect(r.core.context.secrets.has('google.refreshToken')).toBe(false)
    const stats = await r.call<GoogleChannelStats>('google.channelStats')
    expect(stats).toMatchObject({ connected: false, needsReconnect: true })
    expect(stats.channels).toHaveLength(1)
    const before = r.google.calls.length
    expect(await handleCall(r.core.api, 'google.refresh', [])).toMatchObject({ ok: false, error: { code: 'reconnect' } })
    expect(r.google.calls.length).toBe(before)
    // connecting again clears it
    r.google.revoked = false
    expect(await r.call<GoogleStatus>('google.connect')).toMatchObject({ connected: true, needsReconnect: false, lastError: null })
  })

  it('quota errors are reported, not retried, and the earlier figures stay', async () => {
    const r = await connected()
    r.google.reportFailures.push({ status: 403, body: { error: { code: 403, errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } } })
    const before = r.google.calls.length
    expect(await handleCall(r.core.api, 'google.refresh', [])).toMatchObject({ ok: false, error: { code: 'quota' } })
    // channels.list then one report: no second report without revenue after a quota refusal
    expect(r.google.calls.length - before).toBe(2)
    expect(await r.call<GoogleStatus>('google.status')).toMatchObject({ connected: true, needsReconnect: false, lastError: { code: 'quota' } })
    expect((await r.call<GoogleChannelStats>('google.channelStats')).channels[0]?.views28d).toBe(28 * 150)
    r.google.reportFailures.push({ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } })
    expect(await handleCall(r.core.api, 'google.refresh', [])).toMatchObject({ ok: false, error: { code: 'quota' } })
  })

  it('a channel outside the Partner Program still gives its views, with no revenue', async () => {
    const g = new FakeGoogle()
    g.noMonetary = true
    const r = await connected({ fake: g })
    const stats = await r.call<GoogleChannelStats>('google.channelStats')
    expect(stats.channels[0]).toMatchObject({ views28d: 28 * 150, revenue28dEur: null, monthRevenueEur: null })
    expect((await r.call<GoogleStatus>('google.status')).channels[0]?.revenueAvailable).toBe(false)
  })

  it('several channels on the account: each is asked by its own id; the ones that left the account are dropped', async () => {
    const g = new FakeGoogle()
    g.channels.push({ id: 'UCbbbbbbbbbbbbbbbbbbbbbb', title: 'Mystères', customUrl: '@mysteres', subscribers: 300 })
    seedDays(g, 'UCbbbbbbbbbbbbbbbbbbbbbb')
    const r = await connected({ fake: g })
    const reports = g.calls.filter((c) => c.url.includes('/v2/reports')).map((c) => new URL(c.url).searchParams.get('ids'))
    expect(reports).toEqual(['channel==UCaaaaaaaaaaaaaaaaaaaaaa', 'channel==UCbbbbbbbbbbbbbbbbbbbbbb'])
    const q = new URL(g.calls.find((c) => c.url.includes('/v2/reports'))?.url ?? '')
    expect(q.searchParams.get('metrics')).toBe('views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue')
    expect(q.searchParams.get('dimensions')).toBe('day')
    expect(q.searchParams.get('currency')).toBe('EUR')
    expect(q.searchParams.get('startDate')).toBe('2026-08-31')
    expect(q.searchParams.get('endDate')).toBe('2026-10-25')
    expect((await r.call<GoogleChannelStats>('google.channelStats')).channels).toHaveLength(2)
    g.channels.pop()
    await r.call('google.refresh')
    expect((await r.call<GoogleChannelStats>('google.channelStats')).channels.map((c) => c.youtubeChannelId)).toEqual(['UCaaaaaaaaaaaaaaaaaaaaaa'])
    // a single channel is asked as channel==MINE
    expect(new URL(g.calls.filter((c) => c.url.includes('/v2/reports')).at(-1)?.url ?? '').searchParams.get('ids')).toBe('channel==MINE')
  })

  it('refreshes once a day by itself, never more', async () => {
    const r = await connected()
    const reads = (): number => r.google.calls.filter((c) => c.url.includes('/youtube/v3/channels')).length
    expect(reads()).toBe(1)
    r.clock.set(NOW + 6 * 3_600_000)
    await r.core.context.google.tick()
    expect(reads()).toBe(1)
    r.clock.set(NOW + 25 * 3_600_000)
    await r.core.context.google.tick()
    expect(reads()).toBe(2)
  })

  it('another client id means connecting again', async () => {
    const r = await connected()
    expect(await r.call<GoogleStatus>('google.setClient', { clientId: 'another-client.apps.googleusercontent.com' })).toMatchObject({ connected: false, channels: [] })
  })
})

describe('the mapping to Atelier channels', () => {
  const yt = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', handle: '@HistoiresVraies' }
  const ch = (id: number, youtubeChannelId: string | null) => ({ id, name: `c${id}`, youtubeChannelId })

  it('reads an id, an @handle or a channel address from the channel’s YouTube field', () => {
    expect(parseYoutubeRef('UCaaaaaaaaaaaaaaaaaaaaaa')).toEqual({ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', handle: null })
    expect(parseYoutubeRef('https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa/videos')).toEqual({ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', handle: null })
    expect(parseYoutubeRef('@HistoiresVraies')).toEqual({ id: null, handle: '@histoiresvraies' })
    expect(parseYoutubeRef('https://www.youtube.com/@HistoiresVraies')).toEqual({ id: null, handle: '@histoiresvraies' })
    expect(parseYoutubeRef('histoiresvraies')).toEqual({ id: null, handle: '@histoiresvraies' })
    expect(parseYoutubeRef('')).toEqual({ id: null, handle: null })
    expect(parseYoutubeRef(null)).toEqual({ id: null, handle: null })
  })

  it('matches by channel id first, then by handle (any case), else nothing', () => {
    expect(matchChannel(yt, [ch(1, '@histoiresvraies'), ch(2, 'UCaaaaaaaaaaaaaaaaaaaaaa')])?.id).toBe(2)
    expect(matchChannel(yt, [ch(1, 'https://youtube.com/@HISTOIRESVRAIES'), ch(2, null)])?.id).toBe(1)
    expect(matchChannel(yt, [ch(1, 'UCbbbbbbbbbbbbbbbbbbbbbb'), ch(2, '@autre')])).toBeNull()
    expect(matchChannel({ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', handle: null }, [ch(1, '@histoiresvraies')])).toBeNull()
  })

  it('linking a channel in Atelier (its YouTube field) maps the cached figures at once', async () => {
    const r = rig()
    seedDays(r.google)
    const c = r.core.context.workflow.channels.create({ name: 'Sans lien' })
    await r.call('google.setClient', { clientId: CLIENT_ID })
    expect((await r.call<GoogleStatus>('google.connect')).channels[0]?.atelierChannelId).toBeNull()
    r.core.context.workflow.channels.update(c.id, { youtubeChannelId: '@histoiresvraies' })
    expect((await r.call<GoogleStatus>('google.status')).channels[0]).toMatchObject({ atelierChannelId: c.id, atelierChannelName: 'Sans lien' })
    expect((await r.call<GoogleChannelStats>('google.channelStats')).channels[0]?.atelierChannelId).toBe(c.id)
  })
})
