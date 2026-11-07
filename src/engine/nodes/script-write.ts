// `script.write@1` (docs/ENGINE-SPEC.md §17): the outline first (story or lesson, shape, hook, beats with word budgets,
// tags, chapters), then the narration, in one call or beat group by beat group, then clean, lint, an optional guarded
// revision, the forbidden-word batch, a language check and the re-matching of the outline's anchors to the final text.
// A pasted script is never rewritten (R17.14). The demo version builds an exact-length template script.
import { EngineError, isAbortError } from '../errors'
import { Outline } from '../formats/outline'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import type { NodeOutputs } from '../artefacts'
import type { Json } from '../types'
import { need } from '../services'
import { cleanScript, detectLanguage, lintScript, wpmFor } from '../text/lint'
import { countWords } from '../text/script'
import { cleanWithAdMarker } from '../text/ad-marker'
import { askJson, progress, readText, throwIfAborted } from './common'
import { fakeScript } from './script-fake'
import { anchorOutline, fakeOutlineFor, normalizeOutline, topicOf } from './script-outline'
import { askText, lengthWarning, removeForbidden, revisionProblems, settleLength } from './script-passes'
import {
  loadSkills,
  outlinePrompt,
  outlineSystem,
  Params,
  revisePrompt,
  taggingPrompt,
  writePrompt,
  writerSystem,
  type PartInfo
} from './script-prompts'

const WORDS_PER_PART = 750
const REVISE_MAX_WORDS = 4000

export interface Inputs {
  brief?: string
  pasted?: string
}

export function readInputs(inputs: ResolvedInputs): Inputs {
  const has = (k: string): boolean => typeof inputs[k]?.value === 'string' && (inputs[k]?.value as string).trim() !== ''
  const o: Inputs = {}
  if (has('pasted')) o.pasted = readText(inputs.pasted, 'The pasted script')
  if (has('brief')) o.brief = readText(inputs.brief, 'The brief')
  if (!o.pasted && !o.brief) throw new EngineError('bad_input', 'Donne un brief ou colle un script : il n’y a rien à écrire.')
  return o
}

/** Beats split into `n` consecutive groups of 3 to 4 beats (fewer when there are few beats). */
function groupBeats(beats: Outline['beats'], words: number): Outline['beats'][] {
  const n = Math.max(1, Math.min(beats.length, Math.max(2, Math.round(words / WORDS_PER_PART))))
  const out: Outline['beats'][] = []
  let at = 0
  for (let i = 0; i < n; i++) {
    const size = Math.floor(beats.length / n) + (i < beats.length % n ? 1 : 0)
    out.push(beats.slice(at, at + size))
    at += size
  }
  return out
}

export interface Done {
  text: string
  outline: Outline
  pasted: boolean
  demo: boolean
  warnings: string[]
  extra: Record<string, Json>
}

/** The two outputs and the meta of the text, built the same way for the real and the demo versions. */
export function finish(d: Done, c: { words: number; wpm: number; language: string; forbidden: readonly string[] }): NodeOutputs {
  const lint = lintScript(d.text, { targetWords: c.words, forbidden: c.forbidden })
  const warnings = [...d.warnings]
  const lw = lengthWarning(lint.words, c.words, c.wpm)
  if (lw) warnings.unshift(lw)
  if (lint.forbiddenHits.length > 0) warnings.push(`mots interdits restants : ${lint.forbiddenHits.map((h) => h.stem).join(', ')}`)
  if (d.outline.dropped.length > 0) warnings.push(`${d.outline.dropped.length} repère(s) du plan supprimé(s) : leur phrase a disparu`)
  const meta: Record<string, Json> = {
    words: lint.words,
    targetWords: c.words,
    estimatedMinutes: Math.round((lint.words / c.wpm) * 10) / 10,
    lengthRatio: lint.lengthRatio,
    language: c.language,
    pasted: d.pasted,
    lint: lint as unknown as Json,
    warnings,
    demo: d.demo,
    ...d.extra
  }
  return { text: { value: d.text, meta }, outline: { value: d.outline as unknown as Json } }
}

/**
 * Lines a later version adds to the prompts (script.write@2: the avatar structure, the support videos): to the writer's
 * system prompt, to the outline prompt, and to every writing prompt. Empty lists change nothing.
 */
export interface WriteExtra {
  system: string[]
  outline: string[]
  write: string[]
}

const NO_EXTRA: WriteExtra = { system: [], outline: [], write: [] }
const withExtra = (prompt: string, lines: readonly string[]): string => (lines.length > 0 ? [prompt, ...lines].join('\n\n') : prompt)

export async function writeScript(ctx: RunCtx, brief: string, p: Params, wpm: number, words: number, add: WriteExtra = NO_EXTRA): Promise<Done> {
  const skills = await loadSkills(ctx, p.skills)
  const sys = withExtra(writerSystem(p.language, skills, p.style, p.channelStyle), add.system)
  const notes = ctx.notes
  progress(ctx, 0, 10, 'Plan du récit…')
  const raw = await askJson(ctx, {
    role: 'scriptwriter',
    tier: 'balanced',
    system: outlineSystem(p.language),
    prompt: withExtra(outlinePrompt({ brief, words, minutes: ctx.minutes, p, notes }), add.outline),
    schema: Outline
  })
  const plan = normalizeOutline(raw, { language: p.language, words, minutes: ctx.minutes, chapters: p.chapters })
  const groups = words <= p.partsThreshold ? [plan.beats] : groupBeats(plan.beats, words)
  const pieces: string[] = []
  let summary = ''
  for (const [i, beats] of groups.entries()) {
    throwIfAborted(ctx)
    const part: PartInfo = { k: i + 1, n: groups.length, beats, budget: beats.reduce((a, b) => a + b.wordBudget, 0) }
    progress(ctx, 1 + (i * 6) / groups.length, 10, groups.length > 1 ? `Écriture : partie ${i + 1} sur ${groups.length}` : 'Écriture du script…')
    const prompt = withExtra(writePrompt({ outline: plan, brief, part, soFar: pieces.join('\n\n'), summary, p, notes }), add.write)
    let text = await askText(ctx, { system: sys, prompt, askedWords: part.budget, language: p.language, tier: 'balanced' })
    const lo = groups.length > 1 ? 0.85 : 0.9
    const hi = groups.length > 1 ? 1.15 : 1.12
    text = await settleLength(ctx, { system: sys, language: p.language, text, budget: part.budget, part, lo, hi })
    // R17.6: a script that stops mid-story is never shipped
    if (groups.length > 1 && i > 0 && countWords(text) < 0.7 * part.budget) {
      throw new EngineError('bad_output', `La partie ${part.k} sur ${part.n} est restée trop courte : le script s’arrêterait en plein récit`)
    }
    pieces.push(text)
    summary += `${summary ? '\n' : ''}Part ${part.k}: ${beats.map((b) => b.summary).join(' ')}`
  }
  let text = pieces.join('\n\n')
  const warnings: string[] = []
  const extra: Record<string, Json> = { revision: 'off', parts: groups.length }
  // revision pass with the deterministic guard (§17.4 step 3)
  if (p.revise && countWords(text) <= REVISE_MAX_WORDS) {
    progress(ctx, 7, 10, 'Relecture…')
    extra.revision = 'kept'
    try {
      const revised = await askText(ctx, {
        system: sys,
        prompt: revisePrompt({ draft: text, brief, words, notes }),
        askedWords: words,
        language: p.language,
        tier: 'balanced'
      })
      const problems = revisionProblems({ draft: text, revised, brief, target: words, forbidden: p.forbidden })
      if (problems.length === 0) text = revised
      else {
        extra.revision = 'rejected'
        extra.revisionProblems = problems
        ctx.emit({ kind: 'log', level: 'info', text: `relecture écartée : ${problems.join(', ')}` })
      }
    } catch (e) {
      if (isAbortError(e)) throw e
      extra.revision = 'failed'
    }
  }
  if (p.forbidden.length > 0) {
    progress(ctx, 8, 10, 'Mots interdits…')
    text = (await removeForbidden(ctx, { system: sys, text, stems: p.forbidden })).text
  }
  progress(ctx, 9, 10, 'Vérification…')
  const language = p.language
  const outline = anchorOutline(plan, text)
  return { text, outline, pasted: false, demo: false, warnings, extra: { ...extra, language } }
}

/** R17.14: clean, lint, one Claude call for the beats, tags and chapters; the text is never touched. */
export async function pastedScript(ctx: RunCtx, pasted: string, p: Params): Promise<{ done: Done; language: string }> {
  // the owner's ad marker ([PUB]…): never spoken, it names where the channel's promo goes (equipe-3-chaines)
  const { text, marker, extra: moreMarkers } = cleanWithAdMarker(pasted, cleanScript)
  if (!text) throw new EngineError('bad_input', 'Le script collé est vide.')
  const adExtra: Record<string, Json> = marker ? { adMarker: marker as unknown as Json } : {}
  const own = countWords(text)
  const det = detectLanguage(text)
  const language = det === 'other' ? p.language : det
  const warnings: string[] = moreMarkers > 0 ? [`${moreMarkers} marqueur(s) de pub en trop ignoré(s) : la promo va au premier`] : []
  if (det !== 'other' && det !== p.language) warnings.push(`langue détectée « ${det} » (réglage : « ${p.language} ») : la langue détectée est utilisée`)
  // the beats of a script the person wrote are the director's side of the run (decision 0038: `script_import` follows
  // the director's backend). That pass is optional and never blocks (production-17: an imported script is free and always
  // available): with no model, or a model that fails (an expired sign-in…), the script goes through cut into plain beats here.
  const plain = (why: string): { done: Done; language: string } => {
    const topic = topicOf(undefined, text.split(/\s+/).slice(0, 8).join(' '))
    warnings.push(why)
    return { done: { text, outline: fakeOutlineFor(text, { topic, language, minutes: ctx.minutes, chapters: p.chapters }), pasted: true, demo: false, warnings, extra: adExtra }, language }
  }
  if (!ctx.services.claude) return plain(NO_MODEL)
  if (p.tagImport === false) {
    const topic = topicOf(undefined, text.split(/\s+/).slice(0, 8).join(' '))
    return { done: { text, outline: fakeOutlineFor(text, { topic, language, minutes: ctx.minutes, chapters: p.chapters }), pasted: true, demo: false, warnings, extra: adExtra }, language }
  }
  let raw: Outline
  try {
    raw = await askJson(ctx, {
      role: 'script_import',
      tier: 'fast',
      system: outlineSystem(language),
      prompt: taggingPrompt({ script: text, words: own, minutes: ctx.minutes, p, notes: ctx.notes }),
      schema: Outline
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    if (isLocked(err)) return plain(NO_MODEL)
    return plain(`le découpage du script par Claude a échoué (${(err instanceof Error ? err.message : String(err)).slice(0, 120)}) : chapitres et repères posés simplement, sans Claude`)
  }
  const plan = normalizeOutline(raw, { language, words: own, minutes: ctx.minutes, chapters: p.chapters, keepAnchors: true })
  return { done: { text, outline: anchorOutline(plan, text), pasted: true, demo: false, warnings, extra: adExtra }, language }
}

const NO_MODEL = 'aucun modèle connecté : chapitres et repères posés simplement, sans Claude'

/** The app's Claude service refused: no subscription and no API key for this role (the app's `LOCKED` / `NO_KEY` code). */
function isLocked(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  // across a worker boundary only the message survives: the app's French texts (src/shared/fr-llm-access.ts)
  const message = err instanceof Error ? err.message : String(err)
  return code === 'LOCKED' || code === 'NO_KEY' || /abonnement Claude Code ou Codex connecté|aucune clé n’est enregistrée/.test(message)
}

export const scriptWrite = defineNode<Params>({
  type: 'script.write@1',
  // moteur-pov-2: the demo script follows the measured object pattern and address; the drawn director's demo shots changed
  fakeVersion: 3,
  inputs: {
    brief: { type: 'text.brief', required: false, label: 'Brief' },
    pasted: { type: 'text.input', required: false, label: 'Script collé' }
  },
  outputs: { text: 'text.script', outline: 'json.outline' },
  params: Params,
  reads: ['minutes'],
  executors: ['local'],
  claudeRole: 'scriptwriter',
  estimate(ctx, p) {
    const words = Math.round(ctx.minutes * (p.wpm ?? wpmFor(p.language)))
    const parts = words <= p.partsThreshold ? 1 : Math.max(2, Math.round(words / WORDS_PER_PART))
    const calls = 1 + parts + (p.revise ? 1 : 0)
    return { units: [{ unit: 'calls', qty: calls }], provider: 'claude', durationS: 60 + calls * 90 }
  },

  async run(ctx, inputs, p) {
    const given = readInputs(inputs)
    const wpm = p.wpm ?? wpmFor(p.language)
    const words = Math.round(ctx.minutes * wpm)
    // an imported script needs no model (production-17)
    if (given.pasted) {
      const r = await pastedScript(ctx, given.pasted, p)
      return finish(r.done, { words, wpm, language: r.language, forbidden: p.forbidden })
    }
    need(ctx, 'claude')
    const done = await writeScript(ctx, given.brief ?? '', p, wpm, words)
    return finish(done, { words, wpm, language: p.language, forbidden: p.forbidden })
  },

  async fake(ctx, inputs, p) {
    const given = readInputs(inputs)
    const wpm = p.wpm ?? wpmFor(p.language)
    const words = Math.round(ctx.minutes * wpm)
    if (given.pasted) {
      const { text, marker } = cleanWithAdMarker(given.pasted, cleanScript)
      if (!text) throw new EngineError('bad_input', 'Le script collé est vide.')
      const det = detectLanguage(text)
      const language = det === 'other' ? p.language : det
      const topic = topicOf(undefined, text.split(/\s+/).slice(0, 8).join(' '))
      const outline = fakeOutlineFor(text, { topic, language, minutes: ctx.minutes, chapters: p.chapters })
      return finish({ text, outline, pasted: true, demo: true, warnings: [], extra: marker ? { adMarker: marker as unknown as Json } : {} }, { words, wpm, language, forbidden: p.forbidden })
    }
    const topic = topicOf(given.brief, inputs.brief?.meta?.title)
    const text = fakeScript({ topic, language: p.language, words, seed: ctx.seed, ...(p.style?.objects ? { objects: p.style.objects } : {}), ...(p.style?.address ? { address: p.style.address } : {}) })
    const outline = fakeOutlineFor(text, { topic, language: p.language, minutes: ctx.minutes, chapters: p.chapters })
    return finish({ text, outline, pasted: false, demo: true, warnings: [], extra: {} }, { words, wpm, language: p.language, forbidden: p.forbidden })
  }
})
