// controles-bloquants (decision 0102): every real error is a check measured by code, tested on a fixture that has the defect and one
// that does not; a film with a real error left is refused; the clone's recipes refuse only on the full example. Pure, no ffmpeg.
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EditPlan, Shot } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { EngineError } from '../../src/engine/errors'
import { ENERGY_FRAME_S } from '../../src/engine/media/probe'
import type { RunCtx } from '../../src/engine/registry'
import { renderReviewed } from '../../src/engine/review'
import { BLOCKING_KINDS, isBlocking, refusalText } from '../../src/engine/review/blocking'
import { blackDefects, frameDuplicates, parseBlackStretches } from '../../src/engine/review/blocking-film'
import { musicGapDb, musicLoudDefect, soundHoles, timingDrift, wordsCut } from '../../src/engine/review/blocking-sound'
import { voiceDefects } from '../../src/engine/review/media'
import { mixFilter } from '../../src/engine/render/final'
import { asWords } from '../../src/engine/review/voice-holes'
import { withBlocking } from '../../src/main/production/clone/compare/runner'

const F = 30
const shot = (id: string, a: number, b: number, extra: Partial<Shot> = {}): Shot => ({ id, track: 'base', startFrame: a * F, endFrame: b * F, kind: 'stock.photo', transitionIn: 'cut', role: 'scene', beat: 0, ...extra })
const planOf = (base: Shot[]): EditPlan => ({
  schema: 'atelier.editplan/1', fps: 30, size: [1920, 1080], frames: (base.at(-1) as Shot).endFrame,
  tracks: { base: base.map((s) => s.id), overlay: [], labels: [] }, shots: base, captionsPreset: 'none', chapters: [], diagnostics: []
}) as unknown as EditPlan

/** `n` words of 0.36 s every 0.4 s from `from` (a steady narrator). */
const words = (n: number, from = 0.5, step = 0.4): Word[] =>
  Array.from({ length: n }, (_, k) => ({ w: `mot${k}`, start: from + k * step, end: from + k * step + step * 0.9, sentence: 0, paragraph: 0 }))
/** An energy envelope of `s` seconds at `db`, then `paint` sets stretches. */
const env = (s: number, db: number): Float32Array => new Float32Array(Math.round(s / ENERGY_FRAME_S)).fill(db)
const paint = (e: Float32Array, a: number, b: number, db: number): Float32Array => {
  e.fill(db, Math.round(a / ENERGY_FRAME_S), Math.round(b / ENERGY_FRAME_S))
  return e
}
/** The voice of `ws`: -20 dB on each word, -70 between. */
const voiceOf = (ws: readonly Word[], s: number): Float32Array => {
  const e = env(s, -70)
  for (const w of ws) paint(e, w.start, w.end, -20)
  return e
}

describe('real errors and style: what blocks', () => {
  it('every real error Charlie named blocks; what a model judges or a style choice never does', () => {
    for (const k of ['audio_dropout', 'word_cut', 'sound_hole', 'music_loud', 'frozen', 'black', 'duplicate', 'text_unsaid', 'text_form', 'text_language', 'map_legend', 'timing_drift'] as const) expect(BLOCKING_KINDS.has(k)).toBe(true)
    for (const k of ['off_subject', 'hook_slow', 'text_late', 'audio_click'] as const) expect(isBlocking({ kind: k })).toBe(false)
    const text = refusalText([{ kind: 'audio_dropout', severity: 'fail', atS: 224.61, endS: 225.14, detail: 'La voix se coupe dans « C’est ».' }])
    expect(text).toContain('3:44.6')
    expect(text).toContain('Vidéo refusée')
  })
})

describe('music too loud under the voice (Le Monde en POV: 7 dB under, 14 wanted)', () => {
  const ws = words(300)
  const voice = voiceOf(ws, 125)
  it('measured on the stems under the words: a bed 7 dB under the voice is refused with how much to lower it', () => {
    const music = env(125, -27)
    expect(musicGapDb(voice, music, ws)).toBeCloseTo(7, 0)
    const d = musicLoudDefect(voice, music, ws)
    expect(d?.kind).toBe('music_loud')
    expect(d?.needDb).toBeCloseTo(7, 0)
  })
  it('a bed 18 dB under the voice passes, even when it lifts in the pauses (the lifts are by design)', () => {
    const music = env(125, -38)
    for (const [i, w] of ws.entries()) if (i % 10 === 9) paint(music, w.end, w.end + 0.04, -22)
    expect(musicLoudDefect(voice, music, ws)).toBeNull()
  })
  it('the repair is a gain on the bed in the final mix', () => {
    expect(mixFilter(true, -8)).toContain('volume=-8.00dB[mu]')
    expect(mixFilter(true)).not.toContain('volume=')
  })
})

describe('holes in the sound', () => {
  it('2 s of nothing in the middle of the film is a hole; 1 s, a fade at the ends, or a quiet bed are not', () => {
    const mix = paint(env(30, -25), 10, 12, -80)
    expect(soundHoles(mix, 30).map((d) => [d.kind, d.atS])).toEqual([['sound_hole', 10]])
    expect(soundHoles(paint(env(30, -25), 10, 11, -80), 30)).toEqual([])
    expect(soundHoles(paint(paint(env(30, -25), 0, 0.4, -90), 28.6, 30, -90), 30)).toEqual([])
    expect(soundHoles(env(30, -45), 30)).toEqual([])
  })
})

describe('the voice cut inside a word (the Japanese example: 13 holes of 0.12–0.31 s)', () => {
  const ws: Word[] = [{ w: 'appartient', start: 1, end: 1.8, sentence: 0, paragraph: 0 }, ...words(40, 2.2)]
  it('a word whose sound stops 0.25 s after 0.1 s and comes back is cut', () => {
    const v = voiceOf(ws, 20)
    paint(v, 1.1, 1.35, -90)
    expect(voiceDefects(v, ws).filter((d) => d.kind === 'audio_dropout').map((d) => d.said)).toEqual(['appartient'])
  })
  it('a pause after a word whose recognised time stretches over it is not (the sound that comes back is the next word)', () => {
    const ws2: Word[] = [{ w: 'encore', start: 1, end: 1.8, sentence: 0, paragraph: 0 }, { w: 'demain', start: 1.4, end: 1.9, sentence: 0, paragraph: 0 }, ...words(40, 2.2)]
    const v = voiceOf(ws2, 20)
    paint(v, 1.15, 1.4, -90)
    expect(voiceDefects(v, ws2).filter((d) => d.kind === 'audio_dropout')).toEqual([])
  })
  it('the same word said whole is not', () => {
    expect(voiceDefects(voiceOf(ws, 20), ws).filter((d) => d.kind === 'audio_dropout')).toEqual([])
  })
  it('the provider’s word times feed the same check on every take voice.tts receives', () => {
    expect(asWords([{ word: 'Bonjour', start: 0, end: 0.5 }, { word: ' ', start: 0.5, end: 0.6 }])).toEqual([{ w: 'Bonjour', start: 0, end: 0.5, sentence: 0, paragraph: 0 }])
  })
})

describe('words the film cuts off', () => {
  it('a film that ends while a word is said cuts it; one that ends after the last word does not', () => {
    const ws = words(10)
    expect(wordsCut(ws, 3.5)?.kind).toBe('word_cut')
    expect(wordsCut(ws, 3.5)?.said?.split(' ').length).toBe(3)
    expect(wordsCut(ws, 5)).toBeNull()
  })
})

describe('word times that drift from the voice (Reddit: subtitles drift)', () => {
  const phrases = (shift: number): { ws: Word[]; voice: Float32Array } => {
    const ws: Word[] = []
    const voice = env(80, -70)
    for (let p = 0; p < 12; p++) {
      const a = 1 + p * 6
      for (let k = 0; k < 8; k++) ws.push({ w: `m${p}-${k}`, start: a + k * 0.5, end: a + k * 0.5 + 0.45, sentence: p, paragraph: 0 })
      paint(voice, a + shift, a + shift + 4, -20)
    }
    return { ws, voice }
  }
  it('times 0.8 s early on every phrase drift', () => {
    const { ws, voice } = phrases(0.8)
    expect(timingDrift(voice, ws)?.kind).toBe('timing_drift')
  })
  it('times on the voice do not', () => {
    const { ws, voice } = phrases(0)
    expect(timingDrift(voice, ws)).toBeNull()
  })
})

describe('black pictures and repeated pictures, on the film itself', () => {
  it('reads blackdetect; a 1 s black is an error, a 3-frame fade is not', () => {
    const found = parseBlackStretches('[blackdetect @ 0x1] black_start:12.4 black_end:13.4 black_duration:1\n[blackdetect @ 0x1] black_start:40 black_end:40.1 black_duration:0.1')
    expect(blackDefects(found).map((d) => d.atS)).toEqual([12.4])
  })
  const grey = (seed: number): number[] => Array.from({ length: 32 * 18 }, (_, i) => (i * 37 + seed * 101 + ((i * seed) % 23) * 9) % 256)
  const plan = planOf([shot('a', 0, 4), shot('b', 4, 8), shot('c', 8, 12), shot('m', 12, 16, { kind: 'motion' }), shot('n', 16, 20, { kind: 'motion' })])
  it('the same picture again 4 s later is a duplicate, fixed by giving its time to a neighbour', () => {
    const d = frameDuplicates(plan, [{ shotId: 'a', grey: grey(1) }, { shotId: 'b', grey: grey(2) }, { shotId: 'c', grey: grey(1) }], { dropFor: (id) => ({ op: 'drop', shotId: id, into: 'b' }) })
    expect(d.map((x) => [x.kind, x.shotId, x.fix?.op])).toEqual([['duplicate', 'c', 'drop']])
  })
  it('different pictures, two shots of one clip side by side, and drawn cards of one template are not', () => {
    expect(frameDuplicates(plan, [{ shotId: 'a', grey: grey(1) }, { shotId: 'b', grey: grey(2) }, { shotId: 'c', grey: grey(3) }])).toEqual([])
    const clip = planOf([shot('a', 0, 4, { kind: 'stock.video', genItem: 'k' }), shot('b', 4, 8, { kind: 'stock.video', genItem: 'k' })])
    expect(frameDuplicates(clip, [{ shotId: 'a', grey: grey(1) }, { shotId: 'b', grey: grey(1) }])).toEqual([])
    expect(frameDuplicates(plan, [{ shotId: 'm', grey: grey(4) }, { shotId: 'n', grey: grey(4) }])).toEqual([])
  })
  it('two shots of one continuing clip (one group) and demo drawings the render did not compare are not', () => {
    const two = planOf([shot('a', 0, 4, { kind: 'stock.video', genItem: 'k1' }), shot('b', 4, 8, { kind: 'stock.video', genItem: 'k2' })])
    const same = [{ shotId: 'a', grey: grey(1) }, { shotId: 'b', grey: grey(1) }]
    expect(frameDuplicates(two, same, { seen: [{ id: 'a', source: 'x', grey: grey(1), group: 'g' }, { id: 'b', source: 'y', grey: grey(1), group: 'g' }] })).toEqual([])
    expect(frameDuplicates(two, same, { seen: [{ id: 'a', source: 'x' }, { id: 'b', source: 'y' }] })).toEqual([])
    expect(frameDuplicates(two, same, { seen: [{ id: 'a', source: 'x', grey: grey(1) }, { id: 'b', source: 'y', grey: grey(1) }] }).length).toBe(1)
  })
})

describe('a film with a real error left is never delivered', () => {
  const ctx = { services: {}, signal: new AbortController().signal, emit: () => undefined } as unknown as RunCtx
  const plan = planOf([shot('a', 0, 3, { motion: { kind: 'push', from: 1, to: 1.09, ease: 'linear' } } as Partial<Shot>)])
  const base = { ctx, plan, words: words(10), voice: 'v.flac', music: false, rounds: 2, look: false, clipS: () => undefined, isCard: () => false, dir: mkdtempSync(path.join(os.tmpdir(), 'blocking-')), render: async () => ({ file: 'f.mp4', seen: [] }) }
  it('refused (the default): the render fails with the errors and their times', async () => {
    const e = await renderReviewed(base).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(EngineError)
    expect((e as EngineError).code).toBe('verify_failed')
    expect((e as Error).message).toContain('mot(s) coupé(s)')
  })
  it('reported (a comparison round): the report lists it as blocked', async () => {
    const r = await renderReviewed({ ...base, blocking: 'report' })
    expect(r.report.blocked?.map((d) => d.kind)).toEqual(['word_cut'])
  })
  it('a film without one is delivered', async () => {
    const r = await renderReviewed({ ...base, words: words(6) })
    expect(r.report.blocked).toEqual([])
  })
})

describe('the clone refuses only the full example', () => {
  it('sets the render’s blocking mode in the compiled recipe', () => {
    const recipe = { bricks: [{ tech: 'voice.tts@1', settings: {} }, { tech: 'render.assemble@1', settings: { crf: 18 } }] }
    const out = withBlocking(recipe, 'report') as typeof recipe
    expect(out.bricks[1]?.settings).toEqual({ crf: 18, editBlocking: 'report' })
    expect(out.bricks[0]?.settings).toEqual({})
    expect(recipe.bricks[1]?.settings).toEqual({ crf: 18 })
  })
})
