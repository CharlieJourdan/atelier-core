// In-memory ProductionPort for tests (and later demos): deterministic quotes, runs that only move when the test says
// so (`advance`, `fail`, `finish`), quotes that expire on an injectable clock. It never spends anything and is never
// used by the app as real data.
import type { BudgetMode } from '../../engine/types'
import {
  QuoteExpiredError,
  type AnalysisRequest,
  type AnalysisStarted,
  type NodeRunInfo,
  type PipelineRequest,
  type ProductionPort,
  type ProductionQuote,
  type RunDetail,
  type RunSummary
} from './port'

/** Validity of a quote, as in the engine (ENGINE-SPEC: a quote is valid 15 minutes). */
export const MEMORY_QUOTE_TTL_MS = 15 * 60 * 1000
const NODES = ['script.write', 'voice.tts', 'director.plan', 'visuals.make', 'render.final']
const CREDITS: Record<BudgetMode, number[]> = { qualite_max: [0, 40, 0, 120, 30], usage_max: [0, 12, 0, 20, 0] }

interface StoredRun {
  summary: RunSummary
  nodes: NodeRunInfo[]
}

export class MemoryProduction implements ProductionPort {
  readonly available = true
  readonly quotes = new Map<string, { quote: ProductionQuote; kind: 'pipeline' | 'analysis'; key: string }>()
  readonly runs = new Map<string, StoredRun>()
  readonly analyses: AnalysisStarted[] = []
  /** Every call, in order (tests check nothing was started without a confirmation). */
  readonly calls: string[] = []
  private seq = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly titleOf: (videoId: number) => string = (id) => `Vidéo #${id}`
  ) {}

  async quotePipeline(req: PipelineRequest): Promise<ProductionQuote> {
    this.calls.push(`quotePipeline:${req.videoId}:${req.mode}`)
    const lines = NODES.map((label, i) => ({ label, credits: CREDITS[req.mode][i] ?? 0 }))
    return this.quote('pipeline', pipelineKey(req), lines)
  }

  async quoteAnalysis(req: AnalysisRequest): Promise<ProductionQuote> {
    this.calls.push(`quoteAnalysis:${req.url}`)
    return this.quote('analysis', req.url, [{ label: 'analyse.channel', credits: 5 }])
  }

  async runPipeline(req: PipelineRequest, quoteId: string): Promise<RunSummary> {
    this.calls.push(`runPipeline:${req.videoId}:${quoteId}`)
    this.useQuote(quoteId, 'pipeline', pipelineKey(req))
    const id = `run-${++this.seq}`
    const at = new Date(this.now()).toISOString()
    const summary: RunSummary = {
      id,
      videoId: req.videoId,
      title: this.titleOf(req.videoId),
      pipeline: req.pipeline ?? 'modele-standard',
      state: 'running',
      progress: 0,
      credits: 0,
      startedAt: at,
      updatedAt: at,
      failure: null
    }
    const nodes = NODES.map((type, i): NodeRunInfo => ({
      nodeId: type.split('.')[0] ?? type,
      type: `${type}@1`,
      state: i === 0 ? 'running' : 'pending',
      attempts: i === 0 ? 1 : 0,
      error: null,
      log: []
    }))
    this.runs.set(id, { summary, nodes })
    return { ...summary }
  }

  async analyseChannel(req: AnalysisRequest, quoteId: string): Promise<AnalysisStarted> {
    this.calls.push(`analyseChannel:${req.url}:${quoteId}`)
    this.useQuote(quoteId, 'analysis', req.url)
    const started = { id: `analysis-${++this.seq}`, summary: `Analyse de ${req.url} lancée.` }
    this.analyses.push(started)
    return started
  }

  async listRuns(filter: { videoId?: number; active?: boolean } = {}): Promise<RunSummary[]> {
    this.calls.push('listRuns')
    const active = (s: RunSummary): boolean => s.state === 'queued' || s.state === 'running' || s.state === 'waiting_gate'
    return Promise.resolve(
      [...this.runs.values()]
        .map((r) => ({ ...r.summary }))
        .filter((s) => filter.videoId === undefined || s.videoId === filter.videoId)
        .filter((s) => filter.active === undefined || active(s) === filter.active)
    )
  }

  async runStatus(runId: string): Promise<RunDetail> {
    this.calls.push(`runStatus:${runId}`)
    const run = this.get(runId)
    return { ...run.summary, nodes: run.nodes.map((n) => ({ ...n, log: [...n.log] })) }
  }

  async cancelRun(runId: string): Promise<RunSummary> {
    this.calls.push(`cancelRun:${runId}`)
    const run = this.get(runId)
    if (run.summary.state === 'done' || run.summary.state === 'cancelled') throw new Error(`Run ${runId} is already ${run.summary.state}`)
    for (const n of run.nodes) if (n.state === 'running' || n.state === 'pending' || n.state === 'queued') n.state = 'cancelled'
    return this.touch(run, { state: 'cancelled' })
  }

  async retryNode(runId: string, nodeId: string): Promise<RunSummary> {
    this.calls.push(`retryNode:${runId}:${nodeId}`)
    const run = this.get(runId)
    const node = run.nodes.find((n) => n.nodeId === nodeId)
    if (!node) throw new Error(`Run ${runId} has no node ${nodeId}`)
    if (node.state !== 'error') throw new Error(`Node ${nodeId} is ${node.state}, not in error`)
    node.state = 'running'
    node.attempts += 1
    node.error = null
    node.log.push('relancé')
    return this.touch(run, { state: 'running', failure: null })
  }

  // ---- test controls --------------------------------------------------------------------------------------------

  /** Makes a node fail (a permanent error by default): the run goes to `error`. */
  fail(runId: string, nodeId: string, message: string, code = 'provider_error', permanent = true): void {
    const run = this.get(runId)
    const node = run.nodes.find((n) => n.nodeId === nodeId)
    if (!node) throw new Error(`Run ${runId} has no node ${nodeId}`)
    const failure = { nodeId, code, message, permanent }
    node.state = 'error'
    node.attempts = Math.max(1, node.attempts)
    node.error = failure
    node.log.push(message)
    this.touch(run, { state: 'error', failure })
  }

  /** Marks the run done. */
  finish(runId: string): void {
    const run = this.get(runId)
    for (const n of run.nodes) n.state = 'done'
    this.touch(run, { state: 'done', progress: 1 })
  }

  private quote(kind: 'pipeline' | 'analysis', key: string, lines: { label: string; credits: number }[]): ProductionQuote {
    const quote: ProductionQuote = {
      id: `quote-${++this.seq}`,
      credits: lines.reduce((s, l) => s + l.credits, 0),
      lines,
      expiresAt: new Date(this.now() + MEMORY_QUOTE_TTL_MS).toISOString()
    }
    this.quotes.set(quote.id, { quote, kind, key })
    return quote
  }

  private useQuote(id: string, kind: 'pipeline' | 'analysis', key: string): void {
    const q = this.quotes.get(id)
    if (!q || q.kind !== kind || q.key !== key) throw new Error(`Unknown quote ${id} for this request`)
    if (this.now() >= Date.parse(q.quote.expiresAt)) throw new QuoteExpiredError(id)
    this.quotes.delete(id) // one quote, one run
  }

  private get(runId: string): StoredRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    return run
  }

  private touch(run: StoredRun, patch: Partial<RunSummary>): RunSummary {
    Object.assign(run.summary, patch, { updatedAt: new Date(this.now()).toISOString() })
    return { ...run.summary }
  }
}

const pipelineKey = (r: PipelineRequest): string => `${r.videoId}:${r.pipeline ?? ''}:${r.mode}`
