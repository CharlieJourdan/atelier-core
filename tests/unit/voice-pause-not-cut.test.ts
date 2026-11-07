// The voice check (record 0102) and the pause after a comma (avatar-base-marcel, 2026-11-05): the final check refused all three
// avatar examples for « La voix se coupe dans « par » / « Sie » … », but the sound before each « hole » was the PREVIOUS word fading
// out, then the pause the text has (a comma, a full stop), with Whisper starting the next word inside that pause. The frames are the
// measured voices (dB per 10 ms frame, ai33 clones as rendered, Whisper's word times), the rest of each voice at its measured room
// tone (10th percentile: Marcel -67 dB, Klaus -71 dB): the pause must pass; real cuts — digital silence, a word stopping at its level,
// a cut with a 20–30 ms fade in connected speech (the independent review's cases) — must still fail.
import { describe, expect, it } from 'vitest'
import type { Word } from '../../src/engine/formats/timing'
import { voiceDefects } from '../../src/engine/review/media'

const ROOM = -73
const MARCEL_FLOOR = -67
const KLAUS_FLOOR = -71
const w = (word: string, start: number, end: number): Word => ({ w: word, start, end, sentence: 0, paragraph: 0 })

/** A voice of `seconds` at the room tone with the measured frames placed from `fromS`, and speech at -12 dB over [a, b) spans. */
function voice(seconds: number, fromS: number, frames: readonly number[], speech: readonly [number, number][] = [], floor = ROOM): Float32Array {
  const env = new Float32Array(Math.round(seconds * 100)).fill(floor)
  for (const [a, b] of speech) for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) env[i] = -12
  frames.forEach((db, k) => (env[Math.round(fromS * 100) + k] = db))
  return env
}
const cutAt = (env: Float32Array, a: number, b: number, db = -90): Float32Array => {
  for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) env[i] = db
  return env
}
const dropouts = (env: Float32Array, words: readonly Word[], pauseMaxS?: number) =>
  voiceDefects(env, words, pauseMaxS !== undefined ? { pauseMaxS } : {}).filter((d) => d.kind === 'audio_dropout').map((d) => d.said)

// Marcel (fr), run 14 at 2.2–3.7 s: « Un, | par une journée sèche » — the release fades to 2.83 s, the pause, then « par ».
const MARCEL_FROM = 2.2
const MARCEL = [
  -72, -74, -76, -74, -72, -74, -75, -74, -73, -72, -64, -56, -49, -45, -43, -39, -38, -37, -35, -34, -36, -37, -37, -38, -38, -38, -37, -35, -37, -45,
  -51, -59, -65, -69, -73, -69, -73, -74, -74, -73, -74, -33, -12, -12, -12, -11, -12, -11, -12, -11, -13, -12, -12, -12, -14, -14, -14, -14, -15, -19,
  -24, -30, -41, -53, -60, -59, -62, -66, -66, -69, -69, -72, -74, -73, -73, -75, -76, -72, -75, -74, -72, -68, -68, -62, -59, -54, -52, -51, -48, -46,
  -44, -44, -43, -42, -44, -45, -46, -51, -55, -56, -45, -51, -58, -59, -67, -70, -66, -23, -17, -10, -11, -12, -13, -13, -14, -15, -17, -18, -18, -16,
  -13, -11, -11, -12, -12, -12, -11, -12, -12, -12, -12, -11, -12, -12, -14, -16, -18, -18, -18, -17, -16, -14, -11, -10, -12, -12, -14, -15, -15, -12
]
const MARCEL_WORDS = [w('Un,', 1.9, 2.2), w('par', 2.78, 3.28), w('une', 3.28, 3.44), w('journée', 3.44, 3.74), w('sèche,', 3.74, 4.2), w('vous', 4.4, 4.7)]
const marcel = (): Float32Array => voice(6, MARCEL_FROM, MARCEL, [[3.7, 4.2], [4.4, 4.7]], MARCEL_FLOOR)

// Klaus (de), run 15 at 1.4–2.98 s: « fertig, | Sie machen die » — « -tig » fades from 2.0 s, the pause, then the « S ».
const KLAUS_FROM = 1.4
const KLAUS = [
  -31, -35, -35, -35, -30, -27, -32, -16, -17, -15, -14, -14, -15, -18, -14, -14, -17, -18, -14, -15, -16, -18, -15, -17, -26, -27, -34, -41, -47, -55,
  -59, -32, -24, -28, -22, -12, -11, -11, -12, -11, -10, -12, -12, -12, -12, -14, -16, -22, -29, -28, -27, -26, -26, -26, -26, -26, -26, -27, -27, -26,
  -29, -32, -36, -42, -47, -51, -58, -62, -68, -67, -71, -71, -73, -74, -73, -74, -73, -75, -77, -75, -77, -79, -75, -78, -77, -76, -76, -76, -78, -71,
  -71, -70, -65, -59, -53, -46, -39, -37, -35, -35, -35, -37, -38, -40, -43, -46, -49, -58, -62, -49, -37, -28, -25, -22, -20, -17, -16, -15, -14, -12,
  -12, -12, -12, -14, -18, -13, -13, -12, -12, -12, -12, -12, -14, -14, -13, -14, -14, -14, -17, -18, -23, -26, -27, -28, -31, -32, -32, -13, -11, -11
]
const KLAUS_WORDS = [w('ist', 1.04, 1.28), w('fertig,', 1.28, 1.72), w('Sie', 1.96, 2.52), w('machen', 2.52, 2.74), w('die', 2.74, 3.0), w('Tür', 3.0, 3.4)]
const klaus = (): Float32Array => voice(6, KLAUS_FROM, KLAUS, [[2.98, 3.4]], KLAUS_FLOOR)

describe('a pause after a comma is not a cut (French, Marcel)', () => {
  it('« Un, | par »: the previous word fading into the pause, Whisper starting « par » inside it, passes', () => {
    expect(dropouts(marcel(), MARCEL_WORDS)).toEqual([])
  })
  it('the same voice with digital silence inside « journée » still fails', () => {
    expect(dropouts(cutAt(marcel(), 3.48, 3.62), MARCEL_WORDS)).toEqual(['journée'])
  })
  it('« journée » stopping at once at its own level, the gap at the room tone, still fails', () => {
    expect(dropouts(cutAt(marcel(), 3.48, 3.62, ROOM), MARCEL_WORDS)).toEqual(['journée'])
  })
  it('the comma pause turned into digital silence (under the room tone) is a cut, not a pause', () => {
    expect(dropouts(cutAt(marcel(), 2.84, 3.07), MARCEL_WORDS)).toEqual(['par'])
  })
})

describe('a pause after a comma is not a cut (German, Klaus)', () => {
  it('« fertig, | Sie »: « -tig » fading into the pause, Whisper starting « Sie » inside it, passes', () => {
    expect(dropouts(klaus(), KLAUS_WORDS)).toEqual([])
  })
  it('the same voice with digital silence inside « fertig » still fails', () => {
    expect(dropouts(cutAt(klaus(), 1.52, 1.68), KLAUS_WORDS)).toEqual(['fertig,'])
  })
  it('« Tür » stopping at once at its own level, the gap at the room tone, still fails (a cut, not a release)', () => {
    expect(dropouts(cutAt(klaus(), 3.12, 3.3, ROOM), KLAUS_WORDS)).toEqual(['Tür'])
    expect(dropouts(cutAt(klaus(), 3.12, 3.3), KLAUS_WORDS)).toEqual(['Tür'])
  })
})

/** Connected narration (no punctuation between the words), -12 dB, room tone -73: a cut at 1.81 s inside « m2 » (1.7–2.3 s), shaped as given. */
function connected(fade: readonly number[], holeDb = ROOM): { env: Float32Array; words: Word[] } {
  const env = voice(5, 0, [], [[0.5, 3.5]])
  fade.forEach((db, k) => (env[181 + k] = db))
  cutAt(env, (181 + fade.length) / 100, 2.06, holeDb)
  return { env, words: [w('mot', 0.5, 1.1), w('encore', 1.1, 1.7), w('m2', 1.7, 2.3), w('suite', 2.3, 2.9), w('fin', 2.9, 3.5)] }
}
const pretty = (words: Word[], names: string[]) => words.map((x, k) => ({ ...x, w: names[k] as string }))

describe('a real cut in connected speech still fails, whatever its fade (French and German)', () => {
  const cases: [string, number[], number?][] = [
    ['a TTS dropout fading over 30 ms', [-25, -40, -55]],
    ['a hard cut smeared over two frames', [-40, -52]],
    ['a truncated word fading over 50 ms', [-18, -24, -32, -40, -52]],
    ['a dropout into digital zero (-120 dB)', [-25, -40, -55], -120]
  ]
  for (const [what, fade, holeDb] of cases) {
    it(`fr: ${what}`, () => {
      const c = connected(fade, holeDb)
      expect(dropouts(c.env, pretty(c.words, ['vous', 'mettez', 'ventilation', 'seule', 'ensuite']))).toEqual(['ventilation'])
    })
    it(`de: ${what}`, () => {
      const c = connected(fade, holeDb)
      expect(dropouts(c.env, pretty(c.words, ['Sie', 'drehen', 'Flügelrad', 'vorsichtig', 'dann']))).toEqual(['Flügelrad'])
    })
  }
  it('right after a comma, digital zero where the pause should be is still a cut', () => {
    const env = marcel()
    cutAt(env, 2.84, 3.07, -120)
    expect(dropouts(env, MARCEL_WORDS)).toEqual(['par'])
  })
  it('the same pause without a comma in the text is still refused (the text has no pause there)', () => {
    expect(dropouts(marcel(), MARCEL_WORDS.map((x) => (x.w === 'Un,' ? { ...x, w: 'Un' } : x)))).toEqual(['par'])
  })
})

describe('after a comma too, a cut stays a cut (second independent review)', () => {
  const comma = (fade: number[], holeDb = ROOM) => {
    const c = connected(fade, holeDb)
    return { env: c.env, words: pretty(c.words, ['vous', 'encore,', 'ventilation', 'seule', 'ensuite']) }
  }
  const de = (fade: number[], holeDb = ROOM) => {
    const c = connected(fade, holeDb)
    return { env: c.env, words: pretty(c.words, ['Sie', 'dann,', 'Flügelrad', 'vorsichtig', 'drehen']) }
  }
  for (const [what, fade] of [
    ['a dropout fading over 30 ms', [-25, -40, -55]],
    ['a hard cut smeared over two frames', [-40, -52]],
    ['a truncated word fading over 50 ms', [-18, -24, -32, -40, -52]]
  ] as [string, number[]][]) {
    it(`fr: ${what}, the previous word ending with a comma`, () => {
      const c = comma(fade)
      expect(dropouts(c.env, c.words)).toEqual(['ventilation'])
    })
    it(`de: ${what}, the previous word ending with a comma`, () => {
      const c = de(fade)
      expect(dropouts(c.env, c.words)).toEqual(['Flügelrad'])
    })
  }
  it('a hole far under the room tone after a comma is a cut', () => {
    const c = comma([-25, -40], -92)
    expect(dropouts(c.env, c.words)).toEqual(['ventilation'])
  })
  it('a pause longer than the voice’s own longest pause is a cut (« fertig, | Sie », 0.25 s, a voice trimmed to 0.2 s)', () => {
    expect(dropouts(klaus(), KLAUS_WORDS, 0.2)).toEqual(['Sie'])
    expect(dropouts(klaus(), KLAUS_WORDS, 0.3)).toEqual([])
  })
  it('documented residual: a sound that DECAYS like a release from the start of a word after a comma, as long as a pause, is the pause', () => {
    const decay = (): Float32Array => {
      const env = voice(5, 0, [], [[0.5, 3.5]])
      ;[-12, -13, -14, -16, -20, -26, -33, -40, -46, -55, -62].forEach((db, k) => (env[170 + k] = db))
      return cutAt(env, 1.81, 2.0, ROOM)
    }
    const words = (prev: string) => pretty([w('a', 0.5, 1.1), w('b', 1.1, 1.7), w('c', 1.7, 2.3), w('d', 2.3, 2.9), w('e', 2.9, 3.5)], ['vous', prev, 'ventilation', 'seule', 'ensuite'])
    // without the comma the text has no pause there: the old rule's cut, kept
    expect(dropouts(decay(), words('encore'), 0.3)).toEqual(['ventilation'])
    expect(dropouts(decay(), words('encore,'), 0.3)).toEqual([])
  })
  it('an abbreviation is not the end of a clause (« M. », « z.B. »)', () => {
    expect(dropouts(marcel(), MARCEL_WORDS.map((x) => (x.w === 'Un,' ? { ...x, w: 'M.' } : x)))).toEqual(['par'])
    expect(dropouts(klaus(), KLAUS_WORDS.map((x) => (x.w === 'fertig,' ? { ...x, w: 'z.B.' } : x)))).toEqual(['Sie'])
  })
})

describe('a plateau then a cliff is a cut, even after a comma (third independent review)', () => {
  /** The previous word at `prevDb` up to the word's start (1.7 s), the word's own onset at `onsetDb` for `onsetS`, then one-frame drop. */
  const cliff = (prevDb: number, onsetDb: number, onsetS: number, holeS = 0.25): Float32Array => {
    const env = voice(5, 0, [], [[0.5, 3.5]])
    for (let i = 165; i < 170; i++) env[i] = prevDb
    for (let i = 170; i < 170 + Math.round(onsetS * 100); i++) env[i] = onsetDb
    return cutAt(env, 1.7 + onsetS, 1.7 + onsetS + holeS, ROOM)
  }
  const fr = pretty([w('a', 0.5, 1.1), w('b', 1.1, 1.7), w('c', 1.7, 2.3), w('d', 2.3, 2.9), w('e', 2.9, 3.5)], ['vous', 'encore,', 'ventilation', 'seule', 'ensuite'])
  const de = pretty([w('a', 0.5, 1.1), w('b', 1.1, 1.7), w('c', 1.7, 2.3), w('d', 2.3, 2.9), w('e', 2.9, 3.5)], ['Sie', 'dann,', 'Flügelrad', 'vorsichtig', 'drehen'])
  for (const [what, env] of [
    ['a fricative onset at -25 dB for 120 ms, then nothing', () => cliff(-12, -25, 0.12)],
    ['an onset at -19 dB, 7 dB under the previous word', () => cliff(-12, -19, 0.12)],
    ['a loud previous word (-5 dB), the word at its own -12 dB for 120 ms, then a hard cut', () => cliff(-5, -12, 0.12)],
    ['an onset held at -19 dB for 140 ms, then a ramp of 13 dB a frame into nothing', () => {
      const env = cliff(-12, -19, 0.14, 0.28)
      ;[-32, -45, -58].forEach((db, k) => (env[184 + k] = db))
      return env
    }]
  ] as [string, () => Float32Array][]) {
    it(`fr: ${what}`, () => expect(dropouts(env(), fr, 0.3)).toEqual(['ventilation']))
    it(`de: ${what}`, () => expect(dropouts(env(), de, 0.3)).toEqual(['Flügelrad']))
  }
  it('an ordinal is not the end of a clause (« am 3. | Mai »)', () => {
    expect(dropouts(klaus(), KLAUS_WORDS.map((x) => (x.w === 'fertig,' ? { ...x, w: '3.' } : x)))).toEqual(['Sie'])
  })
})
