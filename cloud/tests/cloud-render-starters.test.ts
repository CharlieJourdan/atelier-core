// The remote render providers (vps-rendu, decision 0084), checked against their public API shapes with a recorded fetch:
// nothing reaches a network. Scaleway Jobs (X-Auth-Token, per-run environment, run_duration billed, stop to cancel),
// Modal (proxy-auth headers, 202 while running), RunPod (executionTimeout in ms, executionTime billed). `render try` refuses
// without paidCalls, without its keys, or without an S3 bucket, and never calls the provider then; `render status` names
// what is missing without ever showing a value.
import { describe, expect, it } from 'vitest'
import { renderCostEur } from '../../src/shared/render-job.ts'
import { durationS, modalStarter, runpodRenderStarter, scalewayStarter } from '../src/render/starters.ts'
import { blobJobStore, renderStatus, tryRender } from '../src/render/try.ts'
import type { BlobStore } from '../src/blobs/types.ts'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function recorder(answers: ((c: Call) => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? 'GET', headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(c)
    const a = answers.shift()
    if (!a) throw new Error(`unexpected call ${c.method} ${c.url}`)
    return a(c)
  }) as typeof fetch
  return { fetch: f, calls }
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const signal = new AbortController().signal

describe('Scaleway Serverless Jobs', () => {
  it('starts the job definition with the job link, reads the run and bills its duration, stops it to cancel', async () => {
    const r = recorder([
      () => json({ job_runs: [{ id: 'run-1', state: 'queued' }] }),
      () => json({ id: 'run-1', state: 'running', started_at: '2026-11-03T10:00:00Z' }),
      () => json({ id: 'run-1', state: 'succeeded', run_duration: '93.5s', started_at: '2026-11-03T10:00:00Z', terminated_at: '2026-11-03T10:01:34Z' }),
      () => json({}),
      () => json({ id: 'run-2', state: 'failed', error_message: 'image pull failed', started_at: null, terminated_at: null })
    ])
    const s = scalewayStarter({ secretKey: () => 'scw-secret', jobDefinitionId: () => 'def-9', fetchImpl: r.fetch })
    expect(await s.start('https://r2/job.json?sig', { jobId: 'j1', timeoutS: 600, signal })).toBe('run-1')
    expect(r.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.scaleway.com/serverless-jobs/v1alpha2/regions/fr-par/job-definitions/def-9/start',
      headers: { 'X-Auth-Token': 'scw-secret' },
      body: { environment_variables: { ATELIER_JOB_URL: 'https://r2/job.json?sig', ATELIER_JOB_ID: 'j1' } }
    })
    expect(await s.status('run-1', signal)).toEqual({ state: 'running' })
    expect(await s.status('run-1', signal)).toEqual({ state: 'succeeded', billedS: 93.5 })
    await s.cancel('run-1')
    expect(r.calls[3]).toMatchObject({ method: 'POST', url: 'https://api.scaleway.com/serverless-jobs/v1alpha2/regions/fr-par/job-runs/run-1/stop' })
    expect(await s.status('run-2', signal)).toEqual({ state: 'failed', error: 'image pull failed' })
    expect(durationS('12s')).toBe(12)
    expect(durationS(undefined)).toBeUndefined()
  })

  it('a refused start says why (and the key never appears in it)', async () => {
    const r = recorder([() => new Response('{"message":"permission denied"}', { status: 403 })])
    const s = scalewayStarter({ secretKey: () => 'scw-secret', jobDefinitionId: () => 'def-9', fetchImpl: r.fetch })
    const err = await s.start('https://r2/j', { jobId: 'j', timeoutS: 60, signal }).catch((e: unknown) => e as Error)
    expect(String(err)).toMatch(/HTTP 403/)
    expect(String(err)).not.toContain('scw-secret')
  })
})

describe('Modal', () => {
  it('submits through the proxy-auth endpoint, waits on 202, reads the billed seconds', async () => {
    const r = recorder([() => json({ callId: 'fc-1' }), () => new Response(null, { status: 202 }), () => json({ state: 'succeeded', billedS: 41.2 }), () => json({ ok: true })])
    const s = modalStarter({ url: () => 'https://ws--atelier-render-web.modal.run/', key: () => 'wk-1', secret: () => 'ws-1', fetchImpl: r.fetch })
    expect(await s.start('https://r2/j', { jobId: 'j', timeoutS: 900, signal })).toBe('fc-1')
    expect(r.calls[0]).toMatchObject({ url: 'https://ws--atelier-render-web.modal.run/submit', headers: { 'Modal-Key': 'wk-1', 'Modal-Secret': 'ws-1' }, body: { jobUrl: 'https://r2/j', timeoutS: 900 } })
    expect(await s.status('fc-1', signal)).toEqual({ state: 'running' })
    expect(await s.status('fc-1', signal)).toEqual({ state: 'succeeded', billedS: 41.2 })
    await s.cancel('fc-1')
    expect(r.calls[3]).toMatchObject({ url: 'https://ws--atelier-render-web.modal.run/cancel', body: { callId: 'fc-1' } })
  })
})

describe('RunPod serverless', () => {
  it('runs with an execution timeout in ms and bills executionTime', async () => {
    const r = recorder([() => json({ id: 'rp-1', status: 'IN_QUEUE' }), () => json({ id: 'rp-1', status: 'COMPLETED', executionTime: 52000, output: { ok: true } }), () => json({ id: 'rp-2', status: 'COMPLETED', executionTime: 1000, output: { ok: false, error: 'worker: no job' } })])
    const s = runpodRenderStarter({ apiKey: () => 'rp-key', endpointId: () => 'ep-cpu', fetchImpl: r.fetch })
    expect(await s.start('https://r2/j', { jobId: 'j', timeoutS: 300, signal })).toBe('rp-1')
    expect(r.calls[0]).toMatchObject({ url: 'https://api.runpod.ai/v2/ep-cpu/run', headers: { authorization: 'Bearer rp-key' }, body: { input: { jobUrl: 'https://r2/j' }, policy: { executionTimeout: 300_000 } } })
    expect(await s.status('rp-1', signal)).toEqual({ state: 'succeeded', billedS: 52 })
    expect(await s.status('rp-2', signal)).toMatchObject({ state: 'failed', error: 'worker: no job' })
  })
})

describe('render status and render try', () => {
  const vault = (names: string[]) => ({ has: (n: string) => names.includes(n), readForAdapter: () => 'secret-value' })
  const local = { kind: 'local' } as unknown as BlobStore

  it('status names the missing vault entries, never a value', () => {
    const st = renderStatus(vault(['SCALEWAY_SECRET_KEY']))
    expect(st.find((s) => s.backend === 'scaleway')?.missing).toEqual(['SCALEWAY_JOB_DEFINITION_ID'])
    expect(st.find((s) => s.backend === 'modal')?.missing).toEqual(['MODAL_RENDER_URL', 'MODAL_PROXY_KEY', 'MODAL_PROXY_SECRET'])
    expect(JSON.stringify(st)).not.toContain('secret-value')
  })

  it('try refuses without paidCalls, without its keys, or without a bucket, before any call', async () => {
    const r = recorder([])
    const out: string[] = []
    const deps = (o: { paid: boolean; keys: string[] }) => ({ vault: vault(o.keys), blobs: local, paidCalls: o.paid, out: (l: string) => out.push(l), fetchImpl: r.fetch })
    const all = ['SCALEWAY_SECRET_KEY', 'SCALEWAY_JOB_DEFINITION_ID']
    await expect(tryRender(deps({ paid: false, keys: all }), { backend: 'scaleway', bundle: '.' })).rejects.toThrow(/paidCalls/)
    await expect(tryRender(deps({ paid: true, keys: [] }), { backend: 'scaleway', bundle: '.' })).rejects.toThrow(/SCALEWAY_SECRET_KEY, SCALEWAY_JOB_DEFINITION_ID/)
    await expect(tryRender(deps({ paid: true, keys: all }), { backend: 'nope', bundle: '.' })).rejects.toThrow(/--backend/)
    expect(() => blobJobStore(local)).toThrow(/S3 bucket/)
    expect(r.calls).toEqual([])
  })

  it('a captured minute on a 6-vCPU worker stays around a cent', () => {
    expect(renderCostEur('scaleway', 108)).toBeLessThan(0.01)
  })
})
