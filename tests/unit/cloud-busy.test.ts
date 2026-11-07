// production-17: a busy Atelier Cloud (429) is waited out as it asks, and reported as « occupé », never « injoignable ». The
// first real 60 s run failed because the 3rd file sent at once was refused 429 and the app gave up. Fake fetches only.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { busyRetry, busyWaitMs, uploadSlot, UPLOADS_AT_ONCE } from '../../src/engine/cloud-busy'
import { cloudCaller, UNREACHABLE } from '../../src/engine/cloud-http'
import { CreditSpender } from '../../src/main/production/credits'

const busy = (retryAfter?: string): Response =>
  new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'busy' } }), { status: 429, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter } })
const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const signal = new AbortController().signal

describe('waiting out a busy Cloud', () => {
  it('honours Retry-After (seconds or a date), else backs off 1, 2, 4… s up to 15 s', () => {
    expect(busyWaitMs(busy('3'), 0)).toBe(3000)
    expect(busyWaitMs(busy(new Date(10_000 + 5000).toUTCString()), 0, 10_000)).toBeGreaterThanOrEqual(4000)
    expect([0, 1, 2, 3, 4, 9].map((a) => busyWaitMs(busy(), a))).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000])
  })

  it('sends the request again after each 429 until it goes through; past the budget the 429 is answered', async () => {
    const answers = [busy('0'), busy('0'), ok({ v: 1 })]
    const waits: number[] = []
    const res = await busyRetry(async () => answers.shift() as Response, signal, { onWait: (ms) => void waits.push(ms) })
    expect(res.status).toBe(200)
    expect(waits).toEqual([0, 0])
    const stuck = await busyRetry(async () => busy('5'), signal, { budgetMs: 1000 })
    expect(stuck.status).toBe(429)
  })

  it('a call that stays busy is « occupé » (transient), never « injoignable »; before a paid node it stays transient', async () => {
    const caller = cloudCaller({ baseUrl: 'http://cloud.test', token: () => 't', fetchImpl: (async () => busy('0')) as typeof fetch, busyBudgetMs: 50 })
    const e = (await caller.call('GET', '/v1/wallet', z.unknown(), signal).then(() => new Error('it should have failed'), (x: unknown) => x)) as Error & { code?: string }
    expect(e).toMatchObject({ code: 'transient' })
    expect(e.message).toMatch(/occupé \(429\)/)
    expect(e.message.startsWith(UNREACHABLE)).toBe(false)
    const spender = new CreditSpender({ caller })
    await expect(spender.reserve({ runId: 'r', nodeId: 'clips', idempotencyKey: 'k1', estimate: { units: [{ unit: 'video_s', qty: 6 }], provider: 'video', durationS: 60 } })).rejects.toMatchObject({ code: 'transient', message: expect.stringMatching(/occupé/) })
    // an unreachable Cloud is still final before a paid node: nothing was paid
    const down = cloudCaller({ baseUrl: 'http://cloud.test', token: () => 't', fetchImpl: (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch })
    await expect(new CreditSpender({ caller: down }).reserve({ runId: 'r', nodeId: 'clips', idempotencyKey: 'k2', estimate: { units: [{ unit: 'video_s', qty: 6 }], provider: 'video', durationS: 60 } })).rejects.toMatchObject({ code: 'missing_tool', message: expect.stringMatching(/injoignable.*Rien n’a été payé/) })
  })

  it('every client of one Cloud sends at most UPLOADS_AT_ONCE files at a time; the others wait their turn', async () => {
    const base = 'http://slots.test'
    let inFlight = 0
    let most = 0
    const send = async (): Promise<void> => {
      const release = await uploadSlot(base, signal)
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      release()
    }
    await Promise.all(Array.from({ length: 7 }, send))
    expect(UPLOADS_AT_ONCE).toBe(4)
    expect(most).toBe(UPLOADS_AT_ONCE)
    // a stopped waiter hands its turn on
    const holds: (() => void)[] = []
    for (let i = 0; i < UPLOADS_AT_ONCE; i++) holds.push(await uploadSlot(base, signal))
    const stop = new AbortController()
    const stopped = uploadSlot(base, stop.signal)
    const next = uploadSlot(base, signal)
    stop.abort()
    holds[0]?.()
    await expect(stopped).rejects.toThrow()
    const got = await next
    got()
    for (const h of holds.slice(1)) h()
  })
})

describe('one pace for every request to a busy Cloud', () => {
  it('a 429 makes the other requests to the same Cloud wait with it, then they go through', async () => {
    const key = `http://shared-${Math.random()}`
    const starts: number[] = []
    let first = true
    const send = async (): Promise<Response> => {
      starts.push(Date.now())
      if (first) {
        first = false
        return busy('1')
      }
      return ok({ v: 1 })
    }
    const t0 = Date.now()
    const a = busyRetry(send, signal, { key })
    await new Promise((r) => setTimeout(r, 50))
    const b = busyRetry(send, signal, { key }) // started after the 429: it waits the Cloud's pause before sending at all
    const [ra, rb] = await Promise.all([a, b])
    expect([ra.status, rb.status]).toEqual([200, 200])
    expect(starts).toHaveLength(3)
    expect(starts[2]! - t0).toBeGreaterThanOrEqual(900) // the late request did not send during the pause
  })

  it('a long busy spell inside the run is waited out (budget 5 min), jittered', async () => {
    const { BUSY_BUDGET_MS } = await import('../../src/engine/cloud-busy')
    expect(BUSY_BUDGET_MS).toBeGreaterThanOrEqual(300_000)
  })
})
