// The documentary cards of the mix director (style-markets, formats/cards.ts, research note style-markets-of-the-past-2026-11 (old repository)). After
// the pictures are cut on their words (director-mix.ts `fillTrack`), two passes turn some of them into cards drawn by `motion.render`:
//   1. framed archives: a picture whose directive asked for a frame (a print on a board, a document on graph paper with its quoted line
//      marked, a caption box, an old television, a word punch) becomes an `archive` card around that same picture (its item is kept);
//   2. maps, data cards, timelines: a `motion.<template>` directive becomes a card from its anchor to the end of its sentence (`hold`
//      sentences), within the template's limits, replacing the pictures under it; its parts land on their own words (`on` → `atS`).
// The cards share the mix's `motion` budget (screen time); one that does not draw is left out with its reason, the pictures stay. Pure.
import { CARD_SECONDS, DOC_PALETTE, type CardTemplate } from '../formats/cards'
import { type Directive, type DirectiveFrame, findAnchorWord } from '../formats/directives'
import type { GenItem, Shot } from '../formats/editplan'
import { MotionSpec, checkMotion } from '../formats/motion'
import { FPS, type Beat, type Word } from '../formats/timing'
import { normWord } from '../text/script'
import type { Part } from './director-screen'

export interface CardsInput {
  shots: Shot[]
  items: GenItem[]
  /** The pictures whose directive asked for a frame, by shot id. */
  framed: ReadonlyMap<string, DirectiveFrame>
  directives: readonly Directive[]
  words: readonly Word[]
  /** Sentence n (from 1): its first and last word, its start and end (seconds). */
  sentences: readonly { n: number; first: number; last: number; start: number; end: number }[]
  beats: readonly Beat[]
  parts: readonly Part[]
  D: number
  /** The cards' motion-design style: `dark` (the reference's dark grid and satellite map) or `light` (« parchemin »). */
  theme?: 'dark' | 'light'
}
export interface CardsResult {
  shots: Shot[]
  items: GenItem[]
  diagnostics: string[]
}

/** A part of a card shorter than this after a cut is given to the card (no flash of a picture). */
const MIN_REST_S = 1
/** The card budget may run over the mix's share by this much (cards are held while their subject lasts). */
const BUDGET_SLACK = 1.25
/** How many sentences a card holds when the directive does not say (the reference holds maps and data cards while they build). */
const HOLD: Record<Exclude<CardTemplate, 'archive' | 'prints' | 'pov' | 'studio'>, number> = { map: 2, bars: 2, timeline: 3, document: 3, chart: 2, map3d: 2 }
const cut = (s: string | undefined, max: number): string | undefined => {
  const t = s?.trim()
  return t ? (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t) : undefined
}
const said = (w: string): string => normWord(w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))

/** The word index where `on` (1–4 words) is said between words `a` and `b`, or null. */
export function wordOn(words: readonly Word[], a: number, b: number, on: string): number | null {
  const want = on.split(/\s+/).map(said).filter(Boolean)
  if (want.length === 0) return null
  for (let k = a; k + want.length - 1 <= b; k++) {
    if (want.every((w, j) => said((words[k + j] as Word).w) === w)) return k
  }
  // a number said in words or written differently: the first word alone
  for (let k = a; k <= b; k++) if (said((words[k] as Word).w) === want[0]) return k
  return null
}

/** The props of an archive card from a directive's frame (texts cut to the template's limits; a mark not in the excerpt is dropped). */
export function archiveProps(f: DirectiveFrame, move: Shot['motion']): Record<string, unknown> {
  const excerpt = cut(f.excerpt, 200)
  const mark = cut(f.mark, 80)
  return {
    frame: f.frame,
    ...(cut(f.label, 60) ? { label: cut(f.label, 60) } : {}),
    ...(cut(f.sub, 80) ? { sub: cut(f.sub, 80) } : {}),
    ...(cut(f.punch, 40) ? { punch: (cut(f.punch, 40) as string).toUpperCase() } : {}),
    ...(f.lines && f.lines.length > 0 ? { lines: f.lines.slice(0, 3).map((l) => cut(l, 40) as string) } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(excerpt && mark && excerpt.includes(mark) ? { mark } : {}),
    ...(cut(f.source, 70) ? { source: cut(f.source, 70) } : {}),
    ...(cut(f.quote, 200) ? { quote: cut(f.quote, 200) } : {}),
    move: move?.kind ?? 'push'
  }
}

/** `on` → `atS` in every part list of a card's props (seconds from the card's start); a part whose words are not found keeps no time. */
function timeParts(props: Record<string, unknown>, words: readonly Word[], a: number, b: number, startS: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props }
  for (const key of ['regions', 'pins', 'routes', 'rows', 'events']) {
    const list = out[key]
    if (!Array.isArray(list)) continue
    out[key] = list.map((x: unknown) => {
      if (typeof x !== 'object' || x === null) return x
      const { on, ...rest } = x as Record<string, unknown>
      const k = typeof on === 'string' ? wordOn(words, a, b, on) : null
      return k === null ? rest : { ...rest, atS: Math.max(0.3, Math.round(((words[k] as Word).start - startS) * 100) / 100) }
    })
  }
  return out
}

/** The same props with no `atS` in their part lists. */
const withoutTimes = (props: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(props).map(([key, v]) => [key, Array.isArray(v) ? v.map((x: unknown) => (typeof x === 'object' && x !== null ? Object.fromEntries(Object.entries(x).filter(([kk]) => kk !== 'atS')) : x)) : v])
  )



export function placeCards(o: CardsInput): CardsResult {
  const spec = (template: CardTemplate, props: Record<string, unknown>): unknown => ({ template, props, accent: DOC_PALETTE.red, theme: o.theme ?? 'dark' })
  const diag: string[] = []
  let shots = o.shots.map((s) => ({ ...s }))
  const beatAt = (t: number): number => (o.beats.find((b) => t + 9 / FPS >= b.start && t + 9 / FPS < b.end) ?? o.beats.at(-1))?.i ?? 0

  // 1. framed archives: the shot keeps its picture, the card frames it
  let framed = 0
  for (const s of shots) {
    const f = o.framed.get(s.id)
    if (!f || s.track !== 'base') continue
    const seconds = (s.endFrame - s.startFrame) / FPS
    if (f.frame === 'full' && !f.label && !f.punch && !(f.lines && f.lines.length > 0)) continue
    if (seconds < CARD_SECONDS.archive.min || seconds > CARD_SECONDS.archive.max) continue
    const graphic = spec('archive', archiveProps(f, s.motion))
    if (checkMotion(graphic, seconds).length > 0 || !MotionSpec.safeParse(graphic).success) continue
    s.kind = 'motion'
    s.graphic = graphic as Shot['graphic']
    delete s.motion
    framed++
  }

  // 2. maps, data cards, timelines, within the mix's motion budget
  const budget = o.parts.reduce((n, p) => n + (p.toS - p.fromS) * (p.shares.motion ?? 0), 0) * BUDGET_SLACK
  let used = 0
  const placed: { a: number; b: number }[] = []
  let n = 0
  for (const d of o.directives) {
    if (!d.card || !d.kind.startsWith('motion.')) continue
    const template = d.card.template
    const s = o.sentences[d.sentence - 1]
    if (!s) continue
    const k = findAnchorWord(o.words, (o.words[s.first] as Word).sentence, d.anchor, s.first)
    if (k === null) {
      diag.push(`card ${template} on sentence ${d.sentence}: its anchor is not in the words, left out`)
      continue
    }
    const lastSentence = o.sentences[Math.min(o.sentences.length, d.sentence + (d.card.hold ?? HOLD[template]) - 1) - 1] ?? s
    const lim = CARD_SECONDS[template]
    const a = Math.round(Math.max(0, (o.words[k] as Word).start - 3 / FPS) * FPS) / FPS
    let b = Math.min(o.D, Math.max(lastSentence.end, a + lim.min), a + lim.max)
    b = Math.round(b * FPS) / FPS
    if (b - a < lim.min - 1e-6) continue
    if (placed.some((x) => a < x.b + 2 && b > x.a - 2)) {
      diag.push(`card ${template} on sentence ${d.sentence}: too close to another card, left out`)
      continue
    }
    if (used + (b - a) > budget + 1e-6) {
      diag.push(`card ${template} on sentence ${d.sentence}: over the cards' share (${Math.round(budget)} s), left out`)
      continue
    }
    const props = timeParts(d.card.props, o.words, k, lastSentence.last, a)
    let graphic = spec(template, props)
    let problems = checkMotion(graphic, b - a)
    if (problems.length > 0) {
      // times that land too late are dropped (the parts then appear in order), never the card for that alone
      graphic = spec(template, withoutTimes(props))
      problems = checkMotion(graphic, b - a)
    }
    if (problems.length > 0) {
      diag.push(`card ${template} on sentence ${d.sentence} left out: ${problems.slice(0, 2).join('; ')}`)
      continue
    }
    // the card takes [a, b): pictures inside go, pictures across its edges are trimmed (a sliver under a second goes to the card)
    let fa = Math.round(a * FPS)
    let fb = Math.round(b * FPS)
    for (const x of shots) {
      if (x.track !== 'base') continue
      if (x.startFrame < fa && x.endFrame > fa && fa - x.startFrame < MIN_REST_S * FPS) fa = x.startFrame
      if (x.startFrame < fb && x.endFrame > fb && x.endFrame - fb < MIN_REST_S * FPS) fb = x.endFrame
    }
    if (shots.some((x) => x.track === 'base' && x.kind === 'avatar' && x.startFrame < fb && x.endFrame > fa)) {
      diag.push(`card ${template} on sentence ${d.sentence}: over the presenter, left out`)
      continue
    }
    const kept: Shot[] = []
    for (const x of shots) {
      if (x.track !== 'base' || x.endFrame <= fa || x.startFrame >= fb) kept.push(x)
      else if (x.startFrame < fa) kept.push({ ...x, endFrame: fa })
      else if (x.endFrame > fb) kept.push({ ...x, startFrame: fb, transitionIn: 'dissolve' })
    }
    // the reference leaves a card by a cross-fade into the next picture
    for (const [i, x] of kept.entries()) if (x.track === 'base' && x.startFrame === fb) kept[i] = { ...x, transitionIn: 'dissolve' }
    const id = `c${String(++n).padStart(3, '0')}`
    kept.push({ id, track: 'base', startFrame: fa, endFrame: fb, kind: 'motion', graphic: graphic as Shot['graphic'], transitionIn: 'dissolve', role: 'scene', beat: beatAt(fa / FPS), anchor: d.anchor })
    shots = kept.sort((x, y) => x.startFrame - y.startFrame || (x.track === 'base' ? -1 : 1))
    placed.push({ a: fa / FPS, b: fb / FPS })
    used += (fb - fa) / FPS
  }
  // the items no shot shows any more (their pictures went under a card)
  const shown = new Set(shots.flatMap((s) => [s.genItem, s.beside?.genItem, ...(s.alsoItems ?? [])].filter((x): x is string => x !== undefined)))
  const items = o.items.map((it) => ({ ...it, shotIds: it.shotIds.filter((id) => shots.some((s) => s.id === id)) })).filter((it) => shown.has(it.id) && it.shotIds.length > 0)
  for (const it of items) {
    const s = shots.find((x) => x.id === it.shotIds[0])
    if (s) it.constraints = { ...it.constraints, durationS: Math.round(((s.endFrame - s.startFrame) / FPS) * 1000) / 1000 }
  }
  if (framed > 0 || placed.length > 0) diag.push(`cards: ${placed.length} map/data/timeline card(s), ${Math.round(used)} s of ${Math.round(budget / BUDGET_SLACK)} s; ${framed} framed archive(s)`)
  return { shots, items, diagnostics: diag }
}
