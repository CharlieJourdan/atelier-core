// production-5 (voice): `voice.trim` shortens only the pauses over the limit and keeps every word; the narration's word
// times on the fake voice stay ≥ 90 % aligned after the trim; a voice engine falls back only for a WHOLE narration, never
// in the middle of one (production-model R3.4, ENGINE-SPEC R19.7). Real ffmpeg where needed, no Cloud, nothing paid.
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, CloudService } from '../../src/engine'
import { EngineError } from '../../src/engine/errors'
import { energyEnvelope, probe, speechRegions } from '../../src/engine/media/probe'
import { writeWav } from '../../src/engine/media/wav'
import { voiceChoices } from '../../src/engine/nodes/voice-engines'
import { mapTime, mapWords, pauseCuts, trimPauses } from '../../src/engine/nodes/voice-trim'
import { voiceTts, VoiceTtsParams } from '../../src/engine/nodes/voice-tts'
import { parseScript } from '../../src/engine/text/script'
import { MEDIA, NO_FFMPEG, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const signal = new AbortController().signal
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

const RATE = 48_000
/** Tones of `words` seconds separated by silences of `pauses` seconds (one fewer), with 0.2 s of silence at both ends. */
function synthetic(words: number[], pauses: number[]): Float32Array {
  const parts: number[] = []
  const silence = (s: number): void => void parts.push(...new Array<number>(Math.round(s * RATE)).fill(0))
  silence(0.2)
  words.forEach((w, i) => {
    const n = Math.round(w * RATE)
    for (let k = 0; k < n; k++) parts.push(0.3 * Math.min(1, k / 480, (n - k) / 480) * Math.sin((2 * Math.PI * 220 * k) / RATE))
    if (i < pauses.length) silence(pauses[i] as number)
  })
  silence(0.2)
  return Float32Array.from(parts)
}

describe('voice.trim: the cuts (pure)', () => {
  it('cuts only pauses longer than the limit, keeping half the limit on each side of the cut', () => {
    const regions = [
      { start: 0.2, end: 0.7 },
      { start: 2.2, end: 2.7 }, // 1.5 s pause before: cut to 0.6
      { start: 3.1, end: 3.6 }, // 0.4 s: kept
      { start: 4.3, end: 4.8 } // 0.7 s: cut to 0.6
    ]
    const cuts = pauseCuts(regions, 0.6)
    expect(cuts).toEqual([
      { start: 1, end: 1.9 },
      { start: 3.9, end: 4 }
    ])
    // no cut overlaps a word
    for (const c of cuts) for (const r of regions) expect(c.end <= r.start || c.start >= r.end).toBe(true)
    // times move by what was removed before them; a time inside a cut lands on its edge
    expect(mapTime(0.5, cuts)).toBe(0.5)
    expect(mapTime(2.2, cuts)).toBeCloseTo(1.3, 6)
    expect(mapTime(1.5, cuts)).toBeCloseTo(1, 6)
    expect(mapTime(4.3, cuts)).toBeCloseTo(3.3, 6)
    expect(mapWords([{ word: 'a', start: 2.2, end: 2.7 }], cuts)).toEqual([{ word: 'a', start: 1.3, end: 1.8 }])
    expect(pauseCuts(regions, 2)).toEqual([])
  })
})

describe.skipIf(!hasFfmpeg)(`voice.trim on a synthetic file (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  const media = MEDIA as NonNullable<typeof MEDIA>
  it('shortens only the pauses over 0.6 s and keeps every word whole', { timeout: 60_000 }, async () => {
    const dir = work('trim')
    const input = path.join(dir, 'in.wav')
    const words = [0.5, 0.5, 0.5, 0.5]
    const pauses = [1.5, 0.4, 0.9]
    await writeWav(input, synthetic(words, pauses), RATE)
    const before = speechRegions(await energyEnvelope(media, input, signal))
    expect(before).toHaveLength(4)

    const r = await trimPauses(media, input, dir, 0.6, signal)
    expect(r.cuts).toHaveLength(2)
    expect(r.removedS).toBeCloseTo(0.9 + 0.3, 1)
    const D0 = (await probe(media, input, signal)).durationS
    const D = (await probe(media, r.file, signal)).durationS
    expect(D).toBeCloseTo(D0 - r.removedS, 1)

    const after = speechRegions(await energyEnvelope(media, r.file, signal))
    expect(after).toHaveLength(4)
    // every word keeps its length (to two analysis frames)
    after.forEach((w, i) => expect(Math.abs(w.end - w.start - ((before[i] as { end: number; start: number }).end - (before[i] as { start: number }).start))).toBeLessThanOrEqual(0.02))
    const gaps = after.slice(1).map((w, i) => w.start - (after[i] as { end: number }).end)
    expect(gaps[0]).toBeCloseTo(0.6, 1) // 1.5 → 0.6
    expect(gaps[1]).toBeCloseTo(0.4, 1) // under the limit: untouched
    expect(gaps[2]).toBeCloseTo(0.6, 1) // 0.9 → 0.6
    // each word's start moved exactly as mapTime says
    after.forEach((w, i) => expect(Math.abs(w.start - mapTime((before[i] as { start: number }).start, r.cuts))).toBeLessThanOrEqual(0.02))
  })

  it('many cuts remove exactly their length (a 60 s narration failed by 60 ms on 2026-11-01)', { timeout: 60_000 }, async () => {
    const dir = work('trim-many')
    const input = path.join(dir, 'in.wav')
    const pauses = [1.23, 0.97, 1.41, 1.07, 0.83, 1.19, 1.37, 0.91, 1.13, 1.29, 0.87, 1.03, 1.47, 0.79]
    await writeWav(input, synthetic(pauses.map(() => 0.47).concat([0.47]), pauses), RATE)
    const r = await trimPauses(media, input, dir, 0.6, signal)
    expect(r.cuts.length).toBeGreaterThanOrEqual(12)
    const D0 = (await probe(media, input, signal)).durationS
    const D = (await probe(media, r.file, signal)).durationS
    // to one 10 ms frame, whatever the number of cuts
    expect(Math.abs(D0 - r.removedS - D)).toBeLessThanOrEqual(0.011)
  })

  it('a long narration: hundreds of cuts pass ffmpeg’s expression parser (Marcel’s 13 min voice failed on 2026-11-02)', { timeout: 120_000 }, async () => {
    // ffmpeg refuses one `aselect` sum of more than about 90 terms; a 13-minute narration has hundreds of pauses
    const dir = work('trim-long')
    const input = path.join(dir, 'in.wav')
    const pauses = Array.from({ length: 150 }, (_, i) => 0.7 + (i % 5) * 0.05)
    await writeWav(input, synthetic(pauses.map(() => 0.12).concat([0.12]), pauses), RATE)
    const r = await trimPauses(media, input, dir, 0.6, signal)
    expect(r.cuts.length).toBeGreaterThanOrEqual(140)
    const D0 = (await probe(media, input, signal)).durationS
    const D = (await probe(media, r.file, signal)).durationS
    expect(Math.abs(D0 - r.removedS - D)).toBeLessThanOrEqual(0.011)
  })

  it('a file without a long pause is left as it is', { timeout: 30_000 }, async () => {
    const dir = work('trim-none')
    const input = path.join(dir, 'in.wav')
    await writeWav(input, synthetic([0.5, 0.5], [0.3]), RATE)
    const r = await trimPauses(media, input, dir, 0.6, signal)
    expect(r).toEqual({ file: input, cuts: [], removedS: 0 })
  })

  it('the fake narration (tone voice) is trimmed before timing and stays ≥ 90 % aligned, every script word timed', { timeout: 120_000 }, async () => {
    const dir = work('align')
    const script = 'Bonjour à tous, voici l’histoire du phare.\n\nIl se dressait sur la falaise depuis très longtemps ! Personne n’y croyait.\n\nLe lendemain, tout avait changé.'
    const p = VoiceTtsParams.parse({ maxPauseS: 0.6 })
    const out = await voiceTts.fake(makeCtx(testServices(dir), { node: voiceTts }), { script: art('text.script', { value: script }) }, p)
    const meta = out.words?.meta as Record<string, unknown>
    expect(meta.matched as number).toBeGreaterThanOrEqual(0.9)
    expect(meta.alignment).not.toBe('weak')
    const words = (out.words?.value ?? []) as { w: string; start: number; end: number }[]
    expect(words.map((w) => w.w)).toEqual(parseScript(script).tokens.map((t) => t.w))
    const audio = out.audio as { files: string[]; meta: Record<string, unknown> }
    expect(audio.meta).toMatchObject({ maxPauseS: 0.6 })
    expect(audio.meta.trimmedS as number).toBeGreaterThan(0) // the tone voice leaves 0.7 s between paragraphs
    const regions = speechRegions(await energyEnvelope(media, audio.files[0] as string, signal))
    for (let i = 1; i < regions.length; i++) expect((regions[i] as { start: number }).start - (regions[i - 1] as { end: number }).end).toBeLessThanOrEqual(0.65)
  })
})

describe('voice engines: one engine per narration', () => {
  it('lists the main engine, then the fallbacks that have a clone of the channel voice', () => {
    expect(voiceChoices({ voice: 'v' })).toEqual({ choices: [{ voice: 'v' }], skipped: [] })
    expect(
      voiceChoices({ voice: 'v', engine: 'voice:elevenlabs-v2', fallbacks: ['voice:fish-s2', 'voice:ai33'], voices: { 'voice:elevenlabs-v2': 'el-1', 'voice:fish-s2': 'fish-1' } })
    ).toEqual({
      choices: [
        { engine: 'voice:elevenlabs-v2', voice: 'el-1' },
        { engine: 'voice:fish-s2', voice: 'fish-1' }
      ],
      skipped: ['voice:ai33']
    })
    // a channel voice cloned only on a fallback (ai33 before MiniMax led): that fallback leads, the main engine is skipped
    expect(voiceChoices({ voice: 'clone_1', engine: 'voice:minimax-28-hd', fallbacks: ['voice:ai33'], voices: { 'voice:ai33': 'clone_1' } })).toEqual({
      choices: [{ engine: 'voice:ai33', voice: 'clone_1' }],
      skipped: ['voice:minimax-28-hd']
    })
    // a several-voices script never falls back (its characters' ids belong to the main engine)
    expect(voiceChoices({ voice: 'v', engine: 'voice:a', fallbacks: ['voice:b'], voices: { 'voice:b': 'b' }, speakers: { ALICE: 'x' } }).skipped).toEqual(['voice:b'])
  })
})

describe.skipIf(!hasFfmpeg)('voice engines: fallback for the whole narration only', () => {
  // two paragraphs over 300 characters: several chunks with chunkChars 300, made one at a time
  const para = 'Le phare se dressait sur la falaise depuis très longtemps, battu par les vents et les vagues de l’hiver. '
  const SCRIPT = `${para.repeat(3)}\n\n${para.repeat(3)}`
  const params = (o: Record<string, unknown>): ReturnType<typeof VoiceTtsParams.parse> =>
    VoiceTtsParams.parse({ chunkChars: 300, parallel: 1, engine: 'voice:elevenlabs-v2', fallbacks: ['voice:fish-s2'], voices: { 'voice:elevenlabs-v2': 'el-1', 'voice:fish-s2': 'fish-1' }, ...o })

  /** A Cloud that answers with a short tone, and fails as `fail(engine, n)` says (n = that engine's call count). */
  function fakeCloud(fail: (engine: string, n: number) => boolean): { cloud: CloudService; calls: { engine: string; voiceId: string }[] } {
    const calls: { engine: string; voiceId: string }[] = []
    const count = new Map<string, number>()
    const unused = (): never => {
      throw new Error('not used')
    }
    const cloud: CloudService = {
      async synthesize(req, opts) {
        const engine = req.engine ?? 'default'
        const n = (count.get(engine) ?? 0) + 1
        count.set(engine, n)
        calls.push({ engine, voiceId: req.voiceId })
        if (fail(engine, n)) throw new EngineError('transient', `${engine} is down`)
        const file = path.join(opts.dir, 'tone.wav')
        await writeWav(file, synthetic([0.4, 0.4, 0.4], [0.1, 0.1]), RATE)
        return { audioFile: file, words: [], demo: true }
      },
      generateImage: unused,
      generateVideo: unused,
      talkingAvatar: unused,
      searchStock: unused
    }
    return { cloud, calls }
  }
  const run = (dir: string, cloud: CloudService, p: ReturnType<typeof params>): ReturnType<typeof voiceTts.run> =>
    voiceTts.run(makeCtx(testServices(dir, { cloud }), { node: voiceTts, where: 'cloud' }), { script: art('text.script', { value: SCRIPT }) as Artefact }, p)

  it('the main engine down before the narration starts: the fallback speaks the whole narration', { timeout: 120_000 }, async () => {
    const dir = work('fallback')
    const { cloud, calls } = fakeCloud((engine) => engine === 'voice:elevenlabs-v2')
    const out = await run(dir, cloud, params({}))
    expect((out.audio as { meta: Record<string, unknown> }).meta).toMatchObject({ engine: 'voice:fish-s2', fallback: true, voice: 'fish-1' })
    expect(calls.filter((c) => c.engine === 'voice:elevenlabs-v2')).toHaveLength(1)
    // every chunk of the narration on the fallback, with the channel voice's clone on it
    const fish = calls.filter((c) => c.engine === 'voice:fish-s2')
    expect(fish.length).toBeGreaterThanOrEqual(2)
    expect(new Set(fish.map((c) => c.voiceId))).toEqual(new Set(['fish-1']))
    expect(calls).toHaveLength(1 + fish.length)
  })

  it('a fallback in the middle of the narration is refused: the error asks to retry or change the voice', { timeout: 120_000 }, async () => {
    const dir = work('midrun')
    const { cloud, calls } = fakeCloud((engine, n) => engine === 'voice:elevenlabs-v2' && n === 2)
    await expect(run(dir, cloud, params({}))).rejects.toThrow(/au milieu de la narration.*change de voix/)
    expect(calls.some((c) => c.engine === 'voice:fish-s2')).toBe(false)
  })

  it('a chunk already in the cache locks the narration to its engine', { timeout: 120_000 }, async () => {
    const dir = work('cache-lock')
    // first run: chunk 1 is made, chunk 2 fails on the only engine
    const first = fakeCloud((_e, n) => n === 2)
    await expect(run(dir, first.cloud, params({ fallbacks: [] }))).rejects.toThrow(/is down/)
    // second run: the main engine is down at once, but chunk 1 of this narration exists on it: no switch
    const second = fakeCloud((engine) => engine === 'voice:elevenlabs-v2')
    await expect(run(dir, second.cloud, params({}))).rejects.toThrow(/au milieu de la narration/)
    expect(second.calls.some((c) => c.engine === 'voice:fish-s2')).toBe(false)
  })

  it('without an engine the node calls the Cloud as before (no engine field)', { timeout: 120_000 }, async () => {
    const dir = work('no-engine')
    const { cloud, calls } = fakeCloud(() => false)
    const out = await run(dir, cloud, VoiceTtsParams.parse({ chunkChars: 300, parallel: 1 }))
    expect(calls.every((c) => c.engine === 'default')).toBe(true)
    expect((out.audio as { meta: Record<string, unknown> }).meta.engine).toBeUndefined()
  })
})
