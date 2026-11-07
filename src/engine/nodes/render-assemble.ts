// `render.assemble@1` (docs/ENGINE-SPEC.md §28): the film. The base track is rendered segment by segment (cached per
// segment, R7.6), in parallel (≈ CPU cores ÷ 2, ffmpeg threads capped at 2), joined by copy, then one final pass burns
// captions and labels, mixes and masters the sound, and the result is verified before it is kept. A shot whose picture
// is missing holds its neighbour's (never a black slot), flagged in the result for QC. Two optional layers, for the
// faceless formats: a `background` (one silent video as long as the voice, from `background.clips`) replaces the base
// track's pictures, and a `graphics` card (`card.intro`, a PNG with its on-screen times in its meta) is laid over the first
// seconds. A `motion` input (`motion.render`: transparent ProRes files, one per animated overlay of the plan) is laid over the base track,
// under the card, the pictures-in-picture and the captions. Video shots (docs/ENGINE-SPEC.md §28.1): a generated clip (`clips`, from visuals.fulfil) and a full-frame avatar (`avatar`,
// from avatar.speak) are base-track segments made from the clip instead of the picture; an avatar in picture-in-picture is laid over
// the joined film by the final pass. A clip that is missing falls back to its picture (a full avatar: its first frame), never black.
// The simple montage of production-9 (pipeline-avatar §2.11): a presenter on half the screen (`split`) is composed in its segment
// beside its picture; the editing bricks' layers (`sponsor`: the sponsor's card or clip and its QR code; `chapters`: the chapter marks)
// are laid by the final pass over the pictures-in-picture and under the captions.
// A documentary card (style-markets: an archive card, a map, a data card, a timeline, drawn opaque by `motion.render`) is a base shot
// played like a clip, never graded (it keeps its colours); a dissolve leaves it from its last frame. Without its file (no browser) a card
// that frames a picture shows that picture with a slow push, any other holds its neighbour.
// Without any of these nothing changes: a film made from pictures only is the same bytes as before. Local, real in demo mode too.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Artefact, NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { EditPlan, checkTimeline, type Shot } from '../formats/editplan'
import { Layers } from '../formats/layers'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { FPS, aspectOfSize } from '../formats/timing'
import { finalPass, type IntroCard } from '../render/final'
import type { LayerInput } from '../render/layers'
import { GRADES, renderSegment, segmentSpecs, type SegmentSpec } from '../render/segments'
import { shotProblems, shotWarnings } from '../render/shot-check'
import { isBlend } from '../render/transitions'
import { segmentWorkers } from '../render/workers'
import { greyThumbOf } from './visuals-checks'
import { probe } from '../media/probe'
import { applyRoom } from '../media/room'
import { MotionRecord } from './motion-render'
import { RENDER_ENCODERS, RENDER_FILTERS, requireFilters } from '../media/tools'
import { need } from '../services'
import type { Json } from '../types'
import { metaNumber, progress, readFile0, readValue, scratch, throwIfAborted } from './common'
import { reviewedRender } from './render-review'
import type { SeenShot } from '../review/checks'
import { aspectDefect, measureSize, reframeArgs } from '../review/blocking-aspect'
import { refusal } from '../review/blocking'

/** The « DÉMO » mark over the film. `off` drops it only in a demo run (the clone gate's judge copy, decision 0106): a real
 *  film that carries a demo part never loses it. Pure. */
export function filmWatermark(param: 'auto' | 'on' | 'off', realRun: boolean, anyDemo: boolean): boolean {
  return param === 'on' || ((param === 'auto' || realRun) && anyDemo)
}

export const RenderParams = z.object({
  /** Final encode (R28.2 step 3): usage_max/local `veryfast` CRF 21; qualite_max `slow` CRF 18 (via `modes`). */
  crf: z.number().int().min(14).max(30).default(18),
  preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']).default('medium'),
  /** `auto`: a DÉMO mark on the film when any input came from a demo provider (plan §4.12). */
  watermark: z.enum(['auto', 'on', 'off']).default('auto'),
  grade: z.enum(Object.keys(GRADES) as [string, ...string[]]).default('none'),
  /** Black bars top and bottom (a cinema letterbox measured on the reference): the picture's aspect between them. Absent: none. */
  letterbox: z.number().min(1).max(4).optional(),
  /** The reference's measured frame format (moteur-pov-2): a blocking check on the delivered film (review/blocking-aspect.ts). */
  aspect: z.enum(['16:9', '9:16']).optional(),
  /** Parallel segment renders; 0 = auto (CPU cores ÷ 2). */
  workers: z.number().int().min(0).max(16).default(0),
  /**
   * A light room on the voice (motion-montage, media/room.ts): a synthetic room's response (`rt` seconds) mixed `mixDb` under the dry
   * voice. Absent: the voice as it is. -14 dB suits a dry voice; -11 a bone-dry system voice; -17 a voice that already has a room.
   */
  room: z.object({ mixDb: z.number().min(-30).max(-8).default(-14), rt: z.number().min(0.2).max(1.5).default(0.6) }).optional(),
  /**
   * The edit review (qualite-montage, src/engine/review/): `report` reviews the film shot by shot against the words; `repair` also fixes
   * what the render can (a duplicate or off-subject shot dropped into a neighbour, a frozen film's boundary moved, a slow camera on a
   * held picture, a wrong text off) and renders again, `reviewRounds` times at most. `reviewLook`: Claude looks at every picture shot.
   */
  review: z.enum(['off', 'report', 'repair']).default('off'),
  reviewRounds: z.number().int().min(0).max(3).default(2),
  reviewLook: z.boolean().default(true),
  /**
   * A reviewed film with a real error left (controles-bloquants, decision 0102: a cut voice, a hole, a frozen, black or repeated
   * picture, a wrong text, music too loud…) is refused (`refuse`, the default: the node fails and nothing is delivered) or only
   * reported (`report`: a test render that must still be compared). Absent: refuse.
   */
  blocking: z.enum(['refuse', 'report']).optional(),
  /** Extra gain on the music bed (dB), set by the review when the bed is too loud under the voice. */
  musicDb: z.number().min(-40).max(0).optional()
})
export type RenderParamsT = z.infer<typeof RenderParams>
type Params = RenderParamsT

const ImagesRecord = z.array(z.object({ itemId: z.string(), file: z.number().int().min(0), demo: z.boolean().optional(), degraded: z.string().optional() }).passthrough())
/** The records of `clips` (generated video) and `avatar`: which item each file is, and how long it is. */
const ClipsRecord = z.array(z.object({ itemId: z.string(), file: z.number().int().min(0), durationS: z.number().positive() }).passthrough())
type ClipRef = { file: string; durationS: number }

/** The clips of an artefact by item id (a bad or missing record is no clips: the shots keep their pictures). */
function clipsOf(a: Artefact | undefined): Map<string, ClipRef> {
  const out = new Map<string, ClipRef>()
  const rec = ClipsRecord.safeParse(a?.value)
  if (!rec.success) return out
  for (const r of rec.data) {
    const file = a?.files?.[r.file]
    if (file) out.set(r.itemId, { file, durationS: r.durationS })
  }
  return out
}

/** The first frame of a clip, as a picture: what a full-frame avatar shot falls back to. */
async function posterOf(ctx: RunCtx, clip: string, dir: string, name: string): Promise<string> {
  const out = path.join(dir, `${name}.poster.jpg`)
  await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-frames:v', '1', '-q:v', '2', out], { signal: ctx.signal })
  return out
}

/** The last frame of a clip, as a picture: what a dissolve out of a card blends from. */
async function tailOf(ctx: RunCtx, clip: string, dir: string, name: string, atS?: number): Promise<string> {
  const out = path.join(dir, `${name}.tail.png`)
  // a clip cut by its shot ends where the shot does (atS); a card is as long as its shot: its very end
  const seek = atS === undefined ? ['-sseof', '-0.1'] : ['-ss', Math.max(0, atS - 0.05).toFixed(3)]
  await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-y', ...seek, '-i', clip, '-frames:v', '1', '-update', '1', out], { signal: ctx.signal })
  return out
}

/** The documentary cards of `motion.render` (its records marked `base`) by shot id, each as a clip as long as its shot. */
function cardsOf(a: Artefact | undefined): Map<string, ClipRef> {
  const out = new Map<string, ClipRef>()
  const rec = MotionRecord.safeParse(a?.value)
  if (!rec.success) return out
  for (const r of rec.data) {
    const file = a?.files?.[r.file]
    if (r.base && file) out.set(r.shotId, { file, durationS: (r.endFrame - r.startFrame) / FPS })
  }
  return out
}

const isDemo = (meta: Record<string, Json> | undefined): boolean => meta?.demo === true
/** The old-TV mask over an archive film in its 4:3 frame (documentary-2), in the library. */
const tvMask = (ctx: RunCtx): string => path.join(need(ctx, 'library').root, 'doc', 'tv-mask.png')

/**
 * A segment, retried once (partial output deleted); if it still fails, rendered as a still hold of its picture with no
 * move or transition (never a black slot), and listed for QC (§28 failure handling).
 */
async function renderWithFallback(ctx: RunCtx, s: SegmentSpec, cacheDir: string, held: string[]): Promise<{ file: string; cached: boolean }> {
  const media = need(ctx, 'media')
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await renderSegment(media, s, cacheDir, ctx.signal)
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `segment ${s.shotId} failed (attempt ${attempt}): ${(e as Error).message.slice(0, 300)}` })
    }
  }
  held.push(s.shotId)
  // a split falls back to the presenter alone (its picture beside may be what failed)
  const { dissolveFrom: _gone, split: _beside, ...rest } = s
  return renderSegment(media, { ...rest, motion: { kind: 'push', from: 1, to: 1 }, dipIn: false, dipOut: false }, cacheDir, ctx.signal)
}

/** The base track as segment files (joined by copy later), how many came from the cache, the shots that held a neighbour. */
interface BaseTrack {
  files: string[]
  segments: number
  cached: number
  held: string[]
  /** Presenter shots composed beside their picture. */
  splits?: number
  /** What each base shot shows (the edit review's duplicates). */
  seen?: SeenShot[]
}

/**
 * The layers of an editing brick (`edit.sponsor`, `edit.chapters`): each with its file. A record that does not read, a missing file or
 * a layer outside the film is left out with a warning: the film goes on without it, never with a wrong one.
 */
function layersOf(ctx: RunCtx, a: Artefact | undefined, plan: EditPlan, what: string): LayerInput[] {
  if (!a) return []
  const rec = Layers.safeParse(a.value)
  if (!rec.success) {
    ctx.emit({ kind: 'log', level: 'warn', text: `the ${what} record does not read: the film goes on without it` })
    return []
  }
  const D = plan.frames / FPS
  const out: LayerInput[] = []
  for (const l of rec.data) {
    const file = a.files?.[l.file]
    if (!file || l.startS >= D || l.endS <= l.startS) ctx.emit({ kind: 'log', level: 'warn', text: `a ${what} layer (${l.role}) has no usable file or time: left out` })
    else out.push({ ...l, endS: Math.min(l.endS, D), path: file })
  }
  return out
}

/** The base track of a film made of pictures and clips: one cached segment per shot, rendered in parallel. */
async function pictureSegments(ctx: RunCtx, inputs: ResolvedInputs, plan: EditPlan, p: Params, clips: ReadonlyMap<string, ClipRef>, cards: ReadonlyMap<string, ClipRef>): Promise<BaseTrack> {
  const images = inputs.images?.files ?? []
  const base = plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id)).filter((s): s is Shot => s !== undefined)
  // a film whose every shot is a drawn card (pov@1, clone-monde-pov) has no picture to read: no pictures brick in its pipeline
  const allCards = base.length > 0 && base.every((s) => s.kind === 'motion' && !s.genItem)
  const record = !inputs.images && allCards ? [] : readValue(inputs.images, ImagesRecord, 'the pictures')
  const fileOf = new Map(record.map((r) => [r.itemId, images[r.file]]))
  const held: string[] = []
  let lastGood: string | undefined
  const posterDir = await scratch(ctx, 'posters')
  // a full-frame avatar has no picture of its own: its first frame is its picture
  const own = new Map<string, string>()
  // a card is its own clip (by shot); any other video shot's clip is its item's
  const clipFor = (s: Shot): ClipRef | undefined => (s.kind === 'motion' ? cards.get(s.id) : s.genItem ? clips.get(s.genItem) : undefined)
  for (const s of base) {
    const pic = s.genItem ? fileOf.get(s.genItem) : undefined
    const clip = clipFor(s)
    if (pic) own.set(s.id, pic)
    else if (clip) own.set(s.id, await posterOf(ctx, clip.file, posterDir, s.id))
  }
  const firstGood = base.map((s) => own.get(s.id)).find(Boolean)
  const pictures = base.map((s) => {
    const f = own.get(s.id)
    if (f) {
      lastGood = f
      return f
    }
    held.push(s.id)
    const hold = lastGood ?? firstGood
    if (!hold) throw new EngineError('bad_input', 'Aucune image n’est disponible pour le rendu.')
    return hold
  })
  if (held.length > 0) ctx.emit({ kind: 'log', level: 'warn', text: `${held.length} shots without a picture hold their neighbour: ${held.join(', ')}` })
  const pictureOf = new Map(base.map((s, i) => [s.id, pictures[i] as string]))
  // the last check (production-17): never seconds on end of one picture standing in for missing ones
  const hashes = new Map<string, Promise<string>>()
  const hashOfFile = (f: string): Promise<string> => {
    let h = hashes.get(f)
    if (!h) hashes.set(f, (h = readFile(f).then((b) => createHash('sha256').update(b).digest('hex'))))
    return h
  }
  const borrowedItems = new Set(record.filter((r) => r.degraded?.includes('plan voisin')).map((r) => r.itemId))
  // what each real picture looks like (a demo drawing is never compared): no two near-identical pictures within 20 s
  const recordOf = new Map(record.map((r) => [r.itemId, r]))
  const groupOf = (id: string | undefined): string | undefined => {
    const r = id ? recordOf.get(id) : undefined
    return r ? (typeof r.sameAs === 'string' ? r.sameAs : r.itemId) : undefined
  }
  const checked = await Promise.all(
    base.map(async (s) => {
      const clip = clipFor(s)
      return {
        id: s.id,
        presenter: s.kind === 'avatar',
        startS: s.startFrame / plan.fps,
        endS: s.endFrame / plan.fps,
        source: await hashOfFile(clip?.file ?? (pictureOf.get(s.id) as string)),
        borrowed: held.includes(s.id) || (s.genItem !== undefined && borrowedItems.has(s.genItem)),
        // (an archive film's first frame too: the edit review's duplicates, qualite-montage)
        ...(s.kind !== 'avatar' && s.genItem && (recordOf.get(s.genItem)?.demo === false || (s.kind !== 'motion' && clips.has(s.genItem))) && own.has(s.id) ? { grey: await greyThumbOf(ctx, own.get(s.id) as string) } : {}),
        ...(groupOf(s.genItem) ? { group: groupOf(s.genItem) as string } : {})
      }
    })
  )
  const problems = shotProblems(checked)
  // two pictures alike is only said (avatar-qualite part 3): the pictures brick already made the later one again once
  const similar = shotWarnings(checked)
  for (const w of similar) ctx.emit({ kind: 'log', level: 'warn', text: w })
  if (problems.length > 0) {
    throw new EngineError('bad_input', `Le rendu s’arrête : ${problems.join(' ; ')}. Des images n’ont pas pu être faites : relance la fabrication, seules celles-là seront refaites.`)
  }
  // the picture beside a split presenter: its still, and its clip when it is a generated video
  const besideOf = (s: Shot): { image: string; clip?: ClipRef } | undefined => {
    const id = s.beside?.genItem
    const image = id ? fileOf.get(id) : undefined
    const clip = id ? clips.get(id) : undefined
    if (!image && !clip) {
      ctx.emit({ kind: 'log', level: 'warn', text: `split shot ${s.id} has no picture beside the presenter: the presenter fills the frame` })
      return undefined
    }
    return { image: image ?? (pictureOf.get(s.id) as string), ...(clip ? { clip } : {}) }
  }
  // a card's or a clip's last frame, where a dissolve (or a whip, a push... motion-montage) leaves it for the next shot
  const tails = new Map<string, string>()
  for (const [i, s] of base.entries()) {
    if (!isBlend(base[i + 1]?.transitionIn)) continue
    const card = s.kind === 'motion' ? cards.get(s.id) : undefined
    const clip = card ? undefined : clipFor(s)
    if (card) tails.set(s.id, await tailOf(ctx, card.file, posterDir, s.id))
    else if (clip) tails.set(s.id, await tailOf(ctx, clip.file, posterDir, s.id, Math.min(clip.durationS, (s.endFrame - s.startFrame) / FPS)))
  }
  const cardMove = (s: Shot): Shot => (s.kind === 'motion' && !cards.has(s.id) ? { ...s, motion: s.motion ?? { kind: 'push', from: 1.02, to: 1.12 } } : s)
  const specs = segmentSpecs(base.map(cardMove), (s) => pictureOf.get(s.id) as string, p.grade, plan.size, clipFor, besideOf, {
    tailOf: (s) => tails.get(s.id),
    gradeOf: (s) => (s.kind === 'motion' && cards.has(s.id) ? 'none' : s.colour ? 'natural' : p.grade),
    ...(existsSync(tvMask(ctx)) ? { filmMask: tvMask(ctx) } : {})
  })
  const cacheDir = await need(ctx, 'workspace').cache('segments')
  const workers = p.workers || segmentWorkers()
  // longest segments first, so the pool ends together (§28.1)
  const order = specs.map((s, i) => ({ s, i })).sort((a, b) => b.s.frames - a.s.frames)
  const files: string[] = new Array(specs.length)
  let cached = 0
  let done = 0
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(workers, order.length) }, async () => {
      while (next < order.length) {
        const { s, i } = order[next++] as { s: (typeof specs)[number]; i: number }
        throwIfAborted(ctx)
        const r = await renderWithFallback(ctx, s, cacheDir, held)
        files[i] = r.file
        if (r.cached) cached++
        done++
        ctx.emit({ kind: 'progress', frac: 0.75 * (done / specs.length), text: `segment ${done} sur ${specs.length}` })
      }
    })
  )
  const seen = checked.map((c) => ({ id: c.id, source: c.source, ...(c.grey ? { grey: c.grey } : {}), ...(c.group ? { group: c.group } : {}) }))
  return { files, segments: specs.length, cached, held, splits: specs.filter((s) => s.split).length, seen }
}

/** The avatars laid over the picture (picture in picture): their clip and the seconds they stay. */
function pictureInPicture(ctx: RunCtx, plan: EditPlan, avatars: ReadonlyMap<string, ClipRef>): NonNullable<Parameters<typeof finalPass>[1]['pips']> {
  const pips: NonNullable<Parameters<typeof finalPass>[1]['pips']> = []
  for (const id of plan.tracks.overlay) {
    const s = plan.shots.find((x) => x.id === id)
    if (s?.kind !== 'avatar' || s.layout !== 'pip') continue
    const clip = s.genItem ? avatars.get(s.genItem) : undefined
    if (!clip) {
      ctx.emit({ kind: 'log', level: 'warn', text: `avatar ${s.id} has no clip: the film goes on without it` })
      continue
    }
    pips.push({ file: clip.file, startS: s.startFrame / FPS, endS: s.endFrame / FPS, ...(s.inset ? { inset: s.inset } : {}) })
  }
  return pips
}

/**
 * The animated overlays (`motion.render`): each file with the frames it lies over. A record that does not read, a file that is missing or one
 * drawn for another frame size is left out with a warning: the film goes on without that graphic, never with a wrong one.
 */
function motionOverlays(ctx: RunCtx, a: Artefact | undefined, plan: EditPlan, dropped: ReadonlySet<string>): { file: string; startFrame: number; endFrame: number }[] {
  if (!a) return []
  const rec = MotionRecord.safeParse(a.value)
  if (!rec.success) {
    ctx.emit({ kind: 'log', level: 'warn', text: 'the animations record does not read: the film goes on without them' })
    return []
  }
  const w = metaNumber(a, 'width')
  const h = metaNumber(a, 'height')
  if ((w !== undefined && w !== plan.size[0]) || (h !== undefined && h !== plan.size[1])) {
    throw new EngineError('bad_input', `Les animations sont en ${String(w)}×${String(h)}, le plan en ${plan.size[0]}×${plan.size[1]} : refais les animations pour le même format.`)
  }
  const out: { file: string; startFrame: number; endFrame: number }[] = []
  for (const r of rec.data) {
    // a documentary card is a base shot, played by the segments; a text the edit review took off stays off
    if (r.base || dropped.has(r.shotId)) continue
    const file = a.files?.[r.file]
    if (!file || r.endFrame > plan.frames) ctx.emit({ kind: 'log', level: 'warn', text: `animation ${r.shotId} has no usable file: the film goes on without it` })
    else out.push({ file, startFrame: r.startFrame, endFrame: r.endFrame })
  }
  return out.sort((x, y) => x.startFrame - y.startFrame)
}

/** The base track of a film over a background video: that one file, checked to be as long as the plan. */
async function backgroundTrack(ctx: RunCtx, file: string, plan: EditPlan): Promise<BaseTrack> {
  const seconds = (await probe(need(ctx, 'media'), file, ctx.signal)).durationS
  if (Math.abs(Math.round(seconds * FPS) - plan.frames) > 2) {
    throw new EngineError('bad_input', `Le fond vidéo dure ${seconds.toFixed(1)} s, la voix ${(plan.frames / FPS).toFixed(1)} s : refais le fond après un changement de voix.`)
  }
  progress(ctx, 3, 4, 'Fond vidéo en place')
  return { files: [file], segments: 1, cached: 0, held: [] }
}

/** The intro card: its PNG and the seconds it stays (its meta, from `card.intro`), kept inside the film. */
function introCard(a: Artefact | undefined, frames: number): IntroCard | null {
  const file = a?.files?.find((f) => f.toLowerCase().endsWith('.png'))
  if (!file) return null
  const startS = metaNumber(a, 'startS') ?? 0
  const endS = Math.min(metaNumber(a, 'endS') ?? 3, frames / FPS)
  const height = metaNumber(a, 'height')
  const y = metaNumber(a, 'y')
  const boxH = metaNumber(a, 'boxH')
  const pop = a?.meta?.anim === 'pop'
  return endS > startS
    ? { file, startS, endS, ...(height !== undefined ? { height } : {}), ...(pop ? { anim: 'pop' as const } : {}), ...(y !== undefined ? { y } : {}), ...(boxH !== undefined ? { boxH } : {}) }
    : null
}

/** One render of `plan` (the edit review may render a patched plan again: only its touched segments are made anew). */
async function renderOnce(ctx: RunCtx, inputs: ResolvedInputs, p: Params, plan: EditPlan, droppedOverlays: ReadonlySet<string>): Promise<{ outputs: NodeOutputs; seen: SeenShot[] }> {
  const media = need(ctx, 'media')
  const dry = readFile0(inputs.voice, 'the voice')
  const voice = p.room ? (await applyRoom(media, { voice: dry, out: path.join(await scratch(ctx, 'room'), 'voice-room.flac'), rt: p.room.rt, mixDb: p.room.mixDb, seed: ctx.seed + 1, signal: ctx.signal })).out : dry
  const music = inputs.music?.files?.[0] ?? null
  const subsFiles = inputs.subs?.files ?? []
  const ass = subsFiles.find((f) => f.toLowerCase().endsWith('.ass')) ?? null
  // the plan's own checker again: a render never starts on an unsound plan
  const shapeProblems = checkTimeline(plan, plan.frames)
  if (shapeProblems.length > 0) throw new EngineError('bad_input', `the edit plan is not renderable: ${shapeProblems.join('; ')}`)
  const background = inputs.background?.files?.[0] ?? null
  // a background made for another shape would be stretched or cropped by the join: say so now
  const bw = metaNumber(inputs.background, 'width')
  const bh = metaNumber(inputs.background, 'height')
  if (background && bw !== undefined && bh !== undefined && (bw !== plan.size[0] || bh !== plan.size[1])) {
    throw new EngineError('bad_input', `Le fond vidéo est en ${bw}×${bh}, le plan en ${plan.size[0]}×${plan.size[1]} : refais le fond pour le même format.`)
  }
  const videoClips = clipsOf(inputs.clips)
  const avatarClips = clipsOf(inputs.avatar)
  const cards = cardsOf(inputs.motion)
  const track = background ? await backgroundTrack(ctx, background, plan) : await pictureSegments(ctx, inputs, plan, p, new Map([...videoClips, ...avatarClips]), cards)
  const pips = pictureInPicture(ctx, plan, avatarClips)
  const usedClips = background
    ? 0
    : plan.tracks.base.filter((id) => {
        const item = plan.shots.find((x) => x.id === id)?.genItem
        return cards.has(id) || (item !== undefined && (videoClips.has(item) || avatarClips.has(item)))
      }).length
  const dir = await scratch(ctx, 'render')
  // a demo run is marked « DÉMO »; a real run only when its voice is a demo (the whole film is then a sample): one demo picture in a
  // real run is a gap upstream (visuals.fulfil), said here, never a mark over the whole film (clone-markets-2 r0)
  const realRun = ctx.services.cloud?.realRun === true
  const demoParts = (['images', 'voice', 'music', 'clips', 'avatar'] as const).filter((k) => isDemo(inputs[k]?.meta))
  const anyDemo = realRun ? demoParts.includes('voice') : demoParts.length > 0
  if (realRun && demoParts.length > 0 && !anyDemo) ctx.emit({ kind: 'log', level: 'warn', text: `real run with demo parts (${demoParts.join(', ')}): no « DÉMO » mark over the film` })
  const watermark = filmWatermark(p.watermark, realRun, anyDemo)
  const library = need(ctx, 'library').root
  const out = path.join(dir, 'video.mp4')
  // the ASS always holds the labels; whether it also holds the captions is captions.make's `burn` (§27 step 6)
  const burn = ass
  const card = introCard(inputs.graphics, plan.frames)
  const overlays = motionOverlays(ctx, inputs.motion, plan, droppedOverlays)
  // the sponsor's slot first, then the chapter marks over it
  const layers = [...layersOf(ctx, inputs.sponsor, plan, 'sponsor'), ...layersOf(ctx, inputs.chapters, plan, 'chapters')]
  const res = await finalPass(media, {
    segments: track.files,
    frames: plan.frames,
    voice,
    music,
    ...(p.musicDb ? { musicDb: p.musicDb } : {}),
    subs: burn,
    fontsDir: path.join(library, 'fonts'),
    watermark,
    ...(layers.some((l) => l.role === 'chapter' && l.box !== undefined && l.box.x + l.box.w > plan.size[0] / 2 && l.box.y < plan.size[1] / 4) ? { watermarkLeft: true } : {}),
    card,
    pips,
    overlays,
    layers,
    size: plan.size,
    ...(p.letterbox !== undefined ? { letterbox: p.letterbox } : {}),
    font: path.join(library, 'fonts', 'Inter-Bold.ttf'),
    crf: p.crf,
    preset: p.preset,
    dir,
    out,
    signal: ctx.signal,
    onProgress: (f) => ctx.emit({ kind: 'progress', frac: 0.75 + 0.25 * f, text: `assemblage final ${Math.round(f * 100)} %` })
  })
  progress(ctx, 1, 1, 'Vidéo prête')
  const outputs: NodeOutputs = {
    video: {
      files: [out],
      meta: {
        durationS: res.durationS,
        frames: res.frames,
        width: plan.size[0],
        height: plan.size[1],
        fps: 30,
        crf: p.crf,
        preset: p.preset,
        segments: track.segments,
        segmentsCached: track.cached,
        held: track.held as Json,
        captionsBurned: burn !== null,
        watermark,
        demo: anyDemo,
        mixLufsBefore: Math.round(res.measuredLufs * 10) / 10,
        masterGainDb: Math.round(res.gainDb * 10) / 10,
        limited: res.limited,
        // only said when it is so: a film made of pictures keeps the meta it always had
        ...(background ? { background: true } : {}),
        ...(aspectOfSize(plan.size) === '9:16' ? { aspect: '9:16' } : {}),
        ...(card ? { introCardS: card.endS } : {}),
        ...(overlays.length > 0 ? { motionOverlays: overlays.length } : {}),
        ...(usedClips > 0 ? { videoShots: usedClips } : {}),
        ...(pips.length > 0 ? { avatarPip: pips.length } : {}),
        ...(track.splits ? { avatarSplit: track.splits } : {}),
        ...(layers.length > 0 ? { layers: layers.map((l) => l.role) as Json } : {})
      }
    }
  }
  return { outputs, seen: track.seen ?? [] }
}

async function assemble(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  await requireFilters(need(ctx, 'media'), [...RENDER_FILTERS, ...RENDER_ENCODERS], ctx.signal)
  const plan = readValue(inputs.plan, EditPlan, 'the edit plan')
  if (p.review === 'off') return checkedAspect(ctx, p, (await renderOnce(ctx, inputs, p, plan, new Set())).outputs)
  const clips = new Map([...clipsOf(inputs.clips), ...clipsOf(inputs.avatar)])
  const cards = cardsOf(inputs.motion)
  return checkedAspect(ctx, p, await reviewedRender(ctx, inputs, p, plan, renderOnce, {
    clipS: (s) => (s.kind !== 'motion' && s.genItem ? clips.get(s.genItem)?.durationS : undefined),
    isCard: (s) => s.kind === 'motion' && cards.has(s.id)
  }))
}

/**
 * The blocking frame check (moteur-pov-2): the delivered film's measured frame must have the reference's format. A wrong one is
 * fitted inside the frame (black bars, nothing cropped) and measured again; still wrong, the film is refused, whatever `blocking` says (a film in the
 * wrong format is not a test of the style, it is the wrong product).
 */
export async function checkedAspect(ctx: RunCtx, p: Pick<Params, 'aspect' | 'crf'>, outputs: NodeOutputs): Promise<NodeOutputs> {
  if (!p.aspect) return outputs
  const media = need(ctx, 'media')
  const video = outputs.video
  const film = video?.files?.[0]
  if (!video || !film) return outputs
  const meta = (video.meta ?? {}) as Record<string, Json>
  const durationS = typeof meta.durationS === 'number' ? meta.durationS : 0
  const first = aspectDefect(p.aspect, await measureSize(media, film, ctx.signal), durationS)
  if (!first) return outputs
  const fixed = film.replace(/(\.\w+)$/, `.reframed$1`)
  await media.run('ffmpeg', reframeArgs(film, fixed, p.aspect, p.crf), { signal: ctx.signal })
  const size = await measureSize(media, fixed, ctx.signal)
  const left = aspectDefect(p.aspect, size, durationS)
  if (left || !size) throw refusal([left ?? first])
  await rename(fixed, film)
  ctx.emit({ kind: 'progress', frac: 1, text: `format réparé : ${first.detail}` })
  const { aspect: _was, ...rest } = meta
  void _was
  return { ...outputs, video: { ...video, meta: { ...rest, width: size.w, height: size.h, aspectRepaired: first.detail, ...(p.aspect === '9:16' ? { aspect: '9:16' } : {}) } } }
}

export const renderAssemble = defineNode({
  type: 'render.assemble@1',
  inputs: {
    plan: { type: 'json.editplan', required: true },
    // required unless a `background` video replaces the pictures (checked when the node runs)
    images: { type: 'media.image[]', required: false },
    clips: { type: 'media.clip[]', required: false },
    avatar: { type: 'media.clip[]', required: false },
    graphics: { type: 'media.graphic[]', required: false },
    // the animated overlays of `motion.render`, laid over the base track and under the captions
    motion: { type: 'media.graphic[]', required: false },
    background: { type: 'media.clip[]', required: false },
    voice: { type: 'audio.voice', required: true },
    music: { type: 'audio.music', required: false },
    subs: { type: 'subs.track', required: false },
    // production-9: the sponsor's slot and QR code (`edit.sponsor`), the chapter marks (`edit.chapters`)
    sponsor: { type: 'media.graphic[]', required: false },
    chapters: { type: 'media.graphic[]', required: false },
    // the edit review reads the words under each shot
    words: { type: 'json.words', required: false }
  },
  outputs: { video: 'video.final' },
  params: RenderParams,
  // RunPod placement (`gpu`) arrives with its workers (lot P14)
  executors: ['local'],
  render: true,
  // local: about real time for stills on a laptop (measured on H1: see STATUS P4)
  estimate: (ctx) => ({ units: [], durationS: 10 + ctx.minutes * 60 * 0.8 }),
  run: assemble,
  fake: assemble
})
