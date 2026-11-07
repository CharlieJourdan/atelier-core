// What the user sees while a clone works for hours (spec §2, VISION §14): one line per stage — done / now / waiting —
// with what was found and the pictures that prove it. Built ONLY from the artefacts saved under `clones/<id>/`, so it is
// the same after a restart and nothing in it is a guess. No service, no money, pure reading.
import {
  Brief, Corpus, Example, Feasibility, PROGRESS_STEPS, PipelinePlan, Report, Round, StyleDefinition, Synthesis, VideoAnalysis,
  type CloneProgress, type ProgressFact, type ProgressStep, type ProgressStepView, type StepStatus
} from '../../../../shared/clone'
import { STYLE_PICKED } from '../p2-analysis'
import { ARTEFACTS, type CloneStore } from '../store'

const fact = (key: string, vars: Record<string, string | number> = {}): ProgressFact => ({ key: `clone.progress.fact.${key}`, vars })
const FRAMES_PER_STEP = 6

/** Frames spread evenly over a list (the first, the last and the ones between), at most `n`. */
export function spread<T>(items: readonly T[], n = FRAMES_PER_STEP): T[] {
  if (items.length <= n) return [...items]
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!)
}

export interface ProgressOptions {
  /** True while the orchestrator is running (otherwise the first unfinished stage is « waiting to resume »). */
  active: boolean
}

export function cloneProgress(store: CloneStore, o: ProgressOptions): CloneProgress {
  const brief = safe(() => store.load(ARTEFACTS.brief, Brief))
  const corpus = safe(() => store.load(ARTEFACTS.corpus, Corpus))
  const analyses = (corpus?.videos ?? []).flatMap((v) => safe(() => store.load(ARTEFACTS.analysis(v.id), VideoAnalysis)) ?? [])
  const synthesis = safe(() => store.load(ARTEFACTS.synthesis, Synthesis))
  const feasibility = safe(() => store.load(ARTEFACTS.feasibility, Feasibility))
  const def = safe(() => store.load(ARTEFACTS.definition, StyleDefinition))
  const plan = safe(() => store.load(ARTEFACTS.plan, PipelinePlan))
  const rounds = store.list('p6-round-').flatMap((f) => safe(() => store.load(f, Round)) ?? [])
  const example = safe(() => store.load(ARTEFACTS.example, Example))
  const report = safe(() => store.load(ARTEFACTS.report, Report))
  const decisions = store.decisions()
  const last = rounds[rounds.length - 1]
  const compared = rounds.filter((r) => r.comparison)
  const lastCompared = compared[compared.length - 1]?.comparison ?? null

  const done: Record<ProgressStep, boolean> = {
    intake: !!brief, channel: !!corpus, watch: !!synthesis, can: !!feasibility, definition: !!def, pipeline: !!plan,
    rounds: !!last && last.stage === 'improved' && last.decision !== 'continue', example: !!example && example.verdict.sameChannel === 'yes', report: !!report && report.outcome !== 'stopped-budget'
  }
  const facts: Record<ProgressStep, ProgressFact[]> = {
    intake: brief ? [fact('intent', { intent: brief.intent }), fact('budget', { usd: brief.testBudgetUsd })] : [],
    channel: corpus ? [fact('videos', { n: corpus.videos.length, of: corpus.channelVideoCount ?? corpus.videos.length })] : [],
    watch: analyses.length > 0
      ? [fact('watched', { n: analyses.length, of: corpus?.videos.length ?? analyses.length }), fact('shots', { n: analyses.reduce((t, a) => t + a.shots.length, 0) }), ...styleFact(synthesis, store.decisions())]
      : [],
    can: feasibility ? [fact('can', { verdict: feasibility.verdict, share: Math.round(feasibility.reproducibleShare * 100) })] : [],
    definition: def ? [fact('definition', { version: def.version })] : [],
    pipeline: plan ? [fact('pipeline', { bricks: plan.bricks.length, slots: plan.slots.length })] : [],
    rounds: rounds.length > 0
      ? [fact('rounds', { n: rounds.length }), ...(lastCompared ? [fact('sameChannel', { answer: lastCompared.verdict.sameChannel, n: compared.length })] : [])]
      : [],
    example: example ? [fact('example', { answer: example.verdict.sameChannel })] : [],
    report: report ? [fact('report', { outcome: report.outcome })] : []
  }
  const frames: Record<ProgressStep, string[]> = {
    intake: [], channel: [],
    watch: spread(analyses.flatMap((a) => (a.shots.length ? [a.shots[Math.floor(a.shots.length / 2)]!.frames[0]!] : []))),
    can: [], definition: [], pipeline: [],
    rounds: spread((lastCompared?.pairs ?? []).map((p) => p.sideBySide)),
    example: spread((example?.pairs ?? []).map((p) => p.sideBySide)),
    report: []
  }

  const notReproducible = feasibility?.verdict === 'not-reproducible'
  const skippable: ProgressStep[] = ['definition', 'pipeline', 'rounds', 'example']
  const lastDecision = decisions[decisions.length - 1]
  // an engine error stops it too (resumable); nothing waits for a person's answer (a several-styles channel is decided by P2)
  const stopped = lastDecision && ['stop', 'refused', 'error'].includes(lastDecision.decision) ? lastDecision : null
  const finalReport = !!report && report.outcome !== 'stopped-budget'
  let firstOpen = true
  const steps: ProgressStepView[] = PROGRESS_STEPS.map((step) => {
    let status: StepStatus
    if (notReproducible && skippable.includes(step)) status = 'skipped'
    else if (done[step] || (finalReport && step === 'report')) status = 'done'
    else if (firstOpen && !finalReport) status = !o.active && stopped ? 'stopped' : o.active ? 'running' : 'waiting'
    else status = 'waiting'
    if (status !== 'done' && status !== 'skipped') firstOpen = false
    return { step, status, facts: facts[step], frames: frames[step] }
  })

  const running = steps.find((s) => s.status === 'running' || s.status === 'stopped' || s.status === 'waiting')
  const stoppedBecause = !finalReport && stopped && !o.active ? stopFact(stopped.phase, stopped.why) : null
  const stoppedForBudget = report?.outcome === 'stopped-budget'
  return {
    cloneId: store.cloneId,
    steps,
    spentUsd: round2(store.spent()),
    budgetUsd: brief?.testBudgetUsd ?? null,
    now: finalReport ? fact('finished', { outcome: report!.outcome }) : stoppedForBudget ? fact('budgetStop') : running ? fact(`now.${running.step}`, { n: rounds.length + 1 }) : fact('finished', { outcome: 'cloned' }),
    stoppedBecause: stoppedBecause ?? (stoppedForBudget ? stopFact('budget', '') : null),
    recent: decisions.slice(-5).reverse().map((d) => ({ phase: d.phase, decision: d.decision, why: d.why }))
  }
}

/** Why it stopped, in a copy key a person understands (the engine's own reasons are English and stay in the log). */
function stopFact(phase: string, why: string): ProgressFact {
  if (phase === 'disk') return { key: 'clone.progress.stopped.disk', vars: { free: why.replace(/\D*(\d+(?:\.\d+)?).*/, '$1') } }
  if (phase === 'budget' || /budget/.test(why)) return { key: 'clone.progress.stopped.budget', vars: {} }
  return { key: 'clone.progress.stopped.refused', vars: { phase } }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Which of the channel's styles P2 reproduces, when it found several (it picks one by itself: the one named, else the main one). */
function styleFact(synthesis: Synthesis | null, decisions: readonly { phase: string; decision: string }[]): ProgressFact[] {
  if (!synthesis || synthesis.styles.length < 2 || !synthesis.chosenStyle) return []
  const chosen = synthesis.styles.find((s) => s.id === synthesis.chosenStyle)
  if (!chosen) return []
  const vars = { n: synthesis.styles.length, videos: chosen.videos.length, of: synthesis.videoCount }
  const named = decisions.some((d) => d.phase === 'p2' && d.decision === `${STYLE_PICKED} ${chosen.id}: named`)
  return [fact(named ? 'style.named' : 'style.dominant', vars)]
}

/** A corrupt or half-written artefact must not take the whole screen down: it just counts as « not there yet ». */
function safe<T>(f: () => T | null): T | null {
  try { return f() } catch { return null }
}
