// A figure the narration says in words, written in digits on screen (documentary-2): the reference writes « 4,000,000 PEOPLE » over the
// film when the voice says « four million ». English and French words; anything it cannot read stays as said (never a wrong number).
const UNITS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  zéro: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, douzaine: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60
}
const SCALES: Record<string, number> = { hundred: 100, cent: 100, cents: 100, thousand: 1e3, mille: 1e3, million: 1e6, millions: 1e6, billion: 1e9, milliard: 1e9, milliards: 1e9 }
const SKIP = new Set(['and', 'et', 'about', 'around', 'some', 'nearly', 'almost', 'environ', 'près', 'de', 'd'])

/** The figure in digits (« 4,200,000 », « 22 »), or null when the words are not a number we can read with certainty. */
export function digitsOf(said: string, lang = 'en'): string | null {
  const t = said.toLowerCase().replace(/[’']/g, ' ').replace(/-/g, ' ').trim()
  if (/^[\d\s,.]+$/.test(t)) return null
  const words = t.split(/\s+/).filter((w) => w && !SKIP.has(w))
  if (words.length === 0) return null
  let total = 0
  let group = 0
  let fraction = ''
  let afterPoint = false
  let seen = false
  for (const [i, w] of words.entries()) {
    // « a » / « an » count as one only before a scale (« a million »), never before « dozen »
    if ((w === 'a' || w === 'an' || w === 'un' || w === 'une') && !((words[i + 1] ?? '') in SCALES)) continue
    if (w === 'point' || w === 'virgule') {
      afterPoint = true
      continue
    }
    if (/^\d+([.,]\d+)?$/.test(w)) {
      group += Number(w.replace(',', '.'))
      seen = true
      continue
    }
    if (afterPoint && w in UNITS && (UNITS[w] as number) < 10) {
      fraction += String(UNITS[w])
      continue
    }
    if (w in UNITS) {
      group += UNITS[w] as number
      seen = true
      continue
    }
    if (w in SCALES) {
      const s = SCALES[w] as number
      const base = (group || 1) + (fraction ? Number(`0.${fraction}`) : 0)
      fraction = ''
      afterPoint = false
      if (s === 100) group = base * 100
      else {
        total += base * s
        group = 0
      }
      seen = true
      continue
    }
    return null
  }
  if (!seen) return null
  const n = Math.round(total + group + (fraction ? Number(`0.${fraction}`) : 0))
  if (!Number.isFinite(n) || n <= 0) return null
  // French groups thousands with a narrow no-break space: a plain space on screen
  const narrow = new RegExp('[' + String.fromCharCode(0x202f, 0xa0) + ']', 'g')
  return n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US').replace(narrow, ' ')
}

/** The figure at the head of a phrase in digits and the rest as what it counts (« Four point two million people » → 4,200,000 · people). */
export function splitFigure(said: string, lang = 'en'): { digits: string; rest?: string } | null {
  const words = said.trim().split(/\s+/)
  for (let n = words.length; n >= 1; n--) {
    const digits = digitsOf(words.slice(0, n).join(' '), lang)
    if (digits) {
      const rest = words.slice(n).join(' ').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
      return { digits, ...(rest ? { rest } : {}) }
    }
  }
  return null
}
