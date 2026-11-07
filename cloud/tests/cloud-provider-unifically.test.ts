// vrais-tests: the cheap still and clip models on unifically.com (one adapter per engine, providers/unifically.ts) and the budget-capped
// `providers bench-visual` command (providers/try-visual.ts), against a fake fetch: never the network, never a cent.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLIP_ENGINES, IMAGE_ENGINES } from '../../src/shared/visual-engines.ts'
import { FAKE_ENGINES } from '../src/providers/engines.ts'
import { benchEstimateUsd, benchVisual } from '../src/providers/try-visual.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { nearestAspect, UNIFICALLY_CLIPS, UNIFICALLY_IMAGES, UNIFICALLY_MODEL_ENGINES, unificallyModelAdapter, type UnificallyModelEngine } from '../src/providers/unifically.ts'
import { unificallyLedger } from '../src/providers/unifically-ledger.ts'
import { visualEngineAdapters } from '../src/providers/visual-engines.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

const KEY = 'unifically-test-SECRET-81c4d2aa'
const PROD = { NODE_ENV: 'production' }
const API = 'https://api.unifically.com/v1/tasks'
const CDN = 'https://cdn.unifically.com/outputs'
const UPLOAD = 'https://files.unifically.com/upload'
const FILES = 'https://files.unifically.com/image'
/** Where a team picture lands once uploaded to unifically's storage (the fake names it after the artefact). */
const UP = (id: string): string => `${FILES}/${id}.png`
const ART: Record<string, string> = { art_still: 'https://cloud.example/files/art_still?sig=s', art_a: 'https://cloud.example/files/art_a?sig=a', art_b: 'https://cloud.example/files/art_b?sig=b' }

const body = (r: Recorded | undefined): Record<string, any> => JSON.parse(r?.body ?? '{}') as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)

function ctxWith(saved: string | null = null): { ctx: ProviderContext; refs: (string | null)[] } {
  const refs: (string | null)[] = []
  return {
    refs,
    ctx: {
      ...ctxFor(KEY),
      artefactUrl: (id) => ART[id] ?? (() => { throw new Error('not found') })(),
      providerRef: () => saved,
      setProviderRef: (r) => {
        saved = r
        refs.push(r)
      }
    }
  }
}

/** A fake unifically: the dry run answers `cost` (or `dry` itself), the task completes after `polls` processing answers. */
function route(o: { cost?: number; dry?: Response; polls?: Record<string, unknown>[]; output?: Record<string, unknown> } = {}) {
  const seen = [...(o.polls ?? [])]
  return fakeFetch((req) => {
    if (req.method === 'PUT' && req.url === UPLOAD) return json({ success: true, file_url: `${FILES}/${String(req.form?.file && typeof req.form.file === 'object' ? req.form.file.name : 'x')}` })
    if (req.method === 'POST' && req.url === API) {
      if (body(req).dry_run === true) return o.dry ?? json({ code: 200, success: true, data: { cost: o.cost ?? 0.042 } })
      return json({ code: 200, success: true, data: { task_id: 't1', status: 'processing' } })
    }
    if (req.url === `${API}/t1`) return json({ code: 200, success: true, data: seen.shift() ?? { task_id: 't1', status: 'completed', output: o.output ?? { video_url: `${CDN}/v.mp4` } } })
    if (req.url.endsWith('.mp4')) return new Response(Buffer.alloc(64, 1), { status: 200, headers: { 'content-type': 'video/mp4' } })
    return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), { status: 200, headers: { 'content-type': 'image/png' } })
  })
}

describe('the unifically model engines', () => {
  it('each is a declared engine of its usage, served by its own adapter on UNIFICALLY_API_KEY', () => {
    expect(UNIFICALLY_MODEL_ENGINES.sort()).toEqual([...Object.keys(UNIFICALLY_IMAGES), ...Object.keys(UNIFICALLY_CLIPS)].sort())
    const adapters = new Map(visualEngineAdapters().map((a) => [a.id, a]))
    for (const id of UNIFICALLY_MODEL_ENGINES) {
      expect([...IMAGE_ENGINES, ...CLIP_ENGINES] as string[]).toContain(id)
      expect(FAKE_ENGINES.find((e) => e.id === id)?.usage).toBe(id.startsWith('clip:') ? 'generateVideo' : 'generateImage')
      expect(adapters.get(id)?.secretName).toBe('UNIFICALLY_API_KEY')
    }
  })

  it('the nearest aspect ratio a model takes', () => {
    expect(nearestAspect(1280, 720, ['1:1', '16:9', '9:16'])).toBe('16:9')
    expect(nearestAspect(720, 1280, ['1:1', '16:9', '9:16'])).toBe('9:16')
    expect(nearestAspect(1000, 1000, ['4:3', '1:1'])).toBe('1:1')
  })
})

describe('clips through unifically: the dry-run price, then the task, silent, from the start still', () => {
  const cases: [UnificallyModelEngine, number, Record<string, unknown>][] = [
    ['clip:grok-imagine-15-lite', 4, { model: 'xai/grok-imagine-1.5-lite-video', input: { prompt: 'p\n\nAvoid: texte', duration: 4, resolution: '720p', audio: false, start_image_url: UP('art_still') } }],
    ['clip:seedance-20-mini-480p', 4, { model: 'bytedance/seedance-2.0-mini', input: { prompt: 'p\n\nAvoid: texte', duration: 4, resolution: '480p', generate_audio: false, first_frame_url: UP('art_still') } }],
    ['clip:seedance-20-mini', 4, { model: 'bytedance/seedance-2.0-mini', input: { prompt: 'p\n\nAvoid: texte', duration: 4, resolution: '720p', generate_audio: false, first_frame_url: UP('art_still') } }],
    ['clip:seedance-15-pro', 4, { model: 'bytedance/seedance-1.5-pro', input: { prompt: 'p\n\nAvoid: texte', duration: 4, resolution: '720p', generate_audio: false, first_frame_url: UP('art_still') } }],
    ['clip:hailuo-23-fast', 6, { model: 'hailuo/minimax-2.3-fast', input: { prompt: 'p\n\nAvoid: texte', duration: 6, resolution: '768p', start_frame_url: UP('art_still') } }],
    ['clip:kling-25-turbo', 5, { model: 'kuaishou/kling-2.5-turbo-video', input: { prompt: 'p\n\nAvoid: texte', mode: 'std', duration: 5, start_frame_url: UP('art_still') } }]
  ]
  it.each(cases)('%s', async (id, seconds, expected) => {
    const f = route({ cost: 0.061, polls: [{ status: 'processing' }] })
    const { ctx, refs } = ctxWith()
    const out = await runUsage(unificallyModelAdapter({ id, fetchImpl: f.fetch, pollMs: 0 }), 'generateVideo', { prompt: 'p', negative: 'texte', seconds: 4, aspect: '16:9', imageArtefactId: 'art_still' }, ctx)
    const [download, upload, dry, create] = f.calls
    // the start still is read through the Cloud's signed link, then put in unifically's storage with the key
    expect(download).toMatchObject({ method: 'GET', url: ART.art_still })
    expect(download?.headers.authorization).toBeUndefined()
    expect(upload).toMatchObject({ method: 'PUT', url: UPLOAD })
    expect(upload?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(dry?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(body(dry)).toEqual({ ...expected, dry_run: true })
    expect(body(create)).toEqual(expected)
    expect(out.costUsd).toBe(0.061)
    expect(out.data).toMatchObject({ engine: id, seconds, quotedUsd: 0.061 })
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    // the CDN link gets no key; the task id is kept while it runs and dropped once downloaded
    expect(f.calls.at(-1)?.headers.authorization).toBeUndefined()
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ op: 't1', cost: 0.061 })
    expect(refs.at(-1)).toBeNull()
  })

  it('without a still the clip is text to video in the film aspect; a retry resumes the task without paying again', async () => {
    const f = route()
    await runUsage(unificallyModelAdapter({ id: 'clip:grok-imagine-15-lite', fetchImpl: f.fetch, pollMs: 0 }), 'generateVideo', { prompt: 'p', seconds: 3, aspect: '9:16' }, ctxWith().ctx)
    expect(body(f.calls.find((c) => c.method === 'POST' && body(c).dry_run !== true)).input).toEqual({ prompt: 'p', duration: 3, resolution: '720p', audio: false, aspect_ratio: '9:16' })
    const again = route()
    const out = await runUsage(unificallyModelAdapter({ id: 'clip:grok-imagine-15-lite', fetchImpl: again.fetch, pollMs: 0 }), 'generateVideo', { prompt: 'p', seconds: 3, aspect: '16:9' }, ctxWith(JSON.stringify({ op: 't1', cost: 0.03 })).ctx)
    expect(again.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(out.costUsd).toBe(0.03)
  })

  it('a dry run that does not answer falls back to the registry line × seconds', async () => {
    const f = route({ dry: new Response('{}', { status: 503 }) })
    const out = await runUsage(unificallyModelAdapter({ id: 'clip:seedance-15-pro', fetchImpl: f.fetch, pollMs: 0 }), 'generateVideo', { prompt: 'p', seconds: 5, aspect: '16:9' }, ctxWith().ctx)
    expect(out.costUsd).toBeCloseTo(5 * (FAKE_ENGINES.find((e) => e.id === 'clip:seedance-15-pro')?.costUsdPerUnit ?? 0), 10)
    expect(out.data.quotedUsd).toBeNull()
  })

  it('a refused prompt or task is « refused: », a bad key is fatal, an endless task is retryable', async () => {
    const adapter = (f: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) => unificallyModelAdapter({ id: 'clip:kling-25-turbo', fetchImpl: f.fetch, pollMs: 0, ...extra })
    const input = { prompt: 'p', seconds: 5, aspect: '16:9' as const }
    const policy = await outcome(runUsage(adapter(route({ polls: [{ status: 'failed', error_message: 'NSFW content detected' }] })), 'generateVideo', input, ctxWith().ctx))
    expect(policy.message).toMatch(/^refused: /)
    const dryRefused = await outcome(runUsage(adapter(route({ dry: json({ success: false, code: 400, data: { message: 'Prompt blocked by moderation' } }, 400) })), 'generateVideo', input, ctxWith().ctx))
    expect(dryRefused.message).toMatch(/^refused: /)
    const badKey = await outcome(runUsage(adapter(fakeFetch(() => json({ success: false, code: 401, data: { message: 'bad key' } }, 401))), 'generateVideo', input, ctxWith().ctx))
    expect(badKey).not.toBeInstanceOf(RetryableProviderError)
    const endless = await outcome(runUsage(adapter(route({ polls: Array(30).fill({ status: 'processing' }) }), { pollMs: 1, maxWaitMs: 3 }), 'generateVideo', input, ctxWith().ctx))
    expect(endless).toBeInstanceOf(RetryableProviderError)
  })
})

describe('unifically rate limit', () => {
  it('a 429 is waited out a few times, then the job sees a retryable error', async () => {
    let limited = 2
    const base = route({ cost: 0.01 })
    const f = fakeFetch((req) => (req.method === 'POST' && limited-- > 0 ? json({ success: false, code: 429, data: { message: 'Rate limit exceeded' } }, 429) : base.fetch(req.url, { method: req.method, headers: req.headers, body: req.body }) as Promise<Response>))
    const out = await runUsage(unificallyModelAdapter({ id: 'clip:grok-imagine-15-lite', fetchImpl: f.fetch, pollMs: 0, rateWaitsMs: [0, 0, 0] }), 'generateVideo', { prompt: 'p', seconds: 2, aspect: '16:9' }, ctxWith().ctx)
    expect(out.costUsd).toBe(0.01)
    const always = fakeFetch(() => json({ success: false, code: 429, data: { message: 'Rate limit exceeded' } }, 429))
    const err = await outcome(runUsage(unificallyModelAdapter({ id: 'clip:grok-imagine-15-lite', fetchImpl: always.fetch, pollMs: 0, rateWaitsMs: [0, 0, 0] }), 'generateVideo', { prompt: 'p', seconds: 2, aspect: '16:9' }, ctxWith().ctx))
    expect(err).toBeInstanceOf(RetryableProviderError)
    // the free dry run tries 4 times then gives up (its price is only a nicety), the submission tries 4 times then fails retryable
    expect(always.calls).toHaveLength(8)
  })
})

describe('stills through unifically', () => {
  it('the aspect, the references (at most 4), the image link, the quoted price per picture', async () => {
    const f = route({ cost: 0.0072, output: { image_url: `${CDN}/i.png` } })
    const out = await runUsage(unificallyModelAdapter({ id: 'image:flux3-klein', fetchImpl: f.fetch, pollMs: 0 }), 'generateImage', { prompt: 'p', width: 1280, height: 720, count: 2, referenceArtefactIds: ['art_a', 'art_b'] }, ctxWith().ctx)
    expect(body(f.calls.find((c) => c.method === 'POST' && body(c).dry_run !== true))).toEqual({ model: 'black-forest-labs/flux-3-image-klein', input: { prompt: 'p', aspect_ratio: '16:9', resolution: '1mp', image_urls: [UP('art_a'), UP('art_b')] } })
    expect(out.files.map((x) => x.name)).toEqual(['image-1.png', 'image-2.png'])
    expect(out.costUsd).toBeCloseTo(0.0144, 10)
  })

  it('Z-Image is text only and cut to 800 characters; Seedream asks the shape in its prompt; image_urls outputs are read', async () => {
    const z = route({ output: { image_urls: [`${CDN}/z.png`] } })
    await runUsage(unificallyModelAdapter({ id: 'image:z-image-turbo', fetchImpl: z.fetch, pollMs: 0 }), 'generateImage', { prompt: 'x'.repeat(900), width: 1280, height: 720, count: 1, referenceArtefactIds: ['art_a'] }, ctxWith().ctx)
    expect(body(z.calls.find((c) => c.method === 'POST' && body(c).dry_run !== true)).input).toEqual({ prompt: 'x'.repeat(800), aspect_ratio: '16:9' })
    const s = route({ output: { image_url: `${CDN}/s.png` } })
    await runUsage(unificallyModelAdapter({ id: 'image:seedream-50-lite', fetchImpl: s.fetch, pollMs: 0 }), 'generateImage', { prompt: 'p', width: 1280, height: 720, count: 1 }, ctxWith().ctx)
    expect(body(s.calls.find((c) => c.method === 'POST' && body(c).dry_run !== true)).input).toEqual({ prompt: 'p\n\nWide 16:9 frame.', resolution: '2K', output_format: 'jpeg', web_search: false })
  })
})

describe('providers bench-visual', () => {
  async function setup(engines: string[]) {
    const f = route({ cost: 0.05, output: { video_url: `${CDN}/v.mp4` } })
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: visualEngineAdapters({ fetchImpl: f.fetch, pollMs: 0 }), engines })
    t.cloud.vault.set('UNIFICALLY_API_KEY', KEY, 'test')
    await signUpAndIn(t, { credits: 10 })
    writeFileSync(join(t.dir, 'still.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    return { t, f }
  }
  const plan = (dir: string, items: unknown[]): string => {
    const p = join(dir, 'plan.json')
    writeFileSync(p, JSON.stringify(items))
    return p
  }
  const lines: string[] = []
  const say = (l: string): void => void lines.push(l)

  it('refuses an engine that is not live: nothing is called', async () => {
    const { t, f } = await setup([])
    const p = plan(t.dir, [{ name: 'a', engine: 'clip:grok-imagine-15-lite', prompt: 'p', image: 'still.png' }])
    const err = await outcome(benchVisual(t.cloud, { plan: p, out: join(t.dir, 'out') }, 'cli', 'https://cloud.example', say))
    expect(err.message).toMatch(/not live/)
    expect(f.calls).toEqual([])
  })

  it('runs the calls, records the real cost, skips what the budget cannot cover, never pays a done name twice', async () => {
    const { t, f } = await setup(['clip:grok-imagine-15-lite'])
    const items = [1, 2, 3].map((n) => ({ name: `c${n}`, engine: 'clip:grok-imagine-15-lite', prompt: 'p', image: 'still.png', seconds: 4 }))
    const p = plan(t.dir, items)
    const out = join(t.dir, 'out')
    const est = benchEstimateUsd(items[0] as never)
    // room for two estimates, not three, when they run one after the other... the real cost (0.05) is below the estimate
    const rows = await benchVisual(t.cloud, { plan: p, out, budgetUsd: est * 2 + 0.001, parallel: 3 }, 'cli', 'https://cloud.example', say)
    expect(rows.filter((r) => r.status === 'ok')).toHaveLength(2)
    expect(rows.filter((r) => r.status === 'skipped')).toHaveLength(1)
    const recorded = readFileSync(join(out, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { costUsd: number; status: string })
    expect(recorded.filter((r) => r.status === 'ok').every((r) => r.costUsd === 0.05)).toBe(true)
    // the start still reached the provider through unifically's storage
    expect(body(f.calls.find((c) => c.method === 'POST')).input.start_image_url).toMatch(/^https:\/\/files\.unifically\.com\//)
    // which unifically read from the Cloud's own signed link, never a public host of ours
    expect(f.calls.some((c) => c.method === 'GET' && c.url.startsWith('https://cloud.example/'))).toBe(true)
    const before = f.calls.length
    const again = await benchVisual(t.cloud, { plan: p, out, budgetUsd: 1 }, 'cli', 'https://cloud.example', say)
    expect(again.map((r) => r.name)).toEqual(['c3'])
    expect(f.calls.filter((c, i) => i >= before && c.method === 'POST' && body(c).dry_run !== true)).toHaveLength(1)
  })

  it('the budget is at most 15 $', async () => {
    const { t } = await setup(['clip:grok-imagine-15-lite'])
    const p = plan(t.dir, [])
    expect((await outcome(benchVisual(t.cloud, { plan: p, out: join(t.dir, 'o'), budgetUsd: 16 }, 'cli', undefined, say))).message).toMatch(/at most 15/)
  })
})

describe('providers unifically-ledger', () => {
  it('reads the balance and sums the cost per model over the pages, never the email or the inputs', async () => {
    const f = fakeFetch((req) => {
      if (req.url === 'https://api.unifically.com/v1/account') return json({ success: true, data: { user_id: 1, balance_usd: 12.5, email: 'secret@example.com' } })
      if (req.url.includes('page=1&')) return json({ success: true, data: [{ task_id: 'a', model: 'google/veo-3.1-lite-relaxed', status: 'completed', cost: 0.075, created_at: 2, input: { prompt: 'x' } }, { task_id: 'b', model: 'xai/grok', status: 'failed', cost: 0, created_at: 3 }], pagination: { has_next: true } })
      return json({ success: true, data: [{ task_id: 'c', model: 'google/veo-3.1-lite-relaxed', status: 'completed', cost: 0.075, created_at: 4 }], pagination: { has_next: false } })
    })
    const l = await unificallyLedger(KEY, 1, new AbortController().signal, { fetchImpl: f.fetch })
    expect(l.balanceUsd).toBe(12.5)
    expect(l.models).toEqual([{ model: 'google/veo-3.1-lite-relaxed', tasks: 2, failed: 0, costUsd: 0.15 }, { model: 'xai/grok', tasks: 1, failed: 1, costUsd: 0 }])
    expect(l.totalUsd).toBeCloseTo(0.15, 10)
    expect(JSON.stringify(l)).not.toMatch(/secret@|prompt/)
    expect(f.calls.every((c) => c.headers.authorization === `Bearer ${KEY}`)).toBe(true)
    expect(f.calls[1]?.url).toBe('https://api.unifically.com/v1/tasks?page=1&page_size=100&created_after=1')
  })
})
