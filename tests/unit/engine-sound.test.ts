// sound.music@1 (docs/ENGINE-SPEC.md §26): the pure cue-sheet and envelope functions (no ffmpeg), then the node on
// synthetic voices made with ffmpeg (tone bursts as words, a 3 s gap) against the library in resources/music.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Artefact, Json } from '../../src/engine'
import { EditPlan } from '../../src/engine/formats/editplan'
import { SoundPlan } from '../../src/engine/formats/soundplan'
import { FPS, type Beat, type Word } from '../../src/engine/formats/timing'
import { energyEnvelope, probe } from '../../src/engine/media/probe'
import {
  bedEnvelope,
  boundaryCandidates,
  buildCueSheet,
  envAt,
  liftsFor,
  pickTrack,
  rng,
  softLimit,
  soundMusic,
  voicePauses,
  type LibraryTrack
} from '../../src/engine/nodes/sound-music'
import { MEDIA, NO_FFMPEG, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const word = (i: number, start: number, end: number, sentence: number): Word => ({ w: `mot${i}`, start, end, sentence, paragraph: 0 })

/** Words of 0.5 s back to back inside each speech segment; a new sentence every 6 words. */
function wordsOf(segments: [number, number][]): Word[] {
  const out: Word[] = []
  for (const [a, b] of segments) for (let t = a; t + 0.5 <= b + 1e-9; t += 0.5) out.push(word(out.length, t, t + 0.5, Math.floor(out.length / 6)))
  return out
}

function beatOf(i: number, start: number, end: number, last: number, extra: Partial<Beat> = {}): Beat {
  return { i, text: `beat ${i}`, start, end, firstWord: 0, lastWord: last, sentenceIdx: [0], paragraph: 0, tags: [], keyTerms: [], cutPoints: [], ...extra }
}

function planOf(durationS: number): EditPlan {
  const frames = Math.round(durationS * FPS)
  return EditPlan.parse({
    schema: 'atelier.editplan/1',
    fps: 30,
    size: [1920, 1080],
    frames,
    tracks: { base: ['s1'], overlay: [], labels: [] },
    captionsPreset: 'classic',
    shots: [{ id: 's1', track: 'base', startFrame: 0, endFrame: frames, kind: 'hold', role: 'base', beat: 0 }],
    chapters: [],
    diagnostics: []
  })
}

const TRACKS: LibraryTrack[] = [
  { id: 'r1', file: 'r1.m4a', mood: 'reflective' },
  { id: 'r2', file: 'r2.m4a', mood: 'reflective' },
  { id: 't1', file: 't1.m4a', mood: 'tension' },
  { id: 'h1', file: 'h1.m4a', mood: 'hopeful' }
]

describe('sound.music pure functions', () => {
  // speech 0-9, 10-19, ... with a 1 s pause every 10 s, 120 s long
  const segs: [number, number][] = Array.from({ length: 12 }, (_, i) => [i * 10, i * 10 + 9])
  const words = wordsOf(segs)
  const pauses = voicePauses(words, 120)

  it('finds the voice pauses between words and sentence breaks', () => {
    expect(pauses.slice(0, 2).map((p) => [p.start, p.end])).toEqual([[9, 10], [19, 20]])
    expect(pauses.at(-1)).toEqual({ start: 119, end: 120, sentenceBreak: true })
    expect(voicePauses(wordsOf([[0, 3]]), 3)).toEqual([])
  })

  it('lifts only in gaps of 1.5 s or more, ramps lie inside the gap', () => {
    const ps = voicePauses(wordsOf([[0, 8.5], [11.5, 20]]), 20)
    const lifts = liftsFor(ps)
    expect(lifts).toHaveLength(1)
    expect(lifts[0]!.start).toBeGreaterThanOrEqual(8.5)
    expect(lifts[0]!.end).toBeLessThan(11.5)
    expect(liftsFor(pauses)).toEqual([])
  })

  it('bed envelope: register level, +lift in the gap, back before the next word, faded ends', () => {
    const lifts = liftsFor(voicePauses(wordsOf([[0, 8.5], [11.5, 20]]), 20))
    const env = bedEnvelope({ durationS: 20, baseDb: -10, liftDb: 6, lifts, attackS: 0.3, releaseS: 0.4, fadeInS: 2, fadeOutS: 4 })
    const db = (t: number): number => 20 * Math.log10(envAt(env, Math.round(t * 48000)))
    expect(db(5)).toBeCloseTo(-10, 1)
    expect(db(10)).toBeCloseTo(-4, 1)
    expect(db(11.5)).toBeCloseTo(-10, 1) // down again when the next word starts
    expect(db(11.2)).toBeGreaterThan(-10.05)
    expect(envAt(env, 0)).toBeLessThan(1e-6)
    expect(db(0.1)).toBeLessThan(-40)
    expect(envAt(env, 20 * 48000)).toBeLessThan(1e-6)
    expect(db(19)).toBeLessThan(-12)
  })

  it('soft limiter is transparent below the knee and never passes −1 dBFS', () => {
    expect(softLimit(0.3)).toBe(0.3)
    expect(softLimit(-0.5)).toBe(-0.5)
    for (const x of [0.8, 1, 2, 10, 1000]) expect(Math.abs(softLimit(x))).toBeLessThan(10 ** (-1 / 20))
    expect(softLimit(-5)).toBeLessThan(0)
  })

  it('seeded generator is deterministic', () => {
    const a = rng(7)
    const b = rng(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(rng(8)()).not.toBe(rng(7)())
  })

  it('boundary candidates: chapters, pivots, disclosures, deduplicated', () => {
    const beats = [
      beatOf(0, 0, 10, 5, { chapter: 'Intro' }),
      beatOf(1, 10, 20, 10, { tags: ['pivot'] }),
      beatOf(2, 20, 30, 15, { tags: ['disclosure'] }),
      beatOf(3, 30, 40, 20, { chapter: 'Suite' })
    ]
    const c = boundaryCandidates(beats, [30.4, 55])
    expect(c.map((b) => [b.t, b.kind])).toEqual([[10, 'pivot'], [20, 'disclosure'], [30, 'chapter'], [55, 'chapter']])
  })

  const sheetInput = (o: Partial<Parameters<typeof buildCueSheet>[0]> = {}): Parameters<typeof buildCueSheet>[0] => ({
    durationS: 120,
    pauses,
    boundaries: [{ t: 40, kind: 'chapter' }, { t: 80, kind: 'pivot' }],
    tracks: TRACKS,
    minCueS: 25,
    crossfadeS: 1.5,
    seed: 3,
    ...o
  })

  it('cue sheet: sections follow the boundaries, changes inside pauses, no track twice in a row, deterministic', () => {
    const cues = buildCueSheet(sheetInput())
    expect(cues).toHaveLength(3)
    expect(cues[0]).toMatchObject({ start: 0, fadeIn: 0 })
    expect(cues.at(-1)).toMatchObject({ end: 120, fadeOut: 0 })
    for (let i = 1; i < cues.length; i++) {
      const c = cues[i]!
      expect(c.trackId).not.toBe(cues[i - 1]!.trackId)
      expect(cues[i - 1]!.end).toBeCloseTo(c.start + c.fadeIn, 9)
      expect(cues[i - 1]!.fadeOut).toBe(c.fadeIn)
      expect(pauses.some((p) => p.start <= c.start + 1e-9 && c.start + c.fadeIn <= p.end + 1e-9)).toBe(true)
    }
    expect(cues[2]!.mood).toBe('tension') // the pivot asks for tension
    expect(buildCueSheet(sheetInput())).toEqual(cues)
  })

  it('cue sheet: a short video keeps one cue, close boundaries are dropped, no library gives no cue', () => {
    expect(buildCueSheet(sheetInput({ durationS: 40, boundaries: [{ t: 30, kind: 'chapter' }] }))).toHaveLength(1)
    expect(buildCueSheet(sheetInput({ boundaries: [{ t: 40, kind: 'chapter' }, { t: 50, kind: 'chapter' }] }))).toHaveLength(2)
    expect(buildCueSheet(sheetInput({ tracks: [] }))).toEqual([])
  })

  it('cue sheet: a library of one track never repeats it (one cue)', () => {
    expect(buildCueSheet(sheetInput({ tracks: [TRACKS[0]!] }))).toHaveLength(1)
  })

  it('cue sheet: very long sections are split at sentence starts', () => {
    const long = wordsOf(Array.from({ length: 80 }, (_, i) => [i * 10, i * 10 + 9] as [number, number]))
    const cues = buildCueSheet(sheetInput({ durationS: 800, pauses: voicePauses(long, 800), boundaries: [] }))
    expect(cues.length).toBeGreaterThanOrEqual(3)
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(310)
  })

  it('track choice: nearest mood when a shelf is empty, the preferred mood opens the film', () => {
    const rand = rng(1)
    expect(pickTrack(TRACKS.filter((t) => t.mood !== 'tension'), 'tension', undefined, rand)?.mood).toBe('reflective')
    expect(pickTrack(TRACKS, 'hopeful', 'h1', rand)?.mood).toBe('reflective')
    expect(pickTrack([], 'hopeful', undefined, rand)).toBeNull()
    expect(buildCueSheet(sheetInput({ mood: 'hopeful' }))[0]!.mood).toBe('hopeful')
  })
})

describe('sound.music node', () => {
  const tmp = tempDir('sound')
  let voice20 = ''
  let voice120 = ''
  const meta = (durationS: number): Record<string, Json> => ({ durationS, alignment: 'provider', matched: 1, language: 'fr' })
  const j = (v: unknown): Json => v as Json

  async function makeVoice(file: string, expr: string, seconds: number): Promise<void> {
    await MEDIA!.run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=${seconds}`, file], { signal: new AbortController().signal })
  }

  beforeAll(async () => {
    mkdirSync(tmp.dir, { recursive: true })
    if (!hasFfmpeg) return
    voice20 = path.join(tmp.dir, 'voice20.wav')
    voice120 = path.join(tmp.dir, 'voice120.wav')
    await makeVoice(voice20, '0.3*sin(2*PI*220*t)*(lt(t,8.5)+gte(t,11.5))', 20)
    await makeVoice(voice120, '0.3*sin(2*PI*220*t)*lt(mod(t,10),9)', 120)
  }, 60_000)
  afterAll(() => tmp.cleanup())

  function inputs20(): Record<string, Artefact> {
    const words = wordsOf([[0, 8.5], [11.5, 20]])
    return {
      voice: art('audio.voice', { files: [voice20], meta: { durationS: 20 } }),
      words: art('json.words', { value: j(words), meta: meta(20) }),
      beats: art('json.beats', { value: j([beatOf(0, 0, 20, words.length - 1)]) }),
      plan: art('json.editplan', { value: j(planOf(20)) })
    }
  }

  function inputs120(): Record<string, Artefact> {
    const words = wordsOf(Array.from({ length: 12 }, (_, i) => [i * 10, i * 10 + 9] as [number, number]))
    const beats = Array.from({ length: 12 }, (_, i) =>
      beatOf(i, i * 10, i * 10 + 10, words.length - 1, i === 4 ? { chapter: 'Deuxième partie' } : i === 8 ? { chapter: 'Troisième partie' } : {})
    )
    return {
      voice: art('audio.voice', { files: [voice120], meta: { durationS: 120 } }),
      words: art('json.words', { value: j(words), meta: meta(120) }),
      beats: art('json.beats', { value: j(beats) }),
      plan: art('json.editplan', { value: j(planOf(120)) })
    }
  }

  const power = (env: Float32Array, from: number, to: number): number => {
    let sum = 0
    let n = 0
    for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) {
      sum += 10 ** ((env[i] as number) / 10)
      n++
    }
    return 10 * Math.log10(sum / n + 1e-12)
  }

  it('declares its ports and a cheap, pure estimate', () => {
    expect(soundMusic.type).toBe('sound.music@1')
    // clone-reddit-shorts: the channel's own track, optional
    expect(Object.keys(soundMusic.inputs)).toEqual(['voice', 'words', 'beats', 'plan', 'track'])
    expect(soundMusic.inputs.track?.required).toBe(false)
    expect(soundMusic.outputs).toEqual({ music: 'audio.music', soundplan: 'json.soundplan' })
    const est = soundMusic.estimate({ where: 'local', budgetMode: 'usage_max', minutes: 10, inputs: { words: { type: 'json.words', meta: { durationS: 400 } } } }, {})
    expect(est).toEqual({ units: [], durationS: 25 })
    expect(soundMusic.estimate({ where: 'local', budgetMode: 'usage_max', minutes: 10, inputs: {} }, {}).durationS).toBe(35)
  })

  it.skipIf(!hasFfmpeg)(NO_FFMPEG + ': the bed is D long, stereo 48 kHz, lifted in the gap, faded in, deterministic', async () => {
    const ctx = makeCtx(testServices(tmp.dir), { seed: 11 })
    const params = soundMusic.params.parse({ register: 'driven' })
    const out = await soundMusic.run(ctx, inputs20(), params)
    const file = out.music!.files![0]!
    const info = await probe(MEDIA!, file, ctx.signal)
    expect(Math.abs(info.durationS - 20)).toBeLessThan(0.01)
    expect(info.streams[0]).toMatchObject({ codec_name: 'flac', channels: 2, sample_rate: '48000' })
    expect(out.music!.meta).toEqual({ durationS: 20, demo: false })

    const plan = SoundPlan.parse(out.soundplan!.value)
    expect(plan).toMatchObject({ register: 'driven', bedDb: -11, liftDb: 6, durationS: 20, fadeInS: 2, fadeOutS: 4 })
    expect(plan.cues).toHaveLength(1)
    expect(plan.ducking.lifts).toHaveLength(1)

    const env = await energyEnvelope(MEDIA!, file, ctx.signal)
    const speech = (power(env, 3, 8) + power(env, 12.5, 16)) / 2
    const gap = power(env, 9.2, 10.9)
    expect(gap - speech).toBeGreaterThan(4)
    expect(gap - speech).toBeLessThan(8)
    expect(power(env, 0, 0.1)).toBeLessThan(power(env, 2.9, 3.1) - 15)
    expect(power(env, 19.8, 20)).toBeLessThan(power(env, 12.5, 16) - 15)

    // same inputs and seed: same plan
    const again = await soundMusic.fake(makeCtx(testServices(tmp.dir), { seed: 11 }), inputs20(), params)
    expect(again.soundplan!.value).toEqual(out.soundplan!.value)
  }, 60_000)

  it.skipIf(!hasFfmpeg)(NO_FFMPEG + ': the bed level follows the register', async () => {
    const run = async (register: 'sparse' | 'dense') => {
      const ctx = makeCtx(testServices(tmp.dir), { seed: 11 })
      const out = await soundMusic.run(ctx, inputs20(), soundMusic.params.parse({ register }))
      return power(await energyEnvelope(MEDIA!, out.music!.files![0]!, ctx.signal), 3, 8)
    }
    const quiet = await run('sparse')
    const loud = await run('dense')
    expect(loud - quiet).toBeGreaterThan(5)
    expect(loud - quiet).toBeLessThan(11)
  }, 60_000)

  it.skipIf(!hasFfmpeg)(NO_FFMPEG + ': 120 s with two chapters: three cues, never the same track twice, changes inside pauses', async () => {
    const ctx = makeCtx(testServices(tmp.dir), { seed: 5 })
    const inp = inputs120()
    const out = await soundMusic.run(ctx, inp, soundMusic.params.parse({}))
    const plan = SoundPlan.parse(out.soundplan!.value)
    expect(plan.cues).toHaveLength(3)
    const pauses = voicePauses(inp.words!.value as unknown as Word[], 120)
    for (let i = 1; i < plan.cues.length; i++) {
      const c = plan.cues[i]!
      expect(c.trackId).not.toBe(plan.cues[i - 1]!.trackId)
      expect(pauses.some((p) => p.start <= c.start + 1e-9 && c.start + c.fadeIn <= p.end + 1e-9)).toBe(true)
    }
    const info = await probe(MEDIA!, out.music!.files![0]!, ctx.signal)
    expect(Math.abs(info.durationS - 120)).toBeLessThan(0.01)
    // another seed may pick other tracks but keeps the structure
    const other = SoundPlan.parse((await soundMusic.run(makeCtx(testServices(tmp.dir), { seed: 6 }), inputs120(), soundMusic.params.parse({}))).soundplan!.value)
    expect(other.cues.map((c) => [c.start, c.end])).toEqual(plan.cues.map((c) => [c.start, c.end]))
  }, 120_000)

  it.skipIf(!hasFfmpeg)(NO_FFMPEG + ': a missing library gives a silent bed of D seconds and a warning, not an error', async () => {
    const empty = path.join(tmp.dir, 'no-library')
    mkdirSync(empty, { recursive: true })
    const ctx = makeCtx(testServices(tmp.dir, { library: { root: empty } }))
    const out = await soundMusic.run(ctx, inputs20(), soundMusic.params.parse({}))
    const file = out.music!.files![0]!
    const info = await probe(MEDIA!, file, ctx.signal)
    expect(Math.abs(info.durationS - 20)).toBeLessThan(0.01)
    const plan = SoundPlan.parse(out.soundplan!.value)
    expect(plan.cues).toEqual([])
    expect(plan.warnings.length).toBeGreaterThan(0)
    expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn')).toBe(true)
    const env = await energyEnvelope(MEDIA!, file, ctx.signal)
    expect(power(env, 0, 20)).toBeLessThan(-90)
  }, 60_000)

  it.skipIf(!hasFfmpeg)(NO_FFMPEG + ': a library whose only track is unreadable gives a silent bed and a warning', async () => {
    const root = path.join(tmp.dir, 'broken-library')
    mkdirSync(path.join(root, 'music'), { recursive: true })
    writeFileSync(path.join(root, 'music', 'bad.m4a'), 'not audio')
    writeFileSync(
      path.join(root, 'music', 'library.json'),
      JSON.stringify({ tracks: [{ id: 'bad', file: 'bad.m4a', mood: 'reflective' }] })
    )
    const ctx = makeCtx(testServices(tmp.dir, { library: { root } }))
    const out = await soundMusic.run(ctx, inputs20(), soundMusic.params.parse({}))
    const plan = SoundPlan.parse(out.soundplan!.value)
    expect(plan.cues).toEqual([])
    expect(plan.warnings.length).toBeGreaterThan(0)
    const info = await probe(MEDIA!, out.music!.files![0]!, ctx.signal)
    expect(Math.abs(info.durationS - 20)).toBeLessThan(0.01)
  }, 60_000)

  it.skipIf(!hasFfmpeg)(NO_FFMPEG + ': cancel stops the node', async () => {
    const ac = new AbortController()
    const ctx = makeCtx(testServices(tmp.dir), { signal: ac.signal })
    ac.abort()
    await expect(soundMusic.run(ctx, inputs20(), soundMusic.params.parse({}))).rejects.toThrow()
  }, 30_000)
})
