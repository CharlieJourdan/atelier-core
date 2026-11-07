// `script.translate@1` (the « translate » kind of a drawn pipeline): the script, in another language, with its structure
// kept. The narration goes through the host's Claude paragraph group by paragraph group (the paragraph count is checked:
// a translation never merges or drops one, so the sentences, the beats and the captions line up with the original), the
// outline's wording goes in one more call, and its anchors are carried over sentence for sentence. A script already in the
// target language passes through untouched. The voice, the beats, the captions and the package then read THIS node's
// script and outline. The demo version cannot translate (a template text has nothing to translate): it writes the demo
// script of the same length in the target language.
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { Outline } from '../formats/outline'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import { cleanScript, detectLanguage } from '../text/lint'
import { anchorOf, countWords, findAnchor, parseScript, type ParsedScript } from '../text/script'
import type { Json } from '../types'
import { askJson, languageLine, progress, readText, readValue, throwIfAborted } from './common'
import { fakeScript } from './script-fake'
import { anchorOutline } from './script-outline'

export const TranslateParams = z.object({
  /** Target language (BCP 47 prefix: `fr`, `en`, `es`…). */
  language: z.string().min(2).default('en'),
  /** Words per call: paragraphs are grouped up to about this many. */
  chunkWords: z.number().int().min(150).max(1500).default(500)
})
type Params = z.infer<typeof TranslateParams>

const RULES = [
  'You are a professional translator of narration scripts that will be read aloud by a voice.',
  'Rules:',
  '- Translate faithfully and naturally, as one fluent narrator would say it; keep the tone, the rhythm, the numbers, the proper names and the humour.',
  '- Keep the SAME paragraphs, in the same order: one translated paragraph for each paragraph given, never merging or splitting them.',
  '- Keep the same sentences too: no sentence added, none dropped, none moved to another paragraph.',
  '- Write numbers and abbreviations the way a voice should read them in the target language. No stage directions, no notes, no quotation of the original.',
  '- If a paragraph is already in the target language, return it unchanged.'
].join('\n')

/** Paragraph groups of at most about `chunkWords` words (a paragraph is never split). */
export function chunkParagraphs(paragraphs: readonly string[], chunkWords: number): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let n = 0
  for (const p of paragraphs) {
    const w = countWords(p)
    if (cur.length > 0 && n + w > chunkWords) {
      out.push(cur)
      cur = []
      n = 0
    }
    cur.push(p)
    n += w
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/** A translated group: exactly `n` paragraphs, of a length in the range a translation can have. */
const groupSchema = (n: number, sourceWords: number): z.ZodType<{ paragraphs: string[] }> =>
  z
    .object({ paragraphs: z.array(z.string().min(1)) })
    .refine((v) => v.paragraphs.length === n, { message: `give exactly ${n} paragraphs (one per paragraph of the source), not the number you gave` })
    .refine(
      (v) => {
        const w = countWords(v.paragraphs.join(' '))
        return w >= sourceWords * 0.4 && w <= sourceWords * 2.5
      },
      { message: 'the translation is much shorter or longer than the source: translate everything, add nothing' }
    )

const OutlineWords = (nBeats: number, nChapters: number, nPlanted: number): z.ZodType<{ title: string; promise: string; hook: string; beats: { purpose: string; summary: string }[]; chapters: string[]; planted: string[] }> =>
  z
    .object({
      title: z.string().min(1),
      promise: z.string().min(1),
      hook: z.string().min(1),
      beats: z.array(z.object({ purpose: z.string().min(1), summary: z.string().min(1) })),
      chapters: z.array(z.string().min(1)),
      planted: z.array(z.string().min(1))
    })
    .refine((v) => v.beats.length === nBeats && v.chapters.length === nChapters && v.planted.length === nPlanted, {
      message: `give exactly ${nBeats} beats, ${nChapters} chapters and ${nPlanted} planted details, in the order of the source`
    })

/** Position of each sentence in its paragraph, to find "the same sentence" in a translation with the same paragraphs. */
function sentenceMap(src: ParsedScript, tgt: ParsedScript): (i: number) => number | null {
  const byPara = (p: ParsedScript): Map<number, number[]> => {
    const m = new Map<number, number[]>()
    for (const s of p.sentences) m.set(s.paragraph, [...(m.get(s.paragraph) ?? []), s.index])
    return m
  }
  const a = byPara(src)
  const b = byPara(tgt)
  return (i) => {
    const s = src.sentences[i]
    if (!s) return null
    const from = a.get(s.paragraph) ?? []
    const to = b.get(s.paragraph) ?? []
    if (to.length === 0) return null
    const k = from.indexOf(i)
    return to[Math.min(to.length - 1, Math.round((k * to.length) / Math.max(1, from.length)))] ?? null
  }
}

/** The outline with its words translated and its anchors moved to the same sentences of the translated text. */
export function carryOutline(outline: Outline, words: z.infer<ReturnType<typeof OutlineWords>>, src: string, tgt: string, language: string): Outline {
  const from = parseScript(src)
  const to = parseScript(tgt)
  const map = sentenceMap(from, to)
  const moved = (anchor: string): string => {
    if (!anchor) return ''
    const at = findAnchor(from, anchor)
    const target = at === null ? null : map(at)
    const sentence = target === null ? undefined : to.sentences[target]
    return sentence ? anchorOf(sentence.text) : anchor
  }
  let planted = 0
  return anchorOutline(
    {
      ...outline,
      language,
      title: words.title,
      promise: words.promise,
      hook: words.hook,
      beats: outline.beats.map((b, i) => ({
        ...b,
        purpose: words.beats[i]?.purpose ?? b.purpose,
        summary: words.beats[i]?.summary ?? b.summary,
        anchor: moved(b.anchor),
        marks: b.marks.map((m) => ({ ...m, anchor: moved(m.anchor) }))
      })),
      chapters: outline.chapters.map((c, i) => ({ ...c, title: (words.chapters[i] ?? c.title).slice(0, 60), anchor: '' })),
      planted: outline.planted.map((d) => ({ ...d, detail: words.planted[planted++] ?? d.detail }))
    },
    tgt
  )
}

function result(text: string, outline: Outline, meta: Record<string, Json>): NodeOutputs {
  return { text: { value: text, meta: { language: outline.language, words: countWords(text), ...meta } }, outline: { value: outline as unknown as Json } }
}

async function translate(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const source = readText(inputs.script, 'the script')
  const outline = readValue(inputs.outline, Outline, 'the outline')
  const detected = detectLanguage(source)
  if (detected === p.language) {
    ctx.emit({ kind: 'log', level: 'info', text: `le script est déjà en « ${p.language} » : rien à traduire` })
    return result(source, { ...outline, language: p.language }, { translated: false, from: detected })
  }
  need(ctx, 'claude')
  const parsed = parseScript(source)
  const groups = chunkParagraphs(parsed.paragraphs, p.chunkWords)
  const system = `${languageLine(p.language)}\n${RULES}`
  const pieces: string[] = []
  for (const [i, group] of groups.entries()) {
    throwIfAborted(ctx)
    progress(ctx, i, groups.length + 1, groups.length > 1 ? `Traduction : partie ${i + 1} sur ${groups.length}` : 'Traduction du script…')
    const prompt = [
      `Translate into the target language the ${group.length} paragraph(s) below${detected !== 'other' ? ` (source language: ${detected === 'fr' ? 'French' : 'English'})` : ''}.`,
      `Answer with ONE JSON object {"paragraphs":[…]} holding exactly ${group.length} string(s), nothing else.`,
      ...(ctx.notes.length > 0 ? ['Requested changes from the reviewer:', ...ctx.notes.map((n) => `- ${n}`)] : []),
      '',
      ...group.map((para, k) => `[${k + 1}] ${para}`)
    ].join('\n')
    const answer = await askJson(ctx, { role: 'scriptwriter', system, prompt, schema: groupSchema(group.length, countWords(group.join(' '))) })
    pieces.push(...answer.paragraphs.map((x) => x.replace(/\s+/g, ' ').trim()))
  }
  const text = cleanScript(pieces.join('\n\n'))
  if (parseScript(text).paragraphs.length !== parsed.paragraphs.length) {
    throw new EngineError('bad_output', 'La traduction n’a pas gardé les paragraphes du script.')
  }
  if ((p.language === 'fr' || p.language === 'en') && countWords(text) >= 60 && detectLanguage(text) !== p.language) {
    throw new EngineError('bad_output', `La traduction n’est pas en « ${p.language} » (langue détectée : « ${detectLanguage(text)} »).`)
  }
  progress(ctx, groups.length, groups.length + 1, 'Traduction du plan…')
  const words = await askJson(ctx, {
    role: 'scriptwriter',
    system,
    prompt: [
      'Translate the wording of this outline into the target language. Keep the order and the count of every list.',
      'Answer with ONE JSON object {"title","promise","hook","beats":[{"purpose","summary"}],"chapters":["…"],"planted":["…"]}, nothing else.',
      JSON.stringify({
        title: outline.title,
        promise: outline.promise,
        hook: outline.hook,
        beats: outline.beats.map((b) => ({ purpose: b.purpose, summary: b.summary })),
        chapters: outline.chapters.map((c) => c.title),
        planted: outline.planted.map((d) => d.detail)
      })
    ].join('\n'),
    schema: OutlineWords(outline.beats.length, outline.chapters.length, outline.planted.length)
  })
  progress(ctx, groups.length + 1, groups.length + 1, 'Script traduit')
  return result(text, carryOutline(outline, words, source, text, p.language), { translated: true, from: detected, calls: groups.length + 1 })
}

/** Demo: the template script of the same length in the target language (there is no real content to translate). */
async function fakeTranslate(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const source = readText(inputs.script, 'the script')
  const outline = readValue(inputs.outline, Outline, 'the outline')
  if (detectLanguage(source) === p.language) return result(source, { ...outline, language: p.language }, { translated: false, demo: true })
  const text = fakeScript({ topic: outline.title, language: p.language, words: countWords(source), seed: ctx.seed })
  const anchored = anchorOutline({ ...outline, language: p.language, beats: outline.beats.map((b) => ({ ...b, anchor: '', marks: [] })), chapters: outline.chapters.map((c) => ({ ...c, anchor: '' })) }, text)
  return result(text, anchored, { translated: true, demo: true })
}

export const scriptTranslate = defineNode({
  type: 'script.translate@1',
  inputs: {
    script: { type: 'text.script', required: true, label: 'Script' },
    outline: { type: 'json.outline', required: true, label: 'Plan du script' }
  },
  outputs: { text: 'text.script', outline: 'json.outline' },
  params: TranslateParams,
  executors: ['local'],
  claudeRole: 'scriptwriter',
  estimate: (ctx, p) => {
    const calls = 1 + Math.max(1, Math.ceil((ctx.minutes * 150) / p.chunkWords))
    return { units: [{ unit: 'calls', qty: calls }], provider: 'claude', durationS: 20 + calls * 40 }
  },
  run: translate,
  fake: fakeTranslate
})
