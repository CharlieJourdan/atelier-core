// Prices computed by hand (PLAN-V2-PRODUCTION §4.4, proof of P3: 3 margins × 2 credit values), the reference cap, the
// 1-credit minimum, fixed prices, the internal team, binary noise, versioned grids and quote expiry.
import { describe, expect, it } from 'vitest'
import type { PriceItem } from '../../src/shared/cloud-api.ts'
import { marginWarnings, priceLine, suggestedMarginPct, TIER_FAR_PCT, TIER_MEDIUM_PCT, TIER_NEAR_PCT } from '../src/pricing.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

const voice = (marginPct: number, referenceEur: number | null = 0.0005): PriceItem => ({
  item: 'voice.chars',
  usage: 'synthesize',
  unit: 'char',
  providerCostUsd: 0.0002,
  referenceEur,
  pricing: { mode: 'percent', marginPct }
})

describe('the formula, by hand', () => {
  // 10 000 characters × $0.0002 × 0.9 €/$ = €1.80 real cost (no overhead); the reference (€5) does not bite.
  //   margin  5 %: €1.89  → 189 credits at €0.01, 94.5 → 95 at €0.02
  //   margin 10 %: €1.98  → 198 credits at €0.01, 99         at €0.02
  //   margin 25 %: €2.25  → 225 credits at €0.01, 112.5 → 113 at €0.02
  const cases: [number, number, number][] = [
    [5, 0.01, 189],
    [5, 0.02, 95],
    [10, 0.01, 198],
    [10, 0.02, 99],
    [25, 0.01, 225],
    [25, 0.02, 113]
  ]
  for (const [margin, creditValueEur, credits] of cases) {
    it(`margin ${margin} %, 1 credit = €${creditValueEur} → ${credits} credits`, () => {
      const line = priceLine({ creditValueEur, usdToEur: 0.9, overheadPct: 0 }, voice(margin), 10_000)
      expect(line.credits).toBe(credits)
      expect(line.costEur).toBeCloseTo(1.8, 10)
      expect(line.capped).toBe(false)
      expect(line.belowCost).toBe(false)
    })
  }

  it('adds the overhead share to the real cost before the margin (10 % overhead: €1.98)', () => {
    // €1.98 × 1.05 = €2.079 → 208 / 103.95 → 104; × 1.10 = €2.178 → 218 / 109; × 1.25 = €2.475 → 248 / 124
    const expected: [number, number, number][] = [
      [5, 208, 104],
      [10, 218, 109],
      [25, 248, 124]
    ]
    for (const [margin, at1, at2] of expected) {
      expect(priceLine({ creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 10 }, voice(margin), 10_000).credits).toBe(at1)
      expect(priceLine({ creditValueEur: 0.02, usdToEur: 0.9, overheadPct: 10 }, voice(margin), 10_000).credits).toBe(at2)
    }
  })

  it('never goes above the reference price', () => {
    const grid = { creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0 }
    // 25 % would be 225 credits; the reference is 10 000 × €0.0002 = €2 → at most 200 credits, still above cost.
    const capped = priceLine(grid, voice(25, 0.0002), 10_000)
    expect(capped).toMatchObject({ credits: 200, capped: true, belowCost: false })
    // A reference under our cost (€1.50 < €1.80): 150 credits, flagged as a loss for the P&L.
    expect(priceLine(grid, voice(25, 0.00015), 10_000)).toMatchObject({ credits: 150, capped: true, belowCost: true })
    // No reference: no cap.
    expect(priceLine(grid, voice(25, null), 10_000)).toMatchObject({ credits: 225, capped: false })
  })

  it('charges at least 1 credit', () => {
    const grid = { creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0 }
    expect(priceLine(grid, voice(10), 1).credits).toBe(1)
    // a free source (provider cost 0) costs nothing instead: decision 0105, cloud-free-sources.test.ts
    expect(priceLine(grid, { ...voice(0, 0), providerCostUsd: 0 }, 1).credits).toBe(0)
    expect(priceLine(grid, { ...voice(0, null), providerCostUsd: 0.00001 }, 1).credits).toBe(1)
  })

  it('reference under 1 credit: the 1-credit minimum wins and aboveReference says so; otherwise never above', () => {
    const grid = { creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0 }
    // 1 char × €0.0005 = €0.0005 = 0.05 credit: the line costs the minimum, 1 credit, above the reference.
    expect(priceLine(grid, voice(10), 1)).toMatchObject({ credits: 1, aboveReference: true })
    // 10 000 chars: reference €5 = 500 credits, 25 % gives 225: under it.
    expect(priceLine(grid, voice(25), 10_000)).toMatchObject({ credits: 225, aboveReference: false })
    // Capped at exactly the reference (200 credits): not above it.
    expect(priceLine(grid, voice(25, 0.0002), 10_000)).toMatchObject({ credits: 200, capped: true, aboveReference: false })
    // No reference, or an internal team: the flag is false.
    expect(priceLine(grid, voice(10, null), 1).aboveReference).toBe(false)
    expect(priceLine(grid, voice(10), 1, true).aboveReference).toBe(false)
  })

  it('a fixed price per item, capped by the reference too', () => {
    const grid = { creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0 }
    const video = (creditsPerUnit: number, referenceEur: number | null): PriceItem => ({
      item: 'video.ten-minutes',
      usage: 'submitGpuJob',
      unit: 'video',
      providerCostUsd: 0.1,
      referenceEur,
      pricing: { mode: 'fixed', creditsPerUnit }
    })
    expect(priceLine(grid, video(25, null), 2).credits).toBe(50)
    expect(priceLine(grid, video(25, 0.4), 2)).toMatchObject({ credits: 50, capped: false })
    expect(priceLine(grid, video(25, 0.2), 2)).toMatchObject({ credits: 40, capped: true })
    expect(priceLine(grid, video(2.5, null), 3).credits).toBe(8)
  })

  it('an internal team pays the real cost: zero margin, no fixed price', () => {
    const grid = { creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 0 }
    expect(priceLine(grid, voice(25), 10_000, true).credits).toBe(180)
    expect(priceLine(grid, { ...voice(25), pricing: { mode: 'fixed', creditsPerUnit: 1 } }, 10_000, true).credits).toBe(180)
  })

  it('ignores binary noise: 3 × $0.10 at €0.10 a credit is 3 credits, not 4', () => {
    expect((3 * 0.1) / 0.1).toBeGreaterThan(3)
    const item: PriceItem = { item: 'x.y', usage: 'generateImage', unit: 'image', providerCostUsd: 0.1, referenceEur: null, pricing: { mode: 'percent', marginPct: 0 } }
    expect(priceLine({ creditValueEur: 0.1, usdToEur: 1, overheadPct: 0 }, item, 3).credits).toBe(3)
  })

  it('suggests the 25 / 10 / 5 tiers from the gap to the reference', () => {
    expect(suggestedMarginPct(0.2, 1)).toBe(25)
    expect(suggestedMarginPct(0.6, 1)).toBe(25)
    expect(suggestedMarginPct(0.8, 1)).toBe(10)
    expect(suggestedMarginPct(0.95, 1)).toBe(5)
    expect(suggestedMarginPct(0.5, null)).toBe(25)
  })
})

describe('margin tiers and publish warnings', () => {
  const money = { creditValueEur: 0.01, usdToEur: 1, overheadPct: 0 }
  const item = (name: string, usage: PriceItem['usage'], costUsd: number, referenceEur: number | null, pricing: PriceItem['pricing']): PriceItem => ({
    item: name,
    usage,
    unit: 'u',
    providerCostUsd: costUsd,
    referenceEur,
    pricing
  })

  it('names the tiers', () => {
    expect([TIER_FAR_PCT, TIER_MEDIUM_PCT, TIER_NEAR_PCT]).toEqual([25, 10, 5])
  })

  it('warns, per item, when the margin is not its tier (percent and fixed prices); items in tier and without reference are quiet', () => {
    const items = [
      item('a', 'synthesize', 0.1, 1, { mode: 'percent', marginPct: 25 }), // ratio 0.1 → tier 25: in tier
      item('b', 'generateImage', 0.7, 1, { mode: 'percent', marginPct: 25 }), // ratio 0.7 → tier 10: warns
      item('c', 'generateVideo', 0.95, 1, { mode: 'percent', marginPct: 5 }), // tier 5: in tier
      item('d', 'talkingAvatar', 0.5, 1, { mode: 'fixed', creditsPerUnit: 70 }), // €0.70 over €0.50 cost = 40 %, tier 25: warns
      item('e', 'channelData', 0.5, null, { mode: 'percent', marginPct: 99 }) // no reference: not checked
    ]
    expect(marginWarnings({ ...money, items })).toEqual([
      { item: 'b', marginPct: 25, tierPct: 10 },
      { item: 'd', marginPct: 40, tierPct: 25 }
    ])
  })
})

describe('quotes through the API', () => {
  it('prices with the current grid, keeps the version, and a new grid only changes new quotes', async () => {
    const t = makeCloud({ gridMargins: true })
    const p = await signUpAndIn(t, { credits: 5000 })
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const ask = () =>
      t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'synthesize', input: { text: 'a'.repeat(10_000), voiceId: 'demo-claire' } } })
    const first = (await ask()).json() as { id: string; gridVersion: number; totalCredits: number; lines: { credits: number }[]; referenceEur: number; demo: boolean }
    // Grid v1: 10 000 × $0.00018 × 0.92 × 1.05 = €1.73880 × 1.10 = €1.91268 → 192 credits; reference €2.20 → cap 220.
    expect(first).toMatchObject({ gridVersion: 1, totalCredits: 192, demo: true })
    expect(first.referenceEur).toBeCloseTo(2.2, 10)
    const grid = (await t.app.inject({ url: '/v1/admin/prices', headers: admin.auth })).json() as { current: Record<string, unknown> }
    const next = { ...grid.current, creditValueEur: 0.02, note: 'test' }
    delete (next as Record<string, unknown>).version
    delete (next as Record<string, unknown>).createdAt
    delete (next as Record<string, unknown>).createdBy
    const pub = await t.app.inject({ method: 'POST', url: '/v1/admin/prices', headers: admin.auth, payload: next })
    expect(pub.statusCode).toBe(200)
    expect(pub.json()).toMatchObject({ version: 2, creditValueEur: 0.02 })
    const second = (await ask()).json() as { gridVersion: number; totalCredits: number }
    expect(second).toMatchObject({ gridVersion: 2, totalCredits: 96 })
    const job = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: first.id, idempotencyKey: 'old-quote-1' } })
    expect(job.json()).toMatchObject({ credits: 192 })
    const denied = await t.app.inject({ method: 'POST', url: '/v1/admin/prices', headers: p.auth, payload: next })
    expect(denied.statusCode).toBe(403)
    const audit = t.cloud.audit.list().map((e) => e.action)
    expect(audit).toContain('price.grid')
  })

  it('a quote line whose reference is under 1 credit carries aboveReference: true (and a normal line false); the flag survives storage', async () => {
    const t = makeCloud({ gridMargins: true })
    const p = await signUpAndIn(t, { credits: 5000 })
    const ask = async (text: string) =>
      (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'synthesize', input: { text, voiceId: 'demo-claire' } } })).json() as {
        id: string
        totalCredits: number
        lines: { item: string; credits: number; aboveReference: boolean }[]
      }
    // Grid v1: reference €0.00022 per char, 1 credit = €0.01: one char is 0.022 credit of reference, charged the 1-credit minimum.
    const tiny = await ask('a')
    expect(tiny.lines).toHaveLength(1)
    expect(tiny.lines[0]).toMatchObject({ item: 'voice.chars', credits: 1, aboveReference: true })
    const big = await ask('a'.repeat(10_000))
    expect(big.lines[0]).toMatchObject({ credits: 192, aboveReference: false })
    expect(t.cloud.pricing.getQuote(tiny.id)?.lines[0]).toMatchObject({ aboveReference: true })
    expect(t.cloud.pricing.getQuote(big.id)?.lines[0]).toMatchObject({ aboveReference: false })
  })

  it('POST /v1/admin/prices returns the margin warnings and still publishes a margin outside its tier', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const current = (await t.app.inject({ url: '/v1/admin/prices', headers: admin.auth })).json() as { current: Record<string, unknown> & { items: PriceItem[] } }
    const { version: _v, createdAt: _c, createdBy: _b, ...base } = current.current
    const publish = async (items: PriceItem[]) =>
      t.app.inject({ method: 'POST', url: '/v1/admin/prices', headers: admin.auth, payload: { ...base, items } })
    const voiceItem = current.current.items.find((i) => i.item === 'voice.chars') as PriceItem
    const tier = suggestedMarginPct(voiceItem.providerCostUsd * (base.usdToEur as number) * (1 + (base.overheadPct as number) / 100), voiceItem.referenceEur)
    const off = tier === 5 ? 25 : 5
    const others = current.current.items.filter((i) => i.item !== 'voice.chars')
    const res = await publish([...others, { ...voiceItem, pricing: { mode: 'percent', marginPct: off } }])
    expect(res.statusCode).toBe(200)
    const body = res.json() as { version: number; warnings: { item: string; marginPct: number; tierPct: number }[] }
    expect(body.version).toBeGreaterThan(1)
    expect(body.warnings).toContainEqual({ item: 'voice.chars', marginPct: off, tierPct: tier })
    // Still published: it is now the current grid.
    const after = (await t.app.inject({ url: '/v1/admin/prices', headers: admin.auth })).json() as { current: { version: number; items: PriceItem[] } }
    expect(after.current.version).toBe(body.version)
    expect(after.current.items.find((i) => i.item === 'voice.chars')?.pricing).toEqual({ mode: 'percent', marginPct: off })
    // Putting the item back in its tier publishes with no warning for it.
    const fixed = await publish([...others, { ...voiceItem, pricing: { mode: 'percent', marginPct: tier } }])
    expect((fixed.json() as { warnings: { item: string }[] }).warnings.map((w) => w.item)).not.toContain('voice.chars')
  })

  it('an internal team is quoted at cost; a bad input is refused; an expired quote cannot start a job', async () => {
    const t = makeCloud()
    const me = await signUpAndIn(t, { internal: true, credits: 1000 })
    const q = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: me.auth, payload: { usage: 'synthesize', input: { text: 'a'.repeat(10_000), voiceId: 'demo-hugo' } } })
    // €1.7388 at cost → 174 credits (no margin).
    expect(q.json()).toMatchObject({ totalCredits: 174 })
    const bad = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: me.auth, payload: { usage: 'analyseVideo', input: { url: 'http://169.254.169.254/latest', minutes: 3 } } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ error: { code: 'bad_request' } })
    t.clock.advance(30 * 60_000)
    const late = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: me.auth, payload: { quoteId: (q.json() as { id: string }).id, idempotencyKey: 'late-quote' } })
    expect(late.statusCode).toBe(410)
    expect(t.cloud.wallet.state(me.teamId)).toMatchObject({ balance: 1000, held: 0 })
  })
})
