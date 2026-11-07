// production-10: GPT Image 2.5 on fal.ai (image:gpt-image-25-fal-low / -medium) against a fake fetch: the exact request of the text
// and edit endpoints, the key to fal.run only, the size asked, the quality of each engine, the cost of its line, a content refusal,
// 401 / 429 / 5xx and the key never in a message. Never the network, never a real key.
import { describe, expect, it } from 'vitest'
import { FAL_GPT_IMAGE_EDIT_ENDPOINT, FAL_GPT_IMAGE_ENDPOINT, falDetail, falGptImageAdapter, type FalGptImageEngine } from '../src/providers/fal-image.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'

const KEY = 'fal-image-test-SECRET-91be4c27'
const RUN = 'https://fal.run'
const CDN = 'https://v3.fal.media/files/elephant'
const FILES = 'https://cloud.example/files'
const ART: Record<string, string> = { art_a: `${FILES}/art_a?exp=1&sig=aa`, art_b: `${FILES}/art_b?exp=1&sig=bb` }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7])

const ctx = (): ProviderContext => ({
  ...ctxFor(KEY),
  artefactUrl: (id) => {
    const u = ART[id]
    if (!u) throw new Error('not found')
    return u
  }
})
const answer = (n = 1): Response => json({ images: Array.from({ length: n }, (_, i) => ({ url: `${CDN}/out-${i + 1}.png`, content_type: 'image/png', width: 1280, height: 720 })) })
const route = (api: () => Response) => fakeFetch((req) => (req.url.startsWith(CDN) ? new Response(PNG, { headers: { 'content-type': 'image/png' } }) : api()))
const body = (r: Recorded | undefined): Record<string, any> => JSON.parse(r?.body ?? '{}') as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)
const run = (id: FalGptImageEngine, f: { fetch: typeof fetch }, over: Record<string, unknown> = {}) =>
  runUsage(falGptImageAdapter({ id, fetchImpl: f.fetch }), 'generateImage', { prompt: 'un phare sous la tempête', width: 1280, height: 720, count: 1, ...over }, ctx())

describe('GPT Image 2.5 on fal (image:gpt-image-25-fal-low / -medium)', () => {
  it('text to image: the flare endpoint, Key auth to fal.run only, size, quality, count, « Avoid: », downloads bare, cost per picture', async () => {
    const f = route(() => answer(2))
    const a = falGptImageAdapter({ id: 'image:gpt-image-25-fal-low', fetchImpl: f.fetch })
    expect(a).toMatchObject({ id: 'image:gpt-image-25-fal-low', kind: 'real', secretName: 'FAL_KEY' })
    const out = await run('image:gpt-image-25-fal-low', f, { count: 2, negative: 'du texte' })
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${RUN}/${FAL_GPT_IMAGE_ENDPOINT}`, `GET ${CDN}/out-1.png`, `GET ${CDN}/out-2.png`])
    expect(FAL_GPT_IMAGE_ENDPOINT).toBe('openai/gpt-image-2.5/flare/text-to-image')
    expect(body(f.calls[0])).toEqual({ prompt: 'un phare sous la tempête\n\nAvoid: du texte', image_size: { width: 1280, height: 720 }, quality: 'low', num_images: 2, output_format: 'png' })
    for (const c of f.calls) expect(c.headers.authorization, c.url).toBe(c.url.startsWith(RUN) ? `Key ${KEY}` : undefined)
    expect(JSON.stringify(f.calls.map((c) => c.url))).not.toContain(KEY)
    expect(out.files.map((x) => x.name)).toEqual(['image-1.png', 'image-2.png'])
    expect(Buffer.from(out.files[0]?.bytes ?? []).equals(PNG)).toBe(true)
    expect(out.data).toMatchObject({ engine: 'image:gpt-image-25-fal-low', quality: 'low', size: '1280x720', references: 0 })
    expect(out.costUsd).toBeCloseTo(2 * 0.006, 10)
    const medium = route(() => answer())
    const m = await run('image:gpt-image-25-fal-medium', medium, { width: 64, height: 64 })
    expect(body(medium.calls[0])).toMatchObject({ quality: 'medium', image_size: { width: 816, height: 816 } }) // raised into OpenAI's pixel budget
    expect(m.costUsd).toBeCloseTo(0.0133, 10)
  })

  it('with references: the sunburst edit endpoint with image_urls = our signed links (never fetched here, never given the key)', async () => {
    const f = route(() => answer())
    const out = await run('image:gpt-image-25-fal-medium', f, { referenceArtefactIds: ['art_a', 'art_b'], width: 720, height: 1280 })
    expect(f.calls[0]?.url).toBe(`${RUN}/${FAL_GPT_IMAGE_EDIT_ENDPOINT}`)
    expect(FAL_GPT_IMAGE_EDIT_ENDPOINT).toBe('openai/gpt-image-2.5/sunburst/edit')
    expect(body(f.calls[0])).toMatchObject({ image_urls: [ART.art_a, ART.art_b], image_size: { width: 720, height: 1280 }, quality: 'medium' })
    expect(f.calls.some((c) => c.url.startsWith(FILES))).toBe(false)
    expect(out.data).toMatchObject({ references: 2, model: FAL_GPT_IMAGE_EDIT_ENDPOINT })
  })

  it('a content-policy 422 is « refused: », not retried; another 422 is a plain failure', async () => {
    const refused = await outcome(run('image:gpt-image-25-fal-low', route(() => json({ detail: [{ loc: ['body', 'prompt'], msg: 'flagged', type: 'content_policy_violation' }] }, 422))))
    expect(refused.message).toMatch(/^refused: /)
    expect(refused).not.toBeInstanceOf(RetryableProviderError)
    const bad = await outcome(run('image:gpt-image-25-fal-low', route(() => json({ detail: [{ loc: ['body', 'image_size'], msg: 'bad size', type: 'value_error' }] }, 422))))
    expect(bad.message).toMatch(/422.*value_error/)
    expect(bad.message).not.toMatch(/^refused/)
    expect(falDetail('{"detail":"Not enough credits"}')).toBe('Not enough credits')
  })

  it('429 and 5xx retry, 401 is fatal and never shows the key, an answer without a picture retries, an undownloadable one fails', async () => {
    expect(await outcome(run('image:gpt-image-25-fal-low', route(() => new Response('{}', { status: 429 }))))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run('image:gpt-image-25-fal-low', route(() => new Response('{}', { status: 502 }))))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run('image:gpt-image-25-fal-low', route(() => json({ images: [] }))))).toBeInstanceOf(RetryableProviderError)
    const key = await outcome(run('image:gpt-image-25-fal-low', route(() => json({ detail: `Invalid key ${KEY}` }, 401))))
    expect(key).not.toBeInstanceOf(RetryableProviderError)
    expect(key.message).toMatch(/401/)
    expect(key.message).not.toContain(KEY)
    const html = fakeFetch((req) => (req.url.startsWith(CDN) ? new Response('<html>', { headers: { 'content-type': 'text/html' } }) : answer()))
    expect((await outcome(run('image:gpt-image-25-fal-low', html))).message).toMatch(/could not be downloaded/)
  })
})
