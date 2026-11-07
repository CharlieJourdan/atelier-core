// `captions.make@1` (docs/ENGINE-SPEC.md §27): styled captions from the voice's word times. Writes the burn-in ASS (labels
// always, captions when `burn`) and the captions as plain SRT and WebVTT for the package (always, burnt or not: production-9).
// Milliseconds, 0 credits, no network.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../errors'
import { EditPlan } from '../formats/editplan'
import { WordsMeta, WordsValue } from '../formats/timing'
import { defineNode, type NodeDef } from '../registry'
import {
  buildAss,
  buildSrt,
  buildVtt,
  CAPTION_FONT,
  CAPTION_PRESETS,
  WORD_FONT,
  labelsOf,
  makeCues
} from '../text/captions'
import { parseScript } from '../text/script'
import { progress, readText, readValue, scratch } from './common'

const Params = z.object({
  preset: z.enum(CAPTION_PRESETS).default('highlight'),
  maxChars: z.number().int().min(16).max(60).default(42),
  lines: z.union([z.literal(1), z.literal(2)]).default(1),
  position: z.enum(['bottom', 'middle', 'top']).default('bottom'),
  burn: z.boolean().default(true),
  leadMs: z.number().min(0).max(500).default(50),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFD84D'),
  /** `word`: a word spoken faster than this shares the next word's cue (measured on the reference: 0.12 s). */
  minWordS: z.number().min(0).max(0.5).optional(),
  /** No captions before this sentence of the voice (1: not over the title an intro card shows). */
  fromSentence: z.number().int().min(0).max(5).optional()
})
type Params = z.infer<typeof Params>

const run: NodeDef<Params>['run'] = async (ctx, inputs, params) => {
  const words = readValue(inputs.words, WordsValue, 'the word list')
  const plan = readValue(inputs.plan, EditPlan, 'the edit plan')
  const tokens = parseScript(readText(inputs.script, 'the script')).tokens
  if (tokens.length !== words.length) {
    throw new EngineError('bad_input', `the script has ${tokens.length} words but the voice timing has ${words.length}`)
  }
  const meta = WordsMeta.partial().safeParse(inputs.words?.meta)
  const alignment = meta.success ? meta.data.alignment : undefined
  if (alignment === 'weak' || alignment === 'estimated') {
    ctx.emit({ kind: 'log', level: 'warn', text: `word timing is ${alignment}: caption timing inside a cue is approximate` })
  }
  progress(ctx, 0, 2, 'Je découpe les sous-titres')
  const cues = makeCues(words, plan, params)
  const labels = labelsOf(plan)
  const dir = await scratch(ctx, 'captions')
  const ass = path.join(dir, 'captions.ass')
  const srt = path.join(dir, 'captions.srt')
  const vtt = path.join(dir, 'captions.vtt')
  progress(ctx, 1, 2, 'J’écris les fichiers de sous-titres')
  await writeFile(ass, buildAss(cues, labels, { ...params, size: plan.size }), 'utf8')
  await writeFile(srt, buildSrt(cues), 'utf8')
  await writeFile(vtt, buildVtt(cues), 'utf8')
  progress(ctx, 2, 2, 'Sous-titres prêts')
  return {
    subs: { files: [ass, srt, vtt], meta: { preset: params.preset, burn: params.burn, cues: cues.length, labels: labels.length, font: params.preset === 'word' ? WORD_FONT : CAPTION_FONT } }
  }
}

const def: NodeDef<Params> = {
  type: 'captions.make@1',
  inputs: {
    words: { type: 'json.words', required: true },
    script: { type: 'text.script', required: true },
    plan: { type: 'json.editplan', required: true }
  },
  outputs: { subs: 'subs.track' },
  params: Params,
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 1 }),
  run,
  fake: run
}

export const captionsMake = defineNode(def)
