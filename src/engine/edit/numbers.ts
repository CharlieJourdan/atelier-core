// The numbers the voice says (motion-montage, docs/ENGINE-SPEC.md §21.11): « multiplié par vingt », « dix mille florins », « 40 % » found
// in the timed words, read in French or English (in letters or in digits), with what they mean (a factor, a share, an amount of something,
// a year, a large count) and how they are written on screen (« ×20 », « 10 000 florins », « 40 % », « 1637 »). The editing kit sets them
// as kinetic type on their word (edit/grammar.ts). Pure.
import type { Word } from '../formats/timing'

export const NUMBER_KINDS = ['times', 'percent', 'amount', 'year', 'count'] as const
export type NumberKind = (typeof NUMBER_KINDS)[number]

export interface SpokenNumber {
  /** First and last word of the phrase (the unit included), indexes in the words. */
  first: number
  last: number
  /** When the number itself starts being said, and when the phrase ends (seconds). */
  atS: number
  endS: number
  value: number
  kind: NumberKind
  /** As written on screen. */
  text: string
}

/** The narrow no-break space French sets between a number's groups and before « % ». */
const NARROW = String.fromCharCode(0x202f)

const FR: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100, cents: 100,
  mille: 1000, million: 1e6, millions: 1e6, milliard: 1e9, milliards: 1e9
}
const EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9
}
/** Words that join two parts of one number (« vingt et un », « one hundred and five »). */
const JOIN = new Set(['et', 'and'])
/** What a number counts, when the word after it says (time units are left out: « trois mois » is not worth a title). */
const UNITS = new Set([
  'florins', 'florin', 'euros', 'euro', 'dollars', 'dollar', 'livres', 'francs', 'franc', 'ducats', 'ecus', 'pieces', 'tonnes', 'tonne', 'kilos',
  'kilometres', 'km', 'metres', 'habitants', 'morts', 'soldats', 'hommes', 'personnes', 'navires', 'bulbes', 'maisons', 'ouvriers', 'esclaves',
  'pounds', 'guilders', 'tons', 'miles', 'kilometers', 'meters', 'people', 'men', 'soldiers', 'dead', 'ships', 'workers', 'slaves', 'houses'
])
const TIMES_BEFORE = [['multiplie', 'par'], ['multiplies', 'par'], ['multipliee', 'par'], ['multipliees', 'par'], ['multiplied', 'by']]
const TIMES_AFTER = new Set(['fois', 'times'])
const FACTOR_WORDS: Record<string, number> = { double: 2, doubles: 2, doublee: 2, doublees: 2, doubled: 2, triple: 3, triples: 3, triplee: 3, tripled: 3, quadruple: 4, quadrupled: 4 }

/** A word folded for reading: lower case, no accents, no punctuation but the hyphen and digits' separators. */
export const fold = (w: string): string =>
  w
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9%×\-.,\s]/g, '')
    .replace(/[.,]+$/, '')
    .trim()

/** The value of a spelled number's parts in order (« mille », « six », « cent », « trente », « sept » → 1637), or null. */
export function spelledValue(parts: readonly number[]): number | null {
  if (!parts.length) return null
  let total = 0
  let current = 0
  for (const [i, v] of parts.entries()) {
    if (v === 100) current = (current || 1) * 100
    else if (v >= 1000) {
      total += (current || 1) * v
      current = 0
    } else if (v === 20 && parts[i - 1] === 4 && current % 100 === 4) current += 76 // « quatre-vingt » = 80
    else current += v
  }
  return total + current
}

/** The values of one word's pieces (« trente-sept » → [30, 7], « 1637 » → [1637]); null when it is not (all) a number. */
function pieces(word: string, table: Record<string, number>): number[] | null {
  const f = fold(word)
  if (/^\d+([.,]\d+)?$/.test(f)) return [Number(f.replace(',', '.'))]
  const parts = f.split('-').filter(Boolean)
  if (!parts.length) return null
  const out: number[] = []
  for (const p of parts) {
    const v = table[p]
    if (v === undefined) return null
    out.push(v)
  }
  return out
}

/** A number as written on screen: digits grouped by thousands (a narrow space in French, a comma in English); a year as is. */
export function writeNumber(v: number, lang: 'fr' | 'en', year = false): string {
  if (year || Math.abs(v) < 10000) return String(Math.round(v * 100) / 100).replace('.', lang === 'fr' ? ',' : '.')
  return Math.round(v).toLocaleString('en-US').replace(/,/g, lang === 'fr' ? NARROW : ',')
}

/** The numbers said in `words` (French unless `lang` is 'en'), in time order. */
export function spokenNumbers(words: readonly Word[], lang: 'fr' | 'en' = 'fr'): SpokenNumber[] {
  const table = lang === 'en' ? EN : FR
  const out: SpokenNumber[] = []
  const f = words.map((w) => fold(w.w))
  let i = 0
  while (i < words.length) {
    const factor = FACTOR_WORDS[f[i] ?? '']
    if (factor !== undefined) {
      const w = words[i] as Word
      out.push({ first: i, last: i, atS: w.start, endS: w.end, value: factor, kind: 'times', text: `×${factor}` })
      i++
      continue
    }
    const first = pieces(words[i]?.w ?? '', table)
    if (!first) {
      i++
      continue
    }
    // the whole number: the next words that are numbers too (and « et » / « and » between two of them), digit groups of three (« 10 000 »)
    const parts = [...first]
    let j = i + 1
    let digits = /^\d+$/.test(f[i] ?? '') ? (f[i] as string) : null
    while (j < words.length) {
      // a number never runs past a comma or a full stop (« … par vingt. Un seul … »)
      if (/[,;:.!?…]["»”)]?$/.test(words[j - 1]?.w ?? '')) break
      if (digits !== null && /^\d{3}$/.test(f[j] ?? '')) {
        digits += f[j]
        parts.splice(0, parts.length, Number(digits))
        j++
        continue
      }
      const next = pieces(words[j]?.w ?? '', table)
      if (next && digits === null) {
        parts.push(...next)
        j++
        continue
      }
      if (JOIN.has(f[j] ?? '') && pieces(words[j + 1]?.w ?? '', table) && digits === null) {
        j++
        continue
      }
      break
    }
    const value = digits !== null ? Number(digits) : spelledValue(parts)
    let last = j - 1
    if (value === null) {
      i = j
      continue
    }
    const before = [f[i - 2], f[i - 1]]
    const after = f[j] ?? ''
    let kind: NumberKind | null = null
    let text = writeNumber(value, lang)
    if (TIMES_BEFORE.some(([a, b]) => before[0] === a && before[1] === b) || TIMES_AFTER.has(after)) {
      kind = 'times'
      text = `×${text}`
      if (TIMES_AFTER.has(after)) last = j
    } else if (after === '%' || after === 'percent' || (after === 'pour' && f[j + 1] === 'cent') || (after === 'per' && f[j + 1] === 'cent')) {
      kind = 'percent'
      text = lang === 'fr' ? `${text}${NARROW}%` : `${text}%`
      last = after === '%' || after === 'percent' ? j : j + 1
    } else if (UNITS.has(after)) {
      kind = 'amount'
      text = `${text} ${(words[j] as Word).w.replace(/[^\p{L}]/gu, '')}`
      last = j
    } else if (value >= 1000 && value <= 2100 && Number.isInteger(value)) {
      kind = 'year'
      text = writeNumber(value, lang, true)
    } else if (value >= 1000) kind = 'count'
    if (kind) {
      const a = words[i] as Word
      const b = words[Math.min(last, words.length - 1)] as Word
      out.push({ first: i, last, atS: a.start, endS: b.end, value, kind, text })
    }
    i = Math.max(j, last + 1)
  }
  return out
}
