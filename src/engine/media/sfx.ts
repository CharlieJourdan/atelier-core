// Sound effects for the editing toolkit (motion-montage; spec §26.5): a whoosh on a whip or push, paper on a document card, a click
// or tick on a counter, a pop on a word, an impact or stamp on a word punch, a riser before a reveal. They are REAL RECORDINGS from the
// library (`resources/sfx/library.json`, CC0 or CC BY, credited in resources/sfx/CREDITS.md, filled by scripts/sfx-library-fetch.ts).
// For each event a recording of its kind is picked by the seed, never the file the previous event of that kind used (nor the last two
// when the kind has three or more), with a small seeded change of gain and speed, so a film never hears the same sample twice in a row.
// Synthesised effects (media/sfx-synth.ts) are opt-in only (`allowSynth`): by default an event whose kind has no recording is dropped
// and reported. `buildSfxStem` places the effects so that each one's key moment (its peak or attack) lands on the target time, at
// about -20 dBFS peak (the voice sits near -2 dBFS peak: the spec's -18 to -20 dB below it), and soft-limits the sum; `mixStemInto`
// lays the stem over a music bed.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { AbortError, EngineError } from '../errors'
import type { MediaService } from '../services'
import { SFX_KINDS, SFX_PEAK, SFX_RATE, rng, synthSfx, type SfxKind } from './sfx-synth'
import { writeWav } from './wav'

export { SFX_KINDS, SFX_PEAK, SFX_RATE, synthSfx, type SfxKind, type SynthSfx } from './sfx-synth'
export { lowBandShare, spectralCentroid } from './sfx-analysis'
const PEAK = SFX_PEAK
/** Default level of an effect's peak in the stem, dBFS. */
export const SFX_LEVEL_DB = -20

// ---------------------------------------------------------------------------------------------------------------------
// The library

const SafeRelativePath = z
  .string()
  .min(1)
  .refine((p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'), 'file must be a relative path inside the sfx folder')

/** The only licences a library sound may carry: CC0, public domain, or CC BY (attribution, credited in CREDITS.md). */
export const SFX_LICENCES = ['CC0-1.0', 'PD', 'CC-BY-2.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-4.0'] as const
export const isAttributionLicence = (l: string): boolean => l.startsWith('CC-BY')

const SfxLibrarySoundSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(SFX_KINDS),
    file: SafeRelativePath,
    licence: z.enum(SFX_LICENCES),
    /** Who made the recording. */
    author: z.string().min(1).optional(),
    /** The recording's own title where it comes from. */
    title: z.string().min(1).optional(),
    /** The page the recording comes from. */
    source: z.string().optional(),
    /** The line that credits it (required for CC BY). */
    credit: z.string().min(1).optional(),
    /** Where the sound's key moment is, seconds from the start of the file. */
    peakS: z.number().min(0),
    durationS: z.number().positive().optional(),
    centroidHz: z.number().positive().optional()
  })
  .refine((s) => !isAttributionLicence(s.licence) || (s.author && s.source && s.credit), 'a CC BY sound needs author, source and credit')

export const SfxLibraryFile = z.object({ version: z.literal(1), sounds: z.array(SfxLibrarySoundSchema) })
export type SfxLibraryFile = z.infer<typeof SfxLibraryFile>
export type SfxLibrarySound = SfxLibraryFile['sounds'][number]

export interface SfxLibrary {
  /** The `sfx` folder the files are relative to. */
  dir: string
  sounds: SfxLibrarySound[]
}

/** Reads `<root>/sfx/library.json`. A missing file is an empty library; an invalid one throws. */
export async function loadSfxLibrary(root: string): Promise<SfxLibrary> {
  const dir = path.join(root, 'sfx')
  let text: string
  try {
    text = await readFile(path.join(dir, 'library.json'), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { dir, sounds: [] }
    throw e
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new EngineError('bad_input', `sfx library.json is not JSON: ${(e as Error).message}`)
  }
  const parsed = SfxLibraryFile.safeParse(json)
  if (!parsed.success) throw new EngineError('bad_input', `sfx library.json is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  return { dir, sounds: parsed.data.sounds }
}

/** Decodes a recording to mono f32 at `sampleRate` through ffmpeg, normalised to the effects' common peak. */
export async function decodeSfxFile(media: MediaService, file: string, sampleRate: number, signal: AbortSignal): Promise<Float32Array> {
  const { stdout, done } = media.stream('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-'], { signal })
  const chunks: Buffer[] = []
  for await (const c of stdout) chunks.push(Buffer.from(c))
  await done
  const buf = Buffer.concat(chunks)
  const out = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i] as number))
  if (peak === 0) throw new EngineError('bad_input', `silent or empty sound effect: ${file}`)
  const g = PEAK / peak
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) * g
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Choosing and varying a recording

/**
 * Picks one of `choices` with `r` (0..1), never one of the `recent` files of its kind: the last one always, the last two when there are
 * three or more choices. Pure; `recent` is newest last.
 */
export function pickAvoidingRecent<T extends { file: string }>(choices: readonly T[], recent: readonly string[], r: number): T | undefined {
  if (choices.length === 0) return undefined
  const avoid = new Set(recent.slice(choices.length >= 3 ? -2 : -1))
  const allowed = choices.filter((c) => !avoid.has(c.file))
  const pool = allowed.length > 0 ? allowed : choices
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]
}

/** Bounds of the per-event change of a recording. */
export const SFX_VARIATION = { gainDb: 2, rate: 0.04 } as const

/** The seeded change of one event: gain within +/- 2 dB, playback rate within +/- 4 %. */
export function sfxVariation(seed: number): { gainDb: number; rate: number } {
  const rand = rng(seed ^ 0x5bd1e995)
  return { gainDb: (rand() * 2 - 1) * SFX_VARIATION.gainDb, rate: 1 + (rand() * 2 - 1) * SFX_VARIATION.rate }
}

/** Plays `a` at `rate` (1.04 is 4 % faster and higher) by linear-interpolation resampling. Always a new array. */
export function resampleRate(a: Float32Array, rate: number): Float32Array {
  if (rate === 1) return Float32Array.from(a)
  const n = Math.max(1, Math.floor((a.length - 1) / rate) + 1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * rate
    const j = Math.floor(x)
    const f = x - j
    out[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? 0) * f
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Placing effects

export interface SfxEvent {
  /** Where the effect's key moment lands, seconds. */
  atS: number
  kind: SfxKind
  /** Relative to the effects' base level, dB (default 0). */
  gainDb?: number
}

/** Sorted by time; an event of a kind that follows another of the same kind by less than `mergeS` is dropped (the first stays). */
export function mergeEvents(events: readonly SfxEvent[], mergeS = 0.08): SfxEvent[] {
  const sorted = [...events].sort((a, b) => a.atS - b.atS)
  const lastKept = new Map<SfxKind, number>()
  const out: SfxEvent[] = []
  for (const e of sorted) {
    const last = lastKept.get(e.kind)
    if (last !== undefined && e.atS - last < mergeS) continue
    lastKept.set(e.kind, e.atS)
    out.push(e)
  }
  return out
}

export interface SfxStemOptions {
  events: readonly SfxEvent[]
  durationS: number
  sampleRate?: number
  seed: number
  library?: SfxLibrary
  /** Needed to decode library recordings; without it no recording can play. */
  media?: MediaService
  signal?: AbortSignal
  /** Level of an effect's peak, dBFS (default -20). */
  levelDb?: number
  /** Synthesise an effect whose kind has no playable recording (default false: the event is dropped and reported). */
  allowSynth?: boolean
}

export interface SfxStemReport {
  /** One line per event that sounds: its time, kind, and the library file (or `synth`). */
  placed: { atS: number; kind: SfxKind; file: string }[]
  /** Events that do not sound: no recording of their kind (and synthesis not allowed), or every recording unreadable. */
  dropped: { atS: number; kind: SfxKind; reason: 'no-recording' }[]
}

const kindIndex = (k: SfxKind): number => SFX_KINDS.indexOf(k)

interface Placed {
  samples: Float32Array
  peakS: number
  file: string
}

/** The recording of one event (never the last ones of its kind), varied; else the synthesised effect when allowed; else nothing. */
async function pickSound(
  e: SfxEvent,
  eventSeed: number,
  sr: number,
  o: SfxStemOptions,
  decoded: Map<string, Float32Array | null>,
  recent: Map<SfxKind, string[]>
): Promise<Placed | undefined> {
  const lib = o.library
  let choices = lib && o.media ? lib.sounds.filter((s) => s.kind === e.kind && decoded.get(path.join(lib.dir, s.file)) !== null) : []
  const rand = rng(eventSeed)
  while (lib && o.media && choices.length > 0) {
    const s = pickAvoidingRecent(choices, recent.get(e.kind) ?? [], rand()) as SfxLibrarySound
    const file = path.join(lib.dir, s.file)
    if (!decoded.has(file)) {
      try {
        decoded.set(file, await decodeSfxFile(o.media, file, sr, o.signal ?? new AbortController().signal))
      } catch (err) {
        if (err instanceof AbortError || o.signal?.aborted) throw err
        decoded.set(file, null) // an unreadable recording is skipped (a sound never fails a video)
      }
    }
    const samples = decoded.get(file)
    if (!samples) {
      choices = choices.filter((c) => c !== s)
      continue
    }
    recent.set(e.kind, [...(recent.get(e.kind) ?? []), s.file].slice(-2))
    const v = sfxVariation(eventSeed)
    const varied = resampleRate(samples, v.rate)
    const g = Math.pow(10, v.gainDb / 20)
    for (let i = 0; i < varied.length; i++) varied[i] = (varied[i] as number) * g
    return { samples: varied, peakS: Math.min(s.peakS / v.rate, varied.length / sr), file: s.file }
  }
  if (!o.allowSynth) return undefined
  return { ...synthSfx(e.kind, eventSeed, sr), file: 'synth' }
}

/** The effects stem and what went into it: mono, `durationS` long, every effect's key moment on its `atS`, soft-limited below -1 dBFS. */
export async function buildSfxStemReport(o: SfxStemOptions): Promise<{ samples: Float32Array; report: SfxStemReport }> {
  const sr = o.sampleRate ?? SFX_RATE
  const total = Math.max(0, Math.round(o.durationS * sr))
  const out = new Float32Array(total)
  const decoded = new Map<string, Float32Array | null>()
  const recent = new Map<SfxKind, string[]>()
  const report: SfxStemReport = { placed: [], dropped: [] }
  const events = mergeEvents(o.events)
  for (let i = 0; i < events.length; i++) {
    if (o.signal?.aborted) throw new AbortError()
    const e = events[i] as SfxEvent
    if (!(e.atS >= 0) || e.atS * sr >= total + sr) continue
    const eventSeed = (Math.imul(o.seed >>> 0, 2654435761) ^ Math.imul(i + 1, 40503) ^ (kindIndex(e.kind) * 7919)) >>> 0
    const picked = await pickSound(e, eventSeed, sr, o, decoded, recent)
    if (!picked) {
      report.dropped.push({ atS: e.atS, kind: e.kind, reason: 'no-recording' })
      continue
    }
    report.placed.push({ atS: e.atS, kind: e.kind, file: picked.file })
    const gain = Math.pow(10, ((o.levelDb ?? SFX_LEVEL_DB) + (e.gainDb ?? 0)) / 20) / PEAK
    const start = Math.round((e.atS - picked.peakS) * sr)
    for (let j = Math.max(0, -start); j < picked.samples.length && start + j < total; j++) {
      out[start + j] = (out[start + j] as number) + (picked.samples[j] as number) * gain
    }
  }
  // soft limiter: transparent at the effects' normal level, asymptotic to -1 dBFS when many pile up
  for (let i = 0; i < total; i++) out[i] = PEAK * Math.tanh((out[i] as number) / PEAK)
  return { samples: out, report }
}

/** `buildSfxStemReport` without the report. */
export async function buildSfxStem(o: SfxStemOptions): Promise<Float32Array> {
  return (await buildSfxStemReport(o)).samples
}

/** `buildSfxStem`, written as a 48 kHz (or `sampleRate`) stereo 16-bit WAV; returns what went into it. */
export async function writeSfxStem(o: SfxStemOptions & { out: string }): Promise<SfxStemReport> {
  const { samples: mono, report } = await buildSfxStemReport(o)
  const stereo = new Float32Array(mono.length * 2)
  for (let i = 0; i < mono.length; i++) {
    stereo[2 * i] = mono[i] as number
    stereo[2 * i + 1] = mono[i] as number
  }
  await writeWav(o.out, stereo, o.sampleRate ?? SFX_RATE, 2)
  return report
}

/**
 * Lays a stem over a bed (the music): plain sum, no level normalisation, the bed's own length. `.m4a` out is AAC 192k, anything
 * else a 16-bit WAV. Both inputs go to 48 kHz stereo first; a limiter near full scale only catches an accidental overload.
 */
export async function mixStemInto(o: { media: MediaService; bed: string; stem: string; out: string; signal: AbortSignal }): Promise<void> {
  const stereo = `aresample=${SFX_RATE},aformat=channel_layouts=stereo`
  const graph = `[0:a]${stereo}[b];[1:a]${stereo},apad[s];[b][s]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3,alimiter=limit=0.98:level=0[o]`
  const codec = /\.m4a$/i.test(o.out) ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'pcm_s16le']
  await o.media.run('ffmpeg', ['-y', '-v', 'error', '-i', o.bed, '-i', o.stem, '-filter_complex', graph, '-map', '[o]', '-ar', String(SFX_RATE), ...codec, o.out], {
    signal: o.signal
  })
}
