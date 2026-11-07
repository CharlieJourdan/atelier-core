// `sound.music@1` (docs/ENGINE-SPEC.md §26): the music bed of the film and its ducking. P4 ships the bed only (effects and
// designed silences come later). A cue sheet follows the chapters and the `pivot` / `disclosure` beats; a cue changes
// only inside a voice pause, with a crossfade; the choice of tracks is seeded. The bed is computed sample by sample and
// streamed into a FLAC encoder, so a long film costs constant memory. Sound never fails the video: when nothing can be
// played the node outputs a silent bed of the right length and says why in the soundplan.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Artefact, NodeOutputs } from '../artefacts'
import { AbortError, EngineError } from '../errors'
import { EditPlan } from '../formats/editplan'
import { SoundPlan, Register, type SoundCue } from '../formats/soundplan'
import { BeatsValue, FPS, WordsValue, type Beat, type Word } from '../formats/timing'
import { probe } from '../media/probe'
import { defineNode, type RunCtx } from '../registry'
import { need, type MediaService } from '../services'
import { metaNumber, progress, readFile0, readValue, scratch, throwIfAborted } from './common'

export const SAMPLE_RATE = 48000
/** Loudness of the library tracks and the assumed loudness of the voice artefact (LUFS). */
export const TRACK_LUFS = -20
export const VOICE_LUFS = -16
/** The voice gap length from which the bed lifts (spec §26.3), the ducking times, the control rate of the gain curve. */
export const LIFT_MIN_GAP_S = 1.5
export const ATTACK_S = 0.3
export const RELEASE_S = 0.4
const LIFT_START_PAD_S = 0.1
const LIFT_END_PAD_S = 0.05
const ENV_RATE = 100
const MAX_CUE_S = 300
const MIN_PAUSE_S = 0.5
const LIMIT_KNEE = 0.7
const LIMIT_CEIL = 0.89

export const SoundMusicParams = z.object({
  register: Register.default('driven'),
  /** Bed level relative to the voice while it speaks (dB); default by register. */
  bedDb: z.number().min(-40).max(0).optional(),
  liftDb: z.number().min(0).max(12).default(6),
  fadeInS: z.number().min(0).max(10).default(2),
  fadeOutS: z.number().min(0).max(15).default(4),
  crossfadeS: z.number().min(0.2).max(4).default(1.5),
  /** Preferred mood of the first cue. */
  mood: z.string().min(1).optional(),
  /** `library`: always the library; unset: the channel's own track when the run has one (`track` input), else the library. */
  source: z.enum(['library']).optional(),
  minCueS: z.number().min(5).max(300).default(25),
  /** A cue may change under the voice at a sentence's end, with the full crossfade, when no pause holds it (a voice with short pauses). */
  fadeUnderVoice: z.boolean().default(false)
})
type Params = z.infer<typeof SoundMusicParams>

export const REGISTER_BED_DB: Record<z.infer<typeof Register>, number> = { sparse: -15, driven: -11, dense: -7 }

const LibraryFile = z.object({
  tracks: z.array(
    z.object({ id: z.string().min(1), file: z.string().min(1), title: z.string().optional(), mood: z.string().min(1), durationS: z.number().positive().optional() })
  )
})
export type LibraryTrack = z.infer<typeof LibraryFile>['tracks'][number]

// ---------------------------------------------------------------------------------------------------------------------
// Pure planning functions (no I/O)

export interface Pause {
  start: number
  end: number
  /** True when the next word opens a new sentence. */
  sentenceBreak: boolean
}

/** Mulberry32: a small seeded generator (the node's only source of variation, R2.5). */
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

/** Voice gaps between words (and before the first / after the last), longer than `minS`. Seconds. */
export function voicePauses(words: readonly Word[], durationS: number, minS = 0.15): Pause[] {
  const sorted = [...words].sort((a, b) => a.start - b.start)
  const out: Pause[] = []
  let runEnd = 0
  let prev: Word | undefined
  for (const w of sorted) {
    if (w.start - runEnd > minS) out.push({ start: runEnd, end: w.start, sentenceBreak: prev === undefined || w.sentence !== prev.sentence })
    if (w.end >= runEnd) runEnd = w.end
    prev = w
  }
  if (durationS - runEnd > minS) out.push({ start: runEnd, end: durationS, sentenceBreak: true })
  return out
}

export interface Lift {
  start: number
  end: number
}

/**
 * Where the bed lifts: voice gaps of 1.5 s or more. The up ramp starts right after the last word, the down ramp is
 * finished before the next word (look-ahead from the word times, so the dip is never late).
 */
export function liftsFor(pauses: readonly Pause[]): Lift[] {
  return pauses
    .filter((p) => p.end - p.start >= LIFT_MIN_GAP_S)
    .map((p) => ({ start: p.start + LIFT_START_PAD_S, end: p.end - LIFT_END_PAD_S }))
}

export interface Boundary {
  /** Where the story turns (seconds). */
  t: number
  kind: 'chapter' | 'pivot' | 'disclosure'
}

/** Places where a new section may start: chapter openings and `pivot` / `disclosure` beats. */
export function boundaryCandidates(beats: readonly Beat[], chapterStartsS: readonly number[]): Boundary[] {
  const out: Boundary[] = []
  for (const b of beats) {
    if (b.start <= 0) continue
    if (b.tags.includes('disclosure')) out.push({ t: b.start, kind: 'disclosure' })
    else if (b.tags.includes('pivot')) out.push({ t: b.start, kind: 'pivot' })
    else if (b.chapter !== undefined || b.tags.includes('chapter')) out.push({ t: b.start, kind: 'chapter' })
  }
  for (const t of chapterStartsS) if (t > 0) out.push({ t, kind: 'chapter' })
  out.sort((a, b) => a.t - b.t)
  const merged: Boundary[] = []
  for (const c of out) {
    const last = merged.at(-1)
    if (last && c.t - last.t < 1) {
      if (c.kind !== 'chapter') last.kind = c.kind
    } else merged.push({ ...c })
  }
  return merged
}

const NEAREST_MOODS: Record<string, string[]> = {
  tension: ['tension', 'reflective', 'hopeful'],
  reflective: ['reflective', 'hopeful', 'tension'],
  hopeful: ['hopeful', 'reflective', 'tension']
}

/** A track of the mood (or the nearest mood, then any), never `prevId`; chosen by the seeded generator. Null when none. */
export function pickTrack(tracks: readonly LibraryTrack[], mood: string, prevId: string | undefined, rand: () => number): LibraryTrack | null {
  const order = [...(NEAREST_MOODS[mood] ?? [mood]), ...tracks.map((t) => t.mood)]
  for (const m of order) {
    const cands = tracks.filter((t) => t.mood === m && t.id !== prevId).sort((a, b) => (a.id < b.id ? -1 : 1))
    if (cands.length > 0) return cands[Math.floor(rand() * cands.length)] as LibraryTrack
  }
  return null
}

export interface CueSheetInput {
  durationS: number
  pauses: readonly Pause[]
  boundaries: readonly Boundary[]
  tracks: readonly LibraryTrack[]
  minCueS: number
  crossfadeS: number
  fadeUnderVoice?: boolean
  mood?: string
  seed: number
}

interface Cut {
  /** Crossfade start and length, entirely inside one voice pause. */
  start: number
  fade: number
  kind: Boundary['kind'] | 'split'
}

/** The crossfade for a wish at time `t`: inside the nearest usable pause (within `reach` s), or null. */
function cutNear(t: number, pauses: readonly Pause[], crossfadeS: number, reach: number, onlySentence = false, underVoice = false): { start: number; fade: number } | null {
  let best: { score: number; start: number; fade: number } | null = null
  for (const p of pauses) {
    const len = p.end - p.start
    if (underVoice && p.start > 0 && p.sentenceBreak) {
      // the crossfade centred on the sentence's end; a real pause nearby still wins by its score
      const middle = (p.start + p.end) / 2
      const score = Math.abs(middle - t) + 3
      if (Math.abs(middle - t) <= reach && (!best || score < best.score)) best = { score, start: Math.max(0.05, middle - crossfadeS / 2), fade: crossfadeS }
    }
    if (len < MIN_PAUSE_S || p.start <= 0 || (onlySentence && !p.sentenceBreak)) continue
    const fade = Math.min(crossfadeS, len - 0.1)
    const start = Math.min(Math.max(t - fade / 2, p.start + 0.05), p.end - 0.05 - fade)
    const score = Math.abs(start + fade / 2 - t) + (len < crossfadeS + 0.1 ? 6 : 0)
    if (Math.abs(start + fade / 2 - t) <= reach && (!best || score < best.score)) best = { score, start, fade }
  }
  return best
}

/**
 * The music cue sheet (§26.2): sections follow chapters and `pivot` / `disclosure` beats, each at least `minCueS` long
 * (long ones split at sentence starts), a cue changes only inside a voice pause with a crossfade, never the same track
 * twice in a row. A short video keeps one cue. Empty when the library has no track.
 */
export function buildCueSheet(o: CueSheetInput): SoundCue[] {
  const D = o.durationS
  if (o.tracks.length === 0 || D <= 0) return []
  const cuts: Cut[] = []
  const centre = (c: { start: number; fade: number }): number => c.start + c.fade / 2
  const room = (c: { start: number; fade: number }): boolean => {
    const prev = cuts.at(-1)
    return centre(c) - (prev ? centre(prev) : 0) >= o.minCueS && D - centre(c) >= o.minCueS
  }
  for (const b of o.boundaries) {
    const c = cutNear(b.t, o.pauses, o.crossfadeS, 25, false, o.fadeUnderVoice === true)
    if (c && room(c)) cuts.push({ ...c, kind: b.kind })
  }
  // long sections are split at sentence starts
  for (let guard = 0; guard < 1000; guard++) {
    const edges = [0, ...cuts.map(centre), D]
    const i = edges.findIndex((e, k) => k > 0 && e - (edges[k - 1] as number) > MAX_CUE_S)
    if (i < 0) break
    const a = edges[i - 1] as number
    const b = edges[i] as number
    const parts = Math.ceil((b - a) / MAX_CUE_S)
    const c = cutNear(a + (b - a) / parts, o.pauses, o.crossfadeS, 40, true) ?? cutNear(a + (b - a) / parts, o.pauses, o.crossfadeS, 60)
    if (!c) break
    cuts.splice(i - 1, 0, { ...c, kind: 'split' })
    cuts.sort((x, y) => x.start - y.start)
  }
  const rand = rng(o.seed)
  const sections: { track: LibraryTrack; mood: string; start: number; fade: number }[] = []
  let mood = o.mood ?? 'reflective'
  const starts = [{ start: 0, fade: 0, kind: 'chapter' as Cut['kind'] }, ...cuts]
  for (const [i, s] of starts.entries()) {
    if (i > 0) {
      const prevMood = sections.at(-1)?.mood ?? mood
      if (s.kind === 'pivot' || s.kind === 'disclosure') mood = 'tension'
      else if (prevMood === 'tension') mood = o.mood && o.mood !== 'tension' ? o.mood : 'reflective'
      else mood = prevMood === 'reflective' ? 'hopeful' : 'reflective'
    }
    const track = pickTrack(o.tracks, mood, sections.at(-1)?.track.id, rand)
    if (!track) continue // a library of one track: this section keeps playing the previous cue
    sections.push({ track, mood: track.mood, start: s.start, fade: s.fade })
  }
  return sections.map((s, i) => {
    const next = sections[i + 1]
    return {
      trackId: s.track.id,
      mood: s.mood,
      start: s.start,
      end: next ? next.start + next.fade : D,
      fadeIn: s.fade,
      fadeOut: next ? next.fade : 0
    }
  })
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

export interface EnvelopeInput {
  durationS: number
  /** Gain of the bed while the voice speaks, dB (already includes the track and voice levels). */
  baseDb: number
  liftDb: number
  lifts: readonly Lift[]
  attackS: number
  releaseS: number
  fadeInS: number
  fadeOutS: number
}

/** Linear gain of the bed at 100 values per second: the register level, lifts in long gaps, fade in and fade out. */
export function bedEnvelope(o: EnvelopeInput): Float32Array {
  const n = Math.ceil(o.durationS * ENV_RATE) + 2
  const out = new Float32Array(n)
  let li = 0
  for (let k = 0; k < n; k++) {
    const t = k / ENV_RATE
    while (li < o.lifts.length && (o.lifts[li] as Lift).end < t) li++
    let weight = 0
    const lift = o.lifts[li]
    if (lift && t >= lift.start) weight = Math.min(smooth((t - lift.start) / o.attackS), 1 - smooth((t - (lift.end - o.releaseS)) / o.releaseS))
    const fadeIn = o.fadeInS > 0 ? smooth(t / o.fadeInS) : 1
    const fadeOut = o.fadeOutS > 0 ? smooth((o.durationS - t) / o.fadeOutS) : 1
    out[k] = 10 ** ((o.baseDb + o.liftDb * weight) / 20) * fadeIn * fadeOut
  }
  return out
}

/** Gain at sample `n` by linear interpolation of the control-rate curve. */
export function envAt(env: Float32Array, n: number): number {
  const x = (n / SAMPLE_RATE) * ENV_RATE
  const i = Math.min(Math.floor(x), env.length - 2)
  const f = x - i
  return (env[i] as number) * (1 - f) + (env[i + 1] as number) * f
}

/** Soft limiter: transparent below the knee, then a smooth curve that never passes −1 dBFS. */
export function softLimit(x: number): number {
  const a = Math.abs(x)
  if (a <= LIMIT_KNEE) return x
  const y = LIMIT_KNEE + (LIMIT_CEIL - LIMIT_KNEE) * Math.tanh((a - LIMIT_KNEE) / (LIMIT_CEIL - LIMIT_KNEE))
  return x < 0 ? -y : y
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering

interface Decoded {
  data: Float32Array
  frames: number
}

async function decodeTrack(media: MediaService, file: string, durationS: number | undefined, signal: AbortSignal): Promise<Decoded> {
  const { stdout, done } = media.stream('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', '2', '-'], { signal })
  const chunks: Buffer[] = []
  for await (const c of stdout) chunks.push(Buffer.from(c))
  await done
  const buf = Buffer.concat(chunks)
  const all = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 8)))
  let frames = all.length / 2
  // the encoder's padding is cut off: the loop is exactly the period the library declares
  if (durationS) {
    const want = Math.round(durationS * SAMPLE_RATE)
    if (frames >= want - 2000 && frames <= want + 4000) frames = Math.min(frames, want)
  }
  if (frames < SAMPLE_RATE) throw new EngineError('bad_input', `track too short: ${file}`)
  return { data: all, frames }
}

interface Mixer {
  cues: SoundCue[]
  decoded: Map<string, Decoded>
  env: Float32Array
}

/** Interleaved stereo float chunks of the whole bed, `chunkFrames` frames at a time. */
async function* mixChunks(ctx: RunCtx, m: Mixer, total: number, chunkFrames: number): AsyncGenerator<Uint8Array> {
  const startN = m.cues.map((c) => Math.round(c.start * SAMPLE_RATE))
  const endN = m.cues.map((c) => Math.round(c.end * SAMPLE_RATE))
  const inN = m.cues.map((c) => Math.round(c.fadeIn * SAMPLE_RATE))
  const outN = m.cues.map((c) => Math.round(c.fadeOut * SAMPLE_RATE))
  let ci = 0
  for (let n0 = 0; n0 < total; n0 += chunkFrames) {
    throwIfAborted(ctx)
    const n1 = Math.min(total, n0 + chunkFrames)
    const out = new Float32Array((n1 - n0) * 2)
    for (let n = n0; n < n1; n++) {
      while (ci < m.cues.length && (endN[ci] as number) <= n) ci++
      let l = 0
      let r = 0
      for (let k = ci; k < m.cues.length && (startN[k] as number) <= n; k++) {
        let w = 1
        const fi = inN[k] as number
        const fo = outN[k] as number
        if (fi > 0 && n < (startN[k] as number) + fi) w *= Math.sin((Math.PI / 2) * ((n - (startN[k] as number)) / fi))
        if (fo > 0 && n >= (endN[k] as number) - fo) w *= Math.cos((Math.PI / 2) * ((n - ((endN[k] as number) - fo)) / fo))
        const tr = m.decoded.get((m.cues[k] as SoundCue).trackId) as Decoded
        const pos = ((n - (startN[k] as number)) % tr.frames) * 2
        l += (tr.data[pos] as number) * w
        r += (tr.data[pos + 1] as number) * w
      }
      const g = envAt(m.env, n)
      out[(n - n0) * 2] = softLimit(l * g)
      out[(n - n0) * 2 + 1] = softLimit(r * g)
    }
    progress(ctx, n1, total, 'Musique : mixage du fond sonore')
    yield new Uint8Array(out.buffer)
    // let the event loop breathe so a cancel is noticed between chunks
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function encodeFlac(ctx: RunCtx, source: AsyncIterable<Uint8Array>, out: string): Promise<void> {
  const media = need(ctx, 'media')
  await media.run(
    'ffmpeg',
    ['-y', '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', '2', '-i', '-', '-c:a', 'flac', '-sample_fmt', 's16', '-map_metadata', '-1', out],
    { signal: ctx.signal, stdin: source }
  )
}

async function loadLibrary(ctx: RunCtx, warnings: string[], own?: string): Promise<{ root: string; tracks: LibraryTrack[] } | null> {
  // the channel's own music (a story short's « Ta musique »): its one track, looped and ducked like the library's
  if (own) return { root: path.dirname(own), tracks: [{ id: 'own', file: path.basename(own), mood: 'own' }] }
  const lib = ctx.services.library
  if (!lib) {
    warnings.push('Bibliothèque musicale introuvable : le film n’aura pas de musique.')
    return null
  }
  const root = path.join(lib.root, 'music')
  try {
    const parsed = LibraryFile.parse(JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')))
    if (parsed.tracks.length === 0) throw new Error('empty')
    return { root, tracks: parsed.tracks }
  } catch {
    warnings.push('Bibliothèque musicale introuvable ou vide : le film n’aura pas de musique.')
    return null
  }
}

function plannedWarnings(cues: readonly SoundCue[], D: number, minCueS: number): string[] {
  const w: string[] = []
  if (cues.length === 1 && D >= 2 * minCueS) w.push('Un seul morceau pour tout le film (aucun chapitre exploitable dans une pause de la voix).')
  return w
}

async function bed(ctx: RunCtx, inputs: Record<string, Artefact>, p: Params, D: number, warnings: string[]): Promise<NodeOutputs> {
  const media = need(ctx, 'media')
  const dir = await scratch(ctx, 'sound')
  const out = path.join(dir, 'music.flac')
  const total = Math.round(D * SAMPLE_RATE)
  const words = readValue(inputs.words, WordsValue, 'words')
  const beats = BeatsValue.safeParse(inputs.beats?.value)
  const plan = EditPlan.safeParse(inputs.plan?.value)
  if (!beats.success) warnings.push('Les temps forts du récit sont illisibles : la musique ne suit pas les chapitres.')
  const chapterStarts = plan.success ? plan.data.chapters.map((c) => c.startFrame / FPS) : []
  const bedDb = p.bedDb ?? REGISTER_BED_DB[p.register]
  const voiceLufs = metaNumber(inputs.voice, 'lufs') ?? VOICE_LUFS
  const pauses = voicePauses(words, D)
  const lifts = liftsFor(pauses)
  const fadeIn = Math.min(p.fadeInS, D / 3)
  const fadeOut = Math.min(p.fadeOutS, D / 3)
  const ownFile = p.source === 'library' ? undefined : (inputs.track?.files?.[0] ?? (typeof inputs.track?.value === 'string' && inputs.track.value ? inputs.track.value : undefined))
  const library = await loadLibrary(ctx, warnings, ownFile)
  let tracks = library?.tracks ?? []
  const decoded = new Map<string, Decoded>()
  let cues: SoundCue[] = []
  // a track that cannot be decoded is dropped and the sheet is planned again without it
  for (let attempt = 0; attempt < 10 && library; attempt++) {
    cues = buildCueSheet({
      durationS: D,
      pauses,
      boundaries: beats.success ? boundaryCandidates(beats.data, chapterStarts) : boundaryCandidates([], chapterStarts),
      tracks,
      minCueS: p.minCueS,
      crossfadeS: p.crossfadeS,
      fadeUnderVoice: p.fadeUnderVoice,
      ...(ownFile ? { mood: 'own' } : p.mood ? { mood: p.mood } : {}),
      seed: ctx.seed
    })
    progress(ctx, attempt, 4, 'Musique : lecture des morceaux')
    const bad: string[] = []
    for (const id of new Set(cues.map((c) => c.trackId))) {
      if (decoded.has(id)) continue
      const t = tracks.find((x) => x.id === id) as LibraryTrack
      try {
        decoded.set(id, await decodeTrack(media, path.join(library.root, t.file), t.durationS, ctx.signal))
      } catch (e) {
        if (e instanceof AbortError || ctx.signal.aborted) throw e
        warnings.push(`Le morceau « ${t.title ?? t.id} » est illisible : il est écarté.`)
        bad.push(id)
      }
    }
    if (bad.length === 0) break
    tracks = tracks.filter((t) => !bad.includes(t.id))
    cues = []
  }
  if (cues.length === 0) {
    warnings.push('Aucun morceau disponible : le film n’aura pas de musique.')
    return silent(ctx, out, D, p, bedDb, lifts, warnings)
  }
  warnings.push(...plannedWarnings(cues, D, p.minCueS))
  const env = bedEnvelope({
    durationS: D,
    baseDb: voiceLufs + bedDb - TRACK_LUFS,
    liftDb: p.liftDb,
    lifts,
    attackS: ATTACK_S,
    releaseS: RELEASE_S,
    fadeInS: fadeIn,
    fadeOutS: fadeOut
  })
  for (const w of warnings) ctx.emit({ kind: 'log', level: 'warn', text: w })
  await encodeFlac(ctx, mixChunks(ctx, { cues, decoded, env }, total, SAMPLE_RATE), out)
  const soundplan = SoundPlan.parse({
    register: p.register, bedDb, liftDb: p.liftDb, cues,
    ducking: { attackS: ATTACK_S, releaseS: RELEASE_S, lifts },
    fadeInS: fadeIn, fadeOutS: fadeOut, durationS: D, warnings
  })
  return { music: { files: [out], meta: { durationS: D, demo: false } }, soundplan: { value: soundplan } }
}

async function silent(ctx: RunCtx, out: string, D: number, p: Params, bedDb: number, lifts: Lift[], warnings: string[]): Promise<NodeOutputs> {
  for (const w of warnings) ctx.emit({ kind: 'log', level: 'warn', text: w })
  const total = Math.round(D * SAMPLE_RATE)
  async function* zeros(): AsyncGenerator<Uint8Array> {
    for (let n = 0; n < total; n += SAMPLE_RATE) {
      throwIfAborted(ctx)
      yield new Uint8Array((Math.min(total, n + SAMPLE_RATE) - n) * 8)
    }
  }
  await encodeFlac(ctx, zeros(), out)
  const soundplan = SoundPlan.parse({
    register: p.register, bedDb, liftDb: p.liftDb, cues: [],
    ducking: { attackS: ATTACK_S, releaseS: RELEASE_S, lifts }, fadeInS: 0, fadeOutS: 0, durationS: D, warnings
  })
  return { music: { files: [out], meta: { durationS: D, demo: false } }, soundplan: { value: soundplan } }
}

async function run(ctx: RunCtx, inputs: Record<string, Artefact>, p: Params): Promise<NodeOutputs> {
  const media = need(ctx, 'media')
  const voiceFile = readFile0(inputs.voice, 'voice')
  const D = metaNumber(inputs.words, 'durationS') ?? (await probe(media, voiceFile, ctx.signal)).durationS
  const warnings: string[] = []
  try {
    return await bed(ctx, inputs, p, D, warnings)
  } catch (e) {
    if (e instanceof AbortError || ctx.signal.aborted) throw e
    if (e instanceof EngineError && e.code === 'missing_tool') throw e
    // sound never fails the video (§26): a silent bed of the right length keeps the types and the timeline
    const dir = await scratch(ctx, 'sound-silent')
    warnings.push(`La musique a échoué (${(e as Error).message.slice(0, 200)}) : le film n’aura pas de musique.`)
    return silent(ctx, path.join(dir, 'music.flac'), D, p, p.bedDb ?? REGISTER_BED_DB[p.register], [], warnings)
  }
}

export const soundMusic = defineNode<Params>({
  type: 'sound.music@1',
  inputs: {
    voice: { type: 'audio.voice', required: true },
    words: { type: 'json.words', required: true },
    beats: { type: 'json.beats', required: true },
    plan: { type: 'json.editplan', required: true },
    track: { type: 'audio.music', required: false, label: 'La musique de la chaîne' }
  },
  outputs: { music: 'audio.music', soundplan: 'json.soundplan' },
  params: SoundMusicParams,
  executors: ['local'],
  estimate(ctx) {
    const d = ctx.inputs.words?.meta?.durationS
    const D = typeof d === 'number' && Number.isFinite(d) ? d : ctx.minutes * 60
    return { units: [], durationS: 5 + D / 20 }
  },
  run,
  // the library is ours and local: the fake is the real thing (§26 Fake)
  fake: run
})
