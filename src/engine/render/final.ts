// The join and final pass (docs/ENGINE-SPEC.md §28.2, §28.4, §28.5): the segments are joined by stream copy (and the
// join checked), then one pass burns the captions and labels (and the DÉMO watermark when a demo provider made any
// input), mixes voice + music, masters to −14 LUFS integrated with a −1 dBTP ceiling (one linear gain, a limiter
// only if needed) and encodes H.264 High / AAC 48 kHz with the index at the front. The result is written to a temp
// file, verified (frame count, audio length, no read error), then renamed into place.
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EngineError } from '../errors'
import { insetBox, type Inset } from '../formats/inset'
import { FPS, FRAME_SIZE } from '../formats/timing'
import { gainFilter, gainFor } from '../media/audio'
import { filterPath, withShortPaths } from '../media/filters'
import { probe } from '../media/probe'
import type { MediaService } from '../services'
import { layerArgs, layerGraph, type LayerInput } from './layers'
import { BT709, COLOUR_TAGS, INTERMEDIATE_ENCODER } from './segments'

export const MASTER_LUFS = -14
export const MASTER_CEILING = -1

export interface FinalInput {
  /** Black bars top and bottom (moteur-briques): the picture's aspect between them, e.g. 2.0 or 2.39 inside 16:9; absent = none. */
  letterbox?: number
  segments: string[]
  frames: number
  voice: string
  music: string | null
  /** Extra gain on the music bed (dB; the edit review lowers a bed too loud under the voice, controles-bloquants). */
  musicDb?: number
  /** ASS file to burn (captions and/or labels), and the folder of its fonts. */
  subs: string | null
  fontsDir: string
  watermark: boolean
  /** Where the DÉMO mark goes: top right, or top left when a chapter mark already sits at the top right (production-9). */
  watermarkLeft?: boolean
  /** A still (PNG with transparency) laid over the picture from `startS` to `endS`, centred, fading in and out. */
  card?: IntroCard | null
  /** Videos laid over the picture as a small square at the bottom right (an avatar in picture-in-picture), each from `startS` to `endS`. */
  pips?: { file: string; startS: number; endS: number; /** The pipeline's inset (formats/inset.ts); absent: the small square. */ inset?: Inset }[]
  /**
   * Animated overlays (`motion.render`, §25): transparent video files the size of the frame, each laid over the picture from its first
   * frame at `startFrame` to `endFrame`. Under the card, the pictures-in-picture and the captions, over the base track.
   */
  overlays?: { file: string; startFrame: number; endFrame: number }[]
  /**
   * The editing bricks' layers (production-9: the sponsor's slot and QR code, the chapter marks), laid in this order over the
   * pictures-in-picture and under the captions.
   */
  layers?: LayerInput[]
  /** The frame, `[width, height]`; default 1920×1080. */
  size?: readonly [number, number]
  font: string
  crf: number
  preset: string
  dir: string
  out: string
  signal: AbortSignal
  onProgress?: (frac: number) => void
}

export interface FinalResult {
  durationS: number
  frames: number
  measuredLufs: number
  gainDb: number
  limited: boolean
}

/** The mix of voice and music (both already at their levels: the music bed sits under the voice by design). */
export const mixFilter = (hasMusic: boolean, musicDb = 0): string =>
  hasMusic
    ? `[1:a]aresample=48000,aformat=channel_layouts=stereo[vo];[2:a]aresample=48000,aformat=channel_layouts=stereo${musicDb !== 0 ? `,volume=${musicDb.toFixed(2)}dB` : ''}[mu];[vo][mu]amix=inputs=2:normalize=0:duration=first[mix]`
    : '[1:a]aresample=48000,aformat=channel_layouts=stereo[mix]'

async function measureMix(media: MediaService, voice: string, music: string | null, signal: AbortSignal, musicDb = 0): Promise<{ integrated: number; truePeak: number }> {
  // input 0 is a placeholder so the mix's labels match the final pass ([1:a] voice, [2:a] music)
  const args = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-i', voice, ...(music ? ['-i', music] : [])]
  const { stderr } = await media.run('ffmpeg', ['-v', 'info', ...args, '-filter_complex', `${mixFilter(music !== null, musicDb)};[mix]loudnorm=print_format=json[out]`, '-map', '[out]', '-f', 'null', '-'], { signal })
  let j: { input_i?: string; input_tp?: string } = {}
  try {
    j = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as typeof j
  } catch {
    throw new EngineError('internal', 'loudness measurement of the mix gave no result')
  }
  const integrated = Number(j.input_i)
  const truePeak = Number(j.input_tp)
  return { integrated: Number.isFinite(integrated) ? integrated : -70, truePeak: Number.isFinite(truePeak) ? truePeak : -70 }
}

/** Joins the segments by copy; checks the joined length equals the sum (±1 frame), else re-encodes the join. */
export async function join(media: MediaService, segments: string[], frames: number, dir: string, signal: AbortSignal): Promise<string> {
  const list = path.join(dir, 'segments.txt')
  await writeFile(list, segments.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  const joined = path.join(dir, 'joined.mp4')
  await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], { signal })
  const got = Math.round((await probe(media, joined, signal)).durationS * FPS)
  if (Math.abs(got - frames) <= 1) return joined
  const again = path.join(dir, 'joined-reencoded.mp4')
  await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, ...INTERMEDIATE_ENCODER, ...COLOUR_TAGS, again], { signal })
  return again
}

/**
 * The first input of the final pass: the segments read through the concat list itself, when their lengths add up to the plan's (±1 frame).
 * No joined copy is written: that copy was as big as every segment together (about 8 GB for 3 minutes of grainy archive, rendu-menage), which
 * doubled the disk a render needed. A film whose segments do not add up still goes through `join` (copy, then re-encode).
 */
export async function joinedInput(media: MediaService, segments: string[], frames: number, dir: string, signal: AbortSignal): Promise<{ args: string[]; file: string | null }> {
  const list = path.join(dir, 'segments.txt')
  await writeFile(list, segments.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  let seconds = 0
  for (const s of segments) seconds += (await probe(media, s, signal)).durationS
  if (Math.abs(Math.round(seconds * FPS) - frames) <= 1) return { args: ['-f', 'concat', '-safe', '0', '-i', list], file: null }
  const file = await join(media, segments, frames, dir, signal)
  return { args: ['-i', file], file }
}

/**
 * The `pop` card: scaled every frame around its centre, from 50 % to 100 % over its first 0.12 s, and down to 40 % over its last
 * 0.12 s (measured on the reference, frame by frame); even sizes so the overlay never shifts by a half pixel.
 */
function popCardGraph(c: Omit<IntroCard, 'file'>, input: number, size: readonly [number, number], from: string): string {
  const a = c.startS.toFixed(3)
  const out = (c.endS - POP_S).toFixed(3)
  const k = `if(lt(t,${a}+${POP_S}),0.5+0.5*max(0,t-${a})/${POP_S},if(gt(t,${out}),max(0.4,1-0.6*(t-${out})/${POP_S}),1))`
  const placed = Number(cardY(size, c.height))
  const top = c.y ?? (Number.isFinite(placed) ? placed : 0)
  const box = c.boxH ?? c.height ?? 0
  const shown = `between(t,${a},${c.endS.toFixed(3)})`
  return (
    `[${input}:v]format=rgba,scale=w='trunc(iw*${k}/2)*2':h=-2:eval=frame[card];` +
    `${from}[card]overlay=x='(W-w)/2':y='${top}+(${box}-${box}*w/${size[0]})/2':eval=frame:eof_action=pass:enable='${shown}'[ov]`
  )
}

/**
 * Where the card's top edge goes. Landscape: centred. Portrait: horizontally centred, vertically in the upper third (its
 * middle at 27 % of the height), never closer than 180 px to the top (the phone's own bar sits there).
 */
export function cardY(size: readonly [number, number], cardHeight: number | undefined): string {
  if (size[1] <= size[0] || cardHeight === undefined) return '(H-h)/2'
  return String(Math.max(180, Math.round(size[1] * 0.27 - cardHeight / 2)))
}

/** The intro card as `render.assemble` lays it. */
export interface IntroCard {
  file: string
  startS: number
  endS: number
  /** Its pixel height (portrait films place it from the top). */
  height?: number
  /** `pop` (a story short's post card): its top edge at `y`, it grows from half its size in 0.12 s and shrinks away in 0.12 s. */
  anim?: 'fade' | 'pop'
  y?: number
  /** The card's own height inside the PNG (its centre is where it grows from). */
  boxH?: number
}

/** Seconds of the `pop` card's entrance and exit. */
export const POP_S = 0.12

/** The filters that lay the card on the picture: fade in, hold, fade out, then gone (`[ov]` is the picture with the card). */
export function cardGraph(c: Omit<IntroCard, 'file'>, input: number, size: readonly [number, number] = FRAME_SIZE, from = '[0:v]'): string {
  if (c.anim === 'pop') return popCardGraph(c, input, size, from)
  const fade = Math.min(0.2, Math.max(0.05, (c.endS - c.startS) / 6))
  const shown = `between(t,${c.startS.toFixed(3)},${c.endS.toFixed(3)})`
  return (
    `[${input}:v]format=rgba,fade=t=in:st=${c.startS.toFixed(3)}:d=${fade.toFixed(3)}:alpha=1,fade=t=out:st=${(c.endS - fade).toFixed(3)}:d=${fade.toFixed(3)}:alpha=1[card];` +
    `${from}[card]overlay=x=(W-w)/2:y=${cardY(size, c.height)}:eof_action=pass:enable='${shown}'[ov]`
  )
}

/**
 * One animated overlay on the picture: its frames start at `startFrame` and the overlay shows for exactly its own frames. The `enable`
 * window opens and closes half a frame early so a frame time that is not exactly k/30 in floating point still lands on the right frame.
 */
export function motionGraph(m: { startFrame: number; endFrame: number }, input: number, from: string, to: string): string {
  const at = (frame: number): string => ((frame - 0.5) / FPS).toFixed(4)
  return (
    `[${input}:v]setpts=PTS-STARTPTS+${(m.startFrame / FPS).toFixed(4)}/TB,format=rgba[mo${input}];` +
    `${from}[mo${input}]overlay=x=0:y=0:eof_action=pass:enable='gte(t,${at(m.startFrame)})*lt(t,${at(m.endFrame)})'${to}`
  )
}

/**
 * Where the picture-in-picture goes and how big: a square, bottom right with a margin of 4 % of the width (landscape: 24 % of the
 * width wide; portrait: 36 %, its bottom edge at 78 % of the height so it stays out of the phone's bottom UI zone).
 */
export function pipBox(size: readonly [number, number]): { side: number; x: number; y: number } {
  const [w, h] = size
  const portrait = h > w
  const side = 2 * Math.round((w * (portrait ? 0.36 : 0.24)) / 2)
  const margin = Math.round(w * 0.04)
  return { side, x: w - side - margin, y: portrait ? Math.round(h * 0.78) - side : h - side - margin }
}

/** The filters that lay one clip on the picture as a square with a soft shadow, only between its times (`from` → `to` are labels). */
export function pipGraph(p: { startS: number; endS: number; inset?: Inset }, input: number, from: string, to: string, size: readonly [number, number]): string {
  const on = `between(t,${p.startS.toFixed(3)},${p.endS.toFixed(3)})`
  const tag = to.replace(/[^a-z0-9]/gi, '')
  if (p.inset) {
    // the pipeline's inset (its references': a 16:9 window with a white border, flat): the presenter cover-cropped inside, then framed
    const b = insetBox(p.inset, size)
    const iw = b.w - 2 * b.border
    const ih = b.h - 2 * b.border
    return (
      `[${input}:v]setpts=PTS-STARTPTS+${p.startS.toFixed(3)}/TB,scale=${iw}:${ih}:force_original_aspect_ratio=increase:flags=lanczos,crop=${iw}:${ih}` +
      (b.border > 0 ? `,pad=${b.w}:${b.h}:${b.border}:${b.border}:color=white` : '') +
      `,format=rgba[${tag}p];` +
      `${from}[${tag}p]overlay=x=${b.x}:y=${b.y}:eof_action=pass:enable='${on}'${to}`
    )
  }
  const { side, x, y } = pipBox(size)
  return (
    `[${input}:v]setpts=PTS-STARTPTS+${p.startS.toFixed(3)}/TB,scale=${side}:${side}:force_original_aspect_ratio=increase:flags=lanczos,crop=${side}:${side},format=rgba,split[${tag}p][${tag}s];` +
    `[${tag}s]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.55,boxblur=14:3[${tag}sh];` +
    `${from}[${tag}sh]overlay=x=${x + 8}:y=${y + 10}:eof_action=pass:enable='${on}'[${tag}t];` +
    `[${tag}t][${tag}p]overlay=x=${x}:y=${y}:eof_action=pass:enable='${on}'${to}`
  )
}

/** The two black bars of a letterbox of aspect `aspect` on a `size` frame, as drawbox filters (none when the frame is already
 *  that wide or wider). Each bar has an even height. Pure. */
export function letterboxFilters(size: readonly [number, number], aspect: number): string[] {
  const [w, h] = size
  const bar = 2 * Math.round((h - w / aspect) / 4)
  if (!(bar > 0) || bar * 2 >= h) return []
  return [`drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill`, `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`]
}

export async function finalPass(media: MediaService, o: FinalInput): Promise<FinalResult> {
  const joined = await joinedInput(media, o.segments, o.frames, o.dir, o.signal)
  const measured = await measureMix(media, o.voice, o.music, o.signal, o.musicDb ?? 0)
  const { gainDb, limit } = gainFor(measured, MASTER_LUFS, MASTER_CEILING)
  const video: string[] = []
  // the animated overlays go straight over the base track (under everything else), one after another
  const motions = o.overlays ?? []
  const motionIn = 2 + (o.music ? 1 : 0)
  let current = '[0:v]'
  const motionLayers = motions.map((m, k) => {
    const layer = motionGraph(m, motionIn + k, current, `[mot${k}]`)
    current = `[mot${k}]`
    return layer
  })
  // the card is the next input after the voice and the music, so their input numbers never change (the mix's labels stay)
  const cardIn = motionIn + motions.length
  const card = o.card ? cardGraph(o.card, cardIn, o.size, current) : null
  if (card) current = '[ov]'
  // the pictures-in-picture come after the card input, and are laid over the picture (and the card) one after another
  const pips = o.pips ?? []
  const pipIn = cardIn + (o.card ? 1 : 0)
  const pipLayers = pips.map((p, k) => {
    const layer = pipGraph(p, pipIn + k, current, `[pip${k}]`, o.size ?? FRAME_SIZE)
    current = `[pip${k}]`
    return layer
  })
  // the editing bricks' layers come last, so every input number before them stays what it was
  const layers = o.layers ?? []
  const layerIn = pipIn + pips.length
  const editLayers = layers.map((l, k) => {
    const g = layerGraph(l, layerIn + k, current, `[lay${k}]`, o.size ?? FRAME_SIZE)
    current = `[lay${k}]`
    return g
  })
  // libass (the captions and their fonts) and FreeType (the watermark) open their files themselves: a long path goes short first
  return withShortPaths([o.subs, o.subs ? o.fontsDir : null, o.watermark ? o.font : null], async (short) => {
    // the bars go over every picture layer and under the captions and the mark (they stay readable)
    if (o.letterbox) video.push(...letterboxFilters(o.size ?? FRAME_SIZE, o.letterbox))
    if (o.subs) video.push(`ass=${filterPath(short(o.subs))}:fontsdir=${filterPath(short(o.fontsDir))}`)
    if (o.watermark) {
      video.push(`drawtext=fontfile=${filterPath(short(o.font))}:text=DÉMO:expansion=none:fontsize=44:fontcolor=white@0.55:borderw=2:bordercolor=black@0.35:x=${o.watermarkLeft ? '60' : 'w-text_w-60'}:y=48`)
    }
    video.push('format=yuv420p', BT709)
    const seconds = o.frames / FPS
    const graph = [...motionLayers, ...(card ? [card] : []), ...pipLayers, ...editLayers, `${current}${video.join(',')}[v]`, mixFilter(o.music !== null, o.musicDb ?? 0), `[mix]${gainFilter(gainDb, limit, MASTER_CEILING)},apad,atrim=0:${seconds.toFixed(4)}[a]`].join(';')
    const tmp = path.join(o.dir, `.final-${process.pid}.mp4`)
    const args = [
      '-v', 'error', '-y', '-progress', 'pipe:2', '-stats_period', '1',
      ...joined.args, '-i', o.voice, ...(o.music ? ['-i', o.music] : []),
      ...motions.flatMap((m) => ['-i', m.file]),
      ...(o.card ? ['-loop', '1', '-framerate', String(FPS), '-t', (o.card.endS + 1).toFixed(3), '-i', o.card.file] : []),
      ...pips.flatMap((p) => ['-i', p.file]),
      ...layers.flatMap(layerArgs),
      '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
      '-frames:v', String(o.frames), '-r', String(FPS),
      '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...COLOUR_TAGS,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', tmp
    ]
    try {
      await media.run('ffmpeg', args, {
        signal: o.signal,
        onStderrLine: (line) => {
          const m = /^frame=(\d+)/.exec(line)
          if (m && o.onProgress) o.onProgress(Math.min(1, Number(m[1]) / o.frames))
        }
      })
      const info = await verify(media, tmp, o.frames, o.signal, o.size)
      await rename(tmp, o.out)
      // the joined copy of every segment (lossless: as big as all of them together) is not needed any more
      if (joined.file) await rm(joined.file, { force: true })
      return { durationS: info.durationS, frames: info.frames, measuredLufs: measured.integrated, gainDb, limited: limit }
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
  })
}

/** Cheap verification (§28.4): frame count = F ±1, one audio stream as long as the picture (±1 frame + an AAC frame). */
export async function verify(media: MediaService, file: string, frames: number, signal: AbortSignal, size: readonly [number, number] = FRAME_SIZE): Promise<{ durationS: number; frames: number }> {
  const info = await probe(media, file, signal)
  const v = info.streams.find((s) => s.codec_type === 'video')
  const a = info.streams.filter((s) => s.codec_type === 'audio')
  const got = Number(v?.nb_frames ?? NaN)
  const problems: string[] = []
  if (!v || v.width !== size[0] || v.height !== size[1]) problems.push(`picture is not ${size[0]}×${size[1]}`)
  if (!Number.isFinite(got) || Math.abs(got - frames) > 1) problems.push(`picture has ${String(v?.nb_frames)} frames, ${frames} planned`)
  if (a.length !== 1) problems.push(`${a.length} audio streams`)
  const aDur = Number(a[0]?.duration ?? NaN)
  const vDur = Number(v?.duration ?? NaN)
  if (!Number.isFinite(aDur) || Math.abs(aDur - vDur) > 1 / FPS + 0.03) problems.push(`audio lasts ${aDur} s, picture ${vDur} s`)
  if (problems.length > 0) throw new EngineError('verify_failed', `Le rendu a échoué à la vérification : ${problems.join(' ; ')}`)
  return { durationS: info.durationS, frames: got }
}
