// P3 — Feasibility map (spec §2 P3): per element, brick | human input | impossible, with its MEASURED screen share; the
// verdict follows from the shares; not reproducible → alert, what is still possible, alternatives faithful to THIS
// channel. Chantier B owns it.
import { Feasibility, feasibilityShares, type Brief, type Synthesis, type VideoAnalysis } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { alternativeProblems } from './definition/alternatives'
import { channelUniverse, crossCheckElements } from './definition/elements'
import { howMadeOf } from './definition/how-made'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

/** Element shares must cover the whole screen time, within this tolerance. */
export const SHARE_SUM_TOLERANCE = 0.05

export async function runP3(ctx: PhaseContext, brief: Brief, synthesis: Synthesis, analyses: readonly VideoAnalysis[]): Promise<Feasibility> {
  const elements = await ctx.services.bricks.map(synthesis, analyses, brief)
  const shares = feasibilityShares(elements)
  const impossible = elements.filter((e) => e.how === 'impossible')
  const needsAlternatives = shares.verdict === 'partly' || shares.verdict === 'not-reproducible'
  const alternatives = needsAlternatives ? await ctx.services.bricks.alternatives(elements, synthesis) : []
  const humans = elements.filter((e) => e.how === 'human-input').map((e) => e.description)
  const alert = shares.verdict === 'reproducible' ? null
    : shares.verdict === 'reproducible-with-human-inputs' ? `human inputs needed: ${humans.join(', ')}`
      : `not reproducible as is: ${impossible.map((e) => `${e.description} (${Math.round(e.screenShare.value * 100)} %)`).join(', ')}`
  const stillPossible = needsAlternatives ? elements.filter((e) => e.how !== 'impossible').map((e) => e.description) : []
  const universe = channelUniverse(analyses, synthesis)
  const crossCheck = crossCheckElements(elements, analyses)
  ctx.decide('p3', shares.verdict, `bricks ${shares.brickShare}, with human inputs ${shares.reproducibleShare}${crossCheck.length ? `; cross-check: ${crossCheck.join('; ')}` : ''}`)
  // the recipe: every production method measured on the corpus, routed to its brick (decision 0110)
  const howMade = howMadeOf(analyses, brief)
  return { ...artefactHead(ctx, 'feasibility'), elements, ...shares, alert, stillPossible, alternatives, universe, crossCheck, howMade }
}

/** Refuses shares not computed from the measured screen time (and, given the analyses or the saved cross-check, shares
 *  that disagree with their origin shares and presenter presence), an alternative whose colours are not the channel's, an element without its brick/slot/missing technology, a
 *  verdict without its alert, and an alternative that is not faithful to the channel or borrows another look. */
export function checkP3(f: Feasibility, analyses?: readonly VideoAnalysis[]): ExitCheck {
  const p = schemaProblems(Feasibility, f)
  if (p.length) return verdict(p)
  const computed = feasibilityShares(f.elements)
  if (Math.abs(computed.brickShare - f.brickShare) > 0.005 || Math.abs(computed.reproducibleShare - f.reproducibleShare) > 0.005) p.push('shares are not the measured screen-time shares')
  if (computed.verdict !== f.verdict) p.push(`verdict ${f.verdict} does not follow from the shares (${computed.verdict})`)
  const total = f.elements.reduce((s, e) => s + e.screenShare.value, 0)
  if (Math.abs(total - 1) > SHARE_SUM_TOLERANCE) p.push(`element screen shares sum to ${total.toFixed(2)}, not the whole video: an element is missing`)
  for (const e of f.elements) {
    if (e.how === 'impossible' && e.missing && e.missing.buildCostUsd === null && e.missing.importCostUsd === null) p.push(`${e.id}: impossible without the cost to build or import it`)
    if (e.how === 'brick' && !e.brick) p.push(`${e.id}: a brick element without its brick`)
    if (e.how === 'human-input' && !e.slot) p.push(`${e.id}: a human input without its import slot`)
    if (e.how === 'impossible' && !e.missing) p.push(`${e.id}: impossible without the missing technology and its cost`)
  }
  if (f.verdict !== 'reproducible' && !f.alert) p.push('no visible alert for a verdict other than reproducible')
  if (f.verdict === 'partly' || f.verdict === 'not-reproducible') {
    if (f.stillPossible.length === 0) p.push('does not say what can still be done')
    if (f.alternatives.length === 0) p.push('no alternative faithful to the channel')
  }
  const impossible = new Set(f.elements.filter((e) => e.how === 'impossible').map((e) => e.id))
  for (const a of f.alternatives) {
    const k = a.keeps
    if (!(k.topic && k.tone && k.structure && k.palette)) p.push(`alternative « ${a.title} » does not keep the topic, tone, structure and palette of the channel`)
    if (a.borrowsLookFrom) p.push(`alternative « ${a.title} » borrows the look of ${a.borrowsLookFrom}`)
    for (const id of a.replaces) if (!impossible.has(id)) p.push(`alternative « ${a.title} » replaces ${id}, which is not impossible`)
  }
  // Faithful for real: the alternatives' colours against the channel's MEASURED palette, the shares against the analyses.
  // The saved universe (built with the synthesis) must itself be the channel's: its colours seen in the analyses.
  if (analyses?.length && f.universe) {
    const seen = new Set(analyses.flatMap((a) => [...a.motion.palette, ...a.motion.elements.flatMap((e) => e.palette)].map((c) => c.toUpperCase())))
    const foreign = f.universe.palette.filter((c) => !seen.has(c.toUpperCase()))
    if (foreign.length) p.push(`the channel universe lists colours its videos never use: ${foreign.join(', ')}`)
  }
  p.push(...alternativeProblems(f.alternatives, f.universe ?? (analyses?.length ? channelUniverse(analyses) : undefined)))
  p.push(...(f.crossCheck ?? []).map((x) => `screen shares disagree with the analyses: ${x}`))
  if (analyses?.length) p.push(...crossCheckElements(f.elements, analyses).filter((x) => !(f.crossCheck ?? []).includes(x)).map((x) => `screen shares disagree with the analyses: ${x}`))
  return verdict(p)
}
