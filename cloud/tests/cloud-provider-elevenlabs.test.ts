// The ElevenLabs adapter against a fake fetch: request shape, both answer kinds, error mapping, abort, cost, no secret leak.
import { describe, expect, it } from 'vitest'
import { elevenlabsAdapter, elevenlabsCostUsd, wordsFromAlignment } from '../src/providers/elevenlabs.ts'
import { PaidCallBlocked } from '../src/providers/registry.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'

const KEY = 'xi-test-SECRET-91c2d7aa30'
const audio = (s: string): Response => new Response(Buffer.from(s), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
const align = (text: string, step = 0.1) => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => +(i * step).toFixed(3)),
  character_end_times_seconds: [...text].map((_, i) => +((i + 1) * step).toFixed(3))
})
const timed = (text: string) => json({ audio_base64: Buffer.from(`A:${text}`).toString('base64'), alignment: align(text), normalized_alignment: align(text) })
const run = (a: ReturnType<typeof elevenlabsAdapter>, text: string, wordTimings = false, ctx = ctxFor(KEY)) =>
  runUsage(a, 'synthesize', { text, voiceId: 'voice/42', wordTimings }, ctx)

describe('ElevenLabs adapter', () => {
  it('declares its vault secret', () => {
    expect(elevenlabsAdapter()).toMatchObject({ id: 'elevenlabs', kind: 'real', secretName: 'ELEVENLABS_API_KEY' })
  })

  it('sends the documented request: xi-api-key header, voice id in the path (encoded), model, output format', async () => {
    const f = fakeFetch(() => audio('MP3'))
    await run(elevenlabsAdapter({ fetchImpl: f.fetch, model: 'eleven_flash_v2_5', languageCode: 'fr', speed: 1.1 }), 'Bonjour.')
    const [req] = f.calls
    expect(req?.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice%2F42?output_format=mp3_44100_128')
    expect(req?.method).toBe('POST')
    expect(req?.headers['xi-api-key']).toBe(KEY)
    expect(req?.headers.authorization).toBeUndefined()
    expect(req?.url).not.toContain(KEY)
    expect(JSON.parse(req?.body ?? '{}')).toEqual({ text: 'Bonjour.', model_id: 'eleven_flash_v2_5', language_code: 'fr', voice_settings: { speed: 1.1 } })
  })

  it('defaults: multilingual v2, no language code, no voice settings', async () => {
    const f = fakeFetch(() => audio('MP3'))
    await run(elevenlabsAdapter({ fetchImpl: f.fetch }), 'Bonjour.')
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ text: 'Bonjour.', model_id: 'eleven_multilingual_v2' })
  })

  it('without timings: the bytes of the answer are the file; measure and cost come from the characters', async () => {
    const f = fakeFetch(() => audio('RAW-MP3-BYTES'))
    const out = await run(elevenlabsAdapter({ fetchImpl: f.fetch }), 'x'.repeat(1000))
    expect(Buffer.from(out.files[0]?.bytes ?? []).toString()).toBe('RAW-MP3-BYTES')
    expect(out.files[0]).toMatchObject({ name: 'voice.mp3', mime: 'audio/mpeg' })
    expect(out.measure).toEqual([{ item: 'voice.chars', quantity: 1000 }])
    expect(out.costUsd).toBeCloseTo(0.08, 10) // USD 0.08 per 1K characters
    expect(out.data).toMatchObject({ voiceId: 'voice/42', model: 'eleven_multilingual_v2', words: [] })
    expect(elevenlabsCostUsd('eleven_flash_v2_5', 1000)).toBeCloseTo(0.04, 10)
    expect(elevenlabsCostUsd('eleven_turbo_v2_5', 1000)).toBeCloseTo(0.04, 10)
    expect(elevenlabsCostUsd('eleven_v3', 1000)).toBeCloseTo(0.08, 10)
  })

  it('with timings: the with-timestamps route, base64 audio, words rebuilt from the character times', async () => {
    const f = fakeFetch((req) => timed((JSON.parse(req.body) as { text: string }).text))
    const out = await run(elevenlabsAdapter({ fetchImpl: f.fetch }), 'Bonjour toi', true)
    expect(f.calls[0]?.url).toContain('/with-timestamps?output_format=')
    expect(Buffer.from(out.files[0]?.bytes ?? []).toString()).toBe('A:Bonjour toi')
    expect(out.data.words).toEqual([
      { word: 'Bonjour', start: 0, end: 0.7 },
      { word: 'toi', start: 0.8, end: 1.1 }
    ])
    expect(out.data.durationS).toBe(1.1)
    expect(wordsFromAlignment(align('a  b'), 2).map((w) => w.word)).toEqual(['a', 'b'])
  })

  it('cuts a long script into several calls and shifts the words of each piece by the previous ones', async () => {
    const text = Array.from({ length: 6 }, (_, i) => `Phrase ${i} ${'mot '.repeat(40)}.`).join(' ')
    const f = fakeFetch((req) => timed((JSON.parse(req.body) as { text: string }).text))
    const out = await run(elevenlabsAdapter({ fetchImpl: f.fetch, chunkChars: 500 }), text, true)
    expect(f.calls.length).toBeGreaterThan(2)
    const words = out.data.words as { start: number; end: number }[]
    for (let i = 1; i < words.length; i++) expect((words[i] as { start: number }).start).toBeGreaterThanOrEqual((words[i - 1] as { start: number }).start)
    expect(out.measure?.[0]?.quantity).toBe(f.calls.reduce((s, c) => s + (JSON.parse(c.body) as { text: string }).text.length, 0))
    expect(out.data.calls).toBe(f.calls.length)
  })

  it('maps statuses: 429 (rate limit, concurrency, busy), 5xx, network → retryable; 401, 402, 422 → fatal', async () => {
    const attempt = async (status: number, body = '{}') => {
      const f = fakeFetch(() => new Response(body, { status }))
      return run(elevenlabsAdapter({ fetchImpl: f.fetch }), 'Salut.').catch((e: unknown) => e)
    }
    for (const s of [429, 500, 503]) expect(await attempt(s), String(s)).toBeInstanceOf(RetryableProviderError)
    for (const s of [400, 401, 402, 403, 404, 422]) {
      const e = await attempt(s)
      expect(e, String(s)).toBeInstanceOf(Error)
      expect(e, String(s)).not.toBeInstanceOf(RetryableProviderError)
    }
    expect(((await attempt(429, JSON.stringify({ detail: { status: 'concurrent_limit_exceeded', message: 'x' } }))) as Error).message).toMatch(/429 \(concurrent_limit_exceeded\)/)
    expect(((await attempt(401)) as Error).message).toMatch(/401.*refused/)
    expect(((await attempt(402)) as Error).message).toMatch(/no balance/)
    const down = elevenlabsAdapter({ fetchImpl: (() => Promise.reject(new TypeError('socket hang up'))) as typeof fetch })
    expect(await run(down, 'Salut.').catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
  })

  it('an empty audio answer or a malformed timestamps answer is retryable', async () => {
    const empty = fakeFetch(() => audio(''))
    expect(await run(elevenlabsAdapter({ fetchImpl: empty.fetch }), 'Salut.').catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
    const bad = fakeFetch(() => json({ nope: true }))
    expect(await run(elevenlabsAdapter({ fetchImpl: bad.fetch }), 'Salut.', true).catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
  })

  it('honours the abort signal', async () => {
    const controller = new AbortController()
    const f = fakeFetch(() => new Promise<Response>(() => undefined))
    const p = run(elevenlabsAdapter({ fetchImpl: f.fetch }), 'Salut.', false, ctxFor(KEY, controller.signal))
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(p).rejects.toBe(reason)
    const g = fakeFetch(() => audio('A'))
    await expect(run(elevenlabsAdapter({ fetchImpl: g.fetch }), 'Salut.', false, ctxFor(KEY, AbortSignal.abort(reason)))).rejects.toBe(reason)
    expect(g.calls).toHaveLength(0)
  })

  it('never puts the key in an error', async () => {
    const echoes = [
      fakeFetch(() => new Response(JSON.stringify({ detail: { status: `bad_${KEY}` } }), { status: 401 })),
      fakeFetch(() => Promise.reject(new TypeError(`fetch failed xi-api-key: ${KEY}`)))
    ]
    for (const f of echoes) {
      const e = (await run(elevenlabsAdapter({ fetchImpl: f.fetch }), 'Salut.').catch((x: unknown) => x)) as Error
      expect(e.message).not.toContain(KEY)
    }
  })

  it('refuses to touch the network in a test run when no fetch is injected', async () => {
    await expect(run(elevenlabsAdapter(), 'Salut.')).rejects.toBeInstanceOf(PaidCallBlocked)
  })
})
