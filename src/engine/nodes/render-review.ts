// `render.assemble`'s edit review (qualite-montage): the film is reviewed shot by shot before anyone sees it (src/engine/review/), what the
// render can fix on its own plan is fixed and rendered again (`review: 'repair'`, `reviewRounds` at most), and the report rides on the
// video's meta (`review`), where `qc.check` reads what is left. Without the words (a pipeline that does not wire them) the review keeps to
// what needs no words: frozen pictures, held stills, duplicates, the hook.
import type { NodeOutputs } from '../artefacts'
import type { EditPlan, Shot } from '../formats/editplan'
import { WordsValue, type Word } from '../formats/timing'
import type { ResolvedInputs, RunCtx } from '../registry'
import { renderReviewed } from '../review'
import type { SeenShot } from '../review/checks'
import type { Json } from '../types'
import type { RenderParamsT } from './render-assemble'
import { readFile0, scratch } from './common'

type RenderOnce = (ctx: RunCtx, inputs: ResolvedInputs, p: RenderParamsT, plan: EditPlan, dropped: ReadonlySet<string>) => Promise<{ outputs: NodeOutputs; seen: SeenShot[] }>

/** A short summary of the report for logs and the meta's top level. */
const count = (xs: readonly { kind: string }[]): Record<string, number> => xs.reduce<Record<string, number>>((m, d) => ((m[d.kind] = (m[d.kind] ?? 0) + 1), m), {})

export async function reviewedRender(
  ctx: RunCtx,
  inputs: ResolvedInputs,
  p: RenderParamsT,
  plan: EditPlan,
  renderOnce: RenderOnce,
  refs: { clipS: (s: Shot) => number | undefined; isCard: (s: Shot) => boolean }
): Promise<NodeOutputs> {
  const parsed = WordsValue.safeParse(inputs.words?.value)
  const words: Word[] = parsed.success ? parsed.data : []
  const original = new Set(plan.tracks.overlay)
  let last: NodeOutputs | null = null
  const dir = await scratch(ctx, 'review')
  const { plan: finalPlan, report } = await renderReviewed({
    ctx,
    plan,
    words,
    voice: readFile0(inputs.voice, 'the voice'),
    ...(typeof inputs.voice?.meta?.maxPauseS === 'number' ? { voicePauseMaxS: inputs.voice.meta.maxPauseS } : {}),
    music: Boolean(inputs.music?.files?.[0]),
    musicFile: inputs.music?.files?.[0] ?? null,
    // a review asked only to report repairs nothing: it reports its real errors too unless refusing is asked
    blocking: p.blocking ?? (p.review === 'repair' ? 'refuse' : 'report'),
    // the voice's own longest pause (voice.trim) is not a hole in the sound
    ...(typeof inputs.voice?.meta?.maxPauseS === 'number' ? { sound: { holeMaxS: Math.max(1.5, inputs.voice.meta.maxPauseS + 0.5) } } : {}),
    rounds: p.review === 'repair' ? p.reviewRounds : 0,
    look: p.reviewLook && words.length > 0,
    clipS: refs.clipS,
    isCard: refs.isCard,
    dir,
    render: async (pl, mix) => {
      const dropped = new Set([...original].filter((id) => !pl.tracks.overlay.includes(id)))
      const r = await renderOnce(ctx, inputs, mix.musicDb !== 0 ? { ...p, musicDb: mix.musicDb } : p, pl, dropped)
      last = r.outputs
      return { file: (r.outputs.video?.files ?? [])[0] as string, seen: r.seen }
    }
  })
  const outputs = last as unknown as NodeOutputs
  const video = outputs.video
  if (!video) return outputs
  const first = report.rounds[0]?.defects ?? []
  return {
    ...outputs,
    video: {
      ...video,
      meta: {
        ...(video.meta ?? {}),
        review: report as unknown as Json,
        reviewBefore: count(first) as Json,
        reviewLeft: count(report.left) as Json,
        reviewFixed: report.rounds.reduce((n, r) => n + r.applied.length, 0),
        // the real errors left (decision 0102): only a render asked to report them gets here with some
        reviewBlocked: count(report.blocked ?? []) as Json,
        // the shots as they were delivered (a review may drop or move some): the plan's frames never change
        ...(finalPlan !== plan ? { reviewedPlan: finalPlan as unknown as Json } : {})
      }
    }
  }
}
