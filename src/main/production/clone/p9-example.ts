// P9 — Full example (spec §2 P9): a real multi-minute example with the final definition, the review agent's pass, and
// the blind judge, which must say « same channel » before anything is shown. Chantier E owns it.
import { BLOCKING_DEFECT_WEIGHT, Example, Round, blindItems, verdictProblems, type Corpus, type PipelinePlan, type StyleDefinition, type VideoAnalysis } from '../../../shared/clone'
import { randomInt } from 'node:crypto'
import { artefactHead, type PhaseContext } from './context'
import { SIDE_BY_SIDE_FILE } from './compare/film'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

/** Length of the example when the whole video is not affordable (seconds). */
export const EXAMPLE_MAX_S = 300

/** `seed` orders the two films for the blind judge (odd: ours first): random, so the reference is not always A; the key that
 *  undoes the order is saved in the example (`blindKey`), like a round's. */
export async function runP9(ctx: PhaseContext, plan: PipelinePlan, def: StyleDefinition, corpus: Corpus, analyses: readonly VideoAnalysis[], seed: number = randomInt(0, 2)): Promise<Example> {
  // The full example is made ONLY after the blind judge said « same channel » on the last compared round: otherwise
  // nothing is spent and the last round's comparison is kept as the evidence of the refusal (spec §2 P9).
  const compared = ctx.store.list('p6-round-').flatMap((f) => ctx.store.load(f, Round) ?? []).filter((r) => r.comparison)
  const lastRound = compared[compared.length - 1]
  if (!lastRound?.comparison) throw new Error('P9 needs a compared round: the example comes after the blind verdict')
  if (lastRound.comparison.verdict.sameChannel !== 'yes') {
    ctx.decide('p9', 'no example', 'the blind judge did not say « same channel » on the last round')
    return refusedExample(ctx, lastRound, lastRound.comparison)
  }
  const dir = ctx.store.folder('p9-example')
  const first = corpus.videos[0]!
  const duration = analyses.find((a) => a.videoId === first.id)?.coverage.durationS ?? EXAMPLE_MAX_S
  let production
  try {
    production = await ctx.services.runs.produce(plan, def, { videoId: first.id, fromS: 0, toS: Math.min(duration, EXAMPLE_MAX_S) }, dir, ctx.remainingUsd())
  } catch (e) {
    // the render refused the film for a real error it could not repair (decision 0102): no example, the evidence of the refusal
    // is kept (a resume does not pay for the same refused film again); the run's spend is already booked by the producer
    const why = e instanceof Error ? e.message : String(e)
    if (!why.includes('Vidéo refusée')) throw e
    ctx.decide('p9', 'no example', why.slice(0, 500))
    const refused = refusedExample(ctx, lastRound, lastRound.comparison)
    return { ...refused, review: [...refused.review, { axis: 'sound', atS: null, description: why.slice(0, 400), weight: BLOCKING_DEFECT_WEIGHT }] }
  }
  ctx.spend({ usd: production.costUsd, seconds: production.makeSeconds, what: 'p9 example' })
  const review = await ctx.services.review.defects(production, def)
  const pairs = await ctx.services.frames.matched(first, production, dir)
  const anon = blindItems(pairs, first.url, production.videoPath, seed)
  const blind = await ctx.services.judge.blind(anon.items, dir)
  ctx.decide('p9', `example: same channel ${blind.sameChannel}`, blind.reason)
  return {
    ...artefactHead(ctx, 'example'),
    definitionVersion: def.version,
    videoPath: production.videoPath,
    durationS: production.durationS,
    costUsd: production.costUsd,
    makeSeconds: production.makeSeconds,
    review,
    pairs,
    blindKey: anon.key,
    verdict: blind,
    ...(ctx.exists(`${dir.rel}/${SIDE_BY_SIDE_FILE}`) ? { sideBySideVideo: `${dir.rel}/${SIDE_BY_SIDE_FILE}` } : {})
  }
}

/** The example that was NOT made: the last round's own comparison stands in, its « no » verdict makes `checkP9` refuse it. */
function refusedExample(ctx: PhaseContext, round: Round, c: NonNullable<Round['comparison']>): Example {
  return {
    ...artefactHead(ctx, 'example'), definitionVersion: round.definitionVersion, videoPath: round.production.videoPath, durationS: round.production.durationS,
    costUsd: 0, makeSeconds: 0, review: c.defects, pairs: c.pairs, blindKey: c.blindKey, verdict: c.verdict,
    ...(c.sideBySideVideo ? { sideBySideVideo: c.sideBySideVideo } : {})
  }
}

/** Refuses to show an example the blind judge did not call « same channel », with an axis unscored, a blocking review
 *  defect left, or whose render or frames are not saved. */
export function checkP9(ex: Example, exists: (rel: string) => boolean): ExitCheck {
  const p = schemaProblems(Example, ex)
  if (p.length) return verdict(p)
  if (ex.verdict.sameChannel !== 'yes') p.push('the blind judge did not say « same channel »: the example is never shown')
  p.push(...verdictProblems('example', ex.verdict, ex.blindKey))
  for (const d of ex.review) if (d.weight >= BLOCKING_DEFECT_WEIGHT) p.push(`blocking defect left: ${d.description}`)
  if (!exists(ex.videoPath)) p.push(`example ${ex.videoPath} not saved`)
  for (const pair of ex.pairs) if (!exists(pair.sideBySide)) p.push(`frame ${pair.sideBySide} not saved`)
  return verdict(p)
}
