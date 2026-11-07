// Prompts and parameters of `script.write` (docs/ENGINE-SPEC.md §17). Every prompt starts with a `TASK:` line naming the
// step, so logs and test doubles can tell the calls apart, and every system prompt starts with the output language (R32.5).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

/** The things a story handles (script-fake.ts `DemoObjects`), as a setting. */
export const DemoObjectsSchema = z.object({
  objects: z.array(z.object({ hold: z.enum(['ticket', 'phone', 'card', 'paper', 'note', 'bill']), detail: z.enum(['numbers', 'results', 'call', 'message', 'price', 'plain']).default('plain'), share: z.number().min(0).max(1).default(0) })).max(6),
  openingShare: z.number().min(0).max(1),
  openingWords: z.number().int().min(0).max(5000),
  bodyShare: z.number().min(0).max(1)
})
import { EngineError } from '../errors'
import { SHAPES, type Outline } from '../formats/outline'
import { TAGS } from '../formats/timing'
import type { RunCtx } from '../registry'
import { need } from '../services'
import { languageLine } from './common'

export const Params = z.object({
  language: z.string().min(2).default('fr'),
  wpm: z.number().int().min(60).max(300).optional(),
  /** An imported script's beats: false cuts them here without the model (a story short needs no chapters: one call and a minute saved). */
  tagImport: z.boolean().optional(),
  skills: z.array(z.string().min(1)).default(['hook', 'retention', 'rehooks', 'cta']),
  shape: z.enum(['auto', ...SHAPES]).default('auto'),
  partsThreshold: z.number().int().min(100).default(1500),
  revise: z.boolean().default(true),
  chapters: z.union([z.literal('auto'), z.number().int().min(0).max(8)]).default('auto'),
  ctaMode: z.enum(['none', 'end', 'mid_end']).default('end'),
  forbidden: z.array(z.string().min(1)).default([]),
  /**
   * The channel's style profile as writing guidance (lot "eyes", src/shared/style-profile.ts): tone, the usual order of the parts,
   * the usual hook. Absent = none of these lines is in any prompt, so a run without a profile writes exactly as it always did.
   */
  /**
   * The channel's own words about its scripts (its standards and its script style, written or measured at import/creation):
   * said to the outline and to the writer of every script, so a script made by the team sounds like the channel (issue #107).
   */
  channelStyle: z.string().max(3000).optional(),
  style: z
    .object({
      tone: z.string().max(300).default(''),
      structure: z.array(z.string().min(1).max(30)).max(12).default([]),
      hookPattern: z.string().max(80).default(''),
      hookExample: z.string().max(400).default(''),
      hookSeconds: z.number().min(0).max(120).default(0),
      /** moteur-pov-2: the things the channel's stories handle in the viewer's hands (measured), and how often. */
      objects: DemoObjectsSchema.optional(),
      /** moteur-pov-2: how the channel addresses the viewer, measured (« you »: a second-person story). */
      address: z.enum(['you', 'we', 'i', 'neutral']).optional()
    })
    .optional()
})
export type Params = z.infer<typeof Params>

/** The pattern line of the things handled (our words: the facts still come from the brief). */
export function objectsLine(o: z.infer<typeof DemoObjectsSchema>): string {
  const list = o.objects.map((x) => `${x.hold}${x.detail !== 'plain' ? ` (${x.detail})` : ''}`).join(', ')
  return `This channel's stories handle concrete things in the viewer's own hands: ${list}. In the opening, about ${Math.round(o.openingShare * 100)} % of the sentences have the viewer pick up, check or use one of them (what is on it said: its numbers, the results, the call); later about ${Math.round(o.bodyShare * 100)} %.`
}

/** The lines of a prompt that carry the channel's style; empty without a profile. */
export function styleGuide(style: Params['style'], part: 'writer' | 'outline'): string[] {
  if (!style) return []
  if (part === 'writer') return style.tone ? [`Voice of this channel (match it): ${style.tone}.`] : []
  const lines: string[] = []
  if (style.structure.length > 0) {
    lines.push(
      `Shape of this channel's videos, as the order of their parts: ${style.structure.join(' > ')}. Let the story follow that order; it is a guide to the rhythm, not a list of headings.`
    )
  }
  if (style.hookPattern) {
    const lasting = style.hookSeconds > 0 ? `, lasting about ${Math.round(style.hookSeconds)} seconds` : ''
    const example = style.hookExample ? ` An example of the pattern from the channel (copy the pattern, never the words): "${style.hookExample}"` : ''
    lines.push(
      `Hook pattern of this channel: ${style.hookPattern}${lasting}. Use this pattern for the hook when it fits the brief; the facts in it must still come from the brief.${example}`
    )
  }
  if (style.objects && style.objects.objects.length > 0) lines.push(objectsLine(style.objects))
  if (style.address === 'you') lines.push('This channel tells its stories to the viewer in the second person: the viewer is the hero, living each moment (places, actions, reactions, amounts), never a lecture about dates.')
  return lines
}

const BRIEF_CAP = 24_000

/** The text of the selected skills (resources/skills/script/<name>.md). An unknown name is a `bad_params` error. */
export async function loadSkills(ctx: RunCtx, names: readonly string[]): Promise<string> {
  const root = need(ctx, 'library').root
  const texts: string[] = []
  for (const name of names) {
    if (!/^[a-z0-9_-]+$/.test(name)) throw new EngineError('bad_params', `Compétence inconnue : « ${name} »`)
    try {
      texts.push((await readFile(path.join(root, 'skills', 'script', `${name}.md`), 'utf8')).trim())
    } catch {
      throw new EngineError('bad_params', `Compétence inconnue : « ${name} »`)
    }
  }
  return texts.join('\n\n---\n\n')
}

const ctaRule = (mode: Params['ctaMode']): string =>
  mode === 'none'
    ? 'Call to action: write none.'
    : mode === 'end'
      ? 'Call to action: exactly one, near the very end, after the payoff. None elsewhere.'
      : 'Call to action: at most one in the middle, only at a pause between two beats and never inside an open loop, and one near the very end, after the payoff.'

/** System prompt of the writing calls: language first, the stable rules, then the selected skills. */
export function channelStyleLines(p: Pick<Params, 'channelStyle'>): string[] {
  const s = p.channelStyle?.trim()
  return s ? [`This channel's own standards and script style (follow them; the facts still come from the brief only):
${s}`] : []
}

export function writerSystem(lang: string, skills: string, style?: Params['style'], channelStyle?: string): string {
  return [
    languageLine(lang),
    'You are the scriptwriter of a documentary video made of narration over images. You write the words a narrator will read aloud.',
    'Output rules: narration only, as plain text. Paragraphs separated by a blank line. No title, no headings, no Markdown, no stage directions, no notes to the editor, no word count, no preface and no closing remark.',
    'Truth over drama: use only facts found in the brief. Invent no scene detail, no quote, no figure, no superlative. If a device needs a fact the brief lacks, drop the device.',
    'Spoken style: short sentences (about 10 to 16 words), concrete nouns, active voice, one idea per sentence, few numbers and each one explained.',
    ...styleGuide(style, 'writer'),
    ...channelStyleLines({ channelStyle }),
    skills ? `Craft guidelines to follow:\n\n${skills}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function outlineSystem(lang: string): string {
  return [
    languageLine(lang),
    'You are the story architect of a documentary video. You plan the script and answer with one JSON value only.',
    'Truth over drama: plan only with facts found in the brief.'
  ].join('\n\n')
}

const notesBlock = (notes: readonly string[]): string =>
  notes.length > 0 ? `\n\nRequested changes (apply them):\n${notes.map((n) => `- ${n}`).join('\n')}` : ''

const OUTLINE_SHAPE = `{
  "language": "<code>",
  "title": "<working title>",
  "shape": "${SHAPES.join('|')}",
  "kind": "story|lesson",
  "promise": "<the promise of the title, one sentence>",
  "hook": "<the opening, 40 to 60 words, written out>",
  "beats": [{ "index": 0, "purpose": "<one line>", "summary": "<one line>", "wordBudget": <integer>, "tags": [${TAGS.map((t) => `"${t}"`).join(', ')} ... only those that apply], "anchor": "", "marks": [{ "tag": "figure|citation|pivot|disclosure", "anchor": "<first 8 words of the sentence>" }] }],
  "chapters": [{ "title": "<2 to 5 words>", "firstBeat": <beat index> }],
  "planted": [{ "detail": "<detail planted early>", "plantedBeat": <index>, "payoffBeat": <index> }]
}`

export function outlinePrompt(o: { brief: string; words: number; minutes: number; p: Params; notes: readonly string[] }): string {
  const beatCount = Math.max(3, Math.round(o.minutes))
  return [
    'TASK: outline',
    `Plan the script of a video of ${o.minutes} minutes: about ${o.words} spoken words in total.`,
    'First decide whether this is a story (narrative) or a lesson (explanatory). Then choose the shape' +
      (o.p.shape === 'auto' ? ' that fits the title and the brief best.' : `: it is imposed, use "${o.p.shape}".`),
    'Hook rules: it confirms the promise of the title and uses at least two of: an open question, a hard specific (name, number, date), a contradiction, rising stakes. No greeting, no channel name, no "in this video". Check your own hook against these rules before answering.',
    `Beats: about ${beatCount} beats (roughly one per minute, at least ${Math.max(6, Math.round(0.6 * o.minutes))} when the video lasts 8 minutes or more). Each beat answers one question and opens the next within its last seconds. A concrete event at least every 30 seconds. Best material in the middle, second best first, third best last. The payoff is foreshadowed in the hook and around one third and two thirds. The word budgets of the beats add up to ${o.words}.`,
    o.minutes >= 6
      ? `Chapters: ${typeof o.p.chapters === 'number' ? o.p.chapters : '3 to 8'} short concrete titles (2 to 5 words), each starting at a beat.`
      : 'Chapters: none (empty list).',
    ctaRule(o.p.ctaMode),
    ...styleGuide(o.p.style, 'outline'),
    ...channelStyleLines(o.p),
    `Answer with ONE JSON value of this shape:\n${OUTLINE_SHAPE}`,
    `Brief:\n${o.brief.slice(0, BRIEF_CAP)}${notesBlock(o.notes)}`
  ].join('\n\n')
}

/** Outline of a pasted script (R17.14): beats and tags found in the text, chapters proposed, nothing rewritten. */
export function taggingPrompt(o: { script: string; words: number; minutes: number; p: Params; notes: readonly string[] }): string {
  return [
    'TASK: tags',
    'The script below is already written and must not change. Describe its structure only.',
    'Split it into about one beat per minute. For each beat give the first 8 words of its first sentence, copied exactly, as "anchor". Tag the beats and the key sentences with the tag vocabulary. Add short chapter titles' +
      (o.minutes >= 6 ? ' (3 to 8, 2 to 5 words each).' : ' only if it is long enough, else an empty list.'),
    `The word budgets of the beats add up to ${o.words}.`,
    `Answer with ONE JSON value of this shape:\n${OUTLINE_SHAPE}`,
    `Script:\n${o.script}${notesBlock(o.notes)}`
  ].join('\n\n')
}

const outlineDigest = (outline: Outline): string =>
  JSON.stringify({
    title: outline.title,
    shape: outline.shape,
    kind: outline.kind,
    promise: outline.promise,
    hook: outline.hook,
    planted: outline.planted,
    beats: outline.beats.map((b) => ({ index: b.index, purpose: b.purpose, summary: b.summary, wordBudget: b.wordBudget, tags: b.tags }))
  })

export interface PartInfo {
  k: number
  n: number
  beats: Outline['beats']
  budget: number
}

/** Prompt of one writing call: the whole script (n = 1) or part k of n. */
export function writePrompt(o: {
  outline: Outline
  brief: string
  part: PartInfo
  soFar: string
  summary: string
  p: Params
  notes: readonly string[]
}): string {
  const { part } = o
  const single = part.n === 1
  const position = single
    ? 'Write the complete narration in one piece: open cold with the hook, end by paying the promise.'
    : part.k === 1
      ? `This is part 1 of ${part.n}. Open cold (no greeting, no "in this video"). End mid-story, with no recap and no wrap-up.`
      : part.k === part.n
        ? `This is part ${part.k} of ${part.n}, the last one. Continue seamlessly from the narration so far, pay the promise and end the episode.`
        : `This is part ${part.k} of ${part.n}. Continue seamlessly from the narration so far. End mid-story, with no recap and no wrap-up.`
  const cta =
    o.p.ctaMode === 'mid_end' && !single && part.k === Math.ceil(part.n / 2) && part.k !== part.n
      ? ' Put the middle call to action in this part, at a pause between two beats.'
      : ''
  return [
    single ? 'TASK: write' : `TASK: part ${part.k} of ${part.n}`,
    position + cta,
    `Length: about ${part.budget} words (between ${Math.round(part.budget * 0.9)} and ${Math.round(part.budget * 1.1)}). Write the full length, never pad with filler.`,
    ctaRule(o.p.ctaMode),
    `Outline of the whole video:\n${outlineDigest(o.outline)}`,
    `Beats of this ${single ? 'script' : 'part'}, in order, with their word budgets:\n${part.beats.map((b) => `- beat ${b.index} (${b.wordBudget} words, tags: ${b.tags.join(', ') || 'none'}): ${b.purpose}. ${b.summary}`).join('\n')}`,
    o.summary ? `Summary of the earlier parts (details planted there must still pay off):\n${o.summary}` : '',
    o.soFar ? `Narration written so far (the end of it):\n${o.soFar.slice(-20_000)}` : '',
    `Brief (the only source of facts):\n${o.brief.slice(0, BRIEF_CAP)}`,
    notesBlock(o.notes).trim() ? notesBlock(o.notes).trim() : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Asks for a full-length rewrite of a text that came out short (R17.5) or outside the band. */
export function lengthPrompt(o: { draft: string; target: number; words: number; part: PartInfo }): string {
  const dir = o.words < o.target ? 'too short' : 'too long'
  return [
    'TASK: rewrite at full length',
    `The draft below is ${dir}: ${o.words} words instead of about ${o.target}. Rewrite it at full length (${Math.round(o.target * 0.95)} to ${Math.round(o.target * 1.08)} words).` +
      (o.words < o.target ? ' Develop what the beats ask for with concrete material from the brief; never pad with filler.' : ' Tighten it without removing a beat.'),
    'Keep the same facts, the same order, the same opening and ending. Answer with the narration only.',
    `Beats:\n${o.part.beats.map((b) => `- beat ${b.index} (${b.wordBudget} words): ${b.summary}`).join('\n')}`,
    `Draft:\n${o.draft}`
  ].join('\n\n')
}

export function revisePrompt(o: { draft: string; brief: string; words: number; notes: readonly string[] }): string {
  return [
    'TASK: revise',
    'Score the draft against the hook, beat and retention rules (a real hook in 15 seconds, an open loop at every beat, a concrete event every 30 seconds, the payoff late, short spoken sentences), then rewrite it so it satisfies them.',
    `Stay within 10 percent of ${o.words} words. Add NO fact: no new number, name, date or quote that is not already in the draft or the brief, and keep every hedge on a figure. Answer with the rewritten narration only.`,
    `Brief:\n${o.brief.slice(0, BRIEF_CAP)}`,
    `Draft:\n${o.draft}${notesBlock(o.notes)}`
  ].join('\n\n')
}

export function forbiddenPrompt(o: { items: { index: number; text: string }[]; stems: readonly string[] }): string {
  return [
    'TASK: forbidden words',
    `Each numbered sentence below contains a word that must not be used (forbidden word beginnings: ${o.stems.join(', ')}). Rewrite each one with the same meaning, as ONE sentence, without any of these words.`,
    'Answer with one line per sentence, in the form "<number>: <rewritten sentence>", nothing else.',
    o.items.map((i) => `${i.index}: ${i.text}`).join('\n')
  ].join('\n\n')
}
