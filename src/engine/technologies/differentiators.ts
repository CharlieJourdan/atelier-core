// « Comment veux-tu te différencier ? » (clonage-traduction, Charlie 02/11: « le montage reste similaire, mais en éléments
// différenciants… des propositions, mais logiques »; parcours-utilisateur, Charlie 02/11: « pas 36 propositions, quelques-unes
// pertinentes, moins quand c'est ma propre chaîne », « dire clairement quand une chaîne n'est pas ouf »): after « Créer une pipeline »
// has built the pipeline closest to the references, a few changes that make the channel the owner's own, each logical for the genre (a
// documentary never gets AI clips, a story short never gets AI pictures, a channel without a presenter is never offered one), each with
// what it does to the price per minute and to the likeness, and an « avant / après » when the app ships one. Three kinds of change:
// `differ` (makes the channel recognisable), `improve` (a richer editing, captions, chapters: often more render time) and `cheaper`.
// The owner picks freely; none is applied until picked. The owner's own channel: two at most, improvements and savings only (nothing
// to differ from). A weak channel: improvements first, marked recommended. Several reference channels: one more proposal per channel
// (« plus proche de … », its own measures). Pure: no I/O.
import { basePipeline } from './bases'
import { estimateCost, type CostInput, type Range } from './cost'
import { applyOps, type EditOp } from './edit-ops'
import type { VideoMeasure } from './fit'
import { likeness, predictStyle, styleOps } from './likeness'
import { optionProblem } from './options'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'

export const DIFFERENTIATOR_FAMILIES = ['motion', 'pictures', 'presenter', 'rhythm', 'text', 'voice', 'economy', 'channel'] as const
export type DifferentiatorFamily = (typeof DIFFERENTIATOR_FAMILIES)[number]
export type DifferentiatorEffect = 'differ' | 'improve' | 'cheaper'

/** Proposals shown at most: the usual case, the owner's own channel (nothing to differ from), a weak channel. */
export const DIFFERENTIATORS_MAX = 5
export const DIFFERENTIATORS_OWN_MAX = 2
export const DIFFERENTIATORS_WEAK_MAX = 4

export interface Differentiator {
  id: string
  family: DifferentiatorFamily
  effect: DifferentiatorEffect
  /** In French, for the owner: what changes, in a few words, and why it differs. */
  title: string
  detail: string
  ops: EditOp[]
  /** The saved previews that show it, « après » and « avant » (`option:<id>:<value>`, previews.ts), or null. */
  previewKey: string | null
  beforeKey: string | null
}

export interface DifferentiatorProposal extends Differentiator {
  /** Credits a finished minute, before → after (null: no prices known). */
  perMinute: { before: Range; after: Range } | null
  /** The likeness estimate against the references, before → after (null: no measured reference). */
  likeness: { before: number; after: number } | null
  /** Recommended to this owner (a weak channel: its improvements; or the agent matched it to the owner's words). */
  recommended: boolean
}

export interface DifferentiatorInput {
  refs: readonly VideoMeasure[]
  cost?: CostInput
  /** The source is the owner's own channel: improvements and savings only, two at most (none at all unless `ask` before 02/11). */
  own?: boolean
  /** Kept for the callers of record 0064: the owner asked for proposals on their own channel (the cap still applies). */
  ask?: boolean
  /** The reference channel's videos do not take off (insight.ts): improvements first, recommended. */
  weak?: boolean
  /** The reference channels, each with its own measures (two or more: « plus proche de … » per channel). */
  channels?: readonly { title: string; refs: readonly VideoMeasure[] }[]
}

const share = (doc: RecipeDoc, k: string): number => ((doc.mix as Record<string, unknown> | null | undefined)?.[k] as number | undefined) ?? 0
const round = (x: number): number => Math.round(x * 100) / 100
const option = (id: string, value: string | boolean | number): EditOp => ({ op: 'setOption', option: id, value }) as EditOp
const setting = (brick: string, key: string, value: unknown): EditOp => ({ op: 'setSetting', brick, key, value }) as EditOp
const keys = (opt: string, before: string | boolean, after: string | boolean): { beforeKey: string; previewKey: string } => ({
  beforeKey: `option:${opt.toLowerCase()}:${String(before)}`,
  previewKey: `option:${opt.toLowerCase()}:${String(after)}`
})
const NO_PREVIEW = { beforeKey: null, previewKey: null }

/** The captions the pipeline burns now (a preset name), or null when it burns none. */
function captionsOf(doc: RecipeDoc): string | null {
  const b = doc.bricks.find((x) => x.tech.startsWith('captions.make@'))
  const s = (b?.settings ?? {}) as { burn?: unknown; preset?: unknown }
  const opts = (doc.options ?? {}) as Record<string, unknown>
  if (s.burn === true) return typeof s.preset === 'string' ? s.preset : 'classic'
  return opts.captions === true ? (typeof s.preset === 'string' ? s.preset : 'classic') : null
}

/** The candidates of a pipeline's genre, before they are checked and priced (the logical ones first, per genre). */
function candidates(doc: RecipeDoc, refs: readonly VideoMeasure[]): Differentiator[] {
  const out: Differentiator[] = []
  const opts = (doc.options ?? {}) as Record<string, unknown>
  const declared = (id: string): boolean => (basePipeline(doc.base)?.options ?? []).some((o) => o.id === id)
  const clipsSeen = refs.some((r) => ((r.kinds as Record<string, number> | undefined)?.clipAi ?? 0) > 0.05)
  const captions = captionsOf(doc)
  const richer = (detail: string): void => {
    if (declared('editing') && opts.editing !== 'dynamic') {
      out.push({ id: 'richer-editing', family: 'rhythm', effect: 'improve', title: 'Un montage plus riche', detail, ops: [option('editing', 'dynamic')], ...keys('editing', 'simple', 'dynamic') })
    }
  }
  if (doc.base === 'documentary@2') {
    // documentary-2 shares the documentary's improvements (captions, chapters, editing, voice); its look variants are its own options
    // documentary-2: its look variants first (proposals apart, research note documentary-2-2026-11 (old repository) § Proposals)
    if (opts.docMapLook !== 'parchment') out.push({ id: 'maps-parchment', family: 'motion', effect: 'differ', title: 'Des cartes en parchemin', detail: 'Les cartes dessinées comme un atlas ancien au lieu du satellite sombre : un style à toi, même prix, même temps.', ops: [option('docMapLook', 'parchment')], ...NO_PREVIEW })
    if (opts.docSkin !== 'dossier') out.push({ id: 'skin-dossier', family: 'motion', effect: 'differ', title: 'Un habillage « dossier d’archives »', detail: 'Les mêmes tirages et le même montage, posés sur une chemise kraft avec des tampons rouges : ta chaîne se reconnaît au premier plan, sans rien coûter de plus.', ops: [option('docSkin', 'dossier')], ...NO_PREVIEW })
    if (captions === null && declared('captions')) {
      out.push({ id: 'captions-classic', family: 'text', effect: 'improve', title: 'Des sous-titres sobres en bas', detail: 'Une ligne blanche discrète sous l’image, comme un documentaire télé : se suit sans le son, sans cacher les archives.', ops: [option('captions', true), setting('captions.make', 'preset', 'classic')], ...keys('captions', false, true) })
    }
    if (declared('chapters') && opts.chapters !== true) {
      out.push({ id: 'chapters', family: 'text', effect: 'improve', title: 'Des chapitres à l’écran', detail: 'Un titre de partie à chaque grand moment de l’histoire : une longue vidéo se suit mieux et YouTube montre les chapitres.', ops: [option('chapters', true)], ...keys('chapters', false, true) })
    }
    richer('Des mouvements de caméra sur les archives et des coupes plus vivantes ; un peu plus de temps de fabrication.')
    out.push({ id: 'voice-calmer', family: 'voice', effect: 'differ', title: 'Une voix plus posée', detail: 'Le même narrateur (voix ai33 dessinée pour ta chaîne), 8 % plus lent : un ton de conteur, moins d’urgence.', ops: [setting('voice.tts', 'speed', 0.92)], ...NO_PREVIEW })
  } else if (doc.base === 'story-short@1') {
    // found footage only and the captions are the genre: no AI pictures, no presenter; the differences are the reading and the text
    out.push({ id: 'voice-slower', family: 'voice', effect: 'differ', title: 'Une lecture un peu moins pressée', detail: '270 mots par minute au lieu de 310 : l’histoire se comprend du premier coup, la vidéo dure un peu plus.', ops: [setting('voice.tts', 'wpm', 270)], ...NO_PREVIEW })
    if (captions === 'word') {
      out.push({ id: 'captions-highlight', family: 'text', effect: 'differ', title: 'Sous-titres en phrase, le mot dit s’allume', detail: 'Une ligne entière à l’écran au lieu d’un mot à la fois, le mot prononcé surligné : un autre look, aussi lisible.', ops: [setting('captions.make', 'preset', 'highlight')], ...NO_PREVIEW })
    }
  } else {
    // a presenter's or a voice-over's pipeline: the options it declares
    if (share(doc, 'clipAi') > 0.1) out.push({ id: 'fewer-clips', family: 'economy', effect: 'cheaper', title: 'Moins de clips IA, plus d’images animées', detail: 'Les clips coûtent l’essentiel d’une minute : en garder la moitié baisse le prix sans changer le montage.', ops: [option('clipShare', round(share(doc, 'clipAi') / 2))], ...NO_PREVIEW })
    if (clipsSeen && share(doc, 'clipAi') < 0.3) out.push({ id: 'more-clips', family: 'pictures', effect: 'improve', title: 'Plus de clips IA', detail: 'Plus d’images qui bougent, comme les vidéos les plus vues du genre ; plus cher.', ops: [option('clipShare', round(Math.min(0.5, share(doc, 'clipAi') + 0.15)))], ...NO_PREVIEW })
    if (doc.base === 'avatar@1' && opts.presenterShots !== 'multi') {
      out.push({ id: 'presenter-angles', family: 'presenter', effect: 'differ', title: 'Le présentateur sous plusieurs angles', detail: 'Deux angles en plus du plan de face, alternés : la même personne, un rendu plus « émission ».', ops: [option('presenterShots', 'multi')], ...NO_PREVIEW })
    }
    if (captions === null && declared('captions')) {
      out.push({ id: 'captions', family: 'text', effect: 'improve', title: 'Des sous-titres à l’écran, le mot dit surligné', detail: 'Les mots dits s’affichent et celui qui est prononcé s’allume : se regarde sans le son.', ops: [option('captions', true), setting('captions.make', 'preset', 'highlight')], ...keys('captions', false, true) })
    }
    richer('Des coupes plus vives et des mouvements sur les images ; un peu plus de temps de fabrication.')
  }
  if (opts.music !== 'library' && !doc.base?.startsWith('documentary@') && declared('music')) out.push({ id: 'music', family: 'rhythm', effect: 'improve', title: 'Une musique sous la voix', detail: 'Une musique de notre bibliothèque, basse sous la voix.', ops: [option('music', 'library')], ...keys('music', 'none', 'library') })
  return out
}

/** The ones kept, in order: per family one first (a few varied changes rather than five of a kind), within the case's cap. */
function chosen(list: readonly DifferentiatorProposal[], o: DifferentiatorInput): DifferentiatorProposal[] {
  const pool = o.own ? list.filter((d) => d.effect !== 'differ') : list
  const max = o.own ? DIFFERENTIATORS_OWN_MAX : o.weak ? DIFFERENTIATORS_WEAK_MAX : DIFFERENTIATORS_MAX
  // a weak channel: what makes the videos better comes first
  const ordered = o.weak ? [...pool.filter((d) => d.effect === 'improve'), ...pool.filter((d) => d.effect !== 'improve')] : pool
  const out: DifferentiatorProposal[] = []
  const families = new Set<string>()
  for (const d of ordered) {
    if (out.length >= max) break
    if (families.has(d.family) && d.family !== 'channel') continue
    families.add(d.family)
    out.push(d)
  }
  for (const d of ordered) {
    if (out.length >= max) break
    if (!out.includes(d)) out.push(d)
  }
  // shown in the genre's own order
  return ordered.filter((d) => out.includes(d))
}

/** The proposals, each checked (it applies and compiles), priced and scored; a few, the logical ones first. */
export function differentiators(doc: RecipeDoc, reg: TechnologyRegistry, o: DifferentiatorInput): DifferentiatorProposal[] {
  const decls = basePipeline(doc.base)?.options ?? []
  const checkOption = (id: string, v: unknown): string | null => optionProblem(decls, id, v)
  const list = candidates(doc, o.refs)
  if ((o.channels?.length ?? 0) >= 2 && !o.own) {
    for (const ch of o.channels ?? []) {
      const ops = styleOps(doc, ch.refs, reg)
      if (ops.length > 0) list.push({ id: `closer-${list.length}`, family: 'channel', effect: 'differ', title: `Plus proche de ${ch.title}`.slice(0, 80), detail: `Le rythme et le mélange d’images de ${ch.title}, dans ce mélange de chaînes.`.slice(0, 200), ops, ...NO_PREVIEW })
    }
  }
  const price = (d: RecipeDoc): Range | null => {
    if (!o.cost) return null
    const r = estimateCost(d, reg, o.cost)
    return r.ok ? r.estimate.perMinute : null
  }
  const score = (d: RecipeDoc): number | null => {
    if (o.refs.length === 0) return null
    const p = predictStyle(d, reg)
    return p ? likeness(o.refs, p).score : null
  }
  const before = { price: price(doc), score: score(doc) }
  const checked: DifferentiatorProposal[] = []
  for (const d of list) {
    const r = applyOps(doc, d.ops, reg, { checkOption })
    if (!r.ok) continue
    const after = { price: price(r.doc), score: score(r.doc) }
    checked.push({
      ...d,
      perMinute: before.price && after.price ? { before: before.price, after: after.price } : null,
      likeness: before.score !== null && after.score !== null ? { before: before.score, after: after.score } : null,
      recommended: o.weak === true && d.effect === 'improve'
    })
  }
  return chosen(checked, o)
}

/** The pipeline with the picked proposals applied, in the order given (a proposal that no longer applies is skipped). */
export function withDifferentiators(doc: RecipeDoc, picked: readonly DifferentiatorProposal[] | readonly Differentiator[], reg: TechnologyRegistry): RecipeDoc {
  const decls = basePipeline(doc.base)?.options ?? []
  let cur = doc
  for (const d of picked) {
    const r = applyOps(cur, d.ops, reg, { checkOption: (id, v) => optionProblem(decls, id, v) })
    if (r.ok) cur = r.doc
  }
  return cur
}
