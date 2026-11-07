// The founder console's money dashboard (cloud/src/admin-finance.ts, ADMIN_FINANCE_ROUTES, decision 0040): a free credit
// spent is a cost with no revenue; at the beta multiplier 1.0 a price is the cost; the per-team sums are the ledger;
// the multiplier, the $ → € rate and the fixed costs change without code; the overall result, the break-even, the
// overrun alerts and the finished minutes of a kit; every route refused to non-admins.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ADMIN_FINANCE_ROUTES, FinanceDashboard, FinanceSettingsView, FixedCostResponse } from '../../src/shared/cloud-admin-finance.ts'
import type { PriceItem } from '../../src/shared/cloud-api.ts'
import { DAY_MS } from '../src/clock.ts'
import { priceLine } from '../src/pricing.ts'
import { givePlan, makeCloud, quoteAndRun, signIn, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const TEXT = 'a'.repeat(10_000)
const VOICE = { text: TEXT, voiceId: 'demo-claire' }

async function rig() {
  const t = makeCloud()
  const admin = await signUpAndIn(t, { platformAdmin: true, email: 'founder@atelier.test' })
  const alice = await signUpAndIn(t, { email: 'alice@example.com', credits: 5000 })
  return { t, admin, alice }
}

async function dashboard(t: TestCloud, admin: Person, query = 'period=all&demo=1'): Promise<FinanceDashboard> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/admin/finance?${query}`, headers: admin.auth })
  expect(res.statusCode, res.body).toBe(200)
  return FinanceDashboard.parse(res.json())
}

const post = (t: TestCloud, who: Person, url: string, payload: object = {}) => t.app.inject({ method: 'POST', url, headers: who.auth, payload })

describe('margin 0 %: the price is the cost', () => {
  const voice = (pricing: PriceItem['pricing']): PriceItem => ({ item: 'voice.chars', usage: 'synthesize', unit: 'char', providerCostUsd: 0.0002, referenceEur: 0.0005, pricing })

  it('at multiplier 1.0 a line costs its real cost in credits, whatever the line’s margin or fixed price', () => {
    // 10 000 chars × $0.0002 × 0.9 = €1.80 → 180 credits of €0.01: exactly the cost
    for (const pricing of [{ mode: 'percent', marginPct: 25 }, { mode: 'fixed', creditsPerUnit: 0.04 }] as const) {
      const line = priceLine({ creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0, priceMultiplier: 1 }, voice(pricing), 10_000)
      expect(line.credits).toBe(180)
      expect(line.credits * 0.01).toBeCloseTo(line.costEur, 10)
      expect(line.belowCost).toBe(false)
    }
    // without the multiplier the grid's margin applies (decision 0015): 225 credits
    expect(priceLine({ creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0, priceMultiplier: null }, voice({ mode: 'percent', marginPct: 25 }), 10_000).credits).toBe(225)
  })

  it('a fresh Cloud quotes at cost; the multiplier and the grid margins are switched from the console, with no code change', async () => {
    const { t, admin, alice } = await rig()
    const quote = async () => {
      const q = await post(t, alice, '/v1/quotes', { usage: 'synthesize', input: VOICE })
      expect(q.statusCode, q.body).toBe(200)
      return (q.json() as { totalCredits: number }).totalCredits
    }
    // 10 000 × $0.00018 × 0.92 × 1.05 overhead = €1.7388 → 174 credits (the rounding up is under one credit)
    expect(await quote()).toBe(174)
    const stored = t.cloud.db.prepare('SELECT cost_eur, total_credits, price_multiplier FROM quotes ORDER BY created_at DESC LIMIT 1').get() as {
      cost_eur: number
      total_credits: number
      price_multiplier: number
    }
    expect(stored.price_multiplier).toBe(1)
    expect(stored.total_credits * 0.01 - stored.cost_eur).toBeGreaterThanOrEqual(0)
    expect(stored.total_credits * 0.01 - stored.cost_eur).toBeLessThan(0.01)

    const set = await post(t, admin, '/v1/admin/finance/settings', { priceMultiplier: 1.2 })
    expect(FinanceSettingsView.parse(set.json())).toMatchObject({ priceMultiplier: 1.2 })
    expect(await quote()).toBe(209) // €1.7388 × 1.2 = €2.08656
    await post(t, admin, '/v1/admin/finance/settings', { priceMultiplier: null })
    expect(await quote()).toBe(192) // the grid's 10 % on voice.chars
    expect((await post(t, admin, '/v1/admin/finance/settings', { priceMultiplier: 0.8 })).statusCode).toBe(400) // never under cost
    expect(t.cloud.audit.list().filter((e) => e.action === 'finance.multiplier')).toHaveLength(2)
  })

  it('a measured job settles with the multiplier it was quoted with, even when the setting changed meanwhile', async () => {
    const { t, admin, alice } = await rig()
    const q = await post(t, alice, '/v1/quotes', { usage: 'synthesize', input: VOICE })
    const quote = q.json() as { id: string; totalCredits: number }
    await post(t, admin, '/v1/admin/finance/settings', { priceMultiplier: 2 })
    const j = await post(t, alice, '/v1/jobs', { quoteId: quote.id, idempotencyKey: 'job-settle-1' })
    await t.cloud.jobs.whenIdle()
    const done = await t.app.inject({ method: 'GET', url: `/v1/jobs/${(j.json() as { id: string }).id}`, headers: alice.auth })
    expect(done.json()).toMatchObject({ state: 'succeeded', credits: 174 })
  })
})

describe('the dashboard', () => {
  it('a granted-free credit spent shows up as a cost with 0 revenue', async () => {
    const { t, admin, alice } = await rig()
    const { job } = await quoteAndRun(t, alice, 'synthesize', VOICE)
    expect(job.state).toBe('succeeded')
    const d = await dashboard(t, admin)
    const row = d.teams.find((x) => x.teamId === alice.teamId)!
    // the fake voice bills what the real one would: 10 000 × $0.00018 = $1.80
    expect(row).toMatchObject({ creditsOffered: 5000, creditsBought: 0, creditsSpent: 174, balance: 4826, offeredLeft: 4826, jobs: 1, revenueEurCents: 0 })
    expect(row.costUsdCents).toBeCloseTo(180, 6)
    expect(row.costEurCents).toBeCloseTo(180 * d.settings.eurPerUsd, 6)
    expect(row.marginEurCents).toBeCloseTo(-row.costEurCents, 6)
    expect(d.top.offeredLeftCredits).toBe(4826)
    // at multiplier 1 an offered credit left costs us its face value
    expect(d.top.offeredLeftCostEurCents).toBeCloseTo(4826, 6)
    expect(d.providers).toEqual([expect.objectContaining({ provider: 'fake-voice', demo: true, calls: 1, succeeded: 1, failed: 0, creditsBilled: 174, estimated: 0 })])
    // the fakes' simulated cost is not counted unless asked
    const real = await dashboard(t, admin, 'period=all')
    expect(real.teams.find((x) => x.teamId === alice.teamId)).toMatchObject({ creditsSpent: 174, costUsdCents: 0, jobs: 0 })
    expect(real.demoCallsHidden).toBe(1)
    expect(real.providers).toEqual([])
  })

  it('the sums per team are the ledger: offered + bought − spent = the balance, captures and charges add up', async () => {
    const { t, admin, alice } = await rig()
    const bob = await signUpAndIn(t, { email: 'bob@example.com', credits: 300 })
    const carol = await signUpAndIn(t, { email: 'carol@example.com' })
    t.cloud.wallet.adjust({ teamId: bob.teamId, credits: -50, idemKey: 'fix-bob', actor: 'test' })
    t.cloud.wallet.grant({ teamId: bob.teamId, credits: 2000, idemKey: 'billing:evt_1', note: 'pack', actor: 'billing', funding: 'paid' })
    t.cloud.db.prepare("INSERT INTO billing_charges (team_id, kind, cents, ref, created_at) VALUES (?, 'pack', 2500, 'evt_1', ?)").run(bob.teamId, new Date(t.clock.now()).toISOString())
    await quoteAndRun(t, alice, 'synthesize', VOICE)
    await quoteAndRun(t, alice, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'demo-claire' })
    await quoteAndRun(t, bob, 'synthesize', VOICE)
    const d = await dashboard(t, admin)
    for (const p of [alice, bob, carol, admin]) {
      const row = d.teams.find((x) => x.teamId === p.teamId)!
      expect(row.creditsOffered + row.creditsBought - row.creditsSpent).toBe(row.balance)
      expect(row.balance).toBe(t.cloud.wallet.sumOfEntries(p.teamId).balance)
    }
    expect(d.teams.find((x) => x.teamId === bob.teamId)).toMatchObject({ creditsOffered: 250, creditsBought: 2000, creditsSpent: 174, revenueEurCents: 2500, offeredLeft: 76 })
    const captured = (t.cloud.db.prepare("SELECT -SUM(delta) AS s FROM wallet_entries WHERE kind = 'capture'").get() as { s: number }).s
    expect(d.totals.creditsSpent).toBe(captured)
    expect(d.totals.creditsSpent).toBe(d.providers.reduce((s, p) => s + p.creditsBilled, 0))
    expect(d.totals.revenueEurCents).toBe(2500)
    expect(d.totals.costUsdCents).toBeCloseTo(d.teams.reduce((s, x) => s + x.costUsdCents, 0), 6)
    expect(d.spend.reduce((s, p) => s + p.credits, 0)).toBe(captured)
  })

  it('the period filter: today, the last 7 days, this month, all time', async () => {
    const { t, admin: before, alice: first } = await rig()
    await quoteAndRun(t, first, 'synthesize', VOICE)
    // from Monday 19 October 09:00 to Sunday 1 November 09:00 (UTC): a new day, week and month; tokens expired meanwhile
    t.clock.advance(13 * DAY_MS)
    const fresh = async (p: Person): Promise<Person> => ({ ...p, auth: { authorization: `Bearer ${(await signIn(t, p.email)).accessToken}` } })
    const [admin, alice] = [await fresh(before), await fresh(first)]
    await quoteAndRun(t, alice, 'synthesize', VOICE)
    const spent = async (period: string) => (await dashboard(t, admin, `period=${period}&demo=1`)).teams.find((x) => x.teamId === alice.teamId)!.creditsSpent
    expect(await spent('day')).toBe(174)
    expect(await spent('week')).toBe(174)
    expect(await spent('month')).toBe(174)
    expect(await spent('all')).toBe(348)
    const day = await dashboard(t, admin, 'period=day&demo=1')
    expect(day.spend).toHaveLength(new Date(t.clock.now()).getUTCHours() + 1) // one point per hour so far
    expect((await dashboard(t, admin, 'period=week&demo=1')).spend).toHaveLength(7)
    // a short history is drawn by day (19 October → 1 November), a long one by month
    expect((await dashboard(t, admin, 'period=all&demo=1')).spend.map((p) => p.bucket)).toHaveLength(14)
    t.clock.advance(100 * DAY_MS)
    const later = await fresh(admin)
    expect((await dashboard(t, later, 'period=all&demo=1')).spend.map((p) => p.bucket)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'])
  })

  it('fixed costs, the overall result and the break-even in minutes', async () => {
    const { t, admin, alice } = await rig()
    givePlan(t, alice.teamId, 'starter')
    await quoteAndRun(t, alice, 'synthesize', VOICE)
    // a 10-minute finished video, sent with its kit
    await publishKit(t, alice, '7', 600)
    const rate = await post(t, admin, '/v1/admin/finance/settings', { eurPerUsd: 0.9, fxAsOf: '2026-10-19' })
    expect(rate.json()).toMatchObject({ eurPerUsd: 0.9, fxAsOf: '2026-10-19' })
    const server = FixedCostResponse.parse((await post(t, admin, '/v1/admin/finance/fixed-costs', { label: 'Serveur', amountCents: 599, currency: 'EUR' })).json())
    let d = await dashboard(t, admin)
    // the HeyGen plan the Cloud is configured with (Pro, $49 by default) + the server (€5.99)
    expect(d.fixed.costs.map((c) => [c.label, c.monthlyEurCents])).toEqual(
      expect.arrayContaining([
        ['Forfait HeyGen (Pro)', 4900 * 0.9],
        ['Serveur', 599]
      ])
    )
    expect(d.fixed.costs).toHaveLength(2)
    expect(d.fixed.monthlyEurCents).toBeCloseTo(4410 + 599, 6)
    const row = d.teams.find((x) => x.teamId === alice.teamId)!
    expect(row).toMatchObject({ videos: 1, minutes: 10 })
    expect(row.costPerMinuteEurCents).toBeCloseTo(16.2, 6) // $1.80 × 0.9 = €1.62 over 10 minutes
    expect(d.fixed.month.resultEurCents).toBeCloseTo(d.fixed.month.revenueEurCents - 162 - (4410 + 599), 6)
    // margin 0: the minutes never pay the fixed costs; at ×1.3 they would at 5 009 ÷ (16.2 × 0.3) minutes a month
    expect(d.fixed.breakEvenMinutes).toBeNull()
    expect(d.fixed.breakEvenAt).toEqual({ multiplier: 1.3, minutes: Math.ceil(5009 / (16.2 * 0.3)) })
    await post(t, admin, '/v1/admin/finance/settings', { priceMultiplier: 1.5 })
    d = await dashboard(t, admin)
    expect(d.fixed.breakEvenMinutes).toBe(Math.ceil(5009 / (16.2 * 0.5)))
    // change, then remove the server
    await post(t, admin, '/v1/admin/finance/fixed-costs', { id: server.cost.id, label: 'Serveur H1', amountCents: 1000, currency: 'USD' })
    expect((await dashboard(t, admin)).fixed.costs.find((c) => c.id === server.cost.id)).toMatchObject({ label: 'Serveur H1', monthlyEurCents: 900 })
    expect((await post(t, admin, `/v1/admin/finance/fixed-costs/${server.cost.id}/remove`)).statusCode).toBe(200)
    expect((await dashboard(t, admin)).fixed.costs.map((c) => c.id)).toEqual(['auto:heygen'])
    expect((await post(t, admin, `/v1/admin/finance/fixed-costs/${server.cost.id}/remove`)).statusCode).toBe(404)
  })

  it('the HeyGen plan line follows the Cloud’s heygenPlan (Business: 149 $)', async () => {
    const t = makeCloud({ heygenPlan: 'business' })
    const admin = await signUpAndIn(t, { platformAdmin: true })
    expect((await dashboard(t, admin)).fixed.costs).toEqual([
      expect.objectContaining({ id: 'auto:heygen', label: 'Forfait HeyGen (Business)', amountCents: 14900, currency: 'USD', auto: true })
    ])
  })

  it('alerts on a call whose real cost passed its quote by more than 10 %', async () => {
    const { t, admin, alice } = await rig()
    const { job } = await quoteAndRun(t, alice, 'synthesize', VOICE)
    await quoteAndRun(t, alice, 'synthesize', VOICE)
    expect((await dashboard(t, admin)).alerts).toEqual([])
    // the quote's cost is $1.80 (+ the 5 % overhead shown apart): a real bill of $2.10 is 16.7 % over
    t.cloud.db.prepare('UPDATE jobs SET cost_usd = 2.1 WHERE id = ?').run(job.id)
    const d = await dashboard(t, admin)
    expect(d.top.alerts).toBe(1)
    expect(d.alerts).toEqual([expect.objectContaining({ jobId: job.id, provider: 'fake-voice', realUsdCents: 210, overPct: 16.7 })])
    expect(d.alerts[0]!.quotedUsdCents).toBeCloseTo(180, 6)
  })

  it('a non-admin cannot read or change anything', async () => {
    const { t, alice } = await rig()
    for (const r of Object.values(ADMIN_FINANCE_ROUTES)) {
      const url = r.path.replace(':id', 'fc_x')
      expect((await t.app.inject({ method: r.method, url })).statusCode, url).toBe(401)
      const res = await t.app.inject({ method: r.method, url, headers: alice.auth, ...(r.method === 'POST' ? { payload: { label: 'x', amountCents: 1, currency: 'EUR' } } : {}) })
      expect(res.statusCode, url).toBe(403)
    }
    expect(t.cloud.finance.fixedCosts()).toEqual([])
    expect(t.cloud.finance.multiplier()).toBe(1)
  })
})

describe('finished videos', () => {
  it('a complete kit records the video once with its length; a new kit of the same video updates it', async () => {
    const { t, alice } = await rig()
    givePlan(t, alice.teamId, 'starter')
    await publishKit(t, alice, '9', 540)
    await publishKit(t, alice, '9', 552)
    await publishKit(t, alice, '10', null)
    const rows = t.cloud.db.prepare('SELECT video_id, duration_s FROM finished_videos WHERE team_id = ? ORDER BY video_id').all(alice.teamId)
    expect(rows).toEqual([
      { video_id: '10', duration_s: null },
      { video_id: '9', duration_s: 552 }
    ])
  })
})

async function publishKit(t: TestCloud, who: Person, videoId: string, durationS: number | null): Promise<void> {
  const base = `/v1/team/videos/${videoId}/kit`
  const s = await post(t, who, base, { title: 'Une vidéo', description: '', durationS })
  expect(s.statusCode, s.body).toBe(200)
  const { kitId } = s.json() as { kitId: string }
  const bytes = Buffer.from('fake mp4 bytes')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const f = await t.app.inject({
    method: 'POST',
    url: `${base}/${kitId}/files?name=video.mp4&sha256=${sha}`,
    headers: { ...who.auth, 'content-type': 'application/octet-stream' },
    payload: bytes
  })
  expect(f.statusCode, f.body).toBe(200)
  expect((await post(t, who, `${base}/${kitId}/complete`)).statusCode).toBe(200)
}
