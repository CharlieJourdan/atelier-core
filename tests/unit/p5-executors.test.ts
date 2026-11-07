// Lot P5's proof (PLAN-V2-PRODUCTION §7 P5), end to end on real processes and the real local Cloud:
//   - a pipeline that mixes the three executors: `script` in the local worker process, `voice` in this process buying a
//     voice from Atelier Cloud, `render` sent to the Cloud, which runs it on the fake RunPod's worker;
//   - credits held, settled at the real use (the rest given back), released on failure;
//   - a cancel that reaches the Cloud and the fake RunPod (the pod's worker tree is gone, the hold released);
//   - an unreachable Cloud: a clear French message, nothing paid.
// The crash-and-resume proof is p5-resume.test.ts. Everything is free: fake providers, fake RunPod, loopback only.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startRun, validatePipeline, type EngineEvent, type ResolvedPipeline } from '../../src/engine'
import { cloudJobRunner } from '../../src/engine/cloud-http'
import { CLOUD_UNREACHABLE_NOTHING_PAID } from '../../src/main/production/credits'
import { createProductionHost, type ProductionHost } from '../../src/main/production/host'
import { nodeWorkerCommand } from '../../src/main/production/local-worker'
import { buyerPipeline, mixedPipeline, registry } from './fixtures/p5-nodes'
import { loadCloudTesting, type Bench } from './p5-bench'

const ROOT = path.join(__dirname, '..', '..')
const ENTRY = path.join(__dirname, 'fixtures', 'p5-worker-main.ts')
const RESOURCES = path.join(ROOT, 'resources')

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

function tempDir(label: string): string {
  const d = mkdtempSync(path.join(tmpdir(), `atelier-p5-${label}-`))
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
  return d
}

const plan = (renderMode: 'ok' | 'fail' | 'slow' = 'ok'): ResolvedPipeline => {
  const v = validatePipeline(mixedPipeline(renderMode), registry())
  if (!v.ok) throw new Error(JSON.stringify(v.errors))
  return v.plan
}

function hostFor(bench: Bench | null, dataDir: string, jobs: { phase: string; usage: string; state: string; credits: number }[] = []): ProductionHost {
  const worker = nodeWorkerCommand(ROOT, path.join(dataDir, 'worker-data'), RESOURCES, ENTRY)
  return createProductionHost({
    dataDir,
    resourcesDir: RESOURCES,
    worker,
    cloud: bench
      ? { baseUrl: () => bench.base, token: () => Promise.resolve(bench.person.accessToken), pollMs: 40 }
      : { baseUrl: () => 'http://127.0.0.1:9', token: () => Promise.resolve('not-a-real-token'), pollMs: 40 },
    onJob: (e) => jobs.push({ phase: e.phase, usage: e.job.usage, state: e.job.state, credits: e.job.credits })
  })
}

async function runOnce(host: ProductionHost, p: ResolvedPipeline, o: { runId?: string; onEvent?: (e: EngineEvent) => void } = {}) {
  const rh = host.forRun({ capCredits: 400 })
  const events: EngineEvent[] = []
  const run = startRun({
    plan: p,
    store: host.store,
    runId: o.runId ?? randomUUID(),
    inputs: { topic: { value: 'les phares bretons' } },
    services: rh.services,
    executors: rh.executors,
    spender: rh.spender,
    retry: { retries: 1, delaysMs: [10] },
    onEvent: (e) => {
      events.push(e)
      o.onEvent?.(e)
    }
  })
  cleanups.push(() => rh.cleanup())
  return { run, events, rh }
}

const metaOf = async (host: ProductionHost, events: EngineEvent[], nodeId: string): Promise<Record<string, unknown>> => {
  const done = events.find((e) => e.kind === 'done' && e.nodeId === nodeId)
  if (!done || done.kind !== 'done') throw new Error(`${nodeId} did not finish`)
  const stored = await host.store.getRun(done.fingerprint)
  return Object.values(stored?.outputs ?? {})[0]?.meta ?? {}
}

describe('lot P5: three executors and the credits', () => {
  it('a pipeline mixes the local worker, Atelier Cloud and the fake RunPod; credits are held then settled at the real use', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const jobs: { phase: string; usage: string; state: string; credits: number }[] = []
    const host = hostFor(bench, tempDir('mixed'), jobs)
    const { run, events } = await runOnce(host, plan())
    const result = await run.done
    expect(result.status).toBe('done')
    expect(result.states).toEqual({ script: 'done', voice: 'done', render: 'done' })

    // where each node really ran
    const script = await metaOf(host, events, 'script')
    const voice = await metaOf(host, events, 'voice')
    const render = await metaOf(host, events, 'render')
    expect(script.pid).not.toBe(process.pid) // the local worker process
    expect(voice.pid).toBe(process.pid) // the host: its paid item went to the Cloud
    expect(render.where).toBe('gpu')
    expect([process.pid, script.pid]).not.toContain(render.pid) // the fake RunPod's pod
    expect(bench.fake.jobs()).toHaveLength(1)
    expect(bench.fake.jobs()[0]?.status).toBe('COMPLETED')
    // the pod read the voice the Cloud made (uploaded by the app, downloaded by the pod through a signed link)
    const doneRender = events.find((e) => e.kind === 'done' && e.nodeId === 'render')
    const film = (await host.store.getRun((doneRender as { fingerprint: string }).fingerprint))?.outputs.video?.files?.[0] as string
    expect(readFileSync(film, 'utf8')).toContain(`voice=${String(render.voiceSha)}`)
    expect(readFileSync(film, 'utf8')).toContain('where=gpu')

    // credits: one hold per Cloud job; the voice captured whole, the GPU job captured what it used and gave the rest back
    const entries = bench.entries()
    const holds = entries.filter((e) => e.kind === 'hold')
    const captures = entries.filter((e) => e.kind === 'capture')
    expect(holds).toHaveLength(2)
    expect(captures).toHaveLength(2)
    expect(entries.filter((e) => e.kind === 'release')).toHaveLength(0)
    const gpuJob = bench.jobs().find((j) => j.usage === 'submitGpuJob')
    const voiceJob = bench.jobs().find((j) => j.usage === 'synthesize')
    expect(gpuJob?.state).toBe('succeeded')
    const gpuHold = holds.find((h) => h.jobId === gpuJob?.id)?.heldDelta ?? 0
    expect(gpuJob?.credits).toBeLessThan(gpuHold) // settled at the real GPU seconds
    const w = bench.wallet()
    expect(w.held).toBe(0)
    expect(w.balance).toBe(1000 - (voiceJob?.credits ?? 0) - (gpuJob?.credits ?? 0))
    // the app saw every job start and end (what it copies into its ledger)
    expect(jobs.filter((j) => j.phase === 'created').map((j) => j.usage).sort()).toEqual(['submitGpuJob', 'synthesize'])
    expect(jobs.filter((j) => j.phase === 'ended').map((j) => j.state)).toEqual(['succeeded', 'succeeded'])
  })

  it('a failed GPU node costs nothing: its hold goes back', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const host = hostFor(bench, tempDir('fail'))
    const { run, events } = await runOnce(host, plan('fail'))
    const result = await run.done
    expect(result.states.render).toBe('error')
    const err = events.find((e) => e.kind === 'error' && e.nodeId === 'render')
    expect(err).toMatchObject({ code: 'refused' })
    const gpuJob = bench.jobs().find((j) => j.usage === 'submitGpuJob')
    expect(gpuJob?.state).toBe('failed')
    const entries = bench.entries().filter((e) => e.jobId === gpuJob?.id)
    expect(entries.map((e) => e.kind)).toEqual(['hold', 'release'])
    const voiceJob = bench.jobs().find((j) => j.usage === 'synthesize')
    expect(bench.wallet()).toMatchObject({ held: 0, balance: 1000 - (voiceJob?.credits ?? 0) })
  })

  it('a cancel reaches Atelier Cloud and the fake RunPod: the pod worker and its child stop, the hold goes back', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const seen: { phase: string; usage: string; state: string; credits: number }[] = []
    const host = hostFor(bench, tempDir('cancel'), seen)
    const { run } = await runOnce(host, plan('slow'))
    // wait until the pod's worker runs the render and has started its own child
    let podId = ''
    let pids: number[] = []
    for (let i = 0; i < 600 && pids.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const j = bench.fake.jobs()[0]
      const grand = j?.logs.map((l) => /grandchild (\d+)/.exec(l)?.[1]).find(Boolean)
      const worker = j ? bench.fake.pidOf(j.id) : undefined
      if (j && grand && worker) {
        podId = j.id
        pids = [worker, Number(grand)]
      }
    }
    expect(pids).toHaveLength(2)
    run.cancel()
    const result = await run.done
    expect(result.status).toBe('cancelled')
    expect(result.states.render).toBe('cancelled')
    // the Cloud cancelled the job and RunPod was told
    const gpuJob = await bench.waitJob('submitGpuJob', ['cancelled'])
    expect(gpuJob.state).toBe('cancelled')
    expect(bench.fake.cancels).toContain(podId)
    expect(bench.fake.job(podId)?.status).toBe('CANCELLED')
    for (const pid of pids) await bench.waitGone(pid)
    const voiceJob = bench.jobs().find((j) => j.usage === 'synthesize')
    expect(bench.entries().filter((e) => e.jobId === gpuJob.id).map((e) => e.kind)).toEqual(['hold', 'release'])
    expect(bench.wallet()).toMatchObject({ held: 0, balance: 1000 - (voiceJob?.credits ?? 0) })
    // the app heard how the cancelled job ended, so its ledger copy closes now (not at the next start)
    expect(seen.filter((j) => j.usage === 'submitGpuJob').map((j) => `${j.phase}:${j.state}`)).toEqual(['created:queued', 'ended:cancelled'])
  })

  it('after a cancel, the same idempotency key makes a new job at once (« Réessayer » works the first time)', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const runner = cloudJobRunner({ baseUrl: bench.base, token: () => bench.person.accessToken, pollMs: 40, stateDir: tempDir('keys') })
    const payload = (mode: 'ok' | 'slow') => ({
      worker: 'render',
      estimatedGpuSeconds: 60,
      payload: { nodeType: 'p5.render@1', params: { mode }, inputs: { script: { type: 'text.script', fingerprint: 'f'.repeat(64), value: 'x' } }, seed: 0, attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'usage_max' }, fake: false }
    })
    const ac = new AbortController()
    const first = runner.runJob('submitGpuJob', payload('slow'), { idempotencyKey: 'retry-after-cancel', signal: ac.signal, dir: tempDir('dl1') })
    await bench.waitJob('submitGpuJob', ['running'])
    ac.abort()
    await expect(first).rejects.toThrow()
    await bench.waitJob('submitGpuJob', ['cancelled'])
    // the node's input is missing on purpose: the pod fails fast, which is enough to see a NEW job was made
    const second = runner.runJob('submitGpuJob', payload('ok'), { idempotencyKey: 'retry-after-cancel', signal: new AbortController().signal, dir: tempDir('dl2') })
    await expect(second).rejects.toThrow(/Le fournisseur a échoué/)
    expect(bench.jobs().map((j) => j.state).sort()).toEqual(['cancelled', 'failed'])
    expect(bench.wallet()).toMatchObject({ held: 0, balance: 1000 })
  })

  it('a local node that buys from the Cloud reserves too: the video cap holds before any job (R12.5)', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const v = validatePipeline(buyerPipeline(3), registry())
    if (!v.ok) throw new Error('invalid')
    const host = hostFor(bench, tempDir('buyer'))
    const tight = host.forRun({ capCredits: 1 })
    cleanups.push(() => tight.cleanup())
    const events: EngineEvent[] = []
    const refused = startRun({ plan: v.plan, store: host.store, inputs: { topic: { value: 'cap' } }, services: tight.services, executors: tight.executors, spender: tight.spender, onEvent: (e) => events.push(e) })
    expect((await refused.done).states.buyer).toBe('error')
    expect(events.find((e) => e.kind === 'error' && e.nodeId === 'buyer')).toMatchObject({ code: 'budget' })
    expect(bench.jobs()).toHaveLength(0)
    // with room under the cap, the node buys its pictures from inside the local worker, through the app
    const { run, events: ok } = await runOnce(host, v.plan)
    expect((await run.done).states.buyer).toBe('done')
    expect(await metaOf(host, ok, 'buyer')).not.toMatchObject({ pid: process.pid })
    expect(bench.jobs().map((j) => [j.usage, j.state])).toEqual([
      ['generateImage', 'succeeded'],
      ['generateImage', 'succeeded'],
      ['generateImage', 'succeeded']
    ])
  })

  it('an unreachable Cloud: the paid node is refused with a clear message before anything is asked, nothing is paid', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const host = hostFor(null, tempDir('down'))
    const { run, events } = await runOnce(host, plan())
    const result = await run.done
    expect(result.states.script).toBe('done') // local work still runs
    expect(result.states.voice).toBe('error')
    expect(result.states.render).toBe('pending') // never reached
    const err = events.find((e) => e.kind === 'error' && e.nodeId === 'voice')
    expect(err).toMatchObject({ code: 'missing_tool', permanent: true, message: CLOUD_UNREACHABLE_NOTHING_PAID })
    expect(bench.jobs()).toHaveLength(0)
    expect(bench.entries().map((e) => e.kind)).toEqual(['grant'])
    expect(bench.wallet()).toMatchObject({ balance: 1000, held: 0 })
  })
})
