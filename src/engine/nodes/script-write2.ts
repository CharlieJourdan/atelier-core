// `script.write@2` (docs/specs/pipeline-avatar.md §2.2, production-4): `script.write@1` for a presenter who speaks to the viewer.
// Same outline-then-parts writing (ENGINE-SPEC §17.1, §17.2) and the same passes, plus:
// - the target length uses the words per minute measured on avatar channels (`wpmMeasured`; the channel's own rate wins);
// - the structure of the 18 reference channels: a numbered list or the « mistake → why → the old way » arc
//   (`numberedParts`), the persona's authority line early, concrete amounts, a cold open, a closing question;
// - the support videos (`json.support`): « structure » videos shape the outline, « sujet » videos feed the content.
// An imported script (`pasted`) skips writing (R17.14) and never needs a model (production-17). Models per use (0013): Sonnet writes, Haiku fits and tags.
import { z } from 'zod'
import { EngineError } from '../errors'
import { Support, structureLines, subjectLines, type SupportPart } from '../formats/support'
import type { Outline, OutlineBeat } from '../formats/outline'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import { cleanScript, detectLanguage, wpmMeasured } from '../text/lint'
import type { Json } from '../types'
import { cleanWithAdMarker } from '../text/ad-marker'
import { readValue } from './common'
import { fakeScript } from './script-fake'
import { anchorOutline, fakeOutlineFor, scaleBudgets, topicOf } from './script-outline'
import { Params as Params1 } from './script-prompts'
import { finish, pastedScript, readInputs, writeScript, type WriteExtra } from './script-write'

const WORDS_PER_PART = 750

export const Params = Params1.extend({
  /** auto: the model picks the list or the mistake arc from the idea and the channel; yes: a numbered list; no: the mistake arc. */
  numberedParts: z.enum(['auto', 'yes', 'no']).default('auto'),
  /** The persona's authority line (« 30 ans de métier »…), said early when given. */
  persona: z.string().max(300).optional()
})
export type Params = z.infer<typeof Params>

function readSupport(inputs: ResolvedInputs): Support | undefined {
  return inputs.support ? readValue(inputs.support, Support, 'The support videos') : undefined
}

const SHAPE_LINE: Record<Params['numberedParts'], string> = {
  yes: 'Shape: a numbered list (« 5 choses à savoir », « 10 erreurs »). Use the shape "countdown": announce each item with its number, give each a concrete example, keep the strongest item for last.',
  no: 'Shape: the mistake arc. Use the shape "howto": the costly mistake most people make, why it costs them, then the old way that works, step by step.',
  auto: 'Shape: choose ONE of the two shapes these channels repeat: a numbered list (shape "countdown": numbered items, the strongest last) or the mistake arc (shape "howto": the costly mistake, why, the old way that works). Pick the one the title and the channel structure call for.'
}

/** The prompt lines of the avatar structure and of the support videos. */
export function avatarExtra(p: Params, support: Support | undefined): WriteExtra {
  const persona = p.persona ? `The persona's authority line, to say once in the first 30 seconds: ${p.persona}.` : 'Give the presenter an authority line early (years of practice, a family method, a trade), only if the brief supports it.'
  return {
    system: [
      'This video is spoken by an on-screen presenter facing the viewer: write in the presenter’s own voice, addressing the viewer directly, warm and concrete.',
      'Common practical knowledge may be used beside the brief, but every amount, price, date, name or quote still comes from the brief or the subject videos.'
    ],
    outline: [
      SHAPE_LINE[p.numberedParts],
      `${persona} Use concrete amounts, prices and savings where the brief has them. Open cold on the costly mistake or the promise; close on one question to the viewers.`,
      ...structureLines(support),
      ...subjectLines(support)
    ],
    write: subjectLines(support)
  }
}

/** The fake outline built on the « structure » videos' parts: one beat per part, budgets by share (the outline follows the shape). */
function structuredOutline(base: Outline, text: string, parts: readonly SupportPart[], numbered: boolean): Outline {
  if (parts.length === 0) return numbered ? { ...base, shape: 'countdown' } : base
  const budgets = scaleBudgets(parts.map((x) => Math.max(0.01, x.share)), base.beats.reduce((a, b) => a + b.wordBudget, 0))
  const beats: OutlineBeat[] = parts.map((x, i) => ({
    index: i,
    purpose: `${x.kind}: ${x.summary}`.slice(0, 200),
    summary: x.summary || x.kind,
    wordBudget: budgets[i] ?? 1,
    tags: i === 0 ? ['hook', 'promise'] : i === parts.length - 1 ? ['payoff'] : [],
    anchor: '',
    marks: []
  }))
  const chapters = base.chapters.filter((c) => c.firstBeat < beats.length)
  return anchorOutline({ ...base, shape: numbered ? 'countdown' : base.shape, beats, chapters, planted: [], dropped: [] }, text)
}

export const scriptWrite2 = defineNode<Params>({
  type: 'script.write@2',
  // moteur-pov-2: the demo script follows the measured object pattern and address; the drawn director's demo shots changed
  fakeVersion: 3,
  inputs: {
    brief: { type: 'text.brief', required: false, label: 'Brief' },
    pasted: { type: 'text.input', required: false, label: 'Script importé' },
    support: { type: 'json.support', required: false, label: 'Vidéos d’appui' }
  },
  outputs: { text: 'text.script', outline: 'json.outline' },
  params: Params,
  reads: ['minutes'],
  executors: ['local'],
  claudeRole: 'scriptwriter',
  estimate(ctx, p) {
    const words = Math.round(ctx.minutes * (p.wpm ?? wpmMeasured(p.language)))
    const parts = words <= p.partsThreshold ? 1 : Math.max(2, Math.round(words / WORDS_PER_PART))
    const calls = 1 + parts + (p.revise ? 1 : 0)
    return { units: [{ unit: 'calls', qty: calls }], provider: 'claude', durationS: 60 + calls * 90 }
  },

  async run(ctx, inputs, p) {
    const given = readInputs(inputs)
    const wpm = p.wpm ?? wpmMeasured(p.language)
    const words = Math.round(ctx.minutes * wpm)
    // an imported script needs no model (production-17)
    if (given.pasted) {
      const r = await pastedScript(ctx, given.pasted, p)
      return finish(r.done, { words, wpm, language: r.language, forbidden: p.forbidden })
    }
    need(ctx, 'claude')
    const support = readSupport(inputs)
    const done = await writeScript(ctx, given.brief ?? '', p, wpm, words, avatarExtra(p, support))
    done.extra = { ...done.extra, wpm, support: supportMeta(support) }
    return finish(done, { words, wpm, language: p.language, forbidden: p.forbidden })
  },

  async fake(ctx, inputs, p) {
    const given = readInputs(inputs)
    const wpm = p.wpm ?? wpmMeasured(p.language)
    const words = Math.round(ctx.minutes * wpm)
    if (given.pasted) return fakePasted(ctx, given.pasted, p, words, wpm)
    const support = readSupport(inputs)
    const subjects = (support?.videos ?? []).filter((v) => v.tag === 'subject')
    const parts = (support?.videos ?? []).find((v) => v.tag === 'structure')?.parts ?? []
    // a « sujet » video changes what is said (its title joins the topic), a « structure » one the outline
    const topic = [topicOf(given.brief, inputs.brief?.meta?.title), ...subjects.map((v) => v.title).filter(Boolean)].join(', ')
    const text = fakeScript({ topic, language: p.language, words, seed: ctx.seed, ...(p.style?.objects ? { objects: p.style.objects } : {}), ...(p.style?.address ? { address: p.style.address } : {}) })
    const base = fakeOutlineFor(text, { topic, language: p.language, minutes: ctx.minutes, chapters: p.chapters })
    const outline = structuredOutline(base, text, parts, p.numberedParts === 'yes')
    return finish(
      { text, outline, pasted: false, demo: true, warnings: [], extra: { wpm, support: supportMeta(support) } },
      { words, wpm, language: p.language, forbidden: p.forbidden }
    )
  }
})

function supportMeta(s: Support | undefined): { subject: number; structure: number; dropped: number } {
  const v = s?.videos ?? []
  return { subject: v.filter((x) => x.tag === 'subject').length, structure: v.filter((x) => x.tag === 'structure').length, dropped: s?.dropped.length ?? 0 }
}

function fakePasted(ctx: RunCtx, pasted: string, p: Params, words: number, wpm: number) {
  const { text, marker } = cleanWithAdMarker(pasted, cleanScript)
  if (!text) throw new EngineError('bad_input', 'Le script importé est vide.')
  const det = detectLanguage(text)
  const language = det === 'other' ? p.language : det
  const topic = topicOf(undefined, text.split(/\s+/).slice(0, 8).join(' '))
  const outline = fakeOutlineFor(text, { topic, language, minutes: ctx.minutes, chapters: p.chapters })
  return finish({ text, outline, pasted: true, demo: true, warnings: [], extra: marker ? { adMarker: marker as unknown as Json } : {} }, { words, wpm, language, forbidden: p.forbidden })
}
