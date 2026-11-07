// The local copy of Atelier Cloud spending (lot P5): one ledger row per Cloud job, settled at the captured credits or
// refunded, replays idempotent, reconciled with the Cloud after a crash, never touched by settleStale nor counted in USD.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCore } from '../../src/main/core'
import { migrate } from '../../src/main/db'
import { MIGRATIONS } from '../../src/main/db/migrations'
import type { CloudJob } from '../../src/main/cloud/client'
import { CloudSpendMirror, CLOUD_PROVIDER_ID } from '../../src/main/cloud/mirror'
import { EngineError } from '../../src/engine/errors'
import { adopt, appCore, cloudHelpers, startCloud } from './cloud-app-helpers'
import { memoryCore, okTester, testCipher } from './helpers'

const job = (over: Partial<CloudJob> = {}): CloudJob => ({
  id: 'job_1',
  usage: 'synthesize',
  state: 'queued',
  quoteId: 'q_1',
  credits: 30,
  attempts: 0,
  error: null,
  result: null,
  artefacts: [],
  demo: true,
  createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-20T08:00:00.000Z',
  ...over
})

interface LedgerRow {
  provider_id: string
  model: string
  status: string
  credits: number | null
  amount_eur: number | null
  amount_usd: number
  estimate_usd: number
  video_id: number | null
  channel_id: number | null
}
const rows = (db: { prepare(sql: string): { all(): unknown } }) =>
  db.prepare(`SELECT provider_id, model, status, credits, amount_eur, amount_usd, estimate_usd, video_id, channel_id FROM ledger WHERE cloud_job_id IS NOT NULL ORDER BY id`).all() as LedgerRow[]

describe('migration 010', () => {
  it('applies on a v9 database and keeps its ledger rows', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, MIGRATIONS.slice(0, 9))
    db.prepare(`INSERT INTO ledger (provider_id, model, status, estimate_usd, amount_usd) VALUES ('anthropic', 'm', 'settled', 1, 0.5)`).run()
    // Migration 010 alone (lot Z1 appends migrations 011+ after it; migrations.test.ts runs them all)
    expect(migrate(db, MIGRATIONS.slice(0, 10))).toEqual([10])
    const cols = (db.prepare('PRAGMA table_info(ledger)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['credits', 'amount_eur', 'cloud_job_id']))
    expect(db.prepare('SELECT provider_id, amount_usd, credits, cloud_job_id FROM ledger').all()).toEqual([
      { provider_id: 'anthropic', amount_usd: 0.5, credits: null, cloud_job_id: null }
    ])
    const insert = db.prepare(`INSERT INTO ledger (provider_id, model, status, cloud_job_id) VALUES ('atelier-cloud', 'x', 'reserved', ?)`)
    insert.run('job_a')
    expect(() => insert.run('job_a')).toThrow(/UNIQUE/)
    insert.run(null)
    insert.run(null)
    db.close()
  })
})

describe('CloudSpendMirror', () => {
  const setup = () => {
    const core = memoryCore()
    const notified: number[] = []
    const mirror = new CloudSpendMirror(core.db, () => notified.push(1))
    return { core, mirror, notified }
  }

  it('created → settled at the captured credits, with euros at the quote’s credit value', () => {
    const { core, mirror, notified } = setup()
    mirror.record({ phase: 'created', job: job(), creditValueEur: 0.01 }, { label: 'Voix — scène 1' })
    expect(rows(core.db)).toEqual([
      { provider_id: CLOUD_PROVIDER_ID, model: 'Voix — scène 1', status: 'reserved', credits: 30, amount_eur: 0.3, amount_usd: 0, estimate_usd: 0, video_id: null, channel_id: null }
    ])
    expect(mirror.openJobs()).toEqual([{ ledgerId: expect.any(Number), jobId: 'job_1' }])
    // the Cloud captured less than it held
    mirror.record({ phase: 'ended', job: job({ state: 'succeeded', credits: 24 }), creditValueEur: 0.01 })
    expect(rows(core.db)[0]).toMatchObject({ status: 'settled', credits: 24, amount_eur: 0.24, amount_usd: 0 })
    expect(mirror.openJobs()).toEqual([])
    expect(notified).toHaveLength(2)
    expect(mirror.summary()).toMatchObject({ reservedCredits: 0, spentCredits: 24, spentEur: 0.24, jobs: 1 })
  })

  it('created → refunded for a failed or cancelled job', () => {
    const { core, mirror } = setup()
    mirror.record({ phase: 'created', job: job({ id: 'a' }) })
    mirror.record({ phase: 'created', job: job({ id: 'b' }), creditValueEur: 0.01 })
    expect(mirror.summary()).toMatchObject({ reservedCredits: 60, spentCredits: 0, jobs: 2 })
    mirror.record({ phase: 'ended', job: job({ id: 'a', state: 'failed', error: 'boom' }) })
    mirror.record({ phase: 'ended', job: job({ id: 'b', state: 'cancelled' }) })
    expect(rows(core.db).map((r) => [r.model, r.status, r.credits, r.amount_eur])).toEqual([
      ['cloud:synthesize', 'refunded', 0, 0],
      ['cloud:synthesize', 'refunded', 0, 0]
    ])
    expect(mirror.summary()).toMatchObject({ reservedCredits: 0, spentCredits: 0, spentEur: 0, jobs: 2 })
  })

  it('replays never add rows nor change a closed one', () => {
    const { core, mirror, notified } = setup()
    const created = { phase: 'created' as const, job: job(), creditValueEur: 0.01 }
    mirror.record(created)
    mirror.record(created)
    mirror.record({ phase: 'ended', job: job({ state: 'succeeded', credits: 30 }), creditValueEur: 0.01 })
    mirror.record({ phase: 'ended', job: job({ state: 'succeeded', credits: 30 }), creditValueEur: 0.01 })
    mirror.record(created)
    mirror.record({ phase: 'ended', job: job({ state: 'failed' }) })
    expect(rows(core.db)).toHaveLength(1)
    expect(rows(core.db)[0]).toMatchObject({ status: 'settled', credits: 30, amount_eur: 0.3 })
    expect(notified).toHaveLength(2)
  })

  it('an ended event for a job it never saw inserts then closes it; tags attach the video and its channel', () => {
    const { core, mirror } = setup()
    const channelId = core.context.workflow.channels.create({ name: 'Phares' }).id
    const videoId = core.context.workflow.createVideo(channelId, { title: 'Le phare' }).video.id
    mirror.record({ phase: 'ended', job: job({ id: 'late', state: 'succeeded', credits: 12 }), creditValueEur: 0.02 }, { videoId })
    mirror.record({ phase: 'ended', job: job({ id: 'ghost', state: 'succeeded', credits: 5 }) }, { videoId: 9999, channelId: 9999 })
    expect(rows(core.db)).toEqual([
      expect.objectContaining({ status: 'settled', credits: 12, amount_eur: 0.24, video_id: videoId, channel_id: channelId }),
      // unknown ids are left out rather than refused; the euro value is unknown
      expect.objectContaining({ status: 'settled', credits: 5, amount_eur: null, video_id: null, channel_id: null })
    ])
  })

  it('committedFor: the credits a video holds and spent on the Cloud (open + settled, not refunded)', () => {
    const { core, mirror } = setup()
    const channelId = core.context.workflow.channels.create({ name: 'Phares' }).id
    const v1 = core.context.workflow.createVideo(channelId, { title: 'Un' }).video.id
    const v2 = core.context.workflow.createVideo(channelId, { title: 'Deux' }).video.id
    expect(mirror.committedFor(v1)).toBe(0)
    mirror.record({ phase: 'created', job: job({ id: 'open', credits: 40 }) }, { videoId: v1 })
    mirror.record({ phase: 'created', job: job({ id: 'done', credits: 30 }) }, { videoId: v1 })
    mirror.record({ phase: 'ended', job: job({ id: 'done', state: 'succeeded', credits: 25 }) }, { videoId: v1 })
    mirror.record({ phase: 'created', job: job({ id: 'failed', credits: 100 }) }, { videoId: v1 })
    mirror.record({ phase: 'ended', job: job({ id: 'failed', state: 'failed' }) }, { videoId: v1 })
    mirror.record({ phase: 'created', job: job({ id: 'other', credits: 7 }) }, { videoId: v2 })
    mirror.record({ phase: 'created', job: job({ id: 'untagged', credits: 9 }) })
    expect(mirror.committedFor(v1)).toBe(65)
    expect(mirror.committedFor(v2)).toBe(7)
    expect(mirror.committedFor(9999)).toBe(0)
  })

  it('credit rows stay out of the USD caps, and settleStale leaves them to the Cloud', () => {
    const { core, mirror } = setup()
    core.ledger.setGlobalCap(1)
    mirror.record({ phase: 'created', job: job({ id: 'open', credits: 900 }), creditValueEur: 0.01 })
    mirror.record({ phase: 'ended', job: job({ id: 'done', state: 'succeeded', credits: 5000 }), creditValueEur: 0.01 })
    expect(core.ledger.overview()).toMatchObject({ spentUsd: 0, reservedUsd: 0 })
    const h = core.ledger.reserve({ providerId: 'anthropic', model: 'claude-sonnet-5-5', estimate: { usd: 0.5 } })
    expect(h.estimateUsd).toBe(0.5)
    expect(core.ledger.settleStale(0)).toBe(1) // the USD reservation only
    expect(rows(core.db).map((r) => r.status)).toEqual(['reserved', 'settled'])
    expect(core.ledger.overview()).toMatchObject({ spentUsd: 0.5, reservedUsd: 0 })
  })
})

describe('reconcile with the Cloud', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
  })

  it('closes the rows a crash left open from the Cloud’s answer; an unreachable Cloud leaves them open', async () => {
    const rig = await startCloud(0)
    const person = await cloudHelpers.signUpAndIn(rig.t, { credits: 5000 })
    const run = await cloudHelpers.quoteAndRun(rig.t, person, 'generateImage', { prompt: 'un phare la nuit' })
    expect(run.job.state).toBe('succeeded')
    const finished = run.job as unknown as CloudJob

    const app = appCore()
    adopt(app, rig.baseUrl, person)
    const mirror = app.core.cloud.mirror
    // the app saw the job start, then "crashed" before it ended; another job the Cloud does not know stays open
    mirror.record({ phase: 'created', job: { ...finished, state: 'queued' } })
    mirror.record({ phase: 'created', job: job({ id: 'job_unknown' }) })
    app.net.down = true
    expect(await mirror.reconcile(app.core.cloud.api)).toEqual({ closed: 0, open: 2 })
    expect(mirror.openJobs()).toHaveLength(2)
    app.net.down = false
    expect(await mirror.reconcile(app.core.cloud.api)).toEqual({ closed: 1, open: 1 })
    expect(mirror.openJobs().map((o) => o.jobId)).toEqual(['job_unknown'])
    expect(mirror.summary()).toMatchObject({ spentCredits: finished.credits, reservedCredits: 30, jobs: 2 })
    expect(finished.credits).toBeGreaterThan(0)
  })

  it('a signed-out app leaves every row open', async () => {
    const mirror = new CloudSpendMirror(memoryCore().db)
    mirror.record({ phase: 'created', job: job() })
    const api = { job: () => Promise.reject(new EngineError('missing_tool', 'not connected')) }
    expect(await mirror.reconcile(api)).toEqual({ closed: 0, open: 1 })
  })

  it('runs at startup: a restarted app closes what the Cloud finished meanwhile', async () => {
    const rig = await startCloud(0)
    const person = await cloudHelpers.signUpAndIn(rig.t, { credits: 5000 })
    const run = await cloudHelpers.quoteAndRun(rig.t, person, 'generateImage', { prompt: 'une falaise' })
    const finished = run.job as unknown as CloudJob
    const dir = mkdtempSync(path.join(os.tmpdir(), 'atelier-cloud-mirror-'))
    dirs.push(dir)
    const open = (cloudFetch?: typeof fetch) =>
      createCore({ paths: { userData: dir }, cipher: testCipher(), tester: okTester, ...(cloudFetch ? { cloudFetch } : {}) })

    const first = open(() => Promise.reject(new TypeError('fetch failed')))
    const app = { core: first, clock: { now: Date.now() }, net: { down: false, gate: null }, opened: [] }
    adopt(app, rig.baseUrl, person)
    first.cloud.mirror.record({ phase: 'created', job: { ...finished, state: 'running' } })
    first.close()

    const second = open()
    try {
      await vi.waitFor(() => expect(second.cloud.mirror.openJobs()).toEqual([]), { timeout: 10_000, interval: 20 })
      expect(rows(second.db)).toEqual([expect.objectContaining({ status: 'settled', credits: finished.credits })])
    } finally {
      second.close()
    }
  })
})
