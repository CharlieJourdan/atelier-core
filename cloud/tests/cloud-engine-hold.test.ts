// reserve-devis (issue #89): a quote, an estimate and so a job's hold are priced on the engine the input names (the price
// `GET /v1/engines` publishes), never on the grid line's worst case. The balance still can never be exceeded: the hold is
// taken atomically and the capture never passes it.
import { describe, expect, it } from 'vitest'
import { ceilCredits } from '../src/pricing.ts'
import { FAKE_ENGINES, engineCreditsPerUnit } from '../src/providers/engines.ts'
import { makeCloud, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const CLIP = 'clip:veo31-lite-relaxed' // 0.075 USD a call of at most 8 s
const post = async (t: TestCloud, who: Person, url: string, payload: Record<string, unknown>) => await t.app.inject({ method: 'POST', url, headers: who.auth, payload })
const clipInput = (seconds: number, engine?: string) => ({ prompt: 'les vagues montent', seconds, aspect: '16:9', ...(engine ? { engine } : {}) })
const quote = async (t: TestCloud, who: Person, usage: string, input: Record<string, unknown>) => {
  const r = await post(t, who, '/v1/quotes', { usage, input })
  expect(r.statusCode).toBe(200)
  return r.json() as { id: string; totalCredits: number }
}
const perCall = (t: TestCloud, id: string): number => {
  const decl = FAKE_ENGINES.find((e) => e.id === id)
  if (!decl) throw new Error(id)
  return engineCreditsPerUnit(decl, { ...t.cloud.pricing.current(), priceMultiplier: t.cloud.pricing.multiplier() })
}

describe('a quote is priced on the engine it names', () => {
  it('a clip on a per-call engine costs the engine\u2019s calls, far under the grid line, and a plain clip keeps the grid line', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    const grid = await quote(t, who, 'generateVideo', clipInput(5))
    const named = await quote(t, who, 'generateVideo', clipInput(5, CLIP))
    expect(named.totalCredits).toBe(Math.max(1, ceilCredits(perCall(t, CLIP))))
    expect(named.totalCredits).toBeLessThan(grid.totalCredits / 2)
    // a clip longer than one call is several calls
    const long = await quote(t, who, 'generateVideo', clipInput(20, CLIP))
    expect(long.totalCredits).toBe(ceilCredits(3 * perCall(t, CLIP)))
  })

  it('an engine dearer than the grid line is quoted dearer: the user pays the real cost, the Cloud pays no part of it', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    const grid = await quote(t, who, 'generateImage', { prompt: 'un phare', width: 1280, height: 720, count: 1 })
    const dear = await quote(t, who, 'generateImage', { prompt: 'un phare', width: 1280, height: 720, count: 1, engine: 'image:nano-banana-2' })
    expect(dear.totalCredits).toBeGreaterThan(grid.totalCredits)
    expect(dear.totalCredits).toBe(ceilCredits(perCall(t, 'image:nano-banana-2')))
  })

  it('/v1/estimates prices an item with an engine the same way, and the unnamed items as before', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    const r = await post(t, who, '/v1/estimates', {
      items: [
        { key: 'a', usage: 'generateVideo', quantity: 5, engine: CLIP },
        { key: 'b', usage: 'generateVideo', quantity: 5 }
      ]
    })
    expect(r.statusCode).toBe(200)
    const lines = (r.json() as { lines: { key: string; credits: number }[] }).lines
    const a = lines.find((l) => l.key === 'a')!.credits
    const b = lines.find((l) => l.key === 'b')!.credits
    expect(a).toBe(Math.max(1, ceilCredits(perCall(t, CLIP))))
    expect(b).toBe((await quote(t, who, 'generateVideo', clipInput(5))).totalCredits)
  })

  it('an engine of another usage is refused in an estimate as in a quote', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    expect((await post(t, who, '/v1/estimates', { items: [{ key: 'a', usage: 'generateVideo', quantity: 5, engine: 'image:flux-schnell' }] })).statusCode).toBe(400)
    expect((await post(t, who, '/v1/quotes', { usage: 'generateVideo', input: clipInput(5, 'image:flux-schnell') })).statusCode).toBe(400)
  })
})

describe('the hold of a job is the engine-priced quote, and the balance is never exceeded', () => {
  it('six clips on the cheap engine hold what they cost and fit a 50-credit balance the grid line would refuse', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 50 })
    const held: number[] = []
    for (let i = 0; i < 6; i++) {
      const q = await quote(t, who, 'generateVideo', clipInput(5, CLIP))
      const j = await post(t, who, '/v1/jobs', { quoteId: q.id, idempotencyKey: `clip-job-${i}` })
      expect(j.statusCode, j.body).toBe(200)
      held.push(q.totalCredits)
    }
    const w = t.cloud.wallet.state(who.teamId)
    expect(w.available + w.held).toBe(w.balance)
    expect(w.available).toBeGreaterThanOrEqual(0)
    expect(held.reduce((s, c) => s + c, 0)).toBeLessThanOrEqual(50)
    await t.cloud.jobs.whenIdle()
    const end = t.cloud.wallet.state(who.teamId)
    expect(end.balance).toBeGreaterThanOrEqual(0)
    expect(end.held).toBe(0)
  })

  it('a hold above the balance is still refused atomically', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 5 })
    const q = await quote(t, who, 'generateVideo', clipInput(20, CLIP))
    expect(q.totalCredits).toBeGreaterThan(5)
    const j = await post(t, who, '/v1/jobs', { quoteId: q.id, idempotencyKey: 'too-dear-1' })
    expect(j.statusCode).toBe(402)
    expect(t.cloud.wallet.state(who.teamId).balance).toBe(5)
  })

  it('a job is never charged more than its hold', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 100 })
    const q = await quote(t, who, 'generateVideo', clipInput(5, CLIP))
    const j = await post(t, who, '/v1/jobs', { quoteId: q.id, idempotencyKey: 'cap-job-1' })
    expect(j.statusCode, j.body).toBe(200)
    await t.cloud.jobs.whenIdle()
    const spent = 100 - t.cloud.wallet.state(who.teamId).balance
    expect(spent).toBeLessThanOrEqual(q.totalCredits)
  })
})

describe('the hold covers what the provider will bill', () => {
  it('a 1 s clip on a fixed-length per-second engine is held at the length it makes (6 s on Hailuo)', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    const one = await quote(t, who, 'generateVideo', clipInput(1, 'clip:hailuo-23-fast'))
    const six = await quote(t, who, 'generateVideo', clipInput(6, 'clip:hailuo-23-fast'))
    expect(one.totalCredits).toBe(six.totalCredits)
  })

  it('the stored cost of an engine-priced quote follows the engine, so the overrun alert compares with it', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    const grid = await quote(t, who, 'generateVideo', clipInput(5))
    const named = await quote(t, who, 'generateVideo', clipInput(5, CLIP))
    expect(t.cloud.pricing.getQuote(named.id)!.costEur).toBeLessThan(t.cloud.pricing.getQuote(grid.id)!.costEur / 2)
  })
})

describe('the hold never converts below the dated dollar rate the capture uses', () => {
  it('a dollar worth more euros than the grid assumes raises the hold of an engine-priced quote', async () => {
    const t = makeCloud()
    const who = await signUpAndIn(t, { credits: 1000 })
    const before = await quote(t, who, 'generateVideo', clipInput(5, CLIP))
    t.cloud.finance.setFx(2, '2026-11-02', 'test')
    const after = await quote(t, who, 'generateVideo', clipInput(5, CLIP))
    expect(after.totalCredits).toBeGreaterThan(before.totalCredits)
  })
})
