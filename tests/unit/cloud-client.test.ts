// The app's Atelier Cloud client (lot P5) against an in-process Cloud on the loopback (fakes, nothing paid): device login
// with PKCE, tokens kept encrypted and never shown, refresh with rotation, sign-out, an unreachable Cloud, the address
// rule and the catalogue → feature registry mapping.
import { describe, expect, it } from 'vitest'
import { catalogToFeatures, type Catalog } from '../../src/main/cloud/client'
import { ACCESS_SECRET, MSG, normaliseBaseUrl, REFRESH_SECRET } from '../../src/main/cloud/session'
import { handleCall } from '../../src/main/ipc'
import { UNREACHABLE } from '../../src/engine/cloud-http'
import { API_METHODS } from '../../src/shared/api'
import { featureState, type FeatureContext } from '../../src/shared/features'
import { appCore, connect, startCloud, type AppRig } from './cloud-app-helpers'

const HOUR = 3600_000

/** Every Cloud IPC result of the app, as the renderer would receive it (JSON envelopes). */
async function everyResult(app: AppRig): Promise<string> {
  const out: unknown[] = []
  for (const m of ['cloud.status', 'cloud.loginState', 'cloud.account', 'cloud.catalog', 'cloud.spend', 'settings.list'] as const) {
    out.push(await handleCall(app.core.api, m, []))
  }
  return JSON.stringify(out)
}

const tokensOf = (app: AppRig) => ({
  access: app.core.context.secrets.get(ACCESS_SECRET),
  refresh: app.core.context.secrets.get(REFRESH_SECRET)
})

describe('device login', () => {
  it('connects through the browser with PKCE, keeps the tokens encrypted and never shows them', async () => {
    const rig = await startCloud(1000)
    const app = appCore()
    const api = app.core.api
    expect(await api['cloud.account']()).toBeNull()
    expect(await api['cloud.catalog']()).toBeNull()
    expect(api['cloud.status']()).toMatchObject({ connected: false, deviceId: null, baseUrl: 'http://127.0.0.1:8787' })

    await api['cloud.setBaseUrl'](rig.baseUrl)
    const pending = await api['cloud.connect']()
    expect(pending).toMatchObject({ pending: true, userCode: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) })
    // the browser was opened on the Cloud's approval page
    expect(app.opened).toHaveLength(1)
    expect(app.opened[0]).toMatch(new RegExp(`^${rig.baseUrl}/device\\?code=`))
    expect(api['cloud.loginState']()).toEqual(pending)

    await connect(app, rig) // a second login replaces the first one, then the test approves it
    const status = api['cloud.status']()
    expect(status).toMatchObject({
      connected: true,
      baseUrl: rig.baseUrl,
      deviceId: expect.stringMatching(/\S/),
      account: { email: rig.email, name: 'Charlie', teamName: 'Studio Charlie' }
    })

    const { access, refresh } = tokensOf(app)
    expect(access).toMatch(/\S{20}/)
    expect(refresh).toMatch(/\S{20}/)
    const rows = app.core.db.prepare(`SELECT name, ciphertext FROM secrets WHERE name LIKE 'cloud.%' ORDER BY name`).all() as { name: string; ciphertext: Uint8Array }[]
    expect(rows.map((r) => r.name)).toEqual([ACCESS_SECRET, REFRESH_SECRET])
    for (const r of rows) {
      const stored = Buffer.from(r.ciphertext).toString('latin1')
      expect(stored).not.toContain(access as string)
      expect(stored).not.toContain(refresh as string)
    }

    const account = await api['cloud.account']()
    expect(account).toMatchObject({
      email: rig.email,
      teamName: 'Studio Charlie',
      role: 'owner',
      wallet: { balance: 1000, held: 0, available: 1000 },
      caps: { dailyCredits: null, monthlyCredits: null }
    })
    // the credit value comes from a free estimate (the grid's value of one credit)
    expect(account?.creditValueEur).toBeGreaterThan(0)
    const catalog = await api['cloud.catalog']()
    // the test Cloud has paid calls off: every function it offers is demo, and the wallet holds credits
    expect(catalog?.hasCredits).toBe(true)
    expect(Object.keys(catalog?.functions ?? {}).sort()).toEqual(['avatar', 'gpu-render', 'image-generation', 'stock-media', 'video-analysis', 'video-generation', 'voice-platform', 'youtube-research'])
    expect(Object.values(catalog?.functions ?? {}).every((s) => s === 'demo')).toBe(true)

    const json = await everyResult(app)
    expect(json).not.toContain(access as string)
    expect(json).not.toContain(refresh as string)
    expect(json).toContain(rig.email)
  })

  it('a login nobody approves in time ends with a French message; cancel goes back to idle', async () => {
    const rig = await startCloud(0)
    const app = appCore()
    const api = app.core.api
    await api['cloud.setBaseUrl'](rig.baseUrl)
    await api['cloud.connect']()
    app.clock.now += 11 * 60_000
    await expect.poll(() => api['cloud.loginState'](), { timeout: 5000, interval: 10 }).toEqual({ error: true, message: MSG.loginExpired })
    expect(app.core.cloud.session.status().connected).toBe(false)
    api['cloud.cancelLogin']()
    expect(api['cloud.loginState']()).toBe('idle')

    await api['cloud.connect']()
    api['cloud.cancelLogin']()
    expect(api['cloud.loginState']()).toBe('idle')
  })
})

describe('tokens', () => {
  it('refreshes an access token about to expire, rotates both tokens, and shares one refresh between callers', async () => {
    const rig = await startCloud(500)
    const app = appCore()
    await connect(app, rig)
    const before = tokensOf(app)
    const session = app.core.cloud.session
    expect(await session.token()).toBe(before.access)

    // 59 min later the token expires within the minute: it is refreshed first (the Cloud's clock moves too)
    app.clock.now += HOUR - 59_000
    rig.t.clock.advance(HOUR - 59_000)
    const [a, b, c] = await Promise.all([session.token(), session.token(), session.token()])
    expect(a).not.toBe(before.access)
    expect(b).toBe(a)
    expect(c).toBe(a)
    const after = tokensOf(app)
    expect(after.access).toBe(a)
    expect(after.refresh).not.toBe(before.refresh)
    expect(session.status().connected).toBe(true)
    expect(await app.core.api['cloud.account']()).toMatchObject({ wallet: { balance: 500 } })
    expect(await everyResult(app)).not.toContain(after.refresh as string)
    // the old refresh token was spent: using it again is a theft signal and the Cloud revokes the device
    const old = await rig.t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: before.refresh } })
    expect(old.statusCode).toBe(401)
    // the next call finds its token refused, tries a refresh, is refused too: the app is signed out
    expect(await app.core.api['cloud.account']()).toBeNull()
    expect(app.core.cloud.session.status().connected).toBe(false)
  })

  it('a refused refresh signs the app out with the French message', async () => {
    const rig = await startCloud(0)
    const app = appCore()
    await connect(app, rig)
    const deviceId = app.core.cloud.session.status().deviceId as string
    rig.t.cloud.auth.revokeDevice(deviceId, { accountId: rig.accountId, platformAdmin: true })
    app.clock.now += HOUR
    rig.t.clock.advance(HOUR)
    await expect(app.core.cloud.session.token()).rejects.toMatchObject({ code: 'missing_tool', message: MSG.expired })
    expect(app.core.cloud.session.status()).toMatchObject({ connected: false, deviceId: null })
    expect(app.core.context.secrets.has(ACCESS_SECRET)).toBe(false)
    expect(app.core.context.secrets.has(REFRESH_SECRET)).toBe(false)
    await expect(app.core.cloud.session.token()).rejects.toThrow(MSG.notConnected)
    expect(await app.core.api['cloud.account']()).toBeNull()
  })

  it('a refresh still on its way when the app signs out never writes its tokens back', async () => {
    const rig = await startCloud(0)
    for (const signOut of ['disconnect', 'another Cloud'] as const) {
      const app = appCore()
      await connect(app, rig)
      let release: () => void = () => undefined
      const held = new Promise<void>((r) => (release = r))
      let reached: () => void = () => undefined
      const atGate = new Promise<void>((r) => (reached = r))
      app.net.gate = (url) => (url.endsWith('/v1/auth/refresh') ? (reached(), held) : Promise.resolve())
      app.clock.now += HOUR
      const refreshing = app.core.cloud.session.token()
      await atGate // the Cloud answered the refresh; the answer is not back yet
      app.net.gate = null
      if (signOut === 'disconnect') await app.core.api['cloud.disconnect']()
      else await app.core.api['cloud.setBaseUrl']('https://other.example.com')
      release()
      await expect(refreshing, signOut).rejects.toMatchObject({ code: 'missing_tool', message: MSG.notConnected })
      expect(tokensOf(app), signOut).toEqual({ access: null, refresh: null })
      expect(app.core.cloud.session.status().connected, signOut).toBe(false)
    }
  })

  it('disconnect revokes the device on the Cloud and forgets the tokens', async () => {
    const rig = await startCloud(0)
    const app = appCore()
    await connect(app, rig)
    const { access } = tokensOf(app)
    expect(await handleCall(app.core.api, 'cloud.disconnect', [])).toEqual({ ok: true })
    expect(app.core.cloud.session.status()).toMatchObject({ connected: false })
    expect(app.core.api['cloud.loginState']()).toBe('idle')
    expect(tokensOf(app)).toEqual({ access: null, refresh: null })
    const me = await rig.t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${access as string}` } })
    expect(me.statusCode).toBe(401)
  })
})

describe('an unreachable Cloud', () => {
  it('answers the French message, and the catalogue becomes null (every Cloud function stays demo)', async () => {
    const rig = await startCloud(100)
    const app = appCore()
    await connect(app, rig)
    app.net.down = true
    expect(await handleCall(app.core.api, 'cloud.account', [])).toEqual({ ok: false, error: { code: 'transient', message: UNREACHABLE } })
    expect(await handleCall(app.core.api, 'cloud.catalog', [])).toEqual({ ok: true, value: null })
    await expect(app.core.cloud.api.wallet()).rejects.toThrow(UNREACHABLE)
    // still connected: the tokens are kept for when the Cloud is back
    expect(app.core.cloud.session.status().connected).toBe(true)
    app.net.down = false
    expect(await app.core.cloud.api.wallet()).toMatchObject({ balance: 100 })
  })

  it('a login cannot start, with the same message', async () => {
    const app = appCore()
    app.net.down = true
    expect(await handleCall(app.core.api, 'cloud.connect', [])).toEqual({ ok: false, error: { code: 'transient', message: UNREACHABLE } })
    expect(app.opened).toEqual([])
  })

  it('a Cloud that is not listening at all is unreachable too', async () => {
    const app = appCore()
    await app.core.api['cloud.setBaseUrl']('http://127.0.0.1:9')
    const r = await handleCall(app.core.api, 'cloud.connect', [])
    expect(r).toEqual({ ok: false, error: { code: 'transient', message: UNREACHABLE } })
    expect(await app.core.cloud.api.catalog().catch((e: Error) => e.message)).toBe(MSG.notConnected)
  })
})

describe('the Cloud address', () => {
  it('accepts https anywhere and http only on this computer', async () => {
    expect(normaliseBaseUrl('https://cloud.example.com/')).toBe('https://cloud.example.com')
    expect(normaliseBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(normaliseBaseUrl('http://localhost:9000/')).toBe('http://localhost:9000')
    expect(normaliseBaseUrl('http://[::1]:8787')).toBe('http://[::1]:8787')
    for (const bad of ['http://cloud.example.com', 'http://192.168.1.10:8787', 'ftp://127.0.0.1', 'https://u:p@cloud.example.com', 'https://cloud.example.com/v1', 'nope', '']) {
      expect(normaliseBaseUrl(bad), bad).toBeNull()
    }
    const app = appCore()
    expect(await handleCall(app.core.api, 'cloud.setBaseUrl', ['http://cloud.example.com'])).toEqual({ ok: false, error: { code: 'ERROR', message: MSG.badUrl } })
    expect(await app.core.api['cloud.setBaseUrl']('https://cloud.example.com/')).toMatchObject({ baseUrl: 'https://cloud.example.com', connected: false })
    // the address is not writable through the generic settings call
    expect(await handleCall(app.core.api, 'settings.set', ['cloud.baseUrl', 'http://evil.example.com'])).toMatchObject({ ok: false })
    expect(app.core.cloud.session.baseUrl()).toBe('https://cloud.example.com')
  })

  it('moving to another Cloud signs the app out of the previous one', async () => {
    const rig = await startCloud(0)
    const app = appCore()
    await connect(app, rig)
    await app.core.api['cloud.setBaseUrl'](rig.baseUrl) // same address: nothing changes
    expect(app.core.cloud.session.status().connected).toBe(true)
    await app.core.api['cloud.setBaseUrl']('https://other.example.com')
    expect(app.core.cloud.session.status()).toMatchObject({ connected: false, baseUrl: 'https://other.example.com' })
  })
})

describe('catalogue → features', () => {
  const catalog = (paidCalls: boolean, real: string[]): Catalog => ({
    paidCalls,
    providers: (['synthesize', 'generateImage', 'generateVideo', 'talkingAvatar', 'channelData', 'analyseVideo', 'submitGpuJob'] as const).map((usage) => ({
      usage,
      provider: `p-${usage}`,
      status: real.includes(usage) ? ('real' as const) : ('demo' as const),
      reason: null
    })),
    voices: [],
    models: []
  })

  it('maps each usage to its feature; stock media (a catalogue without the stock usage) and the platform Claude API stay absent (demo)', () => {
    const c = catalogToFeatures(catalog(true, ['synthesize', 'submitGpuJob', 'channelData']), { available: 10 })
    expect(c).toEqual({
      functions: {
        'voice-platform': 'real',
        'image-generation': 'demo',
        'video-generation': 'demo',
        avatar: 'demo',
        'youtube-research': 'real',
        'video-analysis': 'demo',
        'gpu-render': 'real'
      },
      hasCredits: true
    })
    const ctx: FeatureContext = { cloud: c, youtubeConnected: false }
    expect(featureState('voice-platform', ctx).status).toBe('real')
    expect(featureState('image-generation', ctx).status).toBe('demo')
    expect(featureState('stock-media', ctx).status).toBe('demo')
    expect(featureState('claude-platform-api', ctx).status).toBe('demo')
  })

  it('the stock search makes the stock-media feature real when its provider is', () => {
    const withStock = (status: 'real' | 'demo'): Catalog => ({ ...catalog(true, []), providers: [{ usage: 'searchStock', provider: 'pexels', status, reason: null }] })
    expect(catalogToFeatures(withStock('real'), { available: 10 }).functions['stock-media']).toBe('real')
    expect(catalogToFeatures(withStock('demo'), { available: 10 }).functions['stock-media']).toBe('demo')
    expect(featureState('stock-media', { cloud: catalogToFeatures(withStock('real'), { available: 10 }), youtubeConnected: false }).status).toBe('real')
  })

  it('paid calls off keeps everything demo; an empty wallet makes real functions need credits', () => {
    const off = catalogToFeatures(catalog(false, ['synthesize']), { available: 10 })
    expect(off.functions['voice-platform']).toBe('demo')
    const empty = catalogToFeatures(catalog(true, ['synthesize']), { available: 0 })
    expect(empty.hasCredits).toBe(false)
    const ctx: FeatureContext = { cloud: empty, youtubeConnected: false }
    expect(featureState('voice-platform', ctx).status).toBe('needs-credits')
    expect(featureState('gpu-render', ctx).status).toBe('demo')
    expect(featureState('voice-platform', { cloud: null, youtubeConnected: false }).status).toBe('demo')
  })

  it('the contract lists the twenty-three cloud methods (the nine of lot P5, the voice list and the clone, the published blueprint and its plan and apply, the kit on the platform: its reference, read, send, download; the beta: profile, team, invite, revoke an invitation, open the sign-in page again)', () => {
    expect(API_METHODS.filter((m) => m.startsWith('cloud.'))).toHaveLength(23)
  })
})
