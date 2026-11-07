// `edit.chapters@1` (docs/specs/pipeline-avatar.md §2.12, production-9): a chapter mark that pops on screen when a numbered part starts
// (Charlie, 10-31: « les chapitres en haut à droite qui pop »). The parts are the plan's chapters (from `json.outline`); a chapter that
// starts with the film is the opening, not a numbered part, and gets no mark. Position (top right by default, top left, lower third,
// bottom band) and look (pill or slab) are the `edit` style's settings; the label may carry a word before the number (« Astuce 2 »),
// as the reference channels that number their items do. Each mark is a PNG drawn by ffmpeg, laid by the render with a « pop ».
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EditPlan } from '../formats/editplan'
import type { Layer } from '../formats/layers'
import { FPS } from '../formats/timing'
import { CHAPTER_LOOKS, CHAPTER_POSITIONS, drawChapterMark, MARK_FILTERS } from '../media/marks'
import { requireFilters } from '../media/tools'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { progress, readValue, scratch } from './common'

export const ChaptersParams = z.object({
  position: z.enum(CHAPTER_POSITIONS).default('top-right'),
  look: z.enum(CHAPTER_LOOKS).default('pill'),
  /** A word before the number (« Astuce », « Erreur », « N° »); empty: the number alone. */
  prefix: z.string().max(20).default(''),
  /** Show the chapter's title beside its number. */
  showTitle: z.boolean().default(true),
  /** Seconds on screen. */
  seconds: z.number().min(1.5).max(12).default(4),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFD84D')
})
type Params = z.infer<typeof ChaptersParams>

/** The numbered parts (pure): every chapter after the opening, numbered from 1, each with the seconds its mark stays. */
export function numberedParts(plan: Pick<EditPlan, 'chapters' | 'frames'>, seconds: number): { n: number; title: string; startS: number; endS: number }[] {
  const D = plan.frames / FPS
  const parts = plan.chapters.filter((c) => c.startFrame > 0).sort((a, b) => a.startFrame - b.startFrame)
  return parts
    .map((c, i) => {
      const startS = c.startFrame / FPS
      const next = parts[i + 1]
      // a mark never runs into the next part's, nor past the film
      const endS = Math.min(startS + seconds, next ? next.startFrame / FPS - 0.2 : D, D)
      return { n: i + 1, title: c.title, startS, endS }
    })
    .filter((p) => p.endS - p.startS >= 1)
}

async function run(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const plan = readValue(inputs.plan, EditPlan, 'the edit plan')
  const parts = numberedParts(plan, p.seconds)
  if (parts.length === 0) {
    ctx.emit({ kind: 'log', level: 'warn', text: 'the plan has no numbered part after the opening: no chapter mark' })
    return { marks: { value: [] as unknown as Json, files: [], meta: { marks: 0 } } }
  }
  const media = need(ctx, 'media')
  await requireFilters(media, MARK_FILTERS, ctx.signal)
  const dir = await scratch(ctx, 'chapters')
  const fonts = path.join(need(ctx, 'library').root, 'fonts')
  const files: string[] = []
  const layers: Layer[] = []
  for (const part of parts) {
    progress(ctx, part.n - 1, parts.length, `Je dessine le chapitre ${part.n}`)
    const out = path.join(dir, `chapter-${part.n}.png`)
    const box = await drawChapterMark(
      media,
      { label: p.prefix ? `${p.prefix} ${part.n}` : String(part.n), title: p.showTitle ? part.title : '', look: p.look, position: p.position, accent: p.accent, frame: plan.size },
      { bold: path.join(fonts, 'Inter-Bold.ttf'), semi: path.join(fonts, 'Inter-SemiBold.ttf') },
      dir,
      out,
      ctx.signal
    )
    layers.push({ file: files.length, role: 'chapter', startS: part.startS, endS: part.endS, box, video: false, enter: 'pop', fadeS: 0.25 })
    files.push(out)
  }
  progress(ctx, parts.length, parts.length, `${parts.length} chapitre(s) à l’écran`)
  return { marks: { value: layers as unknown as Json, files, meta: { marks: parts.length, position: p.position, look: p.look, titles: parts.map((x) => x.title) } } }
}

export const editChapters = defineNode({
  type: 'edit.chapters@1',
  inputs: { plan: { type: 'json.editplan', required: true, label: 'Plan de montage (ses chapitres)' } },
  outputs: { marks: 'media.graphic[]' },
  params: ChaptersParams,
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 2 }),
  run,
  fake: run
})
