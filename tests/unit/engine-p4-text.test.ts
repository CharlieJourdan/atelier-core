// Lot P4, text layer (docs/ENGINE-SPEC.md §17, §19, §20): script parsing, spoken numbers, anchors, key terms, the
// deterministic aligner (accuracy on synthetic voices with known word times) and the word-sequence matcher.
import { describe, expect, it } from 'vitest'
import { matchSequences, interpolate, spokenText } from '../../src/engine/media/word-timing'
import { alignTokens, boundaryOf, syllables, type AlignToken, type Region } from '../../src/engine/text/align'
import { anchorOf, countWords, endsSentence, findAnchor, keyTerms, normWord, parseScript } from '../../src/engine/text/script'
import { englishNumber, frenchNumber, speakToken, spokenForms } from '../../src/engine/text/spoken'

describe('frenchNumber', () => {
  it.each([
    [0, 'zéro'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [21, 'vingt et un'],
    [71, 'soixante et onze'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [1000, 'mille'],
    [1810, 'mille huit cent dix'],
    [1914, 'mille neuf cent quatorze'],
    [2000, 'deux mille'],
    [200_000, 'deux cent mille'],
    [1_000_000, 'un million'],
    [2_500_000, 'deux millions cinq cent mille']
  ])('%i is read « %s »', (n, spoken) => {
    expect(frenchNumber(n)).toBe(spoken)
  })

  it('80 000 is « quatre-vingt mille » (quatre-vingts loses its s before mille)', () => {
    expect(frenchNumber(80_000)).toBe('quatre-vingt mille')
  })

  it('keeps the digits for what it cannot spell (negative, fractional, huge)', () => {
    expect(frenchNumber(-3)).toBe('-3')
    expect(frenchNumber(2.5)).toBe('2.5')
    expect(frenchNumber(1e12)).toBe('1000000000000')
  })
})

describe('englishNumber', () => {
  it.each([
    [0, 'zero'],
    [16, 'sixteen'],
    [21, 'twenty-one'],
    [101, 'one hundred one'],
    [1810, 'one thousand eight hundred ten'],
    [80_000, 'eighty thousand'],
    [1_000_000, 'one million'],
    [2_500_000, 'two million five hundred thousand']
  ])('%i is read « %s »', (n, spoken) => {
    expect(englishNumber(n)).toBe(spoken)
  })

  it('reads years in two halves, except round centuries and 2000-2009', () => {
    expect(englishNumber(1914, true)).toBe('nineteen fourteen')
    expect(englishNumber(1805, true)).toBe('eighteen oh five')
    expect(englishNumber(2025, true)).toBe('twenty twenty-five')
    expect(englishNumber(2005, true)).toBe('two thousand five')
    expect(englishNumber(2000, true)).toBe('two thousand')
    expect(englishNumber(1900, true)).toBe('one thousand nine hundred')
  })
})

describe('speakToken (R19 spoken forms)', () => {
  it('keeps the punctuation around a year', () => {
    expect(speakToken('1914,', 'fr')).toBe('mille neuf cent quatorze,')
    expect(speakToken('(1914)', 'en')).toBe('(nineteen fourteen)')
    expect(speakToken('1914.', 'en')).toBe('nineteen fourteen.')
  })

  it('reads the decimal mark of the language: comma in French, point in English', () => {
    expect(speakToken('3,5', 'fr')).toBe('trois virgule cinq')
    expect(speakToken('3.5', 'en')).toBe('three point five')
    expect(speakToken('3,05', 'fr')).toBe('trois virgule zéro cinq')
  })

  it('spells percentages', () => {
    expect(speakToken('45%', 'fr')).toBe('quarante-cinq pour cent')
    expect(speakToken('45%', 'en')).toBe('forty-five percent')
    expect(speakToken('12,5%.', 'fr')).toBe('douze virgule cinq pour cent.')
  })

  it('leaves words and other languages untouched', () => {
    expect(speakToken('bonjour', 'fr')).toBe('bonjour')
    expect(speakToken('1914', 'de')).toBe('1914')
  })
})

describe('spokenForms', () => {
  it('speaks « 10 000 » once, the second token gets an empty form', () => {
    expect(spokenForms(['10', '000', 'euros'], 'fr')).toEqual(['dix mille', '', 'euros'])
    expect(spokenForms(['2', '500', '000', 'hommes.'], 'fr')).toEqual(['deux millions cinq cent mille', '', '', 'hommes.'])
  })

  it('keeps trailing punctuation of the last group and has one form per token', () => {
    const tokens = ['Il', 'y', 'a', '10', '000,', 'soit', '3,5', 'fois']
    const forms = spokenForms(tokens, 'fr')
    expect(forms).toHaveLength(tokens.length)
    expect(forms[3]).toBe('dix mille,')
    expect(forms[4]).toBe('')
    expect(forms[6]).toBe('trois virgule cinq')
  })
})

describe('parseScript (R17 outputs, one reading for every stage)', () => {
  it('splits paragraphs on blank lines and sentences on . ! ? …', () => {
    const p = parseScript('Il part. Où va-t-il ? Loin !\n\nPeut-être… Oui.')
    expect(p.paragraphs).toEqual(['Il part. Où va-t-il ? Loin !', 'Peut-être… Oui.'])
    expect(p.sentences.map((s) => s.text)).toEqual(['Il part.', 'Où va-t-il ? ', 'Loin !', 'Peut-être…', 'Oui.'].map((s) => s.trim()))
    expect(p.sentences.map((s) => s.paragraph)).toEqual([0, 0, 0, 1, 1])
  })

  it('does not end a sentence on M. Dr. or an initial', () => {
    const p = parseScript('M. Dupont voit le Dr. Martin. J. Verne arrive.')
    expect(p.sentences.map((s) => s.text)).toEqual(['M. Dupont voit le Dr. Martin.', 'J. Verne arrive.'])
    expect(endsSentence('Dr.')).toBe(false)
    expect(endsSentence('J.')).toBe(false)
    expect(endsSentence('fin.»')).toBe(true)
    expect(endsSentence('fin')).toBe(false)
  })

  it('keeps tokens as written, with punctuation, and links them to sentence and paragraph', () => {
    const p = parseScript('L’été, déjà. Fin.\n\nAutre.')
    expect(p.tokens.map((t) => t.w)).toEqual(['L’été,', 'déjà.', 'Fin.', 'Autre.'])
    expect(p.tokens.map((t) => t.sentence)).toEqual([0, 0, 1, 2])
    expect(p.tokens.map((t) => t.paragraph)).toEqual([0, 0, 0, 1])
    expect(p.sentences[1]).toMatchObject({ first: 2, last: 2 })
  })

  it('reads CRLF input like LF, and blank-looking lines make no token', () => {
    const lf = parseScript('Un deux.\n\nTrois quatre.')
    const crlf = parseScript('Un deux.\r\n\r\nTrois quatre.\r\n   \r\n')
    expect(crlf.tokens.map((t) => t.w)).toEqual(lf.tokens.map((t) => t.w))
    expect(crlf.paragraphs).toEqual(lf.paragraphs)
    expect(parseScript('  \n\n  ').tokens).toEqual([])
  })

  it('closes the last sentence even without final punctuation', () => {
    const p = parseScript('Une phrase sans point')
    expect(p.sentences).toHaveLength(1)
    expect(p.sentences[0]).toMatchObject({ first: 0, last: 3 })
  })
})

describe('normWord / countWords', () => {
  it('lowercases, drops accents and punctuation, unifies apostrophes', () => {
    expect(normWord('L’Été,')).toBe("l'ete")
    expect(normWord('«Café»')).toBe('cafe')
    expect(normWord('—')).toBe('')
    expect(normWord("'quoi'")).toBe('quoi')
    expect(normWord('1 914')).toBe('1914')
  })

  it('counts tokens holding a letter or a digit', () => {
    expect(countWords('Hello — world, 3 !')).toBe(3)
    expect(countWords('')).toBe(0)
  })
})

describe('anchors (R17.10: links by anchor, never by index)', () => {
  const text = 'La première phrase est assez longue pour servir de repère ici. La seconde parle de la mer et du vent froid ce soir. Fin.'
  const parsed = parseScript(text)

  it('anchorOf keeps the first 8 words as written', () => {
    expect(anchorOf(parsed.sentences[0]?.text ?? '')).toBe('La première phrase est assez longue pour servir')
    expect(anchorOf('Deux mots')).toBe('Deux mots')
  })

  it('finds a sentence by exact anchor, ignoring case and accents', () => {
    expect(findAnchor(parsed, anchorOf(parsed.sentences[1]?.text ?? ''))).toBe(1)
    expect(findAnchor(parsed, 'la PREMIERE phrase est assez')).toBe(0)
    expect(findAnchor(parsed, 'Fin')).toBe(2)
  })

  it('still finds it after an edit elsewhere (sentence index moved)', () => {
    const anchor = anchorOf(parsed.sentences[1]?.text ?? '')
    const edited = parseScript(`Une toute nouvelle phrase ouvre le texte. ${text}`)
    expect(findAnchor(edited, anchor)).toBe(2)
  })

  it('accepts a prefix of at least 4 words when the sentence was reworded', () => {
    const reworded = parseScript('La seconde parle de la mer, mais tout a changé ensuite.')
    expect(findAnchor(reworded, 'La seconde parle de la mer et du vent')).toBe(0)
  })

  it('refuses a weak or unknown anchor', () => {
    expect(findAnchor(parsed, 'La seconde chose arrive')).toBeNull() // only 2 words in common
    expect(findAnchor(parsed, 'Rien à voir avec ce texte du tout')).toBeNull()
    expect(findAnchor(parsed, '   ')).toBeNull()
  })
})

describe('keyTerms (§20)', () => {
  const words = (s: string): string[] => s.split(/\s+/)

  it('takes numbers, then names that do not open a sentence', () => {
    const t = keyTerms(words('Napoléon quitte Elbe en 1815, puis rejoint Paris avec 1 000 hommes'), 10)
    expect(t).toContain('1815')
    expect(t).toContain('Elbe')
    expect(t).toContain('Paris')
    expect(t).not.toContain('Napoléon') // opens the passage
    expect(t.indexOf('1815')).toBeLessThan(t.indexOf('hommes'))
  })

  it('does not take a name that opens a sentence', () => {
    expect(keyTerms(words('Il est parti. Marseille attendait.'))).not.toContain('Marseille')
    expect(keyTerms(words('Il est parti à Marseille.'))).toContain('Marseille')
  })

  it('skips stop words and adverbs in -ment, strips elisions', () => {
    const t = keyTerms(words("Lentement, l'archipel sombrait dans la tempête; l'archipel disparaissait totalement près d'Elbe"))
    expect(t).toContain('archipel')
    expect(t).toContain('tempête')
    expect(t).toContain('Elbe')
    expect(t).not.toContain("l'archipel")
    expect(t).not.toContain("d'Elbe")
    expect(t.some((x) => /ment$/.test(x))).toBe(false)
    expect(t).not.toContain('dans')
  })

  it('is deterministic, deduplicated and capped', () => {
    const input = words('Rome Athènes Sparte Thèbes Corinthe Carthage Syracuse 1914 1915 1916 1917')
    const a = keyTerms(input, 5)
    expect(a).toHaveLength(5)
    expect(keyTerms(input, 5)).toEqual(a)
    expect(new Set(a.map(normWord)).size).toBe(a.length)
  })
})

describe('align helpers', () => {
  it('syllables counts vowel groups, one at least per word', () => {
    expect(syllables('')).toBe(0)
    expect(syllables('chat')).toBe(1)
    expect(syllables('quatre-vingt-dix')).toBeGreaterThanOrEqual(3)
    expect(syllables('rythme')).toBe(2) // y and e
    expect(syllables('pst')).toBe(1)
  })

  it('boundaryOf ranks paragraph > sentence > clause > none', () => {
    expect(boundaryOf('fin.', true, true)).toBe(3)
    expect(boundaryOf('fin.', true, false)).toBe(2)
    expect(boundaryOf('alors,', false, false)).toBe(1)
    expect(boundaryOf('alors,»', false, false)).toBe(1)
    expect(boundaryOf('alors', false, false)).toBe(0)
  })
})

// ---- alignTokens on a synthetic voice with known word times ----

const SCRIPT = [
  'Le matin, la ville dormait encore sous la brume. Personne ne savait ce qui allait arriver.',
  'Soudain, une cloche sonna au loin ! Les habitants sortirent, inquiets, et regardèrent le ciel.'
].join('\n\n')

interface Synthetic {
  tokens: AlignToken[]
  starts: number[]
  sentenceFirst: number[]
  regions: Region[]
  durationS: number
}

/** Per-token speech time proportional to syllables (with a deterministic wobble), pauses after punctuation. */
function synthesize(extraPauseAfter?: { token: number; seconds: number }): Synthetic {
  const parsed = parseScript(SCRIPT)
  const forms = spokenForms(parsed.tokens.map((t) => t.w), 'fr')
  const lastOfSentence = new Set(parsed.sentences.map((s) => s.last))
  const lastOfPara = new Set(parsed.sentences.filter((s, k) => parsed.sentences[k + 1]?.paragraph !== s.paragraph).map((s) => s.last))
  const tokens: AlignToken[] = parsed.tokens.map((t, i) => ({ spoken: forms[i] as string, boundary: boundaryOf(t.w, lastOfSentence.has(i), lastOfPara.has(i)) }))
  const starts: number[] = []
  const regions: Region[] = []
  let t = 0.3
  let runStart = t
  const sentencePauses = [0.5, 0.8, 0.6, 0.7]
  parsed.tokens.forEach((tok, i) => {
    starts.push(t)
    t += (0.12 * syllables(forms[i] as string) + 0.06) * (1 + 0.25 * Math.sin(i * 1.7))
    let pause = 0
    if (lastOfSentence.has(i)) pause = sentencePauses[tok.sentence] as number
    else if (/,$/.test(tok.w) && i % 2 === 0) pause = 0.2
    if (extraPauseAfter?.token === i) pause += extraPauseAfter.seconds
    if (pause > 0 || i === parsed.tokens.length - 1) {
      regions.push({ start: runStart, end: t })
      t += pause
      runStart = t
    }
  })
  return { tokens, starts, sentenceFirst: parsed.sentences.map((s) => s.first), regions, durationS: t + 0.3 }
}

describe('alignTokens accuracy on a synthetic voice (§19.3)', () => {
  it('times sentence starts within 0.1 s and words within 0.25 s on average, all sentence ends matched', () => {
    const v = synthesize()
    expect(v.tokens.length).toBeGreaterThanOrEqual(28)
    const r = alignTokens(v.tokens, v.regions, v.durationS)
    expect(r.times).toHaveLength(v.tokens.length)
    expect(r.matched).toBe(1)
    for (const f of v.sentenceFirst) expect(Math.abs((r.times[f] as { start: number }).start - (v.starts[f] as number))).toBeLessThanOrEqual(0.1)
    const err = r.times.map((x, i) => Math.abs(x.start - (v.starts[i] as number)))
    expect(err.reduce((a, b) => a + b, 0) / err.length).toBeLessThanOrEqual(0.25)
  })

  it('returns ordered, non-overlapping times inside the audio', () => {
    const v = synthesize()
    const r = alignTokens(v.tokens, v.regions, v.durationS)
    let prev = 0
    for (const x of r.times) {
      expect(x.start).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(x.end).toBeGreaterThanOrEqual(x.start)
      expect(x.end).toBeLessThanOrEqual(v.durationS)
      prev = x.start
    }
  })

  it('is reproducible', () => {
    const v = synthesize()
    expect(alignTokens(v.tokens, v.regions, v.durationS)).toEqual(alignTokens(v.tokens, v.regions, v.durationS))
  })

  it('spreads words evenly when nothing was heard', () => {
    const v = synthesize()
    const r = alignTokens(v.tokens, [], 20)
    expect(r.matched).toBe(0)
    expect(r.times[0]?.start).toBe(0)
    expect(r.times.at(-1)?.end).toBeCloseTo(20, 6)
    for (let i = 1; i < r.times.length; i++) expect((r.times[i] as { start: number }).start).toBeGreaterThanOrEqual((r.times[i - 1] as { end: number }).end - 1e-9)
  })

  it('an empty script gives no times; a script without sentence ends matches fully', () => {
    expect(alignTokens([], [{ start: 0, end: 1 }], 1)).toEqual({ times: [], matched: 1 })
    const r = alignTokens([{ spoken: 'un', boundary: 0 }, { spoken: 'mot', boundary: 0 }], [{ start: 0.1, end: 1 }], 1.2)
    expect(r.matched).toBe(1)
  })

  // a pause the punctuation does not announce must not move the sentences after it (tolerance 0.3 s)
  it.each(['savait', 'cloche', 'allait', 'au'])('an unexpected 0.6 s pause after « %s » does not shift any sentence start by more than 0.3 s', (word) => {
    const parsed = parseScript(SCRIPT)
    const v = synthesize({ token: parsed.tokens.findIndex((t) => t.w === word), seconds: 0.6 })
    const r = alignTokens(v.tokens, v.regions, v.durationS)
    for (const f of v.sentenceFirst) expect(Math.abs((r.times[f] as { start: number }).start - (v.starts[f] as number))).toBeLessThanOrEqual(0.3)
  })
})

// ---- word matching ----

describe('matchSequences', () => {
  it('pairs the longest common subsequence of two word lists', () => {
    const a = ['le', 'chat', 'dort', 'sur', 'le', 'toit']
    const b = ['le', 'chat', 'ne', 'dort', 'pas', 'sur', 'le', 'toit']
    expect(matchSequences(a, b)).toEqual([[0, 0], [1, 1], [2, 3], [3, 5], [4, 6], [5, 7]])
  })

  it('handles empty lists and no overlap', () => {
    expect(matchSequences([], ['a'])).toEqual([])
    expect(matchSequences(['a'], [])).toEqual([])
    expect(matchSequences(['a', 'b'], ['c', 'd'])).toEqual([])
  })

  it('keeps pairs increasing on both sides', () => {
    const pairs = matchSequences(['a', 'b', 'a', 'c', 'b'], ['b', 'a', 'c', 'a', 'b'])
    for (let k = 1; k < pairs.length; k++) {
      expect((pairs[k] as [number, number])[0]).toBeGreaterThan((pairs[k - 1] as [number, number])[0])
      expect((pairs[k] as [number, number])[1]).toBeGreaterThan((pairs[k - 1] as [number, number])[1])
    }
    expect(pairs.length).toBe(4) // b a c b
  })
})

describe('interpolate (R19.8: never across a pause)', () => {
  it('fills unmatched words between timed neighbours in proportion to their length', () => {
    const times = [{ start: 0, end: 1 }, null, null, { start: 2, end: 3 }]
    const out = interpolate(times, ['a', 'bb', 'bbbb', 'c'], 3)
    expect(out[1]?.start).toBeCloseTo(1, 6)
    expect(out[2]?.start).toBeCloseTo(out[1]?.end ?? -1, 6)
    expect(out[2]?.end).toBeLessThanOrEqual(2 + 1e-9)
    expect(out[1]?.end).toBeGreaterThan(out[1]?.start ?? 0)
  })

  it('places unmatched words right after the previous one, not stretched over a long gap', () => {
    const times = [{ start: 0, end: 1 }, null, { start: 9, end: 10 }]
    const out = interpolate(times, ['a', 'mot', 'b'], 10)
    expect(out[1]?.start).toBeCloseTo(1, 6)
    expect(out[1]?.end).toBeLessThan(2) // 3 chars × 65 ms, at least 0.3 s: far from the 9 s of the next word
  })

  it('fills a leading and a trailing run from 0 and up to the duration', () => {
    const out = interpolate([null, { start: 1, end: 2 }, null], ['x', 'y', 'z'], 5)
    expect(out[0]?.start).toBe(0)
    expect(out[0]?.end).toBeLessThanOrEqual(1 + 1e-9)
    expect(out[2]?.start).toBeCloseTo(2, 6)
    expect(out[2]?.end).toBeLessThanOrEqual(5)
  })
})

describe('spokenText', () => {
  it('keeps paragraph breaks, speaks numbers and drops the empty forms', () => {
    const parsed = parseScript('Il y a 10 000 soldats en 1914.\n\nIls avancent à 3,5 km.')
    const { text, forms } = spokenText(parsed, 'fr')
    expect(text).toBe('Il y a dix mille soldats en mille neuf cent quatorze.\n\nIls avancent à trois virgule cinq km.')
    expect(forms).toHaveLength(parsed.tokens.length)
    expect(forms[4]).toBe('') // « 000 »
  })
})
