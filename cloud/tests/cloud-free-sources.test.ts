// audit-depenses (2026-11-04): a source that costs us nothing costs the user nothing. The beta billed 1 credit for each of 195
// Pixabay searches (the one-credit minimum applied to a line whose provider cost is 0). Decision 0105: a grid line with a
// provider cost of 0 is priced 0 credit, a quote and a job may be 0 credit, and the abuse protection (open jobs per team,
// requests per minute) is untouched. A paid line keeps its one-credit minimum.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { PriceItem } from '../../src/shared/cloud-api.ts'
import { CLOUD_MIGRATIONS } from '../src/db/migrations/index.ts'
import { migrateCloud, openCloudDb } from '../src/db/index.ts'
import { LATE_ITEMS, priceLine } from '../src/pricing.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const GRID = { creditValueEur: 0.01, usdToEur: 0.92, overheadPct: 5 }
const item = (providerCostUsd: number, over: Partial<PriceItem> = {}): PriceItem => ({
  item: 'x.y',
  usage: 'searchStock',
  unit: 'search',
  providerCostUsd,
  referenceEur: null,
  pricing: { mode: 'percent', marginPct: 50 },
  ...over
})

describe('a free line costs 0 credit, a paid line keeps the one-credit minimum', () => {
  it('provider cost 0: 0 credit, whatever the margin, the multiplier or the quantity; an internal team too', () => {
    expect(priceLine(GRID, item(0), 1).credits).toBe(0)
    expect(priceLine(GRID, item(0), 40).credits).toBe(0)
    expect(priceLine({ ...GRID, priceMultiplier: 1.5 }, item(0), 1).credits).toBe(0)
    expect(priceLine(GRID, item(0), 1, true).credits).toBe(0)
    expect(priceLine(GRID, item(0), 1)).toMatchObject({ belowCost: false, aboveReference: false })
  })

  it('provider cost above 0: the one-credit minimum stays (a tiny search, a saved voice preview measured 0)', () => {
    expect(priceLine(GRID, item(0.002), 1).credits).toBe(1)
    expect(priceLine(GRID, item(0.08, { usage: 'designVoice' }), 0).credits).toBe(1)
  })

  it('a fixed price on a zero-cost line is still charged (an explicit price is a decision, not an error)', () => {
    expect(priceLine(GRID, item(0, { pricing: { mode: 'fixed', creditsPerUnit: 2 } }), 3).credits).toBe(6)
  })

  it('the default stock-search line costs us nothing: Pixabay, Pexels, Commons, the archives bill nothing', () => {
    const stock = LATE_ITEMS.find((i) => i.item === 'stock.searches') as PriceItem
    expect(stock.providerCostUsd).toBe(0)
    expect(priceLine(GRID, stock, 1).credits).toBe(0)
  })
})

describe('a stock search through the Cloud', () => {
  it('is quoted 0 credit, runs with an empty wallet, holds and charges nothing, and leaves a job row at 0', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 0 })
    const { quote, job } = await quoteAndRun(t, p, 'searchStock', { query: 'phare', count: 2 })
    expect(quote.totalCredits).toBe(0)
    expect(t.cloud.pricing.getQuote(quote.id)?.lines).toEqual([expect.objectContaining({ item: 'stock.searches', quantity: 1, credits: 0 })])
    expect(job).toMatchObject({ state: 'succeeded', credits: 0 })
    expect(t.cloud.wallet.entries(p.teamId).entries.filter((e) => e.kind === 'hold' || e.kind === 'capture')).toEqual([])
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 0, held: 0 })
  })

  it('a paid usage next to it still holds and charges (the wallet is untouched by the free ones)', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 100 })
    await quoteAndRun(t, p, 'searchStock', { query: 'phare', count: 1 })
    const { quote, job } = await quoteAndRun(t, p, 'generateImage', { prompt: 'un phare', width: 512, height: 512 })
    expect(quote.totalCredits).toBeGreaterThan(0)
    expect(job.credits as number).toBeGreaterThan(0)
    expect(t.cloud.wallet.state(p.teamId).balance).toBe(100 - (job.credits as number))
  })

  it('stays rate limited: a team with its open-jobs cap reached is refused a free search too (decision 0088)', async () => {
    const t = makeCloud({ maxOpenJobsPerTeam: 1 })
    const p = await signUpAndIn(t, { credits: 0 })
    const quote = async (i: number) =>
      ((await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'searchStock', input: { query: `phare ${i}`, count: 1 } } })).json() as { id: string }).id
    const first = await quote(1)
    // A job of this team still waiting: the cap is reached whatever it is worth.
    t.cloud.db
      .prepare("INSERT INTO jobs (id, team_id, account_id, usage, quote_id, idem_key, state, credits, provider, demo, created_at, updated_at) VALUES ('job_wait', ?, ?, 'searchStock', ?, 'wait-key-1', 'queued', 0, 'pixabay', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z')")
      .run(p.teamId, p.accountId, first)
    const r = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: await quote(2), idempotencyKey: 'free-key-2-xx' } })
    expect(r.statusCode).toBe(429)
    expect((r.json() as { error: { code: string } }).error.code).toBe('rate_limited')
  })
})

describe('migration 020: quotes may be worth 0 credit', () => {
  it('on a populated WAL file: quotes and jobs kept, a second open connection accepts a 0-credit quote, the file passes integrity_check after reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-mig020-'))
    const file = join(dir, 'cloud.db')
    const db = openCloudDb(file, CLOUD_MIGRATIONS.slice(0, 19))
    const other = new DatabaseSync(file) // a second connection opened before the migration
    other.exec('PRAGMA foreign_keys = ON')
    other.prepare('SELECT COUNT(*) FROM quotes').get()
    const t0 = '2026-11-03T22:00:00.000Z'
    db.prepare("INSERT INTO teams (id, name, created_at) VALUES ('team_a', 'A', ?)").run(t0)
    db.prepare("INSERT INTO accounts (id, email, name, password_hash, platform_admin, created_at) VALUES ('acc_a', 'a@example.com', 'A', 'x', 0, ?)").run(t0)
    const quote = (id: string, credits: number) =>
      `INSERT INTO quotes (id, team_id, account_id, usage, input_json, lines_json, total_credits, cost_eur, grid_version, demo, created_at, expires_at)
       VALUES ('${id}', 'team_a', 'acc_a', 'searchStock', '{}', '[]', ${credits}, 0, 1, 0, '${t0}', '${t0}')`
    db.exec(quote('qt_1', 1))
    db.prepare("INSERT INTO jobs (id, team_id, account_id, usage, quote_id, idem_key, state, credits, provider, demo, created_at, updated_at) VALUES ('job_1', 'team_a', 'acc_a', 'searchStock', 'qt_1', 'k', 'succeeded', 1, 'pixabay', 0, ?, ?)").run(t0, t0)
    expect(() => db.exec(quote('qt_0', 0))).toThrow()
    expect(migrateCloud(db)).toEqual([20])
    db.exec(quote('qt_2', 0))
    other.exec(quote('qt_3', 0)) // the cookie bump made the other connection reload the schema
    expect(() => other.exec(quote('qt_4', -1))).toThrow()
    expect(db.prepare('SELECT j.id, q.total_credits AS c FROM jobs j JOIN quotes q ON q.id = j.quote_id').all()).toEqual([{ id: 'job_1', c: 1 }])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    other.close()
    db.close()
    const again = new DatabaseSync(file)
    expect(again.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    expect(again.prepare('SELECT COUNT(*) AS n FROM quotes').get()).toEqual({ n: 3 })
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
