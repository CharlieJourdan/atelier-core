// Kept from lot 3 by lot P1: migration 008 (engine_jobs as read-only history, the ledger's adjustment entries) and
// Ledger.adjust, which settles credits (reserve, then the real cost as an adjustment).
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../../src/main/db'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { Ledger } from '../../src/main/ledger'
import { pastRenders } from '../../src/main/production/history'
import { PricesStore } from '../../src/main/llm'
import { SettingsStore } from '../../src/main/settings'

function v7WithData(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db, MIGRATIONS.slice(0, 7))
  db.exec(`INSERT INTO channels (id, name) VALUES (1, 'History')`)
  db.exec(`INSERT INTO videos (id, channel_id, title) VALUES (1, 1, 'Ys')`)
  db.exec(`INSERT INTO deliverables (id, video_id, type) VALUES (1, 1, 'edit')`)
  db.exec(`INSERT INTO ledger (id, provider_id, model, channel_id, video_id, status, estimate_usd, amount_usd, created_at)
           VALUES (1, 'v1', 'v1:history', 1, 1, 'settled', 4, 4, '2026-10-01T10:00:00.000Z'),
                  (2, 'claude-code', 'claude-haiku-5-5', 1, 1, 'refunded', 0.1, 0, '2026-10-01T10:01:00.000Z')`)
  db.exec(`INSERT INTO v1_render_jobs (id, slug, video_id, deliverable_id, style, minutes, state, progress, estimate_usd, ledger_id)
           VALUES (7, 'ys-1', 1, 1, 'history', 8, 'done', 100, 4, 1)`)
  return db
}

describe('migration 008', () => {
  it('moves v1_render_jobs into engine_jobs and rebuilds the ledger without losing a row or a link', () => {
    const db = v7WithData()
    migrate(db, MIGRATIONS)
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name)
    expect(tables).toContain('engine_jobs')
    expect(tables).not.toContain('v1_render_jobs')
    expect(tables).not.toContain('ledger_v8')
    const job = db.prepare('SELECT * FROM engine_jobs WHERE id = 7').get() as Record<string, unknown>
    expect(job).toMatchObject({ target: 'local', slug: 'ys-1', ledger_id: 1, state: 'done', progress: 100, ext_seq: 0, measured_usd: null })
    expect(db.prepare('SELECT id, status, amount_usd FROM ledger ORDER BY id').all()).toEqual([
      { id: 1, status: 'settled', amount_usd: 4 },
      { id: 2, status: 'refunded', amount_usd: 0 }
    ])
    // the sequence goes on after the copied ids
    db.exec(`INSERT INTO ledger (provider_id, model, status) VALUES ('x', 'y', 'reserved')`)
    expect((db.prepare('SELECT MAX(id) AS m FROM ledger').get() as { m: number }).m).toBe(3)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('only an adjustment may be negative; a cancelled job state is allowed', () => {
    const db = openDatabase(':memory:')
    expect(() => db.exec(`INSERT INTO ledger (provider_id, model, status, amount_usd) VALUES ('x', 'y', 'settled', -1)`)).toThrow(/CHECK/)
    db.exec(`INSERT INTO ledger (provider_id, model, status, amount_usd) VALUES ('x', 'y', 'adjustment', -1)`)
    expect(() => db.exec(`INSERT INTO ledger (provider_id, model, status) VALUES ('x', 'y', 'other')`)).toThrow(/CHECK/)
    const cols = (db.prepare('PRAGMA table_info(engine_jobs)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['target', 'title', 'payload', 'step', 'stages', 'ext_run', 'ext_seq', 'measured_usd', 'adjustment_id']))
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'engine_jobs'`).get() as { sql: string }).sql
    expect(sql).toContain("'cancelled'")
  })

  it('past renders stay readable as history after the upgrade, newest first and per video', () => {
    const db = v7WithData()
    db.exec(`INSERT INTO videos (id, channel_id, title) VALUES (2, 1, 'Other')`)
    db.exec(`INSERT INTO deliverables (id, video_id, type) VALUES (2, 2, 'edit')`)
    db.exec(`INSERT INTO v1_render_jobs (id, slug, video_id, deliverable_id, style, minutes, state, error, estimate_usd)
             VALUES (8, 'other-1', 2, 2, 'history', 5, 'error', 'stopped', 2)`)
    migrate(db, MIGRATIONS)
    const all = pastRenders(db)
    expect(all.map((r) => r.id)).toEqual([8, 7])
    expect(all[1]).toMatchObject({ target: 'local', title: '', videoId: 1, deliverableId: 1, state: 'done', error: null, estimateUsd: 4, measuredUsd: null })
    expect(pastRenders(db, 2)).toEqual([expect.objectContaining({ id: 8, state: 'error', error: 'stopped', estimateUsd: 2 })])
    expect(pastRenders(db, 99)).toEqual([])
  })
})

describe('Ledger.adjust', () => {
  const setup = () => {
    const db = openDatabase(':memory:')
    db.exec(`INSERT INTO channels (id, name, monthly_budget_usd) VALUES (1, 'History', 10)`)
    const now = () => new Date('2026-10-19T12:00:00Z')
    const ledger = new Ledger(db, new PricesStore(db), new SettingsStore(db), now)
    const h = ledger.reserve({ providerId: 'v1', model: 'v1:history', channelId: 1, estimate: { usd: 4 } })
    ledger.settleAtEstimate(h)
    return { db, ledger, h }
  }

  it('writes the difference (negative when cheaper), once, and the month totals follow', () => {
    const { ledger, h } = setup()
    const adj = ledger.adjust(h.id, 0.4, 'measured')
    expect(adj?.deltaUsd).toBeCloseTo(-3.6, 9)
    expect(ledger.adjust(h.id, 0.4)).toBeNull() // same figure again: nothing more
    expect(ledger.overview('2026-10').spentUsd).toBeCloseTo(0.4, 9)
    expect(ledger.overview('2026-10').calls).toBe(1)
    const byProvider = ledger.summary('provider', '2026-10')
    expect(byProvider).toEqual([expect.objectContaining({ key: 'v1', spentUsd: expect.closeTo(0.4, 9), calls: 1 })])
    const entries = ledger.entries('2026-10')
    expect(entries.map((e) => e.status)).toEqual(['adjustment', 'settled'])
    expect(entries[0]).toMatchObject({ providerId: 'v1', channelId: 1, amountUsd: expect.closeTo(-3.6, 9) })
    // dearer than booked: a positive correction on top
    expect(ledger.adjust(h.id, 5)?.deltaUsd).toBeCloseTo(4.6, 9)
    expect(ledger.overview('2026-10').spentUsd).toBeCloseTo(5, 9)
  })

  it('counts against the caps, is never refused, and only corrects settled entries', () => {
    const { ledger, h } = setup()
    ledger.adjust(h.id, 12) // over the channel's $10 cap: the money is spent anyway
    expect(ledger.capReached(1)?.scope).toBe('channel')
    expect(() => ledger.reserve({ providerId: 'x', model: 'y', channelId: 1, estimate: { usd: 0.01 } })).toThrow(/budget/)
    const open = ledger.reserve({ providerId: 'x', model: 'y', estimate: { usd: 0 } })
    expect(() => ledger.adjust(open.id, 1)).toThrow(/not settled/)
    expect(() => ledger.adjust(h.id, -1)).toThrow(/non-negative/)
    expect(() => ledger.adjust(9999, 1)).toThrow(/Unknown/)
  })
})
