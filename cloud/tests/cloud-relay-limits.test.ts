// Security review, findings 3, 4 and 8: the relay's memory stays bounded and a revocation cuts it. An event stream whose
// client stops reading is closed past its buffer; a machine's events have a byte budget per minute; the arguments of
// pending calls have a budget per machine and on the whole Cloud; a poll hands out a bounded number of bytes; a credential
// revoked behind the hub's back (the admin tool is another process) ends the machine's open poll without a single call,
// refuses new calls at once, and ends its event streams.
import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { OFFLINE_MESSAGE } from '../src/relay/hub.ts'
import { makeCloud, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const SECRET_ARG = 'argument-secret-after-revocation'

async function enrolled(t: TestCloud, owner: Person) {
  const machines = t.cloud.machines()
  const [m] = await machines.provision(owner.teamId, 'starter', 'test')
  const res = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: machines.newEnrolToken(m!.id, 'test') } })
  const { credential } = res.json() as { credential: string }
  const auth = { authorization: `Bearer ${credential}` }
  // one poll: the machine counts as online for the grace period
  expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: auth })).statusCode).toBe(200)
  return { id: m!.id, auth }
}

const rpc = (t: TestCloud, who: Person, args: unknown[]) => t.app.inject({ method: 'POST', url: '/v1/team/brain/rpc', headers: who.auth, payload: { method: 'chat.send', args } })
const poll = async (t: TestCloud, auth: { authorization: string }, wait = 0) =>
  ((await t.app.inject({ url: `/v1/relay/machine/next?wait=${wait}`, headers: auth })).json() as { requests: { id: string; args: unknown[] }[] }).requests
const events = (t: TestCloud, auth: { authorization: string }, size: number) =>
  t.app.inject({ method: 'POST', url: '/v1/relay/machine/events', headers: auth, payload: { events: [{ event: 'stream', data: { delta: 'x'.repeat(size) } }] } })

describe('event streams', () => {
  it('closes a stream whose client does not read once its buffer passes the limit, and frees its place', async () => {
    const t = makeCloud({ relay: { maxStreamBufferBytes: 64 * 1024, maxEventBytesPerMinute: 1024 * 1024 * 1024, machinePerMinute: 100_000 } })
    const owner = await signUpAndIn(t)
    const m = await enrolled(t, owner)
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
    let closed = false
    const res = await new Promise<http.IncomingMessage>((resolve) => http.get(`${base}/v1/team/brain/events`, { headers: owner.auth }, resolve))
    expect(res.statusCode).toBe(200)
    res.pause() // a client that never reads
    res.socket.once('close', () => (closed = true))
    expect(t.cloud.relay.listenerCount(m.id)).toBe(1)
    for (let i = 0; i < 400 && t.cloud.relay.listenerCount(m.id) > 0; i++) expect((await events(t, m.auth, 256 * 1024)).statusCode).toBe(200)
    expect(t.cloud.relay.listenerCount(m.id)).toBe(0)
    // the server dropped the connection: once the client reads again, it finds the end of it
    res.resume()
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 10_000 })
    // the team's stream count was given back: a reading client opens a stream again
    const again = await fetch(`${base}/v1/team/brain/events`, { headers: owner.auth })
    expect(again.status).toBe(200)
    await again.body?.cancel()
  })

  it('gives each machine a byte budget of events per minute', async () => {
    const t = makeCloud({ relay: { maxEventBytesPerMinute: 10_000 } })
    const owner = await signUpAndIn(t)
    const m = await enrolled(t, owner)
    expect((await events(t, m.auth, 6000)).statusCode).toBe(200)
    const over = await events(t, m.auth, 6000)
    expect(over.statusCode).toBe(429)
    expect(over.json()).toMatchObject({ error: { code: 'rate_limited' } })
    t.clock.advance(60_000)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(200)
    expect((await events(t, m.auth, 6000)).statusCode).toBe(200)
  })
})

describe('pending calls', () => {
  it('bounds the bytes of pending calls per machine and on the whole Cloud, and gives them back when a call ends', async () => {
    const t = makeCloud({ relay: { maxPendingBytesPerMachine: 10_000, maxPendingBytes: 15_000 } })
    const a = await signUpAndIn(t)
    const b = await signUpAndIn(t)
    const ma = await enrolled(t, a)
    const mb = await enrolled(t, b)
    const first = rpc(t, a, ['x'.repeat(6000)])
    await vi.waitFor(() => expect(t.cloud.relay.pending(ma.id)).toBeGreaterThan(6000))
    const second = await rpc(t, a, ['y'.repeat(6000)])
    expect(second.statusCode).toBe(429) // this machine's budget
    // b's machine holds 3 000 bytes: its own budget would take 6 000 more, the Cloud's (15 000) would not
    const fourth = rpc(t, b, ['w'.repeat(3000)])
    await vi.waitFor(() => expect(t.cloud.relay.pending(mb.id)).toBeGreaterThan(3000))
    const global = await rpc(t, b, ['v'.repeat(6000)])
    expect(global.statusCode).toBe(429)
    expect((global.json() as { error: { message: string } }).error.message).toMatch(/relay is busy/)
    // answering gives the bytes back
    for (const m of [ma, mb]) {
      for (const r of await poll(t, m.auth)) await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: m.auth, payload: { id: r.id, response: { ok: true } } })
    }
    expect((await first).statusCode).toBe(200)
    expect((await fourth).statusCode).toBe(200)
    expect(t.cloud.relay.pending()).toBe(0)
  })

  it('hands a poll at most maxPollBytes of arguments (always at least one call)', async () => {
    const t = makeCloud({ relay: { maxPollBytes: 10_000 } })
    const owner = await signUpAndIn(t)
    const m = await enrolled(t, owner)
    const calls = [rpc(t, owner, ['a'.repeat(6000)]), rpc(t, owner, ['b'.repeat(6000)]), rpc(t, owner, ['c'.repeat(20_000)])]
    await vi.waitFor(() => expect(t.cloud.relay.pending(m.id)).toBeGreaterThan(32_000))
    const sizes: number[] = []
    for (let i = 0; i < 3; i++) {
      const batch = await poll(t, m.auth)
      sizes.push(batch.length)
      for (const r of batch) await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: m.auth, payload: { id: r.id, response: { ok: true } } })
    }
    expect(sizes).toEqual([1, 1, 1]) // 6 000 + 6 000 > 10 000; the 20 000-byte call goes alone
    for (const c of calls) expect((await c).statusCode).toBe(200)
  })
})

describe('a revocation by another process', () => {
  it('ends the open long poll with no call, refuses calls at once, and ends the event streams', async () => {
    const t = makeCloud({ relay: { heartbeatMs: 60_000 } })
    const owner = await signUpAndIn(t)
    const m = await enrolled(t, owner)
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
    const stream = await fetch(`${base}/v1/team/brain/events`, { headers: owner.auth })
    expect(stream.status).toBe(200)
    const reader = stream.body!.getReader()
    const open = fetch(`${base}/v1/relay/machine/next?wait=25`, { headers: m.auth }).then(async (r) => (await r.json()) as { requests: unknown[] })
    await vi.waitFor(() => expect(t.cloud.relay.polling(m.id)).toBe(true))
    // the admin tool revokes in its own process: only the database changes, the hub is not told
    t.cloud.machines().credentials.revoke(m.id, 'admin-cli')
    const started = Date.now()
    const refused = await rpc(t, owner, [SECRET_ARG])
    expect(refused.statusCode).toBe(503)
    expect(refused.json()).toEqual({ error: { code: 'machine_offline', message: OFFLINE_MESSAGE } })
    const ended = await open
    expect(ended.requests).toEqual([]) // the open poll never saw the call
    expect(Date.now() - started).toBeLessThan(5000) // at once, not after the 25 s wait
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(t.cloud.relay.listenerCount(m.id)).toBe(0)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(401)
  })

  it('a call already waiting in the queue is not handed to a poll after the revocation', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const m = await enrolled(t, owner)
    const pending = rpc(t, owner, [SECRET_ARG]) // queued: no poll is open
    await vi.waitFor(() => expect(t.cloud.relay.pending(m.id)).toBeGreaterThan(0))
    t.cloud.machines().credentials.revoke(m.id, 'admin-cli')
    // the next poll is refused by its credential; the hub drops the machine when asked
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(401)
    expect(t.cloud.relay.isOnline(m.id)).toBe(false)
    expect((await pending).statusCode).toBe(503)
    expect(t.cloud.relay.pending()).toBe(0)
  })

  it('drop() ends the event streams of a machine', async () => {
    const t = makeCloud({ relay: { heartbeatMs: 60_000 } })
    const owner = await signUpAndIn(t)
    const m = await enrolled(t, owner)
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
    const stream = await fetch(`${base}/v1/team/brain/events`, { headers: owner.auth })
    const reader = stream.body!.getReader()
    expect(t.cloud.relay.listenerCount(m.id)).toBe(1)
    t.cloud.relay.drop(m.id)
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(t.cloud.relay.listenerCount(m.id)).toBe(0)
  })
})
