// What in a timed narration deserves an animated graphic (docs/ENGINE-SPEC.md §21.1, §25), found without any model: a figure said aloud (a
// counter), a person named with their role (a lower third), a list announced or numbered (a list reveal), a quotation (a quote card), a
// place after « à / en / in » (a map pin) and the turns of a several-voices script (a message conversation). Every string a cue carries is
// copied from the script and every time comes from the word times, so a graphic shows when its words are said (§21.9: nothing invented).
// Pure: same words, same cues. The director (`nodes/director-motion.ts`) chooses among them within its budget.
import type { MotionTemplate } from '../formats/motion'
import type { Beat, Word } from '../formats/timing'
import { normWord, type ParsedScript } from './script'

export interface MotionCue {
  template: MotionTemplate
  /** Seconds in the film: when the graphic should come, and the earliest it may leave. */
  startS: number
  endS: number
  priority: number
  /** The beat it belongs to. */
  beat: number
  /** The template's props (checked against its schema by the director). Times inside are from the overlay's own start. */
  props: Record<string, unknown>
  /** Same key = same thing said twice (a person is introduced once). */
  key: string
  /** What the graphic itself writes (a name, the digits of a figure, a place): a label that only repeats it is dropped when the graphic is kept. */
  covers?: string[]
}

const clean = (w: string): string => w.replace(/^[«“"‘'([]+|[»”"’'),;:.!?…\]]+$/gu, '')
const isCap = (w: string): boolean => /^\p{Lu}[\p{L}'’-]+$/u.test(clean(w))
const endsPhrase = (w: string): boolean => /[,;:.!?…»”"]$/u.test(w)
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const round = (n: number): number => Math.round(n * 1000) / 1000

/** The beat a word index belongs to. */
function beatOf(beats: readonly Beat[], i: number): number {
  return (beats.find((b) => i >= b.firstWord && i <= b.lastWord) ?? beats.at(-1))?.i ?? 0
}

// ---- figures -----------------------------------------------------------------------------------------------------------------------------

const SCALE = 'milliards?|millions?|mille|billions?|thousand'
const UNIT = '%|pour cent|€|euros?|dollars?|km|kilomètres?|mètres?|kg|tonnes?|ans?|années?|jours?|heures?|minutes?|personnes?|habitants?|morts?|victimes?|hommes?|femmes?|enfants?|navires?|bateaux?|soldats?|secondes?|fois'
const FIGURE = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:,(\\d{1,3}))?(?:\\s*(?:((?:${SCALE})\\b(?:\\s+(?:d[’']|de\\s+)\\p{L}+)?)|(${UNIT})(?![\\p{L}])))?`, 'giu')

/** Figures said in the narration: « 12 000 personnes », « 3,5 millions d’euros », « 40 % ». Years and small bare numbers are not figures. */
export function figureCues(words: readonly Word[], beats: readonly Beat[]): MotionCue[] {
  const tokens = words.map((w) => w.w)
  const text = tokens.join(' ')
  const starts: number[] = []
  let at = 0
  for (const t of tokens) {
    starts.push(at)
    at += t.length + 1
  }
  const tokenAt = (char: number): number => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] as number) <= char) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const out: MotionCue[] = []
  for (const m of text.matchAll(FIGURE)) {
    const int = (m[1] as string).replace(/[ \u00a0\u202f]/g, '')
    const dec = m[2] ?? ''
    const unit = m[3] ?? m[4] ?? ''
    const value = Number(dec ? `${int}.${dec}` : int)
    const isYear = !dec && !m[1]?.match(/[ \u00a0\u202f]/) && int.length === 4 && value >= 1000 && value <= 2100
    // a day of the month (« le 14 juillet »), a year or a small bare number does not make a figure
    if (!Number.isFinite(value) || (isYear && !unit) || (value < 100 && !unit && !dec)) continue
    const first = tokenAt(m.index ?? 0)
    const last = tokenAt((m.index ?? 0) + m[0].length - 1)
    // what it counts: the rest of the phrase after the number, else the words before it
    let label = ''
    for (let k = last + 1; k < tokens.length && (words[k] as Word).sentence === (words[last] as Word).sentence; k++) {
      label += (label ? ' ' : '') + clean(tokens[k] as string)
      if (endsPhrase(tokens[k] as string) || label.length > 60) break
    }
    if (label.length < 8) {
      const before: string[] = []
      for (let k = first - 1; k >= 0 && (words[k] as Word).sentence === (words[first] as Word).sentence && before.length < 7; k--) before.unshift(clean(tokens[k] as string))
      label = before.join(' ')
    }
    // the unit the template shows next to the number is what was said (« millions d’euros »); the label is the rest
    const suffix = unit ? ` ${unit.trim()}` : ''
    label = label.replace(new RegExp(`^${unit.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'iu'), '').trim()
    if (label.length < 6 || label.length > 70 || suffix.length > 24) continue
    const startS = Math.max(0, (words[first] as Word).start - 0.3)
    out.push({
      template: 'figure',
      startS: round(startS),
      endS: round(startS + 3.8),
      priority: 80,
      beat: beatOf(beats, first),
      props: { value, from: 0, decimals: dec.length, prefix: '', suffix, label: cap(label) },
      key: `figure:${int}.${dec}${unit}`,
      covers: [`${int}${dec}`]
    })
  }
  return out
}

// ---- people ------------------------------------------------------------------------------------------------------------------------------

const TITLES = new Set(
  [
    'professeur', 'professeure', 'docteur', 'docteure', 'capitaine', 'colonel', 'général', 'commandant', 'lieutenant', 'sergent', 'président', 'présidente', 'ministre', 'maire',
    'chef', 'reine', 'roi', 'empereur', 'ingénieur', 'ingénieure', 'inspecteur', 'inspectrice', 'commissaire', 'détective', 'juge', 'avocat', 'avocate', 'journaliste',
    'astronome', 'physicien', 'physicienne', 'chimiste', 'explorateur', 'exploratrice', 'amiral', 'gardien', 'gardienne', 'témoin', 'professor', 'doctor', 'captain', 'president',
    'minister', 'king', 'queen', 'emperor', 'detective', 'inspector', 'mayor', 'judge', 'engineer', 'sergeant', 'admiral', 'explorer', 'keeper', 'witness'
  ].map(normWord)
)

/** A person named after a title (« le professeur Marie Curie », « le capitaine Dupont »): the name is said, the title is their role. */
export function personCues(words: readonly Word[], beats: readonly Beat[]): MotionCue[] {
  const out: MotionCue[] = []
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i] as Word
    if (!TITLES.has(normWord(clean(w.w))) || endsPhrase(w.w)) continue
    const name: string[] = []
    for (let k = i + 1; k < words.length && name.length < 3; k++) {
      const t = (words[k] as Word).w
      if (!isCap(t) || (words[k] as Word).sentence !== w.sentence) break
      name.push(clean(t))
      if (endsPhrase(t)) break
    }
    if (name.length === 0) continue
    const first = i + 1
    const startS = Math.max(0, (words[first] as Word).start - 0.35)
    out.push({
      template: 'lower-third',
      startS: round(startS),
      endS: round(startS + 4),
      priority: 50,
      beat: beatOf(beats, i),
      props: { name: name.join(' '), role: cap(clean(w.w)) },
      key: `person:${normWord(name.join(' '))}`,
      covers: [name.join(' ')]
    })
  }
  return out
}

/** A person the scene pass named with a role (Claude, `run`): found by name in the beat's words, else the beat's start. */
export function namedPersonCue(words: readonly Word[], beat: Beat, person: { name: string; role: string }): MotionCue | null {
  const want = person.name.split(/\s+/).map(normWord)
  for (let k = beat.firstWord; k <= beat.lastWord - want.length + 1; k++) {
    if (want.every((n, j) => normWord(clean((words[k + j] as Word).w)) === n)) {
      const startS = Math.max(0, (words[k] as Word).start - 0.35)
      return { template: 'lower-third', startS: round(startS), endS: round(startS + 4), priority: 52, beat: beat.i, props: { name: person.name, role: person.role }, key: `person:${normWord(person.name)}`, covers: [person.name] }
    }
  }
  return null
}

// ---- lists -------------------------------------------------------------------------------------------------------------------------------

const ORDINAL = /^(?:premi[eè]rement|deuxi[eè]mement|troisi[eè]mement|quatri[eè]mement|cinqui[eè]mement|sixi[eè]mement|d[’']abord|ensuite|enfin|num[eé]ro\s+\d+|n°\s?\d+|\d+\.)$/iu
const CONJ = new Set(['et', 'ou', 'and', 'or'])

interface Sentence {
  index: number
  first: number
  last: number
}
function sentencesOf(words: readonly Word[]): Sentence[] {
  const out: Sentence[] = []
  words.forEach((w, i) => {
    const cur = out.at(-1)
    if (cur && cur.index === w.sentence) cur.last = i
    else out.push({ index: w.sentence, first: i, last: i })
  })
  return out
}

/** Lists the narration announces (« trois choses comptent : le temps, l’argent et la patience ») or numbers (« premièrement… ensuite… enfin… »). */
export function listCues(words: readonly Word[], beats: readonly Beat[]): MotionCue[] {
  const out: MotionCue[] = []
  const sents = sentencesOf(words)
  const tok = (i: number): string => (words[i] as Word).w
  // announced with a colon
  for (const s of sents) {
    let colon = -1
    for (let i = s.first; i < s.last; i++) if (/:$/.test(tok(i))) colon = i
    if (colon < 0) continue
    const items: { text: string; first: number; last: number }[] = []
    let cur: number[] = []
    const close = (): void => {
      if (cur.length > 0) items.push({ text: clean(cur.map(tok).join(' ')), first: cur[0] as number, last: cur.at(-1) as number })
      cur = []
    }
    for (let i = colon + 1; i <= s.last; i++) {
      if (CONJ.has(normWord(clean(tok(i)))) && cur.length > 0) {
        close()
        continue
      }
      cur.push(i)
      if (/,$/.test(tok(i))) close()
    }
    close()
    if (items.length < 3 || items.length > 6 || items.some((it) => it.text.length > 48 || it.last - it.first > 6)) continue
    const heading = colon - s.first + 1 <= 5 ? clean(Array.from({ length: colon - s.first + 1 }, (_, k) => tok(s.first + k)).join(' ')).trim() : ''
    const startS = Math.max(0, (words[items[0]!.first] as Word).start - 1)
    const lastEnd = (words[items.at(-1)!.last] as Word).end
    out.push({
      template: 'list',
      startS: round(startS),
      endS: round(lastEnd + 2),
      priority: 70,
      beat: beatOf(beats, s.first),
      props: {
        ...(heading && heading.length <= 50 ? { heading: cap(heading) } : {}),
        items: items.map((it) => ({ text: cap(it.text), atS: round((words[it.first] as Word).start - startS) })),
        numbered: true,
        order: 'asc'
      },
      key: `list:${s.index}`
    })
  }
  // numbered one sentence after the other
  let run: { s: Sentence; skip: number }[] = []
  const flush = (): void => {
    if (run.length >= 3 && run.length <= 6) {
      const items = run.map(({ s, skip }) => {
        const first = s.first + skip
        let end = first
        while (end < s.last && !/[,;:.!?…]$/.test(tok(end)) && end - first < 6) end++
        return { text: cap(clean(Array.from({ length: end - first + 1 }, (_, k) => tok(first + k)).join(' '))), first }
      })
      if (items.every((it) => it.text.length >= 3 && it.text.length <= 48)) {
        const startS = Math.max(0, (words[items[0]!.first] as Word).start - 1)
        const lastEnd = (words[(run.at(-1) as { s: Sentence }).s.last] as Word).end
        if (lastEnd + 1.5 - startS <= 20) {
          out.push({
            template: 'list',
            startS: round(startS),
            endS: round(lastEnd + 1.5),
            priority: 68,
            beat: beatOf(beats, items[0]!.first),
            props: { items: items.map((it) => ({ text: it.text, atS: round((words[it.first] as Word).start - startS) })), numbered: true, order: 'asc' },
            key: `list:o${run[0]!.s.index}`
          })
        }
      }
    }
    run = []
  }
  for (const s of sents) {
    // « Premièrement, … », « Numéro 3 : … », « 2. … »: the marker is one word or two
    const bare = (t: string): string => t.replace(/[,;:]$/, '')
    const m = ORDINAL.test(bare(tok(s.first))) ? 1 : s.first < s.last && ORDINAL.test(`${bare(tok(s.first))} ${bare(tok(s.first + 1))}`) ? 2 : 0
    if (m > 0 && s.last - s.first >= m) run.push({ s, skip: m })
    else flush()
  }
  flush()
  return out
}

// ---- quotations ---------------------------------------------------------------------------------------------------------------------------

const SAYS = /^(?:dit|disait|déclare|déclarait|affirme|écrit|écrivait|said|says|wrote|selon|according)$/iu

/** Quotations between « » or “ ”: the card shows the words as said, with the speaker when a name is next to the quotation. */
export function quoteCues(words: readonly Word[], beats: readonly Beat[]): MotionCue[] {
  const out: MotionCue[] = []
  let open = -1
  for (let i = 0; i < words.length; i++) {
    const t = (words[i] as Word).w
    if (open < 0 && /^[«“]/u.test(t)) open = i
    if (open >= 0 && /[»”][,;:.!?…]*$/u.test(t) && (i > open || t.length > 1)) {
      const inner = Array.from({ length: i - open + 1 }, (_, k) => (words[open + k] as Word).w).join(' ').replace(/^[«“]\s*/u, '').replace(/\s*[»”][^\s]*$/u, '')
      const n = inner.split(/\s+/).length
      if (n >= 4 && n <= 28 && inner.length <= 180) {
        const after: string[] = []
        for (let k = i + 1; k < words.length && k <= i + 5; k++) {
          const w = (words[k] as Word).w
          if (after.length === 0 && SAYS.test(clean(w))) continue
          if (isCap(w)) after.push(clean(w))
          else if (after.length > 0) break
          if (endsPhrase(w)) break
        }
        const startS = Math.max(0, (words[open] as Word).start - 0.2)
        const endS = Math.min(startS + 10, Math.max(startS + 3.5, (words[i] as Word).end + 1))
        out.push({
          template: 'quote',
          startS: round(startS),
          endS: round(endS),
          priority: 60,
          beat: beatOf(beats, open),
          props: { text: inner, ...(after.length > 0 && after.join(' ').length <= 50 ? { attribution: after.join(' ') } : {}) },
          key: `quote:${open}`
        })
      }
      open = -1
    }
  }
  return out
}

// ---- places ------------------------------------------------------------------------------------------------------------------------------

const PLACE_PREPS = new Set(['à', 'au', 'aux', 'en', 'dans', 'vers', 'près', 'in', 'at', 'near'].map(normWord))
const SMALL = new Set(['le', 'la', 'les', 'l', 'du', 'de', 'des', 'the'].map(normWord))
const NOT_PLACES = new Set(['il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous', 'je', 'tu', 'mais', 'et', 'ou', 'puis', 'ensuite', 'enfin', 'alors', 'cette', 'ce', 'ces', 'un', 'une', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'dieu'].map(normWord))

/** A place named after a preposition (« à Ouessant », « in Tokyo »): one or two capitalised words. */
export function placeCues(words: readonly Word[], beats: readonly Beat[]): MotionCue[] {
  const out: MotionCue[] = []
  for (let i = 0; i < words.length - 1; i++) {
    const prep = words[i] as Word
    if (!PLACE_PREPS.has(normWord(clean(prep.w))) || endsPhrase(prep.w)) continue
    let k = i + 1
    while (k < words.length && SMALL.has(normWord(clean((words[k] as Word).w))) && k < i + 3) k++
    const place: string[] = []
    const firstPlace = k
    for (; k < words.length && place.length < 2; k++) {
      const w = words[k] as Word
      if (!isCap(w.w) || w.sentence !== prep.sentence || NOT_PLACES.has(normWord(clean(w.w)))) break
      place.push(clean(w.w))
      if (endsPhrase(w.w)) break
    }
    if (place.length === 0) continue
    const startS = Math.max(0, (words[firstPlace] as Word).start - 0.3)
    out.push({ template: 'map-pin', startS: round(startS), endS: round(startS + 3.4), priority: 30, beat: beatOf(beats, i), props: { place: place.join(' ') }, key: `place:${normWord(place.join(' '))}`, covers: [place.join(' ')] })
  }
  return out
}

// ---- the message conversation -------------------------------------------------------------------------------------------------------------

/** The longest a conversation overlay stays and the most bubbles it holds: a longer talk goes on in the next overlay (the list starts over). */
export const CONVERSATION_MAX_S = 90
const CONVERSATION_MAX_TURNS = 60

/**
 * The several-voices script's talk as conversation overlays (§19.5): contiguous lines of characters (a narrator's stretch longer than 4 s splits
 * the talk), one bubble per sentence (a very short sentence joins the next), each timed by the first word of its line. The first character
 * writes (right, in colour), the others answer (left). `words[i]` is `parsed.tokens[i]`, which is how a bubble knows its time.
 */
export function conversationCues(parsed: ParsedScript, words: readonly Word[], beats: readonly Beat[], durationS: number): MotionCue[] {
  if (!parsed.speakers || parsed.speakers.length < 2 || parsed.tokens.length !== words.length) return []
  const out: MotionCue[] = []
  // runs of dialogue tokens
  const runs: { first: number; last: number }[] = []
  parsed.tokens.forEach((t, i) => {
    if (!t.speaker) return
    const cur = runs.at(-1)
    if (cur && ((cur.last === i - 1) || (words[i] as Word).start - (words[cur.last] as Word).end <= 4)) cur.last = i
    else runs.push({ first: i, last: i })
  })
  const order = parsed.speakers
  const speakers = order.map((name, i) => ({ name: name.charAt(0) + name.slice(1).toLowerCase(), side: i === 0 ? ('right' as const) : ('left' as const) }))
  for (const run of runs) {
    // bubbles: sentences inside the run, a short one joined to the next of the same paragraph
    const bubbles: { speaker: number; first: number; last: number }[] = []
    for (const s of parsed.sentences) {
      if (s.last < run.first || s.first > run.last) continue
      const speaker = parsed.tokens[s.first]?.speaker
      if (!speaker) continue
      const prev = bubbles.at(-1)
      const idx = order.indexOf(speaker)
      if (prev && prev.speaker === idx && prev.last - prev.first < 2 && parsed.tokens[prev.last]?.paragraph === s.paragraph) prev.last = s.last
      else bubbles.push({ speaker: idx, first: s.first, last: s.last })
    }
    if (new Set(bubbles.map((b) => b.speaker)).size < 2) continue
    // chunks that fit an overlay
    let chunk: typeof bubbles = []
    const emit = (): void => {
      if (chunk.length === 0 || new Set(chunk.map((b) => b.speaker)).size < 2) {
        chunk = []
        return
      }
      const startS = Math.max(0, (words[(chunk[0] as { first: number }).first] as Word).start - 1)
      const endS = Math.min(durationS, (words[(chunk.at(-1) as { last: number }).last] as Word).end + 1.2)
      const used = [...new Set(chunk.map((b) => b.speaker))].sort((a, b) => a - b)
      // somebody writes in colour: when the talk's first character is not in this part, the first one who is
      const sides = used.map((u, k) => ({ ...(speakers[u] as (typeof speakers)[number]), side: used.includes(0) ? (speakers[u] as (typeof speakers)[number]).side : k === 0 ? ('right' as const) : ('left' as const) }))
      out.push({
        template: 'conversation',
        startS: round(startS),
        endS: round(endS),
        priority: 100,
        beat: beatOf(beats, (chunk[0] as { first: number }).first),
        props: {
          speakers: sides,
          turns: chunk.map((b) => ({
            speaker: used.indexOf(b.speaker),
            text: Array.from({ length: b.last - b.first + 1 }, (_, k) => (parsed.tokens[b.first + k] as { w: string }).w).join(' '),
            atS: round(Math.max(0, (words[b.first] as Word).start - startS))
          }))
        },
        key: `conversation:${(chunk[0] as { first: number }).first}`
      })
      chunk = []
    }
    for (const b of bubbles) {
      const from = chunk[0] ? (words[chunk[0].first] as Word).start : 0
      if (chunk.length > 0 && ((words[b.last] as Word).end - from > CONVERSATION_MAX_S || chunk.length >= CONVERSATION_MAX_TURNS)) emit()
      chunk.push(b)
    }
    emit()
  }
  return out
}
