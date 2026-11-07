// production-10: the two more WaveSpeed presenter engines (InfiniteTalk standard, Pruna P-Video Avatar) served by the same factory
// as InfiniteTalk fast, against a fake fetch: the exact request of each model, the key to WaveSpeed only, the cost of each engine's
// line, the resume, a failed task, 401 / 429 / 5xx, a lost start. Never the network, never a real key.
import { describe, expect, it } from 'vitest'
import { PRESENTER_ENGINE_CAN } from '../../src/shared/presenter-engines.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { WAVESPEED_BASE, WAVESPEED_MODELS, wavespeedAdapter, wavespeedBilledSeconds, wavespeedBilledSecondsFor, type WavespeedEngine } from '../src/providers/wavespeed.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'

const KEY = 'wavespeed-test-SECRET-7c1e0b44'
const FILES = 'https://cloud.example/files'
const VOICE_URL = `${FILES}/art_voice?exp=1&sig=a`
const FACE_URL = `${FILES}/art_face?exp=1&sig=b`
const CDN = 'https://d1q70pf5vjeyhc.cloudfront.example/out/w.mp4'
const MP4 = Buffer.alloc(200, 7)
const RESULT = `${WAVESPEED_BASE}/api/v3/predictions/t9/result`

function ctxWith(saved: string | null = null) {
  const refs: (string | null)[] = []
  let current = saved
  const known: Record<string, [string, string]> = { art_voice: ['voix.mp3', VOICE_URL], art_face: ['visage.png', FACE_URL] }
  const ctx: ProviderContext = {
    ...ctxFor(KEY),
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

function ws(engine: WavespeedEngine, states: string[] = [], over: { start?: Response; result?: () => Response } = {}) {
  let polls = 0
  return fakeFetch((req: Recorded) => {
    if (req.url === `${WAVESPEED_BASE}${WAVESPEED_MODELS[engine].path}`) return over.start ?? json({ code: 200, message: 'success', data: { id: 't9', status: 'created', outputs: [] } })
    if (req.url === RESULT) {
      if (over.result) return over.result()
      const state = states[polls++] ?? 'completed'
      return json({ code: 200, data: { id: 't9', status: state, outputs: state === 'completed' ? [CDN] : [], error: state === 'failed' ? `boom ${KEY}` : '' } })
    }
    return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  })
}

const run = (engine: WavespeedEngine, f: { fetch: typeof fetch }, ctx: ProviderContext, over: Record<string, unknown> = {}) =>
  runUsage(wavespeedAdapter({ engine, fetchImpl: f.fetch, pollMs: 0 }), 'talkingAvatar', { avatarId: 'portrait', audioArtefactId: 'art_voice', portraitArtefactId: 'art_face', seconds: 5, aspect: '16:9', ...over }, ctx)

describe('InfiniteTalk standard on WaveSpeed (presenter:infinitetalk-std)', () => {
  it('posts to the standard model with our links, the prompt and the resolution; bills whole seconds, 3 s minimum, at its line', async () => {
    const f = ws('presenter:infinitetalk-std', ['created', 'processing'])
    const { ctx, refs } = ctxWith()
    const a = wavespeedAdapter({ engine: 'presenter:infinitetalk-std', fetchImpl: f.fetch, pollMs: 0 })
    expect(a).toMatchObject({ id: 'presenter:infinitetalk-std', kind: 'real', secretName: 'WAVESPEED_API_KEY' })
    const out = await run('presenter:infinitetalk-std', f, ctx, { seconds: 2, resolution: '480p', prompt: 'calm' })
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: `${WAVESPEED_BASE}/api/v3/wavespeed-ai/infinitetalk` })
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ image: FACE_URL, audio: VOICE_URL, resolution: '480p', seed: -1, prompt: 'calm' })
    expect(f.calls.filter((c) => c.url === RESULT)).toHaveLength(3)
    for (const c of f.calls) expect(c.headers.authorization, c.url).toBe(c.url.startsWith(WAVESPEED_BASE) ? `Bearer ${KEY}` : undefined)
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ id: 't9' })
    expect(refs.at(-1)).toBeNull()
    expect(out.files).toEqual([{ name: 'avatar.mp4', mime: 'video/mp4', bytes: MP4 }])
    expect(out.data).toMatchObject({ engine: 'presenter:infinitetalk-std', resolution: '480p', seconds: 3, requestedSeconds: 2 })
    expect(out.costUsd).toBeCloseTo(3 * PRESENTER_ENGINE_CAN['presenter:infinitetalk-std'].usdPerS['480p']!, 10)
    const d = await run('presenter:infinitetalk-std', ws('presenter:infinitetalk-std'), ctxWith().ctx, { seconds: 10 })
    expect(d.costUsd).toBeCloseTo(10 * 0.06, 10) // 720p by default
    expect(wavespeedBilledSecondsFor('presenter:infinitetalk-std', 9000)).toBe(600)
  })

  it('refuses over 60 s and 1080p before any call; the fast engine still behaves as before', async () => {
    const f = ws('presenter:infinitetalk-std')
    await expect(run('presenter:infinitetalk-std', f, ctxWith().ctx, { seconds: 61 })).rejects.toThrow(/at most 60 seconds/)
    await expect(run('presenter:infinitetalk-std', f, ctxWith().ctx, { resolution: '1080p' })).rejects.toThrow(/not a resolution/)
    expect(f.calls).toHaveLength(0)
    expect(wavespeedAdapter().id).toBe('presenter:infinitetalk-fast')
    expect([wavespeedBilledSeconds(1), wavespeedBilledSeconds(10.2)]).toEqual([3, 11])
  })
})

describe('Pruna P-Video Avatar on WaveSpeed (presenter:pruna-avatar)', () => {
  it('posts video_prompt (not prompt) and the resolution to the Pruna model; billed on the audio length at its line, no 3 s minimum', async () => {
    const f = ws('presenter:pruna-avatar')
    const { ctx } = ctxWith()
    const out = await run('presenter:pruna-avatar', f, ctx, { seconds: 2, resolution: '1080p', prompt: 'smiles' })
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: `${WAVESPEED_BASE}/api/v3/pruna-ai/p-video/avatar` })
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ image: FACE_URL, audio: VOICE_URL, resolution: '1080p', seed: -1, video_prompt: 'smiles' })
    expect(out.data).toMatchObject({ engine: 'presenter:pruna-avatar', resolution: '1080p', seconds: 2 })
    expect(out.costUsd).toBeCloseTo(2 * 0.045, 10)
    const g = ws('presenter:pruna-avatar')
    const d = await run('presenter:pruna-avatar', g, ctxWith().ctx, { seconds: 120 })
    expect(d.costUsd).toBeCloseTo(120 * 0.025, 10) // 720p by default
    // no motion line: neither field is sent
    expect(JSON.parse(g.calls[0]?.body ?? '{}')).toEqual({ image: FACE_URL, audio: VOICE_URL, resolution: '720p', seed: -1 })
  })

  it('takes up to 3 minutes, refuses more and 480p before any call', async () => {
    const f = ws('presenter:pruna-avatar')
    await expect(run('presenter:pruna-avatar', f, ctxWith().ctx, { seconds: 181 })).rejects.toThrow(/at most 180 seconds/)
    await expect(run('presenter:pruna-avatar', f, ctxWith().ctx, { resolution: '480p' })).rejects.toThrow(/not a resolution/)
    expect(f.calls).toHaveLength(0)
  })
})

describe.each(['presenter:infinitetalk-std', 'presenter:pruna-avatar'] as const)('%s: resume and failures', (engine) => {
  it('a retry polls the stored task and never starts a second one', async () => {
    const f = ws(engine, ['processing'])
    const { ctx, refs } = ctxWith(JSON.stringify({ id: 't9' }))
    await run(engine, f, ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(refs).toEqual([null])
  })

  it('a failed task fails for good and clears the ref, without the key in the message', async () => {
    const { ctx, refs } = ctxWith()
    const e = await run(engine, ws(engine, ['failed']), ctx).catch((x: Error) => x)
    expect((e as Error).message).toMatch(/the task failed/)
    expect((e as Error).message).not.toContain(KEY)
    expect(e).not.toBeInstanceOf(RetryableProviderError)
    expect(refs.at(-1)).toBeNull()
  })

  it('401 is fatal without the key; a 429 start is retryable; a lost start (5xx) is not retried; a 5xx poll is retryable and keeps the ref', async () => {
    const key = await run(engine, ws(engine, [], { start: json({ message: `bad key ${KEY}` }, 401) }), ctxWith().ctx).catch((x: Error) => x)
    expect(key).not.toBeInstanceOf(RetryableProviderError)
    expect((key as Error).message).toMatch(/401/)
    expect((key as Error).message).not.toContain(KEY)
    expect(await run(engine, ws(engine, [], { start: new Response('{}', { status: 429 }) }), ctxWith().ctx).catch((x: unknown) => x)).toBeInstanceOf(RetryableProviderError)
    const lost = await run(engine, ws(engine, [], { start: new Response('{}', { status: 502 }) }), ctxWith().ctx).catch((x: Error) => x)
    expect(lost).not.toBeInstanceOf(RetryableProviderError)
    expect((lost as Error).message).toMatch(/not confirmed/)
    const busy = ctxWith()
    const e = await run(engine, ws(engine, [], { result: () => new Response('{}', { status: 503 }) }), busy.ctx).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(RetryableProviderError)
    expect(busy.refs).toEqual([JSON.stringify({ id: 't9' })])
  })
})
