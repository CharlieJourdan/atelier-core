// The on-screen text check (director text check): every text the scene pass asks to WRITE on screen — a label, an archive
// frame's caption, quote or excerpt, a map's place names, a data card's bars and values, a timeline's years — is checked against
// what the video is allowed to state: the script (and the research notes, when the run has them). It runs on the directives,
// before any picture or card is placed, so a text that fails is rewritten with the script's words, blanked, or its card left out
// while the pictures stay.
//   rules     (deterministic, free): every number, year and date must be said in the script or the notes (digits, or the words
//             a narrator says: « vingt-cinq » is 25, « 13 millions » is 13 000 000); every capitalised name must appear there; a
//             quotation or an excerpt must be the script's own words, in order.
//   evidence  (the rules, then one batched Claude call on the director's backend, cached): each text that is not copied word for
//             word from the script must come with an exact quote of the script or the notes that supports it; code checks the
//             quote is really there. What the first look cannot prove gets a second look, and a correction is made only when that
//             look confirms it (a broken rule needs no confirmation): an unsupported label or card text is rewritten with the
//             script's words (the rewrite passes the rules again) or removed; a picture's caption is removed, never rewritten.
// Measured on the bench's passage (research note benchmark-2026-11 (old repository)): a scene pass writes a few texts a minute that the
// script never states (a closing figure, a rounded date, a paraphrased headline).
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { Directive } from '../formats/directives'
import type { RunCtx } from '../registry'
import { englishNumber, frenchNumber } from '../text/spoken'
import { normWord } from '../text/script'
import { askJson, atomicWrite, hashOf } from './common'

export const TEXT_CHECKS = ['rules', 'evidence'] as const
export type TextCheck = (typeof TEXT_CHECKS)[number]

/** One text a directive writes on screen, and where it sits in the directive. */
export interface ScreenText {
  /** Stable key: the directive's index, then the field's path (`3:text`, `5:frame.label`, `7:card.props.bars.1.label`). */
  key: string
  directive: number
  path: (string | number)[]
  text: string
  /** A card's own content: when it fails, the card goes (the picture under it stays). */
  card: boolean
  /** A quotation or an excerpt: it must be the script's own words, in order. */
  quote: boolean
}

/** Card props that are not words shown on screen (anchors, layout, geometry). */
const NOT_TEXT = new Set(['on', 'source', 'template', 'style', 'theme', 'accent', 'color', 'colour', 'icon', 'shape', 'kind', 'lat', 'lon', 'lng', 'zoom', 'id', 'side', 'align', 'unitPosition', 'hold', 'at', 'atS'])
const FRAME_TEXTS = ['label', 'sub', 'punch', 'excerpt', 'mark', 'quote'] as const

/** Every on-screen text of the directives (a frame's `source` is the archive's credit, not a statement: it is not checked). */
export function screenTexts(directives: readonly Directive[]): ScreenText[] {
  const out: ScreenText[] = []
  directives.forEach((d, i) => {
    if (d.text) out.push({ key: `${i}:text`, directive: i, path: ['text'], text: d.text, card: false, quote: false })
    if (d.frame) {
      for (const f of FRAME_TEXTS) {
        const v = d.frame[f]
        if (v) out.push({ key: `${i}:frame.${f}`, directive: i, path: ['frame', f], text: v, card: false, quote: f === 'quote' || f === 'excerpt' })
      }
      d.frame.lines?.forEach((l, j) => out.push({ key: `${i}:frame.lines.${j}`, directive: i, path: ['frame', 'lines', j], text: l, card: false, quote: false }))
    }
    if (d.card) {
      const walk = (v: unknown, at: (string | number)[]): void => {
        if (typeof v === 'string' || typeof v === 'number') {
          const text = String(v).trim()
          if (text && /[\p{L}\p{N}]/u.test(text)) out.push({ key: `${i}:${at.join('.')}`, directive: i, path: at, text, card: true, quote: false })
        } else if (Array.isArray(v)) v.forEach((x, j) => walk(x, [...at, j]))
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!NOT_TEXT.has(k)) walk(x, [...at, k])
      }
      walk(d.card.props, ['card', 'props'])
    }
  })
  return out
}

// ---- the source the texts may draw on --------------------------------------------------------------------------------------------

const SCALES: Record<string, number> = { mille: 1e3, thousand: 1e3, million: 1e6, millions: 1e6, milliard: 1e9, milliards: 1e9, billion: 1e9, billions: 1e9 }
/** A number as written (« 13 000 000 », « 1,5 », « 89 % », « 13 millions »): its values (bare and scaled). */
export function numbersOf(text: string): number[] {
  const out: number[] = []
  const re = /(\d{1,3}(?:[\s.,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(mille|thousand|millions?|milliards?|billions?))?/giu
  for (const m of text.matchAll(re)) {
    const raw = m[1] as string
    const grouped = /^\d{1,3}(?:[\s.,]\d{3})+$/u.test(raw) && !/^\d{1,3}[.,]\d{3}$/u.test(raw)
    const value = grouped ? Number(raw.replace(/[^\d]/g, '')) : Number(raw.replace(',', '.'))
    if (!Number.isFinite(value)) continue
    out.push(value)
    // « 1.500 » / « 1,500 »: a thousands separator in one language, a decimal point in the other
    if (/^\d{1,3}[.,]\d{3}$/u.test(raw)) out.push(Number(raw.replace(/[.,]/, '')))
    const scale = m[2] ? SCALES[m[2].toLowerCase()] : undefined
    if (scale) out.push(Math.round(value * scale))
  }
  return out
}

/** Letters and digits only, words separated by one space (accents, case, apostrophes and hyphens removed). */
const flatText = (s: string): string =>
  s
    .split(/[\s\-‐–—/]+/u)
    .map((w) => normWord(w).replace(/'/g, ' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface TextSource {
  /** Every word of the script and notes, normalised. */
  words: Set<string>
  /** The whole source, normalised, for runs of words and numbers said in words. */
  flat: string
  numbers: Set<number>
  /** The percentages the source states (« 89 % »). */
  percents: Set<number>
}

export function textSource(script: string, notes = ''): TextSource {
  const all = `${script}\n${notes}`
  const flat = ` ${flatText(all)} `
  const percents = new Set([...all.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|pour\s*cent|percent)/giu)].map((m) => Number((m[1] as string).replace(',', '.'))))
  return { words: new Set(flat.split(' ').filter(Boolean)), flat, numbers: new Set(numbersOf(all)), percents }
}

/** True when the number is in the source: as digits, or as the words a narrator says (fr, en); a percentage's whole (100) and its
 *  complement (« perd 89 % » → 11 %) are what a chart of it draws. */
function numberSaid(n: number, src: TextSource): boolean {
  if (src.numbers.has(n)) return true
  if (src.percents.size > 0 && (n === 100 || src.percents.has(Math.round((100 - n) * 1000) / 1000))) return true
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return false
  const forms = [frenchNumber(n), englishNumber(n), englishNumber(n, true)].map(flatText)
  return forms.some((f) => f && src.flat.includes(` ${f} `))
}

/**
 * Capitalised words of a text (names, places). A text in capitals says nothing of its names; the first word of a caption that goes on
 * in lower case (« Employés de bourse ») is a common word written with a capital.
 */
function namesOf(text: string): string[] {
  const words = text
    .split(/[\s\-‐–—/«»"“”()]+/u)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((w) => w.length > 0)
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase()) return []
  return words.filter((w, i) => w.length >= 2 && /^\p{Lu}/u.test(w) && !(i === 0 && words.length > 1 && /^\p{Ll}/u.test(words[1] as string)))
}

/** What breaks the rules in one text (empty: it passes). */
export function ruleProblems(t: Pick<ScreenText, 'text' | 'quote'>, src: TextSource): string[] {
  const problems: string[] = []
  for (const n of numbersOf(t.text)) if (!numberSaid(n, src)) problems.push(`the number ${n} is not in the script`)
  for (const w of namesOf(t.text)) {
    const parts = flatText(w).split(' ').filter(Boolean)
    if (!parts.every((p) => src.words.has(p))) problems.push(`« ${w} » is not in the script`)
  }
  const quoted = t.quote ? [t.text] : [...t.text.matchAll(/[«“"]\s*([^»”"]{3,})\s*[»”"]/gu)].map((m) => m[1] as string)
  for (const q of quoted) {
    const f = flatText(q.replace(/[.…]+$/u, ''))
    if (f && !src.flat.includes(` ${f} `)) problems.push('a quotation that is not the script’s own words')
  }
  return problems
}

/** True when the text is the script's words in the script's order (nothing for the evidence pass to check). */
export function copiedFromSource(text: string, src: TextSource): boolean {
  const f = flatText(text)
  return f.length > 0 && src.flat.includes(` ${f} `)
}

// ---- the evidence pass (Claude) ---------------------------------------------------------------------------------------------------

const Verdict = z.object({
  k: z.string(),
  verdict: z.enum(['supported', 'unsupported', 'doubt']),
  evidence: z.string().max(400).default(''),
  rewrite: z.string().max(240).optional()
})
const Verdicts = z.object({ checks: z.array(Verdict).max(400) })
type Verdict = z.infer<typeof Verdict>

const EVIDENCE_RULES = [
  'You check the texts a documentary video WRITES ON SCREEN against what its narration and research notes state. A text on screen is a claim: it must be true according to the source below, never according to what you know.',
  'For each text: « supported » when the source states it (same facts, same numbers, same names); « unsupported » when it adds, rounds, dates, names or concludes anything the source does not state, even when it is true; « doubt » when you are not sure.',
  'A caption that only names what a picture shows at that moment (« Employés de bourse », « Tableau des cours ») with no date, number, name, title or place the source lacks is supported: quote the source words of that moment.',
  '« evidence »: copy the exact passage of the source (a few words to one sentence, character for character) that supports the text. No evidence, no « supported ».',
  'For an unsupported text, « rewrite »: the shortest text using ONLY the source’s words and numbers that says what it can truly say in that place (same length or shorter), or leave it out when nothing fits.',
  'Answer with ONE JSON object: {"checks":[{"k":"<key>","verdict":"supported"|"unsupported"|"doubt","evidence":"<exact quote>","rewrite":"<optional>"}]} for every text; nothing else.'
].join('\n')
const CONFIRM_RULES = `${EVIDENCE_RULES}\nA first look could not prove these texts. Look again: « unsupported » only when the source does not state it; « supported » with the exact quote when it does; « doubt » when it stays unclear (a doubtful text is kept).`
/** Texts per call (the source is sent with every call). */
const BATCH = 50

async function askVerdicts(ctx: RunCtx, system: string, texts: readonly ScreenText[], sourceText: string): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>()
  const cacheDir = await ctx.services.workspace?.cache('director').catch(() => undefined)
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const prompt = ['SOURCE (narration, then research notes):', sourceText, '', 'TEXTS (key · text):', ...batch.map((t) => `${t.key} · ${t.text}`)].join('\n')
    const file = cacheDir ? path.join(cacheDir, `${hashOf({ v: 'textcheck-2', system, prompt })}.json`) : null
    let answer: z.infer<typeof Verdicts> | null = null
    if (file && existsSync(file)) answer = Verdicts.safeParse(await readFile(file, 'utf8').then(JSON.parse).catch(() => null)).data ?? null
    if (!answer) {
      answer = await askJson(ctx, { role: 'director', tier: 'balanced', system, prompt, schema: Verdicts })
      if (file) await atomicWrite(file, JSON.stringify(answer))
    }
    for (const v of answer.checks) out.set(v.k, v)
  }
  return out
}

// ---- applying the outcome ---------------------------------------------------------------------------------------------------------

export interface TextCheckReport {
  checked: number
  kept: number
  rewritten: number
  removed: number
  /** Cards left out because one of their texts failed. */
  cardsDropped: number
  /** Texts the evidence pass looked at (0 in rules mode). */
  asked: number
  /** One line per text that changed: `key: before → after (why)`. */
  changes: string[]
}

function setAt(d: Directive, at: readonly (string | number)[], value: string | undefined): void {
  let o: Record<string | number, unknown> = d as unknown as Record<string | number, unknown>
  for (const k of at.slice(0, -1)) o = o[k] as Record<string | number, unknown>
  const last = at[at.length - 1] as string | number
  if (value !== undefined) o[last] = typeof o[last] === 'number' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value
  else if (Array.isArray(o)) o.splice(last as number, 1)
  else delete o[last]
}

/**
 * Checks every on-screen text of the directives (see the head of this file) and returns new directives: texts kept, rewritten,
 * removed; a card whose text failed is left out (its directive keeps its picture). Never throws for a failed check: an evidence
 * call that fails keeps the rules' verdicts and says so.
 */
export async function checkScreenTexts(
  ctx: RunCtx | null,
  directives: readonly Directive[],
  o: { script: string; notes?: string; mode: TextCheck; useClaude: boolean },
  diag: string[]
): Promise<{ directives: Directive[]; report: TextCheckReport }> {
  const next = directives.map((d) => structuredClone(d)) as Directive[]
  const texts = screenTexts(next)
  const src = textSource(o.script, o.notes ?? '')
  const report: TextCheckReport = { checked: texts.length, kept: 0, rewritten: 0, removed: 0, cardsDropped: 0, asked: 0, changes: [] }
  if (texts.length === 0) return { directives: next, report }
  const outcome = new Map<string, { to?: string; why: string }>()
  for (const t of texts) {
    const p = ruleProblems(t, src)
    if (p.length > 0) outcome.set(t.key, { why: p[0] as string })
  }
  if (o.mode === 'evidence' && o.useClaude && ctx) {
    // copied word for word from the script: nothing to prove; the rest (rule failures included: they may be rewritten) is asked
    const ask = texts.filter((t) => outcome.has(t.key) || !copiedFromSource(t.text, src))
    report.asked = ask.length
    if (ask.length > 0) {
      const sourceText = [o.script.trim(), (o.notes ?? '').trim()].filter(Boolean).join('\n---\n')
      try {
        const proven = (v: Verdict | undefined): boolean => {
          const quoted = v ? flatText(v.evidence) : ''
          return v?.verdict === 'supported' && quoted.length > 0 && src.flat.includes(` ${quoted} `)
        }
        const first = await askVerdicts(ctx, EVIDENCE_RULES, ask, sourceText)
        // a correction needs a second look that confirms it (a broken rule needs none): what the first look did not prove is asked again
        const doubtful = ask.filter((t) => !proven(first.get(t.key)))
        const second = doubtful.length > 0 ? await askVerdicts(ctx, CONFIRM_RULES, doubtful, sourceText) : new Map<string, Verdict>()
        for (const t of ask) {
          const hard = outcome.has(t.key)
          const v = second.get(t.key) ?? first.get(t.key)
          if (!hard && (proven(first.get(t.key)) || v?.verdict !== 'unsupported')) continue
          const rewrite = (second.get(t.key)?.rewrite ?? first.get(t.key)?.rewrite)?.trim()
          const rewriteOk = rewrite && ruleProblems({ text: rewrite, quote: t.quote }, src).length === 0 && flatText(rewrite).split(' ').every((w) => src.words.has(w) || /^\d/.test(w))
          const why = outcome.get(t.key)?.why ?? (v ? (v.verdict === 'supported' ? 'its evidence is not in the script' : `${v.verdict} by the evidence check`) : 'no verdict')
          // a picture's caption is never rewritten: the script's words about that moment may not describe the picture (bench: « Vice-
          // président de la Bourse » under Richard Whitney became « Banquiers de New York »); it is removed. A card's figure is never
          // rewritten either: its numbers go together (bench: a bar of « 11 % » left became « 89 », drawn next to « 100 »)
          const fixed = !t.quote && t.path[0] !== 'frame' && !(t.card && /\p{N}/u.test(t.text))
          outcome.set(t.key, rewriteOk && fixed ? { to: rewrite, why } : { why })
        }
      } catch (e) {
        if (ctx.signal.aborted || (e instanceof EngineError && e.code === 'missing_tool')) throw e
        diag.push('on-screen texts: the evidence check failed, the rules decided')
      }
    }
  }
  const cardOut = new Set<number>()
  // removals inside one array go from the last item to the first (indices stay right)
  const ordered = [...texts].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  for (const t of ordered) {
    const r = outcome.get(t.key)
    if (!r) {
      report.kept++
      continue
    }
    if (r.to !== undefined) {
      setAt(next[t.directive] as Directive, t.path, r.to)
      report.rewritten++
      report.changes.push(`${t.key}: « ${t.text} » → « ${r.to} » (${r.why})`)
    } else if (t.card) {
      cardOut.add(t.directive)
      report.changes.push(`${t.key}: « ${t.text} » → card left out (${r.why})`)
    } else {
      setAt(next[t.directive] as Directive, t.path, undefined)
      report.removed++
      report.changes.push(`${t.key}: « ${t.text} » → removed (${r.why})`)
    }
  }
  for (const i of cardOut) {
    const d = next[i] as Directive
    delete d.card
    report.cardsDropped++
  }
  diag.push(`on-screen texts (${o.mode}): ${report.checked} checked, ${report.kept} kept, ${report.rewritten} rewritten, ${report.removed} removed, ${report.cardsDropped} card(s) left out`)
  for (const c of report.changes) diag.push(`text check: ${c}`)
  return { directives: next, report }
}
