// Captions (docs/ENGINE-SPEC.md §27): cue building from the voice's word times, cue timing, muting around graphics, and our
// own ASS / SRT generators. Pure functions, no I/O. The display text is the script's own spelling (`Word.w`); the same cues
// feed the burned ASS (styled) and the plain SRT of the package.
import type { EditPlan } from '../formats/editplan'
import { FPS, type Word } from '../formats/timing'
import { filterPath } from '../media/filters'
import { endsSentence, normWord, STOP_WORDS } from './script'

/**
 * `shorts` (vertical films): 1–3 words at a time, big, bold, upper case, thick outline, the spoken word in the accent
 * colour, set in the safe area (centred, above the bottom UI zone of a phone). `word` (a story short, clone-reddit-shorts):
 * one word at a time in its own case, white with a black outline, in the middle of the frame, a word spoken faster than
 * `minWordS` shown with the next one, each cue popping in from 94 %. The others are for long-form.
 */
export const CAPTION_PRESETS = ['classic', 'highlight', 'pill', 'bold-center', 'word-by-word', 'shorts', 'word'] as const
export type CaptionPreset = (typeof CAPTION_PRESETS)[number]
export type CaptionPosition = 'bottom' | 'middle' | 'top'

/** libass family names of the bundled files: Inter-Bold.ttf is "Inter" (bold), Inter-SemiBold.ttf is "Inter SemiBold". */
export const CAPTION_FONT = 'Inter'
export const LABEL_FONT = 'Inter SemiBold'
/** The `word` preset's face: Montserrat-ExtraBold.ttf, whose family is "Montserrat ExtraBold" for libass (regular style). */
export const WORD_FONT = 'Montserrat ExtraBold'
/**
 * `word` at 1080 px wide, in libass units: the reference's « chaussures » is 497 px wide with a 61 px ascender, which libass draws
 * from Montserrat ExtraBold at size 130 (its size is the font's line height, not its em: 82 px of em).
 */
const WORD_SIZE = 130

/** The frame the captions are laid out in (`[width, height]`): ASS `PlayRes`. Default 1920×1080; a short is 1080×1920. */
export type CaptionFrame = readonly [number, number]
const LANDSCAPE: CaptionFrame = [1920, 1080]
const MARGIN = 90
const SIDE_MARGIN = 120
/** A phone's bottom UI zone (description, buttons) takes about a quarter of the height: shorts captions stay above it. */
const SHORTS_BOTTOM = 0.25
const SHORTS_SIDE = 60
const SHORTS_SIZE = 112
const isPortrait = (f: CaptionFrame): boolean => f[1] > f[0]
/** Words that follow the voice by this much earlier get the accent colour (§27.4). */
const HIGHLIGHT_EARLY = 0.04
const MIN_ON_SCREEN = 0.3
const FLICKER_GAP = 0.25
const LONG_PAUSE = 1.5
const LEAVE_AFTER_PAUSE = 0.3
const MAX_GRAZE = 0.5

export interface CueWord {
  text: string
  start: number
  end: number
}

/** One caption on screen: its lines of words and the time it is shown (seconds). */
export interface Cue {
  start: number
  end: number
  lines: CueWord[][]
}

export interface CueOptions {
  maxChars: number
  /** Lines per cue (1 or 2). */
  lines: number
  maxWords?: number
  /** `word`: one word per cue, a word spoken in less than this many seconds joins the next one (2 words at most). */
  minWordS?: number
}

export const cueWords = (c: Cue): CueWord[] => c.lines.flat()
export const cueText = (c: Cue): string => c.lines.map((l) => l.map((w) => w.text).join(' ')).join('\n')

// ---------------------------------------------------------------------------------------------------------------------
// Line building

const hasAlnum = (t: string): boolean => /[\p{L}\p{N}]/u.test(t)
const trailingMark = (t: string): boolean => /[,;:—–.!?…»)"”]$/u.test(t)
const clauseMark = (t: string): boolean => /[,;:—–]$/u.test(t)
/** A bare number token ("1914", "2,5", "500"), without a closing mark: it belongs with the word that follows. */
const isNumberToken = (t: string): boolean => /\p{N}/u.test(t) && !/\p{L}/u.test(t) && !trailingMark(t)
const isOpening = (t: string): boolean => /[«“"([]$/u.test(t)

const LINE_COST = 300
const BAD = 3000

/** Word counts of the lines of one sentence: the cheapest split under the line rules (dynamic programming). */
export function splitSentence(tokens: readonly string[], maxChars: number, maxWords = Infinity): number[] {
  const n = tokens.length
  const best: number[] = new Array<number>(n + 1).fill(Infinity)
  const from: number[] = new Array<number>(n + 1).fill(0)
  best[0] = 0
  for (let i = 1; i <= n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const count = i - j
      if (count > maxWords) break
      let len = count - 1
      for (let k = j; k < i; k++) len += (tokens[k] ?? '').length
      if (len > maxChars && count > 1) break
      const prev = best[j] ?? Infinity
      if (prev === Infinity) continue
      let cost = LINE_COST
      if (len > maxChars) cost += 5000
      else cost += (maxChars - len) ** 2
      const last = tokens[i - 1] ?? ''
      const first = tokens[j] ?? ''
      if (i < n) {
        if (STOP_WORDS.has(normWord(last)) && !trailingMark(last)) cost += BAD
        if (isNumberToken(last) || isOpening(last)) cost += BAD
        if (clauseMark(last)) cost -= 400
        if (count === 1) cost += 800
      } else if (count === 1 && j > 0) cost += 2500
      if (j > 0 && !hasAlnum(first) && !isOpening(first)) cost += BAD
      if (prev + cost < (best[i] ?? Infinity)) {
        best[i] = prev + cost
        from[i] = j
      }
    }
  }
  const sizes: number[] = []
  for (let i = n; i > 0; i = from[i] ?? 0) sizes.unshift(i - (from[i] ?? 0))
  return sizes
}

/** One cue per word; a word shorter than `minWordS` (and not ending its sentence) shares the next word's cue, two words at most. */
export function wordCues(words: readonly Word[], minWordS: number): Cue[] {
  const cues: Cue[] = []
  let group: Word[] = []
  const push = (): void => {
    if (group.length === 0) return
    const line = group.map((w) => ({ text: w.w, start: w.start, end: w.end }))
    cues.push({ start: line[0]?.start ?? 0, end: line[line.length - 1]?.end ?? 0, lines: [line] })
    group = []
  }
  words.forEach((w, i) => {
    group.push(w)
    const next = words[i + 1]
    const joins = group.length === 1 && w.end - w.start < minWordS && next !== undefined && next.sentence === w.sentence && !endsSentence(w.w)
    if (!joins) push()
  })
  push()
  return cues
}

/** Cues from the word list: sentences first, then lines per sentence, then `lines` lines per cue. Times are the raw word times. */
export function buildCues(words: readonly Word[], o: CueOptions): Cue[] {
  const cues: Cue[] = []
  let sentence: Word[] = []
  const flush = (): void => {
    if (sentence.length === 0) return
    const sizes = splitSentence(sentence.map((w) => w.w), o.maxChars, o.maxWords ?? Infinity)
    const lines: CueWord[][] = []
    let at = 0
    for (const size of sizes) {
      lines.push(sentence.slice(at, at + size).map((w) => ({ text: w.w, start: w.start, end: w.end })))
      at += size
    }
    const per = Math.max(1, Math.floor(o.lines))
    for (let k = 0; k < lines.length; k += per) {
      const group = lines.slice(k, k + per)
      const flat = group.flat()
      cues.push({ start: flat[0]?.start ?? 0, end: flat[flat.length - 1]?.end ?? 0, lines: group })
    }
    sentence = []
  }
  for (const w of words) {
    const prev = sentence[sentence.length - 1]
    if (prev && (prev.sentence !== w.sentence || prev.paragraph !== w.paragraph || endsSentence(prev.w))) flush()
    sentence.push(w)
  }
  flush()
  return cues
}

// ---------------------------------------------------------------------------------------------------------------------
// Timing

/**
 * A cue appears `leadMs` before its first word and leaves when the next one appears; over a voice pause of 1.5 s or more it
 * leaves 0.3 s after its last word. A cue shorter than 0.3 s is held (it may borrow the lead of the next cue, never more).
 */
export function timeCues(cues: readonly Cue[], leadMs: number): Cue[] {
  const lead = leadMs / 1000
  const out: Cue[] = []
  let prevEnd = 0
  cues.forEach((c, i) => {
    const words = cueWords(c)
    const first = words[0]?.start ?? 0
    const lastEnd = words[words.length - 1]?.end ?? first
    const next = cues[i + 1]
    const nextFirst = next ? (cueWords(next)[0]?.start ?? lastEnd) : Infinity
    let start = Math.max(0, first - lead)
    start = Math.max(start, Math.min(prevEnd, first))
    let end: number
    if (!next || nextFirst - lastEnd >= LONG_PAUSE) end = Math.max(lastEnd + LEAVE_AFTER_PAUSE, start + MIN_ON_SCREEN)
    else end = Math.max(nextFirst - lead, start, Math.min(start + MIN_ON_SCREEN, nextFirst))
    out.push({ ...c, start, end })
    prevEnd = end
  })
  // a gap under FLICKER_GAP between two consecutive cues is closed
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]
    const b = out[i + 1]
    if (a && b && b.start > a.end && b.start - a.end < FLICKER_GAP) a.end = b.start
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Muting

export interface Window {
  start: number
  end: number
}

/** Seconds covered by overlay shots of a `graphic.*` kind: captions do not show there (§27.5). */
export function graphicWindows(plan: EditPlan): Window[] {
  return plan.shots
    .filter((s) => s.track === 'overlay' && String(s.kind).startsWith('graphic.'))
    .map((s) => ({ start: s.startFrame / FPS, end: s.endFrame / FPS }))
}

/** Removes cues under a graphic window; a cue that only grazes a window (≤ 0.5 s at its start or end) is trimmed. */
export function muteCues(cues: readonly Cue[], windows: readonly Window[]): Cue[] {
  const out: Cue[] = []
  for (const cue of cues) {
    let { start, end } = cue
    let alive = true
    for (const w of windows) {
      if (!alive) break
      if (w.end <= start || w.start >= end) continue
      const overlap = Math.min(end, w.end) - Math.max(start, w.start)
      if (w.start <= start && w.end >= end) alive = false
      else if (overlap > MAX_GRAZE) alive = false
      else if (w.start <= start) start = w.end
      else if (w.end >= end) end = w.start
      else alive = false
    }
    if (alive && end - start > 0.02) out.push({ ...cue, start, end })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Labels

export interface LabelItem {
  text: string
  start: number
  end: number
}

/** The labels track of the plan: name, place, date or figure drawn over another shot (§21.1). Always burned. */
export function labelsOf(plan: EditPlan): LabelItem[] {
  return plan.shots
    .filter((s) => s.track === 'labels' && s.text && s.text.trim())
    .map((s) => ({ text: (s.text ?? '').replace(/\s+/g, ' ').trim(), start: s.startFrame / FPS, end: s.endFrame / FPS }))
    .sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets and the whole cue pipeline

export interface CaptionStyle {
  preset: CaptionPreset
  maxChars: number
  lines: number
  position: CaptionPosition
  leadMs: number
  accent: string
  /** The frame; default 1920×1080. */
  size?: CaptionFrame
  /** `word`: a word spoken faster than this shares the next word's cue (default 0.12 s). */
  minWordS?: number
  /** No captions before this sentence of the voice (0: from the first word; 1: not over the title an intro card shows). */
  fromSentence?: number
}

/** Chunking per preset: bold-center is 2–4 words, word-by-word at most 6, classic may use 2 lines. */
export function cueOptionsFor(s: Pick<CaptionStyle, 'preset' | 'maxChars' | 'lines' | 'minWordS'>): CueOptions {
  if (s.preset === 'bold-center') return { maxChars: Math.min(s.maxChars, 26), lines: 1, maxWords: 4 }
  if (s.preset === 'word-by-word') return { maxChars: s.maxChars, lines: 1, maxWords: 6 }
  if (s.preset === 'shorts') return { maxChars: Math.min(s.maxChars, 18), lines: 1, maxWords: 3 }
  if (s.preset === 'word') return { maxChars: s.maxChars, lines: 1, maxWords: 2, minWordS: s.minWordS ?? 0.12 }
  return { maxChars: s.maxChars, lines: s.preset === 'classic' ? Math.min(2, Math.max(1, s.lines)) : 1 }
}

/** Words -> timed cues, muted where a graphic covers the screen (and, with `fromSentence`, before that sentence of the voice). */
export function makeCues(
  words: readonly Word[],
  plan: EditPlan,
  s: Pick<CaptionStyle, 'preset' | 'maxChars' | 'lines' | 'leadMs' | 'minWordS' | 'fromSentence'>
): Cue[] {
  const o = cueOptionsFor(s)
  const from = s.fromSentence ?? 0
  const spoken = from > 0 ? words.filter((w) => w.sentence >= from) : words
  const cues = o.minWordS !== undefined ? wordCues(spoken, o.minWordS) : buildCues(spoken, o)
  return muteCues(timeCues(cues, s.leadMs), graphicWindows(plan))
}

// ---------------------------------------------------------------------------------------------------------------------
// ASS

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0')

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) throw new Error(`bad colour "${hex}", expected #RRGGBB`)
  const v = parseInt(m[1] ?? '0', 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** `#RRGGBB` -> ASS style colour `&HAABBGGRR` (alpha 0 = opaque). */
export function assColor(hex: string, alpha = 0): string {
  const [r, g, b] = rgb(hex)
  return `&H${hex2(alpha)}${hex2(b)}${hex2(g)}${hex2(r)}`
}

/** `#RRGGBB` -> the override-tag form `&HBBGGRR&`. */
export function assTag(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `&H${hex2(b)}${hex2(g)}${hex2(r)}&`
}

/** H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = Math.round(Math.max(0, seconds) * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/**
 * Text safe inside a Dialogue: line breaks become spaces, `{` `}` are escaped, and a backslash is followed by a zero-width space
 * so libass never reads `\N`, `\h` or `\n` out of the narration.
 */
export function escapeAss(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\\/g, '\\\u200b')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
}

const WHITE = '#FFFFFF'
const DIM = '#9AA0AA'
const DARK = '#10131A'

function styleLine(o: {
  name: string
  font: string
  size: number
  bold: boolean
  primary: string
  outline: string
  back: string
  borderStyle: 1 | 3
  outlineW: number
  shadow: number
  align: number
  marginV?: number
  marginSide?: number
}): string {
  const side = o.marginSide ?? SIDE_MARGIN
  return (
    `Style: ${o.name},${o.font},${o.size},${o.primary},${o.primary},${o.outline},${o.back},${o.bold ? -1 : 0},0,0,0,100,100,0,0,` +
    `${o.borderStyle},${o.outlineW},${o.shadow},${o.align},${side},${side},${o.marginV ?? MARGIN},1`
  )
}

const ALIGN: Record<CaptionPosition, number> = { bottom: 2, middle: 5, top: 8 }

/** Caption font size at 1080p: 64 px, smaller when long lines (maxChars) would not fit between the side margins. */
export const captionSize = (preset: CaptionPreset, maxChars: number, frame: CaptionFrame = LANDSCAPE): number => {
  if (preset === 'shorts') return SHORTS_SIZE
  if (preset === 'word') return Math.round((WORD_SIZE * frame[0]) / 1080)
  if (preset === 'bold-center') return 84
  const usable = frame[0] - 2 * (isPortrait(frame) ? SHORTS_SIDE : SIDE_MARGIN)
  return Math.max(40, Math.min(64, Math.floor(usable / (Math.max(1, maxChars) * 0.6))))
}

function captionStyle(s: CaptionStyle): string {
  const frame = s.size ?? LANDSCAPE
  const size = captionSize(s.preset, s.maxChars, frame)
  const align = s.preset === 'bold-center' ? 5 : ALIGN[s.position]
  if (s.preset === 'word') {
    // the reference's middle line: a black outline (6.5 % of the size) and a soft shadow just under it
    const k = size / WORD_SIZE
    return styleLine({
      name: 'Cap', font: WORD_FONT, size, bold: false, primary: assColor(WHITE), outline: assColor('#000000'), back: assColor('#000000', 0x50),
      borderStyle: 1, outlineW: Math.round(7 * k), shadow: Math.round(3 * k), align, marginV: s.position === 'middle' ? 0 : Math.round(frame[1] * SHORTS_BOTTOM),
      marginSide: isPortrait(frame) ? SHORTS_SIDE : SIDE_MARGIN
    })
  }
  if (s.preset === 'shorts') {
    // portrait: kept inside the phone's safe area (above the bottom zone, below the top bar); landscape keeps the usual margins
    const marginV = isPortrait(frame) ? Math.round(frame[1] * (s.position === 'top' ? 0.1 : SHORTS_BOTTOM)) : MARGIN
    return styleLine({
      name: 'Cap', font: CAPTION_FONT, size, bold: true, primary: assColor(WHITE), outline: assColor('#000000'), back: assColor('#000000', 0x60),
      borderStyle: 1, outlineW: 9, shadow: 3, align, marginV, marginSide: isPortrait(frame) ? SHORTS_SIDE : SIDE_MARGIN
    })
  }
  if (s.preset === 'pill') {
    return styleLine({
      name: 'Cap', font: CAPTION_FONT, size, bold: true, primary: assColor(WHITE), outline: assColor(DARK, 0x30), back: assColor(DARK, 0x30),
      borderStyle: 3, outlineW: 16, shadow: 0, align
    })
  }
  if (s.preset === 'bold-center') {
    return styleLine({
      name: 'Cap', font: CAPTION_FONT, size, bold: true, primary: assColor(WHITE), outline: assColor('#000000'), back: assColor('#000000', 0x60),
      borderStyle: 1, outlineW: 5, shadow: 3, align
    })
  }
  return styleLine({
    name: 'Cap', font: CAPTION_FONT, size, bold: true, primary: assColor(WHITE), outline: assColor('#000000'), back: assColor('#000000', 0x60),
    borderStyle: 1, outlineW: 4, shadow: s.preset === 'classic' ? 2 : 1, align
  })
}

const labelStyle = (frame: CaptionFrame): string =>
  styleLine({
    name: 'Label', font: LABEL_FONT, size: isPortrait(frame) ? 46 : 40, bold: false, primary: assColor(WHITE), outline: assColor(DARK, 0x26), back: assColor(DARK, 0x26),
    borderStyle: 3, outlineW: 12, shadow: 0, align: 7,
    // portrait: below the phone's top bar
    marginV: isPortrait(frame) ? Math.round(frame[1] * 0.09) : MARGIN, marginSide: isPortrait(frame) ? SHORTS_SIDE : MARGIN
  })

interface FlatWord {
  text: string
  start: number
  line: number
}

function flatten(cue: Cue, upper: boolean): FlatWord[] {
  const out: FlatWord[] = []
  cue.lines.forEach((l, li) => l.forEach((w) => out.push({ text: escapeAss(upper ? w.text.toUpperCase() : w.text), start: w.start, line: li })))
  return out
}

/** Joins words with spaces and `\N` between lines; `tag(k)` gives the override block to put before word k, `before(k)` one before its separator. */
function joinWords(words: readonly FlatWord[], tag: (k: number) => string, before: (k: number) => string = () => ''): string {
  let out = ''
  words.forEach((w, k) => {
    if (k > 0) out += before(k) + (w.line !== (words[k - 1]?.line ?? 0) ? '\\N' : ' ')
    out += tag(k) + w.text
  })
  return out
}

function dialogue(layer: number, start: number, end: number, style: string, text: string): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`
}

/** Start times of the per-word windows of a cue, inside [cue.start, cue.end). */
function windowStarts(cue: Cue, words: readonly FlatWord[]): number[] {
  const starts: number[] = []
  let at = cue.start
  words.forEach((w, k) => {
    at = k === 0 ? cue.start : Math.max(at, Math.min(cue.end, w.start - HIGHLIGHT_EARLY))
    starts.push(at)
  })
  return starts
}

/**
 * One cue of the shorts style: upper case, the line sized to fit the safe width, the spoken word in the accent colour and
 * the line popping in at each word. A window per word, like `highlight`, so the colour follows the voice.
 */
function shortsDialogues(cue: Cue, s: CaptionStyle): string[] {
  const words = flatten(cue, true)
  const frame = s.size ?? LANDSCAPE
  const side = isPortrait(frame) ? SHORTS_SIDE : SIDE_MARGIN
  const chars = Math.max(1, ...cue.lines.map((l) => l.map((w) => w.text).join(' ').length))
  // an upper-case bold Inter glyph is about 0.7 em wide: the line must fit between the side margins
  const size = Math.min(captionSize('shorts', s.maxChars, frame), Math.floor((frame[0] - 2 * side) / (chars * 0.7)))
  const pop = `{\\fs${size}\\fscx86\\fscy86\\t(0,90,\\fscx100\\fscy100)}`
  const starts = windowStarts(cue, words)
  const out: string[] = []
  starts.forEach((a, i) => {
    const b = starts[i + 1] ?? cue.end
    if (b - a < 0.02) return
    const text = joinWords(words, (k) => (k === i ? `{\\1c${assTag(s.accent)}}` : k === i + 1 ? `{\\1c${assTag(WHITE)}}` : ''))
    out.push(dialogue(0, a, b, 'Cap', pop + text))
  })
  return out
}

/** One cue of the `word` style: its own case, sized down only when a long word would not fit, popping in from 94 % in 0.1 s. */
function wordDialogue(cue: Cue, s: CaptionStyle): string[] {
  const frame = s.size ?? LANDSCAPE
  const text = cueText(cue).replace(/\n/g, ' ')
  const side = isPortrait(frame) ? SHORTS_SIDE : SIDE_MARGIN
  // a lower-case Montserrat ExtraBold letter is about 0.38 of the libass size wide (« chaussures »: 383 px at 100)
  const size = Math.min(captionSize('word', s.maxChars, frame), Math.floor((frame[0] - 2 * side) / (Math.max(1, text.length) * 0.4)))
  return [dialogue(0, cue.start, cue.end, 'Cap', `{\\fs${size}\\blur1.2\\fscx94\\fscy94\\t(0,100,\\fscx100\\fscy100)}${escapeAss(text)}`)]
}

function cueDialogues(cue: Cue, s: CaptionStyle): string[] {
  if (s.preset === 'shorts') return shortsDialogues(cue, s)
  if (s.preset === 'word') return wordDialogue(cue, s)
  const upper = s.preset === 'bold-center'
  const words = flatten(cue, upper)
  if (words.length === 0) return []
  const accent = `{\\1c${assTag(s.accent)}}`
  if (s.preset === 'classic') return [dialogue(0, cue.start, cue.end, 'Cap', joinWords(words, () => ''))]
  if (s.preset === 'bold-center') {
    const pop = '{\\fscx80\\fscy80\\t(0,120,\\fscx100\\fscy100)}'
    return [dialogue(0, cue.start, cue.end, 'Cap', pop + joinWords(words, () => ''))]
  }
  const starts = windowStarts(cue, words)
  const out: string[] = []
  starts.forEach((a, i) => {
    const b = starts[i + 1] ?? cue.end
    if (b - a < 0.02) return
    let text: string
    if (s.preset === 'highlight') {
      text = joinWords(words, (k) => (k === i ? accent : ''), (k) => (k === i + 1 ? '{\\r}' : ''))
    } else if (s.preset === 'pill') {
      const colour = (k: number): string => (k < i ? WHITE : k === i ? s.accent : DIM)
      text = joinWords(words, (k) => (k === 0 || colour(k) !== colour(k - 1) ? `{\\1c${assTag(colour(k))}}` : ''))
    } else {
      // word-by-word: the words to come are in the line but invisible, so the line does not move while it fills
      const shown = words.slice(0, i + 1)
      const hidden = words.slice(i + 1)
      text = joinWords(shown, () => '')
      if (hidden.length > 0) text += ' {\\alpha&HFF&}' + joinWords(hidden, () => '')
    }
    out.push(dialogue(0, a, b, 'Cap', text))
  })
  return out
}

export interface AssOptions extends CaptionStyle {
  /** False: the file holds only the labels layer (captions go to the SRT only). */
  burn: boolean
}

/** The burned ASS: captions (layer 0, when `burn`) and labels (layer 2, always). */
export function buildAss(cues: readonly Cue[], labels: readonly LabelItem[], o: AssOptions): string {
  const lines = [
    '[Script Info]',
    'Title: Atelier captions',
    'ScriptType: v4.00+',
    `PlayResX: ${(o.size ?? LANDSCAPE)[0]}`,
    `PlayResY: ${(o.size ?? LANDSCAPE)[1]}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ' +
      'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    captionStyle(o),
    labelStyle(o.size ?? LANDSCAPE),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  if (o.burn) for (const c of cues) lines.push(...cueDialogues(c, o))
  for (const l of labels) {
    if (l.end <= l.start) continue
    lines.push(dialogue(2, l.start, l.end, 'Label', `{\\fad(120,120)}${escapeAss(l.text)}`))
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------------------------------
// SRT

/** HH:MM:SS,mmm */
export function srtTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`
}

/** Plain SRT of the cues (original case, no styling, no labels). */
export function buildSrt(cues: readonly Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${cueText(c)}\n`).join('\n')
}

/** The same cues as WebVTT (the web's caption format: a header, a dot before the milliseconds). */
export function buildVtt(cues: readonly Cue[]): string {
  const time = (t: number): string => srtTime(t).replace(',', '.')
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${time(c.start)} --> ${time(c.end)}\n${cueText(c)}\n`).join('\n')}`
}

/**
 * A file path as an argument of ffmpeg's `ass` filter (`ass=<here>:fontsdir=<here>`): slashes instead of backslashes, `:`
 * escaped for the option parser, and the whole value single-quoted so the filter-graph parser leaves commas, brackets and
 * spaces alone. A quote inside the path closes the quote, adds an escaped quote and reopens it. Windows and macOS alike.
 * (The one helper for every filter path: `media/filters.ts`.)
 */
export const assFilterPath = filterPath
