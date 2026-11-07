// P8 — Improve until the max (spec §2 P8): fix the CAUSE (a definition field, a brick, a rule, a prompt), re-render only
// what changed, re-compare; stop when two rounds no longer improve any axis, the budget is spent, nothing is left to fix
// or the round cap is reached. A round that regresses overall rolls back the previous round's changes (the best round is
// kept). Then cost rounds: cheaper `cost.*` targets, run only when something reads them (COST_READERS) and kept only while
// no axis drops; otherwise skipped with the reason saved. Each definition change bumps the definition's version; a value
// the reference measured is saved `measured` with that evidence, one the improver proposed is saved as its proposal
// (`user`, noted). Calibration rules go to the engine-wide file (compare/calibration.ts); a brick change is recorded as
// the engine's « brick to fix », never counted as applied. Chantier D owns it.
import path from 'node:path'
import { Round, StyleDefinition, atPath, isSourced, withAtPath, type AxisScore, type Change, type CompareAxis, type ROUND_KINDS, type Sourced } from '../../../shared/clone'
import { loadCalibration, parseTarget, saveCalibration, withFactor } from './compare/calibration'
import { IMPROVER_NOTE, userChose } from './compare/improver'
import type { PhaseContext } from './context'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'
import { ARTEFACTS } from './store'

export const MAX_ROUNDS = 6
/** Cost rounds after the quality plateau, at most (each one must keep every axis). */
export const MAX_COST_ROUNDS = 2

type RoundKind = (typeof ROUND_KINDS)[number]

/** Points a blind score moves between two renders of the same settings (measured on the real rounds of 2026-11-04:
 *  the same definition re-rendered moved axes by up to ±15); a move within it is not an improvement nor a regression. */
export const JUDGE_NOISE = 5

/** Axes better / worse than the previous round, beyond the judge's noise (pure). */
export function axisDelta(now: readonly AxisScore[], before: readonly AxisScore[] | null, noise = JUDGE_NOISE): { improved: CompareAxis[]; regressed: CompareAxis[] } {
  if (!before) return { improved: now.map((s) => s.axis), regressed: [] }
  const prev = new Map(before.map((s) => [s.axis, s.score]))
  return {
    improved: now.filter((s) => prev.has(s.axis) && s.score > prev.get(s.axis)! + noise).map((s) => s.axis),
    regressed: now.filter((s) => prev.has(s.axis) && s.score < prev.get(s.axis)! - noise).map((s) => s.axis)
  }
}

/** Whether to go on (pure): plateau = this round and the previous one improved no axis. */
export function decideNext(rounds: readonly Round[], changes: readonly Change[], remainingUsd: number, maxRounds = MAX_ROUNDS): Round['decision'] {
  const last = rounds[rounds.length - 1]!
  const prev = rounds[rounds.length - 2]
  if (remainingUsd < last.production.costUsd) return 'stop-budget'
  if (last.improvedAxes.length === 0 && prev && prev.improvedAxes.length === 0) return 'stop-plateau'
  if (rounds.length >= maxRounds) return 'stop-max-rounds'
  if (changes.length === 0) return 'stop-nothing-to-fix'
  return 'continue'
}

/** Apply definition changes. A change citing where the reference measured its value (`evidence`) makes the field `measured`
 *  with that evidence; any other (a model's proposal, a rollback) is saved as what it is: the improver's proposal, `user`
 *  with a note naming the round, never passed off as a measurement. */
export function applyChanges(def: StyleDefinition, changes: readonly Change[], round: Round): StyleDefinition {
  const defChanges = changes.filter((c) => c.cause === 'definition')
  if (defChanges.length === 0) return def
  let next: StyleDefinition = { ...def, version: def.version + 1 }
  for (const c of defChanges) {
    const field: Sourced = c.evidence?.length
      ? { value: c.after, source: 'measured', evidence: c.evidence, note: `round ${round.n} comparison ${round.comparison?.sheet ?? ''}: ${c.why}`.slice(0, 500) }
      : { value: c.after, source: 'user', evidence: [], note: `${IMPROVER_NOTE} ${round.n}: ${c.why}`.slice(0, 500) }
    next = withAtPath(next, c.target, field)
  }
  return next
}

/** Changes that reach a render: definition fields and engine calibrations (a `brick` change is the engine's to fix). */
export const reachesRender = (c: Change): boolean => c.cause === 'definition' || c.cause === 'rule'

/** Sum of a round's axis scores (the « better overall » of rollback). */
export const totalScore = (r: Round): number => (r.comparison?.verdict.scores ?? []).reduce((t, s) => t + s.score, 0)

/** True when a change only moves a cost target (cheaper engines and settings). */
export const isCostChange = (c: Change): boolean => c.target.startsWith('cost.')

/** A round's kind from the round before it: the round after cost changes is a cost round. */
export function kindOf(previous: readonly Round[]): RoundKind {
  const prev = previous[previous.length - 1]
  return prev && prev.decision === 'continue' && prev.changes.length > 0 && prev.changes.every(isCostChange) ? 'cost' : 'quality'
}

/** Marks the `fixes` of a rollback change. */
export const ROLLBACK = 'rollback of round'

/** The changes that undo a round's applied changes (definition and calibration), back to what it started from. */
export function revertOf(r: Round, why: string, from?: StyleDefinition | null): Change[] {
  return r.changes
    .filter((c) => c.cause === 'definition' || (c.cause === 'rule' && (parseTarget(c.target) || isCostChange(c))))
    .map((c) => {
      // back to a measured value: its measurement goes back with it (the definition the round was rendered from)
      const was = from && c.cause === 'definition' ? atPath(from, c.target) : null
      const evidence = isSourced(was) && was.source === 'measured' && JSON.stringify(was.value) === JSON.stringify(c.before) ? { evidence: was.evidence } : {}
      return { cause: c.cause, target: c.target, before: c.after, after: c.before, why, fixes: [`${ROLLBACK} ${r.n}: ${why}`], ...evidence }
    })
}

/** Write a round's calibration rules (`rule` changes on `calibration:<node>:<field>`) to the engine-wide file. */
export function applyRules(dataDir: string, changes: readonly Change[], round: Round): void {
  let c = loadCalibration(dataDir)
  let touched = false
  // once per clone round: a P8 re-run after a crash must not multiply a factor twice
  const tag = `${round.cloneId} round ${round.n}:`
  for (const ch of changes) {
    const t = ch.cause === 'rule' ? parseTarget(ch.target) : null
    if (!t || typeof ch.after !== 'number') continue
    if (c[`${t.node}:${t.field}`]?.from.some((f) => f.startsWith(tag))) continue
    c = withFactor(c, t.node, t.field, ch.after, `${tag} ${ch.why}`)
    touched = true
  }
  if (touched) saveCalibration(dataDir, c)
}

/** The saved definition a round was rendered from (null when not saved). */
const renderedFrom = (ctx: PhaseContext, r: Round): StyleDefinition | null => {
  try { return ctx.store.load(ARTEFACTS.definitionVersion(r.definitionVersion), StyleDefinition) } catch { return null }
}

/** Data folder of a clone store (`<dataDir>/clones/<id>`). */
const dataDirOf = (ctx: PhaseContext): string => path.dirname(path.dirname(ctx.store.dir))

/**
 * The cost targets something reads today: none. Each brick's engine comes from the base pipelines (pipeline/compile.ts
 * `engineOf`) and no plan setting trades quality for money, so the `cost.ceilingUsdPerMinute` ceiling the improver proposes
 * has no reader (audit 2026-11 §3). A cost round runs only on a change one of these takes; otherwise it is skipped, its
 * reason saved. (A compiler that picks cheaper engines under a ceiling adds its target here.)
 */
export const COST_READERS: ReadonlySet<string> = new Set<string>()

/** Cost changes the improver proposes for a round asked as a cost round (its `kind` says so), kept only when read. */
async function costChanges(ctx: PhaseContext, round: Round, def: StyleDefinition, readers: ReadonlySet<string>): Promise<{ changes: Change[]; skipped: string | null }> {
  const proposed = (await ctx.services.improver.propose({ ...round, kind: 'cost' }, def)).filter(isCostChange)
  const read = proposed.filter((c) => readers.has(c.target))
  if (read.length) return { changes: read, skipped: null }
  const at = `measured ${round.production.usdPerMinute.toFixed(3)} $/min, target ${def.cost.usdPerMinute.value} $/min`
  const why = proposed.length
    ? `cost round skipped: nothing reads ${[...new Set(proposed.map((c) => c.target))].join(', ')} yet (no cheaper engine or setting the plan exposes); ${at}`
    : `cost round skipped: no cheaper engine or setting proposed; ${at}`
  return { changes: [], skipped: why }
}

export async function runP8(ctx: PhaseContext, previous: readonly Round[], round: Round, def: StyleDefinition, maxRounds = MAX_ROUNDS, costReaders: ReadonlySet<string> = COST_READERS): Promise<{ round: Round; definition: StyleDefinition }> {
  const last = previous[previous.length - 1]
  const delta = axisDelta(round.comparison!.verdict.scores, last?.comparison?.verdict.scores ?? null)
  const kind = kindOf(previous)
  const costRounds = previous.filter((r) => r.kind === 'cost').length + (kind === 'cost' ? 1 : 0)
  const affordable = ctx.remainingUsd() >= round.production.costUsd
  const scored: Round = { ...round, kind, improvedAxes: delta.improved, regressedAxes: delta.regressed }
  let changes: Change[]
  let decision: Round['decision']
  let why: string
  if (kind === 'cost' && last) {
    if (delta.regressed.length > 0) {
      // a cheaper round lost an axis: back to the round before, the cheapest that kept every axis
      changes = revertOf(last, `cost round ${round.n} lost ${delta.regressed.join(', ')}`, renderedFrom(ctx, last))
      decision = 'stop-plateau'
      why = `cost round lost ${delta.regressed.join(', ')}: rolled back to round ${last.n}'s settings`
    } else {
      const cost = costRounds < MAX_COST_ROUNDS ? await costChanges(ctx, scored, def, costReaders) : { changes: [], skipped: null }
      changes = cost.changes
      decision = changes.length && affordable && previous.length + 1 < maxRounds ? 'continue' : affordable ? 'stop-plateau' : 'stop-budget'
      why = `cost round kept every axis at ${round.production.usdPerMinute.toFixed(2)} $/min${cost.skipped ? `; ${cost.skipped}` : ''}`
    }
  } else {
    const best = previous.reduce<Round | null>((b, r) => (r.comparison && (!b || totalScore(r) > totalScore(b)) ? r : b), null)
    const rollback = !!last && best === last && delta.regressed.length > 0 && totalScore(round) < totalScore(last)
    // a change already rolled back is not tried again (the same cause would regress the same way)
    const undone = new Set(previous.flatMap((r) => r.changes.filter((c) => c.fixes.some((f) => f.startsWith(ROLLBACK))).map((c) => `${c.target}=${JSON.stringify(c.before)}`)))
    changes = rollback
      ? revertOf(last!, `round ${round.n} regressed ${delta.regressed.join(', ')}`, renderedFrom(ctx, last!))
      : (await ctx.services.improver.propose(scored, def)).filter((c) => !undone.has(`${c.target}=${JSON.stringify(c.after)}`))
    // only what reaches a render counts: a round of « brick to fix » alone would pay to render the same film
    decision = decideNext([...previous, { ...scored, changes }], changes.filter(reachesRender), ctx.remainingUsd(), maxRounds)
    why = rollback ? `round ${round.n} regressed ${delta.regressed.join(', ')}: rolled back round ${last!.n}'s changes` : changes.map((c) => `${c.cause} ${c.target}: ${c.why}`).join('; ') || 'no change proposed'
    // quality is at its plateau: try cheaper engines and settings, kept only if every axis holds
    if ((decision === 'stop-plateau' || decision === 'stop-nothing-to-fix') && costRounds === 0 && affordable && previous.length + 1 < maxRounds) {
      const cost = await costChanges(ctx, scored, def, costReaders)
      if (cost.changes.length) { changes = cost.changes; decision = 'continue'; why = `quality plateau; cost round: ${cost.changes.map((c) => `${c.target} → ${JSON.stringify(c.after)}`).join(', ')}` }
      else if (cost.skipped) { why = `${why}; ${cost.skipped}`; ctx.decide('p8', `round ${round.n}: cost round skipped`, cost.skipped) }
    }
  }
  const improved: Round = { ...scored, changes, stage: 'improved', decision }
  const rollingBack = changes.some((c) => c.fixes.some((f) => f.startsWith(ROLLBACK)))
  const apply = decision === 'continue' || rollingBack
  if (apply) applyRules(dataDirOf(ctx), changes, improved)
  const definition = apply ? applyChanges(def, changes, improved) : def
  ctx.decide('p8', `round ${round.n} (${kind}): ${decision}`, why)
  return { round: improved, definition }
}

/** Refuses an improvement without a decision, a definition change aimed at a field the definition lacks, a calibration
 *  rule that is not a number, or a change without the defects it answers. */
export function checkP8(round: Round, def: StyleDefinition): ExitCheck {
  const p = schemaProblems(Round, round)
  if (p.length) return verdict(p)
  if (round.stage !== 'improved' || !round.decision) p.push(`round ${round.n}: no decision`)
  for (const c of round.changes) {
    const target = atPath(def, c.target)
    if (c.cause === 'definition' && !isSourced(target)) p.push(`round ${round.n}: change targets ${c.target}, not a definition field`)
    if (c.cause === 'definition' && isSourced(target) && userChose(target)) p.push(`round ${round.n}: change overwrites ${c.target}, which the user chose`)
    if (c.cause === 'rule' && parseTarget(c.target) && (typeof c.after !== 'number' || !(c.after > 0))) p.push(`round ${round.n}: calibration ${c.target} is not a positive factor`)
    if (c.fixes.length === 0) p.push(`round ${round.n}: change to ${c.target} does not say which defects it fixes`)
  }
  return verdict(p)
}
