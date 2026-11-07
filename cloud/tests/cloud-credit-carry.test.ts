// One money formula, and no rounding up per job. A real job is charged what its provider billed: dollars × the dated rate
// × (1 + the grid's overhead) × the multiplier, in credits. The same function prices a job for the capture and for the P&L, so
// a job charged at cost is never a loss job; a fraction of a credit is carried to the team's next job instead of being
// rounded up (254 pictures of 0.0043 € each used to be charged 254 credits for 1.09 € of real cost). Fake adapters only.
import { describe, expect, it } from 'vitest'
import { pnl } from '../src/admin.ts'
import { fxRate, jobCostEur } from '../src/finance-settings.ts'
import { takeCarry } from '../src/pricing.ts'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const PROD = { NODE_ENV: 'production' }
const CLIP_ENGINE = 'clip:veo31-lite-relaxed'
const IMAGE_ENGINE = 'image:gpt-image-25-low'
const CLIP = { prompt: 'des mains qui serrent un collier', seconds: 6, aspect: '16:9', engine: CLIP_ENGINE }
const PICTURE = { prompt: 'un phare sous la tempête', count: 1, engine: IMAGE_ENGINE }

const realClip = (costUsd: number): ProviderAdapter => ({
  id: CLIP_ENGINE,
  kind: 'real',
  secretName: 'UNIFICALLY_API_KEY',
  async generateVideo() {
    return { files: [{ name: 'clip.mp4', mime: 'video/mp4', bytes: Buffer.from('mp4') }], data: {}, costUsd }
  }
})

const realImage = (costUsd: number): ProviderAdapter => ({
  id: IMAGE_ENGINE,
  kind: 'real',
  secretName: 'OPENAI_API_KEY',
  async generateImage() {
    return { files: [{ name: 'image.png', mime: 'image/png', bytes: Buffer.from('png') }], data: {}, costUsd }
  }
})

function cloudWith(adapter: ProviderAdapter, engine: string, secret: string) {
  const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [adapter], engines: [engine], server: { requestsPerMinute: 100_000 } })
  t.cloud.vault.set(secret, 'test-SECRET-key-0001', 'test')
  t.cloud.finance.setFx(0.92, '2026-11-02', 'test')
  return t
}
const ALL = { from: '2000-01-01', to: '2100-01-01' }

describe('one formula for the capture and the P&L', () => {
  it('jobCostEur is dollars × the rate × (1 + overhead %)', () => {
    expect(jobCostEur(0.075, 0.92, 5)).toBeCloseTo(0.07245, 10)
    expect(jobCostEur(0, 0.92, 5)).toBe(0)
    expect(jobCostEur(10, 1, 0)).toBe(10)
  })

  it('a Veo clip of 0.075 $ captured at cost is not a loss job in the P&L (it used to be: 7 credits = 0.07 € against 0.0725 €)', async () => {
    const t = cloudWith(realClip(0.075), CLIP_ENGINE, 'UNIFICALLY_API_KEY')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { job } = await quoteAndRun(t, p, 'generateVideo', CLIP)
    expect(job).toMatchObject({ state: 'succeeded', credits: 7 })
    const rows = pnl(t.cloud.db, ALL)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider: CLIP_ENGINE, jobs: 1, creditsSold: 7, lossJobs: 0 })
    expect(rows[0]?.costEur).toBeCloseTo(0.07, 2)
  })

  it('a 0.0047 $ picture is not a loss job either, and a job charged a whole credit or more under its cost still is', async () => {
    const t = cloudWith(realImage(0.0047), IMAGE_ENGINE, 'OPENAI_API_KEY')
    const p = await signUpAndIn(t, { credits: 10_000 })
    for (let i = 0; i < 3; i++) await quoteAndRun(t, p, 'generateImage', PICTURE)
    expect(pnl(t.cloud.db, ALL).reduce((n, r) => n + r.lossJobs, 0)).toBe(0)
    t.cloud.db.prepare(`UPDATE jobs SET cost_usd = 5, credits = 1 WHERE id = (SELECT id FROM jobs LIMIT 1)`).run()
    expect(pnl(t.cloud.db, ALL).reduce((n, r) => n + r.lossJobs, 0)).toBe(1)
  })

  it('the P&L converts at the dated rate the capture used', async () => {
    const t = cloudWith(realClip(0.075), CLIP_ENGINE, 'UNIFICALLY_API_KEY')
    t.cloud.finance.setFx(2, '2026-11-02', 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { job } = await quoteAndRun(t, p, 'generateVideo', CLIP)
    // 0.075 $ × 2 € × 1.05 = 0.1575 €: 15 credits and 0.75 carried
    expect(job).toMatchObject({ credits: 15 })
    expect(fxRate(t.cloud.db, () => '2026-11-02').eurPerUsd).toBe(2)
    expect(pnl(t.cloud.db, ALL)[0]?.costEur).toBeCloseTo(0.16, 2)
    expect(pnl(t.cloud.db, ALL)[0]?.lossJobs).toBe(0)
  })
})

describe('the fractions of a credit add up (no rounding up per job)', () => {
  it('takeCarry charges the whole credits of carry + cost, keeps the rest, and never more than the hold', () => {
    expect(takeCarry(0, 0.45, 1)).toEqual({ charged: 0, carry: 0.45 })
    const c = takeCarry(0.45, 0.45, 1)
    expect(c.charged).toBe(0)
    expect(c.carry).toBeCloseTo(0.9, 10)
    const d = takeCarry(0.9, 0.45, 1)
    expect(d.charged).toBe(1)
    expect(d.carry).toBeCloseTo(0.35, 10)
    // binary noise: 0.1 + 0.2 + 0.7 is not exactly 1 in binary floating point, it must still be 1 credit
    expect(takeCarry(0, 0.1 + 0.2 + 0.7, 5)).toEqual({ charged: 1, carry: 0 })
    // over the hold: the hold is the ceiling and the carry starts again
    expect(takeCarry(0.5, 12.3, 10)).toEqual({ charged: 10, carry: 0 })
    expect(takeCarry(0, 0, 3)).toEqual({ charged: 0, carry: 0 })
  })

  it('254 pictures of 0.0047 $ cost their exact total in credits (about 115), not 254', async () => {
    const t = cloudWith(realImage(0.0047), IMAGE_ENGINE, 'OPENAI_API_KEY')
    const p = await signUpAndIn(t, { credits: 100_000, internal: true })
    let charged = 0
    for (let i = 0; i < 254; i++) {
      const { job } = await quoteAndRun(t, p, 'generateImage', PICTURE, `pic-${i}`)
      expect(job.state).toBe('succeeded')
      charged += job.credits as number
    }
    const exactCredits = (254 * jobCostEur(0.0047, 0.92, 5)) / 0.01
    expect(exactCredits).toBeGreaterThan(115)
    expect(Math.abs(charged - exactCredits)).toBeLessThan(1)
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ held: 0, balance: 100_000 - charged })
    // what was charged and the carry make the exact total
    expect(charged + t.cloud.wallet.carry(p.teamId)).toBeCloseTo(exactCredits, 6)
    const rows = pnl(t.cloud.db, { ...ALL, includeInternal: true })
    expect(rows.reduce((n, r) => n + r.lossJobs, 0)).toBe(0)
    expect(rows.reduce((n, r) => n + r.creditsSold, 0)).toBe(charged)
    // the ledger and the wallet still agree
    expect(t.cloud.wallet.sumOfEntries(p.teamId)).toEqual({ balance: 100_000 - charged, held: 0 })
  }, 60_000)

  it('a job whose cost is under a credit is captured for 0 credits: the hold goes back, the ledger and the job say 0, the fraction is carried', async () => {
    const t = cloudWith(realImage(0.001), IMAGE_ENGINE, 'OPENAI_API_KEY')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { quote, job } = await quoteAndRun(t, p, 'generateImage', PICTURE)
    expect(quote.totalCredits).toBeGreaterThanOrEqual(1)
    expect(job).toMatchObject({ state: 'succeeded', demo: false, credits: 0 })
    expect(t.cloud.db.prepare('SELECT credits FROM jobs WHERE id = ?').get(job.id)).toEqual({ credits: 0 })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ held: 0, balance: 1000 })
    const capture = t.cloud.wallet.entries(p.teamId).entries.find((e) => e.kind === 'capture')
    expect(capture).toMatchObject({ delta: 0, jobId: job.id })
    expect(capture?.heldDelta).toBe(-quote.totalCredits)
    expect(t.cloud.wallet.carry(p.teamId)).toBeCloseTo((0.001 * 0.92 * 1.05) / 0.01, 8)
    expect(t.cloud.wallet.sumOfEntries(p.teamId)).toEqual({ balance: 1000, held: 0 })
  })

  it('a job the provider billed exactly nothing for (our own glue: a stock search, a voice clone) keeps the one-credit minimum and no carry', async () => {
    const t = cloudWith(realImage(0), IMAGE_ENGINE, 'OPENAI_API_KEY')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'generateImage', PICTURE)
    expect(job).toMatchObject({ state: 'succeeded', credits: 1 })
    expect(t.cloud.wallet.carry(p.teamId)).toBe(0)
  })

  it('a team’s fraction is its own: another team starts from zero', async () => {
    const t = cloudWith(realImage(0.003), IMAGE_ENGINE, 'OPENAI_API_KEY')
    const a = await signUpAndIn(t, { credits: 1000 })
    const b = await signUpAndIn(t, { credits: 1000 })
    await quoteAndRun(t, a, 'generateImage', PICTURE)
    expect(t.cloud.wallet.carry(a.teamId)).toBeGreaterThan(0)
    expect(t.cloud.wallet.carry(b.teamId)).toBe(0)
  })
})
