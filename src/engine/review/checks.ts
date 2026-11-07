// The edit review's checks on the plan (qualite-montage): what the plan itself says is wrong, shot by shot against the words and their
// times. Pure: the render passes what it knows of each shot (its film's length, whether it is a drawn card, what its picture looks like).
// Thresholds are a setting (`ReviewLimits`), measured on Charlie's second review of the Markets clone: a picture held still 5 s, a hook
// whose first non-film shot lasts more than 4.5 s, the same picture again within a minute, a text more than 1.2 s from its word.
import { spokenNumbers } from '../edit/numbers'
import { digitsOf } from '../nodes/doc2-figures'
import type { EditPlan, Shot } from '../formats/editplan'
import { FPS, type Word } from '../formats/timing'
import { likeness } from '../nodes/visuals-checks'
import { MAX_SLOWDOWN } from '../render/segments'
import { fmtS, type Defect, type Patch } from './types'

export interface ReviewLimits {
  /** A picture with nothing moving this long is held too long. */
  holdMaxS: number
  /** The hook: its first seconds, the longest a non-film shot may stay in them. */
  hookS: number
  hookShotMaxS: number
  /** Two pictures alike within this many seconds are a duplicate. */
  duplicateWindowS: number
  /** Grey thumbnails at least this alike are the same picture. */
  duplicateLikeness: number
  /** A text further than this from its word is late (or early). */
  textLateS: number
  /** A drop gives its time to a neighbour only up to this many seconds. */
  absorbMaxS: number
  /** No shot grows past this by taking a dropped one's time (in the hook: `hookShotMaxS`). */
  growMaxS: number
  /** The slow camera given to a held picture (zoom at its end). */
  holdZoom: number
}

export const REVIEW_LIMITS: ReviewLimits = {
  holdMaxS: 5,
  hookS: 12,
  hookShotMaxS: 4.5,
  duplicateWindowS: 60,
  duplicateLikeness: 0.9,
  textLateS: 1.2,
  absorbMaxS: 6,
  growMaxS: 6.5,
  // the measured zoom of the reference's stills (9 % over the shot): a slower one reads as frozen
  holdZoom: 1.09
}

/** What the render knows of one base shot. */
export interface SeenShot {
  id: string
  /** Hash of the file it shows (its clip or picture). */
  source: string
  /** 32×18 grey thumbnail of its picture, when it has a real one. */
  grey?: readonly number[]
  /** Shots of one clip share this (one continuing action). */
  group?: string
}

export interface PlanReviewInput {
  plan: EditPlan
  words: readonly Word[]
  /** The video's language, from its words (`languageOf`). */
  language: 'en' | 'fr' | string
  /** An archive or generated film's length (seconds), when the shot plays one. */
  clipS: (s: Shot) => number | undefined
  /** The shot is a drawn card with its own file. */
  isCard: (s: Shot) => boolean
  seen: readonly SeenShot[]
  limits?: Partial<ReviewLimits>
}

type Graphic = { template?: string; props?: Record<string, unknown> }
const graphicOf = (s: Shot): Graphic => (s.graphic ?? {}) as Graphic
const secs = (s: Shot): number => (s.endFrame - s.startFrame) / FPS
const startS = (s: Shot): number => s.startFrame / FPS
const endS = (s: Shot): number => s.endFrame / FPS
const r2 = (x: number): number => Math.round(x * 100) / 100

/** The words said between a and b (seconds). */
export function saidBetween(words: readonly Word[], a: number, b: number): string {
  return words
    .filter((w) => w.start < b - 0.05 && w.end > a + 0.05)
    .map((w) => w.w)
    .join(' ')
}

const EN = new Set(['the', 'of', 'and', 'to', 'in', 'was', 'is', 'it', 'that', 'his', 'with', 'by', 'for', 'on', 'were', 'had'])
const FR = new Set(['le', 'la', 'les', 'des', 'du', 'de', 'et', 'est', 'un', 'une', 'dans', 'pour', 'au', 'aux', 'sur', 'qui', 'que', 'il'])
const tokens = (t: string): string[] => t.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)

/** The language of the words (English or French by their small words); `fallback` when they say too little. */
export function languageOf(words: readonly Word[], fallback = 'en'): string {
  let en = 0
  let fr = 0
  for (const w of words) for (const t of tokens(w.w)) {
    if (EN.has(t)) en++
    if (FR.has(t)) fr++
  }
  if (en + fr < 8) return fallback
  return en >= fr ? 'en' : 'fr'
}

/** A text written in the other language (small words of the other one, none of its own). */
export function wrongLanguage(text: string, language: string): boolean {
  const t = tokens(text)
  if (language === 'en') return t.some((x) => FR.has(x) && !EN.has(x)) && !t.some((x) => EN.has(x) && !FR.has(x))
  if (language === 'fr') return t.some((x) => EN.has(x) && !FR.has(x)) && !t.some((x) => FR.has(x) && !EN.has(x))
  return false
}

/** A date written as a phrase cut from the sentence (« the spring of 1940 », « By the end of 1942 ») instead of a date (« Spring 1940 »). */
export function badDateForm(text: string): boolean {
  const t = text.trim()
  return /^\p{Ll}/u.test(t) || /^(the|by|in|on|at|from|until|during|since|after|before|le|la|les|en|au|aux|dès|depuis|vers)\b/i.test(t)
}

/** The figures written in a text (« 1942 », « 12 », « 4,200,000 » → 4200000). */
export function figuresOf(text: string): number[] {
  return [...text.matchAll(/\d[\d,.\u202f ]*\d|\d/g)].map((m) => Number(m[0].replace(/[,\u202f ]/g, ''))).filter((n) => Number.isFinite(n))
}

/** One text the film shows: what it says, when (film seconds), its kind, the shot carrying it and whether that shot is only text. */
interface ShownText {
  text: string
  kind: string
  atS: number
  shot: Shot
  overlay: boolean
}

function textsOf(plan: EditPlan): ShownText[] {
  const out: ShownText[] = []
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const push = (shot: Shot, overlay: boolean, kind: string, text: unknown, at: unknown): void => {
    if (typeof text !== 'string' || !text.trim()) return
    out.push({ text, kind, atS: startS(shot) + (typeof at === 'number' ? at : 0), shot, overlay })
  }
  for (const id of [...plan.tracks.base, ...plan.tracks.overlay]) {
    const s = byId.get(id)
    if (!s || s.kind !== 'motion') continue
    const g = graphicOf(s)
    const p = g.props ?? {}
    const overlay = s.track === 'overlay'
    if (g.template === 'doc-tags' && Array.isArray(p.tags)) for (const t of p.tags as Record<string, unknown>[]) push(s, overlay, String(t.kind ?? 'tag'), t.text, t.atS)
    if (g.template === 'prints') {
      const date = p.date as Record<string, unknown> | undefined
      if (date) push(s, overlay, 'date', date.text, date.atS)
      if (Array.isArray(p.side)) for (const t of p.side as Record<string, unknown>[]) push(s, overlay, String(t.kind ?? 'tag'), t.text, t.atS)
    }
  }
  return out
}

/** Can `n` take `extra` frames more without freezing (a card holds its end, a still keeps its camera, a film needs its length)? */
function canAbsorb(n: Shot | undefined, extra: number, o: PlanReviewInput, L: ReviewLimits): boolean {
  if (!n || n.kind === 'avatar') return false
  if (extra / FPS > L.absorbMaxS) return false
  // a shot never grows into a long hold (Charlie: an image that stays too long), the hook's even less
  const grown = secs(n) + extra / FPS
  const clip = o.isCard(n) ? undefined : o.clipS(n)
  // an archive film moves by itself: it may run a little longer than a picture (its clip permitting, below)
  const cap = startS(n) < L.hookS ? L.hookShotMaxS : clip !== undefined ? L.growMaxS + 1 : L.growMaxS
  if (grown > cap + 1e-6) return false
  if (clip !== undefined) return (secs(n) + extra / FPS) <= clip * MAX_SLOWDOWN + 0.05
  return true
}

/** A drop of `s`: its frames to the previous shot when it can take them, else the next one; none when neither can. */
function dropOf(base: readonly Shot[], i: number, o: PlanReviewInput, L: ReviewLimits, avoid: ReadonlySet<string> = new Set()): Patch | undefined {
  const s = base[i] as Shot
  const extra = s.endFrame - s.startFrame
  const prev = base[i - 1]
  const next = base[i + 1]
  const okPrev = prev !== undefined && !avoid.has(prev.id)
  const okNext = next !== undefined && !avoid.has(next.id)
  if (okPrev && canAbsorb(prev, extra, o, L)) return { op: 'drop', shotId: s.id, into: prev.id }
  if (okNext && canAbsorb(next, extra, o, L)) return { op: 'drop', shotId: s.id, into: next.id }
  // shared: the first half to the previous shot, the second to the next
  const half = Math.round(extra / 2)
  if (okPrev && okNext && canAbsorb(prev, half, o, L) && canAbsorb(next, extra - half, o, L)) return { op: 'drop', shotId: s.id, into: prev.id, and: next.id }
  return undefined
}

/** The defects the plan shows, with the fix the render can make when there is one. */
export function reviewPlan(o: PlanReviewInput): Defect[] {
  const L = { ...REVIEW_LIMITS, ...o.limits }
  const { plan, words } = o
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const base = plan.tracks.base.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined)
  const out: Defect[] = []
  const said = (a: number, b: number): string => saidBetween(words, a, b)
  const at = (s: Shot): Pick<Defect, 'atS' | 'endS' | 'shotId' | 'said'> => ({ atS: r2(startS(s)), endS: r2(endS(s)), shotId: s.id, said: said(startS(s), endS(s)) })

  for (const [i, s] of base.entries()) {
    const d = secs(s)
    const g = graphicOf(s)
    const p = g.props ?? {}
    const card = s.kind === 'motion'
    const clip = o.isCard(s) ? undefined : o.clipS(s)
    // a film shorter than its shot: the last frame stays (the slow-down covers 30 % at most)
    if (clip !== undefined && !card && clip * MAX_SLOWDOWN < d - 0.15) {
      const toFrame = s.startFrame + Math.max(FPS, Math.floor(clip * MAX_SLOWDOWN * FPS))
      const next = base[i + 1]
      const fix: Patch | undefined = next && canAbsorb(next, s.endFrame - toFrame, o, L) ? { op: 'shift', shotId: s.id, toFrame } : dropOf(base, i, o, L)
      out.push({ kind: 'film_short', severity: 'fail', ...at(s), detail: `Le film de ${fmtS(startS(s))} dure ${clip.toFixed(1)} s pour un plan de ${d.toFixed(1)} s : sa dernière image reste figée.`, ...(fix ? { fix } : {}) })
    }
    // a picture or a board that does not move
    const stillPicture = (s.kind === 'stock.photo' || s.kind === 'image.gen') && (!s.motion || (s.motion.from === s.motion.to && s.motion.kind !== 'pan'))
    const stillBoard = card && g.template === 'prints' && (p.move === undefined || p.move === 'still') && !s.motion
    let mapStill = 0
    if (card && g.template === 'map3d' && !s.motion) {
      const keys = ((p.camera as { keys?: { atS: number }[] } | undefined)?.keys ?? []).map((k) => k.atS)
      mapStill = d - Math.max(0, ...keys)
    }
    if ((stillPicture || stillBoard) && d >= L.holdMaxS) {
      out.push({ kind: 'held', severity: 'fail', ...at(s), detail: `${d.toFixed(1)} s sans mouvement à ${fmtS(startS(s))} (${stillBoard ? 'planche' : 'image'} immobile).`, fix: { op: 'move', shotId: s.id, zoom: L.holdZoom } })
    } else if (mapStill >= L.holdMaxS - 1) {
      out.push({ kind: 'held', severity: 'fail', ...at(s), detail: `La carte de ${fmtS(startS(s))} s’arrête ${mapStill.toFixed(1)} s avant la fin du plan.`, fix: { op: 'move', shotId: s.id, zoom: 1.04 } })
    }
    // the hook: a non-film shot that lasts
    if (startS(s) < L.hookS && clip === undefined && d > L.hookShotMaxS + 0.05) {
      out.push({ kind: 'hook_slow', severity: 'fail', ...at(s), detail: `L’accroche attend : un plan fixe de ${d.toFixed(1)} s à ${fmtS(startS(s))} (au plus ${L.hookShotMaxS} s dans les ${L.hookS} premières secondes).`, ...(stillBoard || stillPicture ? { fix: { op: 'move', shotId: s.id, zoom: L.holdZoom } } : {}) })
    }
    // a map that shades lands without saying whose they are
    if (card && g.template === 'map3d') {
      const regions = (p.regions as { label?: string }[] | undefined) ?? []
      const names = (p.names as unknown[] | undefined) ?? []
      if (regions.length > 0 && !regions.some((r) => r.label) && names.length === 0) {
        out.push({ kind: 'map_legend', severity: 'fail', ...at(s), detail: `La carte « ${String(p.title ?? '')} » colore ${regions.length} zone(s) sans dire à qui elles sont.` })
      }
    }
  }

  // the same picture again within a minute (two shots of one continuing clip side by side are one action: only said past the first)
  const seen = new Map(o.seen.map((x) => [x.id, x]))
  const dropped = new Set<string>()
  for (const [i, s] of base.entries()) {
    const me = seen.get(s.id)
    if (!me || s.kind === 'avatar') continue
    for (let j = i - 1; j >= 0; j--) {
      const other = base[j] as Shot
      if (startS(s) - endS(other) > L.duplicateWindowS) break
      const them = seen.get(other.id)
      if (!them || dropped.has(other.id)) continue
      const sameGroup = me.group !== undefined && me.group === them.group && j === i - 1
      const same = me.source === them.source || (me.grey && them.grey ? likeness(me.grey, them.grey) >= L.duplicateLikeness : false)
      if (!same || sameGroup) continue
      const fix = dropOf(base, i, o, L, dropped)
      if (fix) dropped.add(s.id)
      out.push({ kind: 'duplicate', severity: 'fail', ...at(s), detail: `La même image qu’à ${fmtS(startS(other))} revient à ${fmtS(startS(s))}.`, ...(fix ? { fix } : {}) })
      break
    }
  }

  // the texts: written as a date, said near their time, in the video's language
  const numbers = spokenNumbers(words, o.language === 'fr' ? 'fr' : 'en')
  for (const t of textsOf(plan)) {
    const where = { atS: r2(t.atS), endS: r2(endS(t.shot)), shotId: t.shot.id, said: said(startS(t.shot), endS(t.shot)) }
    const fix: Patch | undefined = t.overlay ? { op: 'drop_overlay', shotId: t.shot.id } : undefined
    if (t.kind === 'date' && badDateForm(t.text)) {
      out.push({ kind: 'text_form', severity: 'fail', ...where, detail: `La date « ${t.text} » à ${fmtS(t.atS)} est un bout de phrase, pas une date (« Spring 1940 », « End of 1942 »).` })
    }
    if (wrongLanguage(t.text, o.language)) out.push({ kind: 'text_language', severity: 'fail', ...where, detail: `Le texte « ${t.text} » à ${fmtS(t.atS)} n’est pas dans la langue de la vidéo (${o.language}).`, ...(fix ? { fix } : {}) })
    for (const f of figuresOf(t.text)) {
      const near = numbers.filter((n) => n.value === f && Math.abs(n.atS - t.atS) <= 6)
      // digits, or a number said in words (« Four », « a dozen »)
      const inWords = words.filter((w, k) => {
        if (w.start < startS(t.shot) - 6 || w.start > endS(t.shot) + 2) return false
        if (figuresOf(w.w).includes(f)) return true
        const bare = (x: Word | undefined): string => (x?.w ?? '').replace(/[^\p{L}\p{N}-]/gu, '')
        return [bare(w), `${bare(words[k - 1])} ${bare(w)}`].some((x) => digitsOf(x, o.language === 'fr' ? 'fr' : 'en') === String(f))
      })
      const times = [...near.map((n) => n.atS), ...inWords.map((w) => w.start)]
      if (times.length === 0) {
        out.push({ kind: 'text_unsaid', severity: 'fail', ...where, detail: `« ${t.text} » à ${fmtS(t.atS)} : la voix ne dit pas ${f} à ce moment.`, ...(fix ? { fix } : {}) })
        continue
      }
      const gap = Math.min(...times.map((x) => Math.abs(x - t.atS)))
      if (gap > L.textLateS) out.push({ kind: 'text_late', severity: 'warn', ...where, detail: `« ${t.text} » arrive à ${fmtS(t.atS)}, ${gap.toFixed(1)} s loin du mot dit.` })
    }
  }
  return out
}

/** The drop that removes `shotId` (its time to a neighbour that can take it), for a defect found elsewhere (an off-subject picture). */
export function dropFix(o: PlanReviewInput, shotId: string, avoid: ReadonlySet<string> = new Set()): Patch | undefined {
  const L = { ...REVIEW_LIMITS, ...o.limits }
  const byId = new Map(o.plan.shots.map((s) => [s.id, s]))
  const base = o.plan.tracks.base.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined)
  const i = base.findIndex((s) => s.id === shotId)
  return i < 0 ? undefined : dropOf(base, i, o, L, avoid)
}
