// production-7 (the AI presenter, decision 0034): the five presenter engines' adapters against a fake fetch (start, poll, download,
// cost per second, resume through providerRef, refusal over the engine's longest call, the key never sent to a file host), the
// registry's routing by engine, the fake's registration, the contract and the engines lines. Never the network, never a real key.
import { describe, expect, it } from 'vitest'
import { PRESENTER_RESOLUTION_IDS, TalkingAvatarInput } from '../../src/shared/cloud-api.ts'
import { PRESENTER_ENGINE_CAN, PRESENTER_ENGINES, PRESENTER_RESOLUTIONS } from '../../src/shared/presenter-engines.ts'
import { CloudConfigFile } from '../src/config.ts'
import { FAKE_ENGINES, publishEngines } from '../src/providers/engines.ts'
import { falAvatarAdapter, KLING_ENDPOINT } from '../src/providers/fal-avatar.ts'
import { fakeAvatar, fakeLookId } from '../src/providers/fakes.ts'
import { hedraAdapter, HEDRA_BASE } from '../src/providers/hedra.ts'
import { heygenAdapter, HEYGEN_API_BASE, retryAfterMs } from '../src/providers/heygen.ts'
import { gpuUsdPerSecond, infinitetalkGpuAdapter, maxJobCostUsd, RUNPOD_API_BASE } from '../src/providers/infinitetalk-gpu.ts'
import { presenterEngineAdapters } from '../src/providers/presenter-engines.ts'
import { realProviders } from '../src/providers/real.ts'
import { RetryableProviderError, runUsage, type ProviderAdapter, type ProviderContext } from '../src/providers/types.ts'
import { WAVESPEED_BASE, wavespeedAdapter, wavespeedBilledSeconds } from '../src/providers/wavespeed.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn, wavBytes } from './helpers.ts'

const KEY = 'presenter-test-SECRET-5d2f8a91'
const PROD = { NODE_ENV: 'production' }
const FILES = 'https://cloud.example/files'
const VOICE_URL = `${FILES}/art_voice?exp=1&sig=a`
const FACE_URL = `${FILES}/art_face?exp=1&sig=b`
const CDN = 'https://cdn.provider.example/out'
const AUDIO = Buffer.from('ID3-voice-bytes')
const PNG = Buffer.from('PNG-portrait-bytes')
const MP4 = Buffer.alloc(300, 5)
const PHOTO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

const ctxWith = (saved: string | null = null, signal?: AbortSignal, links: Record<string, [string, string]> = {}) => {
  const refs: (string | null)[] = []
  let current = saved
  const known: Record<string, [string, string]> = { art_voice: ['voix.mp3', VOICE_URL], art_face: ['visage.png', FACE_URL], ...links }
  const ctx: ProviderContext = {
    ...ctxFor(KEY, signal),
    artefact: (id) => {
      const k = known[id]
      if (!k) throw new Error('not found')
      return { name: k[0], url: k[1] }
    },
    providerRef: () => current,
    setProviderRef: (r) => {
      current = r
      refs.push(r)
    }
  }
  return { ctx, refs }
}

const input = (over: Record<string, unknown> = {}) => ({ avatarId: 'portrait', audioArtefactId: 'art_voice', portraitArtefactId: 'art_face', seconds: 5, aspect: '16:9', ...over })
const run = (a: ProviderAdapter, ctx: ProviderContext, over: Record<string, unknown> = {}) => runUsage(a, 'talkingAvatar', input(over), ctx)
const ours = (r: Recorded): boolean => r.url.startsWith(FILES)
const mp4 = (): Response => new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })
const sources = (r: Recorded): Response | null =>
  r.url === VOICE_URL ? new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg' } }) : r.url === FACE_URL ? new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }) : null
const seq = (calls: Recorded[]): string[] => calls.map((c) => `${c.method} ${c.url}`)

// ---- HeyGen (API v3) -------------------------------------------------------------------------------------------------------

function heygen(statuses: string[] = [], over: { status?: (n: number) => Response; start?: Response } = {}) {
  let polls = 0
  return fakeFetch((req) => {
    const src = sources(req)
    if (src) return src
    if (req.url === `${HEYGEN_API_BASE}/v3/videos`) return over.start ?? json({ data: { video_id: 'vid-1', status: 'pending' } })
    if (req.url === `${HEYGEN_API_BASE}/v3/videos/vid-1`) {
      polls++
      return over.status ? over.status(polls) : json({ data: { status: statuses[polls - 1] ?? 'completed', video_url: `${CDN}/v.mp4`, duration: 4.6 } })
    }
    return mp4()
  })
}

describe('HeyGen Avatar IV (presenter:heygen-avatar4, API v3)', () => {
  it('starts with our signed links (nothing uploaded), polls, downloads, bills the seconds; the key goes to HeyGen only', async () => {
    const f = heygen(['pending', 'processing'])
    const { ctx, refs } = ctxWith()
    const a = heygenAdapter({ fetchImpl: f.fetch, pollMs: 0 })
    expect(a).toMatchObject({ id: 'presenter:heygen-avatar4', kind: 'real', secretName: 'HEYGEN_API_KEY' })
    const out = await run(a, ctx, { prompt: 'nods calmly' })
    expect(seq(f.calls)).toEqual([
      `POST ${HEYGEN_API_BASE}/v3/videos`,
      `GET ${HEYGEN_API_BASE}/v3/videos/vid-1`,
      `GET ${HEYGEN_API_BASE}/v3/videos/vid-1`,
      `GET ${HEYGEN_API_BASE}/v3/videos/vid-1`,
      `GET ${CDN}/v.mp4`
    ])
    const start = f.calls[0] as Recorded
    expect(JSON.parse(start.body)).toEqual({ type: 'image', image: { type: 'url', url: FACE_URL }, audio_url: VOICE_URL, resolution: '720p', aspect_ratio: '16:9', motion_prompt: 'nods calmly' })
    expect(start.headers['content-type']).toBe('application/json')
    expect(start.headers['idempotency-key']).toBe('job_test')
    // the key goes to HeyGen only: never to our signed links (not even read here), never to the CDN
    expect(f.calls.some(ours)).toBe(false)
    for (const c of f.calls) expect(c.headers['x-api-key'], c.url).toBe(c.url.startsWith(HEYGEN_API_BASE) ? KEY : undefined)
    expect(JSON.stringify(f.calls.map((c) => c.url))).not.toContain(KEY)
    // the video id is kept at once, cleared when the clip is in hand
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ v: 'vid-1' })
    expect(refs.at(-1)).toBeNull()
    expect(out.files).toEqual([{ name: 'avatar.mp4', mime: 'video/mp4', bytes: MP4 }])
    expect(out.data).toMatchObject({ engine: 'presenter:heygen-avatar4', resolution: '720p', seconds: 5, videoId: 'vid-1' })
    expect(out.data).not.toHaveProperty('registration')
    expect(out.costUsd).toBeCloseTo(5 * PRESENTER_ENGINE_CAN['presenter:heygen-avatar4'].usdPerS['720p']!, 10)
    const tall = heygen()
    await run(heygenAdapter({ fetchImpl: tall.fetch, pollMs: 0 }), ctxWith().ctx, { resolution: '1080p', aspect: '9:16' })
    expect(JSON.parse(tall.calls[0]?.body ?? '{}')).toMatchObject({ resolution: '1080p', aspect_ratio: '9:16' })
    expect(JSON.parse(tall.calls[0]?.body ?? '{}')).not.toHaveProperty('motion_prompt')
  })

  it('no registration any more: an avatarId of the old talking-photo shape is only echoed; without a portrait nothing is called', async () => {
    const f = heygen()
    const out = await run(heygenAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctxWith().ctx, { avatarId: PHOTO })
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(JSON.parse(f.calls[0]?.body ?? '{}').image).toEqual({ type: 'url', url: FACE_URL })
    expect(out.data).toMatchObject({ avatarId: PHOTO })
    expect(out.data).not.toHaveProperty('registration')
    const g = heygen()
    await expect(run(heygenAdapter({ fetchImpl: g.fetch }), ctxWith().ctx, { avatarId: PHOTO, portraitArtefactId: undefined })).rejects.toThrow(/portrait is missing/)
    await expect(run(heygenAdapter({ fetchImpl: g.fetch }), ctxWith(null, undefined, { art_face: ['v.png', 'http://127.0.0.1:8787/files/art_face?sig=b'] }).ctx)).rejects.toThrow(/publicUrl/)
    expect(g.calls).toHaveLength(0)
  })

  it('a retry resumes the stored video (no second video), an old { t, v } ref included; an old registration alone starts one', async () => {
    const f = heygen(['processing'])
    const { ctx, refs } = ctxWith(JSON.stringify({ t: PHOTO, v: 'vid-1' }))
    await run(heygenAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(f.calls.some(ours)).toBe(false)
    expect(refs).toEqual([null])
    const g = heygen()
    await run(heygenAdapter({ fetchImpl: g.fetch, pollMs: 0 }), ctxWith(JSON.stringify({ v: 'vid-1' })).ctx)
    expect(g.calls.some((c) => c.method === 'POST')).toBe(false)
    const h = heygen()
    await run(heygenAdapter({ fetchImpl: h.fetch, pollMs: 0 }), ctxWith(JSON.stringify({ t: PHOTO })).ctx)
    expect(h.calls.filter((c) => c.url === `${HEYGEN_API_BASE}/v3/videos`)).toHaveLength(1)
  })

  it('refuses a call longer than the engine takes, before any call; a failed video clears the ref; a moderated one is refused; the key never shows', async () => {
    const f = heygen()
    await expect(run(heygenAdapter({ fetchImpl: f.fetch }), ctxWith().ctx, { seconds: 181 })).rejects.toThrow(/at most 180 seconds/)
    expect(f.calls).toHaveLength(0)
    const failed = ctxWith()
    const e = await run(heygenAdapter({ fetchImpl: heygen([], { status: () => json({ data: { status: 'failed', failure_code: 'RENDER_ERROR', failure_message: `bad ${KEY}` } }) }).fetch, pollMs: 0 }), failed.ctx).catch((x: Error) => x)
    expect((e as Error).message).toMatch(/video failed \(RENDER_ERROR/)
    expect((e as Error).message).not.toMatch(/^refused/)
    expect((e as Error).message).not.toContain(KEY)
    expect(e).not.toBeInstanceOf(RetryableProviderError)
    expect(failed.refs.at(-1)).toBeNull()
    const moderated = ctxWith()
    const m = await run(heygenAdapter({ fetchImpl: heygen([], { status: () => json({ data: { status: 'failed', failure_code: 'MODERATION_REJECTED', failure_message: 'content policy' } }) }).fetch, pollMs: 0 }), moderated.ctx).catch((x: Error) => x)
    expect((m as Error).message).toMatch(/^refused: /)
    expect(moderated.refs.at(-1)).toBeNull()
    const gone = ctxWith()
    const g = await run(heygenAdapter({ fetchImpl: heygen([], { status: () => new Response('{}', { status: 404 }) }).fetch, pollMs: 0 }), gone.ctx).catch((x: Error) => x)
    expect((g as Error).message).toMatch(/no longer knows/)
    expect(gone.refs.at(-1)).toBeNull()
  })

  it('a start whose answer is lost is not retried (it may be billed); a 429 is; a refused key is fatal and never shown', async () => {
    const lost = await run(heygenAdapter({ fetchImpl: heygen([], { start: new Response('{}', { status: 503 }) }).fetch, pollMs: 0 }), ctxWith().ctx).catch((x: unknown) => x)
    expect(lost).not.toBeInstanceOf(RetryableProviderError)
    expect((lost as Error).message).toMatch(/not confirmed/)
    const busy = await run(heygenAdapter({ fetchImpl: heygen([], { start: new Response('{}', { status: 429 }) }).fetch, pollMs: 0 }), ctxWith().ctx).catch((x: unknown) => x)
    expect(busy).toBeInstanceOf(RetryableProviderError)
    const key = await run(heygenAdapter({ fetchImpl: heygen([], { start: json({ error: { message: `invalid key ${KEY}` } }, 401) }).fetch, pollMs: 0 }), ctxWith().ctx).catch((x: Error) => x)
    expect(key).not.toBeInstanceOf(RetryableProviderError)
    expect((key as Error).message).toMatch(/401/)
    expect((key as Error).message).not.toContain(KEY)
  })

  it('a 429 while polling waits its Retry-After and goes on; a 5xx while polling is retryable and keeps the ref', async () => {
    const f = heygen([], { status: (n) => (n === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } }) : json({ data: { status: 'completed', video_url: `${CDN}/v.mp4`, duration: 5 } })) })
    const out = await run(heygenAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctxWith().ctx)
    expect(f.calls.filter((c) => c.url.endsWith('/v3/videos/vid-1'))).toHaveLength(2)
    expect(out.files).toHaveLength(1)
    expect([retryAfterMs('3'), retryAfterMs(null), retryAfterMs(new Date(10_000).toUTCString(), 4000)]).toEqual([3000, null, 6000])
    const down = ctxWith()
    const e = await run(heygenAdapter({ fetchImpl: heygen([], { status: () => new Response('{}', { status: 502 }) }).fetch, pollMs: 0 }), down.ctx).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(RetryableProviderError)
    expect(down.refs).toEqual([JSON.stringify({ v: 'vid-1' })])
  })
})

// ---- Hedra Character-3 ----------------------------------------------------------------------------------------------------

describe('Hedra Character-3 (presenter:hedra-c3)', () => {
  function hedra(over: { status?: Response } = {}) {
    const ids: Record<string, string> = { audio: 'aud-1', image: 'img-1' }
    let lastType = ''
    return fakeFetch((req) => {
      const src = sources(req)
      if (src) return src
      if (req.method === 'POST' && req.url === `${HEDRA_BASE}/assets`) {
        lastType = (JSON.parse(req.body) as { type: string }).type
        return json({ id: ids[lastType] })
      }
      if (req.method === 'POST' && req.url.endsWith('/upload')) return json({})
      if (req.method === 'POST' && req.url === `${HEDRA_BASE}/generations`) return json({ id: 'gen-1' })
      if (req.url === `${HEDRA_BASE}/generations/gen-1/status`) return over.status ?? json({ status: 'complete', url: `${CDN}/a.mp4`, duration_ms: 5000 })
      return mp4()
    })
  }
  const adapter = (f: { fetch: typeof fetch }) => hedraAdapter({ fetchImpl: f.fetch, pollMs: 0, id: 'presenter:hedra-c3', engine: 'presenter:hedra-c3' })

  it('uploads the portrait as an image asset used as the first frame, honours resolution and prompt, bills the resolution’s rate', async () => {
    const f = hedra()
    const out = await run(adapter(f), ctxWith().ctx, { resolution: '1080p', prompt: 'smiles and nods' })
    const assets = f.calls.filter((c) => c.url === `${HEDRA_BASE}/assets`).map((c) => JSON.parse(c.body) as { type: string })
    expect(assets.map((x) => x.type)).toEqual(['audio', 'image'])
    const start = JSON.parse(f.calls.find((c) => c.url === `${HEDRA_BASE}/generations`)?.body ?? '{}')
    expect(start).toMatchObject({ start_keyframe_id: 'img-1', audio_id: 'aud-1', generated_video_inputs: { text_prompt: 'smiles and nods', resolution: '1080p' } })
    expect(out.data).toMatchObject({ engine: 'presenter:hedra-c3', resolution: '1080p' })
    expect(out.costUsd).toBeCloseTo(5 * 0.0625, 10)
    const cheap = await run(adapter(hedra()), ctxWith().ctx, { resolution: '540p' })
    expect(cheap.costUsd).toBeCloseTo(5 * 0.025, 10)
    // the key goes to Hedra only
    for (const c of f.calls) expect(c.headers['x-api-key'], c.url).toBe(c.url.startsWith(HEDRA_BASE) ? KEY : undefined)
  })

  it('without a portrait it uses avatarId as before; refuses over 60 s and a resolution the engine does not make; the plain hedra adapter is unchanged', async () => {
    const f = hedra()
    await run(adapter(f), ctxWith().ctx, { portraitArtefactId: undefined, avatarId: 'img-existing' })
    expect(JSON.parse(f.calls.find((c) => c.url === `${HEDRA_BASE}/generations`)?.body ?? '{}').start_keyframe_id).toBe('img-existing')
    const g = hedra()
    await expect(run(adapter(g), ctxWith().ctx, { seconds: 61 })).rejects.toThrow(/at most 60 seconds/)
    await expect(run(adapter(g), ctxWith().ctx, { resolution: '480p' })).rejects.toThrow(/not a resolution/)
    expect(g.calls).toHaveLength(0)
    expect(hedraAdapter().id).toBe('hedra')
    expect(adapter(g).id).toBe('presenter:hedra-c3')
  })
})

// ---- Kling AI Avatar on fal -----------------------------------------------------------------------------------------------

describe('Kling AI Avatar v2 standard on fal (presenter:kling-avatar2-std)', () => {
  const Q = 'https://queue.fal.run'
  const handle = { request_id: 'r1', status_url: `${Q}/fal-ai/kling-video/requests/r1/status`, response_url: `${Q}/fal-ai/kling-video/requests/r1`, cancel_url: `${Q}/fal-ai/kling-video/requests/r1/cancel` }
  function fal(statuses: string[] = [], over: { submit?: Response; result?: Response } = {}) {
    let polls = 0
    return fakeFetch((req) => {
      const src = sources(req)
      if (src) return src
      if (req.url === `${Q}/${KLING_ENDPOINT}`) return over.submit ?? json(handle)
      if (req.url === handle.status_url) return json({ status: statuses[polls++] ?? 'COMPLETED' })
      if (req.url === handle.response_url) return over.result ?? json({ video: { url: `${CDN}/k.mp4` }, duration: 5.2 })
      return mp4()
    })
  }

  it('sends our signed links and the prompt, polls the queue, downloads, bills the reported duration, keeps the key off the file hosts', async () => {
    const f = fal(['IN_QUEUE', 'IN_PROGRESS'])
    const { ctx, refs } = ctxWith()
    const a = falAvatarAdapter({ fetchImpl: f.fetch, pollMs: 0 })
    expect(a).toMatchObject({ id: 'presenter:kling-avatar2-std', kind: 'real', secretName: 'FAL_KEY' })
    const out = await run(a, ctx, { prompt: 'calm' })
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${Q}/${KLING_ENDPOINT}`,
      `GET ${handle.status_url}`,
      `GET ${handle.status_url}`,
      `GET ${handle.status_url}`,
      `GET ${handle.response_url}`,
      `GET ${CDN}/k.mp4`
    ])
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ image_url: FACE_URL, audio_url: VOICE_URL, prompt: 'calm' })
    for (const c of f.calls) expect(c.headers.authorization, c.url).toBe(c.url.startsWith(Q) ? `Key ${KEY}` : undefined)
    expect(JSON.parse(refs[0] ?? '{}')).toMatchObject({ id: 'r1' })
    expect(refs.at(-1)).toBeNull()
    expect(out.files[0]).toMatchObject({ name: 'avatar.mp4', mime: 'video/mp4' })
    expect(out.costUsd).toBeCloseTo(5.2 * 0.0562, 10)
  })

  it('resumes a stored request, refuses over 60 s, a missing portrait, a link to another host and a link nobody can reach', async () => {
    const f = fal()
    const { ctx } = ctxWith(JSON.stringify({ id: 'r1', s: handle.status_url, r: handle.response_url, c: handle.cancel_url }))
    await run(falAvatarAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    const g = fal()
    await expect(run(falAvatarAdapter({ fetchImpl: g.fetch }), ctxWith().ctx, { seconds: 61 })).rejects.toThrow(/at most 60 seconds/)
    await expect(run(falAvatarAdapter({ fetchImpl: g.fetch }), ctxWith().ctx, { portraitArtefactId: undefined })).rejects.toThrow(/portrait is missing/)
    await expect(run(falAvatarAdapter({ fetchImpl: g.fetch }), ctxWith(null, undefined, { art_face: ['v.png', 'http://127.0.0.1:8787/files/art_face?sig=b'] }).ctx)).rejects.toThrow(/publicUrl/)
    expect(g.calls).toHaveLength(0)
    const evil = fal([], { submit: json({ ...handle, status_url: 'https://evil.example/status' }) })
    await expect(run(falAvatarAdapter({ fetchImpl: evil.fetch, pollMs: 0 }), ctxWith().ctx)).rejects.toThrow(/another host/)
  })

  it('a lost submission is not retried; a request that failed clears the ref', async () => {
    const lost = await run(falAvatarAdapter({ fetchImpl: fal([], { submit: new Response('{}', { status: 502 }) }).fetch, pollMs: 0 }), ctxWith().ctx).catch((x: unknown) => x)
    expect(lost).not.toBeInstanceOf(RetryableProviderError)
    const failed = ctxWith()
    const e = await run(falAvatarAdapter({ fetchImpl: fal([], { result: new Response('{"detail":"content refused"}', { status: 422 }) }).fetch, pollMs: 0 }), failed.ctx).catch((x: Error) => x)
    expect((e as Error).message).toMatch(/422/)
    expect(failed.refs.at(-1)).toBeNull()
  })
})

// ---- WaveSpeed InfiniteTalk fast ------------------------------------------------------------------------------------------

describe('InfiniteTalk fast on WaveSpeed (presenter:infinitetalk-fast)', () => {
  const START = `${WAVESPEED_BASE}/api/v3/wavespeed-ai/infinitetalk-fast`
  const RESULT = `${WAVESPEED_BASE}/api/v3/predictions/t1/result`
  function ws(states: string[] = [], over: { start?: Response } = {}) {
    let polls = 0
    return fakeFetch((req) => {
      const src = sources(req)
      if (src) return src
      if (req.url === START) return over.start ?? json({ code: 200, message: 'success', data: { id: 't1', status: 'created', outputs: [] } })
      if (req.url === RESULT) {
        const state = states[polls++] ?? 'completed'
        return json({ code: 200, data: { id: 't1', status: state, outputs: state === 'completed' ? [`${CDN}/w.mp4`] : [], timings: { inference: 9000 } } })
      }
      return mp4()
    })
  }

  it('sends our links, polls the task, downloads, bills whole seconds with a 3 s minimum, keeps the key off the file hosts', async () => {
    const f = ws(['created', 'processing'])
    const { ctx, refs } = ctxWith()
    const a = wavespeedAdapter({ fetchImpl: f.fetch, pollMs: 0 })
    expect(a).toMatchObject({ id: 'presenter:infinitetalk-fast', kind: 'real', secretName: 'WAVESPEED_API_KEY' })
    const out = await run(a, ctx, { seconds: 2, resolution: '480p' })
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toMatchObject({ image: FACE_URL, audio: VOICE_URL, resolution: '480p' })
    expect(f.calls.filter((c) => c.url === RESULT)).toHaveLength(3)
    for (const c of f.calls) expect(c.headers.authorization, c.url).toBe(c.url.startsWith(WAVESPEED_BASE) ? `Bearer ${KEY}` : undefined)
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ id: 't1' })
    expect(refs.at(-1)).toBeNull()
    expect(out.data).toMatchObject({ engine: 'presenter:infinitetalk-fast', resolution: '480p', seconds: 3, inferenceMs: 9000 })
    expect(out.costUsd).toBeCloseTo(3 * 0.015, 10)
    expect([wavespeedBilledSeconds(1), wavespeedBilledSeconds(10.2), wavespeedBilledSeconds(9000)]).toEqual([3, 11, 600])
    const d = await run(wavespeedAdapter({ fetchImpl: ws().fetch, pollMs: 0 }), ctxWith().ctx, { seconds: 10 })
    expect(d.costUsd).toBeCloseTo(10 * 0.03, 10) // 720p by default
  })

  it('resumes a stored task, refuses over 60 s and a failed task (clearing the ref), never retries a lost start', async () => {
    const f = ws()
    await run(wavespeedAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctxWith(JSON.stringify({ id: 't1' })).ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    await expect(run(wavespeedAdapter({ fetchImpl: f.fetch }), ctxWith().ctx, { seconds: 61 })).rejects.toThrow(/at most 60 seconds/)
    const bad = ctxWith()
    const e = await run(wavespeedAdapter({ fetchImpl: ws(['failed']).fetch, pollMs: 0 }), bad.ctx).catch((x: Error) => x)
    expect((e as Error).message).toMatch(/failed/)
    expect(bad.refs.at(-1)).toBeNull()
    const lost = await run(wavespeedAdapter({ fetchImpl: ws([], { start: new Response('{}', { status: 500 }) }).fetch, pollMs: 0 }), ctxWith().ctx).catch((x: unknown) => x)
    expect(lost).not.toBeInstanceOf(RetryableProviderError)
  })
})

// ---- InfiniteTalk on a rented GPU -----------------------------------------------------------------------------------------

describe('InfiniteTalk on a rented GPU (presenter:infinitetalk-gpu)', () => {
  const EP = 'abc123endpoint'
  const RUN = `${RUNPOD_API_BASE}/${EP}/run`
  const STATUS = `${RUNPOD_API_BASE}/${EP}/status/job-1`
  const CANCEL = `${RUNPOD_API_BASE}/${EP}/cancel/job-1`
  function pod(states: ({ status: string } & Record<string, unknown>)[] = [], over: { run?: Response } = {}) {
    let polls = 0
    return fakeFetch((req) => {
      const src = sources(req)
      if (src) return src
      if (req.url === RUN) return over.run ?? json({ id: 'job-1', status: 'IN_QUEUE' })
      if (req.url === STATUS) {
        const s = states[polls++] ?? { status: 'COMPLETED', output: { video_base64: MP4.toString('base64') }, executionTime: 12_000, delayTime: 30_000 }
        return json({ id: 'job-1', ...s })
      }
      if (req.url === CANCEL) return json({ id: 'job-1', status: 'CANCELLED' })
      return mp4()
    })
  }
  const adapter = (f: { fetch: typeof fetch }, over: Record<string, unknown> = {}) => infinitetalkGpuAdapter({ fetchImpl: f.fetch, pollMs: 0, endpointId: EP, ...over })

  it('starts with the cost ceiling in the policy, polls, returns the clip and bills the GPU seconds really used', async () => {
    const f = pod([{ status: 'IN_QUEUE' }, { status: 'IN_PROGRESS' }])
    const { ctx, refs } = ctxWith()
    const a = adapter(f, { maxGpuSeconds: 600, coldStartReserveS: 120, steps: 4, gpu: '4090' })
    expect(a).toMatchObject({ id: 'presenter:infinitetalk-gpu', kind: 'real', secretName: 'RUNPOD_API_KEY' })
    const out = await run(a, ctx, { resolution: '480p', prompt: 'calm' })
    const start = JSON.parse(f.calls[0]?.body ?? '{}')
    expect(start).toEqual({
      input: { image_url: FACE_URL, audio_url: VOICE_URL, resolution: '480p', steps: 4, seed: 42, prompt: 'calm' },
      policy: { executionTimeout: 600_000, ttl: 720_000 }
    })
    for (const c of f.calls) expect(c.headers.authorization, c.url).toBe(c.url.startsWith(RUNPOD_API_BASE) ? `Bearer ${KEY}` : undefined)
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ e: EP, j: 'job-1' })
    expect(refs.at(-1)).toBeNull()
    expect(out.files).toEqual([{ name: 'avatar.mp4', mime: 'video/mp4', bytes: MP4 }])
    // 12 s of GPU at the 4090 serverless price; the cold start is reported, not billed in costUsd
    expect(out.costUsd).toBeCloseTo(12 * (1.34 / 3600), 10)
    expect(out.data).toMatchObject({ gpu: '4090', gpuSeconds: 12, coldStartS: 30, gpuSecondsPerVideoSecond: 12 / 5, resolution: '480p' })
    expect(maxJobCostUsd('4090', 600, 120)).toBeCloseTo(720 * gpuUsdPerSecond('4090'), 12)
  })

  it('takes a link to the clip (fetched without any key), resumes a stored job, and cancels it when the Cloud job is cancelled', async () => {
    const f = pod([{ status: 'COMPLETED', output: { video_url: `${CDN}/g.mp4` }, executionTime: 8000 }])
    const out = await run(adapter(f), ctxWith().ctx)
    expect(f.calls.at(-1)?.url).toBe(`${CDN}/g.mp4`)
    expect(f.calls.at(-1)?.headers.authorization).toBeUndefined()
    expect(out.costUsd).toBeCloseTo(8 * (1.34 / 3600), 10)
    const g = pod()
    const { ctx } = ctxWith(JSON.stringify({ e: EP, j: 'job-1' }))
    await run(adapter(g), ctx)
    expect(g.calls.some((c) => c.url === RUN)).toBe(false)
    const ac = new AbortController()
    const h = pod([{ status: 'IN_PROGRESS' }, { status: 'IN_PROGRESS' }])
    const slow = adapter({ fetch: ((u: string, i?: RequestInit) => (String(u) === STATUS ? (ac.abort(new Error('cancelled')), h.fetch(u, i)) : h.fetch(u, i))) as typeof fetch })
    await expect(run(slow, ctxWith(null, ac.signal).ctx)).rejects.toThrow('cancelled')
    expect(h.calls.some((c) => c.url === CANCEL)).toBe(true)
  })

  it('a job that hit its limit fails for good (a retry would pay again) and clears the ref; failures say so; no endpoint is refused', async () => {
    const t = ctxWith()
    const e = await run(adapter(pod([{ status: 'TIMED_OUT', executionTime: 600_000 }]), { maxGpuSeconds: 600 }), t.ctx).catch((x: Error) => x)
    expect((e as Error).message).toMatch(/600 s limit after 600 s/)
    expect(e).not.toBeInstanceOf(RetryableProviderError)
    expect(t.refs.at(-1)).toBeNull()
    const failed = await run(adapter(pod([{ status: 'FAILED', error: 'CUDA out of memory' }])), ctxWith().ctx).catch((x: Error) => x)
    expect((failed as Error).message).toMatch(/failed \(CUDA out of memory\)/)
    const none = pod()
    await expect(run(infinitetalkGpuAdapter({ fetchImpl: none.fetch }), ctxWith().ctx)).rejects.toThrow(/no RunPod endpoint/)
    await expect(run(adapter(none), ctxWith().ctx, { seconds: 61 })).rejects.toThrow(/at most 60 seconds/)
    await expect(run(adapter(none), ctxWith().ctx, { resolution: '1080p' })).rejects.toThrow(/not a resolution/)
    expect(none.calls).toHaveLength(0)
    const lost = await run(adapter(pod([], { run: new Response('{}', { status: 502 }) })), ctxWith().ctx).catch((x: unknown) => x)
    expect(lost).not.toBeInstanceOf(RetryableProviderError)
  })
})

// ---- routing, fakes, contract, engine lines -------------------------------------------------------------------------------

describe('routing by engine', () => {
  it('presenterEngineAdapters has one real adapter per engine, whose id IS the engine id; realEngines accepts them', () => {
    // the MCP engine (the founder's HeyGen plan, an OAuth sign-in) is registered apart, in real.ts
    expect(presenterEngineAdapters().map((a) => a.id)).toEqual(PRESENTER_ENGINES.filter((e) => e !== 'presenter:heygen-mcp'))
    for (const a of presenterEngineAdapters()) expect(typeof a.talkingAvatar).toBe('function')
    const cfg = CloudConfigFile.parse({ realEngines: ['voice:ai33', 'presenter:infinitetalk-gpu'], infinitetalk: { endpointId: 'ep_1234', gpu: 'l40s' } })
    expect(realProviders(cfg).engines).toEqual(['voice:ai33', 'presenter:infinitetalk-gpu'])
    expect(CloudConfigFile.safeParse({ realEngines: ['presenter:nobody'] }).success).toBe(false)
    expect(CloudConfigFile.parse({}).infinitetalk).toMatchObject({ gpu: '4090', steps: 8, maxGpuSeconds: 1800 })
    expect(CloudConfigFile.safeParse({ infinitetalk: { gpu: 'k80' } }).success).toBe(false)
    expect(realProviders(CloudConfigFile.parse({})).adapters.map((a) => a.id)).toEqual(expect.arrayContaining([...PRESENTER_ENGINES, 'hedra']))
  })

  it('a talking-avatar job that names an engine is served by it only when listed in realEngines, with paidCalls and the key', async () => {
    const f = fakeFetch((req) => sources(req) ?? (req.url.startsWith(WAVESPEED_BASE) ? (req.method === 'POST' ? json({ data: { id: 't1' } }) : json({ data: { id: 't1', status: 'completed', outputs: [`${CDN}/w.mp4`] } })) : mp4()))
    const mk = (engines: string[]) => makeCloud({ paidCalls: true, env: PROD, publicUrl: 'https://cloud.example', realAdapters: [wavespeedAdapter({ fetchImpl: f.fetch, pollMs: 0 })], engines })
    const off = mk([])
    off.cloud.vault.set('WAVESPEED_API_KEY', KEY, 'test')
    expect(off.cloud.registry.resolveFor('talkingAvatar', { engine: 'presenter:infinitetalk-fast' })).toMatchObject({ status: 'demo', reason: expect.stringMatching(/not enabled/) })
    const t = mk(['presenter:infinitetalk-fast'])
    expect(t.cloud.registry.resolveFor('talkingAvatar', { engine: 'presenter:infinitetalk-fast' })).toMatchObject({ status: 'demo', reason: expect.stringMatching(/vault/) })
    t.cloud.vault.set('WAVESPEED_API_KEY', KEY, 'test')
    expect(t.cloud.registry.resolveFor('talkingAvatar', { engine: 'presenter:infinitetalk-fast' })).toMatchObject({ status: 'real' })
    const p = await signUpAndIn(t, { credits: 100_000 })
    const voice = await t.cloud.storage.put(p.teamId, null, { name: 'voix.wav', mime: 'audio/wav', bytes: wavBytes(5) }, false)
    const face = await t.cloud.storage.put(p.teamId, null, { name: 'visage.png', mime: 'image/png', bytes: PNG }, false)
    const { job } = await quoteAndRun(t, p, 'talkingAvatar', { avatarId: 'portrait', audioArtefactId: voice.id, portraitArtefactId: face.id, seconds: 5, engine: 'presenter:infinitetalk-fast' })
    expect(job).toMatchObject({ state: 'succeeded', demo: false })
    expect((t.cloud.db.prepare('SELECT provider FROM jobs WHERE id = ?').get(job.id) as { provider: string }).provider).toBe('presenter:infinitetalk-fast')
    // the provider got OUR signed links of this team's files, bound to the job, on the public address (production-10)
    const body = JSON.parse(f.calls.find((c) => c.method === 'POST')?.body ?? '{}') as { image: string; audio: string }
    expect(body.image).toMatch(new RegExp(`^https://cloud\\.example/provider-files/${job.id}/${face.id}\\?exp=\\d+&sig=`))
    expect(body.audio).toContain(`/provider-files/${job.id}/${voice.id}?`)
  })

  it('a quote refuses an engine the registry does not declare for a talking avatar, and a portrait that is not the team’s', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const post = (payload: object) => t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload })
    const unknown = await post({ usage: 'talkingAvatar', input: { avatarId: 'a', seconds: 5, engine: 'presenter:nobody' } })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.body).toMatch(/unknown presenter engine/)
    expect((await post({ usage: 'talkingAvatar', input: { avatarId: 'a', seconds: 5, engine: 'voice:fish-s2' } })).statusCode).toBe(400)
    expect((await post({ usage: 'talkingAvatar', input: { avatarId: 'a', seconds: 5, portraitArtefactId: 'art_other' } })).statusCode).toBe(404)
    expect((await post({ usage: 'talkingAvatar', input: { avatarId: 'a', seconds: 5, engine: 'presenter:hedra-c3', resolution: '720p', prompt: 'x' } })).statusCode).toBe(200)
  })
})

describe('the fake presenter', () => {
  it('echoes engine and resolution; only HeyGen MCP registers a face (production-17: its look; HeyGen API v3 takes an image link)', async () => {
    const ctx = ctxWith().ctx
    expect(PRESENTER_ENGINES.filter((e) => PRESENTER_ENGINE_CAN[e].registration)).toEqual(['presenter:heygen-mcp'])
    const look = await runUsage(fakeAvatar, 'talkingAvatar', input({ engine: 'presenter:heygen-mcp', resolution: '1080p' }), ctx)
    expect(look.data.registration).toMatch(/^fake-look-[0-9a-f]{8}$/)
    const heygenJob = await runUsage(fakeAvatar, 'talkingAvatar', input({ engine: 'presenter:heygen-avatar4', resolution: '1080p' }), ctx)
    expect(heygenJob.data).toMatchObject({ engine: 'presenter:heygen-avatar4', resolution: '1080p' })
    expect(heygenJob.data).not.toHaveProperty('registration')
    expect(fakeLookId('art_face')).toMatch(/^fake-look-[0-9a-f]{8}$/)
    expect(fakeLookId('art_face')).not.toBe(fakeLookId('art_other'))
    const noPortrait = await runUsage(fakeAvatar, 'talkingAvatar', input({ engine: 'presenter:heygen-avatar4', portraitArtefactId: undefined }), ctx)
    expect(noPortrait.data).not.toHaveProperty('registration')
    const hedra = await runUsage(fakeAvatar, 'talkingAvatar', input({ engine: 'presenter:hedra-c3' }), ctx)
    expect(hedra.data).toMatchObject({ engine: 'presenter:hedra-c3' })
    expect(hedra.data).not.toHaveProperty('registration')
    expect(heygenJob.costUsd).toBeCloseTo(5 * 0.02, 10) // as before: the fake's cost per second
    const old = await runUsage(fakeAvatar, 'talkingAvatar', { avatarId: 'a', seconds: 5, aspect: '16:9' }, ctx)
    expect(old.data).toEqual({ avatarId: 'a', requestedSeconds: 5 })
  })

  it('end to end: a demo job on HeyGen succeeds without a registration to keep', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 100_000 })
    const face = await t.cloud.storage.put(p.teamId, null, { name: 'visage.png', mime: 'image/png', bytes: PNG }, false)
    const { job } = await quoteAndRun(t, p, 'talkingAvatar', { avatarId: 'portrait', portraitArtefactId: face.id, seconds: 5, engine: 'presenter:heygen-avatar4' })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(job.result).toMatchObject({ engine: 'presenter:heygen-avatar4' })
    expect(job.result).not.toHaveProperty('registration')
  })
})

describe('the contract and the engines lines', () => {
  it('TalkingAvatarInput keeps old inputs valid and takes the new optional fields; its resolution list equals the shared one', () => {
    expect(TalkingAvatarInput.parse({ avatarId: 'a', seconds: 5 })).toEqual({ avatarId: 'a', seconds: 5, aspect: '16:9' })
    expect(TalkingAvatarInput.parse({ avatarId: 'a', seconds: 5, engine: 'presenter:hedra-c3', portraitArtefactId: 'art_1', resolution: '540p', prompt: 'x' })).toMatchObject({ resolution: '540p' })
    expect(TalkingAvatarInput.safeParse({ avatarId: 'a', seconds: 5, prompt: 'x'.repeat(301) }).success).toBe(false)
    expect(TalkingAvatarInput.safeParse({ avatarId: 'a', seconds: 5, resolution: '4k' }).success).toBe(false)
    expect([...PRESENTER_RESOLUTION_IDS]).toEqual([...PRESENTER_RESOLUTIONS])
  })

  it('every presenter engine is declared with its longest call, and has a real adapter of the same id', () => {
    const lines = publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }), resolveFor: () => ({ status: 'demo' }) } as never, null).filter((e) => e.family === 'presenter')
    expect(lines.map((e) => e.id)).toEqual([...PRESENTER_ENGINES])
    for (const e of lines) expect(e.limits.maxSecondsPerCall, e.id).toBe(PRESENTER_ENGINE_CAN[e.id as keyof typeof PRESENTER_ENGINE_CAN].maxCallS)
    const ids = realProviders(CloudConfigFile.parse({})).adapters.map((a) => a.id)
    for (const e of PRESENTER_ENGINES) expect(ids).toContain(e)
  })
})
