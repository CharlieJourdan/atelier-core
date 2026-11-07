// P7 — the BLIND judge (spec §2 P7): a separate model call with no context. It sees two anonymous excerpts (A and B: the
// reference passage and our render, in an order it does not know), each as a numbered frame strip plus what was heard
// (transcript excerpt, pace, loudness, cut rate), answers « same channel? » with why, and scores every axis 0–100 with the
// differences it saw. A score below 100 without its defects is refused; the verdict carries what its calls cost (P7
// records it in the spend ledger). The call is paid once: an intent file is written
// before it and the verdict after, so a crash or a resume never pays twice.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { COMPARE_AXES, BlindVerdict, type BlindItem } from '../../../../shared/clone'
import type { Folder } from '../store'

/** What the judge is told each axis means (similarity of A and B on it). */
export const AXIS_MEANING: Record<(typeof COMPARE_AXES)[number], string> = {
  identity: 'who is on screen (presenter or hero character: type, look, how often)',
  layout: 'where things sit in the frame (full screen, split, inset, cards)',
  cadence: 'cut rhythm and shot lengths, how reactive the hook is',
  illustration: 'whether each picture shows what is being said, on time',
  motion: 'motion design: kinds of animated graphics, how they move and land',
  palette: 'colours, grade, textures, fonts',
  voice: 'voice kind, timbre, pace, energy',
  sound: 'music bed, effects, loudness',
  script: 'narration structure, address mode, tone, hook pattern',
  captions: 'on-screen text and subtitles (presence, style, timing)'
}

/** What was heard in an item (measured, never guessed); the judge cannot hear, so the audio comes as measures + words. */
export interface HeardItem { transcript: string; wordsPerMinute: number | null; loudnessLufs: number | null; cutsPerMinute: number | null; music: string | null }

/** The judge's prompt (pure). Nothing in it says which item is the reference or that one of them was made by us. */
/** How a judgement is asked. `placeholderWords`: the free gate's demo writes template words on its cards (its script is a
 *  template), so the wording is not judged there, only how the text looks and moves; every paid judgement reads the words. */
export interface JudgeOptions { placeholderWords?: boolean }

export const PLACEHOLDER_WORDS_RULE =
  'The words written on cards, labels and titles in these excerpts may be placeholders: for captions and motion judge the on-screen text by its type, placement, size, font, colour and timing, never by its wording.'

export function judgePrompt(items: readonly BlindItem[], heard: Readonly<Record<string, HeardItem>>, o: JudgeOptions = {}): string {
  const lines = [
    `You see ${items.length} excerpts of YouTube videos, labelled ${items.map((i) => i.label).join(' and ')}. For each one, one image is attached: a strip of numbered frames taken at the same moments of each excerpt (frame k of every strip is the same moment).`,
    'Question: do these excerpts come from the SAME YouTube channel, i.e. the same production style (not merely the same topic)? A viewer subscribed to one must not notice the other is different.',
    'Be strict and concrete: look at the frames and the measures, compare frame by frame.',
    'The same topic, the same words, the same language or the same pace do NOT make the same channel: two channels can tell the same story. Judge the PRODUCTION first: how the pictures are drawn or filmed (flat or with depth, framing, letterbox bars, point of view), the characters, the cards and their fonts, the layouts. A viewer notices a different drawing style in the first second.',
    ...(o.placeholderWords ? [PLACEHOLDER_WORDS_RULE] : []),
    '',
    'What was heard in each excerpt (measured):'
  ]
  for (const it of items) {
    const h = heard[it.label]
    if (!h) { lines.push(`- ${it.label}: not measured`); continue }
    lines.push(`- ${it.label}: pace ${h.wordsPerMinute ?? '?'} words/min; loudness ${h.loudnessLufs ?? '?'} LUFS; ${h.cutsPerMinute ?? '?'} cuts/min; music ${h.music ?? 'unknown'}; words: « ${h.transcript.slice(0, 700)} »`)
  }
  lines.push('', 'Score how SIMILAR the excerpts are on each axis, 0 (nothing alike) to 100 (indistinguishable):')
  for (const a of COMPARE_AXES) lines.push(`- ${a}: ${AXIS_MEANING[a]}`)
  lines.push(
    '',
    'For every axis scored below 100, list the concrete differences you saw (with the frame number when you can). Never give a score without its differences.',
    'Answer ONLY with JSON: {"sameChannel":"yes"|"no","reason":"…","scores":[{"axis":"identity","score":0,"defects":["…"]}, …]} with one entry per axis listed above.'
  )
  return lines.join('\n')
}

const Answer = z.object({
  sameChannel: z.enum(['yes', 'no']),
  reason: z.string().min(1),
  scores: z.array(z.object({ axis: z.enum(COMPARE_AXES), score: z.number().min(0).max(100), defects: z.array(z.string()).default([]) }))
})

/** A score whose axis name slipped into a key (`{"layout": 68, "score": 68, …}` — seen on a real round twice in a row)
 *  gets its axis back from that key; anything else is left for the schema to refuse. */
function repairAxes(raw: unknown): unknown {
  const scores = (raw as { scores?: unknown })?.scores
  if (!Array.isArray(scores)) return raw
  const axes = new Set<string>(COMPARE_AXES)
  return {
    ...(raw as object),
    scores: scores.map((s: Record<string, unknown>) => {
      if (!s || typeof s !== 'object' || axes.has(String(s['axis']))) return s
      const key = Object.keys(s).find((k) => axes.has(k))
      if (!key) return s
      const { [key]: _slip, ...rest } = s
      return { ...rest, axis: key }
    })
  }
}

/** The picture axes a « same channel » needs at this level at least: a judge who says « yes » while the drawing, the
 *  layouts or the cards differ this much contradicts himself (seen on Le Monde en POV: « yes » with layout 58 and
 *  illustration 65, where an independent blind judge said « no »). Measured rule of the engine, said in the verdict. */
export const SAME_CHANNEL_MIN_PICTURE_SCORE = 70
export const PICTURE_AXES = ['identity', 'layout', 'illustration', 'motion', 'palette'] as const

/** The JSON objects a text holds that parse, outermost and in order: from every `{`, the balanced span (strings and escapes
 *  respected) that parses, a span inside another parsed one left out. Pure. */
export function jsonObjects(text: string): string[] {
  const spans: [number, number][] = []
  for (let from = text.indexOf('{'); from >= 0; from = text.indexOf('{', from + 1)) {
    let depth = 0
    let inString = false
    for (let i = from; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        try { JSON.parse(text.slice(from, i + 1)); spans.push([from, i + 1]) } catch { /* not an object */ }
        break
      }
    }
  }
  return spans.filter(([a, b]) => !spans.some(([x, y]) => x <= a && b <= y && (x !== a || y !== b))).map(([a, b]) => text.slice(a, b))
}

/** Parse the judge's answer (pure): the JSON object in the text, every axis present, no score below 100 without defects. A model
 *  that wrote a broken object, said so and wrote it again is read on its LAST object that parses (moteur-pov-2: the POV gate
 *  stopped on « broken JSON » although the corrected verdict followed). The verdict itself is never changed. */
export function parseJudge(text: string, judge: string, costUsd: number): { verdict: BlindVerdict | null; problems: string[] } {
  if (!text.includes('{')) return { verdict: null, problems: ['the judge did not answer in JSON'] }
  const last = jsonObjects(text).at(-1)
  const raw: unknown = last === undefined ? undefined : JSON.parse(last)
  if (raw === undefined) return { verdict: null, problems: ['the judge answered broken JSON'] }
  const r = Answer.safeParse(repairAxes(raw))
  if (!r.success) return { verdict: null, problems: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  const problems: string[] = []
  for (const a of COMPARE_AXES) if (!r.data.scores.some((s) => s.axis === a)) problems.push(`axis ${a} not scored`)
  for (const s of r.data.scores) if (s.score < 100 && s.defects.length === 0) problems.push(`${s.axis} scored ${s.score} without its defects`)
  if (problems.length) return { verdict: null, problems }
  const scores = COMPARE_AXES.map((a) => r.data.scores.find((s) => s.axis === a)!)
  const low = scores.filter((s) => (PICTURE_AXES as readonly string[]).includes(s.axis) && s.score < SAME_CHANNEL_MIN_PICTURE_SCORE)
  if (r.data.sameChannel === 'yes' && low.length > 0) {
    const reason = `${r.data.reason} — counted « no » by the engine: ${low.map((s) => `${s.axis} ${s.score}`).join(', ')} under ${SAME_CHANNEL_MIN_PICTURE_SCORE} (the pictures differ too much for the same channel)`
    return { verdict: { blind: true, sameChannel: 'no', scores, reason, judge, costUsd }, problems: [] }
  }
  return { verdict: { blind: true, sameChannel: r.data.sameChannel, scores, reason: r.data.reason, judge, costUsd }, problems: [] }
}

/** One model call: a prompt and absolute image paths in, text and its cost out. No conversation, no context. */
export type AskFn = (o: { prompt: string; images: string[] }) => Promise<{ text: string; costUsd: number; model: string }>

export interface JudgeDeps {
  ask: AskFn
  /** Build one image (a numbered strip) from absolute frame paths. */
  strip(frames: readonly string[], out: string): Promise<string>
  /** What was heard in an item (by its video path). */
  heard(item: BlindItem): Promise<HeardItem>
  /** Tries when the answer is unusable (each try is a paid call, recorded). */
  tries?: number
}

const hashOf = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)

/** The real blind judge service (`CloneServices['judge']`). Frames are paths relative to the clone folder. */
export function blindJudge(d: JudgeDeps): { blind(items: readonly BlindItem[], dir: Folder, o?: JudgeOptions): Promise<BlindVerdict> } {
  return {
    async blind(items, dir, o = {}) {
      const root = dir.abs.slice(0, dir.abs.length - dir.rel.length)
      const key = hashOf(o.placeholderWords ? { items, o } : items)
      const verdictFile = path.join(dir.abs, `judge-${key}.verdict.json`)
      if (existsSync(verdictFile)) return BlindVerdict.parse(JSON.parse(readFileSync(verdictFile, 'utf8')))
      const images: string[] = []
      const heard: Record<string, HeardItem> = {}
      for (const it of items) {
        images.push(await d.strip(it.frames.map((f) => path.join(root, f)), path.join(dir.abs, `judge-${key}-${it.label}.jpg`)))
        heard[it.label] = await d.heard(it)
      }
      const prompt = judgePrompt(items, heard, o)
      writeFileSync(path.join(dir.abs, `judge-${key}.prompt.txt`), prompt, 'utf8')
      const problems: string[] = []
      let paid = 0
      for (let t = 0; t < (d.tries ?? 2); t++) {
        // an answer already saved for this try (a crash after the paid call) is read back, never paid again
        const answerFile = path.join(dir.abs, `judge-${key}.answer-${t + 1}.json`)
        let r: { text: string; costUsd: number; model: string }
        if (existsSync(answerFile)) r = JSON.parse(readFileSync(answerFile, 'utf8')) as typeof r
        else {
          writeFileSync(path.join(dir.abs, `judge-${key}.intent.json`), JSON.stringify({ try: t + 1, at: new Date().toISOString() }) + '\n', 'utf8')
          r = await d.ask({ prompt, images })
          writeFileSync(answerFile, JSON.stringify(r, null, 2) + '\n', 'utf8')
        }
        paid += r.costUsd
        const p = parseJudge(r.text, r.model, paid)
        if (p.verdict) { writeFileSync(verdictFile, JSON.stringify(p.verdict, null, 2) + '\n', 'utf8'); return p.verdict }
        problems.push(...p.problems)
      }
      // the failed tries were paid: say it in the error so the caller records it
      throw Object.assign(new Error(`the blind judge gave no usable verdict: ${problems.join('; ')}`), { costUsd: paid })
    }
  }
}
