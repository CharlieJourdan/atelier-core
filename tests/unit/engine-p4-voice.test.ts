// Integration tests of the voice nodes of lot P4 (voice.tts fake / run, voice.own) with real ffmpeg, the system voice on
// Windows and an in-process Atelier Cloud (fakes, loopback only). Nothing paid, no real provider.
import { writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, EngineServices } from '../../src/engine'
import { cloudHttpService } from '../../src/engine/cloud-http'
import { EngineError } from '../../src/engine/errors'
import { energyEnvelope, measureLoudness, probe, speechRegions } from '../../src/engine/media/probe'
import { systemSpeechService } from '../../src/engine/media/speech'
import { writeWav } from '../../src/engine/media/wav'
import { spokenText } from '../../src/engine/media/word-timing'
import { voiceOwn, VoiceOwnParams } from '../../src/engine/nodes/voice-own'
import { splitChunks } from '../../src/engine/nodes/voice-common'
import { voiceTts, VoiceTtsParams } from '../../src/engine/nodes/voice-tts'
import { syllables } from '../../src/engine/text/align'
import { parseScript } from '../../src/engine/text/script'
import { MEDIA, NO_FFMPEG, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: they are loaded
// through a computed path (typed here by hand) so the typecheck of the app never walks into cloud/.
interface TestCloud {
  app: { listen(o: { host: string; port: number }): Promise<string>; server: { address(): unknown } }
  cloud: {
    db: { prepare(sql: string): { get(): unknown } }
    wallet: { entries(teamId: string): { entries: { kind: string }[] }; state(teamId: string): { balance: number } }
  }
}
interface Person {
  teamId: string
  accessToken: string
}
const HELPERS = 'helpers'
const { makeCloud, signUpAndIn } = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(): TestCloud
  signUpAndIn(t: TestCloud, p: { credits: number }): Promise<Person>
}

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal
const SCRIPT = 'Bonjour à tous, voici l’histoire du phare. Il se dressait sur la falaise depuis très longtemps ! Personne n’y croyait.\n\nLe lendemain, tout avait changé.'
const scriptArt = (value: string): Artefact => art('text.script', { value })
const ttsParams = (o: Record<string, unknown> = {}): ReturnType<typeof VoiceTtsParams.parse> => VoiceTtsParams.parse(o)
// run() takes the erased params type of the registry; the parsed params are what it really receives
const runTts = (ctx: ReturnType<typeof makeCtx>, script: string, p = ttsParams()): ReturnType<typeof voiceTts.run> => voiceTts.run(ctx, { script: scriptArt(script) }, p)
const fakeTts = (ctx: ReturnType<typeof makeCtx>, script: string, p = ttsParams()): ReturnType<typeof voiceTts.fake> => voiceTts.fake(ctx, { script: scriptArt(script) }, p)

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

interface WordOut {
  w: string
  start: number
  end: number
  sentence: number
}
const wordsOf = (a: { value?: unknown } | undefined): WordOut[] => (a?.value ?? []) as WordOut[]

describe.skipIf(!hasFfmpeg)(`voice.tts fake, tone voice (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  it('writes a 48 kHz mono FLAC at about -16 LUFS and one timed word per script token', { timeout: 120_000 }, async () => {
    const dir = work('tone')
    const out = await fakeTts(makeCtx(testServices(dir), { node: voiceTts }), SCRIPT)
    const audio = out.audio as { files: string[]; meta: Record<string, unknown> }
    expect(audio.files[0]).toMatch(/\.flac$/)
    expect(audio.meta).toMatchObject({ demo: true, source: 'tone', sampleRate: 48000 })
    const info = await probe(media, audio.files[0] as string, signal)
    const s = info.streams.find((x) => x.codec_type === 'audio')
    expect(s).toMatchObject({ codec_name: 'flac', sample_rate: '48000', channels: 1 })
    const D = info.durationS
    const loud = await measureLoudness(media, audio.files[0] as string, signal)
    expect(Math.abs(loud.integrated - -16)).toBeLessThanOrEqual(1.5)

    const tokens = parseScript(SCRIPT).tokens
    const words = wordsOf(out.words)
    expect(words.map((w) => w.w)).toEqual(tokens.map((t) => t.w))
    let prev = 0
    for (const w of words) {
      expect(w.start).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(w.end).toBeGreaterThanOrEqual(w.start)
      expect(w.end).toBeLessThanOrEqual(D + 0.01)
      prev = w.start
    }
    const meta = out.words?.meta as Record<string, unknown>
    expect(meta.alignment).not.toBe('weak')
    expect(meta.demo).toBe(true)
    expect(meta.matched as number).toBeGreaterThanOrEqual(0.9)
    expect(Math.abs((meta.durationS as number) - D)).toBeLessThan(0.05)
  })

  it('pace fit: lands on a target 10 % shorter, and is limited to ±15 % (with a warning) for a target 40 % away', { timeout: 120_000 }, async () => {
    const dir = work('fit')
    const natural = await fakeTts(makeCtx(testServices(dir), { node: voiceTts }), SCRIPT)
    const D0 = (natural.words?.meta as { durationS: number }).durationS

    const target = D0 * 0.9
    const ctx = makeCtx(testServices(dir), { node: voiceTts, minutes: target / 60 })
    const fitted = await fakeTts(ctx, SCRIPT, ttsParams({ pace: 'fit' }))
    const D = (fitted.words?.meta as { durationS: number }).durationS
    expect(Math.abs(D - target)).toBeLessThanOrEqual(0.3)
    expect(ctx.reports.filter((r) => r.kind === 'log' && r.level === 'warn' && /pace fit limited/.test(r.text))).toHaveLength(0)

    const far = D0 * 0.6
    const ctx2 = makeCtx(testServices(dir), { node: voiceTts, minutes: far / 60 })
    const limited = await fakeTts(ctx2, SCRIPT, ttsParams({ pace: 'fit' }))
    const D2 = (limited.words?.meta as { durationS: number }).durationS
    expect(D2).toBeGreaterThanOrEqual(D0 / 1.15 - 0.3)
    expect(D2).toBeLessThanOrEqual(D0 / 1.15 + 0.3)
    expect(ctx2.reports.some((r) => r.kind === 'log' && r.level === 'warn' && /pace fit limited/.test(r.text))).toBe(true)
    expect(((limited.audio as { meta: { fit: number } }).meta).fit).toBeCloseTo(1.15, 3)
  })
})

describe.skipIf(process.platform !== 'win32' || !hasFfmpeg)('voice.tts fake, Windows system voice', () => {
  it('speaks two French sentences and times every word on the speech', { timeout: 120_000 }, async () => {
    const speech = systemSpeechService({ platform: process.platform })
    expect(speech).not.toBeNull()
    const dir = work('sapi')
    const script = 'Bonjour à tous et bienvenue dans cette courte vidéo sur les phares de Bretagne.\n\nAujourd’hui nous allons découvrir leur histoire, étape par étape, avec calme.'
    const out = await fakeTts(makeCtx(testServices(dir, { speech: speech as NonNullable<typeof speech> }), { node: voiceTts }), script)
    const audio = out.audio as { files: string[]; meta: Record<string, unknown> }
    expect(audio.meta).toMatchObject({ demo: true, source: 'system' })
    const parsed = parseScript(script)
    const words = wordsOf(out.words)
    expect(words).toHaveLength(parsed.tokens.length)
    expect((out.words?.meta as { alignment: string }).alignment).toBe('aligned')
    const regions = speechRegions(await energyEnvelope(media, audio.files[0] as string, signal))
    expect(regions.length).toBeGreaterThan(0)
    // every word starts inside (or within one frame of) a speech region: none sits in the long pause between the two sentences
    for (const w of words) {
      const inside = regions.some((r) => w.start >= r.start - 0.08 && w.start <= r.end + 0.08)
      expect(inside, `word "${w.w}" at ${w.start}`).toBe(true)
    }
    for (const s of parsed.sentences) {
      const w = words[s.first] as WordOut
      expect(regions.some((r) => w.start >= r.start - 0.08 && w.start <= r.end)).toBe(true)
    }
  })
})

interface CloudRig {
  t: TestCloud
  p: Person
  baseUrl: string
  services: EngineServices
  jobs: () => number
  captures: () => number
  balance: () => number
}

/** An in-process Cloud listening on a loopback port, with a team holding credits; closed by the helpers' afterEach. */
async function startCloud(dir: string): Promise<CloudRig> {
  const t = makeCloud()
  const p = await signUpAndIn(t, { credits: 1_000_000 })
  await t.app.listen({ host: '127.0.0.1', port: 0 })
  const baseUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`
  const cloud = cloudHttpService({ baseUrl, token: () => p.accessToken, pollMs: 10 })
  return {
    t,
    p,
    baseUrl,
    services: testServices(dir, { cloud }),
    jobs: () => (t.cloud.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n,
    captures: () => t.cloud.wallet.entries(p.teamId).entries.filter((e) => e.kind === 'capture').length,
    balance: () => t.cloud.wallet.state(p.teamId).balance
  }
}

const CLOUD_SCRIPT = 'Bonjour à tous. Voici une courte histoire de phare. Elle commence ici, au bord de la mer.'

describe.skipIf(!hasFfmpeg)('voice.tts run through the local Atelier Cloud', () => {
  it('produces the audio with provider word times, charges the wallet once, and reuses the per-chunk cache', { timeout: 120_000 }, async () => {
    const dir = work('cloud')
    const rig = await startCloud(dir)
    const before = rig.balance()
    const out = await runTts(makeCtx(rig.services, { node: voiceTts, where: 'cloud', minutes: 1 }), CLOUD_SCRIPT)
    const tokens = parseScript(CLOUD_SCRIPT).tokens
    expect((out.audio as { meta: Record<string, unknown> }).meta).toMatchObject({ demo: true, source: 'cloud' })
    const words = wordsOf(out.words)
    expect(words.map((w) => w.w)).toEqual(tokens.map((t) => t.w))
    expect((out.words?.meta as { alignment: string }).alignment).toBe('provider')
    const info = await probe(media, (out.audio as { files: string[] }).files[0] as string, signal)
    expect(info.durationS).toBeGreaterThan(9.5)
    expect(rig.jobs()).toBe(1)
    expect(rig.captures()).toBe(1)
    expect(rig.balance()).toBeLessThan(before)

    // same seed: every chunk comes from the cache, the Cloud sees nothing
    const again = await runTts(makeCtx(rig.services, { node: voiceTts, where: 'cloud', minutes: 1 }), CLOUD_SCRIPT)
    expect(rig.jobs()).toBe(1)
    expect(rig.captures()).toBe(1)
    expect(wordsOf(again.words)).toEqual(words)

    // a new seed is a regeneration: a new job
    await runTts(makeCtx(rig.services, { node: voiceTts, where: 'cloud', minutes: 1, seed: 1 }), CLOUD_SCRIPT)
    expect(rig.jobs()).toBe(2)
    expect(rig.captures()).toBe(2)
  })

  it('cuts a long script in several jobs and offsets each chunk’s word times by the chunks before it', { timeout: 120_000 }, async () => {
    const dir = work('cloud-long')
    const rig = await startCloud(dir)
    const sentences = [
      'Le phare dominait la baie depuis des siècles.',
      'Les marins le connaissaient comme leur propre maison.',
      'Chaque soir, le gardien montait lentement les marches.',
      'La lumière balayait alors les vagues sombres.',
      'Personne ne savait ce que cachait la dernière salle.',
      'Un matin, une lettre arriva par la mer.'
    ]
    const paragraphs: string[] = []
    const ordinals = ['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'sixième', 'septième', 'huitième', 'neuvième', 'dixième']
    // every paragraph differs, so no two chunks share a text (and an idempotency key)
    for (let i = 0; i < 10; i++) paragraphs.push(`Dans le ${ordinals[i]} chapitre. ` + sentences.map((s, k) => sentences[(i + k) % sentences.length]).join(' '))
    const script = paragraphs.join('\n\n')
    const chunks = splitChunks(spokenText(parseScript(script), 'fr').text, 900)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    const out = await runTts(makeCtx(rig.services, { node: voiceTts, where: 'cloud', minutes: 3 }), script)
    expect(rig.jobs()).toBe(chunks.length)
    const words = wordsOf(out.words)
    expect(words).toHaveLength(parseScript(script).tokens.length)
    expect((out.words?.meta as { alignment: string }).alignment).toBe('provider')
    let boundary = 0
    for (let k = 0; k < chunks.length; k++) {
      const first = words[boundary] as WordOut
      // each fake chunk lasts ~10 s: chunk k starts after the k chunks before it
      expect(first.start).toBeGreaterThanOrEqual(k * 9.8)
      if (boundary > 0) expect(first.start).toBeGreaterThanOrEqual((words[boundary - 1] as WordOut).end - 0.05)
      boundary += (chunks[k] as string).split(/\s+/).filter(Boolean).length
    }
    for (let i = 1; i < words.length; i++) expect((words[i] as WordOut).start).toBeGreaterThanOrEqual((words[i - 1] as WordOut).start)
  })

  it('reuses one job when the same idempotency key is sent twice (retry)', { timeout: 60_000 }, async () => {
    const rig = await startCloud(work('cloud-idem'))
    const cloud = rig.services.cloud as NonNullable<EngineServices['cloud']>
    const req = { text: 'Bonjour à tous.', voiceId: 'demo-claire', wordTimings: true }
    const opts = (d: string): Parameters<typeof cloud.synthesize>[1] => ({ idempotencyKey: 'voice-retry-key', signal, dir: d })
    const d1 = work('cloud-idem-a')
    const d2 = work('cloud-idem-b')
    const a = await cloud.synthesize(req, opts(d1))
    const b = await cloud.synthesize(req, opts(d2))
    expect(a.words).toEqual(b.words)
    expect(rig.jobs()).toBe(1)
    expect(rig.captures()).toBe(1)
  })
})

describe('cloudHttpService errors', () => {
  const req = { text: 'Bonjour à tous.', voiceId: 'demo-claire', wordTimings: true }

  it('a Cloud that is not listening is a transient error with a French message', async () => {
    const cloud = cloudHttpService({ baseUrl: 'http://127.0.0.1:1', token: () => 'x', pollMs: 5 })
    const err = await cloud.synthesize(req, { idempotencyKey: 'k', signal, dir: work('cloud-down') }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'transient', permanent: false })
    expect((err as Error).message).toMatch(/injoignable/)
  })

  it('a refused token is missing_tool with a French message', async () => {
    const rig = await startCloud(work('cloud-401'))
    const cloud = cloudHttpService({ baseUrl: rig.baseUrl, token: () => 'not-a-token', pollMs: 5 })
    const err = await cloud.synthesize(req, { idempotencyKey: 'k', signal, dir: work('cloud-401-out') }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'missing_tool' })
    expect((err as Error).message).toMatch(/Cloud/)
    expect(rig.jobs()).toBe(0)
  })
})

/** A recording made of one tone per word (as long as the word has syllables) and pauses at sentence ends. */
function recording(file: string, script: string): Promise<{ times: { start: number; end: number }[]; rate: number }> {
  const rate = 48_000
  const parsed = parseScript(script)
  const parts: Float32Array[] = [new Float32Array(Math.round(0.4 * rate))]
  const times: { start: number; end: number }[] = []
  let at = 0.4
  parsed.tokens.forEach((t, i) => {
    const dur = 0.13 * Math.max(1, syllables(t.w.replace(/[^\p{L}]/gu, '').toLowerCase())) + 0.05
    const tone = new Float32Array(Math.round(dur * rate))
    for (let k = 0; k < tone.length; k++) {
      const env = Math.min(1, k / (0.02 * rate), (tone.length - k) / (0.03 * rate))
      tone[k] = 0.3 * env * Math.sin((2 * Math.PI * (200 + ((i * 41) % 70)) * k) / rate)
    }
    parts.push(tone)
    times.push({ start: at, end: at + dur })
    const next = parsed.tokens[i + 1]
    const gap = !next ? 0.5 : next.sentence !== t.sentence ? 0.6 : 0.09
    parts.push(new Float32Array(Math.round(gap * rate)))
    at += dur + gap
  })
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    all.set(p, o)
    o += p.length
  }
  return writeWav(file, all, rate).then(() => ({ times, rate }))
}

describe.skipIf(!hasFfmpeg)('voice.own', () => {
  const OWN = 'Bonjour tout le monde. Voici notre histoire du jour. Elle est courte.'
  const ownParams = VoiceOwnParams.parse({})

  it('times the words of the given script on a tone recording; the text output is the script', { timeout: 120_000 }, async () => {
    const dir = work('own')
    const wav = path.join(dir, 'rec.wav')
    await recording(wav, OWN)
    const out = await voiceOwn.run(makeCtx(testServices(dir), { node: voiceOwn }), { recording: art('audio.voice', { files: [wav] }), script: scriptArt(OWN) }, ownParams)
    expect(out.text?.value).toBe(OWN)
    const words = wordsOf(out.words)
    const tokens = parseScript(OWN).tokens
    expect(words.map((w) => w.w)).toEqual(tokens.map((t) => t.w))
    expect((out.words?.meta as { alignment: string }).alignment).toBe('aligned')
    const D = (out.words?.meta as { durationS: number }).durationS
    for (let i = 1; i < words.length; i++) expect((words[i] as WordOut).start).toBeGreaterThanOrEqual((words[i - 1] as WordOut).start)
    expect((words.at(-1) as WordOut).end).toBeLessThanOrEqual(D + 0.01)
    // sentence starts follow the 0.6 s pauses: each one begins after the previous sentence's last word has ended
    const parsed = parseScript(OWN)
    for (const s of parsed.sentences.slice(1)) {
      expect((words[s.first] as WordOut).start).toBeGreaterThanOrEqual((words[s.first - 1] as WordOut).end - 0.02)
    }
    expect((out.audio as { meta: Record<string, unknown> }).meta).toMatchObject({ source: 'own', demo: false })
  })

  it('without a script and without a recogniser: bad_input with a French message', async () => {
    const dir = work('own-noscript')
    const wav = path.join(dir, 'rec.wav')
    await recording(wav, OWN)
    const err = await voiceOwn.run(makeCtx(testServices(dir), { node: voiceOwn }), { recording: art('audio.voice', { files: [wav] }) }, ownParams).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'bad_input' })
    expect((err as Error).message).toMatch(/Sans script/)
  })

  it('without a script but with a recogniser: its transcript becomes the text and times the words', { timeout: 120_000 }, async () => {
    const dir = work('own-asr')
    const wav = path.join(dir, 'rec.wav')
    const { times } = await recording(wav, OWN)
    const tokens = parseScript(OWN).tokens
    // the node hands the recogniser the trimmed file: leading silence 0.4 s → cut to 0.15 s
    const shift = 0.4 - 0.15
    const asr = {
      transcribe: (req: { audio: string }) => {
        expect(req.audio).toBeTruthy()
        return Promise.resolve({ words: tokens.map((t, i) => ({ word: t.w, start: (times[i] as { start: number }).start - shift, end: (times[i] as { end: number }).end - shift })) })
      }
    }
    const out = await voiceOwn.run(makeCtx(testServices(dir, { asr }), { node: voiceOwn }), { recording: art('audio.voice', { files: [wav] }) }, ownParams)
    expect(out.text?.value).toBe(tokens.map((t) => t.w).join(' '))
    const words = wordsOf(out.words)
    expect(words).toHaveLength(tokens.length)
    expect((out.words?.meta as { alignment: string }).alignment).toBe('asr')
    words.forEach((w, i) => expect(Math.abs(w.start - ((times[i] as { start: number }).start - shift))).toBeLessThan(0.06))
  })

  it('a recogniser that hears nothing is bad_input', async () => {
    const dir = work('own-empty')
    const wav = path.join(dir, 'rec.wav')
    writeFileSync(wav, Buffer.alloc(0))
    await writeWav(wav, new Float32Array(48_000), 48_000)
    const asr = { transcribe: () => Promise.resolve({ words: [] }) }
    const err = await voiceOwn.run(makeCtx(testServices(dir, { asr }), { node: voiceOwn }), { recording: art('audio.voice', { files: [wav] }) }, ownParams).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'bad_input' })
  })
})
