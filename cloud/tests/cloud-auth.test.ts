// Sign-in (§4.3): device login with PKCE, token lifetimes (an expired token is refused — proof of P3), refresh
// rotation and reuse detection, device revocation, the browser page, and the loopback/rate-limit guards.
import { describe, expect, it } from 'vitest'
import { ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S } from '../../src/shared/cloud-api.ts'
import { MAX_FAILED_ATTEMPTS, normaliseUserCode } from '../src/auth.ts'
import { PASSWORD, makeCloud, newVerifier, signIn, signUpAndIn } from './helpers.ts'

const err = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code

async function start(t: ReturnType<typeof makeCloud>) {
  const v = newVerifier()
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/device/start',
    payload: { codeChallenge: v.challenge, codeChallengeMethod: 'S256', deviceName: 'MacBook' }
  })
  return { ...v, ...(res.json() as { deviceCode: string; userCode: string; verificationUri: string; interval: number }) }
}
const approve = (t: ReturnType<typeof makeCloud>, code: string, email: string, password = PASSWORD, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/device',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams({ code, email, password }).toString()
  })
const poll = (t: ReturnType<typeof makeCloud>, deviceCode: string, codeVerifier: string) =>
  t.app.inject({ method: 'POST', url: '/v1/auth/device/poll', payload: { deviceCode, codeVerifier } })

describe('device login with PKCE', () => {
  it('pending until approved in the browser, then the tokens exactly once', async () => {
    const t = makeCloud()
    t.cloud.accounts.createAccount({ email: 'charlie@example.com', name: 'Charlie', password: PASSWORD, actor: 'test' })
    const s = await start(t)
    expect(s.verificationUri).toBe(`http://localhost:80/device?code=${encodeURIComponent(s.userCode)}`)
    expect(s.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    const pending = await poll(t, s.deviceCode, s.verifier)
    expect(pending.statusCode).toBe(428)
    expect(err(pending)).toBe('authorization_pending')
    const pageRes = await t.app.inject({ url: s.verificationUri.replace('http://localhost:80', '') })
    expect(pageRes.headers['content-type']).toContain('text/html')
    expect(pageRes.headers['content-security-policy']).toContain("default-src 'none'")
    expect(pageRes.body).toContain(s.userCode)
    expect(pageRes.body).toContain('Autoriser cet appareil')
    const ok = await approve(t, s.userCode.toLowerCase().replace('-', ' '), 'charlie@example.com')
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toContain('Appareil autorisé')
    const tokens = await poll(t, s.deviceCode, s.verifier)
    expect(tokens.statusCode).toBe(200)
    expect(tokens.json()).toMatchObject({ expiresIn: ACCESS_TOKEN_TTL_S, refreshExpiresIn: REFRESH_TOKEN_TTL_S })
    const again = await poll(t, s.deviceCode, s.verifier)
    expect(again.statusCode).toBe(410)
    expect(t.cloud.audit.list().some((e) => e.action === 'auth.login')).toBe(true)
  })

  it('the page lets the browser say where its form comes from: same-origin referrer policy, never no-referrer', async () => {
    // With `no-referrer`, browsers send `Origin: null` on a form POST (Fetch spec), so the page's own form was refused
    // as cross-origin. `same-origin` keeps the address (and its code) away from other sites.
    const t = makeCloud()
    t.cloud.accounts.createAccount({ email: 'b@example.com', name: 'B', password: PASSWORD, actor: 'test' })
    const s = await start(t)
    for (const url of [s.verificationUri, `${s.verificationUri}&new=1`]) {
      const pageRes = await t.app.inject({ url: url.replace('http://localhost:80', '') })
      expect(pageRes.headers['referrer-policy']).toBe('same-origin')
    }
    const post = (origin: string) =>
      t.app.inject({
        method: 'POST',
        url: '/device',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ code: s.userCode, email: 'b@example.com', password: PASSWORD }).toString()
      })
    expect((await post('null')).statusCode).toBe(403)
    expect((await post('https://evil.example')).statusCode).toBe(403)
    const ok = await post('http://localhost:80')
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toContain('Appareil autorisé')
  })

  it('a stolen device code is useless without the verifier, and wrong guesses burn the login', async () => {
    const t = makeCloud()
    t.cloud.accounts.createAccount({ email: 'a@example.com', name: 'A', password: PASSWORD, actor: 'test' })
    const s = await start(t)
    await approve(t, s.userCode, 'a@example.com')
    const thief = newVerifier()
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      const r = await poll(t, s.deviceCode, thief.verifier)
      expect(r.statusCode).toBe(401)
    }
    const owner = await poll(t, s.deviceCode, s.verifier)
    expect(owner.statusCode).toBe(410)
    const unknown = await poll(t, 'atd_nothing_like_this', s.verifier)
    expect(unknown.statusCode).toBe(401)
  })

  it('a wrong password on the page is refused in French, counted, and the code dies after 5', async () => {
    const t = makeCloud()
    t.cloud.accounts.createAccount({ email: 'b@example.com', name: 'B', password: PASSWORD, actor: 'test' })
    const s = await start(t)
    const bad = await approve(t, s.userCode, 'b@example.com', 'not the password')
    expect(bad.statusCode).toBe(401)
    expect(bad.body).toContain('Adresse e-mail ou mot de passe incorrect.')
    expect(bad.body).not.toContain('not the password')
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) await approve(t, s.userCode, 'nobody@example.com')
    const dead = await approve(t, s.userCode, 'b@example.com')
    expect(dead.statusCode).toBe(400)
    expect(dead.body).toContain('a expiré')
    const xsite = await approve(t, s.userCode, 'b@example.com', PASSWORD, { origin: 'https://evil.example' })
    expect(xsite.statusCode).toBe(403)
    expect(normaliseUserCode('bcdf ghjk')).toBe('BCDF-GHJK')
  })

  it('a login not approved within 10 minutes expires', async () => {
    const t = makeCloud()
    t.cloud.accounts.createAccount({ email: 'c@example.com', name: 'C', password: PASSWORD, actor: 'test' })
    const s = await start(t)
    t.clock.advance(600_000)
    expect((await approve(t, s.userCode, 'c@example.com')).statusCode).toBe(400)
    expect((await poll(t, s.deviceCode, s.verifier)).statusCode).toBe(410)
  })
})

describe('tokens', () => {
  it('an expired access token is refused (401 token_expired); a refresh gives a new pair', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    expect((await t.app.inject({ url: '/v1/me', headers: p.auth })).statusCode).toBe(200)
    t.clock.advance(ACCESS_TOKEN_TTL_S * 1000 - 1)
    expect((await t.app.inject({ url: '/v1/me', headers: p.auth })).statusCode).toBe(200)
    t.clock.advance(1)
    const expired = await t.app.inject({ url: '/v1/me', headers: p.auth })
    expect(expired.statusCode).toBe(401)
    expect(err(expired)).toBe('token_expired')
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p.refreshToken } })
    expect(r.statusCode).toBe(200)
    const fresh = r.json() as { accessToken: string; refreshToken: string; deviceId: string }
    expect(fresh.deviceId).toBe(p.deviceId)
    expect(fresh.refreshToken).not.toBe(p.refreshToken)
    expect((await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${fresh.accessToken}` } })).statusCode).toBe(200)
  })

  it('no token, a malformed one, an unknown one, or a refresh token used as access: all refused', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    expect((await t.app.inject({ url: '/v1/me' })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: { authorization: 'Basic abc' } })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: { authorization: 'Bearer atk_unknown_token_value' } })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${p.refreshToken}` } })).statusCode).toBe(401)
    const asRefresh = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p.accessToken } })
    expect(asRefresh.statusCode).toBe(401)
  })

  it('a refresh token used twice revokes the whole device (theft signal)', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    const first = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p.refreshToken } })
    const newAccess = (first.json() as { accessToken: string }).accessToken
    const replay = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p.refreshToken } })
    expect(replay.statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${newAccess}` } })).statusCode).toBe(401)
    expect(t.cloud.audit.list().some((e) => e.action === 'auth.refresh_reuse')).toBe(true)
  })

  it('a refresh after logout is refused without a theft alarm', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: p.auth })).statusCode).toBe(200)
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p.refreshToken } })
    expect(r.statusCode).toBe(401)
    expect(t.cloud.audit.list().some((e) => e.action === 'auth.refresh_reuse')).toBe(false)
  })

  it('a refresh token expires after 30 days', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    t.clock.advance(REFRESH_TOKEN_TTL_S * 1000)
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p.refreshToken } })
    expect(r.statusCode).toBe(401)
    expect(err(r)).toBe('token_expired')
  })

  it('each device can be revoked; logout revokes the current one', async () => {
    const t = makeCloud()
    const mac = await signUpAndIn(t, { email: 'd@example.com' })
    const pc = await signIn(t, 'd@example.com')
    const pcAuth = { authorization: `Bearer ${pc.accessToken}` }
    const list = (await t.app.inject({ url: '/v1/devices', headers: mac.auth })).json() as { devices: { id: string; current: boolean }[] }
    expect(list.devices).toHaveLength(2)
    expect(list.devices.find((d) => d.current)?.id).toBe(mac.deviceId)
    const rev = await t.app.inject({ method: 'POST', url: `/v1/devices/${pc.deviceId}/revoke`, headers: mac.auth })
    expect(rev.statusCode).toBe(200)
    expect((await t.app.inject({ url: '/v1/me', headers: pcAuth })).statusCode).toBe(401)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: pc.refreshToken } })).statusCode).toBe(401)
    const other = await signUpAndIn(t)
    expect((await t.app.inject({ method: 'POST', url: `/v1/devices/${mac.deviceId}/revoke`, headers: other.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: mac.auth })).statusCode).toBe(200)
    expect((await t.app.inject({ url: '/v1/me', headers: mac.auth })).statusCode).toBe(401)
  })
})

describe('guards', () => {
  it('refuses Host headers that are not loopback names (DNS rebinding)', async () => {
    const t = makeCloud()
    expect((await t.app.inject({ url: '/v1/me', headers: { host: 'evil.example' } })).statusCode).toBe(403)
    expect((await t.app.inject({ url: '/device', headers: { host: '127.0.0.1:8787' } })).statusCode).toBe(200)
    expect((await t.app.inject({ url: '/device', headers: { host: '[::1]:8787' } })).statusCode).toBe(200)
    expect((await t.app.inject({ url: '/device', headers: { host: '127.0.0.1.evil.example' } })).statusCode).toBe(403)
  })

  it('limits requests per minute per account', async () => {
    const t = makeCloud({ server: { requestsPerMinute: 5 } })
    const p = await signUpAndIn(t)
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await t.app.inject({ url: '/v1/wallet', headers: p.auth })).statusCode)
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(codes[5]).toBe(429)
    t.clock.advance(60_000)
    expect((await t.app.inject({ url: '/v1/wallet', headers: p.auth })).statusCode).toBe(200)
  })

  it('also limits a flood of refused tokens, per address', async () => {
    const t = makeCloud({ server: { requestsPerMinute: 5 } })
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await t.app.inject({ url: '/v1/wallet', headers: { authorization: `Bearer atk_bogus${i}` } })).statusCode)
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(codes[5]).toBe(429)
  })

  it('answers errors in the contract shape, without internals', async () => {
    const t = makeCloud()
    const bad = await t.app.inject({ method: 'POST', url: '/v1/auth/device/start', headers: { 'content-type': 'application/json' }, payload: '{not json' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toEqual({ error: { code: 'bad_request', message: 'malformed request' } })
    const none = await t.app.inject({ url: '/v1/nothing-here' })
    expect(none.json()).toEqual({ error: { code: 'not_found', message: 'no such route' } })
  })
})
