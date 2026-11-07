// Base-track segments (docs/ENGINE-SPEC.md §28.1): one intermediate per base shot, all in the same format (1920×1080, or
// 1080×1920 for a short; 30 fps, yuv420p, BT.709 tags, H.264 at a high quality) so the join is a stream copy. A still gets the planned camera
// move as a smooth sub-pixel transform (ffmpeg `perspective` with cubic interpolation, eased at both ends, R21.6).
// Transitions are rendered into the segments themselves: a dissolve blends the previous picture (its move continued)
// into the head of the incoming segment; a dip fades the tail of the outgoing and the head of the incoming segment.
// A shot that is a video (a generated clip, an avatar) is a segment too (§28.1 « Video clip »): the clip is scaled to fill and
// cropped like a still, conformed to 30 fps, its sound dropped; if the shot is up to 1.3x longer than the clip it is slowed to fit,
// beyond that the last frame is held (a real clip is never looped); a longer clip is cut at the shot's end. Its picture (`image`)
// stays in the spec: it is what a failed segment falls back to, and it keys nothing else.
// A presenter on half the screen (layout `split`, production-9) is one segment too: the presenter's clip cover-cropped to its half, the
// picture beside it (a still with its slow move, or a clip) on the other half, a thin dark line between them.
// motion-montage: a still may also pan through camera keys, punch in on the beat of the voice, or move in 2.5D parallax (camera.ts), and a
// shot may come in with a flash, a whip, a push, a zoom or a match cut (transitions.ts), all rendered here the same way as the dissolve.
// Each segment is cached by the hash of its spec, its picture's and clip's bytes and the encoder settings (R7.6, §28 Cache).
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Motion, Shot, Transition } from '../formats/editplan'
import { FPS, FRAME_SIZE } from '../formats/timing'
import type { MediaService } from '../services'
import { cameraFilter, maxZoom, parallaxGraph } from './camera'
import { TRANSITION_FRAMES, isBlend, transitionGraph, type TransitionDir } from './transitions'

/**
 * Every intermediate video (a presenter cut, a clip piece, a segment, a re-encoded join) is lossless H.264 (avatar-qualite;
 * CRF 12 since production-17): the final pass is the ONE lossy compression of our chain. Two CRF 12 passes before the final
 * one cost 1.6 dB on the first real hook's presenter. The price is disk: about 55 Mbit/s at 1080p30 while a film is made.
 * rendu-menage: `ultrafast` since lossless output is the same pixels whatever the preset; it costs 43 % fewer core-seconds than `veryfast`
 * (13 against 23 s on a 4.5 s archive segment) for 19 % more disk, which the housekeeping (housekeeping.ts) now bounds.
 */
export const INTERMEDIATE_ENCODER = ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p']
/** Intermediate encoder settings: every segment shares them (the join is a copy). Lossless H.264 has its own profile. */
export const SEGMENT_ENCODER = [...INTERMEDIATE_ENCODER]
export const COLOUR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

/** Colour properties of every frame (the encoder writes them as the stream's tags). */
export const BT709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'

/** Frames of a dissolve and of each half of a dip (R21.5: soft transitions at paragraph and chapter changes). */
export const DISSOLVE_FRAMES = 12
export const DIP_FRAMES = 8

/** Colour grades a channel style may pin (v0: a few tonal looks, applied to stock and generated pictures). */
export const GRADES: Record<string, string> = {
  none: '',
  warm: 'colorbalance=rm=0.05:gm=0.01:bm=-0.04:rh=0.03:bh=-0.03',
  cool: 'colorbalance=rm=-0.04:bm=0.05:rh=-0.02:bh=0.03',
  film: 'eq=contrast=1.06:saturation=0.88:gamma=0.98,colorbalance=rs=0.02:bs=-0.02',
  // the documentary archives' look (style-markets): contrast up, colour down, a warm cast, a soft vignette and a fine grain
  // documentary-2: archive film as the reference shows it, black and white with its levels stretched (deep blacks, bright whites), a fine grain
  // (the curve brings its tones to the reference's: p10 / p50 / p90 of 3 / 72 / 176 against 29 / 111 / 214 without it, director-motion)
  'archive-film': "hue=s=0,normalize=blackpt=black:whitept=white:smoothing=60:independence=0:strength=0.85,eq=contrast=1.12:brightness=0.01,curves=all='0/0 0.11/0.012 0.435/0.28 0.84/0.69 1/0.98',noise=alls=7:allf=t",
  archive: 'eq=contrast=1.1:saturation=0.74:gamma=0.96,colorbalance=rs=0.03:gs=0.01:bs=-0.03,vignette=angle=PI/4.6,noise=alls=5:allf=t',
  // motion-montage: a light lift for stills and footage alike (contrast up a touch, colour down a touch)
  natural: 'eq=contrast=1.05:saturation=0.96:gamma=1.02',
  // motion-montage: a generated still made to pass for a phone's picture: a little soft, a fixed fine grain, a warm cast,
  // sharpened back, then the light lift
  phone: 'gblur=sigma=0.8,noise=c0s=7:c1s=3:c2s=3,colorbalance=rm=0.03:bm=-0.03,unsharp=5:5:0.9,eq=contrast=1.05:saturation=0.96:gamma=1.02'
}

export interface SegmentSpec {
  shotId: string
  frames: number
  image: string
  /** The shot is this video instead of its picture: no camera move (the clip has its own), no sound. */
  clip?: { file: string; durationS: number }
  motion: Motion | undefined
  /**
   * The previous shot's picture, held at the end of its move, blended into this segment's head: a dissolve, or (motion-montage) the
   * transition `kind` towards `dir`.
   */
  dissolveFrom?: {
    image: string
    motion: Motion | undefined
    shotFrames: number
    /** Its own grade when it differs (a card: none). */
    grade?: string
    kind?: Exclude<Transition, 'cut' | 'dip'>
    dir?: TransitionDir
    punches?: Shot['punches']
  }
  /** Punch-ins on the beat of the voice (a still only). */
  punches?: Shot['punches']
  /** A parallax still's near layer: a cut-out of the subject (a picture whose alpha is the subject); none: the focus ellipse. */
  mask?: string
  /**
   * An archive film's frame (documentary-2, measured on Markets of the Past): `tv` = the film cropped 4:3 in the middle of the frame under
   * an old-TV mask (rounded corners, heavy vignette: `filmMask`), the sides filled with the same film blurred and darkened. Unset: cover.
   */
  film?: 'tv' | 'full'
  filmMask?: string
  dipIn: boolean
  dipOut: boolean
  grade: string
  /** The frame, `[width, height]`; default 1920×1080. Part of the cache key (it is in the ffmpeg arguments). */
  size?: readonly [number, number]
  /** Layout `split`: `clip` is the presenter, on one half; this picture (or clip) takes the other half, on `side`. */
  split?: { side: 'left' | 'right'; image: string; clip?: { file: string; durationS: number }; motion: Motion | undefined }
}

/** The beside picture's move when the plan gives none: a slow push. */
export const SPLIT_MOTION = { kind: 'push', from: 1.02, to: 1.1 } as const

/**
 * Eased progress 0→1 over `n` frames, at output frame `on` + `offset` (smoothstep: eased at both ends), held at 1 past
 * the end (min(t, 1) written as (t + 1 − |t − 1|) / 2: no comma, which would split the filter graph).
 */
function easeExpr(n: number, offset: number): string {
  const t = `((on+${offset})/${Math.max(1, n - 1)})`
  const u = `((${t}+1-abs(${t}-1))/2)`
  return `(${u}*${u}*(3-2*${u}))`
}

/**
 * The `perspective` filter for a move: zoom `from`→`to` around the centre (push/pull), or a drift across the frame at a
 * fixed zoom (left/right). `n` = frames of the whole move, `offset` = frames already played (a dissolve continues the
 * previous shot's move past its end). Expressions avoid commas (they separate filters in a graph).
 */
export function motionFilter(m: Motion | undefined, n: number, offset = 0): string {
  const mm: Motion = m ?? { kind: 'push', from: 1.02, to: 1.02 }
  const e = easeExpr(n, offset)
  let z: string
  let cx: string
  if (mm.kind === 'left' || mm.kind === 'right') {
    const zoom = Math.max(mm.from, mm.to, 1.08)
    const travel = (1 - 1 / zoom) * 0.42 // stay inside the picture
    const sign = mm.kind === 'left' ? 1 : -1
    z = `${zoom.toFixed(4)}`
    cx = `(0.5+${(sign * travel).toFixed(4)}*(0.5-${e}))`
  } else {
    z = `(${mm.from.toFixed(4)}+${(mm.to - mm.from).toFixed(4)}*${e})`
    cx = '0.5'
  }
  const hw = `(W/(2*${z}))`
  const hh = `(H/(2*${z}))`
  const x = `(W*${cx})`
  const y = '(H*0.5)'
  return (
    `perspective=x0=${x}-${hw}:y0=${y}-${hh}:x1=${x}+${hw}:y1=${y}-${hh}:x2=${x}-${hw}:y2=${y}+${hh}:x3=${x}+${hw}:y3=${y}+${hh}` +
    ':interpolation=cubic:eval=frame'
  )
}

/** A picture cover-cropped to the frame. */
const prepFor = (size: readonly [number, number]): string => `scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase:flags=lanczos,crop=${size[0]}:${size[1]},format=yuv444p`
const finish = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p,setsar=1,' + BT709

/** A shot up to this much longer than its clip is slowed to the clip's length; a longer one holds the last frame. */
export const MAX_SLOWDOWN = 1.3

/** The filters of a video shot: 30 fps, cover-crop, a gentle slow-down or a held last frame, the grade. */
function clipChain(s: SegmentSpec, clip: { durationS: number }, prep: string, grade: string): string {
  const ratio = s.frames / FPS / Math.max(0.1, clip.durationS)
  const slow = ratio > 1.02 && ratio <= MAX_SLOWDOWN ? [`setpts=${ratio.toFixed(5)}*PTS`, `fps=${FPS}`] : []
  return ['setpts=PTS-STARTPTS', `fps=${FPS}`, prep, ...slow, `tpad=stop_mode=clone:stop_duration=${(s.frames / FPS).toFixed(4)}`, grade].filter(Boolean).join(',')
}

/**
 * An archive film in the old-TV frame, from input 0 into `[label]` (the mask is added to `args` as the next input): the film cropped 4:3 and
 * graded in the middle, its slow push (the shot's `motion`, else 2 % over the shot; a sub-pixel camera: a scale filter steps by whole pixels
 * and shakes), the same film blurred and darkened on the sides, the mask over the 4:3 part.
 */
function tvGraph(s: SegmentSpec, clip: { durationS: number }, args: string[], size: readonly [number, number], grade: string, label: string): string {
  const [w, h] = size
  const fw = 2 * Math.round((h * 4) / 3 / 2)
  const x = Math.round((w - fw) / 2)
  const timed = clipChain(s, clip, 'format=yuv444p', '')
  const push = cameraFilter(s.motion ?? { kind: 'push', from: 1, to: 1.02, ease: 'linear' }, s.frames)
  let mask = ''
  if (s.filmMask) {
    const index = args.filter((a) => a === '-i').length
    args.push('-loop', '1', '-framerate', String(FPS), '-i', s.filmMask)
    mask = `;[${index}:v]scale=${fw}:${h},format=rgba[tvm];[tvc][tvm]overlay=${x}:0:shortest=1`
  }
  return (
    `[0:v]${timed},split=2[tva][tvb];` +
    `[tvb]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:3,hue=s=0,eq=brightness=-0.32:contrast=0.8[tvbg];` +
    `[tva]crop='min(iw,ih*4/3)':ih,scale=${fw}:${h}:flags=lanczos,${[grade, push].filter(Boolean).join(',')}[tvfg];` +
    `[tvbg][tvfg]overlay=${x}:0${mask ? '[tvc]' : ''}${mask}[${label}]`
  )
}

/** A split segment: the presenter (input 0) on its half, the picture or clip beside it (input 1) on the other. */
function splitGraph(s: SegmentSpec, split: NonNullable<SegmentSpec['split']>, clip: { durationS: number }, fades: string[]): string {
  const [w, h] = s.size ?? FRAME_SIZE
  const half = 2 * Math.floor(w / 4)
  const grade = GRADES[s.grade] ?? ''
  const prepL = prepFor([half, h])
  const prepR = prepFor([w - half, h])
  const presenterPrep = split.side === 'right' ? prepL : prepR
  const picturePrep = split.side === 'right' ? prepR : prepL
  const presenter = clipChain(s, clip, presenterPrep, grade)
  const picture = split.clip ? clipChain(s, split.clip, picturePrep, grade) : [picturePrep, motionFilter(split.motion ?? SPLIT_MOTION, s.frames), grade].filter(Boolean).join(',')
  const order = split.side === 'right' ? '[pr][pi]' : '[pi][pr]'
  return (
    `[0:v]${presenter},format=yuv444p[pr];[1:v]${picture},format=yuv444p[pi];` +
    `${order}hstack=inputs=2,drawbox=x=${half - 2}:y=0:w=4:h=ih:color=0x000000@0.55:t=fill,${[...fades, finish].join(',')}[v]`
  )
}

/** The classic moves without punches keep the first filter of all (the same arguments, the same cache keys as before motion-montage). */
const isClassic = (m: Motion | undefined, punches: Shot['punches']): boolean =>
  (m === undefined || (['push', 'pull', 'left', 'right'].includes(m.kind) && m.ease === undefined && m.focus === undefined)) && !punches?.length

/**
 * The chain of a still under its camera: a classic move as before; a pan or punches through camera.ts, on a picture prepared twice as large
 * when the camera goes in further than 1.5x (the zoom stays sharp), then brought back to the frame.
 */
function stillChain(m: Motion | undefined, punches: Shot['punches'], frames: number, offset: number, size: readonly [number, number], grade: string): string {
  if (isClassic(m, punches)) return [prepFor(size), motionFilter(m, frames, offset), grade].filter(Boolean).join(',')
  const cam: Motion | undefined = m?.kind === 'parallax' ? { kind: 'push', from: Math.max(1.02, m.from), to: Math.max(1.02, m.from) + 0.05, ...(m.ease ? { ease: m.ease } : {}) } : m
  const big = maxZoom(cam, punches) > 1.5
  const work: readonly [number, number] = big ? [size[0] * 2, size[1] * 2] : size
  return [prepFor(work), cameraFilter(cam, frames, offset, punches), big ? `scale=${size[0]}:${size[1]}:flags=lanczos` : '', grade].filter(Boolean).join(',')
}

/** The graph of a parallax still from input 0 into `[label]`; a cut-out mask is added to `args` as the next input. */
function parallaxOwn(s: SegmentSpec, m: Motion, args: string[], size: readonly [number, number], grade: string, label: string): string {
  let maskLabel: string | undefined
  let maskGraph = ''
  if (s.mask) {
    const index = args.filter((a) => a === '-i').length
    args.push('-loop', '1', '-framerate', String(FPS), '-i', s.mask)
    // a cut-out's alpha, cover-cropped like the picture
    maskGraph = `[${index}:v]scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase,crop=${size[0]}:${size[1]},format=rgba,alphaextract,format=gray[pmask];`
    maskLabel = '[pmask]'
  }
  return `${maskGraph}[0:v]${prepFor(size)}[pin];${parallaxGraph({ input: 'pin', output: label, m, n: s.frames, size, ...(maskLabel ? { maskLabel } : {}), grade, ...(s.punches ? { punches: s.punches } : {}) })}`
}

/** ffmpeg arguments that render one segment to `out`. */
export function segmentArgs(s: SegmentSpec, out: string): string[] {
  const seconds = (s.frames / FPS).toFixed(4)
  const grade = GRADES[s.grade] ?? ''
  const size = s.size ?? FRAME_SIZE
  const prep = prepFor(size)
  const parallax = !s.clip && !s.split && s.motion?.kind === 'parallax' ? s.motion : undefined
  const tv = s.clip && !s.split && s.film === 'tv' ? s.clip : undefined
  // an archive film that fills the frame keeps the shot's slow push (camera after the crop, the grade last)
  const fullFilm = s.clip && s.film === 'full' && s.motion ? clipChain(s, s.clip, `${prep},${cameraFilter(s.motion, s.frames)}`, grade) : undefined
  const own = fullFilm ?? (s.clip ? clipChain(s, s.clip, prep, grade) : stillChain(s.motion, s.punches, s.frames, 0, size, grade))
  const fades: string[] = []
  if (s.dipIn) fades.push(`fade=t=in:s=0:n=${Math.min(DIP_FRAMES, Math.floor(s.frames / 2))}`)
  if (s.dipOut) fades.push(`fade=t=out:s=${Math.max(0, s.frames - DIP_FRAMES)}:n=${Math.min(DIP_FRAMES, Math.floor(s.frames / 2))}`)
  const args = s.clip ? ['-v', 'error', '-y', '-i', s.clip.file] : ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-t', seconds, '-i', s.image]
  let graph: string
  if (s.split && s.clip) {
    const b = s.split
    args.push(...(b.clip ? ['-i', b.clip.file] : ['-loop', '1', '-framerate', String(FPS), '-t', seconds, '-i', b.image]))
    graph = splitGraph(s, b, s.clip, fades)
  } else if (s.dissolveFrom) {
    const prev = s.dissolveFrom
    const kind = prev.kind ?? 'dissolve'
    const d = Math.min(kind === 'dissolve' ? DISSOLVE_FRAMES : TRANSITION_FRAMES[kind], Math.floor(s.frames / 2))
    const prevGrade = GRADES[prev.grade ?? s.grade] ?? ''
    const prevChain =
      kind === 'dissolve' && isClassic(prev.motion, prev.punches)
        ? [prep, motionFilter(prev.motion, prev.shotFrames, prev.shotFrames), prevGrade].filter(Boolean).join(',')
        : stillChain(prev.motion, prev.punches, prev.shotFrames, prev.shotFrames, size, prevGrade)
    args.push('-loop', '1', '-framerate', String(FPS), '-t', (d / FPS).toFixed(4), '-i', prev.image)
    const ownGraph = parallax ? parallaxOwn(s, parallax, args, size, grade, 'b') : tv ? tvGraph(s, tv, args, size, grade, 'b') : `[0:v]${own}[b]`
    graph =
      kind === 'dissolve'
        ? `${ownGraph};[1:v]${prevChain}[a];` + `[a][b]xfade=transition=fade:duration=${(d / FPS).toFixed(4)}:offset=0,${[...fades, finish].join(',')}[v]`
        : `${ownGraph};[1:v]${prevChain}[a];${transitionGraph(kind, d, prev.dir, [...fades, finish].join(','))}`
  } else if (parallax) {
    graph = `${parallaxOwn(s, parallax, args, size, grade, 'o')};[o]${[...fades, finish].join(',')}[v]`
  } else if (tv) {
    graph = `${tvGraph(s, tv, args, size, grade, 'o')};[o]${[...fades, finish].join(',')}[v]`
  } else {
    graph = `[0:v]${[own, ...fades, finish].join(',')}[v]`
  }
  return [...args, '-filter_complex', graph, '-map', '[v]', '-frames:v', String(s.frames), '-r', String(FPS), ...SEGMENT_ENCODER, ...COLOUR_TAGS, '-threads', '2', '-an', out]
}

/**
 * Cache key of a segment: the exact ffmpeg arguments that make it (filters, motion maths, grade, transitions, encoder),
 * with each picture's path replaced by the hash of its bytes. No position in the film: the same shot anywhere is reused.
 */
export async function segmentKey(s: SegmentSpec): Promise<string> {
  const bytes = async (p: string): Promise<string> => createHash('sha256').update(await readFile(p)).digest('hex')
  const pictures = new Map([[s.image, await bytes(s.image)]])
  if (s.clip) pictures.set(s.clip.file, await bytes(s.clip.file))
  if (s.dissolveFrom) pictures.set(s.dissolveFrom.image, await bytes(s.dissolveFrom.image))
  if (s.split) pictures.set(s.split.image, await bytes(s.split.image))
  if (s.split?.clip) pictures.set(s.split.clip.file, await bytes(s.split.clip.file))
  if (s.mask) pictures.set(s.mask, await bytes(s.mask))
  if (s.filmMask) pictures.set(s.filmMask, await bytes(s.filmMask))
  const args = segmentArgs(s, 'OUT').map((a) => pictures.get(a) ?? a)
  return createHash('sha256').update(JSON.stringify({ v: 2, args })).digest('hex').slice(0, 40)
}

/** A filter graph longer than this goes to ffmpeg in a file (Windows refuses a command line over 32 767 characters; a camera with many keys is long). */
export const GRAPH_INLINE_MAX = 6000

/** Runs ffmpeg with `args`; a long `-filter_complex` is written beside `out` and given as `-filter_complex_script` (same graph, same frames). */
export async function runFfmpeg(media: MediaService, args: string[], out: string, signal: AbortSignal): Promise<void> {
  const i = args.indexOf('-filter_complex')
  const graph = i >= 0 ? args[i + 1] : undefined
  if (graph === undefined || graph.length <= GRAPH_INLINE_MAX) {
    await media.run('ffmpeg', args, { signal })
    return
  }
  const file = `${out}.graph.txt`
  await writeFile(file, graph)
  try {
    await media.run('ffmpeg', [...args.slice(0, i), '-filter_complex_script', file, ...args.slice(i + 2)], { signal })
  } finally {
    await rm(file, { force: true })
  }
}

/** Renders (or reuses) one segment into `cacheDir`; returns its path and whether it came from the cache. */
export async function renderSegment(media: MediaService, s: SegmentSpec, cacheDir: string, signal: AbortSignal): Promise<{ file: string; cached: boolean }> {
  const key = await segmentKey(s)
  const file = path.join(cacheDir, `${key}.mp4`)
  if (existsSync(file)) {
    // used now: the housekeeping evicts the least recently used segments first
    const t = new Date()
    await utimes(file, t, t).catch(() => undefined)
    return { file, cached: true }
  }
  const tmp = path.join(cacheDir, `.tmp-${key}-${process.pid}-${Math.random().toString(36).slice(2)}.mp4`)
  try {
    await runFfmpeg(media, segmentArgs(s, tmp), tmp, signal)
    await rename(tmp, file).catch(async () => {
      // another worker wrote the same segment first: theirs is equivalent
      if (!existsSync(file)) await copyFile(tmp, file)
    })
  } finally {
    await rm(tmp, { force: true })
  }
  return { file, cached: false }
}

/** The camera move of a generated-video shot shown as its still. */
export const CLIP_MISSING_MOTION = { kind: 'push', from: 1.02, to: 1.12 } as const

/** Segment specs for the base track: picture per shot, transitions baked into neighbours. */
export function segmentSpecs(
  base: readonly Shot[],
  imageOf: (shot: Shot) => string,
  gradeAll: string,
  size?: readonly [number, number],
  clipOf?: (shot: Shot) => { file: string; durationS: number } | undefined,
  besideOf?: (shot: Shot) => { image: string; clip?: { file: string; durationS: number } } | undefined,
  /**
   * Documentary cards (style-markets): `tailOf` = a video shot's last frame as a still, so a dissolve can leave it (a card cross-fades
   * into the next archive like the reference); `gradeOf` = a shot's own grade (a card keeps its colours: none).
   */
  opts: { tailOf?: (shot: Shot) => string | undefined; gradeOf?: (shot: Shot) => string; filmMask?: string } = {}
): SegmentSpec[] {
  return base.map((s, i) => {
    const prev = base[i - 1]
    const next = base[i + 1]
    const frames = s.endFrame - s.startFrame
    const clip = clipOf?.(s)
    const grade = opts.gradeOf?.(s) ?? gradeAll
    const prevTail = prev && clipOf?.(prev) ? opts.tailOf?.(prev) : undefined
    // a presenter beside a picture (production-9); without the presenter's clip, the picture alone fills the frame
    const beside = s.kind === 'avatar' && s.layout === 'split' && s.beside ? besideOf?.(s) : undefined
    const split = beside && clip ? { side: s.beside?.side ?? 'right', image: beside.image, ...(beside.clip ? { clip: beside.clip } : {}), motion: undefined } : undefined
    // a dissolve blends the previous picture held at its end: a video has no such picture, so a video before it makes a cut
    const dissolve = isBlend(s.transitionIn) && prev !== undefined && frames >= 8 && (!clipOf?.(prev) || prevTail !== undefined) && !split && prev.layout !== 'split'
    // a match cut: the new framing starts where the old one ended (a classic push or pull begins at the zoom the previous move reached)
    const prevEnd = prev?.motion && ['push', 'pull'].includes(prev.motion.kind) ? prev.motion.to : undefined
    const matched: Motion | undefined =
      s.transitionIn === 'match' && s.motion && ['push', 'pull'].includes(s.motion.kind) && prevEnd !== undefined ? { ...s.motion, from: Math.min(1.6, Math.max(1, prevEnd)) } : undefined
    if (beside && !clip) {
      return { shotId: s.id, frames, image: beside.image, motion: SPLIT_MOTION, dipIn: s.transitionIn === 'dip' && i > 0, dipOut: next?.transitionIn === 'dip', grade, ...(size ? { size } : {}) }
    }
    return {
      shotId: s.id,
      frames,
      image: imageOf(s),
      ...(clip ? { clip } : {}),
      ...(clip && !split && s.film === 'tv' ? { film: 'tv' as const, ...(opts.filmMask ? { filmMask: opts.filmMask } : {}) } : clip && !split && (s.film === 'full' || (s.kind === 'motion' && s.motion !== undefined)) ? { film: 'full' as const } : {}),
      ...(split ? { split } : {}),
      // a generated-video shot whose clip could not be made shows its still with a slow push (pipeline-avatar §2.7, never a frozen frame)
      // (an archive film with no film found is a still: the still's move, not the film's slow push)
      motion: matched ?? (s.film && !clip ? CLIP_MISSING_MOTION : s.motion) ?? ((s.kind === 'video.gen' || s.kind === 'stock.video') && !clip ? CLIP_MISSING_MOTION : undefined),
      ...(s.punches?.length && !clip ? { punches: s.punches } : {}),
      ...(dissolve
        ? {
            dissolveFrom: {
              image: prevTail ?? imageOf(prev),
              motion: prevTail ? { kind: 'push', from: 1, to: 1 } : prev.motion,
              shotFrames: prev.endFrame - prev.startFrame,
              ...((opts.gradeOf?.(prev) ?? gradeAll) !== grade ? { grade: opts.gradeOf?.(prev) ?? gradeAll } : {}),
              ...(s.transitionIn !== 'dissolve' ? { kind: s.transitionIn as Exclude<Transition, 'cut' | 'dip'> } : {}),
              ...(s.transitionDir ? { dir: s.transitionDir } : {}),
              ...(!prevTail && prev.punches?.length ? { punches: prev.punches } : {})
            }
          }
        : {}),
      dipIn: s.transitionIn === 'dip' && i > 0,
      dipOut: next?.transitionIn === 'dip',
      grade,
      ...(size ? { size } : {})
    }
  })
}
