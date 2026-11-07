import { describe, expect, it } from 'vitest'
import { BudgetExceededError, LedgerError, monthBounds } from '../../src/main/ledger'
import { emptyUsage, type Usage } from '../../src/main/llm'
import { memoryCore } from './helpers'

const usage = (input: number, output: number): Usage => ({ ...emptyUsage(), inputTokens: input, outputTokens: output })

function setup(start = '2026-10-15T12:00:00.000Z') {
  const clock = { t: new Date(start) }
  const topics: string[] = []
  const core = memoryCore({ now: () => clock.t, notify: (t) => topics.push(t) })
  const ch = (name: string, budget: number | null = null) =>
    Number(
      core.db.prepare('INSERT INTO channels (name, monthly_budget_usd) VALUES (?, ?)').run(name, budget).lastInsertRowid
    )
  return { core, ledger: core.ledger, clock, topics, ch }
}

const OPUS = 'claude-opus-5-5'
const req = (extra: object = {}) => ({ providerId: 'anthropic', model: OPUS, estimate: { usd: 1 }, ...extra })

describe('ledger reserve / settle / release', () => {
  it('prices an estimate from the price table and books it as reserved', () => {
    const { ledger, core } = setup()
    const est = usage(1_000_000, 100_000)
    const h = ledger.reserve({ providerId: 'anthropic', model: OPUS, estimate: est })
    expect(h.estimateUsd).toBeCloseTo(6) // 1M in x $4 + 100k out x $20
    const row = core.db.prepare('SELECT status, estimate_usd, amount_usd FROM ledger WHERE id = ?').get(h.id)
    expect(row).toMatchObject({ status: 'reserved', amount_usd: 0 })
    expect(ledger.overview().reservedUsd).toBeCloseTo(6)
    expect(ledger.overview().spentUsd).toBe(0)
  })

  it('settle replaces the estimate by the real usage cost', () => {
    const { ledger } = setup()
    const h = ledger.reserve({ providerId: 'anthropic', model: OPUS, estimate: usage(1_000_000, 1_000_000) })
    const real = usage(200_000, 10_000)
    const amount = ledger.settle(h, real)
    expect(amount).toBeCloseTo(1) // 200k in x $4 + 10k out x $20
    const o = ledger.overview()
    expect(o.spentUsd).toBeCloseTo(1)
    expect(o.reservedUsd).toBe(0)
    expect(o.calls).toBe(1)
  })

  it('a provider-reported cost wins over the price table', () => {
    const { ledger } = setup()
    const h = ledger.reserve(req())
    expect(ledger.settle(h, usage(10, 10), { costUsd: 0.42 })).toBe(0.42)
    expect(ledger.overview().spentUsd).toBeCloseTo(0.42)
  })

  it('settle falls back to the estimate for a model without a price', () => {
    const { ledger } = setup()
    const h = ledger.reserve({ providerId: 'x', model: 'mystery', estimate: { usd: 0.3 } })
    expect(ledger.settle(h, usage(5, 5))).toBeCloseTo(0.3)
  })

  it('release refunds the reservation', () => {
    const { ledger, core } = setup()
    const h = ledger.reserve(req())
    ledger.release(h)
    expect(ledger.overview()).toMatchObject({ spentUsd: 0, reservedUsd: 0 })
    expect(core.db.prepare('SELECT status FROM ledger WHERE id = ?').get(h.id)).toEqual({ status: 'refunded' })
  })

  it('refuses to settle or release twice, or an unknown handle', () => {
    const { ledger } = setup()
    const h = ledger.reserve(req())
    ledger.settle(h, usage(1, 1))
    expect(() => ledger.settle(h, usage(1, 1))).toThrow(/already settled/)
    expect(() => ledger.release(h)).toThrow(LedgerError)
    expect(() => ledger.release({ id: 999, estimateUsd: 0 })).toThrow(/Unknown ledger entry/)
  })

  it('rejects an unknown model without explicit estimate and negative numbers', () => {
    const { ledger } = setup()
    expect(() => ledger.reserve({ providerId: 'x', model: 'nope', estimate: usage(1, 1) })).toThrow(/No price/)
    expect(() => ledger.reserve(req({ estimate: { usd: -1 } }))).toThrow(/non-negative/)
    expect(() => ledger.reserve(req({ estimate: { usd: Number.NaN } }))).toThrow(/non-negative/)
  })

  it('settles stale reservations left by a crash at their estimate (never refunds them), keeps fresh ones', () => {
    const { ledger, clock } = setup()
    ledger.reserve(req())
    clock.t = new Date('2026-10-15T12:30:00.000Z')
    const fresh = ledger.reserve(req())
    clock.t = new Date('2026-10-15T13:10:00.000Z')
    expect(ledger.settleStale(60 * 60 * 1000)).toBe(1)
    expect(ledger.overview().reservedUsd).toBe(1)
    expect(ledger.overview().spentUsd).toBe(1)
    expect(ledger.entries().map((e) => e.status).sort()).toEqual(['reserved', 'settled'])
    expect(() => ledger.settle(fresh, usage(1, 1))).not.toThrow()
  })

  it('settle never throws on bad provider numbers; reserve refuses an unknown channel', () => {
    const { ledger } = setup()
    const h = ledger.reserve(req({ estimate: { usd: 0.7 } }))
    expect(ledger.settle(h, usage(Number.NaN, -3), { costUsd: -1 })).toBeCloseTo(0)
    expect(() => ledger.reserve(req({ channelId: 77 }))).toThrow(/Unknown channel/)
  })

  it('settles every leftover reservation at core startup, and settings.set cannot touch the cap', async () => {
    const { core } = setup()
    core.ledger.reserve(req())
    expect(core.ledger.settleStale(0)).toBe(1)
    await expect(Promise.resolve().then(() => core.api['settings.set']('budget.globalMonthlyUsd', -5))).rejects.toThrow()
    core.context.settings.set('budget.globalMonthlyUsd', -5)
    expect(core.ledger.globalCap()).toBeNull()
  })

  it('notifies on every change', () => {
    const { ledger, topics } = setup()
    const h = ledger.reserve(req())
    ledger.settle(h, usage(1, 1))
    expect(topics).toEqual(['spend', 'spend'])
  })
})

describe('caps', () => {
  it('refuses a reservation that would cross the global cap, with a clear error, and books nothing', () => {
    const { ledger, core } = setup()
    ledger.setGlobalCap(5)
    ledger.settle(ledger.reserve(req({ estimate: { usd: 3 } })), usage(1, 1), { costUsd: 3 })
    ledger.reserve(req({ estimate: { usd: 2 } })) // exactly at the cap: allowed
    let err: unknown
    try {
      ledger.reserve(req({ estimate: { usd: 0.01 } }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(BudgetExceededError)
    expect(err).toMatchObject({ code: 'BUDGET_EXCEEDED', scope: 'global', capUsd: 5 })
    expect((err as Error).message).toMatch(/Global monthly budget exceeded/)
    expect((core.db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n).toBe(2)
  })

  it('open reservations count against the cap until released', () => {
    const { ledger } = setup()
    ledger.setGlobalCap(4)
    const h = ledger.reserve(req({ estimate: { usd: 3 } }))
    expect(() => ledger.reserve(req({ estimate: { usd: 2 } }))).toThrow(BudgetExceededError)
    ledger.release(h)
    expect(() => ledger.reserve(req({ estimate: { usd: 2 } }))).not.toThrow()
  })

  it('enforces a per-channel cap independently of other channels', () => {
    const { ledger, ch } = setup()
    const a = ch('A', 2)
    const b = ch('B', null)
    ledger.settle(ledger.reserve(req({ channelId: a, estimate: { usd: 1.5 } })), usage(1, 1), { costUsd: 1.5 })
    expect(() => ledger.reserve(req({ channelId: a, estimate: { usd: 1 } }))).toThrow(
      expect.objectContaining({ scope: 'channel', code: 'BUDGET_EXCEEDED' })
    )
    expect(() => ledger.reserve(req({ channelId: b, estimate: { usd: 100 } }))).not.toThrow()
    expect(() => ledger.reserve(req({ channelId: null, estimate: { usd: 100 } }))).not.toThrow()
  })

  it('a zero cap blocks everything; null removes the cap', () => {
    const { ledger, ch } = setup()
    const a = ch('A', 0)
    expect(() => ledger.reserve(req({ channelId: a }))).toThrow(BudgetExceededError)
    ledger.setChannelCap(a, null)
    expect(() => ledger.reserve(req({ channelId: a }))).not.toThrow()
    ledger.setGlobalCap(0)
    expect(() => ledger.reserve(req())).toThrow(BudgetExceededError)
    ledger.setGlobalCap(null)
    expect(ledger.globalCap()).toBeNull()
    expect(() => ledger.reserve(req())).not.toThrow()
  })

  it('settling is never refused even when the real cost exceeds the cap', () => {
    const { ledger } = setup()
    ledger.setGlobalCap(1)
    const h = ledger.reserve(req({ estimate: { usd: 1 } }))
    expect(ledger.settle(h, usage(1, 1), { costUsd: 2.5 })).toBe(2.5)
    expect(() => ledger.reserve(req({ estimate: { usd: 0.1 } }))).toThrow(BudgetExceededError)
  })

  it('validates cap values and channel ids', () => {
    const { ledger } = setup()
    expect(() => ledger.setGlobalCap(-1)).toThrow(/non-negative/)
    expect(() => ledger.setChannelCap(42, 1)).toThrow(/Unknown channel/)
  })

  it('month rollover: the new month starts with a clean slate, the old one stays queryable', () => {
    const { ledger, clock } = setup('2026-10-31T23:59:00.000Z')
    ledger.setGlobalCap(2)
    ledger.settle(ledger.reserve(req({ estimate: { usd: 2 } })), usage(1, 1), { costUsd: 2 })
    expect(() => ledger.reserve(req({ estimate: { usd: 0.5 } }))).toThrow(BudgetExceededError)
    clock.t = new Date('2026-11-01T00:00:00.000Z')
    expect(() => ledger.reserve(req({ estimate: { usd: 0.5 } }))).not.toThrow()
    expect(ledger.overview()).toMatchObject({ month: '2026-11', spentUsd: 0, reservedUsd: 0.5 })
    expect(ledger.overview('2026-10')).toMatchObject({ month: '2026-10', spentUsd: 2 })
  })

  it('month bounds are UTC and validated', () => {
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' })
    expect(() => monthBounds('2026-13')).toThrow(/Invalid month/)
    expect(() => monthBounds('oct')).toThrow(LedgerError)
  })
})

describe('summaries', () => {
  function seed() {
    const s = setup()
    const a = s.ch('Alpha', 10)
    const b = s.ch('Beta')
    const video = Number(
      s.core.db.prepare("INSERT INTO videos (channel_id, title) VALUES (?, 'Lost cities')").run(a).lastInsertRowid
    )
    const book = (day: string, providerId: string, model: string, channelId: number | null, videoId: number | null, usd: number) => {
      s.clock.t = new Date(`2026-10-${day}T10:00:00.000Z`)
      const h = s.ledger.reserve({ providerId, model, channelId, videoId, estimate: { usd } })
      s.ledger.settle(h, usage(1000, 500), { costUsd: usd })
    }
    book('02', 'anthropic', 'claude-opus-5-5', a, video, 3)
    book('02', 'claude-code', 'claude-sonnet-5-5', a, null, 1)
    book('09', 'claude-code', 'claude-sonnet-5-5', b, null, 0.5)
    book('09', 'anthropic', 'claude-haiku-5-5', null, null, 0.25)
    s.clock.t = new Date('2026-10-20T10:00:00.000Z')
    s.ledger.release(s.ledger.reserve({ providerId: 'anthropic', model: OPUS, channelId: a, estimate: { usd: 5 } }))
    s.clock.t = new Date('2026-09-30T10:00:00.000Z')
    s.ledger.settle(s.ledger.reserve({ providerId: 'anthropic', model: OPUS, estimate: { usd: 7 } }), usage(1, 1), { costUsd: 7 })
    s.clock.t = new Date('2026-10-15T12:00:00.000Z')
    return { ...s, a, b, video }
  }
  const pick = (rows: { key: string; spentUsd: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.spentUsd]))

  it('groups by provider, model, day', () => {
    const { ledger } = seed()
    expect(pick(ledger.summary('provider'))).toEqual({ anthropic: 3.25, 'claude-code': 1.5 })
    expect(pick(ledger.summary('model'))).toEqual({
      'claude-opus-5-5': 3, 'claude-sonnet-5-5': 1.5, 'claude-haiku-5-5': 0.25
    })
    expect(ledger.summary('day').map((r) => [r.key, r.spentUsd, r.calls])).toEqual([
      ['2026-10-02', 4, 2],
      ['2026-10-09', 0.75, 2]
    ])
  })

  it('groups by channel and video with names, and counts tokens', () => {
    const { ledger, a, b, video } = seed()
    const ch = ledger.summary('channel')
    expect(ch.map((r) => [r.key, r.label, r.spentUsd])).toEqual([
      [String(a), 'Alpha', 4],
      [String(b), 'Beta', 0.5],
      ['', '(no channel)', 0.25]
    ])
    expect(ch[0]).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 1000 })
    expect(ledger.summary('video')[0]).toMatchObject({ key: String(video), label: 'Lost cities', spentUsd: 3 })
  })

  it('overview: totals, per-channel spend against budget, month filter', () => {
    const { ledger, a, b } = seed()
    const o = ledger.overview()
    expect(o).toMatchObject({ month: '2026-10', spentUsd: 4.75, reservedUsd: 0, calls: 4, globalCapUsd: null })
    expect(o.channels).toEqual([
      { channelId: a, name: 'Alpha', budgetUsd: 10, spentUsd: 4, reservedUsd: 0 },
      { channelId: b, name: 'Beta', budgetUsd: null, spentUsd: 0.5, reservedUsd: 0 }
    ])
    expect(ledger.overview('2026-09').spentUsd).toBe(7)
  })

  it('entries: newest first, refunds included, limited', () => {
    const { ledger } = seed()
    const e = ledger.entries()
    expect(e).toHaveLength(5)
    expect(e[0]).toMatchObject({ status: 'refunded', channelName: 'Alpha' })
    expect(e.at(-1)).toMatchObject({ videoTitle: 'Lost cities', amountUsd: 3, status: 'settled' })
    expect(ledger.entries('2026-10', 2)).toHaveLength(2)
  })

  it('is exposed through the typed api', async () => {
    const { core } = seed()
    expect((await core.api['spend.overview']('2026-10')).spentUsd).toBe(4.75)
    expect((await core.api['spend.summary']('provider', '2026-10')).length).toBe(2)
    expect(() => core.api['spend.summary']('bogus' as 'day')).toThrow(/Unknown grouping/)
    await core.api['spend.setGlobalCap'](50)
    expect((await core.api['spend.overview']()).globalCapUsd).toBe(50)
    await core.api['spend.setChannelCap'](1, 3)
    expect(core.ledger.channelCap(1)).toBe(3)
  })
})
