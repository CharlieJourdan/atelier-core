// Claude calls and post-writing passes of `script.write` (docs/ENGINE-SPEC.md §17.4, §17.5): a text call that detects
// non-answers by structure and checks the language, the length settling of a part, the revision guard and the forbidden-stem batch.
import { EngineError } from '../errors'
import { cleanScript, detectLanguage, forbiddenSentences, lintScript } from '../text/lint'
import { countWords, normWord, parseScript } from '../text/script'
import type { RunCtx } from '../registry'
import { need, type ModelTier } from '../services'
import { throwIfAborted } from './common'
import { lengthPrompt, forbiddenPrompt, type PartInfo } from './script-prompts'

const LANG_NAME: Record<string, string> = { fr: 'français', en: 'anglais', other: 'une autre langue' }

export interface TextCall {
  system: string
  prompt: string
  /** Length asked for, in words: a reply under 30 % of it is a non-answer (R17.5). */
  askedWords: number
  language: string
  /** The model tier of the call (decision 0013); absent: the role's own. */
  tier?: ModelTier
}

/**
 * One text call: the reply is cleaned (§17.4 step 1), a non-answer (under 30 % of the asked length, or one block when the
 * ask was long) is retried, a wrong language is retried once then fails naming the detected language (R17.5). At most
 * 3 attempts.
 */
export async function askText(ctx: RunCtx, o: TextCall): Promise<string> {
  const claude = need(ctx, 'claude')
  let prompt = o.prompt
  let wrongLanguage = 0
  for (let attempt = 1; attempt <= 3; attempt++) {
    throwIfAborted(ctx)
    const reply = await claude.ask({ role: 'scriptwriter', ...(o.tier ? { tier: o.tier } : {}), system: o.system, prompt, json: false, signal: ctx.signal })
    const text = cleanScript(reply.text)
    const words = countWords(text)
    if (words < 0.3 * o.askedWords || (o.askedWords >= 150 && parseScript(text).paragraphs.length < 2)) {
      prompt = `${o.prompt}\n\nYour previous answer was not the narration (too short, or one single block). Write the complete narration, about ${o.askedWords} words, with paragraphs separated by a blank line.`
      continue
    }
    if (o.language === 'fr' || o.language === 'en') {
      const det = detectLanguage(text)
      if (det !== o.language && (det !== 'other' || words >= 60)) {
        if (++wrongLanguage >= 2) {
          throw new EngineError(
            'bad_output',
            `Le script n’est pas dans la bonne langue : langue détectée « ${LANG_NAME[det] ?? det} », langue demandée « ${LANG_NAME[o.language] ?? o.language} »`
          )
        }
        prompt = `${o.prompt}\n\nYour previous answer was not in the required language. Write the whole narration again in ${o.language === 'fr' ? 'French' : 'English'}.`
        continue
      }
    }
    return text
  }
  throw new EngineError('bad_output', 'Claude n’a pas rédigé de texte exploitable (réponse trop courte ou d’un seul bloc) après 3 essais')
}

/**
 * Settles the length of a text: up to two "rewrite at full length" requests while it is outside [lo, hi] of its budget,
 * a rewrite being kept only if it moves toward the budget and stays inside the band (R17.5, never padded).
 */
export async function settleLength(
  ctx: RunCtx,
  o: { system: string; language: string; text: string; budget: number; part: PartInfo; lo: number; hi: number }
): Promise<string> {
  let text = o.text
  for (let i = 0; i < 2; i++) {
    const words = countWords(text)
    if (words >= o.lo * o.budget && words <= o.hi * o.budget) break
    const prompt = lengthPrompt({ draft: text, target: o.budget, words, part: o.part })
    const next = await askText(ctx, { system: o.system, prompt, askedWords: o.budget, language: o.language, tier: 'fast' })
    const n = countWords(next)
    const inBand = n >= o.lo * o.budget && n <= o.hi * o.budget
    const closer = words < o.budget ? n > words && n <= o.hi * o.budget : n < words && n >= o.lo * o.budget
    if (closer && inBand) text = next
  }
  return text
}

const NUMBER = /\d+(?:[.,]\d+)*/g
const HEDGES = /\b(?:environ|about|around|roughly|presque|nearly|approximately|approximativement|plus de|more than|près de|almost)\b/giu

/** Capitalised words that do not open a sentence (names, places). */
function midSentenceNames(text: string): string[] {
  const p = parseScript(text)
  const out: string[] = []
  p.tokens.forEach((t, i) => {
    const prev = p.tokens[i - 1]
    const w = t.w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (prev && prev.sentence === t.sentence && /^\p{Lu}\p{L}+/u.test(w)) out.push(normWord(w))
  })
  return out
}

/** The deterministic guard of the revision pass (§17.4 step 3). Returns the reasons to reject; empty means keep the rewrite. */
export function revisionProblems(o: { draft: string; revised: string; brief: string; target: number; forbidden: readonly string[] }): string[] {
  const base = `${o.draft}\n${o.brief}`
  const problems: string[] = []
  const known = new Set((base.match(NUMBER) ?? []).map((n) => n.replace(/\s/g, '')))
  const newNumbers = (o.revised.match(NUMBER) ?? []).map((n) => n.replace(/\s/g, '')).filter((n) => !known.has(n))
  if (newNumbers.length > 0) problems.push(`new number: ${newNumbers[0]}`)
  const baseWords = new Set(parseScript(base).tokens.map((t) => normWord(t.w)))
  const newNames = midSentenceNames(o.revised).filter((n) => !baseWords.has(n))
  if (newNames.length > 0) problems.push(`new name: ${newNames[0]}`)
  const hedgesBefore = (o.draft.match(HEDGES) ?? []).length
  if ((o.revised.match(HEDGES) ?? []).length < hedgesBefore && (o.draft.match(NUMBER) ?? []).length > 0) problems.push('hedge removed')
  const before = lintScript(o.draft, { targetWords: o.target, forbidden: o.forbidden }).failures
  const after = lintScript(o.revised, { targetWords: o.target, forbidden: o.forbidden }).failures
  if (after.length > before.length) problems.push('more lint failures')
  const ratio = countWords(o.revised) / o.target
  const was = countWords(o.draft) / o.target
  const inBand = ratio >= 0.9 && ratio <= 1.12
  if (!inBand && !(Math.abs(ratio - 1) < Math.abs(was - 1) && (was < 0.9 || was > 1.12))) problems.push('length leaves the band')
  return problems
}

/** Rebuilds a text with some sentences replaced (by index), paragraphs kept. */
export function replaceSentences(text: string, replacements: ReadonlyMap<number, string>): string {
  const parsed = parseScript(text)
  const paras: string[][] = parsed.paragraphs.map(() => [])
  for (const s of parsed.sentences) paras[s.paragraph]?.push(replacements.get(s.index) ?? s.text)
  return paras.map((p) => p.join(' ')).join('\n\n')
}

/**
 * Forbidden-stem rewrite batch (§17.4 step 4): the offending sentences go back in one call; a replacement is accepted only
 * if the stems are gone and it is still one sentence. Returns the text and the stems still present.
 */
export async function removeForbidden(ctx: RunCtx, o: { system: string; text: string; stems: readonly string[] }): Promise<{ text: string; left: string[] }> {
  const hits = forbiddenSentences(o.text, o.stems)
  if (hits.length === 0) return { text: o.text, left: [] }
  const claude = need(ctx, 'claude')
  const reply = await claude.ask({
    role: 'scriptwriter',
    tier: 'fast',
    system: o.system,
    prompt: forbiddenPrompt({ items: hits, stems: o.stems }),
    json: false,
    signal: ctx.signal
  })
  const wanted = new Map<number, string>()
  for (const line of reply.text.split('\n')) {
    const m = /^\s*(\d+)\s*[:.)]\s*(.+?)\s*$/u.exec(line)
    const idx = m ? Number(m[1]) : -1
    const rewritten = m?.[2] ?? ''
    if (hits.some((h) => h.index === idx) && parseScript(rewritten).sentences.length === 1 && forbiddenSentences(rewritten, o.stems).length === 0) {
      wanted.set(idx, rewritten)
    }
  }
  const text = wanted.size > 0 ? replaceSentences(o.text, wanted) : o.text
  const left = [...new Set(forbiddenSentences(text, o.stems).flatMap((h) => h.stems))]
  return { text, left }
}

/** « 0 min 50 » or « 10 min » for a number of seconds. */
const fmtDuration = (seconds: number, exact = false): string => {
  const s = Math.round(seconds)
  return exact && s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

/** The visible warning of a script outside the 90–112 % band (R17.2), or null. */
export function lengthWarning(words: number, target: number, wpm: number): string | null {
  const ratio = words / target
  if (ratio >= 0.9 && ratio <= 1.12) return null
  const got = fmtDuration((words / wpm) * 60)
  const want = fmtDuration((target / wpm) * 60, true)
  return `script ${ratio < 1 ? 'court' : 'long'} : ${got} au lieu de ${want}`
}
