// Lot P5 review fixes on the RunPod path: one pod per Cloud job (a retry resumes the stored pod, an unconfirmed start
// is not retried, a job that ends without success or is cut off by a restart cancels its pod), billing on RunPod's
// executionTime, 6-hour links for pods, and the Cloud's own process-tree kill.
import { trackTemp } from '../../tests/setup/track-temp'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { GpuJobResult, WORKER_PROTOCOL_VERSION } from '../../src/shared/worker-protocol.ts'
import { REMOTE_LINK_TTL_S } from '../src/jobs.ts'
import type { RunpodSettings } from '../src/runpod/adapter.ts'
import { RunpodClient } from '../src/runpod/client.ts'
import { fakeRunpodOptions, startFakeRunpod, type FakeRunpod, type FakeRunpodOptions } from '../src/runpod/fake.ts'
import { killTree, taskkillPath } from '../src/runpod/kill.ts'
import { makeCloud, quoteAndRun, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const WORKER = [process.execPath, fileURLToPath(new URL('./fixtures/fake-worker.mjs', import.meta.url))]
const SLOW = 30_000

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function fakePod(o: Partial<FakeRunpodOptions> = {}): Promise<FakeRunpod> {
  const root = trackTemp(mkdtempSync(join(tmpdir(), 'atelier-runpod-resume-')))
  const fake = await startFakeRunpod({ workerCommand: WORKER, workDir: join(root, 'work'), apiKey: `rp-${randomBytes(12).toString('hex')}`, deliver: () => undefined, ...o })
  cleanups.push(async () => {
    await fake.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  return fake
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const gpu = (nodeType: string, inputs: Record<string, unknown> = {}) => ({
  worker: 'render',
  estimatedGpuSeconds: 3600,
  payload: { nodeType, params: {}, inputs, seed: 1, attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'qualite_max' }, fake: true }
})

/** A fetch that passes through, except where `fault` answers first. */
const faulty =
  (fault: (url: string, init: RequestInit | undefined) => Response | null | Promise<Response | null>): typeof fetch =>
  async (input, init) => {
    const url = String(input)
    return (await fault(url, init)) ?? fetch(input, init)
  }

async function cloudOn(fake: FakeRunpod, extra: Partial<RunpodSettings> = {}): Promise<{ t: TestCloud; p: Person }> {
  const t = makeCloud({ runpod: { ...fakeRunpodOptions(fake, { pollMs: 50 }), ...extra } })
  return { t, p: await signUpAndIn(t, { credits: 1000 }) }
}

const refOf = (t: TestCloud, id: string): string | null =>
  (t.cloud.db.prepare('SELECT provider_ref FROM jobs WHERE id = ?').get(id) as { provider_ref: string | null }).provider_ref

describe('one pod per Cloud job', () => {
  it('a retryable status error retries the Cloud job on the SAME pod (never a second one)', async () => {
    const fake = await fakePod()
    let failed = 0
    const fetchImpl = faulty((url) => (url.includes('/status/') && failed++ === 0 ? new Response('busy', { status: 503 }) : null))
    const { t, p } = await cloudOn(fake, { fetchImpl })
    const { job } = await quoteAndRun(t, p, 'submitGpuJob', gpu('ok@1'))
    expect(job).toMatchObject({ state: 'succeeded', attempts: 2 })
    expect(t.cloud.jobs.events(job.id).map((e) => e.type)).toContain('retry')
    expect(fake.jobs()).toHaveLength(1)
    const pod = fake.jobs()[0] as { id: string }
    expect(refOf(t, job.id)).toBe(`runpod:fake-render/${pod.id}`)
    expect(fake.cancels).toEqual([])
    expect(GpuJobResult.parse(job.result).outputs.video?.files).toEqual(['o-video-0-result.txt'])
  }, SLOW)

  it('when no attempt is left, the stored pod is cancelled and its worker tree killed; the hold goes back', async () => {
    const fake = await fakePod()
    const fetchImpl = faulty((url) => (url.includes('/status/') ? new Response('down', { status: 502 }) : null))
    const { t, p } = await cloudOn(fake, { fetchImpl })
    const { job } = await quoteAndRun(t, p, 'submitGpuJob', gpu('slow@1'))
    expect(job).toMatchObject({ state: 'failed', attempts: 3 })
    await t.cloud.jobs.settled()
    expect(fake.jobs()).toHaveLength(1)
    const pod = fake.jobs()[0] as { id: string; logs: string[] }
    expect(fake.cancels).toEqual([pod.id])
    const worker = fake.pidOf(pod.id) as number
    await until('the worker to die', () => !alive(worker))
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 1000, held: 0 })
  }, SLOW)

  it('a start RunPod may have accepted but did not confirm is not retried', async () => {
    const fake = await fakePod()
    const fetchImpl = faulty(async (url, init) => {
      if (!url.endsWith('/run')) return null
      const res = await fetch(url, init) // RunPod takes the job …
      await res.body?.cancel()
      throw new TypeError('socket hang up') // … and the answer is lost
    })
    const { t, p } = await cloudOn(fake, { fetchImpl })
    const { job } = await quoteAndRun(t, p, 'submitGpuJob', gpu('ok@1'))
    expect(job).toMatchObject({ state: 'failed', attempts: 1 })
    expect(job.error).toMatch(/not confirmed, so it is not retried/)
    expect(fake.jobs()).toHaveLength(1)
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 1000, held: 0 })
  }, SLOW)

  it('after a restart, a job cut off mid-run cancels its stored pod before it fails', async () => {
    const fake = await fakePod()
    const { t, p } = await cloudOn(fake)
    // A finished GPU job stands for the one a crashed process left "running" on a pod.
    const { job } = await quoteAndRun(t, p, 'submitGpuJob', gpu('ok@1'))
    const client = new RunpodClient({ baseUrl: fake.url, apiKey: () => fake.apiKey })
    const { id: podId } = await client.run('fake-render', {
      job: { v: WORKER_PROTOCOL_VERSION, nodeType: 'slow@1', params: {}, inputs: {}, seed: 1, where: 'gpu', attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'qualite_max' }, fake: true }
    })
    await until('the worker', () => fake.job(podId)?.logs.length)
    const hold = t.cloud.wallet.hold({ teamId: p.teamId, accountId: p.accountId, credits: 5, idemKey: 'crash-hold-gpu' })
    t.cloud.db.prepare(`UPDATE jobs SET state = 'running', hold_id = ?, provider_ref = ? WHERE id = ?`).run(hold.holdId, `runpod:fake-render/${podId}`, job.id)
    await t.cloud.jobs.recover()
    expect(t.cloud.jobs.state(job.id)).toBe('failed')
    expect(t.cloud.wallet.holdState(hold.holdId)).toBe('released')
    expect(fake.cancels).toEqual([podId])
    expect(fake.job(podId)?.status).toBe('CANCELLED')
    const worker = fake.pidOf(podId) as number
    await until('the worker to die', () => !alive(worker))
  }, SLOW)
})

describe('billing on executionTime, pod links', () => {
  /** A stub RunPod: the run is queued, then COMPLETED with what `completed` says. */
  function stubRunpod(completed: Record<string, unknown>, runs: unknown[]): RunpodSettings {
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/run')) {
        runs.push(JSON.parse(String(init?.body)))
        return Response.json({ id: 'pod-1', status: 'IN_QUEUE' })
      }
      if (url.includes('/status/')) return Response.json({ id: 'pod-1', status: 'COMPLETED', ...completed })
      return Response.json({ id: 'pod-1', status: 'CANCELLED' })
    }) as typeof fetch
    return { baseUrl: 'https://rp.invalid/v2', apiKey: () => 'rp-stub', endpoints: { render: 'r', 'gpu-video': 'g' }, pollMs: 10, fetchImpl }
  }

  it('charges RunPod’s executionTime when given, the pod’s figure otherwise; a pod gets 6-hour links', async () => {
    const runs: unknown[] = []
    const output = { outputs: { x: { value: 1 } }, gpuSeconds: 1 }
    const t = makeCloud({ gridMargins: true, runpod: stubRunpod({ output, executionTime: 1_800_000 }, runs) })
    const p = await signUpAndIn(t, { credits: 1000 })
    const input = await t.cloud.storage.put(p.teamId, null, { name: 'in.wav', mime: 'audio/wav', bytes: Buffer.from('RIFF') }, false)
    const measured = await quoteAndRun(t, p, 'submitGpuJob', gpu('ok@1', { a: { type: 'audio', fingerprint: 'f', artefactIds: [input.id] } }))
    // 1800 s × 0.0374325 = 67.38 → 68 credits (the hold was 135); the pod said 1 s, RunPod measured 1800.
    expect(measured.job).toMatchObject({ state: 'succeeded', credits: 68 })
    expect(GpuJobResult.parse(measured.job.result).gpuSeconds).toBe(1800)
    const cost = t.cloud.db.prepare('SELECT cost_usd FROM jobs WHERE id = ?').get(measured.job.id) as { cost_usd: number }
    expect(cost.cost_usd).toBeCloseTo(1800 * 0.00031, 9)

    const link = (runs[0] as { input: { job: { inputs: { a: { remoteFiles: { name: string; url: string }[] } } } } }).input.job.inputs.a.remoteFiles[0]
    expect(link?.name).toBe('in.wav')
    const url = new URL(link?.url as string)
    const left = Number(url.searchParams.get('exp')) * 1000 - t.clock.now() // the expiry is whole seconds
    expect(left).toBeGreaterThan((REMOTE_LINK_TTL_S - 1) * 1000)
    expect(left).toBeLessThanOrEqual(REMOTE_LINK_TTL_S * 1000)
    t.clock.advance(60 * 60_000) // an hour in RunPod's queue: the link still works
    expect((await t.app.inject({ url: url.pathname + url.search })).statusCode).toBe(200)

    const t2 = makeCloud({ gridMargins: true, runpod: stubRunpod({ output }, []) })
    const p2 = await signUpAndIn(t2, { credits: 1000 })
    const fallback = await quoteAndRun(t2, p2, 'submitGpuJob', gpu('ok@1'))
    expect(fallback.job).toMatchObject({ state: 'succeeded', credits: 1 })
    expect(GpuJobResult.parse(fallback.job.result).gpuSeconds).toBe(1)
  })
})

describe('the Cloud’s own process-tree kill', () => {
  it('runs taskkill by its full path on Windows and kills the process group elsewhere', () => {
    const runs: string[][] = []
    killTree(1234, 'win32', (cmd, args) => void runs.push([cmd, ...args]))
    expect(runs).toEqual([[taskkillPath(), '/PID', '1234', '/T', '/F']])
    expect(taskkillPath('D:\\Win')).toBe('D:\\Win\\System32\\taskkill.exe')
    expect(taskkillPath('')).toBe('C:\\Windows\\System32\\taskkill.exe')
    const signals: [number, string][] = []
    killTree(42, 'darwin', () => undefined, (pid, sig) => void signals.push([pid, sig]))
    expect(signals).toEqual([[-42, 'SIGKILL']])
    const fallback: [number, string][] = []
    killTree(43, 'darwin', () => undefined, (pid, sig) => {
      fallback.push([pid, sig])
      if (pid < 0) throw new Error('no such group')
    })
    expect(fallback).toEqual([
      [-43, 'SIGKILL'],
      [43, 'SIGKILL']
    ])
  })
})
