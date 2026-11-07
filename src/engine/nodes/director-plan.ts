// `director.plan@1` v0 (docs/ENGINE-SPEC.md §12, §21): the edit plan (`atelier.editplan/1`) and the priced generation
// list, before any spend. run: a scene pass by Claude (role Director), one call per stretch (the hook, then ~2.5 min
// stretches, 2 at a time), deciding what each beat shows (subject, stock query, image prompt, labels); then our
// deterministic passes (director-cuts.ts) and the checker. fake: the same passes on drafts made from each beat's key
// terms. A stretch whose call fails twice gets plain base shots, listed on the gate card (never silent, R36.1).
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { checkEditPlan } from '../formats/editplan'
import { Outline } from '../formats/outline'
import { BeatsValue, WordsMeta, WordsValue, toFrame, type Beat } from '../formats/timing'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { parseScript } from '../text/script'
import { askJson, atomicWrite, hashOf, languageLine, progress, readValue } from './common'
import { BeatDraft, DirectorParams, buildPlan, fallbackDraft, type PlanResult } from './director-cuts'
import { resolveBudget } from './director-budget'
import { forecastGenlist } from './director-forecast'
import { billedSeconds, directMix } from './director-run-mix'
import { buildTimeline } from '../formats/directives'
import { directDoc2 } from './director-doc2'

const sceneRules = (aspect: DirectorParams['aspect'], shotTypes: DirectorParams['shotTypes'], motion = false): string => [
  aspect === '9:16'
    ? 'You are the Director of a narrated vertical YouTube Short (9:16, phone screen). For each beat below, decide what the picture shows: one clear subject, composed for a tall frame.'
    : 'You are the Director of a narrated long-form YouTube documentary (16:9). For each beat below, decide what the picture shows.',
  'Rules:',
  '- The picture follows the words: choose the subject for what the narrator is talking about in that beat, not the first noun.',
  '- stockQuery: 2 to 4 concrete ENGLISH words a stock library can match (setting, object, action). Never a person name, a brand or on-screen text. A call to action is illustrated by mood, never literally.',
  '- imagePrompt: one concrete subject, the era and place when they matter, lighting and palette; no text, letters or numbers in the image; never a real named person (show them by a label instead); about a third of the scenes without any person.',
  '- Consecutive beats change subject, setting or shot size. The same subject is never shown twice.',
  '- labels: at most 2 per beat, only for a figure, a date, a name or a place that the narration SAYS in that beat; copy the text exactly as written in the beat (no new number, no new name); anchorWords = the 1–3 words of the beat where the label appears, copied exactly. Hook beats deserve labels; plain beats often need none.',
  ...(shotTypes && shotTypes.length > 0
    ? [`- This channel's videos are known for these kinds of shots: ${shotTypes.join(', ')}. Compose the pictures in that spirit (the subject still follows the words).`]
    : []),
  ...(motion ? ['- people: at most 1 per beat, only a person the narration NAMES in that beat; name = exactly as written in the beat, role = what they are in 1 to 5 words (their job or their part in the story), in the output language. Plain beats have none.'] : []),
  `Answer with ONE JSON object: {"beats":[{"beat":<index>,"subject":"…","stockQuery":"…","imagePrompt":"…","labels":[{"text":"…","anchorWords":"…"}]${motion ? ',"people":[{"name":"…","role":"…"}]' : ''}}]} with one entry per beat given, nothing else.`
].join('\n')

const StretchAnswer = z.object({ beats: z.array(BeatDraft).min(1) })

/** Stretches of beats: the hook (first `hookSpanS`), then ~150 s each (§21.2 step 1). */
export function stretches(beats: readonly Beat[], hookSpanS: number, stretchS = 150): Beat[][] {
  const out: Beat[][] = []
  let cur: Beat[] = []
  let limit = hookSpanS > 0 ? hookSpanS : stretchS
  for (const b of beats) {
    if (cur.length > 0 && b.start >= limit) {
      out.push(cur)
      cur = []
      limit = b.start + stretchS
    }
    cur.push(b)
  }
  if (cur.length > 0) out.push(cur)
  return out
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

async function scenePass(ctx: RunCtx, beats: readonly Beat[], outline: Outline, p: DirectorParams, diag: string[]): Promise<Map<number, BeatDraft>> {
  const drafts = new Map<number, BeatDraft>()
  const rules = sceneRules(p.aspect, p.shotTypes, p.motion !== undefined)
  const parts = stretches(beats, p.hookSpanS)
  const cacheDir = await ctx.services.workspace?.cache('director').catch(() => undefined)
  let done = 0
  const one = async (part: Beat[], k: number): Promise<void> => {
    const prompt = [
      languageLine(outline.language),
      `Video: "${outline.title}". Promise: ${outline.promise}`,
      `Stretch ${k + 1} of ${parts.length}${k === 0 && p.hookSpanS > 0 ? ' (the hook: make every sentence visual)' : ''}.`,
      'Beats (index · time · tags · key terms · text):',
      ...part.map((b) => `${b.i} · ${fmt(b.start)}–${fmt(b.end)} · [${b.tags.join(', ')}] · {${b.keyTerms.join(', ')}} · ${b.text}`),
      ...(ctx.notes.length > 0 ? ['Requested changes from the reviewer:', ...ctx.notes.map((n) => `- ${n}`)] : [])
    ].join('\n')
    // answer cache per stretch (R32.7): a voice change that only moves times reuses the drafts
    const key = hashOf({ v: 1, rules, prompt: prompt.replace(/ · \d+:\d+–\d+:\d+ · /g, ' · '), seed: ctx.seed })
    const file = cacheDir ? path.join(cacheDir, `${key}.json`) : null
    let answer: z.infer<typeof StretchAnswer> | null = null
    if (file && existsSync(file)) answer = StretchAnswer.safeParse(await readFile(file, 'utf8').then(JSON.parse).catch(() => null)).data ?? null
    if (!answer) {
      try {
        answer = await askJson(ctx, { role: 'director', system: rules, prompt, schema: StretchAnswer })
        if (file) await atomicWrite(file, JSON.stringify(answer))
      } catch (e) {
        if (ctx.signal.aborted) throw e
        const from = (part[0] as Beat).start
        const to = (part.at(-1) as Beat).end
        diag.push(`réalisation simplifiée de ${fmt(from)} à ${fmt(to)}`)
        ctx.emit({ kind: 'log', level: 'warn', text: `scene pass failed for stretch ${k + 1}: base shots only` })
      }
    }
    const allowed = new Set(part.map((b) => b.i))
    for (const d of answer?.beats ?? []) if (allowed.has(d.beat)) drafts.set(d.beat, d)
    progress(ctx, ++done, parts.length, `${done} passages sur ${parts.length}`)
  }
  // two stretches at a time (the Claude limit counts calls, R32.8)
  for (let i = 0; i < parts.length; i += 2) await Promise.all(parts.slice(i, i + 2).map((part, j) => one(part, i + j)))
  return drafts
}

async function direct(ctx: RunCtx, inputs: ResolvedInputs, p: DirectorParams, useClaude: boolean): Promise<NodeOutputs> {
  const beats = readValue(inputs.beats, BeatsValue, 'the beats')
  const words = readValue(inputs.words, WordsValue, 'the word times')
  const outline = readValue(inputs.outline, Outline, 'the outline')
  const wm = WordsMeta.safeParse(inputs.words?.meta)
  if (!wm.success) throw new EngineError('bad_input', 'the word times have no duration')
  const D = wm.data.durationS
  const diagnostics: string[] = []
  if (wm.data.alignment === 'weak' || wm.data.alignment === 'estimated') diagnostics.push(`word timing ${wm.data.alignment}: cuts may land slightly off the words`)
  if (useClaude && p.scenePass) need(ctx, 'claude') // run = the Director on Claude: without it the node says so (R1.4)
  // documentary-2: its own grammar (scene pass, measured sequence, archives and cards), before any mix
  if (p.grammar === 'documentary-2') return directDoc2(ctx, { beats, words, outline, D, diagnostics }, p, useClaude)
  // the pipeline's mix and curve: presenter by code, pictures from the directives (production-model §7)
  if (p.screen) return directMix(ctx, { beats, words, outline, D, script: typeof inputs.script?.value === 'string' ? inputs.script.value : null, diagnostics }, p, p.screen, useClaude)
  const drafts = useClaude && p.scenePass ? await scenePass(ctx, beats, outline, p, diagnostics) : new Map()
  const script = words.map((w) => w.w).join(' ')
  // the written script, when wired: its speakers are the turns of a message conversation (only read for animated overlays)
  const parsed = p.motion && typeof inputs.script?.value === 'string' ? parseScript(inputs.script.value) : null
  const build = (ds: ReadonlyMap<number, z.infer<typeof BeatDraft>>): PlanResult =>
    buildPlan({ beats, words, durationS: D, title: outline.title, script, parsed, drafts: ds, p, seed: ctx.seed, diagnostics: [...diagnostics] })
  let result = build(drafts)
  let problems = checkEditPlan(result.plan, result.list, toFrame(D))
  if (problems.length > 0) {
    // one revision (R12.2): drop the scene drafts for the deterministic ones, then check again
    ctx.emit({ kind: 'log', level: 'warn', text: `checker: ${problems.join('; ')} — revising once` })
    result = build(new Map(beats.map((b) => [b.i, fallbackDraft(b, outline.title)])))
    problems = checkEditPlan(result.plan, result.list, toFrame(D))
    if (problems.length > 0) throw new EngineError('schema', `the edit plan failed its check twice: ${problems.join('; ')}`)
  }
  const { plan, list } = result
  const seconds = billedSeconds(list)
  const labels = plan.tracks.labels.length
  progress(ctx, 1, 1, `${plan.tracks.base.length} plans, ${labels} titres, ${list.totals.credits} crédits`)
  const timeline = buildTimeline(plan, list, words)
  return {
    plan: { value: plan as unknown as Json, meta: { frames: plan.frames, shots: plan.tracks.base.length, labels, demo: !useClaude } },
    // the rhythm director decides per beat, not per sentence: no directives, the same timeline view
    directives: { value: [], meta: { mode: 'rhythm', count: 0 } },
    timeline: { value: timeline as unknown as Json, meta: { shots: timeline.shots.length, overlays: timeline.overlays.length } },
    genlist: {
      value: list as unknown as Json,
      meta: {
        credits: list.totals.credits,
        items: list.totals.items,
        stock: (list.totals.byKind['stock.photo'] ?? 0) + (list.totals.byKind['stock.video'] ?? 0),
        // what the nodes that fulfil the list estimate their bill from: said only when there is some, so a film without video or
        // presenter keeps the meta it always had
        ...seconds
      }
    }
  }
}

export const directorPlan = defineNode({
  type: 'director.plan@1',
  inputs: {
    beats: { type: 'json.beats', required: true },
    words: { type: 'json.words', required: true },
    outline: { type: 'json.outline', required: true },
    script: { type: 'text.script', required: false, label: 'Script (les tours de parole d’une conversation)' },
    brief: { type: 'text.brief', required: false }
  },
  outputs: { plan: 'json.editplan', genlist: 'json.genlist', directives: 'json.directives', timeline: 'json.timeline' },
  params: DirectorParams,
  executors: ['local'],
  claudeRole: 'director',
  estimate: (ctx) => ({ units: [{ unit: 'calls', qty: 1 + Math.ceil((ctx.minutes * 60) / 150) }], durationS: 30 + ctx.minutes * 15 }),
  forecast: (ctx, p): Record<string, Record<string, Json>> => {
    // a mix with a budget is forecast on the curve the budget makes for this length (the run uses the same one)
    const genlist = forecastGenlist(ctx.minutes, p.screen ? { ...p, screen: resolveBudget(p.screen, p, ctx.minutes * 60).screen } : p)
    return genlist ? { genlist } : {}
  },
  run: (ctx, inputs, p) => direct(ctx, inputs, p, true),
  fake: (ctx, inputs, p) => direct(ctx, inputs, p, false)
})
