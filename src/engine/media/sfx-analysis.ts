// Spectrum measures for the sound effects (the preview script and the tests; no role in a render).
const SFX_RATE = 48000

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j] as number, re[i] as number]
      ;[im[i], im[j]] = [im[j] as number, im[i] as number]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const a = i + k
        const b = a + len / 2
        const xr = (re[b] as number) * wr - (im[b] as number) * wi
        const xi = (re[b] as number) * wi + (im[b] as number) * wr
        re[b] = (re[a] as number) - xr
        im[b] = (im[a] as number) - xi
        re[a] = (re[a] as number) + xr
        im[a] = (im[a] as number) + xi
      }
    }
  }
}

/** Power spectrum of the whole sound (zero-padded to a power of two, at most 65536 points): `power[k]` is at `k * sr / size` Hz. */
function powerSpectrum(a: Float32Array, sr: number): { power: Float64Array; binHz: number } {
  let size = 1024
  while (size < a.length && size < 65536) size <<= 1
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < Math.min(a.length, size); i++) re[i] = a[i] as number
  fftInPlace(re, im)
  const power = new Float64Array(size / 2)
  for (let k = 0; k < power.length; k++) power[k] = (re[k] as number) ** 2 + (im[k] as number) ** 2
  return { power, binHz: sr / size }
}

/** Spectral centroid in Hz: where the sound's energy sits on average. */
export function spectralCentroid(a: Float32Array, sr = SFX_RATE): number {
  const { power, binHz } = powerSpectrum(a, sr)
  let num = 0
  let den = 0
  for (let k = 1; k < power.length; k++) {
    num += k * binHz * (power[k] as number)
    den += power[k] as number
  }
  return den > 0 ? num / den : 0
}

/** Share (0..1) of the sound's energy below `hz`. */
export function lowBandShare(a: Float32Array, hz: number, sr = SFX_RATE): number {
  const { power, binHz } = powerSpectrum(a, sr)
  let low = 0
  let all = 0
  for (let k = 1; k < power.length; k++) {
    all += power[k] as number
    if (k * binHz < hz) low += power[k] as number
  }
  return all > 0 ? low / all : 0
}

// ---------------------------------------------------------------------------------------------------------------------
// Cutting and checking recordings (scripts/sfx-library-fetch.ts and the tests)

const HOP_S = 0.005

/** Short-window RMS level every 5 ms (10 ms windows), linear. */
export function rmsEnvelope(a: Float32Array, sr = SFX_RATE): Float32Array {
  const hop = Math.max(1, Math.round(sr * HOP_S))
  const win = hop * 2
  const n = Math.max(1, Math.ceil(a.length / hop))
  const env = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    const from = f * hop
    const to = Math.min(a.length, from + win)
    for (let i = from; i < to; i++) s += (a[i] as number) ** 2
    env[f] = to > from ? Math.sqrt(s / (to - from)) : 0
  }
  return env
}

const dbOf = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9))

/**
 * The separate sounds of a recording (one take after another), as sample ranges: a sound starts where the level rises
 * `aboveFloorDb` over the recording's noise floor (and within `rangeDb` of its loudest moment), ends where it falls back,
 * and two parts closer than `gapS` are one sound. Each range keeps a 10 ms lead-in and runs on until the next sound.
 */
export function findSoundEvents(a: Float32Array, sr = SFX_RATE, o: { gapS?: number; rangeDb?: number; aboveFloorDb?: number } = {}): { start: number; end: number }[] {
  const env = rmsEnvelope(a, sr)
  const hop = Math.round(sr * HOP_S)
  const sorted = Float32Array.from(env).sort()
  const max = sorted[sorted.length - 1] ?? 0
  if (max <= 0) return []
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0
  const thr = Math.max(max * Math.pow(10, -(o.rangeDb ?? 36) / 20), floor * Math.pow(10, (o.aboveFloorDb ?? 12) / 20))
  const gap = Math.max(1, Math.round((o.gapS ?? 0.12) / HOP_S))
  const regions: [number, number][] = []
  for (let f = 0; f < env.length; f++) {
    if ((env[f] as number) < thr) continue
    const last = regions[regions.length - 1]
    if (last && f - last[1] <= gap) last[1] = f
    else regions.push([f, f])
  }
  return regions.map(([s, e], i) => {
    const next = regions[i + 1]
    const end = next ? next[0] - 2 : env.length
    return { start: Math.max(0, (s - 2) * hop), end: Math.min(a.length, Math.max(e + 1, end) * hop) }
  })
}

export interface SfxShape {
  durationS: number
  /** From the first sample above -30 dB of the peak level to the loudest 10 ms window. */
  attackS: number
  /** Where the loudest window sits, 0..1 of the length. */
  peakPos: number
  centroidHz: number
  /** Share of the energy under 250 Hz. */
  lowShare: number
  /** Level of the first and last 15 ms against the loudest window, dB. */
  headDb: number
  tailDb: number
  /** Level of the last third against the first third, dB (a riser climbs). */
  riseDb: number
  /** Three or more samples held at the same value near full scale (a flat top). */
  clipped: boolean
}

/** Measures a cut sound (`a` as recorded, not yet normalised). */
export function describeSfx(a: Float32Array, sr = SFX_RATE): SfxShape {
  const env = rmsEnvelope(a, sr)
  let pk = 0
  for (let f = 1; f < env.length; f++) if ((env[f] as number) > (env[pk] as number)) pk = f
  const max = env[pk] ?? 0
  let first = 0
  while (first < pk && (env[first] as number) < max * 0.0316) first++
  const edge = (from: number, to: number): number => {
    let s = 0
    let n = 0
    for (let f = Math.max(0, from); f < Math.min(env.length, to); f++, n++) s += env[f] as number
    return n ? dbOf(s / n) - dbOf(max) : -120
  }
  // the first and last 15 ms (less on a very short sound)
  const edgeN = Math.max(1, Math.min(3, Math.floor(env.length * 0.15)))
  const third = Math.max(1, Math.floor(env.length / 3))
  let run = 0
  let clipped = false
  for (let i = 0; i < a.length && !clipped; i++) {
    const v = a[i] as number
    // a flat top: the same value held near full scale (a normalised peak of a low sound is close to 1 over several samples, but not flat)
    run = Math.abs(v) >= 0.98 && i > 0 && Math.abs(v - (a[i - 1] as number)) < 1e-5 ? run + 1 : 0
    clipped = run >= 2
  }
  return {
    durationS: a.length / sr,
    attackS: (pk - first) * HOP_S,
    peakPos: env.length > 1 ? pk / (env.length - 1) : 0,
    centroidHz: spectralCentroid(a, sr),
    lowShare: lowBandShare(a, 250, sr),
    headDb: edge(0, edgeN),
    tailDb: edge(env.length - edgeN, env.length),
    riseDb: edge(env.length - third, env.length) - edge(0, third),
    clipped
  }
}

type Kind = 'whoosh' | 'whoosh-soft' | 'paper' | 'click' | 'tick' | 'pop' | 'impact' | 'stamp' | 'riser'

interface KindRule {
  dur: [number, number]
  centroid: [number, number]
  attackMax?: number
  attackMin?: number
  peakPos?: [number, number]
  lowShare?: [number, number]
  riseMin?: number
  /** The sound must have died away by its end (no noise bed, no long ambience). */
  tailMax?: number
  headMax?: number
}

/** What a recording of each kind looks like once cut (a hit is short with a sharp attack, a whoosh swells, a riser climbs). */
export const SFX_KIND_RULES: Record<Kind, KindRule> = {
  click: { dur: [0.015, 0.25], centroid: [1200, 14000], attackMax: 0.02, tailMax: -24 },
  tick: { dur: [0.02, 0.3], centroid: [700, 12000], attackMax: 0.02, tailMax: -24 },
  pop: { dur: [0.04, 0.5], centroid: [250, 6000], attackMax: 0.025, tailMax: -24 },
  stamp: { dur: [0.08, 0.7], centroid: [150, 2000], attackMax: 0.025, lowShare: [0.08, 1], tailMax: -24 },
  impact: { dur: [0.25, 1.5], centroid: [50, 2500], attackMax: 0.03, lowShare: [0.15, 1], tailMax: -22 },
  paper: { dur: [0.2, 1.5], centroid: [1200, 14000], lowShare: [0, 0.25], tailMax: -16 },
  whoosh: { dur: [0.25, 1.2], centroid: [900, 9000], attackMin: 0.05, peakPos: [0.2, 0.92], tailMax: -12, headMax: -10 },
  'whoosh-soft': { dur: [0.45, 1.5], centroid: [200, 2000], attackMin: 0.1, peakPos: [0.15, 0.92], tailMax: -12, headMax: -10 },
  riser: { dur: [1.0, 3.0], centroid: [300, 12000], peakPos: [0.75, 1], riseMin: 10, headMax: -18 }
}

/** How well a cut sound fits a kind: a score in (0, 1], or the reason it does not fit. */
export function sfxKindFit(kind: Kind, s: SfxShape): { score: number } | { reason: string } {
  const r = SFX_KIND_RULES[kind]
  const out = (v: number, [lo, hi]: [number, number]): boolean => !(v >= lo && v <= hi)
  if (s.clipped) return { reason: 'clipped' }
  if (out(s.durationS, r.dur)) return { reason: `duration ${s.durationS.toFixed(2)} s` }
  if (out(s.centroidHz, r.centroid)) return { reason: `centroid ${s.centroidHz.toFixed(0)} Hz` }
  if (r.attackMax !== undefined && s.attackS > r.attackMax) return { reason: `attack ${(s.attackS * 1000).toFixed(0)} ms` }
  if (r.attackMin !== undefined && s.attackS < r.attackMin) return { reason: `attack ${(s.attackS * 1000).toFixed(0)} ms (no swell)` }
  if (r.peakPos && out(s.peakPos, r.peakPos)) return { reason: `peak at ${(s.peakPos * 100).toFixed(0)} %` }
  if (r.lowShare && out(s.lowShare, r.lowShare)) return { reason: `low share ${s.lowShare.toFixed(2)}` }
  if (r.riseMin !== undefined && s.riseDb < r.riseMin) return { reason: `rises only ${s.riseDb.toFixed(1)} dB` }
  if (r.tailMax !== undefined && s.tailDb > r.tailMax) return { reason: `does not die away (tail ${s.tailDb.toFixed(0)} dB)` }
  if (r.headMax !== undefined && s.headDb > r.headMax) return { reason: `starts loud (head ${s.headDb.toFixed(0)} dB)` }
  // closeness to the middle of the duration and centroid ranges (log scale), 0.5..1 each
  const mid = (v: number, [lo, hi]: [number, number]): number => {
    const c = Math.sqrt(lo * hi)
    const span = Math.log(hi / lo) / 2
    return 1 - 0.5 * Math.min(1, Math.abs(Math.log(v / c)) / span)
  }
  return { score: mid(s.durationS, r.dur) * mid(s.centroidHz, r.centroid) }
}
