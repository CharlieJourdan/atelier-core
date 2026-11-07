// Outline helpers of `script.write` (docs/ENGINE-SPEC.md §17): normalising what Claude returned, re-matching anchors to the
// final text (links are by anchor, never by sentence index), and the deterministic outline of the demo script.
import type { Outline, OutlineBeat } from '../formats/outline'
import type { Tag } from '../formats/timing'
import { anchorOf, countWords, findAnchor, parseScript } from '../text/script'

/** The video's topic as a short single line: meta title, else the working-title section, else the first heading. */
export function topicOf(brief: string | undefined, metaTitle?: unknown): string {
  const clean = (s: string): string =>
    s
      .replace(/[*_`#]/g, '')
      .replace(/^\s*(?:[-•]|\d+[.)])\s+/u, '')
      // a brief's label is not the subject (the clone's idea starts « Subject: <title>. », moteur-pov-2)
      .replace(/^\s*(?:subject|sujet|topic|thème)\s*:\s*/iu, '')
      .replace(/\s+/g, ' ')
      .trim()
  let t = typeof metaTitle === 'string' ? clean(metaTitle) : ''
  if (!t && brief) {
    const sec = /^#{1,3}\s*2[.)][^\n]*\n+([^\n]+)/mu.exec(brief)?.[1]
    const head = /^#\s+([^\n]+)/mu.exec(brief)?.[1]
    t = clean(sec ?? head ?? brief.split('\n').find((l) => l.trim() !== '') ?? '')
  }
  const words = t.split(' ').filter(Boolean).slice(0, 9)
  const out = words.join(' ').replace(/[.:;!?,]+$/u, '')
  return out || 'ce sujet'
}

/** Budgets rescaled so they sum to `total` (each at least 1). */
export function scaleBudgets(budgets: readonly number[], total: number): number[] {
  const sum = budgets.reduce((a, b) => a + b, 0)
  if (budgets.length === 0) return []
  const scaled = budgets.map((b) => Math.max(1, Math.round((b / (sum || 1)) * total)))
  const diff = total - scaled.reduce((a, b) => a + b, 0)
  let big = 0
  scaled.forEach((v, i) => {
    if (v > (scaled[big] ?? 0)) big = i
  })
  scaled[big] = Math.max(1, (scaled[big] ?? 1) + diff)
  return scaled
}

/** What Claude returned, made consistent: indexes in order, budgets summing to `words`, chapters only when T >= 6. */
export function normalizeOutline(
  o: Outline,
  c: { language: string; words: number; minutes: number; chapters: 'auto' | number; keepAnchors?: boolean }
): Outline {
  const budgets = scaleBudgets(o.beats.map((b) => b.wordBudget), c.words)
  const beats = o.beats.map((b, i) => ({ ...b, index: i, wordBudget: budgets[i] ?? 1, tags: [...new Set(b.tags)], anchor: c.keepAnchors ? b.anchor : '' }))
  const cap = c.chapters === 'auto' ? 8 : Math.min(8, c.chapters)
  const seen = new Set<number>()
  const chapters =
    c.minutes < 6 || cap === 0
      ? []
      : o.chapters
          .filter((ch) => ch.firstBeat >= 0 && ch.firstBeat < beats.length)
          .sort((a, b) => a.firstBeat - b.firstBeat)
          .filter((ch) => (seen.has(ch.firstBeat) ? false : (seen.add(ch.firstBeat), true)))
          .slice(0, cap)
          .map((ch) => ({ ...ch, anchor: '' }))
  const planted = o.planted.filter((p) => p.plantedBeat >= 0 && p.payoffBeat < beats.length)
  return { ...o, language: c.language, beats, chapters, planted, dropped: [] }
}

/**
 * Re-matches the outline to a text (§17 outputs): each beat gets the anchor of its first sentence (placed by its share of
 * the word budget), each chapter the anchor of its first beat, each sentence-level mark the sentence it still points at.
 * A mark whose sentence is gone is dropped and listed.
 */
export function anchorOutline(outline: Outline, text: string): Outline {
  const parsed = parseScript(text)
  const total = parsed.tokens.length
  const sum = outline.beats.reduce((a, b) => a + b.wordBudget, 0) || 1
  const dropped = [...outline.dropped]
  let cum = 0
  let prev = 0
  const beats: OutlineBeat[] = outline.beats.map((b, i) => {
    const want = Math.round((cum / sum) * total)
    cum += b.wordBudget
    let best = parsed.sentences[0]
    for (const s of parsed.sentences) if (!best || Math.abs(s.first - want) < Math.abs(best.first - want)) best = s
    // an anchor already on the beat (a pasted script tagged by Claude) wins over the budget-based guess
    const given = b.anchor ? findAnchor(parsed, b.anchor) : null
    const idx = i === 0 ? 0 : Math.max(prev, given ?? best?.index ?? 0)
    prev = idx
    const marks = b.marks.flatMap((m) => {
      const at = findAnchor(parsed, m.anchor)
      const sent = at === null ? undefined : parsed.sentences[at]
      if (!sent) {
        dropped.push(`${m.tag}: ${m.anchor}`)
        return []
      }
      return [{ tag: m.tag, anchor: anchorOf(sent.text) }]
    })
    return { ...b, anchor: anchorOf(parsed.sentences[idx]?.text ?? ''), marks }
  })
  const chapters = outline.chapters.map((c) => ({ ...c, anchor: beats[c.firstBeat]?.anchor ?? '' }))
  return { ...outline, beats, chapters, dropped }
}

const PURPOSES = {
  fr: ['Accroche et promesse', 'Mise en place', 'Premier éclairage', 'Montée en tension', 'Point de bascule', 'Conséquences', 'Dénouement'],
  en: ['Hook and promise', 'Setting the scene', 'First insight', 'Rising tension', 'Turning point', 'Consequences', 'Resolution']
}
const CHAPTERS = {
  fr: ['Le point de départ', 'Ce que l’on sait', 'Un détail clé', 'Le tournant', 'Les conséquences', 'Ce qui reste', 'La réponse', 'Pour finir'],
  en: ['The starting point', 'What we know', 'A key detail', 'The turning point', 'The consequences', 'What remains', 'The answer', 'To close']
}

/** Deterministic outline for a text (demo script or pasted script without Claude): beats by equal budgets, tags, chapters. */
export function fakeOutlineFor(text: string, o: { topic: string; language: string; minutes: number; chapters?: 'auto' | number }): Outline {
  const fr = o.language === 'fr'
  const words = Math.max(countWords(text), 1)
  const parsed = parseScript(text)
  const nb = Math.max(1, Math.min(parsed.sentences.length, Math.max(3, Math.round(o.minutes))))
  const purposes = fr ? PURPOSES.fr : PURPOSES.en
  const budgets = scaleBudgets(Array.from({ length: nb }, () => 1), words)
  const beats: OutlineBeat[] = budgets.map((wordBudget, i) => {
    const tags: Tag[] = i === 0 ? ['hook', 'promise'] : i === nb - 1 && nb > 1 ? ['payoff'] : i === 1 ? ['question'] : []
    if (nb >= 5 && i === Math.floor(nb / 2)) tags.push('pivot')
    const purpose = i === 0 ? (purposes[0] ?? '') : i === nb - 1 ? (purposes[6] ?? '') : (purposes[1 + ((i - 1) % 5)] ?? '')
    return {
      index: i,
      purpose,
      summary: fr ? `Partie ${i + 1} sur ${o.topic}.` : `Part ${i + 1} on ${o.topic}.`,
      wordBudget,
      tags,
      anchor: '',
      marks: []
    }
  })
  // the sentence that carries a figure (a year or a number), preferably after the hook, so the director can place a label
  const fig = parsed.sentences.find((s) => s.paragraph > 0 && /\d/.test(s.text)) ?? parsed.sentences.find((s) => /\d/.test(s.text))
  if (fig) {
    const at = Math.min(nb - 1, Math.max(0, Math.floor((fig.first / Math.max(parsed.tokens.length, 1)) * nb)))
    const b = beats[at]
    if (b) {
      b.marks.push({ tag: 'figure', anchor: anchorOf(fig.text) })
      if (!b.tags.includes('figure')) b.tags.push('figure')
    }
  }
  // an explicit number of chapters is kept whatever the length; « auto » makes them from 6 minutes
  const wantChapters = (o.minutes >= 6 || typeof o.chapters === 'number') && o.chapters !== 0
  const nc = wantChapters ? Math.min(8, Math.max(3, typeof o.chapters === 'number' ? o.chapters : Math.round(o.minutes / 3)), nb) : 0
  const titles = fr ? CHAPTERS.fr : CHAPTERS.en
  const chapters = Array.from({ length: nc }, (_, i) => ({ title: titles[i] ?? `${i + 1}`, firstBeat: Math.floor((i * nb) / nc), anchor: '' }))
  const hook = parsed.sentences[0]?.text ?? o.topic
  const outline: Outline = {
    language: o.language,
    title: o.topic,
    shape: o.minutes >= 6 ? 'chronicle' : 'explainer',
    kind: o.minutes >= 6 ? 'story' : 'lesson',
    promise: fr ? `Comprendre ce qui se cache derrière ${o.topic}.` : `Understand what lies behind ${o.topic}.`,
    hook,
    beats,
    chapters,
    planted: [{ detail: fr ? 'la date citée au début' : 'the date named at the start', plantedBeat: 0, payoffBeat: nb - 1 }],
    dropped: []
  }
  return anchorOutline(outline, text)
}
