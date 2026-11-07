// Deterministic word aligner (docs/ENGINE-SPEC.md §19.3, §19.4): times every script word from the audio alone, for
// voices that come without word times (macOS `say`, the user's own recording when no speech recogniser is installed).
// 1. The audio's speech regions give the pauses (ENGINE-SPEC R19.6 envelope).
// 2. Pauses are matched to the script's punctuation in order (sentence and paragraph ends expect a pause, commas may
//    have one, a pause inside a clause is unlikely) by a dynamic-programming alignment, like a diff of two sequences.
// 3. Between two matched pauses, words share the speech time in proportion to their syllables.
// The result is reproducible: same audio, same script, same times.

export interface AlignToken {
  /** What is said for this token (spoken form; empty for a token spoken with the previous one). */
  spoken: string
  /** What follows the token: 0 nothing, 1 a clause mark (, ; : —), 2 a sentence end, 3 a paragraph end. */
  boundary: 0 | 1 | 2 | 3
}

export interface Region {
  start: number
  end: number
}

export interface AlignResult {
  times: { start: number; end: number }[]
  /** Share of sentence and paragraph ends matched to a heard pause (1 when the script has none). */
  matched: number
}

/** Syllable estimate: vowel groups (Latin scripts), at least one per spoken word. */
export function syllables(spoken: string): number {
  if (!spoken.trim()) return 0
  let n = 0
  for (const word of spoken.split(/[\s-]+/)) {
    if (!word) continue
    const groups = word.toLowerCase().match(/[aeiouyàâäéèêëîïôöùûüœæ]+/gu)
    n += Math.max(1, groups?.length ?? 0)
  }
  return n
}

/** Boundary strength after a written token. */
export function boundaryOf(token: string, endsSentence: boolean, endsParagraph: boolean): AlignToken['boundary'] {
  if (endsParagraph) return 3
  if (endsSentence) return 2
  return /[,;:—–]["»”’)]*$/u.test(token) ? 1 : 0
}

const SKIP_BOUNDARY = [0, 0.3, 2, 3] as const
const PUNCT_MATCH = [4, 0.6, 0, 0] as const

/** Aligns `tokens` on the speech `regions` of an audio of `durationS` seconds. */
export function alignTokens(tokens: readonly AlignToken[], regions: readonly Region[], durationS: number): AlignResult {
  const n = tokens.length
  if (n === 0) return { times: [], matched: 1 }
  const weights = tokens.map((t) => (t.spoken.trim() ? syllables(t.spoken) + 0.3 : 0))
  const strong = tokens.slice(0, -1).filter((t) => t.boundary >= 2).length
  const regs = regions.filter((r) => r.end > r.start)
  if (regs.length === 0) {
    // nothing heard: spread evenly (the node marks the timing weak)
    return { times: spread(weights, [{ start: 0, end: durationS }], 0, durationS), matched: 0 }
  }
  // speech-time coordinate: seconds of speech, pauses removed
  const lens = regs.map((r) => r.end - r.start)
  const S = lens.reduce((a, b) => a + b, 0)
  const pausePos: number[] = []
  const pauseLen: number[] = []
  let acc = 0
  for (let k = 0; k < regs.length - 1; k++) {
    acc += lens[k] as number
    pausePos.push(acc)
    pauseLen.push((regs[k + 1] as Region).start - (regs[k] as Region).end)
  }
  const W = weights.reduce((a, b) => a + b, 0) || 1
  const boundPos: number[] = []
  let cw = 0
  for (let i = 0; i < n - 1; i++) {
    cw += weights[i] as number
    boundPos.push((S * cw) / W)
  }
  const m = pausePos.length
  const b = boundPos.length
  // position tolerance: tight enough that a pause is not pulled to a sentence end seconds away, loose enough for the
  // speaking rate drifting along a long narration
  const tol = 0.8 + 0.015 * S
  // ignoring a heard pause is cheaper than pulling a sentence end onto it and shifting every sentence after it
  const skipPause = (j: number): number => {
    const g = pauseLen[j] as number
    return g >= 0.3 ? 1.5 + 3 * g : 0.3 + 3 * g
  }
  const match = (j: number, i: number): number => {
    const d = ((pausePos[j] as number) - (boundPos[i] as number)) / tol
    const strength = (tokens[i] as AlignToken).boundary
    // a long pause is a sentence end far more often than a comma
    const longPauseOnComma = strength === 1 && (pauseLen[j] as number) >= 0.45 ? 2.5 : 0
    return d * d + PUNCT_MATCH[strength] + longPauseOnComma
  }
  // D[j][i]: best cost aligning the first j pauses with the first i boundaries
  const D = new Float64Array((m + 1) * (b + 1))
  const how = new Uint8Array((m + 1) * (b + 1)) // 1 match, 2 skip pause, 3 skip boundary
  const at = (j: number, i: number): number => j * (b + 1) + i
  for (let j = 1; j <= m; j++) {
    D[at(j, 0)] = (D[at(j - 1, 0)] as number) + skipPause(j - 1)
    how[at(j, 0)] = 2
  }
  for (let i = 1; i <= b; i++) {
    D[at(0, i)] = (D[at(0, i - 1)] as number) + SKIP_BOUNDARY[(tokens[i - 1] as AlignToken).boundary]
    how[at(0, i)] = 3
  }
  for (let j = 1; j <= m; j++) {
    for (let i = 1; i <= b; i++) {
      const viaMatch = (D[at(j - 1, i - 1)] as number) + match(j - 1, i - 1)
      const viaPause = (D[at(j - 1, i)] as number) + skipPause(j - 1)
      const viaBound = (D[at(j, i - 1)] as number) + SKIP_BOUNDARY[(tokens[i - 1] as AlignToken).boundary]
      let best = viaMatch
      let h = 1
      if (viaPause < best) {
        best = viaPause
        h = 2
      }
      if (viaBound < best) {
        best = viaBound
        h = 3
      }
      D[at(j, i)] = best
      how[at(j, i)] = h
    }
  }
  // walk back: matched (pause j ↔ boundary after token i)
  const pairs: [number, number][] = []
  for (let j = m, i = b; j > 0 || i > 0; ) {
    const h = how[at(j, i)]
    if (h === 1) {
      pairs.push([j - 1, i - 1])
      j--
      i--
    } else if (h === 2) j--
    else i--
  }
  pairs.reverse()
  const matchedStrong = pairs.filter(([, i]) => (tokens[i] as AlignToken).boundary >= 2).length
  // anchors in speech time: (token index after which, speech position)
  const times: { start: number; end: number }[] = new Array(n)
  let firstTok = 0
  let fromS = 0
  const segments: { a: number; z: number; s0: number; s1: number }[] = []
  for (const [j, i] of pairs) {
    segments.push({ a: firstTok, z: i, s0: fromS, s1: pausePos[j] as number })
    firstTok = i + 1
    fromS = pausePos[j] as number
  }
  segments.push({ a: firstTok, z: n - 1, s0: fromS, s1: S })
  for (const seg of segments) {
    const segW = weights.slice(seg.a, seg.z + 1).reduce((x, y) => x + y, 0) || 1
    let c = 0
    for (let k = seg.a; k <= seg.z; k++) {
      const s0 = seg.s0 + ((seg.s1 - seg.s0) * c) / segW
      c += weights[k] as number
      const s1 = seg.s0 + ((seg.s1 - seg.s0) * c) / segW
      times[k] = { start: realAt(regs, s0, 'after'), end: Math.max(realAt(regs, s0, 'after'), realAt(regs, s1, 'before')) }
    }
  }
  return { times, matched: strong === 0 ? 1 : matchedStrong / strong }
}

/** Real time of a speech-time position: `after` puts a position on a pause at the next region's start. */
function realAt(regs: readonly Region[], s: number, bias: 'before' | 'after'): number {
  let acc = 0
  for (let k = 0; k < regs.length; k++) {
    const r = regs[k] as Region
    const len = r.end - r.start
    const inside = bias === 'after' ? s < acc + len - 1e-9 : s <= acc + len + 1e-9
    if (inside || k === regs.length - 1) return Math.min(r.end, r.start + Math.max(0, s - acc))
    acc += len
  }
  return (regs.at(-1) as Region).end
}

/** Words spread by weight over the regions (no anchors). */
function spread(weights: readonly number[], regs: Region[], from: number, to: number): { start: number; end: number }[] {
  const W = weights.reduce((a, b) => a + b, 0) || 1
  let c = 0
  return weights.map((w) => {
    const start = from + ((to - from) * c) / W
    c += w
    return { start: realAt(regs, start, 'after'), end: realAt(regs, from + ((to - from) * c) / W, 'before') }
  })
}
