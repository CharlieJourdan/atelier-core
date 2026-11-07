// production-8 (decision 0035): the real adapters of the still and clip engines, against a fake fetch, never the network.
// Each adapter's id IS its engine id; each is checked for the request it sends (URL, headers, body, the references and the start
// still), its polling and resume, its refusal (`refused:` and not retryable), its retryable failures, its cost, and the registry
// serving it only when the engine is listed in `realEngines`.
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CLIP_ENGINES, IMAGE_ENGINES, clipLengthFor } from '../../src/shared/visual-engines.ts'
import { CloudConfigFile } from '../src/config.ts'
import { FAKE_ENGINES } from '../src/providers/engines.ts'
import { minimaxVideoAdapter } from '../src/providers/minimax-video.ts'
import { OPENAI_IMAGE_USD_PER_OUTPUT_TOKEN, openaiImageAdapter, openaiSize } from '../src/providers/openai-image.ts'
import { realProviders } from '../src/providers/real.ts'
import { RetryableProviderError, runUsage, type ProviderAdapter, type ProviderContext } from '../src/providers/types.ts'
import { unificallyAdapter, veoVertexAdapter } from '../src/providers/veo.ts'
import { REAL_VISUAL_ENGINES, visualEngineAdapters } from '../src/providers/visual-engines.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const KEY = 'visual-test-SECRET-5d2f9c1e'
const PROD = { NODE_ENV: 'production' }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const MP4 = Buffer.alloc(48, 9)
const CLOUD = 'https://cloud.example/files'
const ART: Record<string, string> = { art_a: `${CLOUD}/art_a?exp=1&sig=aa`, art_b: `${CLOUD}/art_b?exp=1&sig=bb`, art_still: `${CLOUD}/art_still?exp=1&sig=ss` }

const png = (): Response => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
const mp4 = (): Response => new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })
const isArtefact = (r: Recorded): boolean => r.url.startsWith(`${CLOUD}/`)

/** A context whose artefact links are the Cloud's signed ones; `refs` records the provider handle stored. */
function ctxWith(secret = KEY, saved: string | null = null): { ctx: ProviderContext; refs: (string | null)[] } {
  const refs: (string | null)[] = []
  const ctx: ProviderContext = {
    ...ctxFor(secret),
    artefactUrl: (id) => {
      const u = ART[id]
      if (!u) throw new Error('not found')
      return u
    },
    providerRef: () => saved,
    setProviderRef: (r) => {
      saved = r
      refs.push(r)
    }
  }
  return { ctx, refs }
}

const image = (input: Record<string, unknown> = {}) => ({ prompt: 'un phare sous la tempête', width: 1280, height: 720, count: 1, ...input })
const clip = (input: Record<string, unknown> = {}) => ({ prompt: 'les vagues montent', seconds: 5, aspect: '16:9', ...input })
const body = (r: Recorded | undefined): Record<string, any> => JSON.parse(r?.body ?? '{}') as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)

describe('the list of engines', () => {
  it('every still and clip engine has a real adapter whose id is the engine id, declared in the engines registry', () => {
    expect(REAL_VISUAL_ENGINES).toEqual([...IMAGE_ENGINES, ...CLIP_ENGINES])
    const adapters = visualEngineAdapters()
    expect(adapters.map((a) => a.id).sort()).toEqual([...REAL_VISUAL_ENGINES].sort())
    for (const a of adapters) {
      expect(a.kind).toBe('real')
      expect(a.secretName).toMatch(/^[A-Z_]+$/)
      const decl = FAKE_ENGINES.find((e) => e.id === a.id)
      expect(decl).toBeDefined()
      // a still engine only makes stills, a clip engine only clips
      expect(typeof a.generateImage === 'function').toBe(decl?.usage === 'generateImage')
      expect(typeof a.generateVideo === 'function').toBe(decl?.usage === 'generateVideo')
    }
  })

  it('the vault secrets', () => {
    const secrets = Object.fromEntries(visualEngineAdapters().map((a) => [a.id, a.secretName]))
    expect(secrets).toEqual({
      'image:gpt-image-25-low': 'OPENAI_API_KEY', 'image:gpt-image-25-medium': 'OPENAI_API_KEY', 'image:gpt-image-25-high': 'OPENAI_API_KEY',
      'image:gpt-image-25-fal-low': 'FAL_KEY', 'image:gpt-image-25-fal-medium': 'FAL_KEY', 'image:gpt-image-25-kie': 'KIE_API_KEY',
      'image:flux-schnell': 'FAL_KEY', 'image:nano-banana-2': 'GEMINI_API_KEY',
      'clip:wan22': 'FAL_KEY', 'clip:minimax-h3-lite': 'MINIMAX_API_KEY', 'clip:veo31-lite-vertex': 'VERTEX_SERVICE_ACCOUNT_JSON',
      'clip:veo31-lite-relaxed': 'UNIFICALLY_API_KEY', 'clip:veo31-lite': 'UNIFICALLY_API_KEY', 'clip:veo31-fast': 'UNIFICALLY_API_KEY',
      'clip:veo31-fast-1080p': 'UNIFICALLY_API_KEY', 'clip:veo31-lite-kie': 'KIE_API_KEY',
      // vrais-tests: the cheap models on unifically.com
      'image:flux3-klein': 'UNIFICALLY_API_KEY', 'image:z-image-turbo': 'UNIFICALLY_API_KEY', 'image:nano-banana-2-lite': 'UNIFICALLY_API_KEY',
      'image:nano-banana-21': 'UNIFICALLY_API_KEY', 'image:seedream-50-lite': 'UNIFICALLY_API_KEY', 'clip:grok-imagine-15-lite': 'UNIFICALLY_API_KEY',
      'clip:seedance-20-mini-480p': 'UNIFICALLY_API_KEY', 'clip:seedance-20-mini': 'UNIFICALLY_API_KEY', 'clip:seedance-15-pro': 'UNIFICALLY_API_KEY',
      'clip:hailuo-23-fast': 'UNIFICALLY_API_KEY', 'clip:kling-25-turbo': 'UNIFICALLY_API_KEY'
    })
  })

  it('config.json takes the still and clip engines in realEngines; real.ts registers their adapters', () => {
    const cfg = CloudConfigFile.parse({ realEngines: ['image:flux-schnell', 'clip:wan22', 'voice:fish-s2'] })
    const real = realProviders(cfg)
    expect(real.engines).toEqual(['image:flux-schnell', 'clip:wan22', 'voice:fish-s2'])
    for (const id of REAL_VISUAL_ENGINES) expect(real.adapters.some((a) => a.id === id)).toBe(true)
    expect(CloudConfigFile.safeParse({ realEngines: ['image:nobody'] }).success).toBe(false)
  })
})

describe('routing by engine', () => {
  // The registry answers for the input's engine (`resolveFor`, as the jobs module asks it); the adapter it hands out is then run.
  it('a picture job that names an engine is served by it only when it is listed in realEngines and its key is in the vault', async () => {
    const f = fakeFetch((req) => (req.url.includes('/fal-ai/flux/') ? json({ images: [{ url: 'https://v3.fal.media/files/a.png', width: 1280, height: 720 }], has_nsfw_concepts: [false] }) : png()))
    const adapters = visualEngineAdapters({ fetchImpl: f.fetch })
    const input = { engine: 'image:flux-schnell' }
    // not listed: the fake, whatever the vault holds
    const off = makeCloud({ paidCalls: true, env: PROD, realAdapters: adapters, engines: [] })
    off.cloud.vault.set('FAL_KEY', KEY, 'test')
    expect(off.cloud.registry.resolveFor('generateImage', input)).toMatchObject({ status: 'demo', reason: expect.stringMatching(/not enabled/) })

    // listed but no key
    const nokey = makeCloud({ paidCalls: true, env: PROD, realAdapters: adapters, engines: ['image:flux-schnell'] })
    expect(nokey.cloud.registry.resolveFor('generateImage', input)).toMatchObject({ status: 'demo', reason: expect.stringMatching(/vault/) })

    // listed with its key: the engine's adapter runs; an engine not listed stays demo; so does paidCalls off
    const on = makeCloud({ paidCalls: true, env: PROD, realAdapters: adapters, providers: { generateImage: 'fake' }, engines: ['image:flux-schnell'] })
    on.cloud.vault.set('FAL_KEY', KEY, 'test')
    on.cloud.vault.set('GEMINI_API_KEY', KEY, 'test')
    const served = on.cloud.registry.resolveFor('generateImage', input)
    expect(served).toMatchObject({ status: 'real', reason: null })
    expect(served.adapter.id).toBe('image:flux-schnell')
    const out = await runUsage(served.adapter, 'generateImage', image(), ctxWith().ctx)
    expect(out.files).toHaveLength(1)
    expect(f.calls.some((c) => c.url.includes('/fal-ai/flux/schnell'))).toBe(true)
    expect(on.cloud.registry.resolveFor('generateImage', { engine: 'image:nano-banana-2' })).toMatchObject({ status: 'demo', reason: expect.stringMatching(/not enabled/) })
    expect(on.cloud.registry.resolveFor('generateImage', {})).toMatchObject({ status: 'demo' }) // no engine: the usage's own provider (the fake)
    const paidOff = makeCloud({ paidCalls: false, env: PROD, realAdapters: adapters, engines: ['image:flux-schnell'] })
    paidOff.cloud.vault.set('FAL_KEY', KEY, 'test')
    expect(paidOff.cloud.registry.resolveFor('generateImage', input)).toMatchObject({ status: 'demo', reason: 'paidCalls is off' })
  })

  it('every engine id is served by its own adapter and by no other, for its own usage', () => {
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: visualEngineAdapters(), engines: [...REAL_VISUAL_ENGINES] })
    for (const name of ['OPENAI_API_KEY', 'FAL_KEY', 'GEMINI_API_KEY', 'MINIMAX_API_KEY', 'VERTEX_SERVICE_ACCOUNT_JSON', 'UNIFICALLY_API_KEY', 'KIE_API_KEY']) t.cloud.vault.set(name, KEY, 'test')
    for (const id of REAL_VISUAL_ENGINES) {
      const usage = id.startsWith('image:') ? 'generateImage' : 'generateVideo'
      const r = t.cloud.registry.resolveFor(usage, { engine: id })
      expect(r).toMatchObject({ status: 'real' })
      expect(r.adapter.id).toBe(id)
    }
  })

  it('a clip job with a start still reaches the clip engine with the still’s signed link', async () => {
    const f = fakeFetch((req) => {
      if (req.method === 'POST') return json({ request_id: 'r1', status_url: 'https://queue.fal.run/fal-ai/wan/requests/r1/status', response_url: 'https://queue.fal.run/fal-ai/wan/requests/r1', cancel_url: 'https://queue.fal.run/fal-ai/wan/requests/r1/cancel' })
      if (req.url.endsWith('/status')) return json({ status: 'COMPLETED' })
      if (req.url.endsWith('/r1')) return json({ video: { url: 'https://v3.fal.media/files/c.mp4' } })
      return mp4()
    })
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: visualEngineAdapters({ fetchImpl: f.fetch, pollMs: 0 }), providers: { generateVideo: 'fake' }, engines: ['clip:wan22'] })
    t.cloud.vault.set('FAL_KEY', KEY, 'test')
    const served = t.cloud.registry.resolveFor('generateVideo', { engine: 'clip:wan22' })
    expect(served.adapter.id).toBe('clip:wan22')
    await runUsage(served.adapter, 'generateVideo', clip({ engine: 'clip:wan22', imageArtefactId: 'art_still' }), ctxWith().ctx)
    const submit = f.calls.find((c) => c.method === 'POST')
    expect(submit?.url).toBe('https://queue.fal.run/fal-ai/wan/v2.2-a14b/image-to-video')
    expect(body(submit).image_url).toBe(ART.art_still)
  })
})

describe('openaiSize', () => {
  it('keeps a valid size, rounds to 16 and stays inside the limits', () => {
    expect(openaiSize(1280, 720)).toBe('1280x720')
    expect(openaiSize(720, 1280)).toBe('720x1280')
    expect(openaiSize(1000, 1000)).toBe('1008x1008') // 1000 → a multiple of 16
    expect(openaiSize(256, 256)).toBe('816x816') // under the minimum pixels: scaled up
    expect(openaiSize(4096, 4096)).toBe('2880x2880') // edge cut to 3840, then scaled down to the 8 294 400 pixel limit
    const [w, h] = openaiSize(4000, 600).split('x').map(Number) as [number, number]
    expect(w / h).toBeLessThanOrEqual(3)
    expect(w).toBeLessThanOrEqual(3840)
  })
})

describe('OpenAI Images (image:gpt-image-25-low / -medium / -high)', () => {
  const answer = (n = 1, outputTokens: number | null = 1056) =>
    json({ data: Array.from({ length: n }, () => ({ b64_json: PNG.toString('base64') })), ...(outputTokens === null ? {} : { usage: { input_tokens: 40, output_tokens: outputTokens, total_tokens: 40 + outputTokens } }) })

  it('generations: the key in the Authorization header only, quality from the engine, size, count, « Avoid: » negative, cost from the billed tokens', async () => {
    const f = fakeFetch(() => answer(2))
    const out = await runUsage(openaiImageAdapter({ id: 'image:gpt-image-25-low', fetchImpl: f.fetch }), 'generateImage', image({ count: 2, negative: 'du texte' }), ctxWith().ctx)
    const [req] = f.calls
    expect(req?.method).toBe('POST')
    expect(req?.url).toBe('https://api.openai.com/v1/images/generations')
    expect(req?.url).not.toContain(KEY)
    expect(req?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(body(req)).toMatchObject({ model: expect.stringMatching(/^gpt-image-2\.5-/), prompt: 'un phare sous la tempête\n\nAvoid: du texte', n: 2, size: '1280x720', quality: 'low', output_format: 'png' })
    expect(out.files.map((x) => x.name)).toEqual(['image-1.png', 'image-2.png'])
    expect(Buffer.from(out.files[0]?.bytes ?? []).equals(PNG)).toBe(true)
    // production-17: the answer's output tokens at USD 30 a million (the job is charged its real cost)
    expect(out.costUsd).toBeCloseTo(1056 * OPENAI_IMAGE_USD_PER_OUTPUT_TOKEN, 10)
    expect(out.costUnknown).toBeUndefined()
    expect(out.data).toMatchObject({ quality: 'low', references: 0, usage: { inputTokens: 40, outputTokens: 1056 } })
    const medium = await runUsage(openaiImageAdapter({ id: 'image:gpt-image-25-medium', fetchImpl: fakeFetch(() => answer(1, 440)).fetch }), 'generateImage', image(), ctxWith().ctx)
    expect(medium.costUsd).toBeCloseTo(0.0132, 10)
    // an answer without usage: the registry line per picture
    const hf = fakeFetch(() => answer(1, null))
    expect((await runUsage(openaiImageAdapter({ id: 'image:gpt-image-25-high', fetchImpl: hf.fetch }), 'generateImage', image(), ctxWith().ctx)).costUsd).toBeCloseTo(0.0527, 10)
    expect(body(hf.calls[0]).quality).toBe('high')
  })

  it('with references: the edits endpoint, multipart, one image part per reference read from the artefact links', async () => {
    const f = fakeFetch((req) => (isArtefact(req) ? png() : answer()))
    const out = await runUsage(
      openaiImageAdapter({ id: 'image:gpt-image-25-medium', fetchImpl: f.fetch }),
      'generateImage',
      image({ referenceArtefactIds: ['art_a', 'art_b'], width: 720, height: 1280 }),
      ctxWith().ctx
    )
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${ART.art_a}`, `GET ${ART.art_b}`, 'POST https://api.openai.com/v1/images/edits'])
    // the key never goes to the Cloud's link
    expect(f.calls[0]?.headers.authorization).toBeUndefined()
    const edit = f.calls[2]
    expect(edit?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(edit?.headers['content-type']).toBeUndefined() // fetch sets the multipart boundary itself
    expect(edit?.form).toMatchObject({ model: expect.stringMatching(/^gpt-image-2\.5-/), prompt: 'un phare sous la tempête', quality: 'medium', size: '720x1280', n: '1' })
    expect(edit?.form?.['image[]']).toMatchObject({ name: 'ref-2.png', type: 'image/png', size: PNG.length }) // the last of two parts
    expect(out.data).toMatchObject({ references: 2 })
    expect(out.files).toHaveLength(1)
  })

  it('a reference that is not a picture fails the job without calling OpenAI', async () => {
    const f = fakeFetch((req) => (isArtefact(req) ? new Response('<html>', { headers: { 'content-type': 'text/html' } }) : answer()))
    const err = await outcome(runUsage(openaiImageAdapter({ id: 'image:gpt-image-25-low', fetchImpl: f.fetch }), 'generateImage', image({ referenceArtefactIds: ['art_a'] }), ctxWith().ctx))
    expect(err.message).toMatch(/reference image could not be read/)
    expect(err).not.toBeInstanceOf(RetryableProviderError)
    expect(f.calls.some((c) => c.url.includes('openai.com'))).toBe(false)
  })

  it('a moderation block is refused: not retryable, the reason starts with « refused: »', async () => {
    const f = fakeFetch(() => json({ error: { type: 'image_generation_user_error', code: 'moderation_blocked', message: 'blocked' } }, 400))
    const err = await outcome(runUsage(openaiImageAdapter({ id: 'image:gpt-image-25-low', fetchImpl: f.fetch }), 'generateImage', image(), ctxWith().ctx))
    expect(err.message).toMatch(/^refused: /)
    expect(err).not.toBeInstanceOf(RetryableProviderError)
  })

  it('429 and 5xx retry, 401 is fatal and never shows the key, an answer without a picture retries', async () => {
    const run = (res: Response) => runUsage(openaiImageAdapter({ id: 'image:gpt-image-25-low', fetchImpl: fakeFetch(() => res.clone()).fetch }), 'generateImage', image(), ctxWith().ctx)
    expect(await outcome(run(new Response('{}', { status: 429 })))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run(new Response('{}', { status: 503 })))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run(json({ data: [] })))).toBeInstanceOf(RetryableProviderError)
    const bad = await outcome(run(new Response(`{"error":{"code":"invalid_api_key","message":"${KEY}"}}`, { status: 401 })))
    expect(bad).not.toBeInstanceOf(RetryableProviderError)
    expect(bad.message).toMatch(/401.*invalid_api_key/)
    expect(bad.message).not.toContain(KEY)
  })
})

describe('FLUX schnell (image:flux-schnell) and Nano Banana 2 (image:nano-banana-2)', () => {
  const adapter = (id: string, f: ReturnType<typeof fakeFetch>): ProviderAdapter => visualEngineAdapters({ fetchImpl: f.fetch }).find((a) => a.id === id) as ProviderAdapter

  it('FLUX: the fal image call, no reference (it takes none), « Avoid: » negative, cost by megapixel', async () => {
    const f = fakeFetch((req) => (req.method === 'POST' ? json({ images: [{ url: 'https://v3.fal.media/files/a.png', width: 1280, height: 720 }], has_nsfw_concepts: [false] }) : png()))
    const out = await runUsage(adapter('image:flux-schnell', f), 'generateImage', image({ negative: 'flou' }), ctxWith().ctx)
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: 'https://fal.run/fal-ai/flux/schnell' })
    expect(f.calls[0]?.headers.authorization).toBe(`Key ${KEY}`)
    expect(body(f.calls[0]).prompt).toBe('un phare sous la tempête\n\nAvoid: flou')
    expect(out.costUsd).toBeCloseTo(0.003, 10)
    expect(out.files).toHaveLength(1)
  })

  it('Nano Banana 2: the model of the engine, references as inline image parts after the text, « Avoid: » negative, cost per picture', async () => {
    const gem = json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] }, finishReason: 'STOP' }] })
    const f = fakeFetch((req) => (isArtefact(req) ? png() : gem.clone()))
    const out = await runUsage(adapter('image:nano-banana-2', f), 'generateImage', image({ referenceArtefactIds: ['art_a', 'art_b'], negative: 'logos' }), ctxWith().ctx)
    const post = f.calls.find((c) => c.method === 'POST')
    expect(post?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent')
    expect(post?.headers['x-goog-api-key']).toBe(KEY)
    const parts = body(post).contents[0].parts as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ text: 'un phare sous la tempête\n\nAvoid: logos' })
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } })
    expect(parts[2]?.inlineData.data).toBe(PNG.toString('base64'))
    expect(f.calls.filter(isArtefact).every((c) => c.headers['x-goog-api-key'] === undefined)).toBe(true)
    expect(out.costUsd).toBeCloseTo(0.067, 10)
    expect(out.data).toMatchObject({ model: 'gemini-3.1-flash-image', references: 2 })
  })

  it('Nano Banana 2: a safety stop is refused-style fatal, 5xx retries', async () => {
    const run = (res: Response) => runUsage(adapter('image:nano-banana-2', fakeFetch(() => res.clone())), 'generateImage', image(), ctxWith().ctx)
    const blocked = await outcome(run(json({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })))
    expect(blocked).not.toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run(new Response('{}', { status: 500 })))).toBeInstanceOf(RetryableProviderError)
  })
})

describe('Wan 2.2 (clip:wan22)', () => {
  const STATUS = 'https://queue.fal.run/fal-ai/wan/requests/w1/status'
  const RESULT = 'https://queue.fal.run/fal-ai/wan/requests/w1'
  const CANCEL = 'https://queue.fal.run/fal-ai/wan/requests/w1/cancel'
  const queue = () =>
    fakeFetch((req) => {
      if (req.method === 'POST') return json({ request_id: 'w1', status_url: STATUS, response_url: RESULT, cancel_url: CANCEL })
      if (req.url === STATUS) return json({ status: 'COMPLETED' })
      if (req.url === RESULT) return json({ video: { url: 'https://v3.fal.media/files/w.mp4' } })
      return mp4()
    })
  const wan = (f: ReturnType<typeof fakeFetch>): ProviderAdapter => visualEngineAdapters({ fetchImpl: f.fetch, pollMs: 0 }).find((a) => a.id === 'clip:wan22') as ProviderAdapter

  it('with a start still: the image-to-video endpoint, image_url = the still’s signed link, 480p, negative_prompt, billed per second', async () => {
    const f = queue()
    const { ctx, refs } = ctxWith()
    const out = await runUsage(wan(f), 'generateVideo', clip({ imageArtefactId: 'art_still', negative: 'texte', seconds: 5, aspect: '9:16' }), ctx)
    const submit = f.calls[0]
    expect(submit?.url).toBe('https://queue.fal.run/fal-ai/wan/v2.2-a14b/image-to-video')
    expect(submit?.headers.authorization).toBe(`Key ${KEY}`)
    expect(body(submit)).toEqual({
      prompt: 'les vagues montent',
      image_url: ART.art_still,
      negative_prompt: 'texte',
      num_frames: 80,
      frames_per_second: 16,
      resolution: '480p',
      aspect_ratio: '9:16',
      enable_safety_checker: true
    })
    expect(JSON.parse(refs[0] ?? '{}')).toMatchObject({ id: 'w1', c: CANCEL })
    expect(refs.at(-1)).toBeNull()
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    expect(out.data).toMatchObject({ fromImage: true, resolution: '480p', seconds: 5 })
    expect(out.costUsd).toBeCloseTo(5 * 0.04, 10)
  })

  it('without a still: the text-to-video endpoint, no image_url', async () => {
    const f = queue()
    await runUsage(wan(f), 'generateVideo', clip(), ctxWith().ctx)
    expect(f.calls[0]?.url).toBe('https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video')
    expect(body(f.calls[0])).not.toHaveProperty('image_url')
    expect(body(f.calls[0])).not.toHaveProperty('negative_prompt')
  })

  it('a 5xx on the submission retries; abandon cancels the request through its own cancel link', async () => {
    const down = fakeFetch(() => new Response('{}', { status: 502 }))
    expect(await outcome(runUsage(wan(down), 'generateVideo', clip(), ctxWith().ctx))).toBeInstanceOf(RetryableProviderError)
    const f = queue()
    const a = wan(f)
    await runUsage(a, 'generateVideo', clip(), ctxWith().ctx)
    await a.abandon?.(JSON.stringify({ id: 'w1', s: STATUS, r: RESULT, c: CANCEL }))
    expect(f.calls.at(-1)).toMatchObject({ method: 'PUT', url: CANCEL })
    await a.abandon?.(JSON.stringify({ id: 'w1', s: STATUS, r: RESULT, c: 'https://evil.example/cancel' }))
    expect(f.calls.at(-1)?.url).toBe(CANCEL) // a link to another host is never called with the key
  })
})

describe('MiniMax Hailuo 3 Lite (clip:minimax-h3-lite)', () => {
  const VIDEO = 'https://cdn.minimax.example/out/clip.mp4'
  const route = (statuses: string[], over: Partial<{ create: Response; failure: Record<string, unknown> }> = {}) => {
    const seen = [...statuses]
    return fakeFetch((req) => {
      if (req.method === 'POST') return over.create ?? json({ task_id: '4242' })
      if (req.method === 'DELETE') return json({ task_id: '4242', action: 'cancelled', status: 'cancelled' })
      if (req.url.includes('/v2/query/video_generation/')) {
        const status = seen.shift() ?? 'succeeded'
        if (status === 'succeeded') return json({ task: { id: '4242', status, content: { url: VIDEO }, duration: 6, usage: { output_seconds: 6 } } })
        if (status === 'failed') return json({ task: { id: '4242', status, error: over.failure ?? { code: 1000, message: 'internal' } } })
        return json({ task: { id: '4242', status } })
      }
      return mp4()
    })
  }
  const adapter = (f: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) => minimaxVideoAdapter({ fetchImpl: f.fetch, pollMs: 0, ...extra })

  it('is the engine adapter, with the MiniMax voice adapter’s vault entry', () => {
    expect(minimaxVideoAdapter()).toMatchObject({ id: 'clip:minimax-h3-lite', kind: 'real', secretName: 'MINIMAX_API_KEY' })
    expect(typeof minimaxVideoAdapter().generateVideo).toBe('function')
  })

  it('submits the first frame, polls, stores the task id before the first poll, downloads without the key, bills the seconds made', async () => {
    const f = route(['queued', 'running'])
    const { ctx, refs } = ctxWith()
    const out = await runUsage(adapter(f), 'generateVideo', clip({ imageArtefactId: 'art_still', seconds: 5, negative: 'flou' }), ctx)
    const [create] = f.calls
    expect(create).toMatchObject({ method: 'POST', url: 'https://api.minimax.io/v2/video_generation' })
    expect(create?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(body(create)).toEqual({
      model: 'MiniMax-H3-Lite',
      content: [
        { type: 'text', text: 'les vagues montent\n\nAvoid: flou' },
        { type: 'image_url', image_url: { url: ART.art_still }, role: 'first_frame' }
      ],
      resolution: '768P',
      duration: 6, // 5 s asked: the next length the engine makes (6 or 10)
      ratio: '16:9'
    })
    expect(f.calls.filter((c) => c.method === 'GET' && c.url.includes('/v2/query/video_generation/4242'))).toHaveLength(3)
    expect(f.calls.at(-1)).toMatchObject({ method: 'GET', url: VIDEO })
    expect(f.calls.at(-1)?.headers.authorization).toBeUndefined()
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ id: '4242' })
    expect(refs.at(-1)).toBeNull()
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    expect(out.costUsd).toBeCloseTo(6 * 0.04, 10)
    expect(clipLengthFor('clip:minimax-h3-lite', 7)).toBe(10)
  })

  it('without a still it is text to video; a retry resumes the stored task without a second submission', async () => {
    const f = route([])
    await runUsage(adapter(f), 'generateVideo', clip(), ctxWith().ctx)
    expect(body(f.calls[0]).content).toHaveLength(1)
    const again = route([])
    const out = await runUsage(adapter(again), 'generateVideo', clip(), ctxWith(KEY, JSON.stringify({ id: '4242' })).ctx)
    expect(again.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(out.files).toHaveLength(1)
  })

  it('a sensitive-content refusal (422 on the submission, or a failed task) is « refused: »; other failures are plain', async () => {
    const sensitive = route([], { create: json({ type: 'error', error: { type: 'unprocessable_entity_error', message: 'Video description contains sensitive content (1026)', http_code: '422' } }, 422) })
    const a = await outcome(runUsage(adapter(sensitive), 'generateVideo', clip(), ctxWith().ctx))
    expect(a.message).toMatch(/^refused: /)
    expect(a).not.toBeInstanceOf(RetryableProviderError)
    const failedTask = route(['running', 'failed'], { failure: { code: 1026, message: 'video description contains sensitive content' } })
    const b = await outcome(runUsage(adapter(failedTask), 'generateVideo', clip(), ctxWith().ctx))
    expect(b.message).toMatch(/^refused: /)
    const other = route(['failed'])
    const c = await outcome(runUsage(adapter(other), 'generateVideo', clip(), ctxWith().ctx))
    expect(c.message).not.toMatch(/^refused/)
    expect(c).not.toBeInstanceOf(RetryableProviderError)
  })

  it('429 and 5xx retry, 401 is fatal without the key, a poll that outlasts the wait leaves the ref for the retry, abandon cancels a queued task', async () => {
    for (const status of [429, 500]) {
      const f = fakeFetch(() => new Response('{}', { status }))
      expect(await outcome(runUsage(adapter(f), 'generateVideo', clip(), ctxWith().ctx))).toBeInstanceOf(RetryableProviderError)
    }
    const denied = fakeFetch(() => new Response(`{"type":"error","error":{"type":"authorized_error","message":"${KEY} (1004)"}}`, { status: 401 }))
    const err = await outcome(runUsage(adapter(denied), 'generateVideo', clip(), ctxWith().ctx))
    expect(err.message).toMatch(/401/)
    expect(err.message).not.toContain(KEY)

    const forever = route(Array(50).fill('running'))
    const first = ctxWith()
    expect(await outcome(runUsage(adapter(forever, { pollMs: 1, maxWaitMs: 5 }), 'generateVideo', clip(), first.ctx))).toBeInstanceOf(RetryableProviderError)
    expect(first.refs).toEqual([JSON.stringify({ id: '4242' })])

    const f = route([])
    const a = adapter(f)
    await runUsage(a, 'generateVideo', clip(), ctxWith().ctx)
    await a.abandon?.(JSON.stringify({ id: '4242' }))
    expect(f.calls.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://api.minimax.io/v2/video_generation/4242' })
  })
})

describe('Veo 3.1 Lite on Vertex (clip:veo31-lite-vertex)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const SA = JSON.stringify({
    type: 'service_account',
    client_email: 'atelier@proj-1.iam.gserviceaccount.com',
    project_id: 'proj-1',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  })
  const OP = 'projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-lite-generate-001/operations/op-9'
  const MODEL = 'https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-lite-generate-001'
  const route = (polls: unknown[]) => {
    const seen = [...polls]
    return fakeFetch((req) => {
      if (req.url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'ya29.test-token', expires_in: 3600 })
      if (req.url.endsWith(':predictLongRunning')) return json({ name: OP })
      if (req.url.endsWith(':fetchPredictOperation')) return json((seen.shift() ?? { done: true, response: { videos: [{ bytesBase64Encoded: MP4.toString('base64'), mimeType: 'video/mp4' }] } }) as object)
      return isArtefact(req) ? png() : mp4()
    })
  }
  const adapter = (f: ReturnType<typeof fakeFetch>) => veoVertexAdapter({ fetchImpl: f.fetch, pollMs: 0 })

  it('exchanges a signed JWT for a token, sends the start still inline, no audio, polls the operation, bills the length made', async () => {
    const f = route([{ done: false }])
    const { ctx, refs } = ctxWith(SA)
    const out = await runUsage(adapter(f), 'generateVideo', clip({ imageArtefactId: 'art_still', seconds: 5, negative: 'texte' }), ctx)
    const token = f.calls.find((c) => c.url === 'https://oauth2.googleapis.com/token')
    expect(token?.method).toBe('POST')
    const form = new URLSearchParams(token?.body)
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [h, c, s] = (form.get('assertion') ?? '').split('.') as [string, string, string]
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({ iss: 'atelier@proj-1.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token' })
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true)

    const submit = f.calls.find((x) => x.url.endsWith(':predictLongRunning'))
    expect(submit?.url).toBe(`${MODEL}:predictLongRunning`)
    expect(submit?.headers.authorization).toBe('Bearer ya29.test-token')
    expect(body(submit)).toEqual({
      instances: [{ prompt: 'les vagues montent', image: { bytesBase64Encoded: PNG.toString('base64'), mimeType: 'image/png' } }],
      parameters: { aspectRatio: '16:9', durationSeconds: 6, sampleCount: 1, resolution: '720p', generateAudio: false, negativePrompt: 'texte' }
    })
    const polls = f.calls.filter((x) => x.url.endsWith(':fetchPredictOperation'))
    expect(polls).toHaveLength(2)
    expect(body(polls[0])).toEqual({ operationName: OP })
    expect(f.calls.filter((x) => x.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1) // the token is kept
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ op: OP })
    expect(refs.at(-1)).toBeNull()
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    expect(Buffer.from(out.files[0]?.bytes ?? []).equals(MP4)).toBe(true)
    expect(out.costUsd).toBeCloseTo(6 * 0.03, 10)
    expect(out.data).toMatchObject({ audio: false, seconds: 6 })
  })

  it('text to video has no image; a vault value that is not a service account key fails clearly; a retry resumes the operation', async () => {
    const f = route([])
    await runUsage(adapter(f), 'generateVideo', clip(), ctxWith(SA).ctx)
    expect(body(f.calls.find((x) => x.url.endsWith(':predictLongRunning'))).instances[0]).toEqual({ prompt: 'les vagues montent' })
    const bad = await outcome(runUsage(adapter(route([])), 'generateVideo', clip(), ctxWith('not json').ctx))
    expect(bad.message).toMatch(/service account/)
    expect(bad.message).not.toContain('not json')
    const again = route([])
    await runUsage(adapter(again), 'generateVideo', clip(), ctxWith(SA, JSON.stringify({ op: OP })).ctx)
    expect(again.calls.some((x) => x.url.endsWith(':predictLongRunning'))).toBe(false)
  })

  it('a filtered clip or a policy error is « refused: »; 429/5xx retry; 401 is fatal', async () => {
    const filtered = route([{ done: true, response: { videos: [], raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['Support code 58061214'] } }])
    const a = await outcome(runUsage(adapter(filtered), 'generateVideo', clip(), ctxWith(SA).ctx))
    expect(a.message).toMatch(/^refused: /)
    expect(a).not.toBeInstanceOf(RetryableProviderError)
    const blocked = route([{ done: true, error: { code: 3, message: 'The prompt was blocked by the safety filters.' } }])
    expect((await outcome(runUsage(adapter(blocked), 'generateVideo', clip(), ctxWith(SA).ctx))).message).toMatch(/^refused: /)
    const submitRefused = fakeFetch((req) => (req.url.endsWith('/token') ? json({ access_token: 't' }) : json({ error: { status: 'INVALID_ARGUMENT', message: 'Prompt violates our content policy' } }, 400)))
    expect((await outcome(runUsage(adapter(submitRefused), 'generateVideo', clip(), ctxWith(SA).ctx))).message).toMatch(/^refused: /)
    for (const status of [429, 503]) {
      const down = fakeFetch((req) => (req.url.endsWith('/token') ? json({ access_token: 't' }) : new Response('{}', { status })))
      expect(await outcome(runUsage(adapter(down), 'generateVideo', clip(), ctxWith(SA).ctx))).toBeInstanceOf(RetryableProviderError)
    }
    const denied = fakeFetch((req) => (req.url.endsWith('/token') ? json({ access_token: 't' }) : new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })))
    const err = await outcome(runUsage(adapter(denied), 'generateVideo', clip(), ctxWith(SA).ctx))
    expect(err).not.toBeInstanceOf(RetryableProviderError)
    expect(err.message).toMatch(/403.*PERMISSION_DENIED/)
  })
})

describe('Veo 3.1 through unifically.com (clip:veo31-lite-relaxed, -lite, -fast, -fast-1080p)', () => {
  const VIDEO = 'https://cdn.unifically.com/outputs/abc123.mp4'
  const route = (polls: Record<string, unknown>[], create?: Response) => {
    const seen = [...polls]
    return fakeFetch((req) => {
      if (req.method === 'PUT' && req.url === 'https://files.unifically.com/upload') return json({ success: true, file_url: 'https://files.unifically.com/image/still.png' })
      if (req.method === 'POST') return create ?? json({ code: 200, success: true, data: { task_id: 'abc123', status: 'processing' } })
      if (req.url === 'https://api.unifically.com/v1/tasks/abc123') {
        return json({ code: 200, success: true, data: seen.shift() ?? { task_id: 'abc123', status: 'completed', output: { video_url: VIDEO } } })
      }
      return req.url.startsWith(`${CLOUD}/`) ? png() : mp4()
    })
  }
  const engines = [
    ['clip:veo31-lite-relaxed', 'google/veo-3.1-lite-relaxed', 0.075, '720p'],
    ['clip:veo31-lite', 'google/veo-3.1-lite', 0.15, '720p'],
    ['clip:veo31-fast', 'google/veo-3.1-fast', 0.3, '720p'],
    ['clip:veo31-fast-1080p', 'google/veo-3.1-fast', 0.325, '1080p']
  ] as const

  it.each(engines)('%s: its own model, the start image, 4/6/8 s, its resolution, billed per clip at the registry line', async (id, model, price, resolution) => {
    const f = route([{ task_id: 'abc123', status: 'processing' }])
    const { ctx, refs } = ctxWith()
    const out = await runUsage(unificallyAdapter({ id, fetchImpl: f.fetch, pollMs: 0 }), 'generateVideo', clip({ imageArtefactId: 'art_still', seconds: 5, negative: 'texte', aspect: '9:16' }), ctx)
    // the start still goes to unifically's storage first (its workers could not read the beta's links)
    expect(f.calls[0]).toMatchObject({ method: 'GET', url: ART.art_still })
    expect(f.calls[1]).toMatchObject({ method: 'PUT', url: 'https://files.unifically.com/upload' })
    const create = f.calls.find((c) => c.method === 'POST')
    expect(create).toMatchObject({ method: 'POST', url: 'https://api.unifically.com/v1/tasks' })
    expect(create?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(body(create)).toEqual({
      model,
      input: { prompt: 'les vagues montent\n\nAvoid: texte', start_image_url: 'https://files.unifically.com/image/still.png', duration: 6, aspect_ratio: '9:16', resolution, allow_audio_filtered: true }
    })
    expect(f.calls.at(-1)).toMatchObject({ method: 'GET', url: VIDEO })
    expect(f.calls.at(-1)?.headers.authorization).toBeUndefined()
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ op: 'abc123' })
    expect(refs.at(-1)).toBeNull()
    expect(out.costUsd).toBeCloseTo(price, 10)
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    expect([unificallyAdapter({ id }).secretName, out.data.resolution]).toEqual(['UNIFICALLY_API_KEY', resolution])
  })

  it('without a still there is no start image; a retry resumes the task', async () => {
    const f = route([])
    await runUsage(unificallyAdapter({ id: 'clip:veo31-fast', fetchImpl: f.fetch, pollMs: 0 }), 'generateVideo', clip(), ctxWith().ctx)
    expect(body(f.calls[0]).input).not.toHaveProperty('start_image_url')
    const again = route([])
    await runUsage(unificallyAdapter({ id: 'clip:veo31-fast', fetchImpl: again.fetch, pollMs: 0 }), 'generateVideo', clip(), ctxWith(KEY, JSON.stringify({ op: 'abc123' })).ctx)
    expect(again.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('a failed task is « refused: » when it speaks of policy, plain otherwise; 429/5xx retry; 402/401 are fatal; the wait is bounded', async () => {
    const adapter = (f: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) => unificallyAdapter({ id: 'clip:veo31-lite', fetchImpl: f.fetch, pollMs: 0, rateWaitsMs: [0, 0, 0], ...extra })
    const policy = await outcome(runUsage(adapter(route([{ status: 'failed', error_message: 'Blocked by content safety policy' }])), 'generateVideo', clip(), ctxWith().ctx))
    expect(policy.message).toMatch(/^refused: /)
    expect(policy).not.toBeInstanceOf(RetryableProviderError)
    const plain = await outcome(runUsage(adapter(route([{ status: 'failed', error_message: 'upstream exploded' }])), 'generateVideo', clip(), ctxWith().ctx))
    expect(plain.message).not.toMatch(/^refused/)
    expect(plain).not.toBeInstanceOf(RetryableProviderError)
    const submitRefused = await outcome(runUsage(adapter(route([], json({ success: false, code: 400, data: { message: 'Prompt rejected by moderation' } }, 400))), 'generateVideo', clip(), ctxWith().ctx))
    expect(submitRefused.message).toMatch(/^refused: /)
    for (const status of [429, 500]) {
      const f = fakeFetch(() => new Response('{}', { status }))
      expect(await outcome(runUsage(adapter(f), 'generateVideo', clip(), ctxWith().ctx))).toBeInstanceOf(RetryableProviderError)
    }
    const nomoney = await outcome(runUsage(adapter(fakeFetch(() => new Response('{"success":false,"code":402,"data":{"message":"low"}}', { status: 402 }))), 'generateVideo', clip(), ctxWith().ctx))
    expect(nomoney).not.toBeInstanceOf(RetryableProviderError)
    expect(nomoney.message).toMatch(/402/)
    const forever = route(Array(50).fill({ task_id: 'abc123', status: 'processing' }))
    const first = ctxWith()
    expect(await outcome(runUsage(adapter(forever, { pollMs: 1, maxWaitMs: 5 }), 'generateVideo', clip(), first.ctx))).toBeInstanceOf(RetryableProviderError)
    expect(first.refs).toEqual([JSON.stringify({ op: 'abc123' })])
  })
})

describe('quotes that name a still or clip engine', () => {
  it('an image or clip engine is quoted and run on its usage (its fake here); an engine of another usage is refused', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const image = await quoteAndRun(t, p, 'generateImage', { prompt: 'a pan', width: 640, height: 360, engine: 'image:gpt-image-25-low', negative: 'text' })
    expect(image.job).toMatchObject({ state: 'succeeded', demo: true })
    const clipJob = await quoteAndRun(t, p, 'generateVideo', { prompt: 'a pan', seconds: 8, aspect: '16:9', engine: 'clip:veo31-lite-relaxed' })
    expect(clipJob.job).toMatchObject({ state: 'succeeded', demo: true })
    const wrong = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateImage', input: { prompt: 'x', engine: 'clip:wan22' } } })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.body).toMatch(/input.engine/)
    // a reference must be one of the team's files
    const foreign = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateImage', input: { prompt: 'x', referenceArtefactIds: ['nope'] } } })
    expect(foreign.statusCode).toBe(404)
  })
})
