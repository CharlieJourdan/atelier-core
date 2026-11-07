// What the LLM director returns (`json.directives`, docs/specs/production-model.md §7.2) and the editable view of the plan
// (`atelier.timeline/1`, §7.3). The LLM decides WHAT to show and on WHICH words, never a time: code finds the anchor in the
// word times and times every shot (director-mix.ts). The timeline is derived from `json.editplan` + `json.genlist`, in
// seconds rounded to the frame grid (R7.1), so the user and the agent read one list of shots that covers the voice.
import { z } from 'zod'
import type { EditPlan, GenItem, GenKind, GenList, Shot } from './editplan'
import { FPS, type Word } from './timing'
import { normWord } from '../text/script'
import { ARCHIVE_FRAMES } from './cards'

/** The picture kinds of a directive (§7.2): the mix's kinds, an animated card `motion.<template>`, a label, the sponsor. */
export const DIRECTIVE_KINDS = ['presenter', 'clipAi', 'imageAi', 'stock', 'archive', 'userFootage', 'label', 'sponsor'] as const
export const DirectiveKind = z.union([z.enum(DIRECTIVE_KINDS), z.string().regex(/^motion\.[a-z][a-z0-9-]{0,30}$/)])
export type DirectiveKind = z.infer<typeof DirectiveKind>

/** Layouts of a presenter shot (§7.3): the whole frame, half screen beside a picture, a small picture over a picture. */
export const LAYOUTS = ['full', 'split', 'pip'] as const
export type Layout = (typeof LAYOUTS)[number]

/**
 * A documentary card the director asks for (style-markets, formats/cards.ts): a map, a data card or a timeline that IS the shot, from its
 * anchor to the end of its sentence (`hold` sentences). Its props are the template's, where a part may say `on` (1–4 words of the card's
 * sentences) instead of a time: code turns them into seconds on the word times. Checked when it is placed; a card that does not draw is
 * left out (the pictures stay) and said in the diagnostics.
 */
export const DirectiveCard = z.object({
  template: z.enum(['map', 'bars', 'timeline']),
  hold: z.number().int().min(1).max(8).optional(),
  props: z.record(z.string(), z.unknown())
})
export type DirectiveCard = z.infer<typeof DirectiveCard>
const line = (max: number) => z.string().trim().min(1).max(max)
/** How a found picture is framed (an archive card: a print on a board, a document on graph paper, an old television, a caption box). */
export const DirectiveFrame = z.object({
  frame: z.enum(ARCHIVE_FRAMES),
  label: line(80).optional(),
  sub: line(100).optional(),
  punch: line(50).optional(),
  lines: z.array(line(50)).max(3).optional(),
  excerpt: line(240).optional(),
  mark: line(100).optional(),
  source: line(90).optional(),
  quote: line(240).optional()
})
export type DirectiveFrame = z.infer<typeof DirectiveFrame>

export const Directive = z.strictObject({
  /** The sentence, numbered from 1 in the order of the script. */
  sentence: z.number().int().min(1),
  /** 1 to 6 words copied from the sentence: where the picture lands. */
  anchor: z.string().trim().min(1).max(80),
  kind: DirectiveKind,
  subject: z.string().trim().min(1).max(200),
  /** A generation prompt (clips, stills) or a search query (stock, archives). */
  prompt: z.string().trim().min(1).max(800).optional(),
  query: z.string().trim().min(1).max(80).optional(),
  layout: z.enum(LAYOUTS).optional(),
  /** A short on-screen text (a figure, a name, a place) the narration says. */
  text: z.string().trim().min(1).max(60).optional(),
  /** A `motion.<template>` directive's card (a pipeline with documentary cards). */
  card: DirectiveCard.optional(),
  /** An archive's frame (a pipeline with documentary cards). */
  frame: DirectiveFrame.optional(),
  why: z.string().trim().min(1).max(300)
})
export type Directive = z.infer<typeof Directive>
export const DirectivesValue = z.array(Directive)

/** The timeline's picture kinds: the mix's kinds (a generation list kind maps onto one of them). */
export const TIMELINE_KINDS = ['presenter', 'clipAi', 'imageAi', 'stock', 'archive', 'userFootage'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]
export const TIMELINE_SCHEMA = 'atelier.timeline/1'

const seconds = z.number().min(0)
export const TimelineShot = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(TIMELINE_KINDS),
  layout: z.enum(LAYOUTS).optional(),
  sentence: z.number().int().min(1),
  anchor: z.string().min(1),
  startS: seconds,
  endS: seconds,
  prompt: z.string().optional(),
  query: z.string().optional(),
  style: z.string().optional(),
  people: z.string().optional(),
  /** The generation item that fills it; `beside`: the picture shown beside the presenter of a `split` shot. */
  source: z.strictObject({ item: z.string().min(1), beside: z.string().min(1).optional() }),
  status: z.enum(['planned', 'ready', 'failed']),
  costCredits: z.number().min(0).optional()
})
export type TimelineShot = z.infer<typeof TimelineShot>

export const TimelineOverlay = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['label', 'motion', 'sponsor', 'presenter']),
  layout: z.enum(LAYOUTS).optional(),
  startS: seconds,
  endS: seconds,
  anchor: z.string().optional(),
  text: z.string().optional(),
  source: z.strictObject({ item: z.string().min(1) }).optional()
})
export type TimelineOverlay = z.infer<typeof TimelineOverlay>

export const Timeline = z.strictObject({
  $schema: z.literal(TIMELINE_SCHEMA),
  fps: z.literal(FPS),
  durationS: z.number().positive(),
  shots: z.array(TimelineShot).min(1),
  overlays: z.array(TimelineOverlay),
  chapters: z.array(z.strictObject({ n: z.number().int().min(1), title: z.string().min(1), startS: seconds }))
})
export type Timeline = z.infer<typeof Timeline>

/** The mix kind a generation list kind shows (stock video is stock; a stock photo is an archive still). */
export function timelineKind(k: GenKind | Shot['kind']): TimelineKind {
  if (k === 'avatar') return 'presenter'
  if (k === 'video.gen') return 'clipAi'
  if (k === 'stock.video') return 'stock'
  if (k === 'stock.photo') return 'archive'
  if (k === 'user.footage') return 'userFootage'
  return 'imageAi'
}

const sec = (frame: number): number => Math.round((frame / FPS) * 1000) / 1000

/** Index of the word said at `t` seconds (the last word starting at or before it, the first word before the voice). */
export function wordAt(words: readonly Word[], t: number): number {
  let lo = 0
  let hi = words.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((words[mid] as Word).start <= t + 1e-6) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best
}

/** The first word said from `t` (a cut lands a few frames before its word): 1 to `n` words as written. */
export function wordsFrom(words: readonly Word[], t: number, n = 3): { first: number; text: string } {
  let k = wordAt(words, t)
  if ((words[k] as Word).end <= t + 0.15 && k + 1 < words.length) k++
  const said = words.slice(k, k + n).filter((w) => w.sentence === (words[k] as Word).sentence)
  return { first: k, text: said.map((w) => w.w.replace(/[,;:.!?…»«"]+$/u, '').replace(/^[«"]+/u, '')).filter(Boolean).join(' ') || (words[k] as Word).w }
}

export interface TimelineExtras {
  /** The picture style the shots wear (`phone-real@3`), and who may appear in them (style `people`). */
  style?: string
  people?: string
  /** Sponsor overlays (§2.13), already timed. */
  sponsor?: readonly { startS: number; endS: number; anchor: string }[]
}

/** The editable timeline of a plan (§7.3): base shots in order, then overlays, chapters numbered from 1. */
export function buildTimeline(plan: EditPlan, list: GenList, words: readonly Word[], x: TimelineExtras = {}): Timeline {
  const items = new Map<string, GenItem>(list.items.map((i) => [i.id, i]))
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const priced = new Set<string>()
  const cost = (id: string | undefined): number | undefined => {
    const it = id ? items.get(id) : undefined
    if (!it || priced.has(it.id)) return undefined
    priced.add(it.id)
    return it.unitPrice * it.units
  }
  const shots: TimelineShot[] = []
  for (const id of plan.tracks.base) {
    const s = byId.get(id) as Shot
    const at = wordsFrom(words, s.startFrame / FPS)
    const it = s.genItem ? items.get(s.genItem) : undefined
    const kind = timelineKind(s.kind)
    const c = (cost(s.genItem) ?? 0) + (cost(s.beside?.genItem) ?? 0)
    shots.push({
      id: s.id,
      kind,
      ...(s.kind === 'avatar' ? { layout: s.layout ?? 'full' } : {}),
      sentence: (words[at.first] as Word).sentence + 1,
      anchor: s.anchor ?? at.text,
      startS: sec(s.startFrame),
      endS: sec(s.endFrame),
      ...(it?.prompt && kind !== 'presenter' ? { prompt: it.prompt } : {}),
      ...(it?.query ? { query: it.query } : {}),
      ...(x.style && kind !== 'presenter' ? { style: x.style } : {}),
      ...(x.people && kind !== 'presenter' ? { people: x.people } : {}),
      source: { item: s.genItem ?? s.id, ...(s.beside ? { beside: s.beside.genItem } : {}) },
      status: 'planned',
      ...(c > 0 ? { costCredits: Math.round(c * 100) / 100 } : {})
    })
  }
  const overlays: TimelineOverlay[] = []
  for (const id of [...plan.tracks.overlay, ...plan.tracks.labels]) {
    const s = byId.get(id) as Shot
    const kind = s.kind === 'avatar' ? 'presenter' : s.kind === 'label' ? 'label' : 'motion'
    overlays.push({
      id: s.id,
      kind,
      ...(s.kind === 'avatar' ? { layout: s.layout ?? 'pip' } : {}),
      startS: sec(s.startFrame),
      endS: sec(s.endFrame),
      ...(s.anchor ? { anchor: s.anchor } : {}),
      ...(s.text ? { text: s.text } : {}),
      ...(s.genItem ? { source: { item: s.genItem } } : {})
    })
  }
  ;(x.sponsor ?? []).forEach((o, i) => overlays.push({ id: `sp${i + 1}`, kind: 'sponsor', startS: Math.round(o.startS * FPS) / FPS, endS: Math.round(o.endS * FPS) / FPS, anchor: o.anchor }))
  overlays.sort((a, b) => a.startS - b.startS || (a.id < b.id ? -1 : 1))
  const chapters = plan.chapters.map((c, i) => ({ n: i + 1, title: c.title, startS: sec(c.startFrame) }))
  return { $schema: TIMELINE_SCHEMA, fps: FPS, durationS: sec(plan.frames), shots, overlays, chapters }
}

/** Problems of a timeline against the voice (English): shots in order, no gap, no overlap, on the frame grid, [0, D]. */
export function checkTimelineDoc(tl: Timeline, voiceS: number): string[] {
  const problems: string[] = []
  const r = Timeline.safeParse(tl)
  if (!r.success) return [`timeline: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? 'invalid'}`]
  const onGrid = (t: number): boolean => Math.abs(t * FPS - Math.round(t * FPS)) < 0.05
  if (Math.abs(tl.durationS - voiceS) > 1 / FPS + 1e-6) problems.push(`timeline lasts ${tl.durationS} s, the voice ${voiceS} s`)
  let at = 0
  for (const s of tl.shots) {
    if (!onGrid(s.startS) || !onGrid(s.endS)) problems.push(`shot ${s.id} is off the frame grid`)
    if (Math.abs(s.startS - at) > 1e-3) problems.push(`${s.startS > at ? 'gap' : 'overlap'} before shot ${s.id} (${at} s)`)
    if (s.endS <= s.startS) problems.push(`shot ${s.id} has no length`)
    at = s.endS
  }
  if (Math.abs(at - tl.durationS) > 1e-3) problems.push(`the shots end at ${at} s, not ${tl.durationS} s`)
  for (const o of tl.overlays) if (o.startS < 0 || o.endS > tl.durationS + 1e-3 || o.endS <= o.startS) problems.push(`overlay ${o.id} lies outside the film`)
  return problems
}

/** Small numbers said in words (fr, en): a digit in an anchor matches the spoken word and the other way round. */
const NUMBER_WORDS: Record<string, string> = Object.fromEntries(
  [
    ['zero', 'zéro'], ['one', 'un', 'une'], ['two', 'deux'], ['three', 'trois'], ['four', 'quatre'], ['five', 'cinq'], ['six'], ['seven', 'sept'],
    ['eight', 'huit'], ['nine', 'neuf'], ['ten', 'dix'], ['eleven', 'onze'], ['twelve', 'douze'], ['thirteen', 'treize'], ['fourteen', 'quatorze'],
    ['fifteen', 'quinze'], ['sixteen', 'seize'], ['seventeen', 'dix-sept'], ['eighteen', 'dix-huit'], ['nineteen', 'dix-neuf'], ['twenty', 'vingt'],
    ['thirty', 'trente'], ['forty', 'quarante'], ['fifty', 'cinquante'], ['sixty', 'soixante'], ['hundred', 'cent'], ['thousand', 'mille']
  ].flatMap((names, i) => {
    const n = i <= 20 ? i : i === 21 ? 30 : i === 22 ? 40 : i === 23 ? 50 : i === 24 ? 60 : i === 25 ? 100 : 1000
    return names.map((w) => [normWord(w), String(n)])
  })
)
const said = (w: string): string => {
  const n = normWord(w)
  return NUMBER_WORDS[n] ?? n.replace(/^(?:[ldjmnstc]|qu|jusqu|lorsqu|puisqu)'/u, '')
}

/**
 * Finds an anchor in the words of one sentence (§7.2: fuzzy, numbers in digits or words): the index of its first word, or
 * null. Elisions and accents do not matter; a one-word slip is forgiven in anchors of four words or more.
 */
export function findAnchorWord(words: readonly Word[], sentenceIx: number, anchor: string, from = 0): number | null {
  const want = anchor.split(/\s+/).map(said).filter(Boolean)
  if (want.length === 0) return null
  const idx: number[] = []
  for (let k = from; k < words.length; k++) {
    const w = words[k] as Word
    if (w.sentence === sentenceIx) idx.push(k)
    else if (w.sentence > sentenceIx) break
  }
  const said2 = idx.map((k) => said((words[k] as Word).w))
  let best: { at: number; miss: number } | null = null
  for (let i = 0; i + want.length <= said2.length; i++) {
    let miss = 0
    for (let j = 0; j < want.length && miss <= 1; j++) if (said2[i + j] !== want[j]) miss++
    if (miss === 0) return idx[i] as number
    if (miss === 1 && want.length >= 4 && said2[i] === want[0] && (!best || miss < best.miss)) best = { at: idx[i] as number, miss }
  }
  return best?.at ?? null
}
