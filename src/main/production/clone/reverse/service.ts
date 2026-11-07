// reverse-pipeline: the service behind `reverse.*`, on the cloning engine (engine.ts). A request starts a clone without the
// intake conversation; its status and its pipeline are read from what the clone saved (a restart loses nothing); a finished
// clone's pipeline is also saved as `reverse-pipeline.json` in its folder; a transform makes a new clone folder (transform.ts);
// `prove` resumes a clone (its rounds P6–P9) within a budget given in dollars on top of what it already spent. Ids = clone ids.
import { ReverseRequest, ReverseTransform, ReversePipeline, type ReverseStatus } from '../../../../shared/reverse/pipeline'
import type { ReverseSummary } from '../../../../shared/api/reverse'
import type { CloneEngine } from '../engine'
import { CloneStore } from '../store'
import { buildReversePipeline } from './build'
import { DerivedFrom, REVERSE_FILES, loadReverseInputs } from './load'
import { answersFromRequest } from './request'
import { transformPipeline } from './transform'


const idOf = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id)) throw new Error('Pipeline introuvable.')
  return id
}

export class ReverseService {
  constructor(private readonly engine: CloneEngine) {}

  start(request: unknown): { id: string } {
    const req = ReverseRequest.parse(request)
    const answers = answersFromRequest(req)
    return { id: this.engine.startAnswers(answers, { [REVERSE_FILES.request]: req }).cloneId }
  }

  status(rawId: unknown): ReverseStatus {
    const id = idOf(rawId)
    const p = this.engine.progress(id)
    const sum = this.engine.summary(id)
    const st = p.state
    const report = this.engine.report(id)
    const running = p.steps.find((s) => s.status === 'running') ?? p.steps.find((s) => s.status !== 'done' && s.status !== 'skipped')
    const base = { id, phase: st.kind === 'done' ? 'report' : running?.step ?? 'report', spentUsd: p.spentUsd, budgetUsd: sum.budgetUsd ?? 0, recent: p.recent.slice(0, 8) }
    switch (st.kind) {
      case 'running': return { ...base, state: 'running', stoppedBecause: null }
      case 'done': return { ...base, state: 'done', stoppedBecause: null }
      case 'stopped': return { ...base, state: report?.outcome === 'stopped-budget' || /budget/i.test(st.why) ? 'stopped' : 'failed', stoppedBecause: st.why }
      default: return { ...base, state: report?.outcome === 'stopped-budget' ? 'stopped' : 'idle', stoppedBecause: report?.outcome === 'stopped-budget' ? 'the test budget is spent' : null }
    }
  }

  /** The pipeline as its artefacts say now (null before P3); saved in the folder once the clone is done. */
  result(rawId: unknown): ReversePipeline | null {
    const id = idOf(rawId)
    const st = this.status(id)
    const store = new CloneStore(this.engine.dataDir, id)
    const inputs = loadReverseInputs(store, { failed: st.state === 'failed' })
    if (!inputs.plan && !inputs.feasibility) return null
    const pipeline = ReversePipeline.parse(buildReversePipeline(inputs, inputs.brief?.createdAt ?? this.engine.clock().toISOString()))
    if (st.state === 'done' || (st.state === 'idle' && inputs.derivedFrom)) store.save(REVERSE_FILES.pipeline, pipeline)
    return pipeline
  }

  async transform(rawId: unknown, transform: unknown): Promise<{ id: string }> {
    const id = idOf(rawId)
    const t = ReverseTransform.parse(transform)
    if (this.status(id).state === 'running') throw new Error('Ce pipeline travaille encore : attends qu’il s’arrête.')
    const e = this.engine
    const made = await transformPipeline({ dataDir: e.dataDir, services: (x) => e.servicesFor(x), now: () => e.clock() }, id, t)
    e.changed()
    if (t.testBudgetUsd > 0) this.prove(made.id, t.testBudgetUsd)
    return made
  }

  list(): ReverseSummary[] {
    return this.engine.list().map((c) => {
      const store = new CloneStore(this.engine.dataDir, c.id)
      const derivedFrom = ((): string | null => {
        try { return store.load(REVERSE_FILES.derived, DerivedFrom)?.pipelineId ?? null } catch { return null }
      })()
      return { id: c.id, createdAt: c.createdAt, title: c.title, state: this.status(c.id).state, spentUsd: c.spentUsd, budgetUsd: c.budgetUsd ?? 0, derivedFrom }
    })
  }

  /** Runs the proof (rounds, example) within `budgetUsd` more dollars than the clone already spent. */
  prove(rawId: unknown, budgetUsd: unknown): ReverseStatus {
    const id = idOf(rawId)
    if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 1000) throw new Error('Budget invalide.')
    const spent = this.engine.summary(id).spentUsd
    const total = Math.round((spent + budgetUsd) * 100) / 100
    if (total > 1000) throw new Error('Budget invalide.')
    this.engine.resume(id, total)
    return this.status(id)
  }

  /** Resolves when the pipeline's clone stops (tests, brain-run). */
  async settled(id: string): Promise<void> { await this.engine.settled(id) }
}
