// The OAuth pieces of src/main/google: PKCE (RFC 7636's own example), the sign-in address (read-only scopes only, S256,
// a loopback redirect), the loopback receiver (the right state only, refusals, timeout), the scope check and the token
// endpoint's errors. Never the network: Google is the in-memory fake; the loopback is this machine's 127.0.0.1.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pkceChallenge } from '../../src/shared/cloud-api'
import { GOOGLE_SCOPES } from '../../src/shared/api/google'
import { authUrl, awaitRedirect, checkScopes, CALLBACK_PATH, GoogleError, newPkce, newState, pkceChallengeOf, refreshAccess } from '../../src/main/google/oauth'
import { FakeGoogle } from './google-fake'

const CLIENT = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'GOCSPX-test-secret' }

describe('PKCE and state', () => {
  it('derives the S256 challenge the way an independent encoder does (base64url of SHA-256, no padding)', () => {
    for (const v of ['a'.repeat(43), 'Z9._~-'.repeat(10), newPkce().verifier]) {
      expect(pkceChallengeOf(v)).toBe(pkceChallenge(v, (s) => createHash('sha256').update(s).digest()))
      expect(pkceChallengeOf(v)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('makes a fresh 43-character verifier and a long random state each time', () => {
    const a = newPkce()
    const b = newPkce()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.challenge).toBe(pkceChallengeOf(a.verifier))
    expect(a.verifier).not.toBe(b.verifier)
    expect(newState()).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(newState()).not.toBe(newState())
  })
})

describe('the sign-in address', () => {
  it('asks the three read-only scopes and nothing else, with S256, offline access and a loopback redirect', () => {
    const url = new URL(authUrl({ clientId: CLIENT.clientId, redirectUri: `http://127.0.0.1:5555${CALLBACK_PATH}`, challenge: 'c'.repeat(43), state: 's'.repeat(32) }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const scopes = (url.searchParams.get('scope') ?? '').split(' ')
    expect(scopes.sort()).toEqual([...GOOGLE_SCOPES].sort())
    for (const s of scopes) expect(s).toMatch(/\.readonly$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/oauth2/callback')
    expect(url.searchParams.get('state')).toBe('s'.repeat(32))
    expect(url.searchParams.has('client_secret')).toBe(false)
  })
})

describe('the scope check', () => {
  it('accepts exactly ours, or ours plus identity scopes', () => {
    expect(checkScopes(GOOGLE_SCOPES.join(' '))).toHaveLength(3)
    expect(checkScopes(`openid ${GOOGLE_SCOPES.join(' ')} https://www.googleapis.com/auth/userinfo.email`)).toHaveLength(5)
  })

  it('refuses a grant that misses one scope (an unticked box), or that carries a write scope', () => {
    const [analytics, monetary, data] = GOOGLE_SCOPES
    for (const granted of [`${analytics} ${data}`, `${monetary} ${data}`, `${analytics} ${monetary}`, '', undefined]) {
      expect(() => checkScopes(granted)).toThrow(expect.objectContaining({ code: 'scopes' }))
    }
    expect(() => checkScopes(`${GOOGLE_SCOPES.join(' ')} https://www.googleapis.com/auth/youtube`)).toThrow(expect.objectContaining({ code: 'scopes' }))
    expect(() => checkScopes(`${GOOGLE_SCOPES.join(' ')} https://www.googleapis.com/auth/youtube.upload`)).toThrow(expect.objectContaining({ code: 'scopes' }))
  })
})

describe('the loopback redirect', () => {
  it('listens on 127.0.0.1 on a random port and takes the code only with the right state', async () => {
    const p = await awaitRedirect({ state: 'good-state', timeoutMs: 10_000 })
    expect(p.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/)
    const other = await fetch(p.redirectUri.replace(CALLBACK_PATH, '/elsewhere'))
    expect(other.status).toBe(404)
    const res = await fetch(`${p.redirectUri}?state=good-state&code=4%2Fabc`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Atelier est relié à Google')
    await expect(p.code).resolves.toBe('4/abc')
  })

  it('a wrong state settles the wait as refused, and the code that came with it is never used', async () => {
    const p = await awaitRedirect({ state: 'good-state', timeoutMs: 10_000 })
    const res = await fetch(`${p.redirectUri}?state=forged&code=4%2Fstolen`)
    expect(res.status).toBe(400)
    await expect(p.code).rejects.toMatchObject({ code: 'state' })
    // the port is closed or only answers 404 now
    const again = await fetch(`${p.redirectUri}?state=good-state&code=4%2Fabc`).then((r) => r.status).catch(() => 0)
    expect([0, 404]).toContain(again)
  })

  it('a refusal in the browser, a timeout and a cancel each end the wait with their own code', async () => {
    const denied = await awaitRedirect({ state: 'st', timeoutMs: 10_000 })
    await fetch(`${denied.redirectUri}?state=st&error=access_denied`)
    await expect(denied.code).rejects.toMatchObject({ code: 'denied' })
    const slow = await awaitRedirect({ state: 'st', timeoutMs: 30 })
    await expect(slow.code).rejects.toMatchObject({ code: 'timeout' })
    const cancelled = await awaitRedirect({ state: 'st', timeoutMs: 10_000 })
    cancelled.cancel()
    await expect(cancelled.code).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('the token endpoint', () => {
  it('a revoked grant answers invalid_grant, which means « reconnect »; a wrong client is its own error', async () => {
    const g = new FakeGoogle()
    g.revoked = true
    await expect(refreshAccess(g.fetch, CLIENT, '1//whatever', Date.now())).rejects.toMatchObject({ code: 'reconnect' })
    await expect(refreshAccess(g.fetch, { clientId: 'other.apps.googleusercontent.com', clientSecret: null }, '1//x', Date.now())).rejects.toMatchObject({ code: 'client' })
    const offline = async (): Promise<Response> => {
      throw new Error('ECONNREFUSED')
    }
    await expect(refreshAccess(offline, CLIENT, '1//x', Date.now())).rejects.toMatchObject({ code: 'network' })
  })

  it('error messages are fixed sentences, never a token', () => {
    const e = new GoogleError('reconnect', 400)
    expect(e.message).toContain('reconnecte')
    expect(e.message).not.toMatch(/1\/\/|ya29/)
  })
})
