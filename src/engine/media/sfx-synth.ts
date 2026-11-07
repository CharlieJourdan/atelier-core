// The synthesised sound effects (motion-montage; spec §26.5), split out of media/sfx.ts. Since the recorded library (resources/sfx/)
// is filled they are OPT-IN only (`allowSynth` in sfx.ts): a whoosh, paper, click, tick, pop, impact, stamp or riser made in plain
// TypeScript, deterministic for a seed, no audio file and no dependency. Kept for tests, previews and a style that asks for them.

export const SFX_KINDS = ['whoosh', 'whoosh-soft', 'paper', 'click', 'tick', 'pop', 'impact', 'stamp', 'riser'] as const
export type SfxKind = (typeof SFX_KINDS)[number]

export const SFX_RATE = 48000
/** Every synthesised effect (and every decoded recording) is normalised to this peak: -1 dBFS. */
export const SFX_PEAK = Math.pow(10, -1 / 20)
const PEAK = SFX_PEAK

export interface SynthSfx {
  /** Mono, peak about -1 dBFS. */
  samples: Float32Array
  /** Where its key moment is (attack, loudest burst, or the end of a riser), seconds from its start. */
  peakS: number
}

// ---------------------------------------------------------------------------------------------------------------------
// Building blocks

/** Mulberry32 (same generator as the sound node's `rng`, kept here so that media/ does not import a node). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number
const noise = (rand: Rand): number => rand() * 2 - 1
/** A value near `v`, within +/- `spread` (a fraction). */
const near = (rand: Rand, v: number, spread: number): number => v * (1 + (rand() * 2 - 1) * spread)

/** A biquad (RBJ cookbook) whose centre frequency may move while it runs. */
class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private readonly type: 'bp' | 'lp' | 'hp'
  private readonly sr: number
  private readonly q: number
  constructor(type: 'bp' | 'lp' | 'hp', sr: number, f: number, q = 0.707) {
    this.type = type
    this.sr = sr
    this.q = q
    this.set(f)
  }
  set(f: number): void {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * this.q)
    const a0 = 1 + alpha
    if (this.type === 'bp') {
      this.b0 = alpha / a0
      this.b1 = 0
      this.b2 = -alpha / a0
    } else if (this.type === 'lp') {
      this.b0 = (1 - cos) / 2 / a0
      this.b1 = (1 - cos) / a0
      this.b2 = this.b0
    } else {
      this.b0 = (1 + cos) / 2 / a0
      this.b1 = -(1 + cos) / a0
      this.b2 = this.b0
    }
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }
  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

const SWEEP_STEP = 32

/** Noise through a band-pass whose centre goes from `f0` to `f1` (exponentially, bent by `bend`) over the whole buffer. */
function sweptNoise(rand: Rand, n: number, sr: number, f0: number, f1: number, q: number, bend = 1): Float32Array {
  const out = new Float32Array(n)
  const bp = new Biquad('bp', sr, f0, q)
  for (let i = 0; i < n; i++) {
    if (i % SWEEP_STEP === 0) bp.set(f0 * Math.pow(f1 / f0, Math.pow(i / n, bend)))
    out[i] = bp.next(noise(rand))
  }
  return out
}

/** Index of the largest absolute sample. */
function argmaxAbs(a: Float32Array, from = 0, to = a.length): number {
  let best = from
  let bv = 0
  for (let i = from; i < Math.min(to, a.length); i++) {
    const v = Math.abs(a[i] as number)
    if (v > bv) {
      bv = v
      best = i
    }
  }
  return best
}

/** Centre of the loudest 6 ms window (the key moment of a sound made of bursts). */
function loudestWindow(a: Float32Array, sr: number): number {
  const w = Math.max(1, Math.round(sr * 0.006))
  let sum = 0
  let best = 0
  let bv = -1
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] as number) ** 2
    if (i >= w) sum -= (a[i - w] as number) ** 2
    if (sum > bv) {
      bv = sum
      best = i - (w >> 1)
    }
  }
  return Math.max(0, best)
}

/** Fades the last `ms` to zero, then scales to the common peak. */
function finish(a: Float32Array, sr: number, fadeMs = 1.5): Float32Array {
  const f = Math.min(a.length, Math.round((sr * fadeMs) / 1000))
  for (let i = 0; i < f; i++) a[a.length - 1 - i] = (a[a.length - 1 - i] as number) * (i / f)
  let peak = 0
  for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i] as number))
  const g = peak > 0 ? PEAK / peak : 1
  for (let i = 0; i < a.length; i++) a[i] = (a[i] as number) * g
  return a
}

/** `exp(-t / tau)` with a linear attack of `attackS`. */
const decay = (t: number, tau: number, attackS = 0): number => (t < attackS ? t / attackS : Math.exp(-(t - attackS) / tau))

// ---------------------------------------------------------------------------------------------------------------------
// Recipes

interface WhooshShape {
  dur: number
  f0: number
  f1: number
  q: number
  peakAt: number
  fallTau: number
  airDb: number
}

function whoosh(rand: Rand, sr: number, s: WhooshShape): SynthSfx {
  const dur = near(rand, s.dur, 0.08)
  const n = Math.round(dur * sr)
  const f0 = near(rand, s.f0, 0.06)
  const f1 = near(rand, s.f1, 0.06)
  const body = sweptNoise(rand, n, sr, f0, f1, s.q, 0.85)
  // a thinner, brighter layer one octave up gives the "air" of a fast pass
  const air = sweptNoise(rand, n, sr, f0 * 2, f1 * 1.6, s.q * 2, 0.85)
  const tp = s.peakAt * dur
  const a = Math.pow(10, s.airDb / 20)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = t < tp ? Math.pow(Math.sin(((t / tp) * Math.PI) / 2), 2) : Math.exp(-(t - tp) / s.fallTau)
    out[i] = ((body[i] as number) + a * (air[i] as number)) * env
  }
  finish(out, sr, 6)
  return { samples: out, peakS: tp }
}

function paper(rand: Rand, sr: number): SynthSfx {
  const dur = near(rand, 0.32, 0.12)
  const n = Math.round(dur * sr)
  const hp = new Biquad('hp', sr, 2200, 0.8)
  const bp = new Biquad('bp', sr, near(rand, 3800, 0.1), 0.5)
  const out = new Float32Array(n)
  const bursts = 4 + Math.floor(rand() * 3)
  const env = new Float32Array(n)
  for (let b = 0; b < bursts; b++) {
    const start = Math.floor(rand() * Math.max(1, n - 0.09 * sr))
    const amp = 0.35 + 0.65 * rand()
    const tau = 0.012 + 0.02 * rand()
    const len = Math.min(n - start, Math.round(0.09 * sr))
    for (let i = 0; i < len; i++) env[start + i] = Math.max(env[start + i] as number, amp * decay(i / sr, tau, 0.002))
  }
  for (let i = 0; i < n; i++) {
    const hiss = bp.next(hp.next(noise(rand)))
    out[i] = hiss * (env[i] as number)
  }
  // dry crackle: single-sample ticks that the high-pass later turns into short crisp clicks
  const crackles = 14 + Math.floor(rand() * 12)
  for (let c = 0; c < crackles; c++) {
    const at = Math.floor(rand() * n)
    out[at] = (out[at] as number) + (rand() < 0.5 ? -1 : 1) * (0.15 + 0.5 * rand()) * (0.3 + (env[at] as number))
  }
  const fade = Math.round(0.03 * sr)
  for (let i = 0; i < Math.min(fade, n); i++) out[n - 1 - i] = (out[n - 1 - i] as number) * (i / fade)
  finish(out, sr)
  return { samples: out, peakS: loudestWindow(out, sr) / sr }
}

function click(rand: Rand, sr: number): SynthSfx {
  const n = Math.round(0.02 * sr)
  const bp = new Biquad('bp', sr, near(rand, 3600, 0.1), 1.6)
  const out = new Float32Array(n)
  const body = near(rand, 1900, 0.08)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    out[i] = bp.next(noise(rand)) * decay(t, 0.0013, 0.0002) + 0.6 * Math.sin(2 * Math.PI * body * t) * decay(t, 0.003, 0.0002)
  }
  finish(out, sr, 2)
  return { samples: out, peakS: argmaxAbs(out) / sr }
}

function tick(rand: Rand, sr: number): SynthSfx {
  const n = Math.round(0.07 * sr)
  const f1 = near(rand, 1350, 0.05)
  const f2 = f1 * 1.62
  const bp = new Biquad('bp', sr, near(rand, 2800, 0.1), 1.2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const wood = Math.sin(2 * Math.PI * f1 * t) * decay(t, 0.016, 0.0003) + 0.7 * Math.sin(2 * Math.PI * f2 * t + 0.6) * decay(t, 0.009, 0.0003)
    out[i] = wood + 0.5 * bp.next(noise(rand)) * decay(t, 0.0012, 0.0002)
  }
  finish(out, sr, 3)
  return { samples: out, peakS: argmaxAbs(out) / sr }
}

function pop(rand: Rand, sr: number): SynthSfx {
  const n = Math.round(0.09 * sr)
  const f0 = near(rand, 950, 0.1)
  const f1 = near(rand, 260, 0.1)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    phase += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / 0.014))) / sr
    out[i] = Math.sin(phase) * decay(t, 0.02, 0.0008) + 0.12 * noise(rand) * decay(t, 0.003, 0.0004)
  }
  finish(out, sr, 4)
  return { samples: out, peakS: argmaxAbs(out) / sr }
}

function impact(rand: Rand, sr: number): SynthSfx {
  const n = Math.round(near(rand, 0.65, 0.08) * sr)
  const f0 = near(rand, 125, 0.1)
  const f1 = near(rand, 52, 0.08)
  const burst = new Biquad('lp', sr, 1100, 0.8)
  const rumble = new Biquad('lp', sr, 260, 0.9)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    phase += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / 0.05))) / sr
    const thump = Math.sin(phase) * decay(t, 0.2, 0.0015)
    const crack = 0.4 * burst.next(noise(rand)) * decay(t, 0.025, 0.0004)
    const tail = 0.25 * rumble.next(noise(rand)) * decay(t, 0.22, 0.01)
    out[i] = thump + crack + tail
  }
  finish(out, sr, 8)
  return { samples: out, peakS: argmaxAbs(out, 0, Math.round(0.05 * sr)) / sr }
}

function stamp(rand: Rand, sr: number): SynthSfx {
  const n = Math.round(near(rand, 0.26, 0.08) * sr)
  const f0 = near(rand, 190, 0.08)
  const f1 = near(rand, 85, 0.08)
  const slap = new Biquad('bp', sr, near(rand, 1700, 0.1), 0.9)
  const body = new Biquad('lp', sr, 700, 0.7)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    phase += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / 0.025))) / sr
    const thud = Math.sin(phase) * decay(t, 0.06, 0.001)
    const paperSlap = 0.7 * slap.next(noise(rand)) * (decay(t, 0.011, 0.0005) + 0.4 * decay(Math.max(0, t - 0.012), 0.01, 0.0008))
    const rubber = 0.3 * body.next(noise(rand)) * decay(t, 0.05, 0.001)
    out[i] = thud + paperSlap + rubber
  }
  finish(out, sr, 5)
  return { samples: out, peakS: argmaxAbs(out, 0, Math.round(0.04 * sr)) / sr }
}

function riser(rand: Rand, sr: number): SynthSfx {
  const dur = near(rand, 1.2, 0.06)
  const n = Math.round(dur * sr)
  const hiss = sweptNoise(rand, n, sr, 250, near(rand, 6500, 0.08), 2.2, 1.1)
  const out = new Float32Array(n)
  const fa = near(rand, 180, 0.06)
  const fb = near(rand, 1500, 0.06)
  let ph1 = 0
  let ph2 = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const f = fa * Math.pow(fb / fa, u * u)
    ph1 += (2 * Math.PI * f) / sr
    ph2 += (2 * Math.PI * f * 1.5 * (1 + 0.004 * Math.sin(40 * u))) / sr
    const tone = Math.sin(ph1) + 0.45 * Math.sin(ph2)
    out[i] = (0.9 * (hiss[i] as number) + 0.35 * tone) * Math.pow(u, 2.2)
  }
  finish(out, sr, 3)
  return { samples: out, peakS: n / sr - 0.003 }
}

const WHOOSH: WhooshShape = { dur: 0.42, f0: 300, f1: 3000, q: 1.1, peakAt: 0.7, fallTau: 0.045, airDb: -8 }
const WHOOSH_SOFT: WhooshShape = { dur: 0.85, f0: 160, f1: 1300, q: 0.8, peakAt: 0.55, fallTau: 0.18, airDb: -14 }

/** One effect, synthesised: the same `seed` always gives the same samples. */
export function synthSfx(kind: SfxKind, seed: number, sampleRate = SFX_RATE): SynthSfx {
  const rand = rng(seed)
  switch (kind) {
    case 'whoosh':
      return whoosh(rand, sampleRate, WHOOSH)
    case 'whoosh-soft':
      return whoosh(rand, sampleRate, WHOOSH_SOFT)
    case 'paper':
      return paper(rand, sampleRate)
    case 'click':
      return click(rand, sampleRate)
    case 'tick':
      return tick(rand, sampleRate)
    case 'pop':
      return pop(rand, sampleRate)
    case 'impact':
      return impact(rand, sampleRate)
    case 'stamp':
      return stamp(rand, sampleRate)
    case 'riser':
      return riser(rand, sampleRate)
  }
}
