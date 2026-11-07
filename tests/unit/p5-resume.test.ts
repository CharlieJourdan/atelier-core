// Lot P5's proof « un plantage au milieu, puis une reprise sans double paiement »: a real app-like process
// (fixtures/p5-app.ts) runs the three-executor pipeline and is killed — whole process tree, like a crash — while its
// GPU job runs on the fake RunPod. The run is then resumed in this process with the same run id, data folder and
// database. The finished nodes come back from the store, the GPU node replays the SAME Cloud job (same idempotency
// key, remembered on disk before the job existed), so the wallet is charged once and the local ledger has one row per
// Cloud job.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startRun, validatePipeline, type EngineEvent } from '../../src/engine'
import { CloudSpendMirror } from '../../src/main/cloud/mirror'
import { openDatabase } from '../../src/main/db'
import { killTree } from '../../src/main/platform/process'
import { createProductionHost } from '../../src/main/production/host'
import { nodeWorkerCommand } from '../../src/main/production/local-worker'
import { mixedPipeline, registry } from './fixtures/p5-nodes'
import { loadCloudTesting } from './p5-bench'

const ROOT = path.join(__dirname, '..', '..')
const RESOURCES = path.join(ROOT, 'resources')
const ENTRY = path.join(__dirname, 'fixtures', 'p5-worker-main.ts')
const APP = path.join(__dirname, 'fixtures', 'p5-app.ts')
const DELAY_MS = 4000

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})
function tempDir(label: string): string {
  const d = mkdtempSync(path.join(tmpdir(), `atelier-p5-${label}-`))
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
  return d
}

describe('lot P5: a crash in the middle, then a resume without paying twice', () => {
  it('the app dies during the GPU job; the resumed run replays the same job, the wallet and the ledger count it once', { timeout: 180_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const dataDir = tempDir('resume')
    const dbPath = path.join(dataDir, 'atelier.db')
    const runId = randomUUID()
    const config = { base: bench.base, token: bench.person.accessToken, dataDir, dbPath, runId, delayMs: DELAY_MS }

    // 1. the "app" starts the run in its own process
    const child = spawn(
      process.execPath,
      ['--experimental-transform-types', '--no-warnings', '--import', pathToFileURL(path.join(ROOT, 'scripts', 'ts-resolve.mjs')).href, APP],
      { env: { ...process.env, P5_APP: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true }
    )
    let out = ''
    child.stdout.on('data', (b: Buffer) => (out += b.toString()))
    child.stderr.on('data', (b: Buffer) => (out += b.toString()))
    const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
    cleanups.push(() => {
      if (child.exitCode === null && child.pid) killTree(child.pid)
    })

    // 2. as soon as its GPU job runs in the Cloud, the app is killed (process tree, no goodbye)
    const running = await bench.waitJob('submitGpuJob', ['running']).catch((e: Error) => {
      throw new Error(`${e.message}
--- app output ---
${out}`)
    })
    // …and once the app has copied it into its ledger (the job runs a moment before the app hears of it)
    for (let i = 0; i < 200 && !out.includes('JOB created submitGpuJob'); i++) await new Promise((r) => setTimeout(r, 25))
    expect(out).toContain('JOB created submitGpuJob')
    expect(out).toContain('EVENT done voice')
    killTree(child.pid as number)
    await exited
    expect(out).not.toContain('RUN ')

    // the crashed app's ledger: the voice settled, the GPU job still open (reserved)
    const db = openDatabase(dbPath)
    cleanups.push(() => db.close())
    const rows = () =>
      db.prepare(`SELECT cloud_job_id AS jobId, status, credits FROM ledger WHERE cloud_job_id IS NOT NULL ORDER BY id`).all() as {
        jobId: string
        status: string
        credits: number
      }[]
    expect(rows().map((r) => r.status)).toEqual(['settled', 'reserved'])
    expect(rows()[1]?.jobId).toBe(running.id)

    // 3. resume: same run id, same data folder, same database (the Cloud kept running the job meanwhile)
    const mirror = new CloudSpendMirror(db)
    const host = createProductionHost({
      dataDir,
      resourcesDir: RESOURCES,
      worker: nodeWorkerCommand(ROOT, path.join(dataDir, 'worker-data'), RESOURCES, ENTRY),
      cloud: { baseUrl: () => bench.base, token: () => Promise.resolve(bench.person.accessToken), pollMs: 40 },
      onJob: (e, tags) => mirror.record(e, tags)
    })
    const v = validatePipeline(mixedPipeline('ok', DELAY_MS), registry())
    if (!v.ok) throw new Error('invalid pipeline')
    const rh = host.forRun({ capCredits: 400 })
    cleanups.push(() => rh.cleanup())
    const events: EngineEvent[] = []
    const run = startRun({
      plan: v.plan,
      store: host.store,
      runId,
      inputs: { topic: { value: 'les phares bretons' } },
      services: rh.services,
      executors: rh.executors,
      spender: rh.spender,
      onEvent: (e) => events.push(e)
    })
    const result = await run.done
    expect(result.status).toBe('done')
    expect(result.states).toEqual({ script: 'cached', voice: 'cached', render: 'done' })

    // paid once: one job per paid item, one hold each, nothing held, the balance is the sum of the two captures
    const jobs = bench.jobs()
    expect(jobs.map((j) => [j.usage, j.state])).toEqual([
      ['synthesize', 'succeeded'],
      ['submitGpuJob', 'succeeded']
    ])
    expect(jobs[1]?.id).toBe(running.id)
    expect(bench.entries().filter((e) => e.kind === 'hold')).toHaveLength(2)
    expect(bench.fake.jobs()).toHaveLength(1)
    const spent = (jobs[0]?.credits ?? 0) + (jobs[1]?.credits ?? 0)
    expect(bench.wallet()).toMatchObject({ held: 0, balance: 1000 - spent })
    // the local ledger: still one row per Cloud job, both settled at what the Cloud captured
    expect(rows()).toEqual([
      { jobId: jobs[0]?.id, status: 'settled', credits: jobs[0]?.credits },
      { jobId: jobs[1]?.id, status: 'settled', credits: jobs[1]?.credits }
    ])
  })
})
