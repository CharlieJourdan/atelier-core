// The Gemini "eyes" adapter against a fake fetch: request shape (key in a header, YouTube link, low resolution, JSON schema),
// parsing, error mapping, abort, cost from the token counts, no secret leak.
import { describe, expect, it } from 'vitest'
import { geminiAdapter, geminiCostUsd, geminiPrice, GEMINI_MAX_OUTPUT_TOKENS } from '../src/providers/gemini.ts'
import { PaidCallBlocked } from '../src/providers/registry.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'

const KEY = 'AIza-test-SECRET-6b0d93e1f4'
const URL_IN = 'https://www.youtube.com/watch?v=abcdefghijk'
const ANALYSIS = {
  summary: 'Une vidéo de démonstration.',
  hook: { text: 'Question choc', endsAtS: 8, technique: 'question' },
  structure: [
    { fromS: 0, toS: 8, kind: 'hook', summary: 'accroche' },
    { fromS: 8, toS: 300, kind: 'body', summary: 'développement' }
  ],
  pacing: { cutsPerMinute: 14, tempo: 'fast', notes: 'coupes courtes' },
  shotTypes: ['b-roll', 'talking head'],
  onScreenText: [{ atS: 2, text: 'ATTENTION' }],
  music: { present: true, mood: 'tendue', notes: 'nappe sombre' },
  callsToAction: [{ atS: 290, text: "abonne-toi" }]
}
const answer = (extra: Record<string, unknown> = {}, text: string = JSON.stringify(ANALYSIS)) =>
  json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 60_000,
      candidatesTokenCount: 1500,
      thoughtsTokenCount: 500,
      promptTokensDetails: [
        { modality: 'VIDEO', tokenCount: 40_000 },
        { modality: 'AUDIO', tokenCount: 20_000 }
      ]
    },
    ...extra
  })
const run = (a: ReturnType<typeof geminiAdapter>, minutes = 10, ctx = ctxFor(KEY)) => runUsage(a, 'analyseVideo', { url: URL_IN, minutes }, ctx)

describe('Gemini adapter', () => {
  it('declares its vault secret', () => {
    expect(geminiAdapter()).toMatchObject({ id: 'gemini', kind: 'real', secretName: 'GEMINI_API_KEY' })
  })

  it('sends the key in a header (never in the URL), the YouTube link, a clip end, low resolution and the JSON schema', async () => {
    const f = fakeFetch(() => answer())
    await run(geminiAdapter({ fetchImpl: f.fetch }), 10)
    const [req] = f.calls
    expect(req?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')
    expect(req?.url).not.toContain(KEY)
    expect(req?.headers['x-goog-api-key']).toBe(KEY)
    expect(req?.method).toBe('POST')
    const body = JSON.parse(req?.body ?? '{}') as {
      contents: { parts: Record<string, unknown>[] }[]
      generationConfig: Record<string, unknown>
    }
    expect(body.contents[0]?.parts[0]).toEqual({ fileData: { fileUri: URL_IN }, videoMetadata: { endOffset: '600s' } })
    expect(typeof body.contents[0]?.parts[1]?.text).toBe('string')
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
    })
    const schema = body.generationConfig.responseJsonSchema as { required: string[] }
    expect(schema.required).toEqual(expect.arrayContaining(['hook', 'structure', 'pacing', 'shotTypes', 'onScreenText', 'music', 'callsToAction']))
  })

  it('the model is configurable', async () => {
    const f = fakeFetch(() => answer())
    await run(geminiAdapter({ fetchImpl: f.fetch, model: 'gemini-2.5-flash-lite', baseUrl: 'https://proxy.example/' }))
    expect(f.calls[0]?.url).toBe('https://proxy.example/v1beta/models/gemini-2.5-flash-lite:generateContent')
  })

  it('returns the analysis in the fake\'s shape plus the full object, and the cost from the token counts', async () => {
    const f = fakeFetch(() => answer())
    const out = await run(geminiAdapter({ fetchImpl: f.fetch }))
    expect(out.files).toEqual([])
    expect(out.data).toMatchObject({
      url: URL_IN,
      summary: 'Une vidéo de démonstration.',
      cutsPerMinute: 14,
      segments: [
        { from: 0, to: 8, kind: 'hook' },
        { from: 8, to: 300, kind: 'body' }
      ],
      analysedSeconds: 600
    })
    expect((out.data.analysis as { hook: { technique: string } }).hook.technique).toBe('question')
    // 40 000 video tokens × 0.25 + 20 000 audio × 0.50 + (1 500 + 500) output × 1.50, per million
    expect(out.costUsd).toBeCloseTo((40_000 * 0.25 + 20_000 * 0.5 + 2000 * 1.5) / 1e6, 10)
    expect(out.measure).toBeUndefined()
  })

  it('asks for the editing measures « Créer une pipeline » reproduces; one out of range drops them, never the analysis', async () => {
    const f = fakeFetch(() => answer())
    await run(geminiAdapter({ fetchImpl: f.fetch }))
    const schema = (JSON.parse(f.calls[0]?.body ?? '{}') as { generationConfig: { responseJsonSchema: { required: string[]; properties: Record<string, { properties: Record<string, unknown> }> } } }).generationConfig.responseJsonSchema
    expect(schema.required).toContain('measures')
    expect(Object.keys(schema.properties.measures?.properties ?? {})).toEqual(expect.arrayContaining(['presenterShare', 'presenterActs', 'pictures', 'shotS', 'light', 'camera', 'labelsPerMinute', 'offer']))
    // style-japanese: a presenter who talks 2 % of the time and acts in a third of the pictures, warm daylight, hand-held
    const measures = { presenterShare: 0.02, hookPresenterShare: 0.1, layouts: ['full'], presenterActs: 0.32, presenterRunMaxS: 4, pictures: { aiImage: 0, aiClip: 0.97, stock: 0, archive: 0, motion: 0.03 }, shotS: 2.7, look: 'photoreal', light: 'warm', camera: 'handheld', captions: 'none', labelsPerMinute: 0, wordsPerMinute: 188, offer: { atS: 290, durationS: 15, card: true } }
    const ok = await run(geminiAdapter({ fetchImpl: fakeFetch(() => answer({}, JSON.stringify({ ...ANALYSIS, measures }))).fetch }))
    expect((ok.data.analysis as { measures: unknown }).measures).toEqual(measures)
    const off = await run(geminiAdapter({ fetchImpl: fakeFetch(() => answer({}, JSON.stringify({ ...ANALYSIS, measures: { ...measures, presenterShare: 2 } }))).fetch }))
    expect((off.data.analysis as { measures?: unknown; summary: string }).measures).toBeUndefined()
    expect((off.data.analysis as { summary: string }).summary).toBe('Une vidéo de démonstration.')
  })

  it('prices by model, and an unknown model at the highest known rate', () => {
    const usage = { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000, thoughtsTokenCount: 0, promptTokensDetails: [] }
    expect(geminiCostUsd('gemini-2.5-flash-lite', usage)).toBeCloseTo(0.1 + 0.4, 10)
    expect(geminiPrice('gemini-3.1-flash-lite-preview-09-2026').input).toBe(0.25)
    expect(geminiCostUsd('gemini-9-mystery', usage)).toBeCloseTo(0.75 + 3.75, 10)
    expect(geminiCostUsd('gemini-3.1-flash-lite', undefined)).toBe(0)
  })

  it('maps statuses: 429 / 5xx / network → retryable; 400 / 401 / 403 / 404 → fatal', async () => {
    const attempt = async (status: number, body = '{}') => {
      const f = fakeFetch(() => new Response(body, { status }))
      return run(geminiAdapter({ fetchImpl: f.fetch })).catch((e: unknown) => e)
    }
    for (const s of [429, 500, 503, 504]) expect(await attempt(s), String(s)).toBeInstanceOf(RetryableProviderError)
    for (const s of [400, 401, 403, 404]) {
      const e = await attempt(s)
      expect(e, String(s)).toBeInstanceOf(Error)
      expect(e, String(s)).not.toBeInstanceOf(RetryableProviderError)
    }
    expect(((await attempt(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }))) as Error).message).toMatch(/429 \(RESOURCE_EXHAUSTED\)/)
    const down = geminiAdapter({ fetchImpl: (() => Promise.reject(new TypeError('ECONNRESET'))) as typeof fetch })
    expect(await run(down).catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
  })

  it('a refused video or a truncated answer is fatal; an empty, non-JSON or off-schema answer is retryable', async () => {
    const attempt = async (res: Response) => run(geminiAdapter({ fetchImpl: fakeFetch(() => res).fetch })).catch((e: unknown) => e)
    const blocked = await attempt(json({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, candidates: [] }))
    expect(blocked).toBeInstanceOf(Error)
    expect(blocked).not.toBeInstanceOf(RetryableProviderError)
    expect((blocked as Error).message).toMatch(/refused/)
    const cut = await attempt(json({ candidates: [{ content: { parts: [{ text: '{"summ' }] }, finishReason: 'MAX_TOKENS' }] }))
    expect(cut).not.toBeInstanceOf(RetryableProviderError)
    expect((cut as Error).message).toMatch(/cut at/)
    expect(await attempt(json({ candidates: [] }))).toBeInstanceOf(RetryableProviderError)
    expect(await attempt(answer({}, 'not json at all'))).toBeInstanceOf(RetryableProviderError)
    expect(await attempt(answer({}, JSON.stringify({ summary: 'only this' })))).toBeInstanceOf(RetryableProviderError)
  })

  it('honours the abort signal', async () => {
    const controller = new AbortController()
    const f = fakeFetch(() => new Promise<Response>(() => undefined))
    const p = run(geminiAdapter({ fetchImpl: f.fetch }), 10, ctxFor(KEY, controller.signal))
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(p).rejects.toBe(reason)
  })

  it('never puts the key in an error', async () => {
    const echoes = [
      fakeFetch(() => new Response(JSON.stringify({ error: { status: `API key ${KEY} not valid` } }), { status: 400 })),
      fakeFetch(() => Promise.reject(new TypeError(`fetch failed x-goog-api-key=${KEY}`))),
      fakeFetch(() => json({ promptFeedback: { blockReason: `echo ${KEY}` } }))
    ]
    for (const f of echoes) {
      const e = (await run(geminiAdapter({ fetchImpl: f.fetch })).catch((x: unknown) => x)) as Error
      expect(e.message).not.toContain(KEY)
    }
  })

  it('refuses to touch the network in a test run when no fetch is injected', async () => {
    await expect(run(geminiAdapter())).rejects.toBeInstanceOf(PaidCallBlocked)
  })
})
