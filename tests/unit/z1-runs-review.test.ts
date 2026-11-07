// Lot Z1 review fixes: example credits are never spendable nor part of the real balance; example runs are never real
// spend (cost per video, P&L, weekly curve, monthly spend); a replayed capture does not count twice and a retry's new
// hold can capture the same node.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LocalWallet } from '../../src/main/credits'
import { InsufficientCredits } from '../../src/main/credits/port'
import { openDatabase } from '../../src/main/db'
import { RunMoney } from '../../src/main/production/runs/money'
import { BalanceTiles, costPerVideo } from '../../src/renderer/screens/settings/account/AccountScreen'
import { figuresOf } from '../../src/renderer/screens/production/apercu/ApercuScreen'
import { computePnl, totalsFor } from '../../src/shared/money'
import type { RunSummary } from '../../src/shared/runs'
import { memoryCore } from './helpers'

const wallet = (): { w: LocalWallet; db: ReturnType<typeof openDatabase> } => {
  const db = openDatabase(':memory:')
  return { w: new LocalWallet(db, () => new Date('2026-10-20T10:00:00Z')), db }
}

describe('B1: example credits are not spendable', () => {
  it('an example grant is reported apart: not in available nor total', () => {
    const { w } = wallet()
    w.grant({ amount: 100, idempotencyKey: 'real' })
    w.grant({ amount: 2000, idempotencyKey: 'ex', source: 'example', example: true })
    // behaviour changed on purpose: the example grant used to count in available/total
    expect(w.balance()).toEqual({ available: 100, held: 0, total: 100, simulated: 0, example: 2000 })
  })

  it('a hold is refused beyond the REAL credits, even with example credits around', () => {
    const { w } = wallet()
    w.grant({ amount: 100, idempotencyKey: 'real' })
    w.grant({ amount: 2000, idempotencyKey: 'ex', source: 'example', example: true })
    expect(() => w.hold({ amount: 101, idempotencyKey: 'h' })).toThrow(InsufficientCredits)
    expect(w.hold({ amount: 100, idempotencyKey: 'h2' }).amount).toBe(100)
  })

  it('deleting the example leaves a non-negative balance whatever the runs spent', async () => {
    const core = memoryCore()
    try {
      core.context.credits.grant({ amount: 500, idempotencyKey: 'real' })
      await core.api['example.load']()
      const h = core.context.credits.hold({ amount: 400, idempotencyKey: 'h' })
      core.context.credits.capture({ holdId: h.holdId, amount: 300, idempotencyKey: 'c' })
      core.context.credits.release({ holdId: h.holdId, idempotencyKey: 'r' })
      const before = await core.api['credits.balance']()
      expect(before).toMatchObject({ available: 200, total: 200 })
      expect(before.example).toBeGreaterThan(0)
      await core.api['example.delete']()
      const after = await core.api['credits.balance']()
      expect(after).toMatchObject({ available: 200, total: 200, example: 0 })
      expect(after.available).toBeGreaterThanOrEqual(0)
    } finally {
      core.close()
    }
  })
})

describe('B2: example runs are not real spend', () => {
  const run = (over: Partial<RunSummary>): Pick<RunSummary, 'spentCredits' | 'demo' | 'example'> => ({ spentCredits: 100, demo: false, example: false, ...over })

  it('cost per video ignores example runs', () => {
    expect(costPerVideo([run({ spentCredits: 900, example: true })])).toBeNull()
    expect(costPerVideo([run({ spentCredits: 200 }), run({ spentCredits: 900, example: true })])).toEqual({ average: 200, n: 1 })
  })

  it('spent this month ignores example runs', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const mk = (spent: number, example: boolean): RunSummary =>
      ({ status: 'succeeded', startedAt: '2026-10-05T10:00:00Z', createdAt: '2026-10-05T10:00:00Z', finishedAt: '2026-10-05T11:00:00Z', spentCredits: spent, example }) as RunSummary
    expect(figuresOf([mk(50, false), mk(700, true)], now).spentThisMonth).toBe(50)
  })

  it('totals keep example channels apart and never mix their revenue into the real total', () => {
    const rows = computePnl({
      months: ['2026-10'],
      channels: [
        { id: 1, example: false },
        { id: 2, example: true }
      ],
      revenues: [
        { date: '2026-10-01', channelId: 1, type: 'adsense', amountCents: 100, currency: 'EUR', source: 'manual' },
        { date: '2026-10-02', channelId: 2, type: 'adsense', amountCents: 5000, currency: 'EUR', source: 'example' }
      ],
      aiUsd: [],
      credits: [{ channelId: 2, month: '2026-10', credits: 40 }],
      published: [],
      usdToEur: 1
    })
    const t = totalsFor(rows, '2026-10')
    expect(t).toMatchObject({ revenueCents: 100, costCents: 0, marginCents: 100 })
    expect(t.example).toMatchObject({ revenueCents: 5000, costCents: 40, marginCents: 4960 })
  })

  it('the overview counts real runs only: example runs are out of the credits, the totals and the weekly curve', async () => {
    const core = memoryCore()
    try {
      await core.api['example.load']()
      const mine = (await core.api['channels.create']({ name: 'Ma chaîne' })).id
      const vid = Number(core.db.prepare("INSERT INTO videos (channel_id, title) VALUES (?, 'V')").run(mine).lastInsertRowid)
      const at = new Date().toISOString()
      core.db
        .prepare(
          `INSERT INTO video_runs (video_id, channel_id, pipeline_json, pipeline_label, topic, minutes, budget_mode, gate_mode, status, demo, spent_credits, created_at, finished_at)
           VALUES (?, ?, '{}', 'p', 't', 1, 'usage_max', 'step', 'succeeded', 0, 320, ?, ?)`
        )
        .run(vid, mine, at, at)
      const o = await core.api['money.overview']()
      const exampleIds = o.channels.filter((c) => c.example).map((c) => c.id)
      // example video runs (non-zero spend) are on example channels and must not reach any real figure
      expect(o.rows.filter((r) => exampleIds.includes(r.channelId!)).every((r) => r.engineCents === 0)).toBe(true)
      expect(o.totals.revenueCents).toBe(0)
      expect(o.totals.costCents).toBe(320)
      expect(o.weekly.reduce((s, w) => s + w.revenueCents, 0)).toBe(0)
      expect(o.weekly.reduce((s, w) => s + w.costCents, 0)).toBe(320)
      expect(o.totals.example?.revenueCents).toBeGreaterThan(0)
      expect(o.totals.example?.weekly).toHaveLength(8)
    } finally {
      core.close()
    }
  })
})

describe('S5: captures are idempotent for the run counters', () => {
  function setup() {
    const { w, db } = wallet()
    db.exec(`INSERT INTO channels (id, name) VALUES (1, 'C'); INSERT INTO videos (id, channel_id, title) VALUES (1, 1, 'V');`)
    db.prepare(
      `INSERT INTO video_runs (id, video_id, channel_id, pipeline_json, pipeline_label, topic, minutes, budget_mode, gate_mode, status, demo, created_at)
       VALUES (1, 1, 1, '{}', 'p', 't', 1, 'usage_max', 'step', 'running', 0, '2026-10-20T10:00:00Z')`
    ).run()
    db.prepare("INSERT INTO video_run_nodes (run_id, node_id, position, type, label) VALUES (1, 'voice', 0, 'voice.tts@1', 'Voix')").run()
    w.grant({ amount: 1000, idempotencyKey: 'g' })
    const counters = (): { run: number; node: number } => ({
      run: (db.prepare('SELECT spent_credits AS c FROM video_runs WHERE id = 1').get() as { c: number }).c,
      node: (db.prepare("SELECT credits AS c FROM video_run_nodes WHERE run_id = 1 AND node_id = 'voice'").get() as { c: number }).c
    })
    return { w, db, counters }
  }
  const cost = { provider: 'elevenlabs', units: [{ unit: 'chars' as const, qty: 1000 }] }

  it('a replayed capture does not add to the run and node credits again', () => {
    const { w, db, counters } = setup()
    const h = w.hold({ amount: 500, idempotencyKey: 'h1', runId: 1 })
    new RunMoney(w, db, 1, h.holdId, () => undefined).nodeDone('voice', 'fp', cost as never)
    const once = counters()
    expect(once.run).toBeGreaterThan(0)
    // same hold, same node and fingerprint: the wallet replays the first capture
    new RunMoney(w, db, 1, h.holdId, () => undefined).nodeDone('voice', 'fp', cost as never)
    expect(counters()).toEqual(once)
    expect(w.entries().filter((e) => e.kind === 'capture')).toHaveLength(1)
  })

  it('a retry (new hold) can capture the same node and fingerprint without an idempotency conflict', () => {
    const { w, db, counters } = setup()
    const h1 = w.hold({ amount: 500, idempotencyKey: 'h1', runId: 1 })
    new RunMoney(w, db, 1, h1.holdId, () => undefined).nodeDone('voice', 'fp', cost as never)
    const first = counters().run
    w.release({ holdId: h1.holdId, idempotencyKey: 'r1' })
    const h2 = w.hold({ amount: 500, idempotencyKey: 'h2', runId: 1 })
    expect(() => new RunMoney(w, db, 1, h2.holdId, () => undefined).nodeDone('voice', 'fp', cost as never)).not.toThrow()
    expect(counters().run).toBe(first * 2) // a genuinely new capture on the new hold counts
    expect(w.entries().filter((e) => e.kind === 'capture')).toHaveLength(2)
  })
})

describe('example credits line', () => {
  it('the account tiles show the real balance and the example credits as a separate badged line', () => {
    const html = renderToStaticMarkup(BalanceTiles({ balance: { available: 100, held: 0, total: 100, simulated: 0, example: 2000 }, runs: [] }))
    expect(html).toContain('data-testid="example-credits"')
    expect(html).toContain('non dépensables')
    expect(html).toContain('data-testid="example-badge"')
    const none = renderToStaticMarkup(BalanceTiles({ balance: { available: 100, held: 0, total: 100, simulated: 0, example: 0 }, runs: [] }))
    expect(none).not.toContain('example-credits')
  })
})
