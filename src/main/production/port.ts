// The production actions the agents may take, behind one small interface (PLAN-V2-PRODUCTION §6.3): analyse a channel,
// quote, run a pipeline, list runs, read a run, cancel it, retry a node. The Supervisor and the Opérateur production
// only see this port: they never call the engine (src/engine) nor Atelier Cloud directly. Until our engine and the Cloud
// client are wired (lots P5–P7) the app uses `UnavailableProduction`, which starts nothing and says so; tests use the
// in-memory fake (memory-port.ts). Every spending action goes through a proposal card first (agents/tools-production.ts).
import type { BudgetMode, NodeState } from '../../engine/types'

export type RunState = 'queued' | 'running' | 'waiting_gate' | 'done' | 'error' | 'cancelled'

/** A price given before anything is spent, in Atelier Cloud credits, valid until `expiresAt`. */
export interface ProductionQuote {
  id: string
  credits: number
  lines: { label: string; credits: number }[]
  /** ISO time after which the quote must be asked again. */
  expiresAt: string
}

export interface PipelineRequest {
  videoId: number
  /** Pipeline id (a template or the channel's own); absent = the channel's default pipeline. */
  pipeline?: string
  mode: BudgetMode
  /** The length the goals plan for the video (minutes); absent = the project's own. */
  minutes?: number
  /** « Moteur réel »: real credits through Atelier Cloud; absent = a demo run. Callers ask it only with Charlie's approval. */
  real?: boolean
}

export interface AnalysisRequest {
  /** A public channel or video link (read-only analysis, PLAN-V2-PRODUCTION §2.2). */
  url: string
}

export interface NodeFailure {
  nodeId: string
  code: string
  message: string
  permanent: boolean
}

export interface RunSummary {
  id: string
  videoId: number | null
  title: string
  pipeline: string
  state: RunState
  /** 0..1 */
  progress: number
  /** Credits booked so far. */
  credits: number
  startedAt: string
  updatedAt: string
  failure: NodeFailure | null
}

export interface NodeRunInfo {
  nodeId: string
  type: string
  state: NodeState
  attempts: number
  error: NodeFailure | null
  /** Last log / progress lines of the node, oldest first. */
  log: string[]
}

export interface RunDetail extends RunSummary {
  nodes: NodeRunInfo[]
}

export interface AnalysisStarted {
  id: string
  summary: string
}

export interface ProductionPort {
  /** False while the engine is not wired: the tools are not offered and every action is refused. */
  readonly available: boolean
  quotePipeline(req: PipelineRequest): Promise<ProductionQuote>
  quoteAnalysis(req: AnalysisRequest): Promise<ProductionQuote>
  /** Starts the run on a quote the owner confirmed; refuses an expired quote (QuoteExpiredError). */
  runPipeline(req: PipelineRequest, quoteId: string): Promise<RunSummary>
  analyseChannel(req: AnalysisRequest, quoteId: string): Promise<AnalysisStarted>
  listRuns(filter?: { videoId?: number; active?: boolean }): Promise<RunSummary[]>
  runStatus(runId: string): Promise<RunDetail>
  cancelRun(runId: string): Promise<RunSummary>
  retryNode(runId: string, nodeId: string): Promise<RunSummary>
  /** The app's port: links the oldest imported script of the channel waiting for a video to this slot's video. */
  linkScript?(channelId: number, videoId: number): { projectId: number; title: string } | null
  /** The app's port: the video's project carries a script (the planner skips writing one). */
  hasScript?(videoId: number): boolean
  /** The app's port: the owner gates a run waits at (node id and type), for the channel's level (production-equipe). */
  waitingGates?(runId: string): { nodeId: string; type: string }[]
  /** The app's port: the topic the team chose becomes the video's title and its project's idea (the run's topic). */
  setTopic?(videoId: number, title: string, idea: string): void
  /** The app's port: passes one owner gate of a run (the channel's level does not gate that step). */
  approveGate?(runId: string, nodeId: string): void
}

export class ProductionUnavailableError extends Error {
  constructor() {
    super('La production n’est pas encore branchée : notre moteur arrive avec les lots P5 à P7. Rien n’a été lancé ni facturé.')
    this.name = 'ProductionUnavailableError'
  }
}

export class QuoteExpiredError extends Error {
  constructor(quoteId: string) {
    super(`Le devis ${quoteId} a expiré : demande un nouveau devis. Rien n’a été lancé ni facturé.`)
    this.name = 'QuoteExpiredError'
  }
}

/** The app's port until lots P5–P7: no run exists, nothing can start. */
export class UnavailableProduction implements ProductionPort {
  readonly available = false
  private refuse(): Promise<never> {
    return Promise.reject(new ProductionUnavailableError())
  }
  quotePipeline(): Promise<ProductionQuote> {
    return this.refuse()
  }
  quoteAnalysis(): Promise<ProductionQuote> {
    return this.refuse()
  }
  runPipeline(): Promise<RunSummary> {
    return this.refuse()
  }
  analyseChannel(): Promise<AnalysisStarted> {
    return this.refuse()
  }
  listRuns(): Promise<RunSummary[]> {
    return Promise.resolve([])
  }
  runStatus(): Promise<RunDetail> {
    return this.refuse()
  }
  cancelRun(): Promise<RunSummary> {
    return this.refuse()
  }
  retryNode(): Promise<RunSummary> {
    return this.refuse()
  }
}
