// production-17: while the price multiplier is set (decision 0040, 1.0 during the beta), a REAL job is charged what its provider
// billed (`costUsd`), converted at the founder's dated $ → € rate with the grid's overhead, times the multiplier, never more than its
// hold; the rest of the hold goes back. Cloud-3: to the fraction of a credit (the part under a credit is carried to the team's next
// job, cloud-credit-carry.test.ts), no longer rounded up to a whole credit and at least 1. The first real run from the app captured the whole hold of a Veo clip (29 credits for
// 0,07 €) and a grid line far off for ai33 (148 credits for ≈ 0 €). A provider that does not say what it billed, a demo job and a
// quote on the grid's own margins keep the old rule. Fake adapters only, never the network.
import { describe, expect, it } from 'vitest'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const PROD = { NODE_ENV: 'production' }
const ENGINE = 'clip:veo31-lite-relaxed'
const CLIP = { prompt: 'des mains qui serrent un collier', seconds: 6, aspect: '16:9', engine: ENGINE }

/** A real clip engine that bills `costUsd` (and may say it does not know). */
function realClip(costUsd: number, costUnknown = false): ProviderAdapter {
  return {
    id: ENGINE,
    kind: 'real',
    secretName: 'UNIFICALLY_API_KEY',
    async generateVideo() {
      return { files: [{ name: 'clip.mp4', mime: 'video/mp4', bytes: Buffer.from('mp4') }], data: {}, costUsd, ...(costUnknown ? { costUnknown: true as const } : {}) }
    }
  }
}

function cloudWith(adapter: ProviderAdapter, o: { gridMargins?: boolean } = {}) {
  const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [adapter], engines: [ENGINE], ...(o.gridMargins ? { gridMargins: true } : {}) })
  t.cloud.vault.set('UNIFICALLY_API_KEY', 'unifically-test-SECRET-01', 'test')
  return t
}

const costRow = (t: ReturnType<typeof makeCloud>, id: string) =>
  t.cloud.db.prepare('SELECT credits, cost_usd, demo FROM jobs WHERE id = ?').get(id) as { credits: number; cost_usd: number; demo: number }

describe('a real job is captured at its real cost (decision 0040)', () => {
  it('a 0.075 $ Veo clip: 0.075 × 0.92 € ÷ 0.01 € = 7 credits captured, the rest of the hold released', async () => {
    const t = cloudWith(realClip(0.075))
    t.cloud.finance.setFx(0.92, '2026-11-01', 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { quote, job } = await quoteAndRun(t, p, 'generateVideo', CLIP)
    expect(quote.totalCredits).toBeGreaterThan(7)
    expect(job).toMatchObject({ state: 'succeeded', demo: false, credits: 7 })
    expect(costRow(t, job.id)).toEqual({ credits: 7, cost_usd: 0.075, demo: 0 })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ held: 0, balance: 10_000 - 7 })
  })

  it('follows the dated rate and the multiplier, and never captures more than the hold', async () => {
    const t = cloudWith(realClip(0.075))
    t.cloud.finance.setFx(1, '2026-11-02', 'test')
    t.cloud.finance.setMultiplier(2, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    // 0.075 $ × 1 € × 2 = 0.15 € = 15 credits
    expect((await quoteAndRun(t, p, 'generateVideo', CLIP)).job).toMatchObject({ state: 'succeeded', credits: 15 })

    const dear = cloudWith(realClip(50))
    const q = await signUpAndIn(dear, { credits: 10_000 })
    const { quote, job } = await quoteAndRun(dear, q, 'generateVideo', CLIP)
    expect(job).toMatchObject({ state: 'succeeded', credits: quote.totalCredits })
  })

  it('a provider that billed almost nothing is charged nothing at first, then a credit once its fractions add up to one (ai33: ≈ 0.001 $)', async () => {
    const t = cloudWith(realClip(0.00125))
    const p = await signUpAndIn(t, { credits: 10_000 })
    // 0.00125 $ × 0.92 € × 1.05 = 0.0012075 € = 0.12075 credit a job: the ninth job carries the team over one credit
    const charged: number[] = []
    for (let i = 0; i < 9; i++) charged.push((await quoteAndRun(t, p, 'generateVideo', CLIP)).job.credits as number)
    expect(charged).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ held: 0, balance: 10_000 - 1 })
  })

  it('keeps the old rule when the cost is unknown, for demo jobs and on the grid’s own margins', async () => {
    const unknown = cloudWith(realClip(0, true))
    const a = await signUpAndIn(unknown, { credits: 10_000 })
    const u = await quoteAndRun(unknown, a, 'generateVideo', CLIP)
    expect(u.job).toMatchObject({ state: 'succeeded', credits: u.quote.totalCredits })

    const margins = cloudWith(realClip(0.075), { gridMargins: true })
    const b = await signUpAndIn(margins, { credits: 10_000 })
    const m = await quoteAndRun(margins, b, 'generateVideo', CLIP)
    expect(m.job).toMatchObject({ state: 'succeeded', credits: m.quote.totalCredits })

    // tests never reach a real adapter: the same clip in a test run is the fake's demo, charged as before
    const demo = makeCloud({ paidCalls: true, realAdapters: [realClip(0.075)], engines: [ENGINE] })
    const c = await signUpAndIn(demo, { credits: 10_000 })
    const d = await quoteAndRun(demo, c, 'generateVideo', CLIP)
    expect(d.job).toMatchObject({ state: 'succeeded', demo: true, credits: d.quote.totalCredits })
  })
})

describe('a demo answer in a real run is never charged (production-17)', () => {
  it('while paid calls are on, a job of a real run that the Cloud can only serve in demo holds nothing and charges nothing', async () => {
    // paid calls on, but a test run never reaches a real adapter: every usage is the fakes' demo
    const t = makeCloud({ paidCalls: true })
    const p = await signUpAndIn(t, { credits: 1000 })
    const input = { prompt: 'un phare sous la tempête', width: 1280, height: 720, count: 1 }
    const q = (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateImage', input } })).json() as { id: string; totalCredits: number }
    expect(q.totalCredits).toBeGreaterThan(0)
    const created = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: q.id, idempotencyKey: 'thumb-real-run-0001', real: true } })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ demo: true, credits: 0 })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ held: 0, balance: 1000 })
    await t.cloud.jobs.whenIdle()
    const done = (await t.app.inject({ url: `/v1/jobs/${(created.json() as { id: string }).id}`, headers: p.auth })).json() as Record<string, unknown>
    expect(done).toMatchObject({ state: 'succeeded', demo: true, credits: 0 })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ held: 0, balance: 1000 })
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries WHERE team_id = ? AND kind IN (?, ?)').get(p.teamId, 'hold', 'capture')).toEqual({ n: 0 })

    // the same demo job outside a real run is charged as before (the beta's test credits)
    const { quote, job } = await quoteAndRun(t, p, 'generateImage', input)
    expect(job).toMatchObject({ state: 'succeeded', demo: true, credits: quote.totalCredits })

    // paid calls off: the whole Cloud is a demo, a real run's jobs are charged their test credits as before
    const off = makeCloud()
    const o = await signUpAndIn(off, { credits: 1000 })
    const q2 = (await off.app.inject({ method: 'POST', url: '/v1/quotes', headers: o.auth, payload: { usage: 'generateImage', input } })).json() as { id: string; totalCredits: number }
    const j2 = await off.app.inject({ method: 'POST', url: '/v1/jobs', headers: o.auth, payload: { quoteId: q2.id, idempotencyKey: 'thumb-real-run-0002', real: true } })
    expect(j2.json()).toMatchObject({ demo: true, credits: q2.totalCredits })
    await off.cloud.jobs.whenIdle()
  })
})
