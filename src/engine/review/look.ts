// The edit review's eyes (qualite-montage): Claude looks at one frame of every picture shot with the words said over it and says whether
// it illustrates them. Charlie's second review found armies, people in the snow and a cropped portrait under sentences about other things:
// only a look at the frame against the sentence finds those. One fast call per ten shots on the user's subscription; a verdict is kept per
// (picture, words) for the rounds of one render, so a shot is looked at once. Any failure skips the look (said in the notes), never the film.
import path from 'node:path'
import { z } from 'zod'
import type { EditPlan, Shot } from '../formats/editplan'
import { FPS } from '../formats/timing'
import type { RunCtx } from '../registry'
import { askJson } from '../nodes/common'
import { fmtS, type Defect } from './types'

export const LOOK_RULES = [
  'You review the edit of a documentary before anyone sees it. Each numbered frame is one shot of the film, with the words the narrator says over it.',
  'For each shot say whether the picture illustrates THOSE words: the person, place, thing or event they name, or a concrete picture of that very idea in the right period and place.',
  '- "yes": it shows what is said (or a drawn map, chart or document of it).',
  '- "loose": the right period and place but not the precise thing (acceptable for a sentence with nothing to show).',
  '- "no": another subject (soldiers in the snow under a sentence about banks, an army under a sentence about a village vote), a person the words do not name shown as if they were, a body cropped without its face under a named person, a modern scene in a period sentence, a picture with a visible watermark or logo.',
  'Answer ONLY with JSON: {"shots":[{"n":<number>,"fits":"yes|loose|no","why":"<one short sentence>"}]}'
].join('\n')

const Answer = z.object({ shots: z.array(z.object({ n: z.number().int(), fits: z.enum(['yes', 'loose', 'no']), why: z.string().default('') })) })

/** The base shots worth a look: pictures and boards of pictures (a map, a chart, a document or a typed card is drawn from the words). */
export function lookable(s: Shot): boolean {
  if (s.track !== 'base' || s.kind === 'avatar' || s.kind === 'hold' || s.kind === 'label') return false
  if (s.kind !== 'motion') return true
  const t = (s.graphic as { template?: string } | undefined)?.template
  return t === 'prints' || t === 'archive' || t === 'doc-archive'
}

export interface LookCache {
  get(key: string): { fits: 'yes' | 'loose' | 'no'; why: string } | undefined
  set(key: string, v: { fits: 'yes' | 'loose' | 'no'; why: string }): void
}

/** Off-subject shots of `plan` on the rendered `film` (`said(shot)` = the words over it). */
export async function lookAtShots(
  ctx: RunCtx,
  o: { plan: EditPlan; film: string; dir: string; said: (s: Shot) => string; cache: LookCache; keyOf: (s: Shot) => string; language: string }
): Promise<Defect[]> {
  const media = ctx.services.media
  if (!media) return []
  const byId = new Map(o.plan.shots.map((s) => [s.id, s]))
  const shots = o.plan.tracks.base.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined && lookable(s) && o.said(s).trim().length > 0)
  const todo = shots.filter((s) => !o.cache.get(o.keyOf(s)))
  // one frame per shot, at 60 % (a board's labels are in by then), 480 px wide
  const frames = new Map<string, string>()
  for (const s of todo) {
    const t = (s.startFrame + (s.endFrame - s.startFrame) * 0.6) / FPS
    const f = path.join(o.dir, `look-${s.id}-${s.startFrame}.jpg`)
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', o.film, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', f], { signal: ctx.signal })
    frames.set(s.id, f)
  }
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10)
    const prompt = [
      `Language of the narration: ${o.language}.`,
      ...batch.map((s, k) => `Shot ${k + 1} (${fmtS(s.startFrame / FPS)}): « ${o.said(s).slice(0, 300)} »`)
    ].join('\n')
    const answer = await askJson(ctx, { role: 'edit-review', tier: 'fast', system: LOOK_RULES, prompt, schema: Answer, images: batch.map((s) => frames.get(s.id) as string) })
    for (const v of answer.shots) {
      const s = batch[v.n - 1]
      if (s) o.cache.set(o.keyOf(s), { fits: v.fits, why: v.why.slice(0, 200) })
    }
  }
  const out: Defect[] = []
  for (const s of shots) {
    const v = o.cache.get(o.keyOf(s))
    if (v?.fits !== 'no') continue
    out.push({
      kind: 'off_subject',
      severity: 'fail',
      atS: Math.round((s.startFrame / FPS) * 100) / 100,
      endS: Math.round((s.endFrame / FPS) * 100) / 100,
      shotId: s.id,
      said: o.said(s),
      detail: `À ${fmtS(s.startFrame / FPS)}, l’image ne montre pas ce qui est dit : ${v.why}`
    })
  }
  return out
}
