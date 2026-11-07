// The wallet's proofs (PLAN-V2-PRODUCTION §7 P3): the balance is always the sum of the entries; 50 holds in a row
// never take it under zero (in one process through the HTTP API, and truly in parallel across connections from 6 worker threads); a
// replayed capture counts once; orphan holds go back after 24 h; caps and idempotency.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { Audit } from '../src/audit.ts'
import { HOUR_MS, ManualClock } from '../src/clock.ts'
import { openCloudDb } from '../src/db/index.ts'
import { CloudError } from '../src/errors.ts'
import { Wallet } from '../src/wallet.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function team(t: ReturnType<typeof makeCloud>, credits = 0) {
  const { team: tm, account } = t.cloud.accounts.createAccount({
    email: `w${Math.random().toString(16).slice(2)}@example.com`,
    name: 'W',
    password: 'long enough password',
    actor: 'test'
  })
  if (credits) t.cloud.wallet.grant({ teamId: tm.id, credits, idemKey: 'seed-grant', actor: 'test' })
  return { teamId: tm.id, accountId: account.id }
}

const expectCode = (fn: () => unknown, code: string): void => {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(CloudError)
    expect((err as CloudError).code).toBe(code)
    return
  }
  throw new Error(`expected a ${code} refusal`)
}

describe('balance = sum of the entries', () => {
  it('holds after 300 random movements (grants, holds, captures, releases, adjustments, replays, refusals)', () => {
    const t = makeCloud()
    const { teamId, accountId } = team(t)
    const w = t.cloud.wallet
    const rnd = seeded(20261019)
    const open: string[] = []
    const keys: { kind: string; key: string; credits: number; holdId?: string }[] = []
    let refusals = 0
    for (let i = 0; i < 300; i++) {
      const r = rnd()
      const n = 1 + Math.floor(rnd() * 400)
      try {
        if (r < 0.2) {
          w.grant({ teamId, credits: n, idemKey: `g${i}`, actor: 'test' })
          keys.push({ kind: 'grant', key: `g${i}`, credits: n })
        } else if (r < 0.55) {
          const h = w.hold({ teamId, accountId, credits: n, idemKey: `h${i}` })
          open.push(h.holdId)
        } else if (r < 0.75 && open.length) {
          const holdId = open.splice(Math.floor(rnd() * open.length), 1)[0] as string
          w.capture({ holdId, idemKey: `c${i}`, credits: Math.floor(rnd() * n) % 50 === 0 ? 0 : undefined })
          keys.push({ kind: 'capture', key: `c${i}`, credits: 0, holdId })
        } else if (r < 0.88 && open.length) {
          const holdId = open.splice(Math.floor(rnd() * open.length), 1)[0] as string
          w.release({ holdId, idemKey: `r${i}` })
        } else if (r < 0.95) {
          w.adjust({ teamId, credits: rnd() < 0.5 ? -n : n, idemKey: `a${i}`, actor: 'test' })
        } else if (keys.length) {
          const k = keys[Math.floor(rnd() * keys.length)] as (typeof keys)[number]
          const before = w.state(teamId)
          if (k.kind === 'grant') expect(w.grant({ teamId, credits: k.credits, idemKey: k.key, actor: 'test' }).replayed).toBe(true)
          else {
            const entry = w.entries(teamId, { limit: 500 }).entries.find((e) => e.holdId === k.holdId && e.kind === 'capture')
            if (entry) expect(w.capture({ holdId: k.holdId as string, idemKey: k.key, credits: -entry.delta }).replayed).toBe(true)
          }
          expect(w.state(teamId)).toEqual(before)
        }
      } catch (err) {
        expect(err).toBeInstanceOf(CloudError)
        expect(['insufficient_credits', 'cap_exceeded']).toContain((err as CloudError).code)
        refusals++
      }
      const s = w.state(teamId)
      const sum = w.sumOfEntries(teamId)
      expect({ balance: s.balance, held: s.held }).toEqual(sum)
      expect(s.available).toBeGreaterThanOrEqual(0)
      expect(s.held).toBeGreaterThanOrEqual(0)
    }
    expect(refusals).toBeGreaterThan(0)
  })

  it('GET /v1/wallet equals the sum of GET /v1/wallet/entries, page after page', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    for (let i = 0; i < 30; i++) {
      const h = t.cloud.wallet.hold({ teamId: p.teamId, accountId: p.accountId, credits: 7, idemKey: `hold-${i}` })
      if (i % 2) t.cloud.wallet.capture({ holdId: h.holdId, idemKey: `cap-${i}`, credits: 5 })
      else if (i % 3) t.cloud.wallet.release({ holdId: h.holdId, idemKey: `rel-${i}` })
    }
    const wallet = (await t.app.inject({ url: '/v1/wallet', headers: p.auth })).json() as { balance: number; held: number; available: number }
    let balance = 0
    let held = 0
    let cursor: string | null = null
    let pages = 0
    do {
      const url: string = `/v1/wallet/entries?limit=7${cursor ? `&cursor=${cursor}` : ''}`
      const page = (await t.app.inject({ url, headers: p.auth })).json() as { entries: { delta: number; heldDelta: number }[]; nextCursor: string | null }
      for (const e of page.entries) {
        balance += e.delta
        held += e.heldDelta
      }
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBeGreaterThan(3)
    expect({ balance, held }).toEqual({ balance: wallet.balance, held: wallet.held })
    expect(wallet.available).toBe(wallet.balance - wallet.held)
    expect(wallet.balance).toBe(1000 - 15 * 5)
  })
})

describe('holds never take the balance under zero', () => {
  it('50 holds in a row through the API never go below zero: exactly floor(1 000 ÷ price) accepted, the rest refused', async () => {
    const t = makeCloud({ gridMargins: true, maxConcurrentJobs: 1 })
    const p = await signUpAndIn(t, { credits: 1000 })
    // A 10 s generated video at grid v1: ceil(10 × $0.05 × 0.92 × 1.05 × 1.25 ÷ €0.01) = 61 credits, under the €1 reference.
    const quotes = await Promise.all(
      Array.from({ length: 50 }, () =>
        t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateVideo', input: { prompt: 'x', seconds: 10 } } })
      )
    )
    const ids = quotes.map((q) => (q.json() as { id: string; totalCredits: number }).id)
    const credits = (quotes[0]?.json() as { totalCredits: number }).totalCredits
    expect(credits).toBe(Math.min(Math.ceil((10 * 0.05 * 0.92 * 1.05 * 1.25) / 0.01 - 1e-9), Math.floor((10 * 0.1) / 0.01)))
    const answers = await Promise.all(
      ids.map((quoteId, i) => t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId, idempotencyKey: `burst-job-${i}` } }))
    )
    const accepted = answers.filter((a) => a.statusCode === 200).length
    const refused = answers.filter((a) => a.statusCode === 402)
    expect(accepted).toBe(Math.floor(1000 / credits))
    expect(accepted + refused.length).toBe(50)
    expect((refused[0]?.json() as { error: { code: string } }).error.code).toBe('insufficient_credits')
    const s = t.cloud.wallet.state(p.teamId)
    expect(s.available).toBeGreaterThanOrEqual(0)
    expect(s.available).toBe(1000 - accepted * credits)
    await t.cloud.jobs.whenIdle()
    const end = t.cloud.wallet.state(p.teamId)
    expect(end.held).toBe(0)
    expect(end.balance).toBe(1000 - accepted * credits)
    expect({ balance: end.balance, held: end.held }).toEqual(t.cloud.wallet.sumOfEntries(p.teamId))
  })

  it('across connections: 6 worker threads (start barrier) × 20 holds of 30 on one database file → 33 accepted, 87 refused, never below zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-cloud-race-'))
    const path = join(dir, 'cloud.db')
    const db = openCloudDb(path)
    try {
      const clock = new ManualClock()
      const audit = new Audit(db, clock)
      db.prepare(`INSERT INTO teams (id, name, internal, created_at) VALUES ('team_race', 'Race', 0, '2026-10-19T00:00:00Z')`).run()
      new Wallet(db, clock, audit).grant({ teamId: 'team_race', credits: 1000, idemKey: 'seed', actor: 'test' })
      const WORKERS = 6
      const HOLDS = 20
      const barrier = new SharedArrayBuffer(8)
      const results = await Promise.all(
        Array.from(
          { length: WORKERS },
          (_, worker) =>
            new Promise<{ ok: number; refused: number }>((resolve, reject) => {
              const w = new Worker(new URL('./fixtures/hold-worker.ts', import.meta.url), {
                workerData: { path, teamId: 'team_race', worker, holds: HOLDS, credits: 30, barrier, parties: WORKERS }
              })
              w.once('message', resolve)
              w.once('error', reject)
            })
        )
      )
      // Every worker passed the start barrier before the first hold.
      expect(Atomics.load(new Int32Array(barrier), 0)).toBe(WORKERS)
      const ok = results.reduce((s, r) => s + r.ok, 0)
      const refused = results.reduce((s, r) => s + r.refused, 0)
      // 1 000 ÷ 30 = 33 holds fit (990); the other 120 − 33 = 87 are refused.
      expect(ok).toBe(33)
      expect(refused).toBe(WORKERS * HOLDS - 33)
      expect(refused).toBe(87)
      const wallet = new Wallet(db, clock, audit)
      const s = wallet.state('team_race')
      expect(s).toMatchObject({ balance: 1000, held: 990, available: 10 })
      expect(wallet.sumOfEntries('team_race')).toEqual({ balance: 1000, held: 990 })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('settlement and idempotency', () => {
  it('a replayed capture counts once; a second capture under another key is refused', () => {
    const t = makeCloud()
    const { teamId, accountId } = team(t, 500)
    const w = t.cloud.wallet
    const h = w.hold({ teamId, accountId, credits: 120, idemKey: 'job-1:hold' })
    const first = w.capture({ holdId: h.holdId, idemKey: 'job-1:capture', credits: 100 })
    const again = w.capture({ holdId: h.holdId, idemKey: 'job-1:capture', credits: 100 })
    expect(first.replayed).toBe(false)
    expect(again.replayed).toBe(true)
    expect(again.entry.id).toBe(first.entry.id)
    expect(w.state(teamId)).toMatchObject({ balance: 400, held: 0, available: 400 })
    expectCode(() => w.capture({ holdId: h.holdId, idemKey: 'job-1:capture-bis', credits: 100 }), 'conflict')
    expectCode(() => w.release({ holdId: h.holdId, idemKey: 'job-1:release' }), 'conflict')
    expect(w.entries(teamId).entries.filter((e) => e.kind === 'capture')).toHaveLength(1)
    expect(w.state(teamId).balance).toBe(400)
  })

  it('a replayed partial capture without credits (or with the same credits) answers the first result; another amount conflicts', () => {
    const t = makeCloud()
    const { teamId, accountId } = team(t, 500)
    const w = t.cloud.wallet
    const h = w.hold({ teamId, accountId, credits: 120, idemKey: 'p-hold' })
    const first = w.capture({ holdId: h.holdId, idemKey: 'p-capture', credits: 70 })
    const bare = w.capture({ holdId: h.holdId, idemKey: 'p-capture' })
    const same = w.capture({ holdId: h.holdId, idemKey: 'p-capture', credits: 70 })
    expect(bare).toMatchObject({ replayed: true, entry: { id: first.entry.id, delta: -70 } })
    expect(same.replayed).toBe(true)
    expectCode(() => w.capture({ holdId: h.holdId, idemKey: 'p-capture', credits: 71 }), 'conflict')
    expectCode(() => w.capture({ holdId: h.holdId, idemKey: 'p-capture', credits: 120 }), 'conflict')
    expect(w.state(teamId)).toMatchObject({ balance: 430, held: 0 })
    expect(w.entries(teamId).entries.filter((e) => e.kind === 'capture')).toHaveLength(1)
  })

  it('a replayed hold or grant answers the first result; the same key for another movement is a conflict', () => {
    const t = makeCloud()
    const { teamId, accountId } = team(t, 100)
    const w = t.cloud.wallet
    const a = w.hold({ teamId, accountId, credits: 60, idemKey: 'k-hold' })
    const b = w.hold({ teamId, accountId, credits: 60, idemKey: 'k-hold' })
    expect(b.holdId).toBe(a.holdId)
    expect(w.state(teamId).held).toBe(60)
    expectCode(() => w.hold({ teamId, accountId, credits: 61, idemKey: 'k-hold' }), 'conflict')
    expectCode(() => w.grant({ teamId, credits: 60, idemKey: 'k-hold', actor: 'test' }), 'conflict')
    expect(w.grant({ teamId, credits: 100, idemKey: 'seed-grant', actor: 'test' }).replayed).toBe(true)
    expect(w.state(teamId).balance).toBe(100)
  })

  it('refuses a capture above the hold, a hold above the available credits, and a negative adjustment under the holds', () => {
    const t = makeCloud()
    const { teamId, accountId } = team(t, 100)
    const w = t.cloud.wallet
    const h = w.hold({ teamId, accountId, credits: 80, idemKey: 'h' })
    expectCode(() => w.capture({ holdId: h.holdId, idemKey: 'c', credits: 81 }), 'bad_request')
    expectCode(() => w.hold({ teamId, accountId, credits: 21, idemKey: 'h2' }), 'insufficient_credits')
    expectCode(() => w.adjust({ teamId, credits: -21, idemKey: 'adj', actor: 'test' }), 'insufficient_credits')
    expect(w.adjust({ teamId, credits: -20, idemKey: 'adj2', actor: 'test' }).state).toMatchObject({ balance: 80, held: 80, available: 0 })
    expectCode(() => w.hold({ teamId, accountId, credits: 0, idemKey: 'zero' }), 'bad_request')
    expectCode(() => w.grant({ teamId, credits: 1.5, idemKey: 'frac', actor: 'test' }), 'bad_request')
  })

  it('releases holds left open for 24 h, once, with the injectable clock', () => {
    const t = makeCloud()
    const { teamId, accountId } = team(t, 300)
    const w = t.cloud.wallet
    const old = w.hold({ teamId, accountId, credits: 100, idemKey: 'old' })
    t.clock.advance(23 * HOUR_MS)
    const recent = w.hold({ teamId, accountId, credits: 50, idemKey: 'recent' })
    expect(w.releaseOrphans()).toEqual([])
    t.clock.advance(HOUR_MS)
    expect(w.releaseOrphans()).toEqual([old.holdId])
    expect(w.releaseOrphans()).toEqual([])
    expect(w.holdState(old.holdId)).toBe('released')
    expect(w.holdState(recent.holdId)).toBe('open')
    expect(w.state(teamId)).toMatchObject({ balance: 300, held: 50 })
    t.clock.advance(23 * HOUR_MS)
    expect(t.cloud.jobs.sweep()).toEqual([recent.holdId])
  })
})

describe('member caps (§4.3)', () => {
  it('a daily and a monthly cap per member, counted on open holds and captures, in UTC windows', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t, { credits: 10_000 })
    const member = await signUpAndIn(t, { teamId: owner.teamId, role: 'member' })
    const set = await t.app.inject({
      method: 'POST',
      url: `/v1/team/members/${member.accountId}/caps`,
      headers: owner.auth,
      payload: { dailyCredits: 100, monthlyCredits: 150 }
    })
    expect(set.statusCode).toBe(200)
    expect(set.json()).toMatchObject({ caps: { dailyCredits: 100, monthlyCredits: 150 }, spentToday: 0 })
    const denied = await t.app.inject({
      method: 'POST',
      url: `/v1/team/members/${owner.accountId}/caps`,
      headers: member.auth,
      payload: { dailyCredits: 0, monthlyCredits: 0 }
    })
    expect(denied.statusCode).toBe(403)
    const mine = (await t.app.inject({ url: '/v1/team/members', headers: member.auth })).json() as { members: unknown[] }
    expect(mine.members).toHaveLength(1)
    const w = t.cloud.wallet
    const h = w.hold({ teamId: owner.teamId, accountId: member.accountId, credits: 60, idemKey: 'm1' })
    w.capture({ holdId: h.holdId, idemKey: 'm1c', credits: 40 })
    w.hold({ teamId: owner.teamId, accountId: member.accountId, credits: 60, idemKey: 'm2' })
    expectCode(() => w.hold({ teamId: owner.teamId, accountId: member.accountId, credits: 1, idemKey: 'm3' }), 'cap_exceeded')
    expect(w.hold({ teamId: owner.teamId, accountId: owner.accountId, credits: 500, idemKey: 'o1' }).replayed).toBe(false)
    t.clock.set(Date.UTC(2026, 9, 20, 0, 0, 1))
    w.hold({ teamId: owner.teamId, accountId: member.accountId, credits: 50, idemKey: 'm4' })
    expectCode(() => w.hold({ teamId: owner.teamId, accountId: member.accountId, credits: 1, idemKey: 'm5' }), 'cap_exceeded')
    t.clock.set(Date.UTC(2026, 10, 1, 0, 0, 1))
    expect(w.hold({ teamId: owner.teamId, accountId: member.accountId, credits: 100, idemKey: 'm6' }).replayed).toBe(false)
  })
})
