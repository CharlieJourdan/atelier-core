// « Créer de zéro avec des inspirations » (parcours-utilisateur, Charlie 02/11: « le motion design de X, le montage de Y, le type de
// contenu de Z, les scripts de W »): each axis of a pipeline takes its measures from its own reference. The content axis picks the
// base and the pictures (the caller proposes from it, style-propose.ts); the other axes then set only what is theirs on that pipeline:
//   editing — the shot lengths, the curve, where cuts land, the presenter's layouts, captions when the reference burns them;
//   motion  — the share of motion-design cards and the labels on screen (cards are drawn by the documentary base only today: on
//             another base the gap is said, never faked);
//   script  — the voice's pace (the agent writes the sample like the reference's hooks; the words themselves are never copied).
// Mixing two channels is the same thing with two links (« le montage de A, le contenu de B »). Every axis says in French what it took,
// or why it could not. Pure: no I/O.
import { basePipeline } from './bases'
import { applyOps, type EditOp } from './edit-ops'
import { medianOf, type VideoMeasure } from './fit'
import { predictStyle, styleOps } from './likeness'
import { optionProblem } from './options'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'

export const INSPIRATION_AXES = ['content', 'editing', 'motion', 'script'] as const
export type InspirationAxis = (typeof INSPIRATION_AXES)[number]

export interface AxisReference {
  axis: InspirationAxis
  /** The reference's name (a channel's title), for the owner. */
  title: string
  refs: readonly VideoMeasure[]
}

export interface InspiredAxis {
  axis: InspirationAxis
  title: string
  /** What the axis set on the pipeline (empty: nothing measured, or nothing this base can take). */
  ops: EditOp[]
  /** In French: what was taken from the reference, or why not. */
  said: string
  taken: boolean
}

const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)
const r2 = (x: number): number => Math.round(x * 100) / 100
const fr = (x: number): string => x.toFixed(1).replace('.', ',')
const pct = (x: number): string => `${Math.round(x * 100)} %`

/** The editing of the references: shot lengths, curve, cut timing and layouts, captions when they burn some. */
function editingOps(doc: RecipeDoc, refs: readonly VideoMeasure[], reg: TechnologyRegistry): { ops: EditOp[]; parts: string[] } {
  const ops: EditOp[] = []
  const parts: string[] = []
  const shot = medianOf(known(refs.map((r) => r.shotS)))
  const mix = doc.mix as Record<string, unknown> | null | undefined
  if (mix && shot !== null) {
    // the kinds whose shot length a mix sets (cards keep their own timing, mix.ts)
    const kinds = ['clipAi', 'imageAi', 'stock', 'archive'].filter((k) => typeof mix[k] === 'number' && (mix[k] as number) > 0)
    if (kinds.length > 0) {
      ops.push({ op: 'setMix', mix: { ...mix, shotLengthS: Object.fromEntries(kinds.map((k) => [k, r2(Math.min(60, Math.max(0.5, shot)))])) } as never } as EditOp)
      parts.push(`un plan toutes les ${fr(shot)} s`)
    }
  }
  // the curve, where the cuts land and the presenter's layouts: the references' profile, without what belongs to the other axes
  for (const op of styleOps(doc, refs, reg)) {
    if (op.op === 'setCurve') {
      ops.push(op)
      parts.push(op.curve === 'flat' ? 'un rythme égal du début à la fin' : 'une accroche plus dense')
    } else if (op.op === 'setSetting' && op.brick === 'director.plan' && ['cutLeadS', 'layouts', 'presenterRunMaxS'].includes(op.key)) ops.push(op)
  }
  const captions = known(refs.map((r) => r.captions))
  const declared = (basePipeline(doc.base)?.options ?? []).some((o) => o.id === 'captions')
  if (declared && captions.length > 0 && captions.filter(Boolean).length * 2 > captions.length) {
    ops.push({ op: 'setOption', option: 'captions', value: true })
    parts.push('des sous-titres')
  }
  return { ops, parts }
}

/** The motion design of the references: their share of cards and labels on screen. */
function motionOps(doc: RecipeDoc, refs: readonly VideoMeasure[]): { ops: EditOp[]; parts: string[]; gap: string | null } {
  const ops: EditOp[] = []
  const parts: string[] = []
  const cards = medianOf(known(refs.map((r) => (r.kinds ? (r.kinds.motion ?? 0) : null))))
  const labels = medianOf(known(refs.map((r) => r.labelsPerMinute)))
  const mix = doc.mix as Record<string, number | unknown> | null | undefined
  const drawsCards = doc.bricks.some((b) => b.tech.startsWith('motion.render@'))
  let gap: string | null = null
  if (cards !== null && cards > 0.02) {
    if (!drawsCards || !mix) gap = `ses cartes animées (${pct(cards)} des images) : seule la base Documentaire les dessine aujourd’hui`
    else {
      // the biggest picture kind gives way to the cards (the shares still add to 1)
      const now = typeof mix.motion === 'number' ? mix.motion : 0
      const from = Object.entries(mix).filter(([k, v]) => k !== 'motion' && k !== 'presenter' && typeof v === 'number').sort((a, b) => (b[1] as number) - (a[1] as number))[0]
      const delta = r2(cards - now)
      if (from && Math.abs(delta) >= 0.02 && (from[1] as number) - delta >= 0) {
        ops.push({ op: 'setMix', mix: { ...mix, motion: r2(now + delta), [from[0]]: r2((from[1] as number) - delta) } as never } as EditOp)
      }
      parts.push(`des cartes animées sur ${pct(cards)} des images`)
    }
  }
  if (labels !== null && doc.bricks.some((b) => b.tech.startsWith('director.plan@'))) {
    ops.push({ op: 'setSetting', brick: 'director.plan', key: 'labelsPerMin', value: Math.min(10, Math.round(labels)) })
    parts.push(labels < 0.5 ? 'presque aucun texte à l’écran' : `${fr(labels)} textes à l’écran par minute`)
  }
  return { ops, parts, gap }
}

/** The script's pace: the voice reads at the references' words a minute (a speed, or the words a minute the base sets). */
function scriptOps(doc: RecipeDoc, refs: readonly VideoMeasure[], reg: TechnologyRegistry): { ops: EditOp[]; parts: string[] } {
  const wpm = medianOf(known(refs.map((r) => r.wordsPerMinute)))
  const voice = doc.bricks.find((b) => b.tech.startsWith('voice.tts@'))
  if (wpm === null || !voice) return { ops: [], parts: [] }
  const parts = [`une voix à ${Math.round(wpm)} mots par minute`]
  if (typeof voice.settings.wpm === 'number') return { ops: [{ op: 'setSetting', brick: 'voice.tts', key: 'wpm', value: Math.round(Math.min(450, Math.max(80, wpm))) }], parts }
  const predicted = predictStyle(doc, reg)?.wordsPerMinute
  const now = typeof voice.settings.speed === 'number' ? voice.settings.speed : 1
  if (typeof predicted !== 'number' || predicted <= 0) return { ops: [], parts: [] }
  const speed = r2(Math.min(1.2, Math.max(0.7, (now * wpm) / predicted)))
  return { ops: Math.abs(speed - now) >= 0.02 ? [{ op: 'setSetting', brick: 'voice.tts', key: 'speed', value: speed }] : [], parts }
}

/**
 * The pipeline `doc` (proposed from the content axis) with every other axis's measures on it, each axis applied on its own and kept
 * only when the pipeline still checks; and what each axis took, in French.
 */
export function inspire(doc: RecipeDoc, axes: readonly AxisReference[], reg: TechnologyRegistry): { doc: RecipeDoc; axes: InspiredAxis[] } {
  const decls = basePipeline(doc.base)?.options ?? []
  const checkOption = (id: string, v: unknown): string | null => optionProblem(decls, id, v)
  let cur = doc
  const out: InspiredAxis[] = []
  for (const a of axes) {
    if (a.refs.length === 0) {
      out.push({ axis: a.axis, title: a.title, ops: [], said: `${a.title} : pas mesurée, rien n’est repris.`, taken: false })
      continue
    }
    if (a.axis === 'content') {
      out.push({ axis: a.axis, title: a.title, ops: [], said: `${a.title} : le type de vidéo, ses images et sa durée.`, taken: true })
      continue
    }
    const part = a.axis === 'editing' ? { ...editingOps(cur, a.refs, reg), gap: null } : a.axis === 'motion' ? motionOps(cur, a.refs) : { ...scriptOps(cur, a.refs, reg), gap: null }
    // each change on its own: one this base refuses never drops the others of the axis
    const kept: EditOp[] = []
    for (const op of part.ops) {
      const r = applyOps(cur, [op], reg, { checkOption })
      if (!r.ok) continue
      cur = r.doc
      kept.push(op)
    }
    const taken = kept.length > 0
    const what = part.parts.length > 0 ? part.parts.join(', ') : 'rien de mesurable'
    const gap = part.gap ? ` Pas repris : ${part.gap}.` : ''
    out.push({ axis: a.axis, title: a.title, ops: kept, said: taken ? `${a.title} : ${what}.${gap}` : `${a.title} : ${part.gap ?? 'rien que cette pipeline puisse reprendre'}.`, taken })
  }
  return { doc: cur, axes: out }
}
