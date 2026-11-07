// The image and video adapters against a fake fetch: Gemini "Nano Banana" pictures and fal.ai (FLUX schnell pictures, Wan 2.2
// video through the queue, resumable through providerRef). Request shape, auth header from the secret, parsing, error mapping,
// cost per unit, abort. Nothing here reaches the network.
import { describe, expect, it } from 'vitest'
import { falAdapter, falImageCostUsd, falVideoCostUsd } from '../src/providers/fal.ts'
import { geminiAdapter } from '../src/providers/gemini.ts'
import { geminiImagePrice, nearestRatio } from '../src/providers/gemini-image.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const GKEY = 'AIza-test-SECRET-img-1a2b3c'
const FKEY = 'fal-test-SECRET-4d5e6f7a8b'
const PROD = { NODE_ENV: 'production' }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const gemAnswer = (mime = 'image/png') => json({ candidates: [{ content: { parts: [{ text: 'voilà' }, { inlineData: { mimeType: mime, data: PNG.toString('base64') } }] }, finishReason: 'STOP' }] })
const image = (input: Record<string, unknown> = {}) => ({ prompt: 'un phare sous la tempête', width: 1280, height: 720, count: 1, ...input })

describe('Gemini image ("Nano Banana")', () => {
  it('is the same adapter and the same secret as the eyes', () => {
    const a = geminiAdapter()
    expect(a).toMatchObject({ id: 'gemini', kind: 'real', secretName: 'GEMINI_API_KEY' })
    expect(typeof a.generateImage).toBe('function')
    expect(typeof a.analyseVideo).toBe('function')
  })

  it('sends the key in a header, asks for an image at the nearest aspect ratio, and returns the decoded file', async () => {
    const f = fakeFetch(() => gemAnswer())
    const out = await runUsage(geminiAdapter({ fetchImpl: f.fetch }), 'generateImage', image(), ctxFor(GKEY))
    const [req] = f.calls
    expect(req?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent')
    expect(req?.url).not.toContain(GKEY)
    expect(req?.headers['x-goog-api-key']).toBe(GKEY)
    const body = JSON.parse(req?.body ?? '{}') as { contents: { parts: { text: string }[] }[]; generationConfig: Record<string, unknown> }
    expect(body.contents[0]?.parts[0]?.text).toBe('un phare sous la tempête')
    expect(body.generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } })
    expect(out.files).toHaveLength(1)
    expect(out.files[0]).toMatchObject({ name: 'image-1.png', mime: 'image/png' })
    expect(Buffer.from(out.files[0]?.bytes ?? []).equals(PNG)).toBe(true)
    expect(out.costUsd).toBe(0.0336)
  })

  it('one call per picture, cost per picture, the model is configurable and priced', async () => {
    const f = fakeFetch(() => gemAnswer('image/jpeg'))
    const out = await runUsage(geminiAdapter({ fetchImpl: f.fetch, imageModel: 'gemini-3-pro-image' }), 'generateImage', image({ count: 3, width: 720, height: 1280 }), ctxFor(GKEY))
    expect(f.calls).toHaveLength(3)
    expect(f.calls[0]?.url).toContain('/models/gemini-3-pro-image:generateContent')
    expect(JSON.parse(f.calls[0]?.body ?? '{}').generationConfig.imageConfig.aspectRatio).toBe('9:16')
    expect(out.files.map((x) => x.name)).toEqual(['image-1.jpg', 'image-2.jpg', 'image-3.jpg'])
    expect(out.costUsd).toBeCloseTo(0.134 * 3, 10)
    expect(geminiImagePrice('gemini-nano-banana-2.1')).toBe(0.0336)
    expect(geminiImagePrice('gemini-3.1-flash-image')).toBe(0.067)
    expect(geminiImagePrice('a-model-not-in-the-table')).toBe(0.134) // the highest known: a P&L never under-reports
    expect(nearestRatio(1280, 720)).toBe('16:9')
    expect(nearestRatio(1000, 1000)).toBe('1:1')
    expect(nearestRatio(2560, 1080)).toBe('21:9')
  })

  it('maps failures: a refused prompt and a safety stop are fatal, an empty answer and 429/5xx retry, 401 is fatal', async () => {
    const run = (res: Response) => runUsage(geminiAdapter({ fetchImpl: fakeFetch(() => res.clone()).fetch }), 'generateImage', image(), ctxFor(GKEY))
    await expect(run(json({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }))).rejects.toThrow(/refused/)
    const safety = await run(json({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] })).catch((e: unknown) => e)
    expect(safety).not.toBeInstanceOf(RetryableProviderError)
    await expect(run(json({ candidates: [{ content: { parts: [{ text: 'no picture' }] }, finishReason: 'STOP' }] }))).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(new Response('{}', { status: 429 }))).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(new Response('{}', { status: 503 }))).rejects.toBeInstanceOf(RetryableProviderError)
    const refused = await run(new Response(`{"error":{"status":"PERMISSION_DENIED","message":"${GKEY}"}}`, { status: 403 })).catch((e: Error) => e)
    expect(refused).not.toBeInstanceOf(RetryableProviderError)
    expect((refused as Error).message).toMatch(/403.*PERMISSION_DENIED/)
    expect((refused as Error).message).not.toContain(GKEY)
  })
})

const CDN = 'https://v3.fal.media/files'
const falImageAnswer = (n = 1, over: Record<string, unknown> = {}) =>
  json({ images: Array.from({ length: n }, (_, i) => ({ url: `${CDN}/img-${i + 1}.jpg`, width: 1280, height: 720, content_type: 'image/jpeg' })), has_nsfw_concepts: Array(n).fill(false), ...over })
const jpg = (): Response => new Response(Buffer.alloc(32, 7), { status: 200, headers: { 'content-type': 'image/jpeg' } })

describe('fal.ai image (FLUX schnell)', () => {
  it('declares its secret and both usages', () => {
    expect(falAdapter()).toMatchObject({ id: 'fal', kind: 'real', secretName: 'FAL_KEY' })
    expect(typeof falAdapter().generateImage).toBe('function')
    expect(typeof falAdapter().generateVideo).toBe('function')
  })

  it('posts the prompt with `Authorization: Key …`, downloads the pictures without the key, and bills per megapixel', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://fal.run/') ? falImageAnswer(2) : jpg()))
    const out = await runUsage(falAdapter({ fetchImpl: f.fetch }), 'generateImage', image({ count: 2 }), ctxFor(FKEY))
    const [req, d1] = f.calls
    expect(req?.url).toBe('https://fal.run/fal-ai/flux/schnell')
    expect(req?.headers.authorization).toBe(`Key ${FKEY}`)
    expect(req?.url).not.toContain(FKEY)
    expect(JSON.parse(req?.body ?? '{}')).toEqual({
      prompt: 'un phare sous la tempête',
      image_size: { width: 1280, height: 720 },
      num_inference_steps: 4,
      num_images: 2,
      enable_safety_checker: true,
      output_format: 'jpeg'
    })
    expect(d1?.url).toBe(`${CDN}/img-1.jpg`)
    expect(d1?.headers.authorization).toBeUndefined()
    expect(out.files.map((x) => x.name)).toEqual(['image-1.jpg', 'image-2.jpg'])
    // 1280 × 720 is under one megapixel: rounded up to one, USD 0.003 each
    expect(out.costUsd).toBeCloseTo(0.006, 10)
    expect(falImageCostUsd(1280, 720, 1)).toBeCloseTo(0.003, 10)
    expect(falImageCostUsd(1920, 1080, 1)).toBeCloseTo(0.009, 10) // 2.07 MP rounds up to 3
  })

  it('rounds the size to a multiple of 16 inside fal limits, and never hands on a flagged picture', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://fal.run/') ? falImageAnswer(2, { has_nsfw_concepts: [true, false] }) : jpg()))
    const out = await runUsage(falAdapter({ fetchImpl: f.fetch }), 'generateImage', image({ count: 2, width: 1283, height: 100 }), ctxFor(FKEY))
    expect(JSON.parse(f.calls[0]?.body ?? '{}').image_size).toEqual({ width: 1280, height: 256 })
    expect(out.files).toHaveLength(1)
    expect(out.data.flagged).toBe(1)
    const all = fakeFetch(() => falImageAnswer(1, { has_nsfw_concepts: [true] }))
    await expect(runUsage(falAdapter({ fetchImpl: all.fetch }), 'generateImage', image(), ctxFor(FKEY))).rejects.toThrow(/safety checker/)
  })

  it('maps failures: 429/5xx retry, 401 and 422 are fatal, no picture retries; the key never shows', async () => {
    const run = (res: Response) => runUsage(falAdapter({ fetchImpl: fakeFetch(() => res.clone()).fetch }), 'generateImage', image(), ctxFor(FKEY))
    await expect(run(new Response('{}', { status: 429 }))).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(new Response('{}', { status: 502 }))).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(json({ images: [] }))).rejects.toBeInstanceOf(RetryableProviderError)
    const auth = await run(new Response(`{"detail":"bad ${FKEY}"}`, { status: 401 })).catch((e: Error) => e)
    expect(auth).not.toBeInstanceOf(RetryableProviderError)
    expect((auth as Error).message).toMatch(/401/)
    expect((auth as Error).message).not.toContain(FKEY)
    const bad = await run(new Response('{"detail":"prompt too long"}', { status: 422 })).catch((e: Error) => e)
    expect(bad).not.toBeInstanceOf(RetryableProviderError)
    expect((bad as Error).message).toContain('prompt too long')
  })
})

// ---- video: the queue ------------------------------------------------------------------------------------------------

const QUEUE = 'https://queue.fal.run'
const SUBMIT = {
  request_id: 'req-123',
  status_url: `${QUEUE}/fal-ai/wan/requests/req-123/status`,
  response_url: `${QUEUE}/fal-ai/wan/requests/req-123`,
  cancel_url: `${QUEUE}/fal-ai/wan/requests/req-123/cancel`
}
const clip = (): Response => new Response(Buffer.alloc(256, 3), { status: 200, headers: { 'content-type': 'video/mp4' } })

/** A fake fal queue: statuses are answered in order, then COMPLETED; the result and the CDN file follow. */
function queue(statuses: string[], over: { submit?: Response; result?: () => Response; status?: (n: number) => Response } = {}) {
  let polls = 0
  return fakeFetch((req: Recorded) => {
    if (req.method === 'POST' && req.url === `${QUEUE}/fal-ai/wan/v2.2-a14b/text-to-video`) return over.submit ?? json(SUBMIT)
    if (req.method === 'PUT') return json({ status: 'CANCELLATION_REQUESTED' }, 202)
    if (req.url === SUBMIT.status_url) {
      polls++
      return over.status ? over.status(polls) : json({ status: statuses[polls - 1] ?? 'COMPLETED' })
    }
    if (req.url === SUBMIT.response_url) return over.result ? over.result() : json({ video: { url: `${CDN}/clip.mp4` }, seed: 1 })
    return clip()
  })
}

function ctxWithRef(saved: string | null) {
  const refs: (string | null)[] = []
  let current = saved
  const ctx: ProviderContext = {
    ...ctxFor(FKEY),
    providerRef: () => current,
    setProviderRef: (r) => {
      current = r
      refs.push(r)
    }
  }
  return { ctx, refs }
}
const withSignal = (ctx: ProviderContext, signal: AbortSignal): ProviderContext => ({ ...ctx, signal })
const video = (a: ReturnType<typeof falAdapter>, ctx: ProviderContext, seconds = 5) => runUsage(a, 'generateVideo', { prompt: 'des vagues sur la falaise', seconds }, ctx)

describe('fal.ai video (Wan 2.2 through the queue)', () => {
  it('submits, polls until COMPLETED, reads the result, downloads the clip, and bills the seconds it holds', async () => {
    const f = queue(['IN_QUEUE', 'IN_PROGRESS'])
    const { ctx, refs } = ctxWithRef(null)
    const out = await video(falAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctx, 5)
    const [submit] = f.calls
    expect(submit?.headers.authorization).toBe(`Key ${FKEY}`)
    expect(JSON.parse(submit?.body ?? '{}')).toEqual({
      prompt: 'des vagues sur la falaise',
      num_frames: 80,
      frames_per_second: 16,
      resolution: '720p',
      aspect_ratio: '16:9',
      enable_safety_checker: true
    })
    // the URLs of the submit answer are used as they are
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${QUEUE}/fal-ai/wan/v2.2-a14b/text-to-video`,
      `GET ${SUBMIT.status_url}`,
      `GET ${SUBMIT.status_url}`,
      `GET ${SUBMIT.status_url}`,
      `GET ${SUBMIT.response_url}`,
      `GET ${CDN}/clip.mp4`
    ])
    expect(f.calls.at(-1)?.headers.authorization).toBeUndefined()
    // the handle is stored before the first poll and cleared once the clip is in hand
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ id: 'req-123', s: SUBMIT.status_url, r: SUBMIT.response_url, c: SUBMIT.cancel_url })
    expect(refs.at(-1)).toBeNull()
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    expect(out.data).toMatchObject({ seconds: 5, resolution: '720p', frames: 80 })
    expect(out.costUsd).toBeCloseTo(0.4, 10) // 5 s × USD 0.08
    expect(falVideoCostUsd('480p', 10)).toBeCloseTo(0.4, 10)
  })

  it('the resolution is configurable and priced', async () => {
    const { ctx } = ctxWithRef(null)
    const out = await video(falAdapter({ fetchImpl: queue([]).fetch, pollMs: 0, videoResolution: '480p' }), ctx, 4)
    expect(out.costUsd).toBeCloseTo(0.16, 10)
  })

  it('a retry resumes the stored request: no second submission, no second bill', async () => {
    const f = queue(['IN_PROGRESS'])
    const saved = JSON.stringify({ id: 'req-123', s: SUBMIT.status_url, r: SUBMIT.response_url, c: SUBMIT.cancel_url })
    const { ctx, refs } = ctxWithRef(saved)
    const out = await video(falAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(out.files).toHaveLength(1)
    expect(refs).toEqual([null])
  })

  it('a poll that times out leaves the ref for the retry, which resumes it', async () => {
    const forever = queue([], { status: () => json({ status: 'IN_PROGRESS' }) })
    const first = ctxWithRef(null)
    await expect(video(falAdapter({ fetchImpl: forever.fetch, pollMs: 1, maxWaitMs: 5 }), first.ctx)).rejects.toBeInstanceOf(RetryableProviderError)
    expect(first.refs).toHaveLength(1)
    const second = ctxWithRef(first.refs[0] ?? null)
    const done = queue([])
    const out = await video(falAdapter({ fetchImpl: done.fetch, pollMs: 0 }), second.ctx)
    expect(done.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(out.files).toHaveLength(1)
  })

  it('a request that finished with an error, or that fal no longer knows, fails for good and clears the ref', async () => {
    const failed = queue([], { status: () => json({ status: 'COMPLETED', error: 'boom', error_type: 'runtime_error' }) })
    const a = ctxWithRef(null)
    const e1 = await video(falAdapter({ fetchImpl: failed.fetch, pollMs: 0 }), a.ctx).catch((e: Error) => e)
    expect(e1).not.toBeInstanceOf(RetryableProviderError)
    expect((e1 as Error).message).toMatch(/runtime_error/)
    expect(a.refs.at(-1)).toBeNull()
    const gone = queue([], { status: () => new Response('{}', { status: 404 }) })
    const b = ctxWithRef(null)
    const e2 = await video(falAdapter({ fetchImpl: gone.fetch, pollMs: 0 }), b.ctx).catch((e: Error) => e)
    expect(e2).not.toBeInstanceOf(RetryableProviderError)
    expect((e2 as Error).message).toMatch(/no longer knows/)
    expect(b.refs.at(-1)).toBeNull()
  })

  it('refuses a queue link to another host (the key must not leave queue.fal.run) and a clip longer than ten seconds', async () => {
    const evil = queue([], { submit: json({ ...SUBMIT, status_url: 'https://evil.example/status' }) })
    await expect(video(falAdapter({ fetchImpl: evil.fetch, pollMs: 0 }), ctxWithRef(null).ctx)).rejects.toThrow(/another host/)
    expect(evil.calls).toHaveLength(1)
    const none = queue([])
    await expect(video(falAdapter({ fetchImpl: none.fetch }), ctxWithRef(null).ctx, 11)).rejects.toThrow(/at most 10 seconds/)
    expect(none.calls).toHaveLength(0)
  })

  it('maps submit failures: 429/5xx retry, 401 is fatal', async () => {
    const run = (status: number) => video(falAdapter({ fetchImpl: queue([], { submit: new Response('{}', { status }) }).fetch, pollMs: 0 }), ctxWithRef(null).ctx)
    await expect(run(429)).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(500)).rejects.toBeInstanceOf(RetryableProviderError)
    const fatal = await run(401).catch((e: Error) => e)
    expect(fatal).not.toBeInstanceOf(RetryableProviderError)
    expect((fatal as Error).message).not.toContain(FKEY)
  })

  it('a job cancelled while polling asks fal to cancel the request and clears the ref', async () => {
    const ac = new AbortController()
    const f = queue([], {
      status: () => {
        ac.abort(new Error('cancelled'))
        return json({ status: 'IN_QUEUE' })
      }
    })
    const { ctx, refs } = ctxWithRef(null)
    await expect(video(falAdapter({ fetchImpl: f.fetch, pollMs: 0 }), withSignal(ctx, ac.signal))).rejects.toThrow('cancelled')
    expect(f.calls.some((c) => c.method === 'PUT' && c.url === SUBMIT.cancel_url && c.headers.authorization === `Key ${FKEY}`)).toBe(true)
    expect(refs.at(-1)).toBeNull()
  })
})

describe('jobs on the new adapters (fake fetch)', () => {
  it('a Gemini image job is real, charged on the quote, and the key is read with an audit line', async () => {
    const f = fakeFetch(() => gemAnswer())
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [geminiAdapter({ fetchImpl: f.fetch })], providers: { generateImage: 'gemini' } })
    t.cloud.vault.set('GEMINI_API_KEY', GKEY, 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'generateImage', { prompt: 'un phare', count: 1 })
    expect(job).toMatchObject({ state: 'succeeded', demo: false })
    expect(job.artefacts).toHaveLength(1)
    expect(t.cloud.audit.list().some((e) => e.action === 'vault.read' && e.actor === 'adapter:gemini')).toBe(true)
    expect(f.calls[0]?.headers['x-goog-api-key']).toBe(GKEY)
  })

  it('a fal video job resumes through providerRef across a retry: one submission, one clip', async () => {
    let polls = 0
    const f = queue([], {
      status: () => {
        polls++
        // the first attempt's poll fails with a retryable error, the retry polls the same request again
        return polls === 1 ? new Response('{}', { status: 503 }) : json({ status: 'COMPLETED' })
      }
    })
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [falAdapter({ fetchImpl: f.fetch, pollMs: 0 })], providers: { generateVideo: 'fal' } })
    t.cloud.vault.set('FAL_KEY', FKEY, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { job } = await quoteAndRun(t, p, 'generateVideo', { prompt: 'des vagues', seconds: 5 })
    expect(job).toMatchObject({ state: 'succeeded', demo: false, attempts: 2 })
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    const row = t.cloud.db.prepare('SELECT provider_ref FROM jobs WHERE id = ?').get(job.id) as { provider_ref: string | null }
    expect(row.provider_ref).toBeNull()
    expect(JSON.stringify({ job, events: t.cloud.db.prepare('SELECT * FROM job_events').all() })).not.toContain(FKEY)
  })
})
