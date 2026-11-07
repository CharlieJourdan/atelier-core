// `background.clips@1` (the « gameplay » kind of a drawn pipeline): a background video made of the user's own clips.
// The clips come from a folder (a workspace path given as a param, or a `$inputs` text) or from a `footage` input; the
// node picks pieces at random from a generator seeded by the run's seed (the same seed gives the same pieces), trims
// each one, loops the short clips by picking them again, and joins them into ONE silent layer as long as the voice
// (1920×1080, or 1080×1920 for a short; 30 fps, the same encoder as the base-track segments, so `render.assemble` joins it by copy). Local, free,
// the real code in demo mode too.
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError, seededRandom } from '../errors'
import { ASPECTS, FPS, frameSizeOf, toFrame, type Aspect } from '../formats/timing'
import { probe } from '../media/probe'
import { requireFilters } from '../media/tools'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { join } from '../render/final'
import { BT709, COLOUR_TAGS, SEGMENT_ENCODER } from '../render/segments'
import { need } from '../services'
import type { Json } from '../types'
import { metaNumber, progress, scratch, throwIfAborted } from './common'

/** Video file extensions a clip folder is read for (lower case). */
export const CLIP_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm'] as const

export const BackgroundParams = z
  .object({
    /** Folder of clips (absolute path, not searched below its first level). Empty: the `footage` input gives the clips. */
    folder: z
      .string()
      .min(1)
      .refine((p) => path.isAbsolute(p), 'le dossier de clips doit être un chemin complet')
      .optional(),
    /** Length of one picked piece, in seconds (a clip shorter than this is used whole). */
    minPieceS: z.number().min(0.5).max(60).default(4),
    maxPieceS: z.number().min(1).max(60).default(9),
    /**
     * The measured shot length (median, seconds) and its spread (the 90th percentile over the median): pieces follow that
     * log-normal spread between the bounds instead of an even draw (a story short: median 2.3 s, 90th percentile 5 s).
     */
    medianS: z.number().min(0.5).max(30).optional(),
    spread: z.number().min(1).max(5).default(2.2),
    /** Each clip once before any comes back (a big library: never the same footage twice in a video). */
    fresh: z.boolean().default(false),
    /** Colours pushed towards phone footage: 0 as filmed, 1 = saturation +50 %, contrast +6 %, brightness +0.04. */
    vivid: z.number().min(0).max(1).default(0),
    /** The film's shape: clips are cover-cropped to 1920×1080 (16:9) or to 1080×1920 (9:16, a short: the centre of a landscape clip). */
    aspect: z.enum(ASPECTS).default('16:9')
  })
  .refine((p) => p.minPieceS <= p.maxPieceS, { message: 'minPieceS must not exceed maxPieceS', path: ['minPieceS'] })
type Params = z.infer<typeof BackgroundParams>

export interface ClipInfo {
  file: string
  durationS: number
}

/** One piece of the background: `frames` frames of `file` from `startS`. */
export interface Piece {
  file: string
  startS: number
  frames: number
}

/** Pieces cut at once, two threads each (a story short has about 55 pieces of 2.3 s, 4.4 s each to cut: eight keep it near 30 s). */
const PARALLEL = 8

/** A piece shorter than this is merged into its neighbour instead of being cut. */
const MIN_TAIL_FRAMES = Math.round(FPS * 0.6)

/**
 * The pieces that cover exactly `frames` frames. Pure and deterministic for a given `rnd`: clips are drawn in turn (never
 * the same one twice in a row while another exists), each piece is a random stretch of `minS`–`maxS` seconds cut at a
 * random place of its clip; a clip shorter than the stretch is used whole, so a short folder loops.
 */
export function planPieces(
  clips: readonly ClipInfo[],
  frames: number,
  rnd: () => number,
  minS: number,
  maxS: number,
  o: { medianS?: number; spread?: number; fresh?: boolean } = {}
): Piece[] {
  if (clips.length === 0) throw new EngineError('bad_input', 'Il n’y a aucun clip dans le dossier de gameplay.')
  const pieces: Piece[] = []
  let left = frames
  let previous = -1
  let unused: number[] = []
  // a log-normal length whose 90th percentile is `spread` times the median (z of the 90th percentile: 1.2816)
  const sigma = Math.log(o.spread ?? 2.2) / 1.2816
  const length = (): number => {
    if (o.medianS === undefined) return minS + rnd() * (maxS - minS)
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd())
    return Math.min(maxS, Math.max(minS, o.medianS * Math.exp(sigma * z)))
  }
  while (left > 0) {
    let index: number
    if (o.fresh) {
      if (unused.length === 0) unused = clips.map((_, i) => i).filter((i) => i !== previous || clips.length === 1)
      index = unused.splice(Math.floor(rnd() * unused.length) % unused.length, 1)[0] as number
    } else {
      index = Math.floor(rnd() * clips.length) % clips.length
      if (clips.length > 1 && index === previous) index = (index + 1 + Math.floor(rnd() * (clips.length - 1))) % clips.length
    }
    previous = index
    const clip = clips[index] as ClipInfo
    const clipFrames = Math.max(1, Math.floor(clip.durationS * FPS) - 1)
    const want = Math.max(1, toFrame(length()))
    let n = Math.min(left, want, clipFrames)
    // never leave a sliver of a piece at the end: take it now when this clip can hold it
    if (left - n > 0 && left - n < MIN_TAIL_FRAMES && left <= clipFrames) n = left
    const room = Math.max(0, clip.durationS - n / FPS - 1 / FPS)
    const startS = Math.round(rnd() * room * 1000) / 1000
    pieces.push({ file: clip.file, startS, frames: n })
    left -= n
  }
  return pieces
}

/** ffmpeg arguments of one piece: cover-cropped to the film's frame, 30 fps, silent, in the segments' own encoding. */
export function pieceArgs(p: Piece, out: string, aspect: Aspect = '16:9', vivid = 0): string[] {
  const [w, h] = frameSizeOf(aspect)
  const chain = [
    `fps=${FPS}`,
    // a clip that ends a frame early holds its last picture instead of leaving the piece short
    'tpad=stop_mode=clone:stop_duration=2',
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${w}:${h}`,
    // the reference's phone footage is brighter and more saturated than most libraries (« vivid »: 1 = +50 % saturation)
    ...(vivid > 0 ? [`eq=saturation=${(1 + 0.5 * vivid).toFixed(3)}:contrast=${(1 + 0.06 * vivid).toFixed(3)}:brightness=${(0.04 * vivid).toFixed(3)}`] : []),
    'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos',
    'format=yuv420p',
    'setsar=1',
    BT709
  ]
  return [
    '-v', 'error', '-y', '-ss', p.startS.toFixed(3), '-i', p.file,
    '-vf', chain.join(','), '-frames:v', String(p.frames), '-r', String(FPS),
    ...SEGMENT_ENCODER, ...COLOUR_TAGS, '-threads', '2', '-an', out
  ]
}

/** The clips of a folder (first level, by extension), sorted by name so the order never depends on the system. */
export async function listClips(folder: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    throw new EngineError('bad_input', `Le dossier de gameplay est introuvable : ${folder}`)
  }
  return names
    .filter((n) => (CLIP_EXTENSIONS as readonly string[]).includes(path.extname(n).toLowerCase()) && !n.startsWith('.'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((n) => path.join(folder, n))
}

async function make(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const media = need(ctx, 'media')
  await requireFilters(media, ['scale', 'crop', 'tpad', 'fps', 'libx264'], ctx.signal)
  const voice = inputs.voice
  let seconds = metaNumber(voice, 'durationS')
  if (seconds === undefined) {
    const file = voice?.files?.[0]
    if (!file) throw new EngineError('missing_input', 'the voice is missing')
    seconds = (await probe(media, file, ctx.signal)).durationS
  }
  const frames = toFrame(seconds)
  if (frames < 1) throw new EngineError('bad_input', 'la voix est vide : il n’y a rien à habiller.')

  const given = inputs.footage?.files ?? []
  const fromFolder = p.folder ? await listClips(p.folder) : []
  const files = [...given, ...fromFolder]
  if (files.length === 0) {
    throw new EngineError('bad_input', p.folder ? `Aucun clip (${CLIP_EXTENSIONS.join(', ')}) dans ${p.folder}.` : 'Donne un dossier de clips de gameplay.')
  }
  progress(ctx, 0, 3, 'Je regarde tes clips')
  const clips: ClipInfo[] = []
  for (const file of files) {
    throwIfAborted(ctx)
    try {
      const info = await probe(media, file, ctx.signal)
      if (info.streams.some((s) => s.codec_type === 'video') && info.durationS >= 0.5) clips.push({ file, durationS: info.durationS })
      else ctx.emit({ kind: 'log', level: 'warn', text: `clip ignoré (pas de vidéo ou trop court) : ${path.basename(file)}` })
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `clip illisible, ignoré : ${path.basename(file)}` })
    }
  }
  if (clips.length === 0) throw new EngineError('bad_input', 'Aucun des clips n’est lisible.')

  const pieces = planPieces(clips, frames, seededRandom(ctx.seed), p.minPieceS, p.maxPieceS, {
    ...(p.medianS !== undefined ? { medianS: p.medianS, spread: p.spread } : {}),
    fresh: p.fresh
  })
  const dir = await scratch(ctx, 'background')
  const outs = pieces.map((_, i) => path.join(dir, `piece-${String(i + 1).padStart(3, '0')}.mp4`))
  let done = 0
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, pieces.length) }, async () => {
      while (next < pieces.length) {
        const i = next++
        throwIfAborted(ctx)
        await media.run('ffmpeg', pieceArgs(pieces[i] as Piece, outs[i] as string, p.aspect, p.vivid), { signal: ctx.signal })
        progress(ctx, 1 + 2 * (++done / pieces.length), 3, `clip ${done} sur ${pieces.length}`)
      }
    })
  )
  const size = frameSizeOf(p.aspect)
  const joined = await join(media, outs, frames, dir, ctx.signal)
  progress(ctx, 3, 3, 'Fond vidéo prêt')
  return {
    layer: {
      files: [joined],
      meta: {
        durationS: Math.round((frames / FPS) * 1000) / 1000,
        frames,
        width: size[0],
        height: size[1],
        fps: FPS,
        clips: clips.length,
        pieces: pieces.map((x) => ({ clip: path.basename(x.file), startS: x.startS, frames: x.frames })) as unknown as Json
      }
    }
  }
}

export const backgroundClips = defineNode({
  type: 'background.clips@1',
  inputs: {
    voice: { type: 'audio.voice', required: true, label: 'Voix (sa durée fixe celle du fond)' },
    footage: { type: 'media.clip[]', required: false, label: 'Clips' }
  },
  outputs: { layer: 'media.clip[]' },
  params: BackgroundParams,
  executors: ['local'],
  render: true,
  estimate: (ctx) => ({ units: [], durationS: 5 + ctx.minutes * 20 }),
  run: make,
  // everything here is local and free: there is nothing to fake
  fake: make
})
