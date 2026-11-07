// Lot P5, Cloud side: the RunPod path. The fake RunPod's API on its own (key, run → COMPLETED, cancel kills the worker
// and its grandchild), the client's error mapping, then end to end: a Cloud listening on 127.0.0.1:0, a real fake
// RunPod running the fixture worker, a submitGpuJob job whose input is an uploaded file, cancel, failures, and both the
// callback and the polling paths.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { GpuJobResult, WORKER_PROTOCOL_VERSION } from '../../src/shared/worker-protocol.ts'
import { PodOutput, podFileName, type PodJob } from '../src/runpod/adapter.ts'
import { RunpodClient, type RunpodStatus } from '../src/runpod/client.ts'
import { FAKE_RUNPOD_ENDPOINTS, fakeRunpodOptions, startFakeRunpod, type FakeRunpod, type FakeRunpodOptions } from '../src/runpod/fake.ts'
import { RetryableProviderError } from '../src/providers/types.ts'
import { SAFE_NAME } from '../src/storage.ts'
import { makeCloud, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const WORKER = [process.execPath, fileURLToPath(new URL('./fixtures/fake-worker.mjs', import.meta.url))]
const SLOW = 30_000

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function fakePod(o: Partial<FakeRunpodOptions> = {}): Promise<{ fake: FakeRunpod; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'atelier-runpod-test-'))
  const fake = await startFakeRunpod({ workerCommand: WORKER, workDir: join(root, 'work'), apiKey: `rp-${randomBytes(12).toString('hex')}`, ...o })
  cleanups.push(async () => {
    await fake.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  return { fake, root }
}

const podJob = (nodeType: string, inputs: PodJob['inputs'] = {}): PodJob => ({
  v: WORKER_PROTOCOL_VERSION,
  nodeType,
  params: {},
  inputs,
  seed: 1,
  where: 'gpu',
  attempt: 1,
  notes: [],
  settings: { minutes: 1, budgetMode: 'qualite_max' },
  fake: true
})

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

const endOf = (client: RunpodClient, id: string): Promise<RunpodStatus> =>
  until('a terminal status', async () => {
    const s = await client.status(FAKE_RUNPOD_ENDPOINTS.render, id)
    return ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(s.status) ? s : undefined
  })

describe('the fake RunPod API', () => {
  it('wants the key; a run completes with file:// outputs, gpu seconds and the cost; the end is posted to the webhook', async () => {
    const posted: { url: string; body: Record<string, unknown> }[] = []
    const { fake } = await fakePod({ deliver: (url, body) => void posted.push({ url, body }) })
    expect((await fetch(`${fake.url}/fake-render/status/x`)).status).toBe(401)
    expect((await fetch(`${fake.url}/fake-render/status/x`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
    const wrong = new RunpodClient({ baseUrl: fake.url, apiKey: () => 'rp-wrong-key-123' })
    const refused = await wrong.run('fake-render', { job: podJob('ok@1') }).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).not.toBeInstanceOf(RetryableProviderError)
    expect(String(refused)).not.toContain('rp-wrong-key-123')

    const client = new RunpodClient({ baseUrl: fake.url, apiKey: () => fake.apiKey })
    const started = await client.run('fake-render', { job: podJob('ok@1') }, 'http://127.0.0.1:9/hook')
    expect(started.status).toBe('IN_PROGRESS')
    const st = await endOf(client, started.id)
    expect(st.status).toBe('COMPLETED')
    const out = PodOutput.parse(st.output)
    expect(out.gpuSeconds).toBeGreaterThanOrEqual(1)
    expect(out.cost).toEqual({ units: [{ unit: 'gpu.seconds', qty: 1 }], provider: 'fake-worker' })
    const file = out.outputs.video?.files?.[0]
    expect(file?.name).toBe('result.txt')
    expect(readFileSync(fileURLToPath(file?.url as string), 'utf8')).toBe('bonjour')
    expect(out.outputs.note).toEqual({ value: 'ok' })
    expect(fake.job(started.id)?.progress).toEqual({ frac: 0.5, text: 'à mi-course' })
    await until('the webhook post', () => posted.length > 0)
    expect(posted[0]).toMatchObject({ url: 'http://127.0.0.1:9/hook', body: { id: started.id, status: 'COMPLETED' } })
    expect((await client.status('fake-gpu-video', started.id).catch((e: unknown) => e)) instanceof RetryableProviderError).toBe(false)
  }, SLOW)

  it('refuses every service call of the worker, and reports errors and crashes as FAILED', async () => {
    const { fake } = await fakePod()
    const client = new RunpodClient({ baseUrl: fake.url, apiKey: () => fake.apiKey })
    const call = await endOf(client, (await client.run('fake-render', { job: podJob('call@1') })).id)
    expect(PodOutput.parse(call.output).outputs.answer?.value).toEqual({
      t: 'reply',
      id: 1,
      ok: false,
      error: { code: 'missing_tool', message: 'Pas de service dans la machine distante.', permanent: true }
    })
    const boom = await endOf(client, (await client.run('fake-render', { job: podJob('boom@1') })).id)
    expect(boom).toMatchObject({ status: 'FAILED', error: 'Le nœud a échoué.' })
    const die = await endOf(client, (await client.run('fake-render', { job: podJob('die@1') })).id)
    expect(die.status).toBe('FAILED')
    expect(String(die.error)).toContain('plus de mémoire')
    const bad = await fetch(`${fake.url}/fake-render/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fake.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { job: { nodeType: 'ok@1' } } })
    })
    expect(bad.status).toBe(400)
  }, SLOW)

  it('cancel kills the worker and its grandchild', async () => {
    const { fake } = await fakePod()
    const client = new RunpodClient({ baseUrl: fake.url, apiKey: () => fake.apiKey })
    const { id } = await client.run('fake-render', { job: podJob('slow@1') })
    const log = await until('the grandchild', () => fake.job(id)?.logs.find((l) => l.startsWith('grandchild ')))
    const grandchild = Number(log.split(' ')[1])
    const worker = fake.pidOf(id) as number
    expect(alive(worker) && alive(grandchild)).toBe(true)
    const st = await until('the in-progress output', async () => {
      const s = await client.status('fake-render', id)
      return s.output ? s : undefined
    })
    expect(st.output).toEqual({ progress: 0.3, text: 'longue tâche' })
    expect((await client.cancel('fake-render', id)).status).toBe('CANCELLED')
    expect(fake.cancels).toEqual([id])
    await until('the worker to die', () => !alive(worker))
    await until('the grandchild to die', () => !alive(grandchild))
    expect((await client.status('fake-render', id)).status).toBe('CANCELLED')
  }, SLOW)
})

describe('the RunPod client', () => {
  it('maps network failures, 5xx and 429 to retryable errors, 401/403/404 to plain ones, never with the key', async () => {
    const answer = (status: number): typeof fetch => (async () => new Response('{}', { status })) as typeof fetch
    const key = 'rp-secret-key-xyz-000'
    for (const [status, retryable] of [
      [500, true],
      [503, true],
      [429, true],
      [401, false],
      [403, false],
      [404, false]
    ] as const) {
      const err = await new RunpodClient({ baseUrl: 'https://rp.invalid/v2', apiKey: () => key, fetchImpl: answer(status) }).status('ep', 'id').catch((e: unknown) => e)
      expect(err instanceof RetryableProviderError, String(status)).toBe(retryable)
      expect(String((err as Error).message)).not.toContain(key)
    }
    const down = await new RunpodClient({ baseUrl: 'http://127.0.0.1:9', apiKey: () => key, fetchImpl: (async () => { throw new TypeError(`fetch failed ${key}`) }) as typeof fetch })
      .run('ep', {})
      .catch((e: unknown) => e)
    expect(down).toBeInstanceOf(RetryableProviderError)
    expect((down as Error).message).not.toContain(key)
    const seen: { url: string; init: RequestInit }[] = []
    const ok: typeof fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Response.json({ id: 'p1', status: 'IN_QUEUE' })
    }) as typeof fetch
    const c = new RunpodClient({ baseUrl: 'https://rp.invalid/v2/', apiKey: () => key, fetchImpl: ok })
    await c.run('ep 1', { job: 1 }, 'https://cloud/hook')
    await c.status('ep 1', 'p/1')
    await c.cancel('ep 1', 'p1')
    expect(seen.map((s) => `${s.init.method} ${s.url}`)).toEqual([
      'POST https://rp.invalid/v2/ep%201/run',
      'GET https://rp.invalid/v2/ep%201/status/p%2F1',
      'POST https://rp.invalid/v2/ep%201/cancel/p1'
    ])
    expect(JSON.parse(seen[0]?.init.body as string)).toEqual({ input: { job: 1 }, webhook: 'https://cloud/hook' })
    expect((seen[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${key}`)
  })

  it('names pod files safely', () => {
    expect(podFileName('video', 0, '/tmp/x/result.txt')).toBe('o-video-0-result.txt')
    expect(podFileName('a b/c', 2, 'C:\\w\\été 1.mp4')).toBe('o-a_b_c-2-_t__1.mp4')
    const long = podFileName('o'.repeat(80), 12, `${'n'.repeat(200)}.wav`)
    expect(long.length).toBeLessThanOrEqual(100)
    expect(long.endsWith('.wav')).toBe(true)
    for (const n of [long, podFileName('', 0, ''), podFileName('..', 0, '..')]) expect(SAFE_NAME.test(n), n).toBe(true)
  })
})

// ---- end to end through the Cloud ------------------------------------------------------------------------------------

interface E2E {
  t: TestCloud
  fake: FakeRunpod
  root: string
  p: Person
  base: string
}

async function e2e(o: { pollMs?: number; deliver?: FakeRunpodOptions['deliver'] } = {}): Promise<E2E> {
  const delivered: string[] = []
  const { fake, root } = await fakePod({
    deliver:
      o.deliver ??
      (async (url, body) => {
        delivered.push(String(body.status))
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        await res.body?.cancel()
      })
  })
  let base = 'http://127.0.0.1:1'
  const t = makeCloud({ gridMargins: true, publicUrl: () => base, runpod: fakeRunpodOptions(fake, { pollMs: o.pollMs ?? 60_000 }) })
  base = await t.app.listen({ host: '127.0.0.1', port: 0 })
  const p = await signUpAndIn(t, { credits: 1000 })
  return { t, fake, root, p, base }
}

const payload = (nodeType: string, inputs: Record<string, unknown> = {}) => ({
  worker: 'render',
  estimatedGpuSeconds: 600,
  payload: { nodeType, params: { qualité: 'haute' }, inputs, seed: 7, attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'qualite_max' }, fake: true }
})

async function startJob(e: E2E, input: Record<string, unknown>, key = randomBytes(6).toString('hex')): Promise<{ id: string; held: number }> {
  const q = await e.t.app.inject({ method: 'POST', url: '/v1/quotes', headers: e.p.auth, payload: { usage: 'submitGpuJob', input } })
  expect(q.statusCode).toBe(200)
  const quote = q.json() as { id: string; totalCredits: number }
  const j = await e.t.app.inject({ method: 'POST', url: '/v1/jobs', headers: e.p.auth, payload: { quoteId: quote.id, idempotencyKey: `gpu-${key}` } })
  expect(j.statusCode).toBe(200)
  return { id: (j.json() as { id: string }).id, held: quote.totalCredits }
}

const jobOf = async (e: E2E, id: string) =>
  (await e.t.app.inject({ url: `/v1/jobs/${id}`, headers: e.p.auth })).json() as {
    state: string
    credits: number
    error: string | null
    result: Record<string, unknown> | null
    artefacts: { id: string; name: string; mime: string; demo: boolean }[]
  }

describe('submitGpuJob on the fake RunPod, end to end', () => {
  it('an uploaded input reaches the worker by signed link; the result is a GpuJobResult; it is charged the seconds used (callback path)', async () => {
    const e = await e2e({ pollMs: 60_000 })
    const bytes = randomBytes(50_000)
    const sha = createHash('sha256').update(bytes).digest('hex')
    const up = await e.t.app.inject({
      method: 'POST',
      url: `/v1/uploads?name=source.mp4&sha256=${sha}`,
      headers: { ...e.p.auth, 'content-type': 'application/octet-stream' },
      payload: bytes
    })
    const art = up.json() as { id: string }
    const started = Date.now()
    const { id, held } = await startJob(e, payload('ok@1', { clip: { type: 'video', fingerprint: 'f1', artefactIds: [art.id] } }))
    expect(held).toBe(23)
    await e.t.cloud.jobs.whenIdle()
    // The poll interval is a minute: only the callback can have ended it this soon.
    expect(Date.now() - started).toBeLessThan(30_000)
    const job = await jobOf(e, id)
    expect(job.state).toBe('succeeded')
    const result = GpuJobResult.parse(job.result)
    expect(result.outputs.video?.files).toEqual(['o-video-0-result.txt'])
    expect(result.outputs.video?.value).toEqual({ sizes: { clip_0: { name: 'source.mp4', size: bytes.length } }, where: 'gpu', v: WORKER_PROTOCOL_VERSION })
    expect(result.outputs.note).toEqual({ value: 'ok' })
    expect(result.cost).toEqual({ units: [{ unit: 'gpu.seconds', qty: 1 }], provider: 'fake-worker' })
    // Billed on RunPod's executionTime (the fake reports its own), not the pod's rounded-up figure.
    const pod = e.fake.jobs()[0] as { startedAt: number; endedAt?: number }
    const seconds = result.gpuSeconds as number
    expect(seconds).toBe(((pod.endedAt as number) - pod.startedAt) / 1000)
    // Charged what was used: ceil(max(1, ceil(seconds)) × 0.0374325) credits, under the hold of 23.
    expect(job.credits).toBe(Math.ceil(Math.max(1, Math.ceil(seconds)) * 0.00031 * 0.92 * 1.05 * 1.25 * 100 - 1e-9))
    expect(job.credits).toBeLessThan(held)
    expect(e.t.cloud.wallet.state(e.p.teamId)).toMatchObject({ balance: 1000 - job.credits, held: 0 })
    expect(e.t.cloud.wallet.sumOfEntries(e.p.teamId)).toEqual({ balance: 1000 - job.credits, held: 0 })
    // Its file downloads through the usual signed link.
    expect(job.artefacts).toEqual([expect.objectContaining({ name: 'o-video-0-result.txt', mime: 'text/plain', demo: true })])
    const link = (await (await fetch(`${e.base}/v1/artefacts/${job.artefacts[0]?.id}`, { headers: e.p.auth })).json()) as { url: string }
    expect(link.url.startsWith(e.base)).toBe(true)
    expect(await (await fetch(link.url)).text()).toBe('bonjour')
    const events = e.t.cloud.jobs.events(id)
    expect(events.some((ev) => ev.type === 'progress')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'succeeded', data: { credits: job.credits, held } })
  }, SLOW)

  it('polling alone also works (no callback delivered)', async () => {
    const e = await e2e({ pollMs: 100, deliver: () => undefined })
    const { id } = await startJob(e, payload('ok@1'))
    await e.t.cloud.jobs.whenIdle()
    const job = await jobOf(e, id)
    expect(job.state).toBe('succeeded')
    expect(GpuJobResult.parse(job.result).outputs.video?.files).toEqual(['o-video-0-result.txt'])
  }, SLOW)

  it('cancelling the Cloud job cancels the pod, kills the worker tree and releases the hold', async () => {
    const e = await e2e({ pollMs: 200 })
    const { id } = await startJob(e, payload('slow@1'))
    const pod = await until('the pod job', () => e.fake.jobs()[0])
    const log = await until('the grandchild', () => e.fake.job(pod.id)?.logs.find((l) => l.startsWith('grandchild ')))
    const grandchild = Number(log.split(' ')[1])
    const worker = e.fake.pidOf(pod.id) as number
    expect(e.t.cloud.wallet.state(e.p.teamId).held).toBe(23)
    const c = await e.t.app.inject({ method: 'POST', url: `/v1/jobs/${id}/cancel`, headers: e.p.auth })
    expect(c.statusCode).toBe(200)
    await e.t.cloud.jobs.whenIdle()
    expect((await jobOf(e, id)).state).toBe('cancelled')
    expect(e.fake.cancels).toEqual([pod.id])
    await until('the worker to die', () => !alive(worker))
    await until('the grandchild to die', () => !alive(grandchild))
    expect(e.t.cloud.wallet.state(e.p.teamId)).toMatchObject({ balance: 1000, held: 0 })
  }, SLOW)

  it('a failing or crashing worker, a bad payload, a foreign file or an escaping output fail the job and release the hold', async () => {
    const e = await e2e({ pollMs: 200 })
    const other = await signUpAndIn(e.t, { credits: 10 })
    const theirs = await e.t.cloud.storage.put(other.teamId, null, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('à eux') }, false)
    const cases: [Record<string, unknown>, RegExp][] = [
      [payload('boom@1'), /Le nœud a échoué/],
      [payload('die@1'), /plus de mémoire/],
      [{ ...payload('ok@1'), payload: { nodeType: 'x' } }, /payload\./],
      [payload('ok@1', { clip: { type: 'video', fingerprint: 'f', artefactIds: [theirs.id] } }), /no such artefact/],
      [payload('escape@1'), /outside the pod folder/]
    ]
    for (const [input, error] of cases) {
      const { id } = await startJob(e, input)
      await e.t.cloud.jobs.whenIdle()
      const job = await jobOf(e, id)
      expect(job.state, String(error)).toBe('failed')
      expect(job.error).toMatch(error)
      expect(job.artefacts).toEqual([])
    }
    expect(e.t.cloud.wallet.state(e.p.teamId)).toMatchObject({ balance: 1000, held: 0 })
    expect(existsSync(join(e.root, 'escape.txt'))).toBe(true)
  }, SLOW)
})

describe('wiring', () => {
  it('without runpod options the in-process GPU fake stays; with them the fake RunPod serves submitGpuJob', async () => {
    const { fake } = await fakePod()
    expect(makeCloud().cloud.registry.resolve('submitGpuJob').adapter.id).toBe('fake-gpu')
    const t = makeCloud({ runpod: fakeRunpodOptions(fake) })
    expect(t.cloud.registry.resolve('submitGpuJob')).toMatchObject({ status: 'demo', adapter: { id: 'fake-runpod', kind: 'fake' } })
  })
})
