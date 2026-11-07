// A synthetic wooden-room impulse response and the voice's "room" (audio-chain bench, docs/ENGINE-SPEC.md §26 / §28.5): the narration
// is convolved with a short, deterministic, band-limited reverb and the wet signal is blended UNDER the dry voice, so a dry system / TTS
// voice stops sounding like a voice in a void. Everything is plain TypeScript (no sample file): early reflections as sparse taps
// 7-43 ms after the direct sound, then a diffuse tail of exponentially decaying noise whose level falls by 60 dB in `rt` seconds,
// the whole response band-limited to 220-5200 Hz (4th-order high-pass and low-pass) and scaled to a unit power gain in that band
// (so `mixDb` is the wet level relative to the dry voice, whatever the room). The convolution is ffmpeg's `afir`.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { EngineError } from '../errors'
import type { MediaService } from '../services'
import { filterPath } from './filters'
import { probe } from './probe'
import { writeWav } from './wav'

export const ROOM_RATE = 48000
/** Default decay time (the time the tail takes to fall by 60 dB), seconds. */
export const ROOM_RT = 0.6
/** Default wet level under the dry voice, dB. */
export const ROOM_MIX_DB = -14
/** The band of the response, Hz. */
export const ROOM_BAND = [220, 5200] as const
/** The window of the early reflections, seconds after the direct sound. */
export const EARLY_WINDOW_S = [0.007, 0.043] as const
const EARLY_TAPS = 12

type Rand = () => number

/** Mulberry32 (same generator as the sound node's `rng`, kept here so that media/ does not import a node). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A standard normal value (Box-Muller). */
function gauss(rand: Rand): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
}

/** One RBJ biquad section run over `x` in place. */
function biquad(x: Float32Array, kind: 'hp' | 'lp', hz: number, q: number, rate: number): void {
  const w0 = (2 * Math.PI * hz) / rate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const hp = kind === 'hp'
  const b0 = hp ? (1 + cos) / 2 : (1 - cos) / 2
  const b1 = hp ? -(1 + cos) : 1 - cos
  const b2 = b0
  const a0 = 1 + alpha
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i] as number
    const y = (b0 / a0) * v + (b1 / a0) * x1 + (b2 / a0) * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = v
    y2 = y1
    y1 = y
    x[i] = y
  }
}

/** A 4th-order Butterworth (two sections). */
function butterworth4(x: Float32Array, kind: 'hp' | 'lp', hz: number, rate: number): void {
  biquad(x, kind, hz, 0.5412, rate)
  biquad(x, kind, hz, 1.3066, rate)
}

export interface RoomIr {
  /** Mono, the wet response only (no direct sound), at a unit power gain in the 220-5200 Hz band. */
  samples: Float32Array
  rate: number
  /** The decay time asked for (s); `samples` is exactly this long. */
  rt: number
  /** The early reflections as designed: time after the direct sound (s) and gain before the filters. */
  taps: { timeS: number; gain: number }[]
}

export interface RoomIrOptions {
  rt?: number
  seed?: number
  rate?: number
}

/** The room's impulse response: early reflections, a diffuse tail decaying by 60 dB in `rt` s, band-limited, deterministic for a seed. */
export function roomImpulseResponse(o: RoomIrOptions = {}): RoomIr {
  const rt = Math.min(3, Math.max(0.1, o.rt ?? ROOM_RT))
  const rate = o.rate ?? ROOM_RATE
  const rand = rng((o.seed ?? 1) + 0x5eed)
  const n = Math.round(rt * rate)
  const h = new Float32Array(n)
  // the diffuse tail: noise under an envelope that falls by 60 dB (a factor 1000 in amplitude) in rt seconds, fading in over 10-45 ms
  const k = Math.log(1000) / rt
  const from = EARLY_WINDOW_S[0] * rate
  const ramp = (0.045 - 0.01) * rate
  for (let i = Math.round(from); i < n; i++) {
    const r = Math.min(1, Math.max(0, (i - 0.01 * rate) / ramp))
    h[i] = 0.08 * gauss(rand) * Math.exp(-k * (i / rate)) * (r * r * (3 - 2 * r))
  }
  // the early reflections: one tap per stratum of the 7-43 ms window, strong first and weaker later, random signs
  const [t0, t1] = EARLY_WINDOW_S
  const taps: RoomIr['taps'] = []
  for (let j = 0; j < EARLY_TAPS; j++) {
    const timeS = t0 + ((j + 0.1 + rand() * 0.8) / EARLY_TAPS) * (t1 - t0)
    const gain = (rand() < 0.5 ? -1 : 1) * (1 - 0.65 * ((timeS - t0) / (t1 - t0))) * (0.75 + 0.25 * rand())
    taps.push({ timeS, gain })
    h[Math.round(timeS * rate)] = (h[Math.round(timeS * rate)] as number) + gain
  }
  butterworth4(h, 'hp', ROOM_BAND[0], rate)
  butterworth4(h, 'lp', ROOM_BAND[1], rate)
  // a unit power gain over the pass band, so a voice that lives in the band comes out as loud as it went in (before the mix gain):
  // |H|^2 = 1 on a band of width B means sum(h^2) = B / (Nyquist) (Parseval)
  let e = 0
  for (const v of h) e += v * v
  const scale = Math.sqrt((ROOM_BAND[1] - ROOM_BAND[0]) / (rate / 2) / Math.max(e, 1e-30))
  for (let i = 0; i < n; i++) h[i] = (h[i] as number) * scale
  return { samples: h, rate, rt, taps }
}

/** Writes the response as a 32-bit float WAV (its gain matters, so no 16-bit rounding or clipping); returns the path. */
export async function writeRoomIr(file: string, ir: RoomIr): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeWav(file, ir.samples, ir.rate, 1, 32)
  return file
}

// ---------------------------------------------------------------------------------------------------------------------
// Analysis (the tests and the bench use these to check the room, since nobody can listen to it here)

/** Reverberation time (RT60, s) by Schroeder backward integration and a line fit between -5 and -25 dB (extrapolated x3). */
export function estimateRt60(h: Float32Array, rate: number): number {
  const n = h.length
  const curve = new Float64Array(n)
  let acc = 0
  for (let i = n - 1; i >= 0; i--) {
    acc += (h[i] as number) ** 2
    curve[i] = acc
  }
  const total = curve[0] as number
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let m = 0
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10(Math.max((curve[i] as number) / total, 1e-30))
    if (db > -5 || db < -25) continue
    const x = i / rate
    sx += x
    sy += db
    sxx += x * x
    sxy += x * db
    m++
  }
  if (m < 10) return 0
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx) // dB per second, negative
  return slope < 0 ? -60 / slope : 0
}

/** Clarity C50 (dB): energy in the first 50 ms over the energy after it, with `directEnergy` (default 0) added to the early part. */
export function clarityDb(h: Float32Array, rate: number, directEnergy = 0, splitS = 0.05): number {
  const cut = Math.round(splitS * rate)
  let early = directEnergy
  let late = 0
  for (let i = 0; i < h.length; i++) {
    if (i < cut) early += (h[i] as number) ** 2
    else late += (h[i] as number) ** 2
  }
  return 10 * Math.log10(Math.max(early, 1e-30) / Math.max(late, 1e-30))
}

/**
 * A single-band, room-only Speech Transmission Index (0-1) of the voice + `mixDb` wet: the modulation transfer of the squared effective
 * response (a unit impulse plus the wet response at `mixDb`, power-normalised) at 14 modulation frequencies 0.63-12.5 Hz, each turned into an
 * apparent signal-to-noise ratio, clipped to +-15 dB and averaged. 1.0 = a dry voice; above 0.75 is "excellent" on the usual scale.
 */
export function sti(h: Float32Array, rate: number, mixDb = ROOM_MIX_DB): number {
  const w2 = 10 ** (mixDb / 10)
  let e = 0
  for (const v of h) e += v * v
  const freqs = [0.63, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10, 12.5]
  let sum = 0
  for (const f of freqs) {
    let re = 1 // the direct sound: unit energy at t = 0
    let im = 0
    let tot = 1
    // the wet energy is thinned to 1 kHz before the transform (a modulation frequency never exceeds 12.5 Hz): cheap and exact enough
    const step = Math.max(1, Math.round(rate / 1000))
    for (let i = 0; i < h.length; i += step) {
      let g = 0
      for (let j = i; j < Math.min(h.length, i + step); j++) g += (h[j] as number) ** 2
      g = (g / e) * w2
      const ang = (-2 * Math.PI * f * (i + step / 2)) / rate
      re += g * Math.cos(ang)
      im += g * Math.sin(ang)
      tot += g
    }
    const m = Math.min(0.9999, Math.hypot(re, im) / tot)
    const snr = Math.max(-15, Math.min(15, 10 * Math.log10(m / (1 - m))))
    sum += (snr + 15) / 30
  }
  return sum / freqs.length
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] as number
      re[i] = re[j] as number
      re[j] = tr
      const ti = im[i] as number
      im[i] = im[j] as number
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = (re[b] as number) * cr - (im[b] as number) * ci
        const xi = (re[b] as number) * ci + (im[b] as number) * cr
        re[b] = (re[a] as number) - xr
        im[b] = (im[a] as number) - xi
        re[a] = (re[a] as number) + xr
        im[a] = (im[a] as number) + xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** Power spectrum |X(f)|^2 of `x` (zero-padded to a power of two): bins 0..N/2 and the bin width in Hz. */
export function powerSpectrum(x: Float32Array, rate: number): { power: Float64Array; binHz: number } {
  let n = 1
  while (n < x.length) n <<= 1
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < x.length; i++) re[i] = x[i] as number
  fft(re, im)
  const power = new Float64Array(n / 2 + 1)
  for (let i = 0; i <= n / 2; i++) power[i] = (re[i] as number) ** 2 + (im[i] as number) ** 2
  return { power, binHz: rate / n }
}

/** The share (0-1) of the signal's energy between `loHz` and `hiHz`. */
export function bandEnergyShare(x: Float32Array, rate: number, loHz: number, hiHz: number): number {
  const { power, binHz } = powerSpectrum(x, rate)
  let all = 0
  let band = 0
  for (let i = 0; i < power.length; i++) {
    const f = i * binHz
    all += power[i] as number
    if (f >= loHz && f <= hiHz) band += power[i] as number
  }
  return all > 0 ? band / all : 0
}

// ---------------------------------------------------------------------------------------------------------------------
// ffmpeg

export interface RoomFilterOptions {
  /** The impulse response (`writeRoomIr`), mono, at `rate`. Under ~200 characters (a filter opens it through the C library; on Windows a long path fails). */
  irFile: string
  /** The wet level relative to the dry voice, dB (default -14). */
  mixDb?: number
  /** The rate the voice is brought to before the convolution (default 48000; the IR must have been written at it). */
  rate?: number
  /** Distinguishes the labels when the chain is used twice in one graph (default `rm`). */
  tag?: string
}

/**
 * The filters that put the room on a voice: `[voice] -> voice + wet`, as one chain from an unconnected input to an unconnected output
 * (use it as `-filter_complex "[0:a]<chain>[out]"`, or as an `-af`). The voice is split; one branch is convolved with the response (`afir`, no
 * automatic gain, the IR used as is) at `mixDb`, the other stays dry; the two are summed (`amix normalize=0`). The output is as long as the
 * input; the convolution adds nothing after it, so a reverb tail past the last sample is cut (`applyRoom` pads the voice for it).
 */
export function roomFilter(o: RoomFilterOptions): string {
  const tag = o.tag ?? 'rm'
  const rate = o.rate ?? ROOM_RATE
  const wet = 10 ** ((o.mixDb ?? ROOM_MIX_DB) / 20)
  return (
    `aresample=${rate},asplit[${tag}d][${tag}w];` +
    `amovie=${filterPath(o.irFile)},aresample=${rate},aformat=channel_layouts=mono[${tag}ir];` +
    `[${tag}w][${tag}ir]afir=wet=${wet.toFixed(6)}:irnorm=-1:irfmt=mono[${tag}x];` +
    `[${tag}d][${tag}x]amix=inputs=2:normalize=0:duration=first`
  )
}

export interface ApplyRoomOptions {
  voice: string
  out: string
  rt?: number
  mixDb?: number
  seed?: number
  signal?: AbortSignal
}

/** Output codec by extension: a float WAV or FLAC for intermediates, AAC for m4a / mp4. */
function codecFor(out: string): string[] {
  const ext = path.extname(out).toLowerCase()
  if (ext === '.wav') return ['-c:a', 'pcm_f32le']
  if (ext === '.flac') return ['-c:a', 'flac', '-sample_fmt', 's16']
  if (ext === '.m4a' || ext === '.mp4') return ['-c:a', 'aac', '-b:a', '192k']
  return []
}

/**
 * Puts the room on `voice` and writes `out` (as long as the voice, same channels, 48 kHz). The response is written next to the output
 * (`<out>.room-ir.wav`, 32-bit float) and kept: it is deterministic for (`rt`, `seed`).
 */
export async function applyRoom(media: MediaService, o: ApplyRoomOptions): Promise<{ out: string; irFile: string; durationS: number }> {
  const signal = o.signal ?? new AbortController().signal
  const rt = o.rt ?? ROOM_RT
  const mixDb = o.mixDb ?? ROOM_MIX_DB
  if (!(rt > 0) || !Number.isFinite(mixDb)) throw new EngineError('bad_input', 'room: rt must be positive and mixDb finite')
  const info = await probe(media, o.voice, signal)
  const audio = info.streams.find((s) => s.codec_type === 'audio')
  if (!audio) throw new EngineError('bad_input', `room: no audio in ${o.voice}`)
  const total = Math.round(info.durationS * ROOM_RATE)
  const irFile = `${o.out}.room-ir.wav`
  await writeRoomIr(irFile, roomImpulseResponse({ rt, seed: o.seed ?? 1 }))
  const graph = `[0:a]${roomFilter({ irFile, mixDb })},apad=whole_len=${total},atrim=end_sample=${total}[o]`
  await media.run('ffmpeg', ['-v', 'error', '-y', '-i', o.voice, '-filter_complex', graph, '-map', '[o]', '-ar', String(ROOM_RATE), ...codecFor(o.out), o.out], { signal })
  return { out: o.out, irFile, durationS: total / ROOM_RATE }
}
