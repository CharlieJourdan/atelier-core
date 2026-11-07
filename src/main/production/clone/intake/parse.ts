// P0 — reading one free message of the user (French, loose): links, what he wants, the language, the budget, what he can
// supply, which axes he takes from which reference. Pure and deterministic: no model, no money. It returns only what the
// message SAYS; `conversation.ts` decides what changes in the draft.
import type { INSPIRATION_AXES} from '../../../../shared/clone';
import { type CloneIntent, type IntakeField } from '../../../../shared/clone'
import { readInputs } from './inputs'

export interface Understood {
  urls: { url: string; kind: 'channel' | 'video'; axes: (typeof INSPIRATION_AXES)[number][] }[]
  intent: CloneIntent | null
  /** True when the intent was guessed from the links alone (the agent says so). */
  intentGuessed: boolean
  language: string | null
  sourceLanguage: string | null
  budgetUsd: number | null
  /** The budget was given in euros and converted. */
  euro: boolean
  humanInputs: Partial<{ face: boolean; voice: boolean; footage: boolean }>
  /** `undefined` = nothing said, `null` = « one style / you choose », a string = his pick. */
  style: string | null | undefined
}

export const EUR_TO_USD = 1.08

const strip = (s: string): string => s.replace(/[’‘`]/g, "'").normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const LANGS: [RegExp, string][] = [
  [/\b(francais|french)\b/, 'fr'], [/\b(anglais|english)\b/, 'en'], [/\b(espagnol|spanish)\b/, 'es'], [/\b(allemand|german)\b/, 'de'], [/\b(italien|italian)\b/, 'it'],
  [/\b(portugais|portuguese)\b/, 'pt'], [/\b(japonais|japanese)\b/, 'ja'], [/\b(coreen|korean)\b/, 'ko'], [/\b(arabe|arabic)\b/, 'ar'], [/\b(neerlandais|hollandais|dutch)\b/, 'nl'],
  [/\b(polonais|polish)\b/, 'pl'], [/\b(turc|turkish)\b/, 'tr'], [/\bhindi\b/, 'hi'], [/\b(russe|russian)\b/, 'ru'], [/\b(chinois|chinese|mandarin)\b/, 'zh']
]
const LANG_CODES = new Set(LANGS.map(([, c]) => c))
const langIn = (s: string): string | null => LANGS.find(([re]) => re.test(s))?.[1] ?? null

const AXIS_WORDS: [RegExp, (typeof INSPIRATION_AXES)[number]][] = [
  [/\b(script|texte|scenario|ecriture)\b/, 'script'], [/\bvoix\b/, 'voice'], [/\b(presentateur|presentatrice|personnage)\b/, 'presenter'],
  [/\b(motion|animations?|graphismes?)\b/, 'motion'], [/\b(montage|rythme|cadence)\b/, 'editing'], [/\b(musique|sons?|ambiance sonore)\b/, 'sound'],
  [/\b(sous-titres?|captions?)\b/, 'captions'], [/\b(miniatures?|titres?|habillage)\b/, 'packaging']
]

const URL_RE = /https?:\/\/[^\s<>"')]+/gi
const kindOf = (url: string): 'channel' | 'video' => (/[?&]v=|youtu\.be\/|\/shorts\/|\/live\//i.test(url) ? 'video' : 'channel')

const WORD_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, cent: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100
}
const WORDS = Object.keys(WORD_NUMBERS).join('|')
const UNIT_RE = '\\$|usd|dollars?|euros?|€|eur|bucks?|balles?'

/** A budget: « 8 $ », « $8 », « dix euros », « 5 à 10 dollars » (a range takes its upper end: the most he accepts), and, when
 *  he was asked for it, a bare « 8 », « pas plus de 20 », « environ 15 ». */
export function budgetIn(raw: string, bare: boolean): { usd: number; euro: boolean } | null {
  let s = strip(raw).replace(/(\d),(\d)/g, '$1.$2').replace(/([$€])\s*(\d+(?:\.\d+)?)/g, '$2 $1')
  s = s.replace(new RegExp(`\\b(${WORDS})\\b(?=\\s*(?:${UNIT_RE}))`, 'g'), (w) => String(WORD_NUMBERS[w]))
  if (bare) s = s.replace(new RegExp(`\\b(${WORDS})\\b`, 'g'), (w) => String(WORD_NUMBERS[w]))
  const unit = `(${UNIT_RE})`
  const range = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:a|-|et|to)\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}?`).exec(s)
  const single = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`).exec(s)
  const nums = bare ? [...s.matchAll(/(\d+(?:\.\d+)?)(?![\d.]|\s*(?:min|minutes?|videos?|jours?|days?|h\b|heures?|%|chaines?|channels?|millions?|abonnes|subscribers|ans|years|k\b))/g)].filter((m) => Number(m[1]) <= 1000) : []
  const lone = nums.length === 1 ? nums[0]![1]! : null
  const hit = range && (range[3] || bare) ? { v: Math.max(Number(range[1]), Number(range[2])), u: range[3] ?? '' }
    : single ? { v: Number(single[1]), u: single[2] ?? '' }
      : lone ? { v: Number(lone), u: '' } : null
  if (!hit || !(hit.v > 0)) return null
  const euro = /eur|€/.test(hit.u)
  return { usd: Math.round(hit.v * (euro ? EUR_TO_USD : 1) * 100) / 100, euro }
}

export function understand(raw: string, asked: IntakeField | null): Understood {
  const message = raw.slice(0, 4000)
  const s = strip(message)
  const out: Understood = { urls: [], intent: null, intentGuessed: false, language: null, sourceLanguage: null, budgetUsd: null, euro: false, humanInputs: {}, style: undefined }

  // Links, with the axes named just before each one (« le montage et la voix de <lien> »).
  let cursor = 0
  for (const url of message.match(URL_RE) ?? []) {
    const at = message.indexOf(url, cursor)
    const before = strip(message.slice(cursor, at)).replace(/\b(ma|mon|mes)\s+\w+/g, '')
    cursor = at + url.length
    out.urls.push({ url: url.replace(/[.,;]+$/, ''), kind: kindOf(url), axes: AXIS_WORDS.filter(([re]) => re.test(before)).map(([, a]) => a) })
  }

  // Intent: the strongest wording wins; links alone only guess.
  if (/\b(traduire|traduis|traduction|traduit|doublage|doubler|translate|translation|translated|dub|dubbing|dubbed)\b|\bversion (francaise|anglaise|espagnole|allemande)\b|\bde l'(anglais|espagnol|allemand|japonais|francais)\b.*\b(vers|en)\b/.test(s)) out.intent = 'translate'
  else if (/\b(melange|melanger|mixer|mixe|mix|blend|combine|combiner|fusion|fusionne|fusionner|merge)\b/.test(s)) out.intent = 'mix'
  else if (/\b(inspire|inspires|inspirer|inspiration|m'inspirer|inspired)\b/.test(s)) out.intent = 'inspiration'
  else if (/\b(ma chaine|ma propre chaine|mon canal|my channel|my own channel)\b/.test(s)) out.intent = 'own-channel'
  else if (/\b(cette video|this video)\b(?!.*\b(chaine|channel)\b)/.test(s)) out.intent = 'copy-video'
  else if (/\b(juste|seulement|uniquement|que)\b.{0,20}\b(cette|une|1)\b.{0,10}\bvideo\b|\bune seule video\b|\bcette video seulement\b|\b(just|only)\b.{0,20}\b(this|one|a|1)\b.{0,10}\bvideo\b|\b(one|single) video\b/.test(s)) out.intent = 'copy-video'
  else if (/\b(copie|copier|cloner|clone|clonage|refaire|refais|reproduire|reproduis|meme chose|comme celle|comme cette|copy|cloning|replicate|redo|remake|recreate|same as)\b/.test(s)) out.intent = 'copy-channel'
  // « clone cette vidéo <lien d'une vidéo> » is one video, not a channel.
  if (out.intent === 'copy-channel' && out.urls.length > 0 && out.urls.every((u) => u.kind === 'video')) out.intent = 'copy-video'
  // Answering about what he supplies or the budget never changes what he wants to do (« je peux la mixer moi-même »).
  if ((asked === 'humanInputs' || asked === 'testBudgetUsd') && out.urls.length === 0) out.intent = null
  if (!out.intent && asked === 'intent') {
    if (/\b(chaine|channel)\b/.test(s)) out.intent = 'copy-channel'
    else if (/\bvideo\b/.test(s)) out.intent = 'copy-video'
  }
  if (!out.intent && out.urls.length > 0) {
    out.intent = out.urls.length > 1 ? 'mix' : out.urls[0]!.kind === 'video' ? 'copy-video' : 'copy-channel'
    out.intentGuessed = true
  }

  // Languages: « en espagnol », « de l'anglais vers le français », « en français depuis l'anglais ».
  const firstLang = (re: RegExp): string | null => {
    for (const m of s.matchAll(re)) { const l = langIn(m[1]!); if (l) return l }
    return null
  }
  const supplies = Object.keys(readInputs(s, asked === 'humanInputs')).length > 0
  const noLang = asked === 'humanInputs'
  const fromL = noLang ? null : firstLang(/\b(?:depuis|a partir de|de|from)\s+(?:l'|the\s+)?\s*([a-z]+)/g)
  const toL = noLang ? null : firstLang(/\b(?:vers|en|in|into|to)\s+(?:le\s+|the\s+)?([a-z]+)/g)
  if (fromL && toL && fromL !== toL) { out.sourceLanguage = fromL; out.language = toL }
  else if (toL && !supplies) out.language = toL
  else if (fromL && out.intent === 'translate') out.sourceLanguage = fromL
  else if (asked === 'language' || asked === 'sourceLanguage') {
    const code = s.trim().replace(/[.!\s]+$/, '')
    const bare = langIn(s) ?? (LANG_CODES.has(code) ? code : null)
    if (bare) { if (asked === 'sourceLanguage') out.sourceLanguage = bare; else out.language = bare }
  }

  // Budget (a link's own digits are never a budget).
  const b = budgetIn(message.replace(URL_RE, ' '), asked === 'testBudgetUsd')
  if (b) { out.budgetUsd = b.usd; out.euro = b.euro }

  // Human inputs he can supply (face, voice, own footage): natural answers, French or English.
  out.humanInputs = readInputs(s, asked === 'humanInputs')

  // Style: only when he names one, or says there is just one / to choose for him.
  const named = /\bstyle\s*(?::|«|")\s*([^.»"\n]{3,60})/i.exec(message.replace(URL_RE, ' '))
  if (named) out.style = named[1]!.trim()
  else if (/\b(un seul style|une seule facon|choisis pour moi|tu choisis|peu importe|n'importe lequel|pas de preference|aucune preference|au choix|comme tu veux|you choose|you pick|no preference|doesn't matter|only one style|one style)\b/.test(s) || (asked === 'style' && /^(any|whatever|any one|either)\b/.test(s))) out.style = null
  else if (asked === 'style' && message.trim().length > 0) out.style = message.trim().slice(0, 60)
  return out
}

const ORDINALS: [RegExp, number][] = [[/\b(premier|premiere|1er|1ere)\b/, 0], [/\b(second|seconde|deuxieme|2eme)\b/, 1], [/\b(troisieme|3eme)\b/, 2]]

/** « le montage du premier et la voix du second » → axes by reference position (0-based), when no link is repeated. */
export function axesByOrdinal(message: string): Map<number, (typeof INSPIRATION_AXES)[number][]> {
  const out = new Map<number, (typeof INSPIRATION_AXES)[number][]>()
  const s = strip(message)
  const re = /\b(premier|premiere|1er|1ere|second|seconde|deuxieme|2eme|troisieme|3eme)\b/g
  let cursor = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const before = s.slice(cursor, m.index).replace(/\b(ma|mon|mes)\s+\w+/g, '')
    cursor = m.index + m[0].length
    const at = ORDINALS.find(([o]) => o.test(m[0]))?.[1]
    const axes = AXIS_WORDS.filter(([w]) => w.test(before)).map(([, a]) => a)
    if (at !== undefined && axes.length) out.set(at, axes)
  }
  return out
}
