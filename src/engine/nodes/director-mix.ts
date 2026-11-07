// The director that follows the pipeline's mix and curve (docs/specs/production-model.md §6.2, §7; pipeline-avatar.md
// §2.4, §4; decision 0022). Pure and deterministic: same inputs, same track.
//   1. The mix is fitted to the video's length (`curveRows`): one row of target screen-time shares per part of the video.
//   2. The presenter is placed by code first (`placePresenter`): it opens the video, then takes a sentence's opening words
//      (`short`: one shot per sentence or two, 2–6 s) or longer stretches (`stretches`, the channel's measured length),
//      whenever the part's presenter share is behind; never under `minShotS`.
//   3. The pictures fill the rest (`fillPictures`): each shot starts on a directive's anchor when one is close, takes the
//      directive's kind when the part's budget allows it, else the kind furthest behind its share; lengths per kind
//      (`shotLengthS`), cuts only before a word. A directive serves one picture: within REPEAT_WINDOW_S no two pictures show
//      the same subject (avatar-qualite); a shot left without a fresh directive takes another angle on its sentence's words.
// The LLM never gives a time: its directives (formats/directives.ts) only say what to show on which words.
import { findAnchorWord, wordsFrom, type Directive, type DirectiveFrame, type Layout } from '../formats/directives'
import type { GenItem, GenKind, Motion, Shot } from '../formats/editplan'
import { FPS, type Aspect, type Beat, type Word } from '../formats/timing'
import { STOP_WORDS, bareWord, keyTerms, normWord } from '../text/script'
import { triggerOf } from './director-layout-rules'
import { needsMotion } from './director-needs-motion'
import { asFakeDirective, isFakeDirective } from './director-scenes'
import { FACETS, facetDirective, sameScene } from './director-variety'
import { PICTURE_KINDS, SHOT_LENGTHS, paceAt, plannedLayouts, promptRules, type PaceRows, type Part, type PictureKind, type ScreenParams } from './director-screen'

export { PICTURE_KINDS, SHOT_LENGTHS, ScreenParams, directorMix, partsOf, promptRules, screenRows, sharesByPart, type Part, type PictureKind } from './director-screen'
type ScreenKind = 'presenter' | PictureKind

/** Cuts land 3 frames before their word (R21.2); the presenter's too, so its mouth never starts late. */
const LEAD = 3 / FPS
const snap = (t: number): number => Math.round(t * FPS) / FPS

export interface Sentence {
  /** Numbered from 1, the way the scene pass and the directives count. */
  n: number
  first: number
  last: number
  start: number
  end: number
  text: string
}
export interface Slot {
  start: number
  end: number
  sentence: number
  /** Ends on a clause the picture after it names (the opening): the curve's tuning never moves it. */
  fixed?: boolean
}
interface Cut {
  t: number
  word: number
  sentenceStart: boolean
}

/** Verbs that only carry another (« vous avez repeint », « je vais vous montrer »): no picture starts on them. */
const AUXILIARIES = new Set('ai as avez avons avait aviez avaient va vais vont allez allons fait faites peut peuvent doit doivent'.split(' '))
/** The function words, accents off like `normWord` (« même » is « meme » there). */
const FUNCTION_WORDS = new Set([...STOP_WORDS, ...AUXILIARIES].map(normWord))

/**
 * The word a directive's picture starts on (avatar-qualite part 4, Charlie: « l'image doit tomber sur le mot lui-même »): the
 * first word of its anchor that carries meaning, never a function word before it (« avec » before « un spray », « même »
 * before « repeint »). The references cut at most ~0.1 s before the word that names the picture (median of 329 cuts: the
 * first content word 0.10–0.14 s after the cut, often an article between).
 */
export function contentWordOf(words: readonly Word[], k: number, anchor: string, subject = ''): number {
  const n = Math.max(1, anchor.split(/\s+/).filter(Boolean).length)
  const bare = (j: number): string => normWord(bareWord((words[j] as Word).w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')))
  // the word that names the picture: the first one of its sentence, from the anchor on, sharing a stem with its subject
  // (« frotté avec un spray » for « main qui pulvérise le spray » lands on « spray »)
  const stems = new Set(subject.split(/[^\p{L}\p{N}']+/u).map((w) => normWord(bareWord(w))).filter((w) => w.length >= 4 && !FUNCTION_WORDS.has(w)).map((w) => w.slice(0, 5)))
  const sentence = (words[k] as Word | undefined)?.sentence
  for (let j = k; j < Math.min(words.length, k + 12) && (words[j] as Word).sentence === sentence; j++) {
    const w = bare(j)
    if (w.length >= 4 && stems.has(w.slice(0, 5))) return j
  }
  for (let j = k; j < Math.min(words.length, k + n); j++) {
    const w = bare(j)
    if (w.length > 1 && !FUNCTION_WORDS.has(w)) return j
  }
  return k
}

/** The cut time before word `k` (0 for the first word). */
export const cutBefore = (words: readonly Word[], k: number): number => (k <= 0 ? 0 : snap(Math.max(0, (words[k] as Word).start - LEAD)))

/** The sentences of the voice, tiling [0, D]: each starts on its first word's cut and ends where the next starts. */
export function sentencesOf(words: readonly Word[], D: number): Sentence[] {
  const out: Sentence[] = []
  words.forEach((w, k) => {
    const cur = out.at(-1)
    if (cur && (words[cur.last] as Word).sentence === w.sentence) {
      cur.last = k
      cur.text += ` ${w.w}`
    } else out.push({ n: out.length + 1, first: k, last: k, start: cutBefore(words, k), end: D, text: w.w })
  })
  out.forEach((s, i) => (s.end = out[i + 1]?.start ?? D))
  return out
}

const partIx = (parts: readonly Part[], t: number): number => {
  for (let i = parts.length - 1; i >= 0; i--) if (t >= (parts[i] as Part).fromS - 1e-9) return i
  return 0
}
const overlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c))

function cutsOf(words: readonly Word[]): Cut[] {
  const out: Cut[] = []
  for (let k = 1; k < words.length; k++) {
    const t = cutBefore(words, k)
    if (out.at(-1) && Math.abs((out.at(-1) as Cut).t - t) < 1e-9) continue
    out.push({ t, word: k, sentenceStart: (words[k] as Word).sentence !== (words[k - 1] as Word).sentence })
  }
  return out
}

/** The allowed cut closest to `want` in [lo, hi]; a sentence start or an anchor counts as `bonus` seconds closer. */
function bestCut(cuts: readonly Cut[], lo: number, hi: number, want: number, anchors?: ReadonlySet<number>): number | null {
  let best: number | null = null
  let score = Infinity
  for (const c of cuts) {
    if (c.t < lo - 1e-9) continue
    if (c.t > hi + 1e-9) break
    // a new sentence is where a new picture belongs (the references cut there: a shot is about one sentence, 11 words)
    const s = Math.abs(c.t - want) - (anchors?.has(c.t) ? 1.2 : 0) - (c.sentenceStart ? 1 : 0)
    if (s < score) {
      score = s
      best = c.t
    }
  }
  return best
}

export interface PresenterCfg {
  placement: 'short' | 'stretches'
  lengthS: number
  stretchS?: number
  minShotS: number
  /** Talk or show per sentence (director-talk.ts): the presenter goes to the talk sentences first, and ends on sentence ends. */
  roles?: ReadonlyMap<number, 'talk' | 'show'>
  /** The pipeline's longest run of presenter shots back to back (`presenterRunMaxS`); unset: no limit, one shot up to 6 s. */
  runMaxS?: number
}

/**
 * Where the presenter's opening ends when the first sentence names something: after its first clauses (a comma), at least
 * `minL` in and before its last clause, so the clause that names the thing is the picture's. Null: no such comma.
 */
export function openingClauseEnd(words: readonly Word[], s: Sentence, minL: number): number | null {
  for (let k = s.first; k < s.last; k++) {
    if (!/[,;:]$/.test((words[k] as Word).w)) continue
    const end = cutBefore(words, k + 1)
    if (end - s.start >= minL - 1e-9 && s.end - end >= minL - 1e-9) return end
  }
  return null
}

/** The presenter's shots (§2.4 step 1): the opening, then a sentence's start whenever its part's share is behind. */
export function placePresenter(words: readonly Word[], sentences: readonly Sentence[], parts: readonly Part[], D: number, cfg: PresenterCfg, diag: string[]): Slot[] {
  const cuts = cutsOf(words)
  let placement = cfg.placement
  if (placement === 'stretches' && cfg.stretchS === undefined) {
    diag.push('presenter: no measured stretch length for this channel, short shots instead')
    placement = 'short'
  }
  const L = placement === 'short' ? Math.min(6, Math.max(2, cfg.minShotS, cfg.lengthS)) : (cfg.stretchS as number)
  const minL = Math.max(cfg.minShotS, placement === 'short' ? 2 : L * 0.6)
  // a shot as long as the references' longest full-frame presenter (8.6 s), never a longer run of shots (avatar-qualite part 4)
  const maxL = placement === 'short' ? (cfg.runMaxS ?? 6) : L * 1.5
  const runMax = cfg.runMaxS ?? Infinity
  const slots: Slot[] = []
  const present = (a: number, b: number): number => slots.reduce((n, s) => n + overlap(s.start, s.end, a, b), 0)
  const wanted = (a: number, b: number): number =>
    parts.reduce((n, p) => n + overlap(p.fromS, p.toS, a, b) * (p.shares.presenter ?? 0), 0)
  for (const s of sentences) {
    const a = s.start
    const last = slots.at(-1)
    if (last && a < last.end - 1e-9) continue
    const opening = slots.length === 0 && s.n === 1
    if (!opening) {
      const part = parts[partIx(parts, a)] as Part
      if ((part.shares.presenter ?? 0) <= 0) continue
      // behind the part's share by at least half a shot at the end of this one
      const behind = wanted(part.fromS, Math.min(part.toS, a + L)) - present(part.fromS, a)
      // talk or show (avatar-qualite part 5, run 7): a sentence that names something is the pictures', whatever the curve asks
      // (« vous avez décalé l'armoire », « vous avez même repeint le coin »); a talk sentence is the presenter's unless the part
      // is well ahead (« je vais vous dire honnêtement », « on va faire ça en quatre temps » got pictures of an idea)
      const role = cfg.roles?.get(s.n)
      if (role === 'show') continue
      if (behind < L * (role === 'talk' ? -0.5 : 0.55)) continue
      if (last && a - last.end > 1e-9 && a - last.end < cfg.minShotS) continue
    }
    // the opening sentence names something: the presenter says its first clauses, the picture comes on the clause that names it
    // (« Ce matin, en cherchant les couvertures d'hiver, » | « vous avez décalé l'armoire de la chambre du fond »)
    const clauseEnd = opening && cfg.roles?.get(s.n) === 'show' ? openingClauseEnd(words, s, minL) : null
    let end = clauseEnd ?? bestCut(cuts, a + minL, Math.min(a + maxL, D), a + L)
    if (end === null) {
      if (D - a <= maxL + 1e-9 && D - a >= minL) end = D
      else continue
    }
    // the picture after it lasts at least minShotS, or there is none: the shot ends with its sentence
    const rest = s.end - end
    if (rest > 1e-9 && rest < cfg.minShotS && s.end - a <= maxL + 1) end = s.end
    if (D - end < cfg.minShotS) end = D
    // never more than the pipeline's `presenterRunMaxS` of presenter in a row (avatar@1: 8.5 s, its references' full-frame
    // presenter lasting 3 to 8.6 s between pictures, record 0054): a shot that would extend a run is cut short, or left to the pictures
    const runStart = last && Math.abs(a - last.end) < 1e-6 ? runStartOf(slots) : a
    if (end - runStart > runMax + 1e-9) {
      const capped = bestCut(cuts, a + minL, runStart + runMax, runStart + runMax)
      if (capped === null || D - capped < cfg.minShotS) continue
      end = capped
    }
    slots.push({ start: a, end, sentence: s.n, ...(clauseEnd !== null && end === clauseEnd ? { fixed: true } : {}) })
  }
  // the talk / show placement also ends its shots on sentences (never in a sentence's last second, never mid next sentence)
  tunePresenter(slots, parts, cuts, D, { minL, maxL, minShotS: cfg.minShotS, runMaxS: runMax, ...(cfg.roles ? { sentenceEnds: sentences.map((s) => s.end) } : {}) })
  return slots
}

/**
 * Moves the presenter's shot ends by a word or two so each part's presenter time lands on its share (a short part, like the
 * 30-second opening, cannot reach it with whole shots alone): the shot keeps its length bounds, the picture after it keeps
 * at least `minShotS`.
 */
function tunePresenter(slots: Slot[], parts: readonly Part[], cuts: readonly Cut[], D: number, b: { minL: number; maxL: number; minShotS: number; runMaxS: number; sentenceEnds?: readonly number[] }): void {
  const ends = cuts.map((c) => c.t)
  slots.forEach((s, i) => {
    if (s.fixed) return
    const part = parts[partIx(parts, s.start)] as Part
    const target = (part.toS - part.fromS) * (part.shares.presenter ?? 0)
    const err = (): number => slots.reduce((n, x) => n + overlap(x.start, x.end, part.fromS, part.toS), 0) - target
    const nextStart = slots[i + 1]?.start ?? D
    const endAtStart = s.end
    // the run this shot belongs to: back-to-back shots before it, and after it when it ends on the next one's start
    let from = i
    while (from > 0 && Math.abs((slots[from - 1] as Slot).end - (slots[from] as Slot).start) < 1e-6) from--
    let to = i + 1
    while (to < slots.length - 1 && Math.abs((slots[to] as Slot).end - (slots[to + 1] as Slot).start) < 1e-6) to++
    const ok = (end: number): boolean => {
      const len = end - s.start
      const gap = nextStart - end
      const runEnd = Math.abs(gap) < 1e-9 && slots[to] ? (slots[to] as Slot).end : end
      if (runEnd - (slots[from] as Slot).start > b.runMaxS + 1e-9) return false
      // never a cut in the last second of a sentence: its last words would get a picture of their own, late (avatar-qualite)
      const sentenceEnd = b.sentenceEnds?.find((x) => x > end + 1e-9)
      if (sentenceEnd !== undefined && sentenceEnd - end < LATE_CUT_S && Math.abs(gap) > 1e-9) return false
      return len >= b.minL - 1e-9 && len <= b.maxL + 1e-9 && (Math.abs(gap) < 1e-9 || gap >= b.minShotS - 1e-9)
    }
    // only the shots ending inside the part move its time; the last one of the part moves first, then the others
    if (s.end > part.toS + 1e-9 && s.start >= part.fromS) return
    for (let guard = 0; guard < 8; guard++) {
      const e = err()
      if (Math.abs(e) <= (part.toS - part.fromS) * 0.01) break
      // the next word, the word before, the next shot's start, or the end of the sentence (a late cut is not allowed before it)
      const sentenceEnd = b.sentenceEnds?.find((t) => t > s.end + 1e-9)
      // past the end of the sentence the shot ends in, only to the end of a later sentence (the references end their presenter on a
      // sentence's end, never in the middle of the next one: « Et derrière, dans l'angle du mur » is a picture)
      const limit = b.sentenceEnds?.find((t) => t >= endAtStart - 1e-9) ?? Infinity
      const atSentenceEnd = (t: number): boolean => b.sentenceEnds?.some((x) => Math.abs(x - t) < 1e-6) ?? true
      const options = [...ends.filter((t) => t > s.end + 1e-9).slice(0, 1), ...ends.filter((t) => t < s.end - 1e-9).slice(-1), ...(ok(nextStart) ? [nextStart] : []), ...(sentenceEnd !== undefined ? [sentenceEnd] : [])]
      const better = options.filter((t) => t <= limit + 1e-9 || atSentenceEnd(t)).filter(ok).filter((t) => Math.abs(e + (Math.min(t, part.toS) - Math.min(s.end, part.toS))) < Math.abs(e) - 1e-6)
      const t = better.sort((x, y) => Math.abs(e + (Math.min(x, part.toS) - Math.min(s.end, part.toS))) - Math.abs(e + (Math.min(y, part.toS) - Math.min(s.end, part.toS))))[0]
      if (t === undefined) break
      s.end = t
    }
  })
}

export interface FillInput {
  words: readonly Word[]
  sentences: readonly Sentence[]
  beats: readonly Beat[]
  parts: readonly Part[]
  slots: readonly Slot[]
  directives: readonly Directive[]
  D: number
  screen: ScreenParams
  minShotS: number
  maxShotS: number
  aspect: Aspect
  styleSuffix: string
  prices: Record<'stock.photo' | 'stock.video' | 'image.gen' | 'video.gen', number>
  /** Credits per second of presenter (the avatar brick's price); undefined: no presenter brick. */
  presenterPerS?: number
  seed: number
  /** « Motion only where it is seen » (vrais-tests): a clip shot whose scene shows nothing moving becomes a still with a camera move. */
  motionOnly?: boolean
  /** The measured cadence along the video: shot lengths times the row's factor (director-screen.ts PaceRows). */
  paceRows?: PaceRows
}

export interface MixTrack {
  shots: Shot[]
  items: GenItem[]
  diagnostics: string[]
  /** The pictures that took another angle on their sentence's words (its directives were all on screen): where to top up. */
  angles: { sentence: number; startS: number }[]
  /** The pictures whose directive asked for a frame (documentary cards, director-cards.ts), by shot id. */
  framed: Map<string, DirectiveFrame>
}

const GEN: Record<PictureKind, GenKind> = { clipAi: 'video.gen', imageAi: 'image.gen', stock: 'stock.video', archive: 'stock.photo' }
const SIZES = ['medium shot', 'close-up detail', 'wide shot', 'low angle shot', 'overhead shot']
/** A shot size the scene pass wrote at the head of its prompt (« Close-up of a hand… »): kept instead of the rotation (vrais-tests:
 *  the rotation gave wide shots where the reference's objects were close-ups). */
const NAMED_SIZE = /^\s*((?:extreme\s+)?close[- ]up(?:\s+detail)?|close\s+shot|(?:medium\s+)?wide\s+shot|medium(?:\s+close)?\s+shot|low[- ]angle(?:\s+(?:medium|wide))?\s+shot|overhead\s+shot)\s+of\s+/i
const MOVES: Motion['kind'][] = ['push', 'pull', 'left', 'right']
/** Where the run of back-to-back presenter shots that ends with the last slot starts. */
function runStartOf(slots: readonly Slot[]): number {
  let k = slots.length - 1
  while (k > 0 && Math.abs((slots[k - 1] as Slot).end - (slots[k] as Slot).start) < 1e-6) k--
  return (slots[k] as Slot).start
}

/** A presenter shot never ends this close before its sentence's end (its last words would get a late picture). */
const LATE_CUT_S = 1.2
/** How much longer than its kind's length a shot may run to end on the next directive's anchor (avatar-qualite part 2). */
const ANCHOR_SLACK_S = 1.5
/** The shortest picture the references show (1.16 s over 411 pictures): what a picture cut on its word may last (record 0059). */
const WORD_PICTURE_MIN_S = 1.1
const isPicture = (k: string): k is PictureKind => (PICTURE_KINDS as readonly string[]).includes(k)
const pad = (n: number): string => String(n).padStart(3, '0')

/** The base track of the mix mode: presenter shots, then pictures cut on the anchors (steps 2–3 above). */
export function fillTrack(o: FillInput): MixTrack {
  const { words, sentences, parts, D, screen } = o
  const diag: string[] = []
  const cuts = cutsOf(words)
  const len = (k: ScreenKind): number => screen.mix.shotLengthS?.[k as 'presenter'] ?? SHOT_LENGTHS[k]
  // where each directive lands: its anchor's cut, inside its sentence
  const placed: { d: Directive; t: number; word: number }[] = []
  let lost = 0
  for (const d of o.directives) {
    const s = sentences[d.sentence - 1]
    const k = s ? findAnchorWord(words, (words[s.first] as Word).sentence, d.anchor, s.first) : null
    if (k === null) {
      lost++
      continue
    }
    // with the pipeline's `cutLeadS` (avatar@1: 0.1 s, as its references), the picture lands that long before the word that names
    // it, not on the function word that opens the anchor; without it, on the anchor's first word
    const lead = o.screen.cutLeadS
    const kc = lead !== undefined ? contentWordOf(words, k, d.anchor, d.subject) : k
    if (lead === undefined || kc > (s as Sentence).last) {
      placed.push({ d, t: cutBefore(words, k), word: k })
      continue
    }
    placed.push({ d, t: Math.max(cutBefore(words, k), snap((words[kc] as Word).start - lead)), word: kc })
  }
  placed.sort((a, b) => a.t - b.t)
  if (lost > 0) diag.push(`directives: ${lost} dropped, their anchor is not in the words`)
  const anchorTimes = new Set(placed.filter((x) => isPicture(x.d.kind)).map((x) => x.t))
  // seconds per part and kind, for the deficits
  const got = parts.map(() => ({ presenter: 0, clipAi: 0, imageAi: 0, stock: 0, archive: 0 }) as Record<ScreenKind, number>)
  const record = (k: ScreenKind, a: number, b: number): void => parts.forEach((p, i) => ((got[i] as Record<ScreenKind, number>)[k] += overlap(p.fromS, p.toS, a, b)))
  const shots: Shot[] = []
  const items: GenItem[] = []
  const rules = promptRules(screen)
  let move = Math.abs(o.seed) % MOVES.length
  let n = 0
  const beatAt = (t: number): Beat => o.beats.find((b) => t + 9 / FPS >= b.start && t + 9 / FPS < b.end) ?? (o.beats.at(-1) as Beat)
  const transition = (t: number): Shot['transitionIn'] => {
    const k = wordsFrom(words, t, 1).first
    if (k === 0) return 'cut'
    const b = beatAt(t)
    if (b.chapter && Math.abs(b.start - t) < 0.3) return 'dip'
    // a new sentence's picture cross-fades in (its cut may land a word or two in, on the word that names it: cutLeadS)
    if (screen.transitions === 'sentence' && k - (ofWord[k]?.first ?? k) <= 2 && (ofWord[k]?.first ?? 0) > 0) return 'dissolve'
    return (words[k] as Word).paragraph !== (words[k - 1] as Word).paragraph ? 'dissolve' : 'cut'
  }
  const ofWord: Sentence[] = []
  for (const s of sentences) for (let k = s.first; k <= s.last; k++) ofWord[k] = s
  const sentenceOf = (t: number): Sentence => ofWord[wordsFrom(words, t, 1).first] ?? (sentences.at(-1) as Sentence)
  /** The directive a picture at `t` illustrates: the one anchored there, else the latest before it in its sentence, else the sentence's first. */
  const onWord = o.screen.cutLeadS !== undefined
  const directiveFor = (t: number): Directive | null => {
    const at = placed.find((x) => Math.abs(x.t - t) < 1e-6 && isPicture(x.d.kind))
    if (at) return at.d
    const s = sentenceOf(t)
    const mine = placed.filter((x) => x.d.sentence === s.n && isPicture(x.d.kind))
    // a pipeline that cuts on the word never shows a thing before it is named (run 7: the spray from « L'an dernier », 2.5 s early)
    const ahead = onWord ? undefined : mine[0]
    return (mine.filter((x) => x.t <= t + 1e-6).at(-1) ?? ahead ?? placed.filter((x) => x.t <= t && isPicture(x.d.kind)).at(-1))?.d ?? null
  }
  /** The words spoken from `a` to `b` (the illustration check reads them, avatar-qualite). */
  const saidIn = (a: number, b: number): string => words.filter((w) => w.start < b - 0.05 && w.end > a + 0.05).map((w) => w.w).join(' ').slice(0, 1000)
  const pictureItem = (kind: PictureKind, d: Directive | null, s: Sentence, seconds: number, id: string, shotId: string, size: string, priority: number, said?: string, atS?: number): GenItem => {
    const terms = keyTerms(s.text.split(/\s+/))
    const subject = d?.subject ?? (terms.join(', ') || s.text.slice(0, 120))
    const named = d?.prompt ? NAMED_SIZE.exec(d.prompt) : null
    const prompt = named ? (d?.prompt ?? '').slice(named[0].length) : (d?.prompt ?? subject)
    if (named) size = (named[1] as string).toLowerCase()
    const g = GEN[kind]
    return {
      id,
      kind: g,
      ...(kind === 'stock' || kind === 'archive' ? { query: (d?.query ?? (terms.slice(0, 3).join(' ') || subject)).slice(0, 80) } : {}),
      prompt: `${size} of ${prompt}, ${o.styleSuffix}${rules}${o.aspect === '9:16' ? ', vertical 9:16 composition' : ''}`.slice(0, 1200),
      ...(kind === 'stock' || kind === 'archive' ? {} : { shot: { size, scene: prompt.slice(0, 1200) } }),
      constraints: { durationS: Math.round(seconds * 1000) / 1000, aspect: o.aspect },
      context: { beatText: s.text, subject, keyTerms: terms, ...(said ? { said } : {}), ...(atS !== undefined ? { atS: Math.round(atS * 1000) / 1000 } : {}) },
      unitPrice: o.prices[g as keyof FillInput['prices']] ?? 0,
      units: g === 'video.gen' ? Math.ceil(seconds) : 1,
      priority,
      shotIds: [shotId]
    }
  }

  // 1. the presenter's shots: the layouts the pipeline measured (director-layouts.ts), else the scene pass's (never in the opening)
  let splits = 0
  const presenterShots: Shot[] = []
  const planned = screen.presenterLayouts
    ? plannedLayouts(
        o.slots.map((sl) => ({ start: sl.start, end: sl.end, kind: triggerOf((sentences[sl.sentence - 1] as Sentence | undefined)?.text ?? '') })),
        screen.presenterLayouts,
        screen.layouts,
        D
      )
    : null
  const presenterSide = screen.presenterLayouts?.presenterSide
  for (const [si, sl] of o.slots.entries()) {
    const id = `s${pad(++n)}`
    const seconds = sl.end - sl.start
    const ask = placed.find((x) => x.d.sentence === sl.sentence && (planned !== null || (x.d.layout && x.d.layout !== 'full')) && isPicture(x.d.kind))
    const inOpening = sl.start < (parts[0] as Part).toS - 1e-9
    let layout: Layout = 'full'
    if (planned) layout = planned[si] as Layout
    else if (ask && !inOpening && screen.layouts.includes(ask.d.layout as Layout) && (ask.d.layout !== 'split' || splits * 3 < o.slots.length)) layout = ask.d.layout as Layout
    const asked = ask?.d ?? null // beside or behind the presenter: the sentence's directive, else a still of what it names
    const pk: PictureKind = layout === 'pip' || !ask ? 'imageAi' : (ask.d.kind as PictureKind)
    const s = sentences[sl.sentence - 1] as Sentence
    const item: GenItem = {
      id: `avatar-${pad(n)}`,
      kind: 'avatar',
      constraints: { durationS: Math.round(seconds * 1000) / 1000, aspect: o.aspect },
      context: { beatText: s.text, subject: 'Présentateur', keyTerms: keyTerms(s.text.split(/\s+/)) },
      unitPrice: o.presenterPerS ?? 0,
      units: Math.ceil(seconds),
      // the first shot is what the viewer sees first: the budget gives it up last
      priority: shots.length === 0 && presenterShots.length === 0 ? 10 : 6,
      shotIds: [id],
      voiceRange: { startFrame: Math.round(sl.start * FPS), endFrame: Math.round(sl.end * FPS) },
      layout
    }
    const shot: Shot = {
      id,
      track: 'base',
      startFrame: Math.round(sl.start * FPS),
      endFrame: Math.round(sl.end * FPS),
      kind: 'avatar',
      genItem: item.id,
      transitionIn: transition(sl.start),
      role: 'scene',
      beat: beatAt(sl.start).i,
      anchor: wordsFrom(words, sl.start).text,
      layout
    }
    if (layout === 'split') {
      const pic = pictureItem(pk, asked, s, seconds, `item-${pad(n)}b`, id, 'medium shot', 4)
      items.push(pic)
      // the picture's side: opposite the presenter's (`presenterSide`), else one then the other
      shot.beside = { genItem: pic.id, side: presenterSide === 'left' ? 'right' : presenterSide === 'right' ? 'left' : splits % 2 === 0 ? 'right' : 'left' }
      splits++
    }
    if (layout === 'pip') {
      // the picture is the base shot, the presenter a small picture over it (screen time of the picture)
      const pic = pictureItem(pk, asked, s, seconds, `item-${pad(n)}`, id, 'wide shot', 4)
      items.push(pic)
      const { layout: _full, ...picture } = shot
      // a still under the inset gets its slow move like any still (production-9: never a frozen picture behind the presenter)
      const still = pk === 'imageAi' || pk === 'archive'
      shots.push({ ...picture, kind: pic.kind, genItem: pic.id, ...(still ? { motion: { kind: 'push', from: 1.02, to: 1.14 } } : {}) })
      record(pk, sl.start, sl.end)
      presenterShots.push({ ...shot, id: `av${pad(n)}`, track: 'overlay', transitionIn: 'cut', layout: 'pip', ...(screen.presenterLayouts?.inset ? { inset: screen.presenterLayouts.inset } : {}) })
      items.push({ ...item, shotIds: [`av${pad(n)}`] })
      continue
    }
    record('presenter', sl.start, sl.end)
    items.push(item)
    shots.push(shot)
  }
  if (splits > 0) diag.push(`presenter: ${splits} split shot(s), beside their picture`)

  // 2. the pictures between the presenter's shots
  const windows: [number, number][] = []
  let at = 0
  for (const sl of o.slots) {
    if (sl.start - at > 1e-9) windows.push([at, sl.start])
    at = Math.max(at, sl.end)
  }
  if (D - at > 1e-9) windows.push([at, D])
  const opening = (parts[0] as Part).toS
  const mixPictures = PICTURE_KINDS.filter((k) => (screen.mix[k] ?? 0) > 0)
  let honoured = 0
  let overridden = 0
  const usedDirectives = new Set<Directive>()
  const chooseKind = (t: number, want: string | null): PictureKind => {
    const pi = partIx(parts, t)
    const p = parts[pi] as Part
    const g = got[pi] as Record<ScreenKind, number>
    const total = PICTURE_KINDS.reduce((s, k) => s + (p.shares[k] ?? 0), 0)
    const cands = PICTURE_KINDS.filter((k) => (p.shares[k] ?? 0) > 0)
    if (cands.length === 0 || total <= 0) {
      // a part that is all presenter: moving pictures in the opening, else the mix's largest picture kind
      const moving = mixPictures.find((k) => k === 'clipAi' || k === 'stock')
      return (t < opening && moving) || ([...mixPictures].sort((a, b) => (screen.mix[b] ?? 0) - (screen.mix[a] ?? 0))[0] ?? 'imageAi')
    }
    const pics = PICTURE_KINDS.reduce((s, k) => s + g[k], 0)
    const deficit = (k: PictureKind): number => ((p.shares[k] ?? 0) / total) * (pics + len(k)) - g[k]
    const best = [...cands].sort((a, b) => deficit(b) - deficit(a))[0] as PictureKind
    if (want && isPicture(want) && cands.includes(want) && deficit(want) >= deficit(best) - 1) return want
    return best
  }
  let count = 0
  let stilled = 0
  // what the pictures showed and when: a directive serves one picture, and no subject comes back within REPEAT_WINDOW_S
  const shown: { t: number; d: Directive; scene: string }[] = []
  let facet = 0
  const angles: MixTrack['angles'] = []
  const framed = new Map<string, DirectiveFrame>()
  const sceneOfD = (d: Directive): string => d.prompt ?? d.query ?? d.subject
  const recent = (t: number, d: Directive): boolean =>
    shown.some((x) => t - x.t < Math.max(screen.repeatWindowS, 1e-6) && (x.d === d || normWord(x.d.subject) === normWord(d.subject) || sameScene(x.scene, sceneOfD(d))))
  const pickDirective = (t: number, s: Sentence, anchored: Directive | null): Directive | null => {
    if (anchored && !recent(t, anchored)) return anchored
    // a directive of this sentence that no picture showed yet, the nearest first
    const fresh = placed
      .filter((x) => isPicture(x.d.kind) && x.d.sentence === s.n && (!onWord || x.t <= t + 1e-6) && !recent(t, x.d) && !shown.some((y) => y.d === x.d))
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]
    if (fresh) return fresh.d
    const base = anchored ?? directiveFor(t)
    if (base && !recent(t, base)) return base
    // the sentence's directives are all on screen already (or it has none): another angle on its own words (the shot-planning
    // guide), the first one nothing within the window showed
    const terms = keyTerms(s.text.split(/\s+/))
    let v = facetDirective(base, s.n, terms, facet++)
    for (let k = 1; k < FACETS.length && recent(t, v); k++) v = facetDirective(base, s.n, terms, facet++)
    angles.push({ sentence: s.n, startS: t })
    return base === null || isFakeDirective(base) ? asFakeDirective(v) : v
  }
  for (const [w0, w1] of windows) {
    let t = w0
    while (w1 - t > 1e-6) {
      // the directive anchored here, or one anchored too close after the cut to get its own shot (this shot covers its words)
      const anchored =
        placed.find((x) => Math.abs(x.t - t) < 1e-6 && isPicture(x.d.kind))?.d ??
        placed.find((x) => x.t > t + 1e-6 && x.t < Math.min(t + o.minShotS, w1) - 1e-6 && isPicture(x.d.kind) && !usedDirectives.has(x.d))?.d ??
        null
      const s = sentenceOf(t)
      const d = pickDirective(t, s, anchored)
      let kind = chooseKind(t, anchored?.kind ?? null)
      // a place, an object or a ceiling needs no paid clip: a still with a slow move (the clip goes to the next scene that moves)
      // (a directive made without the LLM describes no scene: its subject is the sentence's key terms, nothing to judge)
      if (o.motionOnly && kind === 'clipAi' && d && !isFakeDirective(d) && mixPictures.includes('imageAi') && !needsMotion(`${d.subject} ${d.prompt ?? ''}`)) {
        kind = 'imageAi'
        stilled++
      }
      if (anchored) {
        if (kind === anchored.kind) honoured++
        else overridden++
        usedDirectives.add(anchored)
      }
      const L = len(kind) * paceAt(o.paceRows, t)
      const rest = w1 - t
      // the next directive's anchor is a hard cut (avatar-qualite part 2, Charlie: « coupé au moment même de ce qui est dit »): a
      // picture starts on the words that name it, never seconds later because a shot length said so
      // (a pipeline that cuts on the word lets the last picture before the presenter be as short as the references' shortest,
      // 1.1 s: run 7's « repeint le coin en blanc » is 1.3 s before « C'est le deuxième hiver »)
      const tail = o.screen.cutLeadS !== undefined ? Math.min(o.minShotS, WORD_PICTURE_MIN_S) : o.minShotS
      const nextAnchor = [...anchorTimes].filter((a) => a >= t + o.minShotS - 1e-9 && a <= w1 - tail + 1e-9).sort((a, b) => a - b)[0]
      let end: number
      // (within a shot's natural length: a far anchor never stretches one picture over the words of the next sentence)
      if (nextAnchor !== undefined && nextAnchor <= t + Math.min(o.maxShotS, L + ANCHOR_SLACK_S) + 1e-9) end = nextAnchor
      else if (nextAnchor === undefined && rest <= o.maxShotS + 1e-9 && rest < L + o.minShotS) end = w1
      else {
        const hi = Math.min(t + Math.max(o.maxShotS, L), w1 - o.minShotS, nextAnchor !== undefined ? nextAnchor - o.minShotS : Infinity)
        end = bestCut(cuts, t + o.minShotS, hi, t + L, anchorTimes) ?? nextAnchor ?? (rest <= o.maxShotS * 1.5 ? w1 : (bestCut(cuts, t + o.minShotS, w1 - o.minShotS, t + L) ?? w1))
        if (nextAnchor !== undefined && end > nextAnchor) end = nextAnchor
      }
      const id = `s${pad(++n)}`
      if (d) shown.push({ t, d, scene: sceneOfD(d) })
      const repeat = d ? [...shots].reverse().findIndex((x) => x.genItem && items.find((i) => i.id === x.genItem)?.context.subject === d.subject) : -1
      const size = SIZES[(count + (repeat >= 0 ? 1 : 0)) % SIZES.length] as string
      const item = pictureItem(kind, d, s, end - t, `item-${pad(n)}`, id, size, (t < opening ? 3 : 0) + (anchored ? 2 : 0), saidIn(t, end), t)
      const m = MOVES[move++ % MOVES.length] as Motion['kind']
      shots.push({
        id,
        track: 'base',
        startFrame: Math.round(t * FPS),
        endFrame: Math.round(end * FPS),
        kind: item.kind,
        genItem: item.id,
        ...(kind === 'imageAi' || kind === 'archive' ? { motion: { kind: m, from: m === 'pull' ? 1.14 : 1.02, to: m === 'pull' ? 1.02 : 1.14 } } : {}),
        transitionIn: transition(t),
        role: anchored ? 'scene' : 'base',
        beat: beatAt(t).i,
        // a directive absorbed from just after the cut says its words a moment later: the shot's anchor is the words at its cut
        anchor: wordsFrom(words, t).text
      })
      items.push(item)
      if (d?.frame && screen.cards && (kind === 'archive' || kind === 'imageAi')) framed.set(id, d.frame)
      record(kind, t, end)
      count++
      t = end
    }
  }
  shots.sort((a, b) => a.startFrame - b.startFrame || (a.track === 'base' ? -1 : 1))
  shots.push(...presenterShots)
  const pictures = placed.filter((x) => isPicture(x.d.kind)).length
  if (stilled > 0) diag.push(`motion: ${stilled} clip shot(s) showing nothing that moves became stills with a camera move`)
  diag.push(`directives: ${honoured} shots on their anchor with their kind, ${overridden} with another kind to keep the curve, ${pictures - usedDirectives.size} merged into a neighbour`)
  return { shots, items, diagnostics: diag, angles, framed }
}

