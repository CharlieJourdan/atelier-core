// Speech preparation (docs/ENGINE-SPEC.md §19.1): what the narrator says for each written token. Numbers, years,
// decimals and percentages are spelled the way a narrator says them in the video's language (French and English in
// v2; other languages keep the digits). The display text (captions, labels) keeps the written form: the spoken form is
// built token by token, so every spoken word maps back to the script word it came from.

const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const FR_TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']

function frBelow100(n: number): string {
  if (n <= 16) return FR_UNITS[n] as string
  if (n < 20) return `dix-${FR_UNITS[n - 10] as string}`
  const t = Math.floor(n / 10)
  let u = n % 10
  if (t === 7 || t === 9) u += 10 // soixante-dix, quatre-vingt-dix
  const tens = FR_TENS[t] as string
  if (u === 0) return t === 8 ? 'quatre-vingts' : tens
  if ((u === 1 || u === 11) && t < 8) return `${tens} et ${frBelow100(u)}`
  return `${tens}-${frBelow100(u)}`
}

function frBelow1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h === 0) return frBelow100(r)
  const head = h === 1 ? 'cent' : `${FR_UNITS[h] as string} cent${r === 0 ? 's' : ''}`
  return r === 0 ? head : `${head} ${frBelow100(r)}`
}

export function frenchNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n)
  if (n < 1000) return frBelow1000(n)
  const parts: string[] = []
  const billions = Math.floor(n / 1e9)
  const millions = Math.floor((n % 1e9) / 1e6)
  const thousands = Math.floor((n % 1e6) / 1000)
  const rest = n % 1000
  if (billions) parts.push(`${frBelow1000(billions)} milliard${billions > 1 ? 's' : ''}`)
  if (millions) parts.push(`${frBelow1000(millions)} million${millions > 1 ? 's' : ''}`)
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${frBelow1000(thousands).replace(/(cent|vingt)s$/, '$1')} mille`)
  if (rest) parts.push(frBelow1000(rest))
  return parts.join(' ')
}

const EN_SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function enBelow1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const tail = r < 20 ? (EN_SMALL[r] as string) : `${EN_TENS[Math.floor(r / 10)] as string}${r % 10 ? '-' + (EN_SMALL[r % 10] as string) : ''}`
  if (h === 0) return tail
  return r === 0 ? `${EN_SMALL[h] as string} hundred` : `${EN_SMALL[h] as string} hundred ${tail}`
}

export function englishNumber(n: number, asYear = false): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n)
  // years from 1100 to 1999 and 2010 to 2099 are read in two halves ("nineteen fourteen")
  if (asYear && ((n >= 1100 && n < 2000) || (n >= 2010 && n < 2100)) && n % 100 !== 0) {
    const hi = Math.floor(n / 100)
    const lo = n % 100
    return `${enBelow1000(hi)} ${lo < 10 ? 'oh ' + (EN_SMALL[lo] as string) : enBelow1000(lo)}`
  }
  if (n < 1000) return enBelow1000(n)
  const parts: string[] = []
  const scales: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]
  let rest = n
  for (const [size, name] of scales) {
    const q = Math.floor(rest / size)
    if (q) parts.push(`${enBelow1000(q)} ${name}`)
    rest %= size
  }
  if (rest) parts.push(enBelow1000(rest))
  return parts.join(' ')
}

const spellInt = (n: number, lang: string, asYear: boolean): string | null =>
  lang === 'fr' ? frenchNumber(n) : lang === 'en' ? englishNumber(n, asYear) : null

/** The spoken form of one written token (no number inside: unchanged). */
export function speakToken(token: string, lang: string): string {
  const m = /^([^\p{N}]*?)(\d+(?:[.,]\d+)?)(%?)([^\p{N}]*)$/u.exec(token)
  if (!m) return token
  const [, before = '', num = '', pct = '', after = ''] = m
  const decimalMark = lang === 'fr' ? ',' : '.'
  const sep = num.includes(decimalMark) ? decimalMark : null
  let spoken: string | null
  if (sep) {
    const [i = '0', d = ''] = num.split(sep)
    const whole = spellInt(Number(i), lang, false)
    const frac = d.length <= 2 && !d.startsWith('0') ? spellInt(Number(d), lang, false) : d.split('').map((c) => spellInt(Number(c), lang, false)).join(' ')
    spoken = whole && frac ? `${whole} ${lang === 'fr' ? 'virgule' : 'point'} ${frac}` : null
  } else {
    const n = Number(num.replace(/[.,]/g, ''))
    const asYear = num.length === 4 && !pct && /^\D*$/.test(after.replace(/[,.;:!?…»)"]/g, ''))
    spoken = spellInt(n, lang, asYear)
  }
  if (!spoken) return token
  const percent = pct ? (lang === 'fr' ? ' pour cent' : ' percent') : ''
  return `${before}${spoken}${percent}${after}`
}

/**
 * Spoken form of every token, same length as `tokens`. A number written with spaces between thousands
 * ("10 000", French style) is spoken once, on its first token; the following groups get an empty form.
 */
export function spokenForms(tokens: readonly string[], lang: string): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string
    if (/^\d{1,3}$/.test(t) && /^\d{3}\b/.test(tokens[i + 1] ?? '')) {
      let j = i + 1
      let digits = t
      while (/^\d{3}([^\p{N}]*)$/u.test(tokens[j] ?? '')) {
        digits += (tokens[j] as string).slice(0, 3)
        j++
      }
      const tail = (tokens[j - 1] as string).slice(3)
      out.push(speakToken(digits + tail, lang))
      for (let k = i + 1; k < j; k++) out.push('')
      i = j - 1
      continue
    }
    out.push(speakToken(t, lang))
  }
  return out
}
