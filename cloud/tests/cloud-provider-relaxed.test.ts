// production-10: Veo 3.1 Lite on unifically's « relaxed » queue gets 15 minutes per wait. Cloud-3 (a retry never bills twice): when a
// wait ends the task is NOT dropped (unifically keeps running it and bills it): the job keeps the task id and retries, resuming
// the same task; only after RELAXED_MAX_WAITS waits (about 45 minutes in all) does the job FAIL for good so the clip brick's
// next engine makes the clip. The other unifically engines keep a resumable timeout.
import { describe, expect, it } from 'vitest'
import { RELAXED_MAX_WAIT_MS, RELAXED_MAX_WAITS, unificallyAdapter } from '../src/providers/veo.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'

const KEY = 'relaxed-test-SECRET-8c1d'

function ctxWith(saved: string | null = null): { ctx: ProviderContext; refs: (string | null)[]; ref: () => string | null } {
  const refs: (string | null)[] = []
  let current: string | null = saved
  const ctx: ProviderContext = {
    ...ctxFor(KEY),
    providerRef: () => current,
    setProviderRef: (r) => {
      current = r
      refs.push(r)
    }
  }
  return { ctx, refs, ref: () => current }
}

const queued = () =>
  fakeFetch((req) => (req.method === 'POST' ? json({ code: 200, success: true, data: { task_id: 't1', status: 'processing' } }) : json({ code: 200, success: true, data: { task_id: 't1', status: 'processing' } })))
const clip = { prompt: 'des mains qui serrent un collier', seconds: 6, aspect: '16:9' as const }
const relaxed = (f: { fetch: typeof fetch }) => unificallyAdapter({ id: 'clip:veo31-lite-relaxed', fetchImpl: f.fetch, pollMs: 0, maxWaitMs: 0 })
const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)

describe('the relaxed queue is waited for in slices of 15 minutes and resumed, never dropped', () => {
  it('waits 15 minutes a slice, three slices at most', () => {
    expect(RELAXED_MAX_WAIT_MS).toBe(15 * 60_000)
    expect(RELAXED_MAX_WAITS).toBe(3)
  })

  it('a slice that ends keeps the task id and asks for a retry (the provider keeps running and billing that task)', async () => {
    const f = queued()
    const { ctx, ref } = ctxWith()
    const err = await outcome(runUsage(relaxed(f), 'generateVideo', clip, ctx))
    expect(err).toBeInstanceOf(RetryableProviderError)
    expect(err.message).toMatch(/still queued, will resume/)
    expect(JSON.parse(ref() as string)).toMatchObject({ op: 't1', w: 1 })
    expect(err.message).not.toContain(KEY)
  })

  it('the retry resumes the same task: nothing is submitted a second time', async () => {
    const f = queued()
    const { ctx } = ctxWith()
    await outcome(runUsage(relaxed(f), 'generateVideo', clip, ctx))
    const afterFirst = f.calls.filter((c) => c.method === 'POST').length
    expect(afterFirst).toBe(1)
    await outcome(runUsage(relaxed(f), 'generateVideo', clip, ctx))
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(f.calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2)
  })

  it('fails for good at the last slice, so the next engine takes the clip', async () => {
    const f = queued()
    const { ctx, ref } = ctxWith()
    const errors: Error[] = []
    for (let i = 0; i < RELAXED_MAX_WAITS; i++) errors.push(await outcome(runUsage(relaxed(f), 'generateVideo', clip, ctx)))
    for (const e of errors.slice(0, -1)) expect(e).toBeInstanceOf(RetryableProviderError)
    const last = errors.at(-1) as Error
    expect(last).not.toBeInstanceOf(RetryableProviderError)
    expect(last.message).toMatch(/next engine takes the clip/)
    expect(ref()).toBeNull()
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('the other queues still resume on a retry', async () => {
    const f = queued()
    const err = await runUsage(unificallyAdapter({ id: 'clip:veo31-lite', fetchImpl: f.fetch, pollMs: 0, maxWaitMs: 0 }), 'generateVideo', clip, ctxWith().ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RetryableProviderError)
  })

  it('a finished clip that cannot be downloaded keeps the task id and retries the download (the clip is already paid for)', async () => {
    let cdnOk = false
    const f = fakeFetch((req) => {
      if (req.method === 'POST') return json({ code: 200, success: true, data: { task_id: 't1', status: 'processing' } })
      if (req.url.endsWith('.mp4')) return cdnOk ? new Response(Buffer.alloc(64, 1), { status: 200, headers: { 'content-type': 'video/mp4' } }) : new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
      return json({ code: 200, success: true, data: { task_id: 't1', status: 'completed', output: { video_url: 'https://cdn.example/v.mp4' } } })
    })
    const adapter = unificallyAdapter({ id: 'clip:veo31-lite-relaxed', fetchImpl: f.fetch, pollMs: 0 })
    const { ctx, ref } = ctxWith()
    const err = await outcome(runUsage(adapter, 'generateVideo', clip, ctx))
    expect(err).toBeInstanceOf(RetryableProviderError)
    expect(JSON.parse(ref() as string)).toMatchObject({ op: 't1' })
    cdnOk = true
    const out = await runUsage(adapter, 'generateVideo', clip, ctx)
    expect(out.files).toHaveLength(1)
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(ref()).toBeNull()
  })
})
