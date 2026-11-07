// What the pipeline agent reads (decisions 0013, 0024): a pipeline as compact text (its options with their choices, its
// bricks, its price and fit), the measured profile it is matched to, and the two system prompts — the conversation that
// edits one pipeline, and the drafting of a proposal. The agent answers the owner in short, simple French and changes a
// pipeline only through edit operations.
import { basePipeline, techName, technologyRegistry, type RecipeDoc, type TechnologyRegistry } from '../../../engine/technologies'
import type { Range } from '../../../engine/technologies/cost'
import type { VideoMeasure } from '../../../engine/technologies/fit'
import { OPS_HELP } from './tools'

const r2 = (x: number): number => Math.round(x * 100) / 100
const range = (r: Range | null): string => (r ? `${r2(r.avg)} credits per finished minute (min ${r2(r.min)}, max ${r2(r.max)}; 1 credit = 0.01 €)` : 'price unknown')

let registry: TechnologyRegistry | null = null
/** The settings a pipeline may set on a brick (its manifest's `overridable.recipe`): the agent knows what exists, and never invents one. */
function settable(tech: string): readonly string[] {
  registry ??= technologyRegistry()
  return registry.get(tech)?.overridable.recipe ?? []
}

/** A pipeline as the model reads it. */
export function pipelineText(doc: RecipeDoc, perMinute: Range | null, fit: number | null): string {
  const decls = basePipeline(doc.base)?.options ?? []
  const options = decls.map((o) => {
    const value = doc.options[o.id] ?? o.default
    const choices = o.kind === 'slider' ? `${o.min}..${o.max}` : o.choices.map((c) => `${String(c.value)}${c.soon && !o.soon ? ' (soon)' : ''}`).join(' | ')
    return `- ${o.id} = ${JSON.stringify(value)}${o.soon ? ' (soon: fixed)' : ''} [${choices}]`
  })
  const bricks = doc.bricks.map((b) => {
    const can = settable(b.tech)
    const parts = [techName(b.tech), b.engine ? `engine ${b.engine}` : '', b.fallbacks.length ? `fallbacks ${b.fallbacks.join(', ')}` : '', b.style ? `style ${b.style}` : '', Object.keys(b.settings).length ? `settings ${JSON.stringify(b.settings)}` : '', can.length ? `settable ${can.join(', ')}` : '']
    return `- ${parts.filter(Boolean).join(' · ')}`
  })
  return [
    `Pipeline « ${doc.name} » (${doc.videoType}, ${doc.format.aspect}, ${doc.format.minutes} min, base ${doc.base ?? 'none'}, language ${doc.language ?? 'the channel’s'})`,
    `Mix (screen-time shares): ${doc.mix ? JSON.stringify(doc.mix) : 'none (the director decides)'}`,
    options.length ? `Options:\n${options.join('\n')}` : 'No options (built by hand).',
    `Bricks:\n${bricks.join('\n')}`,
    `Inputs: ${JSON.stringify(doc.inputs)} · gates: ${doc.checkpoints ? doc.checkpoints.join(', ') : 'the channel’s'} · cap: ${doc.capCredits ?? 'none'} credits`,
    `Cost: ${range(perMinute)}`,
    `Fit to the channel: ${fit === null ? 'not measured' : `${fit} %`}`
  ].join('\n')
}

/** The measured videos, one line each (what the eyes read). */
export function profileText(videos: readonly VideoMeasure[]): string {
  if (videos.length === 0) return 'No measured video: only the description below.'
  return videos
    .slice(0, 12)
    .map((v, i) => {
      const f = (x: number | null | undefined, unit = ''): string => (x === null || x === undefined ? '?' : `${r2(x)}${unit}`)
      return `${i + 1}. ${f(v.minutes, ' min')} · presenter ${f(v.presenterShare)} · shot ${f(v.shotS, ' s')} · captions ${v.captions ?? '?'} · sponsor ${v.sponsor ?? '?'}${v.kinds ? ` · kinds ${JSON.stringify(v.kinds)}` : ''}`
    })
    .join('\n')
}

const RULES =
  'Rules: you never rewrite a pipeline as text; you change it ONLY with edit operations. Prefer the options (quality, clip share, captions, sponsor, music, script) to engines and bricks: the user is a beginner. ' +
  'Never choose an option value marked soon. A brick setting exists only when it is listed as « settable » (e.g. voice.tts speed 0.7–1.2 for a slower or faster voice): never say a thing cannot be set when it is listed, never invent one that is not. ' +
  'When a change moves the price, say the real numbers before → after (from pipeline_try or the diff), never « un peu » for more than 20 %. Credits: 1 credit = 0.01 €. Answer in short, simple French (two to four sentences), tutoiement, no jargon.'

/** The system prompt of the conversation that edits one pipeline. */
export function threadSystem(toolsOffered: boolean): string {
  const how = toolsOffered
    ? 'Use pipeline_try to check a batch when unsure, then pipeline_propose to put ONE batch in front of the owner. If nothing should change, propose nothing and say why.'
    : `You have no tools here: when a change is needed, end your answer with ONE fenced block \`\`\`atelier-ops\n{"ops": [...], "note": "one French sentence"}\n\`\`\` and nothing after it. ${OPS_HELP}`
  return [
    'You are the pipeline agent of Atelier, a desktop app that makes faceless YouTube videos. You edit ONE video production pipeline with its owner, who talks to you in French.',
    'The owner sees your change as a diff with its cost per minute and fit before / after, and accepts it (a new version) or not.',
    how,
    RULES
  ].join('\n\n')
}

/** The system prompt of the drafting of a proposal (Opus by default: decision 0013, « drafting a recipe »). */
export function proposalSystem(toolsOffered: boolean): string {
  const how = toolsOffered
    ? 'Check the variants with pipeline_read; when one should change for this channel (what the description or the measures say and the code could not), adjust it with pipeline_propose (variant: faithful, cheap or premium; it is applied at once). Keep « cheap » the cheapest and « premium » the dearest.'
    : `You have no tools here: put your adjustments in the block below as ops per variant. ${OPS_HELP}`
  return [
    'You are the pipeline agent of Atelier, a desktop app that makes faceless YouTube videos. The code measured the reference videos and built variants of a base pipeline (faithful, cheap, premium), each priced and scored.',
    how,
    'End your answer with ONE fenced block ```atelier-proposal\n{"summary": "two or three French sentences for the owner: what you understood of the channel and what you propose", "why": {"faithful": "…", "cheap": "…", "premium": "…"}' +
      (toolsOffered ? '}' : ', "ops": {"faithful": [...], "cheap": [...], "premium": [...]}}') +
      '\n```',
    RULES
  ].join('\n\n')
}
