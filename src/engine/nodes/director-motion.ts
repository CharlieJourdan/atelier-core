// The animated overlays in the edit plan (docs/ENGINE-SPEC.md §21.1, §25): which beats get which of our templates, within a budget. The cues
// are found in the timed narration (`text/motion-cues.ts`: a figure said aloud → a counter, a person named with a role → a lower third, a
// list → a list reveal, a quotation → a quote card, a place → a map pin, the turns of a several-voices script → a message conversation, the
// film's title → a title card); this pass keeps the best of them that fit: the share of the film they may cover, a count a minute, no two at
// once, none over a presenter in picture-in-picture, none over a label. A conversation is the content itself (it carries the story of a
// conversation channel), so it is not counted in the share. Output: `motion` shots on the overlay track, each with its template and fields.
// Pure: same inputs, same shots.
import { z } from 'zod'
import { MOTION_SECONDS, MOTION_TEMPLATES, MotionSpec, type MotionTemplate } from '../formats/motion'
import type { Shot } from '../formats/editplan'
import { FPS, toFrame, type Beat, type Word } from '../formats/timing'
import { conversationCues, figureCues, listCues, namedPersonCue, personCues, placeCues, quoteCues, type MotionCue } from '../text/motion-cues'
import { normWord, type ParsedScript } from '../text/script'

export const MotionPlanParams = z.object({
  /** The share of the film (0–1) the overlays may cover, conversations excepted. */
  share: z.number().min(0.02).max(0.8).default(0.2),
  /** At most this many overlays a minute, conversations excepted (and at least one when there is a cue). */
  perMinute: z.number().min(0.5).max(12).default(3),
  /** The templates the director may use. */
  templates: z.array(z.enum(MOTION_TEMPLATES)).min(1).default([...MOTION_TEMPLATES]),
  /** A title card over the first seconds. */
  titleCard: z.boolean().default(true),
  /** The channel's colour and the look (dark glass or light). */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3B82F6'),
  theme: z.enum(['dark', 'light']).default('dark'),
  /**
   * Coverage per section: the opening (`hookS`) may be covered up to `hookShare`, then every `chunkS`
   * up to `chunkShare`, with their own gaps; the best cues are kept first, a cue that collides slides up to `slideS` later, a
   * template already on screen nearby loses `sameKindPenalty` of its priority (per one within `sameKindWindowS`), and two
   * consecutive overlays never share a template. Absent: `share` and `perMinute` over the whole film, as before.
   */
  coverage: z
    .object({
      hookS: z.number().min(0).max(180).default(60),
      hookShare: z.number().min(0.02).max(0.9).default(0.62),
      chunkS: z.number().min(20).max(300).default(60),
      chunkShare: z.number().min(0.02).max(0.9).default(0.42),
      hookGapS: z.number().min(0).max(3).default(0.4),
      gapS: z.number().min(0).max(5).default(1),
      slideS: z.number().min(0).max(8).default(4.5),
      sameKindPenalty: z.number().min(0).max(1).default(0.4),
      sameKindWindowS: z.number().min(0).max(120).default(20),
      noRepeatInRow: z.boolean().default(true)
    })
    .optional()
})
export type MotionPlanParams = z.infer<typeof MotionPlanParams>

/** Seconds kept free between two overlays, and around a label or a presenter. */
const GAP_S = 0.8
/** Order of choice: higher first. A conversation comes first, then the film's title, then the facts the picture cannot show. */
const TITLE_PRIORITY = 90

export interface MotionInput {
  beats: readonly Beat[]
  words: readonly Word[]
  /** The script as parsed (its speakers), or null when the run has no script to read. */
  parsed: ParsedScript | null
  title: string
  durationS: number
  cfg: MotionPlanParams
  /** What is already in the plan: labels, and presenters laid over the picture. */
  shots: readonly Shot[]
  /** People the scene pass named with a role, per beat. */
  people?: (beat: Beat) => { name: string; role: string }[]
}

export interface MotionResult {
  shots: Shot[]
  /** Labels that only said what a kept graphic now shows (the same name or figure): the plan drops them. */
  dropLabels: string[]
  diagnostics: string[]
}

/** A text as letters and digits only (« 12 000 » and « 12000 » are one thing). */
const flat = (s: string): string => normWord(s).replace(/[^\p{L}\p{N}]/gu, '')

const overlaps = (a: { startS: number; endS: number }, b: { startS: number; endS: number }, margin: number): boolean => a.startS < b.endS + margin && a.endS > b.startS - margin

/** The cues worth considering, with each cue's length kept inside its template's limits and the film's. */
function candidates(o: MotionInput, diag: string[]): MotionCue[] {
  const { cfg, durationS: D } = o
  const allowed = new Set<MotionTemplate>(cfg.templates)
  const cues: MotionCue[] = []
  if (allowed.has('conversation') && o.parsed) cues.push(...conversationCues(o.parsed, o.words, o.beats, D))
  if (allowed.has('figure')) cues.push(...figureCues(o.words, o.beats))
  if (allowed.has('lower-third')) {
    cues.push(...personCues(o.words, o.beats))
    if (o.people) {
      for (const b of o.beats) for (const p of o.people(b)) {
        const c = namedPersonCue(o.words, b, p)
        if (c) cues.push(c)
      }
    }
  }
  if (allowed.has('list')) cues.push(...listCues(o.words, o.beats))
  if (allowed.has('quote')) cues.push(...quoteCues(o.words, o.beats))
  if (allowed.has('map-pin')) cues.push(...placeCues(o.words, o.beats))
  if (allowed.has('title') && cfg.titleCard && D >= 6) {
    if (o.title.length > 80) diag.push('motion: the title is longer than 80 characters, no title card')
    else if (o.title.trim()) {
      // a title is written without its full stop
      const text = o.title.trim().replace(/[.…]+$/u, '')
      const first = o.words[0]?.start ?? 0
      cues.push({ template: 'title', startS: Math.min(0.2, first), endS: Math.min(4.2, Math.max(2.4, D * 0.3)), priority: TITLE_PRIORITY, beat: 0, props: { title: text }, key: 'title' })
    }
  }
  // lengths: at least what the template needs (taken from the film's end if need be), at most what it allows
  const fit: MotionCue[] = []
  for (const c of cues) {
    const lim = MOTION_SECONDS[c.template]
    let { startS, endS } = c
    if (endS - startS < lim.min) endS = startS + lim.min
    if (endS > D) {
      endS = D
      if (c.template !== 'conversation') startS = Math.min(startS, Math.max(0, endS - lim.min))
    }
    if (endS - startS > lim.max) endS = startS + lim.max
    if (endS - startS < lim.min - 1e-6 || startS < 0) continue
    fit.push({ ...c, startS, endS })
  }
  return fit
}

type Coverage = NonNullable<MotionPlanParams['coverage']>
/** A cue whose penalties took more than its whole priority and a third more is given up (floor: −1.5 on a 4-point graphic). */
const DROP_BELOW = -0.375

/** The sections of the film the coverage caps apply to: the opening, then chunks of `chunkS`. */
export function coverageSections(D: number, c: Coverage): { startS: number; endS: number; share: number; gapS: number }[] {
  const out: { startS: number; endS: number; share: number; gapS: number }[] = []
  const hook = Math.min(D, c.hookS)
  if (hook > 0) out.push({ startS: 0, endS: hook, share: c.hookShare, gapS: c.hookGapS })
  for (let t = hook; t < D - 1e-6; t += c.chunkS) out.push({ startS: t, endS: Math.min(D, t + c.chunkS), share: c.chunkShare, gapS: c.gapS })
  return out
}

/**
 * The best cues first, under the caps of every section they touch: each pick re-scores what is left (a template
 * already shown nearby counts less), a cue that collides tries later starts up to `slideS`, and none sits next to one of its own
 * template. Returns the chosen cues (moved where they slid).
 */
function pickByCoverage(rest: readonly MotionCue[], c: Coverage, D: number, maxCount: number, free: (x: MotionCue, gapS: number) => boolean, chosen: MotionCue[], diag: string[]): number {
  const sections = coverageSections(D, c)
  const used = sections.map(() => 0)
  const gapAt = (t: number): number => (sections.find((s) => t >= s.startS && t < s.endS) ?? sections.at(-1))?.gapS ?? c.gapS
  const fits = (x: MotionCue): boolean =>
    sections.every((s, i) => {
      const inside = Math.max(0, Math.min(x.endS, s.endS) - Math.max(x.startS, s.startS))
      return inside === 0 || (used[i] as number) + inside <= s.share * (s.endS - s.startS) + 1e-6
    })
  const neighbourSame = (x: MotionCue): boolean => {
    const before = chosen.filter((y) => y.template !== 'conversation' && y.startS <= x.startS).sort((a, b) => b.startS - a.startS)[0]
    const after = chosen.filter((y) => y.template !== 'conversation' && y.startS > x.startS).sort((a, b) => a.startS - b.startS)[0]
    return before?.template === x.template || after?.template === x.template
  }
  // the share of its priority a cue keeps; under DROP_BELOW it is given up (too many of its template around already)
  const factor = (x: MotionCue): number => 1 - c.sameKindPenalty * chosen.filter((y) => y.template === x.template && Math.abs(y.startS - x.startS) <= c.sameKindWindowS).length
  const score = (x: MotionCue): number => x.priority * factor(x)
  const left = [...rest]
  const seen = new Set<string>()
  let count = 0
  let seconds = 0
  let slid = 0
  while (left.length > 0 && count < maxCount) {
    left.sort((a, b) => score(b) - score(a) || a.startS - b.startS)
    const x = left.shift() as MotionCue
    if (seen.has(x.key) || factor(x) < DROP_BELOW) continue
    const len = x.endS - x.startS
    let placed: MotionCue | null = null
    for (let shift = 0; shift <= c.slideS + 1e-6 && !placed; shift += 0.5) {
      const y = shift === 0 ? x : { ...x, startS: x.startS + shift, endS: x.startS + shift + len }
      if (y.endS > D + 1e-6) break
      if (fits(y) && free(y, gapAt(y.startS)) && !(c.noRepeatInRow && neighbourSame(y))) placed = y
    }
    if (!placed) continue
    if (placed.startS !== x.startS) slid++
    chosen.push(placed)
    seen.add(placed.key)
    sections.forEach((s, i) => (used[i] = (used[i] as number) + Math.max(0, Math.min(placed.endS, s.endS) - Math.max(placed.startS, s.startS))))
    seconds += len
    count++
  }
  diag.push(`motion coverage: ${sections.map((s, i) => `${Math.round(s.startS)}–${Math.round(s.endS)} s ${Math.round(((used[i] as number) / Math.max(1e-6, s.endS - s.startS)) * 100)} % (cap ${Math.round(s.share * 100)} %)`).join(', ')}${slid > 0 ? `, ${slid} slid later` : ''}`)
  return seconds
}

/** Chooses the cues and turns them into overlay shots (ids `m001`…, in time order). */
export function placeMotion(o: MotionInput): MotionResult {
  const diagnostics: string[] = []
  const D = o.durationS
  const cues = candidates(o, diagnostics)
  const busy: { startS: number; endS: number; margin: number }[] = []
  for (const s of o.shots) {
    // a presenter in picture-in-picture, and the channel's own bricks placed before this pass
    if (s.track === 'overlay' && (s.kind === 'avatar' || s.kind === 'motion')) busy.push({ startS: s.startFrame / FPS, endS: s.endFrame / FPS, margin: s.kind === 'motion' ? GAP_S : 0.3 })
  }
  const labels = o.shots.filter((s) => s.track === 'labels').map((s) => ({ id: s.id, text: flat(s.text ?? ''), startS: s.startFrame / FPS, endS: s.endFrame / FPS }))
  /** The labels a cue lies over that do not just repeat it (those are dropped with the graphic, the others block it). */
  const blockedBy = (c: MotionCue): { block: boolean; drop: string[] } => {
    const over = labels.filter((l) => overlaps(c, l, 0.2))
    const mine = (c.covers ?? []).map(flat).filter(Boolean)
    const repeats = (l: { text: string }): boolean => l.text !== '' && mine.some((m) => l.text.includes(m) || m.includes(l.text))
    return { block: c.template !== 'conversation' && over.some((l) => !repeats(l)), drop: over.filter(repeats).map((l) => l.id) }
  }
  const chosen: MotionCue[] = []
  const free = (c: MotionCue, gapS = GAP_S): boolean =>
    !busy.some((b) => overlaps(c, b, b.margin)) &&
    !chosen.some((x) => overlaps(c, x, gapS)) &&
    // a label that says something else is not covered by a graphic (a conversation may sit over one); one that only repeats it goes
    !blockedBy(c).block
  // the talk first: it is the story, and it keeps everything else out of its way
  for (const c of cues.filter((x) => x.template === 'conversation').sort((a, b) => a.startS - b.startS)) if (free(c)) chosen.push(c)
  const talk = chosen.reduce((n, c) => n + (c.endS - c.startS), 0)
  const maxSeconds = o.cfg.share * D
  const maxCount = Math.max(1, Math.round((o.cfg.perMinute * D) / 60))
  let seconds = 0
  let count = 0
  const seen = new Set<string>()
  const rest = cues.filter((x) => x.template !== 'conversation').sort((a, b) => b.priority - a.priority || a.startS - b.startS)
  if (o.cfg.coverage) seconds = pickByCoverage(rest, o.cfg.coverage, D, maxCount, free, chosen, diagnostics)
  else for (const c of rest) {
    const len = c.endS - c.startS
    if (count >= maxCount || seen.has(c.key)) continue
    // the budget in seconds; the first graphic is always allowed when it fits twice the budget (a short film still gets its title)
    if (seconds + len > maxSeconds && !(count === 0 && len <= 2 * maxSeconds)) continue
    if (!free(c)) continue
    chosen.push(c)
    seen.add(c.key)
    seconds += len
    count++
  }
  chosen.sort((a, b) => a.startS - b.startS)
  const dropLabels = [...new Set(chosen.flatMap((c) => blockedBy(c).drop))]
  const shots: Shot[] = []
  const kept: string[] = []
  for (const c of chosen) {
    const startFrame = toFrame(c.startS)
    const endFrame = Math.min(toFrame(D), toFrame(c.endS))
    const spec = MotionSpec.safeParse({ template: c.template, props: c.props, accent: o.cfg.accent, theme: o.cfg.theme })
    if (!spec.success || endFrame <= startFrame) {
      diagnostics.push(`motion: ${c.template} dropped (${spec.success ? 'no length' : (spec.error.issues[0]?.message ?? 'invalid')})`)
      continue
    }
    shots.push({
      id: `m${String(shots.length + 1).padStart(3, '0')}`,
      track: 'overlay',
      startFrame,
      endFrame,
      kind: 'motion',
      transitionIn: 'cut',
      role: 'scene',
      beat: c.beat,
      graphic: spec.data
    })
    kept.push(c.template)
  }
  if (kept.length > 0) {
    const by = new Map<string, number>()
    for (const k of kept) by.set(k, (by.get(k) ?? 0) + 1)
    diagnostics.push(`motion: ${kept.length} overlays (${[...by].map(([k, n]) => `${n} ${k}`).join(', ')}), ${(seconds + talk).toFixed(1)} s of ${D.toFixed(1)} s`)
  } else diagnostics.push('motion: nothing in the narration asks for an animated graphic')
  if (dropLabels.length > 0) diagnostics.push(`motion: ${dropLabels.length} label(s) dropped, the graphic says the same`)
  return { shots, dropLabels, diagnostics }
}
