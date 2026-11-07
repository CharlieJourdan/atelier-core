// The app's production port (agents-production, chantier B): the team's path to the very runs the app makes (production-16).
// A video of the team (a planner's slot) gets ONE project on its channel's pipeline (the imported script it adopted, or a
// new one); the quote is the project's quote, and running it runs the project — a demo run unless `real` is asked, which
// the callers allow only with Charlie's approval and within the channel's budget (« Moteur réel » off by default,
// decision 0044). The director and the script keep the subscription rule of decision 0038 inside the engine. Runs are
// read, cancelled and retried through `ProductionRuns`. Nothing here starts a run without a quote asked first.
import type { BudgetMode, NodeState } from '../../engine/types'
import type { RunDetail as AppRunDetail, RunSummary as AppRunSummary } from '../../shared/runs'
import type { ProjectStore } from './recipes/projects'
import {
  QuoteExpiredError,
  type AnalysisStarted,
  type NodeRunInfo,
  type PipelineRequest,
  type ProductionPort,
  type ProductionQuote,
  type RunDetail,
  type RunState,
  type RunSummary
} from './port'
import type { ProductionRuns } from './runs/service'

/** A quote is valid 15 minutes (as the engine's). */
export const APP_QUOTE_TTL_MS = 15 * 60 * 1000

const STATE: Record<AppRunSummary['status'], RunState> = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting_gate',
  succeeded: 'done',
  failed: 'error',
  cancelled: 'cancelled',
  interrupted: 'error'
}

export interface AppProductionDeps {
  runs: () => ProductionRuns
  projects: () => ProjectStore
  now?: () => number
}

export class AppProduction implements ProductionPort {
  readonly available = true
  private readonly quotes = new Map<string, { videoId: number; mode: BudgetMode; real: boolean; credits: number; expires: number }>()
  private seq = 0

  constructor(private readonly deps: AppProductionDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** The imported script waiting for this slot's video, linked to it (null: none, or the video has its project). */
  linkScript(channelId: number, videoId: number): { projectId: number; title: string } | null {
    const p = this.deps.projects().adoptForVideo(channelId, videoId)
    return p ? { projectId: p.id, title: p.title } : null
  }

  /** True when the video's project carries a script (imported or the team's). */
  hasScript(videoId: number): boolean {
    const p = this.deps.projects().forVideo(videoId)
    return p !== null && this.deps.projects().scriptOf(p.id) !== null
  }

  async quotePipeline(req: PipelineRequest): Promise<ProductionQuote> {
    const projects = this.deps.projects()
    const project = projects.ensureForVideo(req.videoId, req.pipeline !== undefined ? Number(req.pipeline) || undefined : undefined, req.minutes)
    const q = await projects.quote(project.id, req.real ? { real: true } : {})
    const mode = q.modes[req.mode]
    const id = `devis-${project.id}-${++this.seq}`
    const expires = this.now() + APP_QUOTE_TTL_MS
    // a demo run debits nothing: its quote is what the real one would cost, so the budget is checked as if it were real
    this.quotes.set(id, { videoId: req.videoId, mode: req.mode, real: req.real === true, credits: mode.totalCredits, expires })
    return {
      id,
      credits: mode.totalCredits,
      lines: mode.nodes.filter((n) => n.credits > 0).map((n) => ({ label: n.label, credits: n.credits })),
      expiresAt: new Date(expires).toISOString()
    }
  }

  quoteAnalysis(): Promise<ProductionQuote> {
    return Promise.reject(new Error('L’analyse d’une chaîne se lance depuis Chaînes › Concurrents : l’équipe ne la devise pas encore.'))
  }

  analyseChannel(): Promise<AnalysisStarted> {
    return Promise.reject(new Error('L’analyse d’une chaîne se lance depuis Chaînes › Concurrents : l’équipe ne la lance pas encore.'))
  }

  async runPipeline(req: PipelineRequest, quoteId: string): Promise<RunSummary> {
    const q = this.quotes.get(quoteId)
    if (!q || q.expires < this.now()) throw new QuoteExpiredError(quoteId)
    if (q.videoId !== req.videoId || q.mode !== req.mode) throw new Error(`Le devis ${quoteId} est celui d’une autre vidéo : demande un nouveau devis.`)
    const projects = this.deps.projects()
    const project = projects.ensureForVideo(req.videoId)
    const done = await projects.run(project.id, req.real ? { real: true } : {})
    this.quotes.delete(quoteId)
    if (done.runId === null) throw new Error('La fabrication n’a pas démarré.')
    return summary(this.deps.runs().get(done.runId))
  }

  listRuns(filter?: { videoId?: number; active?: boolean }): Promise<RunSummary[]> {
    const rows = this.deps.runs().list({ ...(filter?.videoId !== undefined ? { videoId: filter.videoId } : {}), limit: 200 })
    const out = rows.map(summary).filter((r) => !filter?.active || ['queued', 'running', 'waiting_gate'].includes(r.state))
    return Promise.resolve(out)
  }

  runStatus(runId: string): Promise<RunDetail> {
    return Promise.resolve(detail(this.deps.runs().get(idOf(runId))))
  }

  async cancelRun(runId: string): Promise<RunSummary> {
    return summary(await this.deps.runs().cancel(idOf(runId)))
  }

  waitingGates(runId: string): { nodeId: string; type: string }[] {
    const run = this.deps.runs().get(idOf(runId))
    return run.waitingNodes.map((id) => ({ nodeId: id, type: run.nodes.find((n) => n.nodeId === id)?.type ?? '' }))
  }

  setTopic(videoId: number, title: string, idea: string): void {
    this.deps.projects().setVideoTopic(videoId, title, idea)
  }

  approveGate(runId: string, nodeId: string): void {
    this.deps.runs().approve(idOf(runId), nodeId)
  }

  retryNode(runId: string): Promise<RunSummary> {
    // a retry relaunches the run: the finished nodes come back cached, the failed one runs again
    return Promise.resolve(summary(this.deps.runs().retry(idOf(runId))))
  }
}

function idOf(raw: string): number {
  const n = Number(String(raw).replace(/^#/, ''))
  if (!Number.isInteger(n) || n < 1) throw new Error(`Fabrication inconnue : ${String(raw).slice(0, 40)}.`)
  return n
}

function summary(r: AppRunSummary): RunSummary {
  return {
    id: String(r.id),
    videoId: r.videoId,
    title: r.videoTitle || r.topic,
    pipeline: r.pipelineLabel,
    state: STATE[r.status],
    progress: r.progress,
    credits: r.spentCredits,
    startedAt: r.startedAt ?? r.createdAt,
    updatedAt: r.finishedAt ?? r.startedAt ?? r.createdAt,
    failure: r.status === 'failed' || r.status === 'interrupted' ? { nodeId: '', code: r.status, message: r.error ?? 'La fabrication s’est arrêtée.', permanent: false } : null
  }
}

function detail(r: AppRunDetail): RunDetail {
  const nodes: NodeRunInfo[] = r.nodes.map((n) => ({
    nodeId: n.nodeId,
    type: n.type,
    state: n.state as NodeState,
    attempts: 0,
    error: n.error ? { nodeId: n.nodeId, code: n.error.code, message: n.error.message, permanent: false } : null,
    log: n.step ? [n.step] : []
  }))
  const failed = r.nodes.find((n) => n.state === 'error')
  const s = summary(r)
  return { ...s, ...(s.failure && failed ? { failure: { ...s.failure, nodeId: failed.nodeId } } : {}), nodes }
}
