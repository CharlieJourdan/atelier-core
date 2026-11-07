// The cloning engine's orchestrator (spec §2, decision 0095): runs P0→P10, each phase's output saved under
// `clones/<id>/` and passed through its exit check before the next phase; resumable from the last saved artefact (a saved
// artefact is re-checked, never trusted blindly); budget-capped; stops cleanly when the disk drops under 15 GB; every
// decision logged. All external services are injected (services.ts).
import { Brief, Corpus, Example, Feasibility, PipelinePlan, Report, Round, StyleDefinition, Synthesis, VideoAnalysis } from '../../../shared/clone'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import type { z } from 'zod'
import { phaseContext, type PhaseContext } from './context'
import { ExitRefused, type ExitCheck } from './exit-check'
import { checkP0, runP0, type IntakeAnswers } from './p0-intake'
import { checkP1, runP1 } from './p1-corpus'
import { checkP2, keptCorpus, leftOutIds, runP2 } from './p2-analysis'
import { checkP3, runP3 } from './p3-feasibility'
import { checkP4, runP4 } from './p4-definition'
import { checkP5, runP5 } from './p5-plan'
import { checkP6, pickPassage, runP6 } from './p6-reproduce'
import { checkP7, runP7 } from './p7-compare'
import { MAX_ROUNDS, ROLLBACK, applyChanges, checkP8, decideNext, reachesRender, runP8 } from './p8-improve'
import { EXAMPLE_MAX_S, checkP9, runP9 } from './p9-example'
import { checkP10, runP10 } from './p10-report'
import { stopIfCloudDown } from './cloud-down'
import { GATE_CALLS_USD, GATE_TRIES, demoRound, gateChanges, styleGate } from './style-gate'
import { anchorChanges, corpusSpread } from './compare/anchor'
import type { CloneServices } from './services'
import { ARTEFACTS, CloneStore } from './store'

export const MIN_FREE_GB = 15

export interface CloneRunOptions {
  dataDir: string
  cloneId: string
  services: CloneServices
  answers: IntakeAnswers
  maxRounds?: number
  minFreeGb?: number
  /** The cost targets something reads (p8-improve.ts COST_READERS, none today): a test stands in for a future reader. */
  costReaders?: ReadonlySet<string>
}

/** Two saved renders are the same film (same bytes). */
function sameFilm(store: CloneStore, a: string, b: string): boolean {
  const hash = (rel: string): string | null => (store.has(rel) ? createHash('sha256').update(readFileSync(store.file(rel))).digest('hex') : null)
  const x = hash(a)
  return x !== null && x === hash(b)
}

export class DiskLow extends Error {
  constructor(readonly freeGb: number) { super(`disk under the floor: ${freeGb} GB free`); this.name = 'DiskLow' }
}

function ensure(phase: string, check: ExitCheck, ctx: PhaseContext): void {
  if (check.ok) return
  ctx.decide(phase, 'refused', check.problems.join('; '))
  throw new ExitRefused(phase, check.problems)
}

/** The clone loop; a Cloud that cannot be reached anywhere inside it stops it with `CloudUnreachable` (never a refused demo, never an improvement round). */
export const runClone = (o: CloneRunOptions): Promise<Report> => stopIfCloudDown(() => runCloneLoop(o))

async function runCloneLoop(o: CloneRunOptions): Promise<Report> {
  const store = new CloneStore(o.dataDir, o.cloneId)
  const s = o.services
  const floor = o.minFreeGb ?? MIN_FREE_GB
  const disk = async (): Promise<void> => {
    const free = await s.disk.freeGb()
    if (free < floor) { store.decide({ at: s.now(), phase: 'disk', decision: 'stop', why: `${free} GB free` }); throw new DiskLow(free) }
  }
  /** Load a saved artefact (re-checked) or run the phase, check and save it. */
  const step = async <T>(ctx: PhaseContext, phase: string, name: string, schema: z.ZodType<T>, run: () => Promise<T>, check: (t: T) => ExitCheck): Promise<T> => {
    const saved = store.load(name, schema)
    if (saved) { ensure(phase, check(saved), ctx); return saved }
    await disk()
    const out = await run()
    ensure(phase, check(out), ctx)
    store.save(name, out)
    return out
  }

  const boot = phaseContext(store, s, 0)
  const brief = await step(boot, 'p0', ARTEFACTS.brief, Brief, () => runP0(boot, o.answers), checkP0)
  // every definition change the improver proposes (P8 rounds and refused gate demos) stays within what the corpus measured
  let spread: ReturnType<typeof corpusSpread> | null = null
  const improver: CloneServices['improver'] = {
    ...s.improver,
    propose: async (round, def) => {
      const proposed = await s.improver.propose(round, def)
      spread ??= corpusSpread(analyses)
      const a = anchorChanges(proposed, spread)
      if (a.held.length) store.decide({ at: s.now(), phase: 'p8', decision: 'held to the measurements', why: a.held.join(' | ') })
      return a.changes
    }
  }
  const ctx = phaseContext(store, { ...s, improver }, brief.testBudgetUsd)
  /** Refuse to go on when the ledger shows more spent than the brief accepted. */
  const withinBudget = (phase: string): void => {
    const over = store.spent() - brief.testBudgetUsd
    if (over > 0.005) ensure(phase, { ok: false, problems: [`spent ${store.spent().toFixed(2)} $ of a ${brief.testBudgetUsd} $ budget`] }, ctx)
  }
  const listed = await step(ctx, 'p1', ARTEFACTS.corpus, Corpus, () => runP1(ctx, brief), (c) => checkP1(c, brief))

  let analyses: VideoAnalysis[] = listed.videos.flatMap((v) => store.load(ARTEFACTS.analysis(v.id), VideoAnalysis) ?? [])
  // several styles on the channel never pause the clone: P2 picks the one the user's words name, else the dominant one, and says why
  const synthesis: Synthesis = await step(ctx, 'p2', ARTEFACTS.synthesis, Synthesis, async () => {
    const r = await runP2(ctx, listed, brief)
    analyses = r.analyses
    return r.synthesis
  }, (syn) => checkP2(analyses, syn, listed, leftOutIds(ctx, listed)))
  // every later phase works from the videos P2 kept (a video set aside is said in the decisions, never used silently)
  // a channel with several styles is reverse-engineered on the style P2 picked: only its videos feed the feasibility, the
  // definition and the passages (Yarnhub, 2026-11-06: its trailer and a reaction video made the 3D films « partly » reproducible)
  const picked = synthesis.styles.length > 1 ? synthesis.styles.find((st) => st.id === synthesis.chosenStyle) : undefined
  const outOfStyle = picked ? listed.videos.filter((v) => !picked.videos.includes(v.id)).map((v) => v.id) : []
  if (outOfStyle.length) ctx.decide('p2', `style ${picked!.id} only`, `${outOfStyle.join(', ')} belong to another style of the channel: left out of the feasibility, the definition and the passages`)
  const corpus = keptCorpus(listed, [...leftOutIds(ctx, listed), ...outOfStyle])
  analyses = analyses.filter((a) => corpus.videos.some((v) => v.id === a.videoId))
  withinBudget('p2')

  const feasibility = await step(ctx, 'p3', ARTEFACTS.feasibility, Feasibility, () => runP3(ctx, brief, synthesis, analyses), (f) => checkP3(f, analyses))
  /** The report; a saved budget stop is not final (more budget resumes), so it is rewritten. */
  const report = async (inputs: Parameters<typeof runP10>[1]): Promise<Report> => {
    const saved = store.load(ARTEFACTS.report, Report)
    if (saved && saved.outcome !== 'stopped-budget') { ensure('p10', checkP10(saved, inputs.example, inputs.plan), ctx); return saved }
    const r = runP10(ctx, inputs)
    ensure('p10', checkP10(r, inputs.example, inputs.plan), ctx)
    store.save(ARTEFACTS.report, r)
    return r
  }
  if (feasibility.verdict === 'not-reproducible') return report({ outcome: 'not-reproducible', feasibility, plan: null, rounds: [], example: null })

  const rounds: Round[] = store.list('p6-round-').flatMap((f) => store.load(f, Round) ?? [])
  /** Paths the improvement rounds changed (P4's check lets them differ from the synthesis). */
  const improved = (): string[] => [...rounds.flatMap((x) => x.changes), ...gateChanges(ctx)].filter((c) => c.cause === 'definition').map((c) => c.target)
  let def: StyleDefinition = await step(ctx, 'p4', ARTEFACTS.definition, StyleDefinition, async () => {
    const d = await runP4(ctx, brief, synthesis, feasibility, analyses)
    store.save(ARTEFACTS.definitionVersion(d.version), d)
    return d
  }, (d) => checkP4(d, synthesis, brief, improved(), analyses, s.readyBases))
  withinBudget('p4') // the look-alike's pictures are paid in P4

  const planFor = async (d: StyleDefinition): Promise<PipelinePlan> => {
    const saved = store.load(ARTEFACTS.plan, PipelinePlan)
    await disk()
    // P5 is pure and free: compiled again on every start, so a clone resumed after an engine update runs the engine's
    // current bricks (the saved plan is kept when nothing changed)
    const p = await runP5(ctx, brief, d, feasibility)
    if (saved && saved.definitionVersion === d.version && JSON.stringify({ ...saved, createdAt: '' }) === JSON.stringify({ ...p, createdAt: '' })) { ensure('p5', checkP5(saved, d), ctx); return saved }
    if (saved && saved.definitionVersion === d.version) ctx.decide('p5', 'recompiled', 'the engine compiles this definition differently now (an engine update): the new plan replaces the saved one')
    ensure('p5', checkP5(p, d), ctx)
    store.save(ARTEFACTS.plan, p)
    return p
  }
  let plan: PipelinePlan = await planFor(def)
  /** True when the Cloud's quote for `seconds` of video fits in the budget left (never spend before quoting). */
  const affordable = async (seconds: number): Promise<boolean> => {
    const need = (await s.cloud.quoteUsdPerMinute(plan)) * (seconds / 60)
    const ok = need <= ctx.remainingUsd()
    if (!ok) ctx.decide('budget', 'stop', `needs ${need.toFixed(2)} $, ${ctx.remainingUsd().toFixed(2)} $ left`)
    return ok
  }

  /**
   * The free-first gate (decision 0102): before a paid render, a free demo of the current definition judged blind; a refused demo is
   * improved for free (the improver's definition changes adopted, a new demo), `GATE_TRIES` times at most. False: nothing is paid.
   */
  const styleRight = async (before: 'p6' | 'p9'): Promise<boolean> => {
    for (let tries = 1; ; tries++) {
      await disk()
      const g = await styleGate(ctx, plan, def, corpus, analyses, before)
      // no demo service (the fakes of older tests): nothing to judge on
      if (!g) return true
      if (g.pass) return true
      withinBudget('gate')
      if (tries >= GATE_TRIES || g.changes.length === 0) {
        ctx.decide('gate', `stop before ${before}`, `the free demo of definition v${def.version} is not the reference's style after ${tries} demo(s): nothing paid`)
        return false
      }
      await adopt(applyChanges(def, g.changes, demoRound(g) as Round))
    }
  }
  /** Money left for a free gate's judge and improver calls (measured on the real runs: ≈ 0.06 $ per refused demo). */
  const judgeable = (): boolean => ctx.remainingUsd() >= GATE_CALLS_USD
  /** The Cloud's quote of a passage is above zero: the render would be paid. */
  const paid = async (seconds: number): Promise<boolean> => (await s.cloud.quoteUsdPerMinute(plan)) * (seconds / 60) > 0

  // P6–P8: rounds, resumable at any stage.
  const adopt = async (d: StyleDefinition): Promise<void> => {
    def = d
    ensure('p4', checkP4(def, synthesis, brief, improved(), analyses, s.readyBases), ctx)
    store.save(ARTEFACTS.definition, def)
    store.save(ARTEFACTS.definitionVersion(def.version), def)
    plan = await planFor(def)
  }
  // Resume repair: a round saved « continue » (or a rollback that ended the loop) whose changes never reached the
  // definition (crash between saving the round and adopting its definition).
  const lastSaved = rounds[rounds.length - 1]
  const rollingBack = (r: Round): boolean => r.changes.some((c) => c.fixes.some((f) => f.startsWith(ROLLBACK)))
  if (lastSaved?.stage === 'improved' && (lastSaved.decision === 'continue' || rollingBack(lastSaved)) && def.version === lastSaved.definitionVersion) {
    const repaired = applyChanges(def, lastSaved.changes, lastSaved)
    if (repaired.version !== def.version) await adopt(repaired)
  }
  const durationOf = (videoId: string): number | null => analyses.find((a) => a.videoId === videoId)?.coverage.durationS ?? null
  const maxRounds = o.maxRounds ?? MAX_ROUNDS
  // A round stopped by the budget, resumed with more: the improvement loop goes on (its changes were found, never applied) instead
  // of jumping to the example with the one judged round (seen on the beta, 2026-11-04: resume --budget 2 went straight to P9).
  const stoppedOnBudget = rounds[rounds.length - 1]
  if (
    stoppedOnBudget?.stage === 'improved' && stoppedOnBudget.decision === 'stop-budget' && stoppedOnBudget.changes.some(reachesRender) &&
    rounds.length < maxRounds && ctx.remainingUsd() >= stoppedOnBudget.production.costUsd &&
    // only a round P8 would have continued with money: not a plateau (two rounds improving nothing), and not a rollback,
    // which P8 already applied when it saved the round
    decideNext(rounds, stoppedOnBudget.changes.filter(reachesRender), Infinity, maxRounds) === 'continue' && !rollingBack(stoppedOnBudget)
  ) {
    ctx.decide('p8', `round ${stoppedOnBudget.n}: continue`, `resumed with ${ctx.remainingUsd().toFixed(2)} $ left: the round's changes are applied and the loop goes on`)
    const going: Round = { ...stoppedOnBudget, decision: 'continue' }
    store.save(ARTEFACTS.round(going.n), going)
    rounds[rounds.length - 1] = going
    const next = applyChanges(def, going.changes, going)
    if (next.version !== def.version) await adopt(next)
    // the example and report the stopped clone made from that round are set aside (kept as evidence): the next ones come
    // from the rounds this resume makes, never the old ones served again
    for (const name of [ARTEFACTS.example, ARTEFACTS.report]) {
      const f = store.file(name)
      if (existsSync(f)) renameSync(f, store.file(name.replace(/\.json$/, `.before-resume-r${going.n}.json`)))
    }
  }
  for (;;) {
    let r = rounds[rounds.length - 1]
    if (r && r.stage === 'improved' && r.decision !== 'continue') break
    if (!r || r.stage === 'improved') {
      const passage = pickPassage(corpus, analyses)
      // the free gate first: a budget too short for a paid round still learns whether the style is right — while its judge's
      // call is still within the money left (a gate's judge and improver may be paid on an API key)
      const roundS = passage.toS - passage.fromS
      if (!judgeable() && !(await affordable(roundS))) return report({ outcome: 'stopped-budget', feasibility, plan, rounds, example: null })
      // the free gate passed: the paid round starts straight away (no human approval inside the loop, decision 0110)
      if ((await paid(roundS)) && !(await styleRight('p6'))) return report({ outcome: 'example-refused', feasibility, plan, rounds, example: null })
      if (!(await affordable(roundS))) return report({ outcome: 'stopped-budget', feasibility, plan, rounds, example: null })
      await disk()
      r = await runP6(ctx, rounds.length + 1, plan, def, corpus, analyses)
      ensure('p6', checkP6(r, ctx.exists, durationOf(r.production.passage.videoId)), ctx)
      store.save(ARTEFACTS.round(r.n), r)
      rounds.push(r)
      withinBudget('p6')
    }
    // The engine reused every node: the render is the previous round's, so the last changes reached no brick (a field no
    // brick reads yet). Judging the same film again would only measure the judge's noise (seen on a real run: three paid
    // judgements of one unchanged film moved by ±10): the previous comparison stands and the loop stops here.
    const before = rounds[rounds.length - 2]
    if (r.stage === 'produced' && before?.comparison && r.production.bricks?.rerun.length === 0 && sameFilm(store, r.production.videoPath, before.production.videoPath)) {
      const why = `round ${r.n} re-ran no brick: round ${before.n}'s changes (${before.changes.map((c) => c.target).join(', ') || 'none'}) reached no engine brick; its comparison stands`
      ctx.decide('p8', `round ${r.n}: stop-nothing-to-fix`, why)
      r = { ...r, stage: 'improved', comparison: before.comparison, kind: 'quality', improvedAxes: [], regressedAxes: [], changes: [], decision: 'stop-nothing-to-fix' }
      store.save(ARTEFACTS.round(r.n), r)
      rounds[rounds.length - 1] = r
      continue
    }
    if (r.stage === 'produced') {
      await disk()
      r = await runP7(ctx, r, corpus, analyses, def)
      ensure('p7', checkP7(r, ctx.exists), ctx)
      store.save(ARTEFACTS.round(r.n), r)
      rounds[rounds.length - 1] = r
    }
    if (r.stage === 'compared') {
      const out = await runP8(ctx, rounds.slice(0, -1), r, def, maxRounds, o.costReaders)
      ensure('p8', checkP8(out.round, def), ctx)
      store.save(ARTEFACTS.round(out.round.n), out.round)
      rounds[rounds.length - 1] = out.round
      if (out.definition.version !== def.version) await adopt(out.definition)
    }
  }

  let example = store.load(ARTEFACTS.example, Example)
  if (!example) {
    const exampleS = Math.min(durationOf(corpus.videos[0]!.id) ?? EXAMPLE_MAX_S, EXAMPLE_MAX_S)
    if (!judgeable() && !(await affordable(exampleS))) return report({ outcome: 'stopped-budget', feasibility, plan, rounds, example: null })
    if ((await paid(exampleS)) && !(await styleRight('p9'))) return report({ outcome: 'example-refused', feasibility, plan, rounds, example: null })
    if (!(await affordable(exampleS))) return report({ outcome: 'stopped-budget', feasibility, plan, rounds, example: null })
    await disk()
    example = await runP9(ctx, plan, def, corpus, analyses)
    store.save(ARTEFACTS.example, example) // saved even when refused: the evidence stays
    withinBudget('p9')
  }
  const shown = checkP9(example, ctx.exists)
  if (!shown.ok) {
    ctx.decide('p9', 'refused', shown.problems.join('; '))
    return report({ outcome: 'example-refused', feasibility, plan, rounds, example: null })
  }
  return report({ outcome: 'cloned', feasibility, plan, rounds, example })
}
