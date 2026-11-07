// The editing grammar (motion-montage, docs/ENGINE-SPEC.md §21.11): a style's kit (formats/edit-kit.ts) applied to the director's plan.
// Pure and seeded: the same plan, words, kit and seed always give the same edit.
//   - cut-ins: a still held longer than `maxHoldS` is cut on a word into the same picture closer on its subject (edit/inserts.ts);
//   - transitions: each change of base shot is a boundary (inside a sentence, a sentence's end, a paragraph's, a chapter's); its
//     transition is drawn from the kit's weights for that kind (the director's own soft transitions are kept unless the kit overrides),
//     kept only where it means something (`purposeful`) and under `perMinute`;
//   - camera: a still without a move (or every still, with `override`) gets one from the kit's weights, its zoom travelling `speedPerS`,
//     gliding (`ease`); a parallax only on a still long enough;
//   - punch-ins: on the voice's accents (a word after a pause, a number, a word said louder than the voice around it), on stills only, at
//     most `perMinute`, `minGapS` apart; a punch holds to the cut (never back out), so only near a still's end;
//   - numbers: the numbers the voice says set as kinetic type on their word (`numbers`);
//   - sound effects: on transitions, chapters, cards that come in, reveals inside them (a word punch, a counted row, a pin, a highlighted
//     phrase, a stressed kinetic word) and punch-ins, capped at `perMinute` (transitions and chapters first, then cards, then reveals).
import { BOUNDARIES, type STILL_MOVES, type Boundary, type EditKit, type TransitionWeights } from '../formats/edit-kit'
import type { EditPlan, Motion, Shot, Transition } from '../formats/editplan'
import { FPS, type Word } from '../formats/timing'
import { SFX_KINDS, type SfxEvent, type SfxKind } from '../media/sfx'
import { cutIns, numberOverlays, STILL_KINDS } from './inserts'
import { measureLengths, seededRandom, type RhythmMeasure } from './rhythm'

export { STILL_KINDS }

export interface Accent {
  t: number
  score: number
  word: number
}

/**
 * The voice's accents: a word after a pause (≥ 0.3 s, not the film's first), a number, a word in capitals or before « ! », the last word of
 * a phrase group (before a comma or a full stop), a long word; with `energies` (the voice's level on each word, any unit), a word said
 * louder than the median adds to it. Kept from a score of 1.5 (the kit then takes the strongest, under its cap).
 */
export function voiceAccents(words: readonly Word[], energies?: readonly number[]): Accent[] {
  const sorted = energies ? [...energies].filter((e) => e > 0).sort((a, b) => a - b) : []
  const median = sorted.length ? (sorted[Math.floor(sorted.length / 2)] as number) : 0
  const out: Accent[] = []
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1]
    const bare = w.w.replace(/[^\p{L}\p{N}]/gu, '')
    if (!bare) continue
    let score = 0
    if (prev && w.start - prev.end >= 0.3) score += 1.5
    if (/\p{N}/u.test(bare)) score += 2
    if (bare.length >= 3 && bare === bare.toUpperCase() && /\p{L}/u.test(bare)) score += 1.5
    if (/!$/.test(w.w)) score += 1
    // the last word of a phrase group carries the stress (French puts it there; a list or a clause ends on it in English too)
    if (/[,;:.!?…]["»”)]?$/.test(w.w)) score += 1.25
    if (bare.length >= 7) score += 0.75
    const e = energies?.[i]
    if (e !== undefined && median > 0) score += Math.max(0, Math.min(2, 2 * (e / median - 1)))
    if (score >= 1.5) out.push({ t: w.start, score, word: i })
  }
  return out
}

/** The kind of boundary at `t` seconds: a chapter's start, a paragraph's, a sentence's, or inside a sentence. */
export function boundaryAt(t: number, words: readonly Word[], chapterStartsS: readonly number[]): Boundary {
  if (chapterStartsS.some((c) => Math.abs(c - t) < 0.5)) return 'chapter'
  // the word that starts nearest the cut, and the one before it
  let i = 0
  let best = Infinity
  for (const [k, w] of words.entries()) {
    const d = Math.abs(w.start - t)
    if (d < best) {
      best = d
      i = k
    }
  }
  const w = words[i]
  const prev = words[i - 1]
  if (!w || !prev || best > 0.6) return 'phrase'
  if (w.paragraph !== prev.paragraph) return 'paragraph'
  if (w.sentence !== prev.sentence) return 'sentence'
  return 'phrase'
}

/** One key drawn from weights (zero and missing weights never come out); none: `fallback`. */
export function draw<K extends string>(weights: Partial<Record<K, number>>, rand: () => number, fallback: K): K {
  const items = Object.entries(weights).filter((e): e is [K, number] => typeof e[1] === 'number' && e[1] > 0)
  const total = items.reduce((a, [, w]) => a + w, 0)
  if (total <= 0) return fallback
  let r = rand() * total
  for (const [k, w] of items) {
    r -= w
    if (r <= 0) return k
  }
  return (items[items.length - 1] as [K, number])[0]
}

/** A still's move from the kit: the zoom travels `speedPerS` a second (a classic move), or a parallax on the frame's middle. */
export function moveFor(kind: (typeof STILL_MOVES)[number], seconds: number, speedPerS: number): Motion {
  const travel = Math.min(0.5, Math.max(0.02, speedPerS * seconds))
  switch (kind) {
    case 'still':
      return { kind: 'push', from: 1.03, to: 1.03 }
    case 'push':
      return { kind: 'push', from: 1.02, to: Math.min(1.6, 1.02 + travel) }
    case 'pull':
      return { kind: 'pull', from: Math.min(1.6, 1.02 + travel), to: 1.02 }
    case 'left':
    case 'right':
      return { kind, from: 1.08, to: Math.min(1.6, 1.08 + travel / 2) }
    case 'parallax':
      return { kind: 'parallax', from: 1.04, to: 1.04, focus: { x: 0.3, y: 0.18, w: 0.4, h: 0.68 }, depth: 2.4 }
  }
}

/**
 * Does a transition mean something between `prev` and `next` at a boundary of `kind`? Cuts, dissolves and dips need no reason; a match
 * joins two shots of the same picture; a whip or a push runs through a series of quick stills (an enumeration); a zoom goes into a card or
 * a detail of the same picture; a flash marks a disclosure, at a chapter or a paragraph.
 */
export function hasPurpose(tr: Transition, prev: Shot, next: Shot, kind: Boundary): boolean {
  const same = prev.genItem !== undefined && prev.genItem === next.genItem
  const quick = (s: Shot): boolean => STILL_KINDS.includes(s.kind) && s.endFrame - s.startFrame <= 4 * FPS
  switch (tr) {
    case 'match':
      return same
    case 'whip':
    case 'push':
      return quick(prev) && quick(next)
    case 'zoom':
      return next.kind === 'motion' || same
    case 'flash':
      return kind === 'chapter' || kind === 'paragraph'
    default:
      return true
  }
}

/** What comes in inside a card or an overlay, with its time from the shot's start (seconds) and its sound slot. */
export function revealsOf(template: string, props: Record<string, unknown>): { atS: number; slot: keyof EditKit['sfx']['reveals'] }[] {
  const out: { atS: number; slot: keyof EditKit['sfx']['reveals'] }[] = []
  const list = (k: string): Record<string, unknown>[] => (Array.isArray(props[k]) ? (props[k] as Record<string, unknown>[]) : [])
  const at = (x: Record<string, unknown>, k = 'atS'): number | undefined => (typeof x[k] === 'number' ? (x[k] as number) : undefined)
  if (template === 'archive' && typeof props.punch === 'string') out.push({ atS: at(props, 'punchAtS') ?? 0.6, slot: 'punch' })
  if (template === 'bars') for (const r of list('rows')) out.push({ atS: at(r) ?? 0.6, slot: 'row' })
  if (template === 'chart') for (const k of ['counters', 'slices']) for (const r of list(k)) out.push({ atS: at(r) ?? 0.6, slot: 'row' })
  if (template === 'map') for (const r of list('pins')) out.push({ atS: at(r) ?? 0.6, slot: 'pin' })
  if (template === 'document') for (const r of list('marks')) out.push({ atS: at(r) ?? 0.6, slot: 'mark' })
  if (template === 'kinetic') for (const r of list('words')) if (r.emphasis === true) out.push({ atS: at(r) ?? 0, slot: 'word' })
  // a POV card (formats/pov.ts): the reference's effects follow its graphic events, not its cuts — a number that lands, a box ticked, an
  // icon or a prop that pops, a stamp, a cracked screen (research note style-monde-pov-2026-11 (old repository) § 7)
  if (template === 'pov' && typeof props.shot === 'object' && props.shot !== null) {
    const shot = props.shot as Record<string, unknown>
    const of = (k: string): Record<string, unknown>[] => (Array.isArray(shot[k]) ? (shot[k] as Record<string, unknown>[]) : [])
    if (shot.kind === 'number') for (const r of of('steps')) out.push({ atS: at(r) ?? 0.2, slot: 'word' })
    if (shot.kind === 'list' || shot.kind === 'icons') for (const r of of('items')) out.push({ atS: at(r) ?? 0.3, slot: 'pin' })
    if (shot.kind === 'scene') for (const r of [...of('props'), ...(shot.tag ? [shot.tag as Record<string, unknown>] : [])]) if (at(r) !== undefined) out.push({ atS: at(r) as number, slot: 'pin' })
    if (shot.kind === 'ring' || shot.kind === 'dial') out.push({ atS: 0.2, slot: 'row' })
    if (shot.kind === 'title') out.push({ atS: 0.15, slot: 'word' })
    if (shot.kind === 'paper' && shot.stamp) out.push({ atS: at(shot.stamp as Record<string, unknown>) ?? 0.9, slot: 'punch' })
    if (shot.kind === 'phone' && typeof shot.crackAtS === 'number') out.push({ atS: shot.crackAtS, slot: 'punch' })
    if (shot.kind === 'browser' && shot.status) out.push({ atS: at(shot.status as Record<string, unknown>) ?? 0.8, slot: 'word' })
  }
  return out
}

export interface KitReport {
  transitions: Partial<Record<Transition, number>>
  moves: Partial<Record<Motion['kind'], number>>
  punches: number
  /** Stills cut in two (the second part closer), and numbers set on screen. */
  cutIns: number
  numbers: number
  sfx: number
  /** Shot lengths of the base track after the kit (the kit does not move cuts). */
  rhythm: RhythmMeasure
}

const isSfx = (k: string | null | undefined): k is SfxKind => typeof k === 'string' && (SFX_KINDS as readonly string[]).includes(k)

/** The plan with the kit's transitions, moves and punches, and the sound effects of the film (seconds). */
export function applyEditKit(o: { plan: EditPlan; words: readonly Word[]; kit: EditKit; seed: number; energies?: readonly number[] }): { plan: EditPlan; sfx: SfxEvent[]; report: KitReport } {
  const { kit, words } = o
  const rand = seededRandom(o.seed * 7919 + 17)
  const byId = new Map(o.plan.shots.map((s) => [s.id, { ...s }]))
  const given = o.plan.tracks.base.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined)
  const { base, added } = cutIns(given, words, kit)
  const durationS = o.plan.frames / FPS
  const chapters = o.plan.chapters.filter((c) => c.startFrame > 0).map((c) => c.startFrame / FPS)
  const report: KitReport = { transitions: {}, moves: {}, punches: 0, cutIns: added.size, numbers: 0, sfx: 0, rhythm: measureLengths(base.map((s) => (s.endFrame - s.startFrame) / FPS)) }
  const events: (SfxEvent & { rank: number })[] = []
  const sound = (kind: string | null | undefined, atS: number, rank: number): void => {
    if (isSfx(kind)) events.push({ atS, kind, rank })
  }
  let side = rand() < 0.5 ? 'left' : 'right'
  let blends = Math.floor((kit.transitions.perMinute * durationS) / 60)
  for (const [i, s] of base.entries()) {
    const seconds = (s.endFrame - s.startFrame) / FPS
    // the transition (a cut-in stays a cut)
    if (i > 0 && !added.has(s.id)) {
      const prev = base[i - 1] as Shot
      const t = s.startFrame / FPS
      const kind = boundaryAt(t, words, chapters)
      let tr: Transition = s.transitionIn
      const drawn = tr === 'cut' || kit.transitions.override
      if (drawn) {
        tr = draw<Transition>(kit.transitions[kind] as TransitionWeights, rand, 'cut')
        if (kit.transitions.purposeful && !hasPurpose(tr, prev, s, kind)) tr = kind === 'paragraph' || kind === 'chapter' ? 'dissolve' : 'cut'
      }
      // a blend needs room on both sides and a whole picture on each (never across a presenter beside a picture)
      if (tr !== 'cut' && tr !== 'dip' && (s.endFrame - s.startFrame < 8 || s.layout === 'split' || prev.layout === 'split')) tr = 'cut'
      // the cap: the director's own transitions count against it, only the kit's drawn ones give way
      if (tr !== 'cut' && blends-- <= 0 && drawn) tr = 'cut'
      s.transitionIn = tr
      if (tr === 'whip' || tr === 'push') {
        s.transitionDir = kit.transitions.dir === 'alternate' ? (side as 'left' | 'right') : kit.transitions.dir
        side = side === 'left' ? 'right' : 'left'
      }
      report.transitions[tr] = (report.transitions[tr] ?? 0) + 1
      sound(kit.sfx.transitions[tr], t, 3)
    }
    // the camera of a still: the kit's move, paced by the kit
    if (STILL_KINDS.includes(s.kind) && !added.has(s.id) && (!s.motion || kit.camera.override)) {
      const weights = { ...kit.camera.stills }
      if (seconds < kit.camera.parallaxMinS) delete weights.parallax
      s.motion = moveFor(draw(weights, rand, 'push'), seconds, kit.camera.speedPerS)
    }
    if (s.motion && kit.camera.ease === 'glide' && s.motion.kind !== 'pan' && !s.motion.ease) s.motion = { ...s.motion, ease: 'glide' }
    if (s.motion) report.moves[s.motion.kind] = (report.moves[s.motion.kind] ?? 0) + 1
  }
  // punch-ins on the voice's accents, strongest first; a punch holds to the cut, so it lands only near a still's end
  const most = Math.floor((kit.punches.perMinute * durationS) / 60)
  const placed: number[] = []
  if (most > 0) {
    for (const a of [...voiceAccents(words, o.energies)].sort((x, y) => y.score - x.score || x.t - y.t)) {
      if (placed.length >= most) break
      if (placed.some((p) => Math.abs(p - a.t) < kit.punches.minGapS)) continue
      const shot = base.find((s) => STILL_KINDS.includes(s.kind) && a.t >= s.startFrame / FPS + 0.4 && a.t <= s.endFrame / FPS - 0.5 && s.endFrame / FPS - a.t <= kit.punches.maxAfterS)
      if (!shot || shot.punches?.length) continue
      const atS = Math.round((a.t - shot.startFrame / FPS) * FPS) / FPS
      shot.punches = [{ atS, zoom: kit.punches.zoom }]
      placed.push(a.t)
      sound(kit.sfx.punch, a.t, 1)
    }
  }
  report.punches = placed.length
  // the numbers the voice says, on their word
  const overlays = o.plan.tracks.overlay.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined)
  const look = o.plan.shots.map((s) => s.graphic as { accent?: string; theme?: 'dark' | 'light' } | undefined).find((g) => g?.accent)
  const numbers = numberOverlays({ base, overlays, words, kit, durationS, accent: look?.accent ?? '#d5412f', theme: look?.theme ?? 'dark' })
  report.numbers = numbers.shots.length
  // chapters, cards and their reveals
  for (const c of chapters) sound(kit.sfx.chapter, c, 3)
  for (const s of [...o.plan.shots, ...numbers.shots]) {
    const g = s.graphic as { template?: unknown; props?: unknown } | undefined
    if (s.kind !== 'motion' || typeof g?.template !== 'string') continue
    const t0 = s.startFrame / FPS
    sound(kit.sfx.cards[g.template], t0, 2)
    const props = (g.props ?? {}) as Record<string, unknown>
    for (const r of revealsOf(g.template, props)) if (r.atS < (s.endFrame - s.startFrame) / FPS) sound(kit.sfx.reveals[r.slot], t0 + r.atS, 1)
  }
  // the cap: the most important first, then in time
  const cap = Math.floor((kit.sfx.perMinute * durationS) / 60)
  const kept = events
    .filter((e) => e.atS >= 0 && e.atS < durationS)
    .sort((a, b) => b.rank - a.rank || a.atS - b.atS)
    .slice(0, cap)
    .sort((a, b) => a.atS - b.atS)
    .map(({ atS, kind }) => ({ atS, kind }))
  report.sfx = kept.length
  // the plan: the base shots as edited (cut-ins after their first part), the other shots, the numbers on the overlay track
  const baseIds = new Set(o.plan.tracks.base)
  const shots = [...base, ...o.plan.shots.filter((s) => !baseIds.has(s.id)).map((s) => byId.get(s.id) ?? s), ...numbers.shots]
  const tracks = { ...o.plan.tracks, base: base.map((s) => s.id), overlay: [...o.plan.tracks.overlay, ...numbers.shots.map((s) => s.id)] }
  return { plan: { ...o.plan, shots, tracks }, sfx: kept, report }
}

export { BOUNDARIES }
