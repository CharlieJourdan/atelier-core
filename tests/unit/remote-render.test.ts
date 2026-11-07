// The remote render (vps-rendu, decision 0084): heavy render nodes leave the team VPS for a serverless worker through links
// only, and the VPS renders them itself when every remote fails. Proved here end to end against the fake remote provider
// (its object store and job runner over HTTP), the worker's body running the test catalogue in this process: files go up
// once, the node runs with its params, seed and notes, its files and value come back, the billed seconds are priced; a
// provider that is down, slow past its timeout or answering a broken run passes to the next and finally to the VPS; a node's
// own refusal is not retried elsewhere; a cancel never falls back; the queues hold N renders at a time.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRunCtx, defineNode, type AnyNodeDef, type NodeExecution, type NodeExecutor, type ResolvedInputs } from '../../src/engine'
import { storeRenderBackend, type RenderBackend } from '../../src/engine/remote-render/backend'
import { createRemoteRenderer, remoteRenderExecutor, Slots, type RenderJobRecord } from '../../src/engine/remote-render/executor'
import { fakeRemoteBackend, fakeRemoteStarter, fakeRemoteStore } from '../../src/engine/remote-render/fake-remote-client'
import { startFakeRemote, type FakeRemote } from '../../src/engine/remote-render/fake-remote'
import { runRenderJob } from '../../src/engine/remote-render/job-runner'
import { RENDER_PRICES, RenderJob, renderCostEur } from '../../src/shared/render-job'
import { trackTemp } from '../setup/track-temp'
import { RESOURCES, tempDir } from './engine-node-helpers'
import { registry as workerRegistry } from './fixtures/worker-nodes'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

/** The fake provider whose runs execute the worker's body here, on the test catalogue. */
async function fake(o: { slots?: number; down?: boolean; runner?: (jobUrl: string, signal: AbortSignal) => Promise<void> } = {}): Promise<FakeRemote> {
  const t = tempDir('remote')
  const f = await startFakeRemote({
    dir: path.join(t.dir, 'remote'),
    slots: o.slots ?? 4,
    down: o.down ?? false,
    runner:
      o.runner ??
      (async (jobUrl) => {
        await runRenderJob({ registry: workerRegistry(), job: jobUrl, dataDir: path.join(t.dir, 'w-data'), resourcesDir: RESOURCES, workDir: path.join(t.dir, 'w-jobs') })
      })
  })
  cleanups.push(t.cleanup, () => f.close())
  return f
}

/** One attempt of a node as the scheduler hands it to an executor (t.echo@1 of the worker tests by default). */
function execution(type = 't.echo@1', o: { inputs?: ResolvedInputs; params?: unknown; signal?: AbortSignal; minutes?: number } = {}) {
  const logs: string[] = []
  const def =
    workerRegistry().get(type) ??
    defineNode({ type: type as `${string}@${number}`, inputs: {}, outputs: { text: 'text.brief' }, params: z.object({}), executors: ['local'], estimate: () => ({ units: [], durationS: 1 }), run: () => Promise.resolve({ text: { value: 'ici' } }), fake: () => Promise.resolve({ text: { value: 'ici' } }) })
  const settings = { minutes: o.minutes ?? 1, budgetMode: 'usage_max' as const }
  const costs: unknown[] = []
  const ctx = createRunCtx(
    def,
    { emit: (r) => void (r.kind === 'log' && logs.push(r.text)), signal: o.signal ?? new AbortController().signal, store: { read: async () => null }, seed: 7, where: 'local', attempt: 2, notes: ['plus court'], reportCost: (c) => costs.push(c), services: { workspace: { scratch: async () => trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-remote-ws-'))), cache: async () => trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-remote-cache-'))) } } },
    settings
  )
  const x: NodeExecution = { runId: 'run-1', nodeId: 'render', def: def as AnyNodeDef, params: o.params ?? { word: 'salut' }, inputs: o.inputs ?? {}, ctx, settings, useFake: false, fingerprint: 'f'.repeat(64), idempotencyKey: 'idem-1' }
  return { x, logs, costs }
}

const localSaid = (text: string): NodeExecutor => ({ run: async () => ({ text: { value: text } }) })

describe('the remote render job, through the fake provider', () => {
  it('sends the inputs once, runs the node remotely and brings its files, value and cost back, priced per billed second', async () => {
    const f = await fake()
    const t = tempDir('remote-in')
    cleanups.push(t.cleanup)
    const pic = path.join(t.dir, 'picture.png')
    writeFileSync(pic, 'pixels')
    const jobs: RenderJobRecord[] = []
    const exec = remoteRenderExecutor(localSaid('local'), { backends: [fakeRemoteBackend({ ...f, pollMs: 20 })], nodeTypes: ['t.echo'], onJob: (r) => jobs.push(r) })
    const { x, costs } = execution('t.echo@1', { inputs: { text: { type: 'text.brief', fingerprint: 'a'.repeat(64), value: 'le ciel', files: [pic] } } })
    const out = await exec.run(x)
    expect(out.text?.value).toBe('salut le ciel')
    const file = out.clips?.files?.[0] as string
    expect(path.basename(file)).toMatch(/echo\.txt$/)
    // the node ran with its own seed, attempt and notes
    expect(readFileSync(file, 'utf8')).toBe('salut|le ciel|seed=7|attempt=2|notes=plus court')
    expect(costs).toEqual([{ units: [{ unit: 'chars', qty: 42 }], provider: 'test' }])
    expect(jobs).toHaveLength(1)
    const j = jobs[0] as RenderJobRecord
    expect(j).toMatchObject({ backend: 'fake', ok: true, failed: [] })
    expect(j.billedS).toBeGreaterThan(0)
    expect(j.costEur).toBe(renderCostEur('fake', j.billedS))
    // a second attempt with the same picture does not upload it again
    await exec.run(execution('t.echo@1', { inputs: { text: { type: 'text.brief', fingerprint: 'a'.repeat(64), value: 'le ciel', files: [pic] } } }).x)
    const inputs = Object.entries(f.puts()).filter(([k]) => k.startsWith('in/'))
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.[1]).toBe(1)
  })

  it('the job a provider gets carries links only: no path of the VPS, no token but the link’s own', async () => {
    const f = await fake()
    let seen: RenderJob | null = null
    const store = fakeRemoteStore(f)
    const starter = fakeRemoteStarter(f)
    const spy = { ...starter, start: async (jobUrl: string, o: { jobId: string; timeoutS: number; signal: AbortSignal }) => {
      seen = RenderJob.parse(JSON.parse(await (await fetch(jobUrl)).text()))
      return starter.start(jobUrl, o)
    } }
    const t = tempDir('remote-in2')
    cleanups.push(t.cleanup)
    const pic = path.join(t.dir, 'p.png')
    writeFileSync(pic, 'x')
    const backend = storeRenderBackend({ starter: spy, store, pollMs: 20 })
    const { x } = execution('t.echo@1', { inputs: { text: { type: 'text.brief', fingerprint: 'b'.repeat(64), files: [pic] } } })
    await backend.run(x, { timeoutS: 60, signal: new AbortController().signal })
    const job = seen as RenderJob | null
    expect(job?.node.where).toBe('local')
    expect(job?.node.inputs.text?.files).toBeUndefined()
    expect(job?.node.inputs.text?.remoteFiles?.[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/blob\/in\//)
    expect(JSON.stringify(job)).not.toContain(t.dir)
  })

  it('a provider that is down passes to the next, and the VPS renders when every remote fails', async () => {
    const down = await fake({ down: true })
    const up = await fake()
    const jobs: RenderJobRecord[] = []
    const both = remoteRenderExecutor(localSaid('local'), { backends: [fakeRemoteBackend({ ...down, pollMs: 20 }), fakeRemoteBackend({ ...up, pollMs: 20 })], nodeTypes: ['t.echo'], onJob: (r) => jobs.push(r) })
    expect((await both.run(execution().x)).text?.value).toBe('salut')
    expect(jobs[0]?.failed.map((e) => e.backend)).toEqual(['fake'])
    expect(jobs[0]?.failed[0]?.error).toMatch(/503/)

    const alone = remoteRenderExecutor(localSaid('rendu sur le VPS'), { backends: [fakeRemoteBackend({ ...down, pollMs: 20 })], nodeTypes: ['t.echo'], onJob: (r) => jobs.push(r) })
    const { x, logs } = execution()
    expect((await alone.run(x)).text?.value).toBe('rendu sur le VPS')
    expect(jobs.at(-1)).toMatchObject({ backend: 'local', ok: true, costEur: 0 })
    expect(logs.some((l) => /ordinateur d’équipe/.test(l))).toBe(true)
  })

  it('a run past its timeout is stopped on the provider and the VPS takes over', async () => {
    const f = await fake({ runner: (_url, signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })) })
    const jobs: RenderJobRecord[] = []
    const exec = remoteRenderExecutor(localSaid('local'), { backends: [storeRenderBackend({ starter: fakeRemoteStarter(f), store: fakeRemoteStore(f), pollMs: 20, graceS: 0 })], nodeTypes: ['t.echo'], timeoutS: () => 1, onJob: (r) => jobs.push(r) })
    expect((await exec.run(execution().x)).text?.value).toBe('local')
    expect(jobs[0]?.failed[0]?.error).toMatch(/1 s|timed out|failed/)
    expect(f.runs()[0]?.state).not.toBe('running')
  })

  it('a node’s own refusal is final (not retried elsewhere), and a run without a result falls back', async () => {
    const f = await fake()
    let local = 0
    const counting: NodeExecutor = { run: async () => ((local += 1), { text: { value: 'local' } }) }
    const exec = remoteRenderExecutor(counting, { backends: [fakeRemoteBackend({ ...f, pollMs: 20 })], nodeTypes: ['t.refuse'] })
    await expect(exec.run(execution('t.refuse@1').x)).rejects.toMatchObject({ permanent: true })
    expect(local).toBe(0)

    const empty = await fake({ runner: async () => undefined })
    const exec2 = remoteRenderExecutor(counting, { backends: [fakeRemoteBackend({ ...empty, pollMs: 20 })], nodeTypes: ['t.echo'] })
    expect((await exec2.run(execution().x)).text?.value).toBe('local')
    expect(local).toBe(1)
  })

  it('a cancel stops the remote run and never falls back', async () => {
    const f = await fake({ runner: (_url, signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })) })
    let local = 0
    const exec = remoteRenderExecutor({ run: async () => ((local += 1), {}) }, { backends: [fakeRemoteBackend({ ...f, pollMs: 20 })], nodeTypes: ['t.echo'] })
    const ac = new AbortController()
    const p = exec.run(execution('t.echo@1', { signal: ac.signal }).x)
    await waitFor(() => f.runs()[0]?.state === 'running')
    ac.abort()
    await expect(p).rejects.toThrow()
    await waitFor(() => f.runs()[0]?.state === 'cancelled')
    expect(local).toBe(0)
  })

  it('other nodes go straight to the VPS', async () => {
    let remote = 0
    const b: RenderBackend = { id: 'fake', run: async () => ((remote += 1), { outputs: {}, backend: 'fake', queuedS: 0, billedS: 1, costEur: 0, wallS: 1 }) }
    const exec = remoteRenderExecutor(localSaid('ici'), { backends: [b] })
    expect((await exec.run(execution('script.write@1').x)).text?.value).toBe('ici')
    expect(remote).toBe(0)
  })
})

describe('queues', () => {
  it('a VPS holds at most maxRemote remote renders and maxLocal local ones; the others wait their turn', async () => {
    let inFlight = 0
    let peak = 0
    const slow: RenderBackend = {
      id: 'fake',
      run: async () => {
        peak = Math.max(peak, ++inFlight)
        await new Promise((r) => setTimeout(r, 30))
        inFlight--
        return { outputs: { text: { value: 'r' } }, backend: 'fake', queuedS: 0, billedS: 0.03, costEur: renderCostEur('fake', 0.03), wallS: 0.03 }
      }
    }
    const jobs: RenderJobRecord[] = []
    const r = createRemoteRenderer({ backends: [slow], nodeTypes: ['t.echo'], maxRemote: 3, onJob: (j) => jobs.push(j) })
    const exec = r.wrap(localSaid('local'))
    await Promise.all(Array.from({ length: 10 }, () => exec.run(execution().x)))
    expect(peak).toBe(3)
    expect(jobs).toHaveLength(10)
    expect(Math.max(...jobs.map((j) => j.queuedS))).toBeGreaterThan(0.05)

    let localPeak = 0
    let localNow = 0
    const vps: NodeExecutor = { run: async () => ((localPeak = Math.max(localPeak, ++localNow)), await new Promise((res) => setTimeout(res, 20)), localNow--, {}) }
    const none = createRemoteRenderer({ backends: [], nodeTypes: ['t.echo'], maxLocal: 1 }).wrap(vps)
    await Promise.all(Array.from({ length: 4 }, () => none.run(execution().x)))
    expect(localPeak).toBe(1)
  })

  it('a waiter that is cancelled leaves the queue', async () => {
    const s = new Slots(1)
    const release = await s.take(new AbortController().signal)
    const ac = new AbortController()
    const waiting = s.take(ac.signal)
    expect(s.queued).toBe(1)
    ac.abort()
    await expect(waiting).rejects.toThrow()
    expect(s.queued).toBe(0)
    release()
    expect(s.inUse).toBe(0)
  })
})

describe('prices', () => {
  it('a finished minute costs about a cent on Scaleway (650 vCPU-s of render on a 6-vCPU worker)', () => {
    const perMinute = renderCostEur('scaleway', 650 / 6)
    expect(perMinute).toBeGreaterThan(0.005)
    expect(perMinute).toBeLessThan(0.02)
    for (const b of ['modal', 'runpod'] as const) expect(renderCostEur(b, 650 / 6)).toBeLessThan(0.02)
    expect(RENDER_PRICES.scaleway.vcpu).toBe(6)
  })
})

describe('the worker body', () => {
  it('a node that fails writes a result that says why; a job it cannot read is the worker’s failure', async () => {
    const t = tempDir('remote-body')
    cleanups.push(t.cleanup)
    mkdirSync(path.join(t.dir, 'up'), { recursive: true })
    const f = await fake()
    const store = fakeRemoteStore(f)
    const job: RenderJob = {
      v: 1,
      id: 'j1',
      node: { v: 1, nodeType: 't.refuse@1', params: {}, inputs: {}, seed: 1, where: 'local', attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'usage_max' }, fake: false },
      upload: { result: store.slot('jobs/j1/result.json').putUrl, files: [] }
    }
    const jobFile = path.join(t.dir, 'job.json')
    writeFileSync(jobFile, JSON.stringify(job))
    const r = await runRenderJob({ registry: workerRegistry(), job: jobFile, dataDir: path.join(t.dir, 'd'), resourcesDir: RESOURCES, workDir: path.join(t.dir, 'w') })
    expect(r.ok).toBe(false)
    const written = JSON.parse(new TextDecoder().decode((await store.get('jobs/j1/result.json', new AbortController().signal)) as Uint8Array)) as { ok: boolean; error: { permanent: boolean } }
    expect(written.ok).toBe(false)
    expect(written.error.permanent).toBe(true)
    writeFileSync(jobFile, '{"v":2}')
    await expect(runRenderJob({ registry: workerRegistry(), job: jobFile, dataDir: t.dir, resourcesDir: RESOURCES, workDir: t.dir })).rejects.toThrow()
  })
})

async function waitFor(ok: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('the render job restates the worker protocol', () => {
  it('its node is the worker job without its folder, field for field', async () => {
    const { WorkerJob, WORKER_PROTOCOL_VERSION } = await import('../../src/shared/worker-protocol')
    const { RenderNode } = await import('../../src/shared/render-job')
    expect(Object.keys(RenderNode.shape).sort()).toEqual(Object.keys(WorkerJob.omit({ outDir: true }).shape).sort())
    const node = { v: WORKER_PROTOCOL_VERSION, nodeType: 'render.assemble@1', params: {}, inputs: { a: { type: 'media.image[]', fingerprint: 'f', remoteFiles: [{ name: 'x.png', url: 'https://r2/x' }] } }, seed: 1, where: 'local', attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'usage_max' }, fake: false }
    expect(RenderNode.parse(node)).toEqual(WorkerJob.omit({ outDir: true }).parse(node))
  })
})

describe('heavy renders a machine holds at once', () => {
  it('one on an 8 GB VPS, two on 16 GB, at most four', async () => {
    const { defaultLocalRenders } = await import('../../src/engine/remote-render/executor')
    const gb = 2 ** 30
    expect([4, 8, 16, 32, 128].map((g) => defaultLocalRenders(g * gb))).toEqual([1, 1, 2, 4, 4])
  })
})
