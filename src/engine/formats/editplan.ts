// `json.editplan` (format `atelier.editplan/1`) and `json.genlist` (docs/ENGINE-SPEC.md §21.6). The plan is on the
// 30 fps frame grid: the base track covers exactly [0, frames) with no gap and no overlap; overlays and labels lie
// inside it (R21.7). The generation list carries everything its executor needs, because `visuals.fulfil` never reads
// the plan. `checkEditPlan` is the non-AI checker of R12.2 (durations, kinds, budget).
import { z } from 'zod'
import { isCardTemplate } from './cards'
import { Inset } from './inset'
import { GraphicSpec, checkMotion } from './motion'
import { ASPECTS, FPS, FRAME_SIZES, aspectOfSize } from './timing'

export const EDITPLAN_SCHEMA = 'atelier.editplan/1'

/**
 * Shot kinds the director chooses from (§21.1). `avatar` is a talking presenter (`avatar.speak`); `motion` is an animated overlay from our
 * templates (`motion.render`, §25) on the overlay track: it lies over the picture and under the captions, which stay on — or, for a
 * documentary card (formats/cards.ts: archive, map, bars, timeline), the base shot itself, opaque, full frame (its picture, if any, is
 * its `genItem`).
 */
/** Transitions a shot may come in with (formats a style picks from, motion-montage). */
export const TRANSITIONS = ['cut', 'dissolve', 'dip', 'flash', 'whip', 'push', 'zoom', 'match'] as const
export type Transition = (typeof TRANSITIONS)[number]

export const SHOT_KINDS = ['stock.video', 'stock.photo', 'image.gen', 'video.gen', 'user.footage', 'avatar', 'label', 'hold', 'motion'] as const
export const ShotKind = z.enum(SHOT_KINDS)
export type ShotKind = z.infer<typeof ShotKind>

/** Kinds with an item in the generation list. `visuals.fulfil` makes all of them but `avatar`, which `avatar.speak` makes. */
export const GEN_KINDS = ['stock.video', 'stock.photo', 'image.gen', 'video.gen', 'user.footage', 'avatar'] as const
export type GenKind = (typeof GEN_KINDS)[number]

/**
 * A camera key on a still (motion-montage, §28.1): where the frame's centre is (0..1 of the picture) and how far in, at a time of the shot.
 * `ease`: how the move that ends at this key goes; missing: eased at both ends (it stops at the key); `linear`: at an even speed (keys
 * sampled along a path, e.g. a route's head followed, glide through without stopping).
 */
export const CameraKey = z.object({ atS: z.number().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(4), ease: z.enum(['linear']).optional() })
export type CameraKey = z.infer<typeof CameraKey>

export const Motion = z.object({
  /**
   * Camera move on a still (R21.6): push in, pull out, or drift left / right while slightly zoomed; `pan` = through `keys` (a pan along a
   * route, a zoom onto a region, eased from key to key); `parallax` = 2.5D: the picture split into a far layer and a near layer that move
   * at different speeds (`depth`), the near layer cut by `focus` (a soft ellipse on the subject) or by a cut-out mask the render is given.
   */
  kind: z.enum(['push', 'pull', 'left', 'right', 'pan', 'parallax']),
  /** Zoom at the first and last frame (1 = the frame filled exactly). */
  from: z.number().min(1).max(1.6),
  to: z.number().min(1).max(1.6),
  /** `pan`: two keys or more, in time order (the first at 0 or later: held before it). */
  keys: z.array(CameraKey).min(2).max(12).optional(),
  /** `parallax`: the subject's box (0..1 of the picture), and how much faster the near layer moves than the far one (default 2.2). */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.05).max(1), h: z.number().min(0.05).max(1) }).optional(),
  depth: z.number().min(1.2).max(4).optional(),
  /** `parallax` as a « depth pop »: the background pulls back (1.06 → 1), dimmer and softer, while the cut-out subject grows by 9 % with a soft shadow. */
  pop: z.boolean().optional(),
  /**
   * How a whole-shot move (push, pull, drift, parallax) is paced. Missing: eased over the whole shot (it nearly stops at both ends; the
   * moves of every plan before motion-montage). `glide`: at an even speed, with short eased starts and ends (≈ 0.7 s): a long shot keeps
   * moving. With `focus`, a push glides towards the subject's centre (a pull away from it). `linear`: one even speed from the first frame
   * to the last, no eased ends (director-motion: the archive documentary's stills and films, measured on three whole videos).
   */
  ease: z.enum(['glide', 'linear']).optional()
})
export type Motion = z.infer<typeof Motion>

export const Shot = z.object({
  id: z.string().min(1),
  track: z.enum(['base', 'overlay', 'labels']),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(1),
  kind: ShotKind,
  /** The genlist item that fills it (base shots). */
  genItem: z.string().optional(),
  motion: Motion.optional(),
  /**
   * How the shot comes in (§28.1, motion-montage): a cut, a dissolve, a dip through black (`dip`) or white (`flash`), a `whip` (the frame
   * flies out sideways in a motion blur), a `push` (the new picture pushes the old one out), a `zoom` (through the old picture into the
   * new one) or a `match` (a short dissolve whose new framing starts where the old one ended). Side of whip / push: `transitionDir`.
   */
  transitionIn: z.enum(TRANSITIONS).default('cut'),
  transitionDir: z.enum(['left', 'right', 'up', 'down']).optional(),
  /** Punch-ins on the beat of the voice (motion-montage): at `atS` (from the shot's start) the frame jumps in by `zoom` in 3 frames, until `holdS` (or the shot's end). */
  punches: z.array(z.object({ atS: z.number().min(0), zoom: z.number().min(1.02).max(1.6), holdS: z.number().min(0.2).optional() })).max(12).optional(),
  /** Why the shot is here: `scene` (designed) or `base` (filler at the style's rhythm). */
  role: z.enum(['scene', 'base']),
  beat: z.number().int().min(0),
  anchor: z.string().optional(),
  /** Text drawn by a label. */
  text: z.string().optional(),
  /**
   * An avatar shot: the whole frame (it IS the base shot), half the screen beside a picture (`split`, a base shot whose picture
   * is `beside`; until the render composes it, production-9, the presenter is shown full) or a small picture over the base (an
   * overlay-track shot), §21.1, production-model §7.3.
   */
  layout: z.enum(['full', 'split', 'pip']).optional(),
  /** A `split` presenter shot: the generation item of the picture beside the presenter, and the side it takes. */
  beside: z.object({ genItem: z.string().min(1), side: z.enum(['left', 'right']) }).optional(),
  /** A `prints` board (formats/cards.ts): the generation items of its prints after the first (`genItem`), in the order of its prints. */
  alsoItems: z.array(z.string().min(1)).max(7).optional(),
  /** director-motion: the picture keeps its colours under a black-and-white grade (a present-day photograph, a colour document). */
  colour: z.boolean().optional(),
  /** An archive film's frame (documentary-2): `tv` = 4:3 in an old-TV frame with blurred sides; `full` (or unset) = the film fills the frame. */
  film: z.enum(['tv', 'full']).optional(),
  /** A `pip` presenter shot: the inset's geometry as the pipeline sets it (formats/inset.ts); unset: the older small square, bottom right. */
  inset: Inset.optional(),
  /** A `motion` shot: the template and its fields (§25), or a channel's custom brick `custom:<id>` and its values (§25.2). */
  graphic: GraphicSpec.optional()
})
export type Shot = z.infer<typeof Shot>

export const EditPlan = z.object({
  schema: z.literal(EDITPLAN_SCHEMA),
  fps: z.literal(FPS),
  /** 1920×1080 (16:9) or 1080×1920 (9:16, a short). */
  size: z.union([
    z.tuple([z.literal(FRAME_SIZES['16:9'][0]), z.literal(FRAME_SIZES['16:9'][1])]),
    z.tuple([z.literal(FRAME_SIZES['9:16'][0]), z.literal(FRAME_SIZES['9:16'][1])])
  ]),
  frames: z.number().int().positive(),
  tracks: z.object({ base: z.array(z.string()), overlay: z.array(z.string()), labels: z.array(z.string()) }),
  captionsPreset: z.string().min(1),
  shots: z.array(Shot).min(1),
  chapters: z.array(z.object({ title: z.string().min(1), startFrame: z.number().int().min(0) })),
  diagnostics: z.array(z.string())
})
export type EditPlan = z.infer<typeof EditPlan>

export const GenItem = z.object({
  /** Used in file names: letters, digits, `-` and `_` only. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  kind: z.enum(GEN_KINDS),
  /** Stock search words (English, 2–4 concrete words) or an image prompt. */
  query: z.string().optional(),
  prompt: z.string().optional(),
  constraints: z.object({ durationS: z.number().positive(), aspect: z.enum(ASPECTS) }),
  /** `said`: the words spoken under the shot (avatar-qualite: the illustration check judges the picture against them); `atS`:
   *  where its shot starts in the film (the stills of nearby shots are compared). */
  context: z.object({ beatText: z.string(), subject: z.string(), keyTerms: z.array(z.string()), said: z.string().max(1000).optional(), atS: z.number().min(0).optional() }),
  /** Credits per unit and units (images, seconds…) from the price catalogue the director received. */
  unitPrice: z.number().min(0),
  units: z.number().min(0),
  /** Higher = more valuable; the budget pass downgrades the lowest value per credit first. */
  priority: z.number(),
  shotIds: z.array(z.string()).min(1),
  /** An avatar item: the stretch of the voice it speaks, in frames of the film (§21.6). */
  voiceRange: z.object({ startFrame: z.number().int().min(0), endFrame: z.number().int().min(1) }).optional(),
  /** An avatar item: how its shot is laid out. */
  layout: z.enum(['full', 'split', 'pip']).optional(),
  /**
   * A picture's prompt in its parts (the mix director writes them): the shot size and the scene (the scene pass's prompt, a
   * recurring object's fixed description at its head). With a brick style, the pictures brick composes the final prompt from
   * these and the style instead of `prompt` (decision 0035). Absent: `prompt` is used as it is.
   */
  shot: z.object({ size: z.string().min(1).max(60), scene: z.string().min(1).max(1200) }).optional(),
  /** The recurring objects, places or characters this picture shows (their names in `json.directives`' `recurring`). */
  recurring: z.array(z.string().min(1).max(80)).max(5).optional(),
  /**
   * A generated-video item that shares the generation of an earlier one (`clipShotsPerGeneration` 2): one clip makes both
   * shots, the earlier one's wide part then a tight crop for this one. Priced once (its `units` are 0), no still of its own.
   */
  sameAs: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /** A found-media item (documentary-2): broader search words of the same period and place, asked too, for when nothing shows `query` exactly. */
  alt: z.string().max(80).optional()
})
export type GenItem = z.infer<typeof GenItem>

/** Items that share the generation of an earlier `video.gen` item must point at one that exists, is earlier and owns its clip. */
export function checkSharedClips(list: GenList): string[] {
  const problems: string[] = []
  const seen = new Map<string, GenItem>()
  for (const it of list.items) {
    if (it.sameAs !== undefined) {
      const head = seen.get(it.sameAs)
      if (it.kind !== 'video.gen') problems.push(`item ${it.id} shares a clip but is ${it.kind}`)
      else if (!head) problems.push(`item ${it.id} shares the clip of ${it.sameAs}, which is not an earlier item`)
      else if (head.kind !== 'video.gen' || head.sameAs !== undefined) problems.push(`item ${it.id} shares the clip of ${it.sameAs}, which makes none`)
    }
    seen.set(it.id, it)
  }
  return problems
}

export const GenList = z.object({
  items: z.array(GenItem),
  totals: z.object({ credits: z.number().min(0), items: z.number().int().min(0), byKind: z.record(z.string(), z.number().int()) }),
  /** The budget the list was kept within, in credits (null: no cap). */
  budget: z.number().min(0).nullable()
})
export type GenList = z.infer<typeof GenList>

/**
 * The checker (R12.2, R21.7): problems in English (they go back to the director once, then fail the node). Empty when
 * the plan is sound: base track exactly covers [0, frames), overlays inside, every base shot has an item of a known
 * kind, the list total equals its items and stays within the budget.
 */
export function checkEditPlan(plan: EditPlan, list: GenList, expectedFrames: number): string[] {
  const problems = checkTimeline(plan, expectedFrames)
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const base = plan.tracks.base.map((id) => byId.get(id))
  const items = new Map(list.items.map((it) => [it.id, it]))
  for (const s of base) {
    if (!s || s.kind === 'hold' || s.kind === 'label') continue
    if (s.kind === 'motion') {
      // a card that frames a found or made picture needs that picture's item
      const it = s.genItem ? items.get(s.genItem) : undefined
      if (s.genItem && !it) problems.push(`card ${s.id} has no item for its picture`)
      // (a prints board may play a film inside a print: its print asks for the frames)
      else if (it && it.kind !== 'stock.photo' && it.kind !== 'image.gen' && !(it.kind === 'stock.video' && boardFilm(s))) problems.push(`card ${s.id} frames a ${it.kind}, not a picture`)
      for (const more of s.alsoItems ?? []) {
        const m = items.get(more)
        if (!m) problems.push(`card ${s.id} has no item for its print ${more}`)
        else if (m.kind !== 'stock.photo' && m.kind !== 'image.gen') problems.push(`card ${s.id} frames a ${m.kind}, not a picture`)
      }
      continue
    }
    const it = s.genItem ? items.get(s.genItem) : undefined
    if (!it) problems.push(`base shot ${s.id} has no generation item`)
    else if (it.kind !== s.kind) problems.push(`shot ${s.id} is ${s.kind} but its item is ${it.kind}`)
    if (s.beside) {
      const b = items.get(s.beside.genItem)
      if (!b) problems.push(`shot ${s.id} has no item for the picture beside the presenter`)
      else if (b.kind === 'avatar') problems.push(`shot ${s.id} shows a presenter beside the presenter`)
    }
  }
  // an avatar over the base (picture in picture) lives on the overlay track: it still needs its item
  for (const id of plan.tracks.overlay) {
    const s = byId.get(id)
    if (s?.kind !== 'avatar') continue
    const it = s.genItem ? items.get(s.genItem) : undefined
    if (!it) problems.push(`overlay shot ${s.id} has no generation item`)
    else if (it.kind !== 'avatar') problems.push(`shot ${s.id} is avatar but its item is ${it.kind}`)
  }
  // an animated overlay lives on the overlay track, a documentary card on the base track; each carries a spec the template can draw
  // for the length of the shot
  for (const s of plan.shots) {
    if (s.kind !== 'motion') continue
    const card = isCardTemplate((s.graphic as { template?: unknown } | undefined)?.template)
    if (card && s.track !== 'base') problems.push(`card ${s.id} is not on the base track`)
    if (!card && s.track !== 'overlay') problems.push(`motion shot ${s.id} is not on the overlay track`)
    if (!s.graphic) problems.push(`motion shot ${s.id} has no graphic`)
    else problems.push(...checkMotion(s.graphic, (s.endFrame - s.startFrame) / FPS).map((p) => `shot ${s.id}: ${p}`))
  }
  problems.push(...checkSharedClips(list))
  const aspect = aspectOfSize(plan.size)
  for (const it of list.items) if (it.constraints.aspect !== aspect) problems.push(`item ${it.id} asks for ${it.constraints.aspect}, the plan is ${aspect ?? 'of an unknown shape'}`)
  const total = list.items.reduce((sum, it) => sum + it.unitPrice * it.units, 0)
  if (Math.abs(total - list.totals.credits) > 1e-6) problems.push(`list total ${list.totals.credits} ≠ sum of items ${total}`)
  if (list.budget !== null && list.totals.credits > list.budget + 1e-6) problems.push(`list costs ${list.totals.credits}, budget ${list.budget}`)
  return problems
}

/** A prints board with a film inside one of its prints. */
const boardFilm = (s: Shot): boolean => {
  const g = s.graphic as { template?: string; props?: { prints?: { film?: boolean }[] } } | undefined
  return g?.template === 'prints' && (g.props?.prints ?? []).some((p) => p.film === true)
}

/** The timeline part of the checker (R21.7): what the render needs to trust a plan. */
export function checkTimeline(plan: EditPlan, expectedFrames: number): string[] {
  const problems: string[] = []
  if (plan.frames !== expectedFrames) problems.push(`plan has ${plan.frames} frames, the voice gives ${expectedFrames}`)
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  if (byId.size !== plan.shots.length) problems.push('two shots share an id')
  for (const s of plan.shots) {
    if (s.endFrame <= s.startFrame) problems.push(`shot ${s.id} has no length`)
    if (s.startFrame < 0 || s.endFrame > plan.frames) problems.push(`shot ${s.id} lies outside the film`)
  }
  const base = plan.tracks.base.map((id) => byId.get(id))
  let at = 0
  for (const [i, s] of base.entries()) {
    if (!s) {
      problems.push(`base track lists an unknown shot (${plan.tracks.base[i] ?? '?'})`)
      continue
    }
    if (s.track !== 'base') problems.push(`shot ${s.id} is on the base list but not on the base track`)
    if (s.startFrame !== at) problems.push(`base track ${s.startFrame > at ? 'gap' : 'overlap'} at frame ${at}`)
    at = s.endFrame
  }
  if (at !== plan.frames) problems.push(`base track ends at frame ${at}, not ${plan.frames}`)
  for (const id of [...plan.tracks.overlay, ...plan.tracks.labels]) if (!byId.has(id)) problems.push(`unknown overlay shot ${id}`)
  return problems
}
