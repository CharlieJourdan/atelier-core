// The headless brain's remote API (src/main/headless/server.ts): the IPC contract over POST /rpc, the events over SSE,
// the bearer token, CORS, the size limit and the methods refused on a machine without a screen.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleCall } from '../../src/main/ipc'
import type { ChannelRow } from '../../src/shared/workflow'
import { BrainTokens, TOKEN_FILE } from '../../src/main/headless/token'
import { startTestBrain, waitForSse, type TestBrain } from './headless-helpers'

describe('headless brain: POST /rpc', () => {
  let brain: TestBrain
  beforeEach(async () => {
    brain = await startTestBrain({ maxBodyBytes: 4096, origins: ['http://localhost:5180'] })
  })
  afterEach(async () => {
    await brain.stop()
  })

  it('answers app.info, channels.create/list and orchestra.status with the IPC envelope', async () => {
    const info = await brain.rpc('app.info')
    expect(info.status).toBe(200)
    expect(info.body).toMatchObject({ ok: true, value: { name: 'Atelier', schemaVersion: expect.any(Number) } })

    const created = await brain.rpc('channels.create', [{ name: 'Remote channel', niche: 'tests' }])
    expect(created.body).toMatchObject({ ok: true, value: { name: 'Remote channel' } })
    const list = (await brain.rpc('channels.list')).body as { ok: true; value: { name: string }[] }
    expect(list.value.map((c) => c.name)).toContain('Remote channel')
    // the same data as the core in this process: one brain, two ways in
    expect((brain.core.api['channels.list']() as ChannelRow[]).map((c) => c.name)).toContain('Remote channel')

    const status = await brain.rpc('orchestra.status')
    expect(status.body).toMatchObject({ ok: true, value: brain.core.api['orchestra.status']() })
  })

  it('an unknown method or bad args answer exactly what the IPC bus answers', async () => {
    for (const [method, args] of [
      ['no.such.method', []],
      ['channels.list', 'not-an-array']
    ] as const) {
      const res = await fetch(`${brain.url}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${brain.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method, args })
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(await handleCall(brain.core.api, method, args))
    }
    const thrown = await brain.rpc('channels.create', [{ name: '' }])
    expect(thrown.body).toEqual(await handleCall(brain.core.api, 'channels.create', [{ name: '' }]))
  })

  it('a bad or absent token gets the same 401, which leaks nothing', async () => {
    const absent = await brain.rpc('app.info', [], {})
    const wrong = await brain.rpc('app.info', [], { authorization: `Bearer ${brain.token}x` })
    const notBearer = await brain.rpc('app.info', [], { authorization: brain.token })
    for (const r of [absent, wrong, notBearer]) {
      expect(r.status).toBe(401)
      expect(r.body).toEqual(absent.body)
      expect(JSON.stringify(r.body)).not.toMatch(/atb_|dbPath|schema|sha256/)
    }
    expect(absent.body).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
    const events = await fetch(`${brain.url}/events`)
    expect(events.status).toBe(401)
    await events.body?.cancel()
  })

  it('refuses an oversized body with 413 and a non-JSON body with 400', async () => {
    const big = await fetch(`${brain.url}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${brain.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'channels.create', args: [{ name: 'x'.repeat(10_000) }] })
    })
    expect(big.status).toBe(413)
    expect(await big.json()).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
    expect(brain.core.api['channels.list']()).toHaveLength(0)
    const bad = await fetch(`${brain.url}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${brain.token}` }, body: 'not json' })
    expect(bad.status).toBe(400)
  })

  it('refuses window and folder methods with a clear French error', async () => {
    for (const method of ['app.setTheme', 'production.revealPackage', 'brain.connect']) {
      const r = (await brain.rpc(method, [method === 'app.setTheme' ? 'dark' : 1])).body as { ok: false; error: { code: string; message: string } }
      expect(r.ok).toBe(false)
      expect(r.error.code).toBe('UNAVAILABLE_REMOTE')
      expect(r.error.message).toMatch(/^Indisponible sur l’ordinateur d’équipe : /)
    }
  })

  it('CORS: only the configured origins; any other Origin is refused', async () => {
    const pre = await fetch(`${brain.url}/rpc`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5180', 'access-control-request-method': 'POST' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5180')
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/authorization/)
    const ok = await brain.rpc('app.info', [], { authorization: `Bearer ${brain.token}`, origin: 'http://localhost:5180' })
    expect(ok.status).toBe(200)
    const evil = await brain.rpc('app.info', [], { authorization: `Bearer ${brain.token}`, origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
    expect(evil.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_ORIGIN' } })
  })

  it('GET /events delivers a `changed` event after a write', async () => {
    const res = await fetch(`${brain.url}/events`, { headers: { authorization: `Bearer ${brain.token}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const seen = waitForSse(res, (event, data) => event === 'changed' && (data as { topic: string }).topic === 'channels')
    await new Promise((r) => setTimeout(r, 50))
    await brain.rpc('channels.create', [{ name: 'Live' }])
    await expect(seen).resolves.toEqual({ event: 'changed', data: { topic: 'channels' } })
  })

  it('stores only the hash of the token; a rotation refuses the old one at once', async () => {
    const file = readFileSync(path.join(brain.dir, 'data', TOKEN_FILE), 'utf8')
    expect(file).not.toContain(brain.token)
    expect(JSON.parse(file)).toMatchObject({ v: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(brain.token).toMatch(/^atb_[A-Za-z0-9_-]{43}$/)
    const fresh = brain.tokens.rotate()
    expect((await brain.rpc('app.info')).status).toBe(401)
    expect((await brain.rpc('app.info', [], { authorization: `Bearer ${fresh}` })).status).toBe(200)
    // a restart reads the new hash and does not print a token again
    const again = new BrainTokens(path.join(brain.dir, 'data'))
    expect(again.ensure()).toBeNull()
    expect(again.verifyHeader(`Bearer ${fresh}`)).toBe(true)
    expect(again.verifyHeader(`Bearer ${brain.token}`)).toBe(false)
  })

  it('/health answers without a token and says nothing else; unknown routes are 404', async () => {
    const h = await fetch(`${brain.url}/health`)
    expect(await h.json()).toEqual({ ok: true })
    const nf = await fetch(`${brain.url}/rpc/../admin`, { headers: { authorization: `Bearer ${brain.token}` } })
    expect(nf.status).toBe(404)
  })
})
