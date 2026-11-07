// `package.youtube@1` v0 (docs/ENGINE-SPEC.md §30): titles, description, chapters, tags and the upload folder (the
// video, `description.txt`, the captions file, `metadata.json`, a checklist). It NEVER uploads (R4.2). run: Claude
// (role Packager) writes titles, description and tags as JSON, checked by our rules; chapters are always timed by us
// from the word times (exact, the script is ours). fake: the same rules on template text. Gate: owner, always (R11.4).
import { copyFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { Outline } from '../formats/outline'
import { EditPlan } from '../formats/editplan'
import { WordsValue, aspectOfSize, type Word } from '../formats/timing'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { findAnchor, keyTerms, normWord, parseScript, STOP_WORDS } from '../text/script'
import type { Json } from '../types'
import { askJson, languageLine, readFile0, readText, readValue, scratch } from './common'

export const PackageParams = z.object({
  language: z.string().min(2).default('fr'),
  /** The channel's recent titles: alternatives must not duplicate them (§30 step 1). */
  avoidTitles: z.array(z.string()).default([]),
  /** Lines added after the description (style `packaging.descriptionTemplate`, v0: plain lines). */
  footer: z.array(z.string()).default([])
})
type Params = z.infer<typeof PackageParams>

const Written = z.object({
  titles: z.array(z.string().min(3).max(100)).min(2).max(4),
  description: z.string().min(40).max(2500),
  tags: z.array(z.string().min(2).max(40)).min(5).max(25)
})
type Written = z.infer<typeof Written>

export interface Chapter {
  at: number
  title: string
}

const clock = (s: number): string => {
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** YouTube chapters from the outline (§30 step 3): first at 0:00, ≥ 3, ≥ 10 s apart, titles ≤ 60; else none. */
export function chaptersFrom(outline: Outline, script: string, words: readonly Word[]): Chapter[] {
  const parsed = parseScript(script)
  const out: Chapter[] = []
  for (const c of outline.chapters) {
    const s = c.anchor ? findAnchor(parsed, c.anchor) : null
    const first = s === null ? undefined : parsed.sentences[s]?.first
    const at = first === undefined ? null : (words[first]?.start ?? null)
    if (at === null) continue
    const title = c.title.slice(0, 60)
    if (out.length === 0) out.push({ at: 0, title })
    else if (at - (out.at(-1) as Chapter).at >= 10) out.push({ at, title })
  }
  return out.length >= 3 ? out : []
}

/** Title rules (§30 step 1): ≤ 100 characters, no angle brackets, distinct from each other and from recent titles. */
export function cleanTitles(titles: readonly string[], avoid: readonly string[]): string[] {
  const seen = new Set(avoid.map((t) => normWord(t.replace(/\s+/g, ''))))
  const out: string[] = []
  for (const raw of titles) {
    const t = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const k = normWord(t.replace(/\s+/g, ''))
    if (t.length >= 3 && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

/** 10–18 lowercase tags, deduplicated, ≤ 500 characters in all (§30 step 4). */
export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = []
  let total = 0
  for (const raw of tags) {
    const t = raw.toLowerCase().replace(/[<>,#]/g, '').replace(/\s+/g, ' ').trim()
    if (t.length < 2 || out.includes(t) || total + t.length + 1 > 500) continue
    out.push(t)
    total += t.length + 1
    if (out.length === 18) break
  }
  return out
}

/** The credit lines of the stock pictures the video uses (the images record keeps them), once each, in the order of use. */
export function creditsFrom(images: unknown): string[] {
  if (!Array.isArray(images)) return []
  const out: string[] = []
  for (const r of images) {
    const line = (r as { stock?: { attribution?: unknown } } | null)?.stock?.attribution
    if (typeof line === 'string' && line.trim() && !out.includes(line.trim())) out.push(line.trim())
  }
  return out.slice(0, 60)
}

/** The brief's sources section, one line each (labels kept as text; links are not fetched in v0). */
export function sourcesFrom(brief: string | null): string[] {
  if (!brief) return []
  const m = /^#+\s*(?:\d+[.)]\s*)?(sources?)\b.*$/imu.exec(brief)
  if (!m) return []
  const rest = brief.slice((m.index ?? 0) + m[0].length)
  const end = rest.search(/^#+\s/mu)
  return (end >= 0 ? rest.slice(0, end) : rest)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20)
}

function templateWriting(outline: Outline, script: string, minutes: number, lang: string): Written {
  const parsed = parseScript(script)
  const firstTwo = parsed.sentences.slice(0, 2).map((s) => s.text).join(' ')
  const last = parsed.sentences.at(-1)?.text ?? ''
  const fr = lang === 'fr'
  const question = parsed.sentences.find((s) => s.text.endsWith('?'))?.text
  const length = fr ? `en ${Math.max(1, Math.round(minutes))} minute${minutes >= 2 ? 's' : ''}` : `in ${Math.max(1, Math.round(minutes))} minute${minutes >= 2 ? 's' : ''}`
  const titles = [outline.title, ...(question && question.length <= 100 ? [question] : []), `${outline.title} : ${fr ? 'l’essentiel' : 'the essentials'} ${length}`]
  const description = [firstTwo, outline.promise, last].filter(Boolean).join(' ')
  const words = parsed.tokens.map((t) => t.w)
  const terms = keyTerms(words, 30).filter((t) => !STOP_WORDS.has(normWord(t)))
  return { titles, description, tags: [...outline.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3), ...terms] }
}

async function claudeWriting(ctx: RunCtx, outline: Outline, script: string, brief: string | null, p: Params): Promise<Written> {
  const system = [
    'You write the YouTube packaging of a finished narrated video. Truthful to the video, never promising what it does not deliver.',
    'titles: the working title first, then 2–3 alternatives with a different hook each (a number, a question, the stakes, the most surprising fact), each ≤ 100 characters (best 40–70), no angle brackets.',
    'description: 4–6 plain sentences in the channel voice, opening on the tension the video resolves and saying what the viewer takes away. No links, no hashtags, no chapters (added by us).',
    'tags: 10–18 lowercase search tags.',
    'Answer with ONE JSON object {"titles":[…],"description":"…","tags":[…]}.'
  ].join('\n')
  const prompt = [
    languageLine(p.language),
    `Working title: ${outline.title}`,
    `Promise: ${outline.promise}`,
    ...(p.avoidTitles.length > 0 ? [`Recent titles of the channel (do not duplicate): ${p.avoidTitles.join(' | ')}`] : []),
    'Script:',
    script.slice(0, 12_000),
    ...(brief ? ['Brief (facts and sources):', brief.slice(0, 6000)] : [])
  ].join('\n')
  return askJson(ctx, { role: 'packager', system, prompt, schema: Written })
}

async function pack(ctx: RunCtx, inputs: ResolvedInputs, p: Params, useClaude: boolean): Promise<NodeOutputs> {
  const video = readFile0(inputs.video, 'the video')
  const script = readText(inputs.script, 'the script')
  const outline = readValue(inputs.outline, Outline, 'the outline')
  const words = readValue(inputs.words, WordsValue, 'the word times')
  const brief = typeof inputs.brief?.value === 'string' ? inputs.brief.value : null
  const written = useClaude ? await claudeWriting(ctx, outline, script, brief, p) : templateWriting(outline, script, ctx.minutes, p.language)
  const titles = cleanTitles([outline.title, ...written.titles], p.avoidTitles).slice(0, 4)
  // a plan of a 9:16 film makes a YouTube Short: no chapters (a Short has none), a #shorts tag, and the metadata says so
  const parsedPlan = inputs.plan ? EditPlan.safeParse(inputs.plan.value) : null
  const short = parsedPlan?.success === true && aspectOfSize(parsedPlan.data.size) === '9:16'
  const chapters = short ? [] : chaptersFrom(outline, script, words)
  const sources = sourcesFrom(brief)
  const credits = creditsFrom(inputs.images?.value)
  const fr = p.language === 'fr'
  const demo = inputs.video?.meta?.demo === true
  const sections = [
    written.description.trim(),
    chapters.length > 0 ? [fr ? 'Chapitres' : 'Chapters', ...chapters.map((c) => `${clock(c.at)} ${c.title}`)].join('\n') : '',
    sources.length > 0 ? [fr ? 'Sources' : 'Sources', ...sources.map((s) => `- ${s}`)].join('\n') : '',
    credits.length > 0 ? [fr ? 'Crédits images' : 'Image credits', ...credits.map((s) => `- ${s}`)].join('\n') : '',
    ...p.footer
  ].filter(Boolean)
  const description = sections.join('\n\n').slice(0, 5000)
  const tags = cleanTags(short ? [...written.tags, 'shorts'] : written.tags)
  const dir = await scratch(ctx, 'package')
  const files = {
    video: path.join(dir, 'video.mp4'),
    description: path.join(dir, 'description.txt'),
    captions: path.join(dir, 'captions.srt'),
    metadata: path.join(dir, 'metadata.json'),
    checklist: path.join(dir, 'checklist.md')
  }
  await copyFile(video, files.video)
  // the thumbnails: the chosen one (the first: the owner's pick puts it there) is `thumbnail.png`; the others ride along for a test
  const thumbs = inputs.thumbnails?.files ?? []
  const thumbNames: string[] = []
  const thumbFiles: string[] = []
  for (const [i, src] of thumbs.slice(0, 4).entries()) {
    const name = i === 0 ? 'thumbnail.png' : `thumbnail-${i + 1}.png`
    await copyFile(src, path.join(dir, name))
    thumbNames.push(name)
    thumbFiles.push(path.join(dir, name))
  }
  // YouTube refuses a thumbnail over 2 MB: a PNG that big also gets a JPEG
  const first = thumbFiles[0]
  if (first && (await stat(first)).size > 1_900_000 && ctx.services.media) {
    const jpg = path.join(dir, 'thumbnail.jpg')
    await ctx.services.media.run('ffmpeg', ['-v', 'error', '-y', '-i', first, '-q:v', '3', jpg], { signal: ctx.signal })
    thumbNames.push('thumbnail.jpg')
    thumbFiles.push(jpg)
  }
  await writeFile(files.description, description, 'utf8')
  const srt = inputs.subs?.files?.find((f) => f.toLowerCase().endsWith('.srt'))
  if (srt) await copyFile(srt, files.captions)
  else await writeFile(files.captions, '', 'utf8')
  // the WebVTT copy rides along when the captions brick made one (production-9)
  const vtt = inputs.subs?.files?.find((f) => f.toLowerCase().endsWith('.vtt'))
  if (vtt) await copyFile(vtt, path.join(dir, 'captions.vtt'))
  const metadata = { title: titles[0] ?? outline.title, alternatives: titles.slice(1), description, chapters, tags, language: p.language, sources, credits, thumbnail: thumbNames[0] ?? null, thumbnails: thumbNames, demo, ...(short ? { format: 'short', aspect: '9:16' } : {}) }
  await writeFile(files.metadata, JSON.stringify(metadata, null, 2), 'utf8')
  const checklist = [
    `# ${fr ? 'Avant de publier' : 'Before publishing'}`,
    '',
    fr ? '- [ ] Contrôle qualité : pas encore lancé (le nœud qc.check arrive au lot P12)' : '- [ ] Quality control: not run yet (qc.check arrives in lot P12)',
    fr
      ? '- [ ] YouTube Studio : cocher « contenu modifié ou synthétique » (voix de synthèse, images générées)'
      : '- [ ] YouTube Studio: tick "altered or synthetic content" (synthetic voice, generated pictures)',
    ...(thumbNames.length > 0 ? [fr ? '- [ ] Miniature : thumbnail.png (YouTube refuse plus de 2 Mo : voir thumbnail.jpg le cas échéant)' : '- [ ] Thumbnail: thumbnail.png (YouTube refuses over 2 MB: see thumbnail.jpg if present)'] : []),
    fr ? `- [ ] Langue de la vidéo : ${p.language}` : `- [ ] Video language: ${p.language}`,
    fr ? '- [ ] Public : « conçue pour les enfants » ? (non par défaut, à confirmer)' : '- [ ] Audience: "made for kids"? (no by default, to confirm)',
    ...(short ? [fr ? '- [ ] Format vertical 9:16 (Short) : vérifier que la vidéo dure moins de 3 minutes' : '- [ ] Vertical 9:16 (Short): check that the video is under 3 minutes'] : []),
    ...(demo ? [fr ? '- [ ] Vidéo de DÉMONSTRATION (fournisseurs factices) : ne pas publier' : '- [ ] DEMO video (fake providers): do not publish'] : []),
    '',
    fr ? 'Atelier ne publie jamais rien sur YouTube : l’envoi se fait à la main.' : 'Atelier never uploads to YouTube: upload by hand.'
  ].join('\n')
  await writeFile(files.checklist, checklist, 'utf8')
  return {
    metadata: { value: metadata as unknown as Json, meta: { titles: titles.length, chapters: chapters.length, tags: tags.length, demo, ...(short ? { short: true } : {}) } },
    package: {
      value: { title: metadata.title, files: ['video.mp4', 'description.txt', 'captions.srt', 'metadata.json', 'checklist.md', ...thumbNames], demo },
      files: [files.video, files.description, files.captions, files.metadata, files.checklist, ...thumbFiles]
    }
  }
}

export const packageYoutube = defineNode({
  type: 'package.youtube@1',
  inputs: {
    video: { type: 'video.final', required: true },
    script: { type: 'text.script', required: true },
    outline: { type: 'json.outline', required: true },
    words: { type: 'json.words', required: true },
    subs: { type: 'subs.track', required: true },
    plan: { type: 'json.editplan', required: false },
    images: { type: 'media.image[]', required: false },
    thumbnails: { type: 'image.thumbnail[]', required: false },
    brief: { type: 'text.brief', required: false }
  },
  outputs: { metadata: 'json.metadata', package: 'package.youtube' },
  params: PackageParams,
  reads: ['minutes'],
  executors: ['local'],
  claudeRole: 'packager',
  defaultGate: 'owner',
  estimate: () => ({ units: [{ unit: 'calls', qty: 1 }], durationS: 40 }),
  run: (ctx, inputs, p) => pack(ctx, inputs, p, true),
  fake: (ctx, inputs, p) => pack(ctx, inputs, p, false)
})
