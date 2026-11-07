// P6 — Reproduce a real reference passage (spec §2 P6): 60–180 s of a corpus video, our own script on the same subject
// and structure, produced by the pipeline within the budget left. Chantier D owns it.
import { Round, type Corpus, type PipelinePlan, type Production, type StyleDefinition, type VideoAnalysis } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

export const PASSAGE_MIN_S = 60
export const PASSAGE_MAX_S = 180
export const PASSAGE_TARGET_S = 120
/** How far the render's length may be from the passage's (share): further, the two are not the same passage. */
export const RENDER_LENGTH_TOLERANCE = 0.5

/** The passage to reproduce (pure): from the start (the hook is part of the style), long enough to cross the part
 *  changes and presenter layout changes of the first ~3 minutes (hook → body, a promo, a layout switch), 60–180 s. The
 *  same passage every round, so rounds compare like with like. */
export function pickPassage(corpus: Corpus, analyses: readonly VideoAnalysis[]): Production['passage'] {
  const first = corpus.videos[0]!
  const a = analyses.find((x) => x.videoId === first.id)
  const duration = a?.coverage.durationS ?? first.durationS ?? PASSAGE_TARGET_S
  const changes = passageChanges(a)
  const lastChange = changes.filter((t) => t <= PASSAGE_MAX_S - 15).pop() ?? 0
  const len = Math.min(PASSAGE_MAX_S, Math.max(PASSAGE_TARGET_S, lastChange + 15))
  return { videoId: first.id, fromS: 0, toS: Math.min(duration, len) }
}

/** Moments where the style changes inside a video (sorted): part boundaries (hook → body, a promo, the end) and the
 *  first time each presenter layout appears. Not every layout switch: a channel that switches every shot would always
 *  push the passage to its longest (and dearest) length without showing anything new. */
export function passageChanges(a: VideoAnalysis | undefined): number[] {
  if (!a) return []
  const out = a.parts.map((p) => p.fromS).filter((t) => t > 0)
  const seen = new Set<string>()
  for (const s of a.shots) {
    if (!seen.has(s.layout) && s.startS > 0) out.push(s.startS)
    seen.add(s.layout)
  }
  return [...new Set(out)].sort((x, y) => x - y)
}

export async function runP6(ctx: PhaseContext, n: number, plan: PipelinePlan, def: StyleDefinition, corpus: Corpus, analyses: readonly VideoAnalysis[]): Promise<Round> {
  const dir = ctx.store.folder(`p6-round-${String(n).padStart(2, '0')}`)
  const passage = pickPassage(corpus, analyses)
  // An intent before the paid run: a crash between the run and the saved round leaves it, and the next attempt says so
  // (the runner reuses the run it recorded in the same folder instead of paying twice).
  const intent = `${dir.rel}/intent.json`
  if (ctx.exists(intent)) ctx.decide('p6', `round ${n}: resumed after an interrupted attempt`, 'the runner reuses the run recorded in its folder')
  ctx.store.save(intent, { round: n, definitionVersion: def.version, passage, maxUsd: ctx.remainingUsd(), at: ctx.services.now() })
  const production = await ctx.services.runs.produce(plan, def, passage, dir, ctx.remainingUsd())
  ctx.spend({ usd: production.costUsd, seconds: production.makeSeconds, what: `p6 round ${n}` })
  if (production.bricks) ctx.decide('p6', `round ${n}: re-ran ${production.bricks.rerun.length} brick(s)`, `re-ran ${production.bricks.rerun.join(', ') || 'none'}; reused ${production.bricks.reused.join(', ') || 'none'}`)
  return {
    ...artefactHead(ctx, 'round'),
    n, stage: 'produced', definitionVersion: def.version, production,
    comparison: null, changes: [], improvedAxes: [], regressedAxes: [], decision: null
  }
}

/** Refuses a round whose render or script is not saved, whose passage is outside 60–180 s (unless the video is shorter),
 *  whose render length is far from the passage it stands for, or whose per-minute cost and time do not follow from the
 *  measured totals. */
export function checkP6(round: Round, exists: (rel: string) => boolean, videoDurationS: number | null): ExitCheck {
  const p = schemaProblems(Round, round)
  if (p.length) return verdict(p)
  const pr = round.production
  if (!exists(pr.videoPath)) p.push(`round ${round.n}: the render ${pr.videoPath} is not saved`)
  if (!exists(pr.scriptPath)) p.push(`round ${round.n}: the script ${pr.scriptPath} is not saved`)
  const len = pr.passage.toS - pr.passage.fromS
  const shortVideo = videoDurationS !== null && videoDurationS < PASSAGE_MIN_S
  if (!shortVideo && (len < PASSAGE_MIN_S || len > PASSAGE_MAX_S)) p.push(`round ${round.n}: passage of ${len}s is outside ${PASSAGE_MIN_S}–${PASSAGE_MAX_S}s`)
  if (len > 0 && Math.abs(pr.durationS - len) / len > RENDER_LENGTH_TOLERANCE) p.push(`round ${round.n}: render of ${pr.durationS}s for a passage of ${len}s`)
  const minutes = pr.durationS / 60
  if (Math.abs(pr.usdPerMinute - pr.costUsd / minutes) > 0.01) p.push(`round ${round.n}: $/min does not follow from the cost`)
  if (Math.abs(pr.makeSecondsPerMinute - pr.makeSeconds / minutes) > 0.5) p.push(`round ${round.n}: time/min does not follow from the making time`)
  return verdict(p)
}
