// `script.factcheck@1` (docs/ENGINE-SPEC.md §18, pipeline-avatar §2.2, production-4): the option « Vérification des faits ».
// The narration is split into parts of ~`partWords` words at paragraph breaks; one Claude call per part (web search and page
// reading only) reports the real problems as (exact quoted words → finished replacement). A fix applies ONLY when its quoted
// text occurs exactly once in the whole script, the replacement is at most 3× longer and reads as narration; anything else
// is listed as unapplied, never guessed. Absence of evidence never deletes a claim. The original script is kept beside the
// corrected one (`original`), the outline is re-anchored, the report goes to `json.factcheck`.
import { z } from 'zod'
import { isAbortError } from '../errors'
import { Outline } from '../formats/outline'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import type { NodeOutputs } from '../artefacts'
import { need } from '../services'
import { countWords } from '../text/script'
import type { Json } from '../types'
import { eachLimited, firstJson, languageLine, progress, readText, readValue } from './common'
import { anchorOutline } from './script-outline'

const Params = z.object({
  language: z.string().min(2).default('fr'),
  partWords: z.number().int().min(150).max(2000).default(550),
  parallel: z.number().int().min(1).max(8).default(4),
  maxSearchesPerPart: z.number().int().min(0).max(12).default(6)
})
type Params = z.infer<typeof Params>

export const FINDING_TYPES = ['error', 'misquote', 'overstated', 'invented', 'superlative'] as const

export const Finding = z.object({
  type: z.enum(FINDING_TYPES),
  /** The exact words of the script. */
  quote: z.string().min(1),
  /** Finished narration in the script's language. */
  replacement: z.string(),
  source: z.string().default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('medium')
})
export type Finding = z.infer<typeof Finding>

const Reply = z.object({ searches: z.number().int().min(0), findings: z.array(Finding).max(30) })

const occurrences = (text: string, quote: string): number => {
  let n = 0
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) n++
  return n
}

/** Why a fix cannot be applied to `text` (null: it can): the exact-unique-quote rule of §18 step 4. */
export function fixProblem(text: string, f: Pick<Finding, 'quote' | 'replacement'>): string | null {
  const n = occurrences(text, f.quote)
  if (n === 0) return 'the quoted text is not in the script'
  if (n > 1) return `the quoted text occurs ${n} times`
  const r = f.replacement.trim()
  if (!r) return 'empty replacement'
  if (r.length > 3 * Math.max(f.quote.length, 20)) return 'the replacement is more than 3 times longer'
  if (/\n/.test(r) || /^(?:replace|remplace|change|note|nb)\b/iu.test(r)) return 'the replacement is not narration'
  return null
}

/** Applies the fixes in turn, each to the text as the previous ones left it. */
export function applyFixes(text: string, findings: readonly Finding[]): { text: string; applied: Finding[]; unapplied: (Finding & { reason: string })[] } {
  let out = text
  const applied: Finding[] = []
  const unapplied: (Finding & { reason: string })[] = []
  for (const f of findings) {
    const why = fixProblem(out, f)
    if (why) {
      unapplied.push({ ...f, reason: why })
      continue
    }
    out = out.replace(f.quote, () => f.replacement.trim())
    applied.push(f)
  }
  return { text: out, applied, unapplied }
}

/** Paragraph groups of about `size` words (a paragraph is never split). */
export function splitParts(text: string, size: number): string[] {
  const parts: string[] = []
  let cur: string[] = []
  let n = 0
  for (const p of text.split(/\n\s*\n/)) {
    cur.push(p)
    n += countWords(p)
    if (n >= size) {
      parts.push(cur.join('\n\n'))
      cur = []
      n = 0
    }
  }
  if (cur.length > 0) {
    if (parts.length > 0 && n < size / 3) parts[parts.length - 1] += `\n\n${cur.join('\n\n')}`
    else parts.push(cur.join('\n\n'))
  }
  return parts
}

interface PartReport {
  index: number
  checked: boolean
  searches: number
  findings: Finding[]
}

function checkPrompt(part: string, k: number, n: number, brief: string, p: Params, why: string): string {
  return [
    `TASK: fact-check part ${k} of ${n}`,
    `Check every factual statement of this part of a narration with web search and page reading (at most ${p.maxSearchesPerPart} searches). Report only real problems, typed: error (a wrong fact), misquote (words not said verbatim), overstated (stated as certain but disputed), invented (a decorative detail with no source), superlative (an unsupported first / biggest / only).`,
    'For each: "quote" = the exact words of the part, copied character for character (short, unique); "replacement" = finished narration in the script’s language that replaces them; "source" = a URL. Absence of evidence never deletes a claim: soften it at most. Never invent a quote: use the real wording or turn it into indirect speech.',
    'Answer with ONE JSON value: { "searches": <number of searches made>, "findings": [ { "type": "...", "quote": "...", "replacement": "...", "source": "...", "confidence": "high|medium|low" } ] }',
    why ? `Your previous answer could not be used: ${why}.` : '',
    brief ? `Brief of the video (facts and sources already gathered):\n${brief.slice(0, 12_000)}` : '',
    `Part:\n${part}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** One part: two attempts; zero searches and zero findings on a part with figures is a non-answer (§18). */
async function checkPart(ctx: RunCtx, part: string, k: number, n: number, brief: string, p: Params): Promise<PartReport> {
  const claude = need(ctx, 'claude')
  let why = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await claude.ask({
        role: 'factchecker',
        tier: 'balanced',
        system: `${languageLine(p.language)}\n\nYou are the fact-checker of a video narration. You answer with one JSON value only.`,
        prompt: checkPrompt(part, k, n, brief, p, why),
        json: true,
        tools: ['web'],
        signal: ctx.signal
      })
      const r = Reply.safeParse(firstJson(reply.text))
      if (!r.success) {
        why = 'it was not the JSON asked for'
        continue
      }
      if (r.data.searches === 0 && r.data.findings.length === 0 && /\d/.test(part)) {
        why = 'no search was made on a part with figures'
        continue
      }
      return { index: k - 1, checked: true, searches: r.data.searches, findings: r.data.findings }
    } catch (e) {
      if (isAbortError(e)) throw e
      why = 'the call failed'
    }
  }
  return { index: k - 1, checked: false, searches: 0, findings: [] }
}

function outputs(original: string, text: string, outline: Outline, meta: Record<string, Json>, report: Record<string, Json>): NodeOutputs {
  const words = countWords(text)
  return {
    text: { value: text, meta: { ...meta, words, factchecked: true } },
    outline: { value: anchorOutline(outline, text) as unknown as Json },
    original: { value: original, meta },
    report: { value: report, meta: { applied: report.applied ?? 0, unapplied: report.unapplied ?? 0 } }
  }
}

async function check(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const original = readText(inputs.script, 'The script')
  const outline = readValue(inputs.outline, Outline, 'The outline')
  const brief = typeof inputs.brief?.value === 'string' ? inputs.brief.value : ''
  const parts = splitParts(original, p.partWords)
  const reports: PartReport[] = new Array<PartReport>(parts.length)
  let done = 0
  await eachLimited(parts, p.parallel, async (part, i) => {
    reports[i] = await checkPart(ctx, part, i + 1, parts.length, brief, p)
    progress(ctx, ++done, parts.length, `Vérification des faits : partie ${done} sur ${parts.length}`)
  })
  const fixes = applyFixes(original, reports.flatMap((r) => r.findings))
  const unchecked = reports.filter((r) => !r.checked).length
  const meta = { ...(inputs.script?.meta ?? {}) }
  const warnings = Array.isArray(meta.warnings) ? [...meta.warnings] : []
  if (unchecked > 0) warnings.push(`${unchecked} partie(s) non vérifiée(s)`)
  const report = {
    parts: reports.map((r) => ({ index: r.index, checked: r.checked, searches: r.searches, findings: r.findings.length })),
    applied: fixes.applied.length,
    unapplied: fixes.unapplied.length,
    fixes: fixes.applied,
    refused: fixes.unapplied,
    unchecked
  } as unknown as Record<string, Json>
  return outputs(original, fixes.text, outline, { ...meta, warnings }, report)
}

export const scriptFactcheck = defineNode<Params>({
  type: 'script.factcheck@1',
  inputs: {
    script: { type: 'text.script', required: true, label: 'Script' },
    outline: { type: 'json.outline', required: true, label: 'Plan' },
    brief: { type: 'text.brief', required: false, label: 'Brief' }
  },
  outputs: { text: 'text.script', outline: 'json.outline', original: 'text.script', report: 'json.factcheck' },
  params: Params,
  executors: ['local'],
  claudeRole: 'factchecker',
  estimate: (ctx, p) => {
    const parts = Math.max(1, Math.round((ctx.minutes * 180) / p.partWords))
    return { units: [{ unit: 'calls', qty: parts }, { unit: 'searches', qty: parts * p.maxSearchesPerPart }], provider: 'claude', durationS: 60 + parts * 60 }
  },
  reads: ['minutes'],
  run: check,
  // the demo checks nothing: the script stays as it is and the report says so
  fake(_ctx, inputs, p) {
    const original = readText(inputs.script, 'The script')
    const outline = readValue(inputs.outline, Outline, 'The outline')
    const parts = splitParts(original, p.partWords)
    const report = { parts: parts.map((_, i) => ({ index: i, checked: false, searches: 0, findings: 0 })), applied: 0, unapplied: 0, fixes: [], refused: [], unchecked: parts.length, demo: true }
    return Promise.resolve(outputs(original, original, outline, { ...(inputs.script?.meta ?? {}), demo: true }, report))
  }
})
