// Cost estimates (docs/ENGINE-SPEC.md §9). Each node estimates its work in its provider's units; turning units into
// credits is Atelier Cloud's price grid, reached through an injected `Quoter` (the engine never imports `cloud/`).
// Local and Claude Code nodes cost 0 credits (R9.1) and cached nodes are quoted at 0 (R9.2).
import type { Artefact } from './artefacts'
import type { Clock } from './errors'
import { effectiveRun, resolveExecutor, resolveNodeParams, nodeRunFingerprint, type LaunchInputs } from './plan'
import type { EstimateCtx } from './registry'
import type { NodeStateStore } from './state'
import type { ArtefactStore } from './store'
import type { BudgetMode, Cost, Estimate, Executor, Json } from './types'
import type { ResolvedPipeline } from './validate'

export interface NodeEstimate {
  nodeId: string
  type: string
  where: Executor
  estimate: Estimate
  /** Already in the artefact store: reused for free. */
  cached: boolean
  /** Runs on a paid executor (cloud or gpu) and is not cached: needs credits. */
  paid: boolean
}

export interface PipelineEstimate {
  budgetMode: BudgetMode
  nodes: NodeEstimate[]
  /** Sum of the expected durations of the nodes that will run (an upper bound: parallel branches overlap). */
  durationS: number
}

export interface EstimateOptions {
  budgetMode?: BudgetMode
  minutes?: number
  /** Pipeline inputs and style, when known: lets cached nodes be found (their fingerprints become computable). */
  inputs?: LaunchInputs
  style?: Record<string, unknown>
  store?: ArtefactStore
  /** Gate decisions (change notes, replaced outputs) of the video, so its fingerprints match the scheduler's. */
  gates?: { state: NodeStateStore; scope: string }
  seeds?: Record<string, number>
  /** Demo run (the nodes' fakes): its fingerprints differ from a real run's. */
  useFakes?: boolean
  /** The paid units a node's item cache still holds (`NodeDef.reuse`): billed at 0 in the quote (issue #115). */
  reused?: (kind: string, key: string) => Promise<Record<string, number> | null>
}

/** Estimates every node of a valid pipeline, in run order. Pure apart from reading the store. */
export async function estimatePipeline(plan: ResolvedPipeline, opts: EstimateOptions = {}): Promise<PipelineEstimate> {
  const budgetMode = opts.budgetMode ?? plan.pipeline.budget.default
  const minutes = opts.minutes ?? plan.pipeline.format.minutes.default
  // fingerprints of the outputs known so far (pipeline inputs, cached upstream runs)
  const known = new Map<string, Record<string, string>>()
  const knownArtefacts = new Map<string, Record<string, Artefact>>()
  // what the nodes that will run say of their outputs before they exist (`NodeDef.forecast`)
  const forecasts = new Map<string, Record<string, Record<string, Json>>>()
  const nodes: NodeEstimate[] = []
  for (const id of plan.order) {
    const rn = plan.nodes.get(id)
    if (!rn) continue
    // metadata of what is wired to each port, when known (lets e.g. a voice estimate its characters from the script)
    const inputMeta: EstimateCtx['inputs'] = {}
    for (const [port, ref] of Object.entries(rn.node.in ?? {})) {
      const type = rn.def.inputs[port]?.type
      if (!type) continue
      const [root, name] = [ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)]
      const given = root === '$inputs' ? opts.inputs?.[name] : undefined
      const meta = root === '$inputs' ? given?.meta : (knownArtefacts.get(root)?.[name]?.meta ?? forecasts.get(root)?.[name])
      const value = given && 'value' in given ? given.value : undefined
      inputMeta[port] = { type, meta, ...(value !== undefined ? { value } : {}) }
    }
    const ectx = (where: Executor): EstimateCtx => ({ where, budgetMode, minutes, inputs: inputMeta })
    let resolved: Record<string, unknown> | null
    try {
      resolved = resolveNodeParams(rn, budgetMode, opts.inputs ?? {}, opts.style ?? {})
    } catch {
      resolved = null // unresolvable yet (style not given): estimate on the raw params
    }
    const parsed = rn.def.params.safeParse(resolved ?? { ...(rn.node.params ?? {}), ...(rn.node.modes?.[budgetMode] ?? {}) })
    const p = parsed.success ? parsed.data : {}
    const where = resolveExecutor(rn.def, rn.node.where, budgetMode, (w) => rn.def.estimate(ectx(w), p))
    let estimate = rn.def.estimate(ectx(where), p)
    if (opts.reused && rn.def.reuse && parsed.success) {
      const fps: Record<string, string | undefined> = {}
      for (const [port, ref] of Object.entries(rn.node.in ?? {})) fps[port] = known.get(ref.slice(0, ref.indexOf('.')))?.[ref.slice(ref.indexOf('.') + 1)]
      const key = rn.def.reuse.key(fps, p)
      const have = key ? await opts.reused(rn.def.reuse.kind, key) : null
      if (have) {
        estimate = { ...estimate, units: estimate.units.map((u) => ({ ...u, qty: Math.max(0, u.qty - (have[u.unit] ?? 0)) })) }
      }
    }
    let cached = false
    if (opts.store && resolved && parsed.success && opts.inputs) {
      const notes = opts.gates?.state.notes(opts.gates.scope, id) ?? []
      const fp = nodeRunFingerprint(rn, p, known, opts.inputs, opts.seeds?.[id] ?? 0, notes, {
        run: { minutes, budgetMode },
        fake: opts.useFakes === true
      })
      const run = fp ? await effectiveRun(opts.store, opts.gates?.state, opts.gates?.scope ?? '', id, fp) : null
      if (run) {
        cached = true
        knownArtefacts.set(id, run.outputs)
        known.set(id, Object.fromEntries(Object.entries(run.outputs).map(([o, a]) => [o, a.fingerprint])))
      }
    }
    if (!cached && parsed.success && rn.def.forecast) forecasts.set(id, rn.def.forecast(ectx(where), p))
    nodes.push({ nodeId: id, type: rn.def.type, where, estimate, cached, paid: !cached && where !== 'local' })
  }
  const durationS = nodes.filter((n) => !n.cached).reduce((s, n) => s + n.estimate.durationS, 0)
  return { budgetMode, nodes, durationS }
}

/** One paid line sent to the Cloud for pricing. */
export interface QuoteRequestItem {
  nodeId: string
  type: string
  where: Executor
  provider?: string
  units: Estimate['units']
}

export interface QuoteLine {
  nodeId: string
  credits: number
}

/** Atelier Cloud's pricing, injected (lot P3 builds it; lot P5 wires it). */
export interface Quoter {
  quote(items: QuoteRequestItem[], signal?: AbortSignal): Promise<{ lines: QuoteLine[]; quoteId?: string }>
}

export interface Quote {
  quoteId?: string
  lines: (QuoteLine & { cached: boolean; where: Executor })[]
  totalCredits: number
  durationS: number
  createdAt: number
  expiresAt: number
}

/** A quote is valid 15 minutes (R9.2). */
export const QUOTE_TTL_MS = 15 * 60 * 1000

/** Prices a pipeline estimate: free lines at 0 without asking, paid lines through the quoter. */
export async function quotePipeline(est: PipelineEstimate, quoter: Quoter, clock: Clock, signal?: AbortSignal): Promise<Quote> {
  const paid = est.nodes.filter((n) => n.paid)
  const res = paid.length > 0
    ? await quoter.quote(
        paid.map((n) => ({ nodeId: n.nodeId, type: n.type, where: n.where, provider: n.estimate.provider, units: n.estimate.units })),
        signal
      )
    : { lines: [] }
  const priced = new Map(res.lines.map((l) => [l.nodeId, l.credits]))
  const lines = est.nodes.map((n) => {
    const credits = n.paid ? priced.get(n.nodeId) : 0
    if (credits === undefined || !Number.isFinite(credits) || credits < 0) {
      throw new Error(`the quote has no valid price for node ${n.nodeId}`)
    }
    return { nodeId: n.nodeId, credits, cached: n.cached, where: n.where }
  })
  const createdAt = clock.now()
  return {
    quoteId: res.quoteId,
    lines,
    totalCredits: lines.reduce((s, l) => s + l.credits, 0),
    durationS: est.durationS,
    createdAt,
    expiresAt: createdAt + QUOTE_TTL_MS
  }
}

export const isQuoteValid = (q: Quote, now: number): boolean => now < q.expiresAt

/**
 * Credits for paid nodes during a run (R9.3, R10.3, R10.6), injected: the scheduler reserves before a paid node
 * starts, settles at its real cost on success, and releases (full refund) on failure or cancel. Retries reuse the same
 * reservation. A reservation that would cross the video's cap is refused by throwing `EngineError('budget')`.
 */
export interface Spender {
  reserve(req: {
    runId: string
    nodeId: string
    fingerprint: string
    idempotencyKey: string
    estimate: Estimate
    where: Executor
    /** The node's params: the engine it names is the one its credits are priced on (reserve-devis, issue #89). */
    params?: unknown
  }): Promise<Reservation>
}

export interface Reservation {
  settle(cost: Cost | undefined): Promise<void>
  release(): Promise<void>
}
