// The MiniMax adapter against a fake fetch: request shape, parsing, error mapping, abort, cost, chunking, no secret leak.
import { describe, expect, it } from 'vitest'
import { minimaxAdapter, minimaxCostUsd, wordsFromSubtitle } from '../src/providers/minimax.ts'
import { PaidCallBlocked } from '../src/providers/registry.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'

const KEY = 'mm-test-SECRET-4f8a1c9d2e'
const hex = (s: string): string => Buffer.from(s).toString('hex')
const ok = (audio: string, chars: number, extra: Record<string, unknown> = {}) =>
  json({
    data: { audio: hex(audio), status: 2, ...extra },
    extra_info: { audio_length: 2000, usage_characters: chars },
    base_resp: { status_code: 0, status_msg: 'success' }
  })
const run = (a: ReturnType<typeof minimaxAdapter>, text: string, wordTimings = false, ctx = ctxFor(KEY)) =>
  runUsage(a, 'synthesize', { text, voiceId: 'French_Narrator', wordTimings }, ctx)

describe('MiniMax adapter', () => {
  it('declares its vault secret and is a real adapter', () => {
    expect(minimaxAdapter()).toMatchObject({ id: 'minimax', kind: 'real', secretName: 'MINIMAX_API_KEY' })
  })

  it('sends the documented T2A v2 request: URL, bearer key, no GroupId, body fields', async () => {
    const f = fakeFetch(() => ok('MP3', 11))
    await run(minimaxAdapter({ fetchImpl: f.fetch, speed: 1.1, languageBoost: 'French' }), 'Bonjour toi.', true)
    const [req] = f.calls
    expect(req?.url).toBe('https://api.minimax.io/v1/t2a_v2')
    expect(req?.url).not.toMatch(/GroupId|key=/i)
    expect(req?.method).toBe('POST')
    expect(req?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(req?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(req?.body ?? '{}')).toMatchObject({
      model: 'speech-2.8-hd',
      text: 'Bonjour toi.',
      stream: false,
      voice_setting: { voice_id: 'French_Narrator', speed: 1.1 },
      audio_setting: { format: 'mp3' },
      language_boost: 'French',
      output_format: 'hex',
      subtitle_enable: true,
      subtitle_type: 'word'
    })
  })

  it('uses the China host when asked, the turbo model when asked, and no subtitles when no timings are wanted', async () => {
    const f = fakeFetch(() => ok('MP3', 5))
    await run(minimaxAdapter({ fetchImpl: f.fetch, region: 'china', model: 'speech-2.8-turbo' }), 'Salut.')
    expect(f.calls[0]?.url).toBe('https://api.minimaxi.com/v1/t2a_v2')
    const body = JSON.parse(f.calls[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.model).toBe('speech-2.8-turbo')
    expect(body).not.toHaveProperty('subtitle_enable')
  })

  it('returns the audio file, the measure in characters and the cost at the documented price', async () => {
    const f = fakeFetch(() => ok('AUDIO-BYTES', 1234))
    const out = await run(minimaxAdapter({ fetchImpl: f.fetch }), 'x'.repeat(1300))
    expect(Buffer.from(out.files[0]?.bytes ?? []).toString()).toBe('AUDIO-BYTES')
    expect(out.files[0]).toMatchObject({ name: 'voice.mp3', mime: 'audio/mpeg' })
    expect(out.measure).toEqual([{ item: 'voice.chars', quantity: 1234 }])
    expect(out.costUsd).toBeCloseTo(0.1234, 10) // 1234 chars × USD 100 per 1M
    expect(out.data).toMatchObject({ voiceId: 'French_Narrator', model: 'speech-2.8-hd', durationS: 2 })
    expect(minimaxCostUsd('speech-2.8-turbo', 1_000_000)).toBe(60)
    expect(minimaxCostUsd('speech-2.8-hd', 1_000_000)).toBe(100)
  })

  it('reads word timings from the subtitle file (without sending the key to it) and degrades to none', async () => {
    const subtitle = [
      { text: 'Bonjour', time_begin: 0, time_end: 400 },
      { text: 'toi', time_begin: 450, time_end: 900 }
    ]
    const f = fakeFetch((req) => (req.url.startsWith('https://files.example/') ? json(subtitle) : ok('A', 10, { subtitle_file: 'https://files.example/sub.json' })))
    const out = await run(minimaxAdapter({ fetchImpl: f.fetch }), 'Bonjour toi', true)
    expect(out.data.words).toEqual([
      { word: 'Bonjour', start: 0, end: 0.4 },
      { word: 'toi', start: 0.45, end: 0.9 }
    ])
    expect(f.calls[1]?.headers.authorization).toBeUndefined()
    const bad = fakeFetch((req) => (req.url.startsWith('https://files.example/') ? new Response('nope', { status: 500 }) : ok('A', 10, { subtitle_file: 'https://files.example/sub.json' })))
    const out2 = await run(minimaxAdapter({ fetchImpl: bad.fetch }), 'Bonjour toi', true)
    expect(out2.data).toMatchObject({ words: [], wordTimings: 'unavailable' })
    expect(out2.files).toHaveLength(1)
    // a non-https link is never followed
    const http = fakeFetch(() => ok('A', 10, { subtitle_file: 'http://files.example/sub.json' }))
    await run(minimaxAdapter({ fetchImpl: http.fetch }), 'Bonjour toi', true)
    expect(http.calls).toHaveLength(1)
  })

  it('understands nested timestamped_words and ignores sentence-level entries', () => {
    const nested = [{ text: 'a b', timestamped_words: [{ word: 'a', time_begin: 0, time_end: 100 }, { word: 'b', time_begin: 100, time_end: 200 }] }]
    expect(wordsFromSubtitle(nested, 1)).toEqual([
      { word: 'a', start: 1, end: 1.1 },
      { word: 'b', start: 1.1, end: 1.2 }
    ])
    expect(wordsFromSubtitle([{ text: 'two words', time_begin: 0, time_end: 10 }], 0)).toEqual([])
    expect(wordsFromSubtitle({ not: 'an array' }, 0)).toEqual([])
  })

  it('cuts a long script into several calls, joins the audio, sums characters and offsets the timings', async () => {
    const text = Array.from({ length: 8 }, (_, i) => `Phrase numero ${i} ${'mot '.repeat(60)}.`).join(' ')
    const f = fakeFetch((req, n) =>
      req.url.startsWith('https://files.example/')
        ? json([{ text: 'w', time_begin: 0, time_end: 500 }])
        : ok(`<${n}>`, (JSON.parse(req.body) as { text: string }).text.length, { subtitle_file: 'https://files.example/s.json' })
    )
    const out = await run(minimaxAdapter({ fetchImpl: f.fetch, chunkChars: 800 }), text, true)
    const synth = f.calls.filter((c) => c.url.endsWith('/t2a_v2'))
    const lengths = synth.map((c) => (JSON.parse(c.body) as { text: string }).text.length)
    expect(synth.length).toBeGreaterThan(2)
    for (const n of lengths) expect(n).toBeLessThanOrEqual(800)
    expect(out.measure?.[0]?.quantity).toBe(lengths.reduce((s, n) => s + n, 0))
    expect(out.data.calls).toBe(synth.length)
    const words = out.data.words as { start: number }[]
    expect(words.map((w) => w.start)).toEqual(synth.map((_, i) => i * 2)) // each piece lasts 2 s (audio_length)
    expect(Buffer.from(out.files[0]?.bytes ?? []).toString()).toMatch(/^<\d+>.*<\d+>$/)
  })

  it('maps HTTP statuses: 429 / 5xx / network are retryable, 401 / 402 / other 4xx are fatal', async () => {
    const attempt = async (status: number) => {
      const f = fakeFetch(() => new Response('{}', { status }))
      return run(minimaxAdapter({ fetchImpl: f.fetch }), 'Salut.').catch((e: unknown) => e)
    }
    for (const s of [429, 500, 502, 503, 408]) expect(await attempt(s), String(s)).toBeInstanceOf(RetryableProviderError)
    for (const s of [400, 401, 402, 403, 404]) {
      const e = await attempt(s)
      expect(e, String(s)).toBeInstanceOf(Error)
      expect(e, String(s)).not.toBeInstanceOf(RetryableProviderError)
    }
    expect(((await attempt(401)) as Error).message).toMatch(/401.*refused/)
    const down = minimaxAdapter({ fetchImpl: (() => Promise.reject(new TypeError('connect ECONNREFUSED'))) as typeof fetch })
    expect(await run(down, 'Salut.').catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
  })

  it('maps the documented base_resp codes even on HTTP 200', async () => {
    const attempt = async (code: number, msg = 'whatever') => {
      const f = fakeFetch(() => json({ base_resp: { status_code: code, status_msg: msg } }))
      return run(minimaxAdapter({ fetchImpl: f.fetch }), 'Salut.').catch((e: unknown) => e)
    }
    for (const c of [1000, 1001, 1002, 1039]) expect(await attempt(c), String(c)).toBeInstanceOf(RetryableProviderError)
    for (const c of [1004, 1042, 2013, 1008]) {
      const e = await attempt(c)
      expect(e, String(c)).toBeInstanceOf(Error)
      expect(e, String(c)).not.toBeInstanceOf(RetryableProviderError)
    }
    expect(((await attempt(1004)) as Error).message).toMatch(/1004.*authentication failed/)
  })

  it('an answer with no audio or the wrong shape is retryable', async () => {
    const noAudio = fakeFetch(() => json({ data: {}, base_resp: { status_code: 0 } }))
    expect(await run(minimaxAdapter({ fetchImpl: noAudio.fetch }), 'Salut.').catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
    const garbage = fakeFetch(() => new Response('<html>', { status: 200 }))
    expect(await run(minimaxAdapter({ fetchImpl: garbage.fetch }), 'Salut.').catch((e: unknown) => e)).toBeInstanceOf(RetryableProviderError)
  })

  it('honours the abort signal: no retryable error, the signal reason comes out', async () => {
    const controller = new AbortController()
    const f = fakeFetch(() => new Promise<Response>(() => undefined))
    const p = run(minimaxAdapter({ fetchImpl: f.fetch }), 'Salut.', false, ctxFor(KEY, controller.signal))
    const reason = new Error('cancelled by the user')
    controller.abort(reason)
    await expect(p).rejects.toBe(reason)
    // aborted before the call: nothing is sent at all
    const g = fakeFetch(() => ok('A', 1))
    await expect(run(minimaxAdapter({ fetchImpl: g.fetch }), 'Salut.', false, ctxFor(KEY, AbortSignal.abort(reason)))).rejects.toBe(reason)
    expect(g.calls).toHaveLength(0)
  })

  it('a timeout is retryable', async () => {
    const f = fakeFetch(() => new Promise<Response>(() => undefined))
    const e = await run(minimaxAdapter({ fetchImpl: f.fetch, timeoutMs: 20 }), 'Salut.').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(RetryableProviderError)
    expect((e as Error).message).toMatch(/timeout/)
  })

  it('never puts the key in an error, whatever the provider or the network echoes', async () => {
    const echoes = [
      fakeFetch(() => new Response(`bad key ${KEY}`, { status: 401 })),
      fakeFetch(() => json({ base_resp: { status_code: 9999, status_msg: `invalid ${KEY} supplied` } })),
      fakeFetch(() => Promise.reject(new TypeError(`fetch failed for Bearer ${KEY}`)))
    ]
    for (const f of echoes) {
      const e = (await run(minimaxAdapter({ fetchImpl: f.fetch }), 'Salut.').catch((x: unknown) => x)) as Error
      expect(e.message).not.toContain(KEY)
      expect(e.message.length).toBeGreaterThan(10)
    }
  })

  it('refuses to touch the network in a test run when no fetch is injected', async () => {
    await expect(run(minimaxAdapter(), 'Salut.')).rejects.toBeInstanceOf(PaidCallBlocked)
  })

  it('rejects a text of only blanks without calling', async () => {
    const f = fakeFetch(() => ok('A', 1))
    await expect(run(minimaxAdapter({ fetchImpl: f.fetch }), '   \n\n  ')).rejects.toThrow(/empty/)
    expect(f.calls).toHaveLength(0)
  })
})
