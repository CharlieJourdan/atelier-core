// Quotes a pipeline in one budget mode: the engine's estimates (`estimatePipeline`, the same fingerprints as the run
// when the video's store and gate decisions are given, so reused nodes cost 0) priced with the local grid.
// LLM nodes are free on « mon abonnement » and on the user's own key, their tokens in credits on « crédits Atelier »
// (R9.1, decision 0026); a node calling a paid provider (voice, pictures, video, GPU) is priced by its units,
// with the credits per unit of Atelier Cloud's engines when the app has read them: the same book as the pipeline's estimate
// (src/main/production/estimates, decision 0023), else the placeholder grid.
import { estimatePipeline } from '../../../engine/estimate'
import { readReusable } from '../../../engine/nodes/reuse'
import type { LaunchInputs } from '../../../engine/plan'
import type { NodeStateStore } from '../../../engine/state'
import type { ArtefactStore } from '../../../engine/store'
import type { BudgetMode } from '../../../engine/types'
import type { Pipeline } from '../../../engine/pipeline-schema'
import type { ResolvedPipeline } from '../../../engine/validate'
import { t } from '../../../shared/fr'
import type { CreditsBalance, QuoteMode, QuoteNode, RunQuote } from '../../../shared/runs'
import { creditsForUnits, creditsToEur, type UnitPrices } from '../../credits/prices'
import type { LlmBackend } from '../../../engine/technologies/cost'
import { isDirectorRole } from '../../llm/access'
import { nodeLabel } from './labels'
import { DEFAULT_ENGINES, type EngineFamily } from '../../../shared/cloud-engines'

export interface QuoteOptions {
  minutes: number
  style: Record<string, unknown>
  useFakes: boolean
  inputs?: LaunchInputs
  store?: ArtefactStore
  gates?: { state: NodeStateStore; scope: string }
  seeds?: Record<string, number>
  /** Credits per unit from the Cloud's engines (the estimator's book); absent: the placeholder grid. */
  prices?: UnitPrices | null
  /** The team's LLM backend and the credits per minute of each LLM task (decision 0026); absent: LLM work is free (Claude Code). */
  llm?: LlmQuote | null
  /** Where the nodes' reuse ledgers are (`<production dir>/cache/reuse`): what a retest will reuse is quoted at 0 (issue #115). */
  reuseDir?: string
}

/** What the LLM nodes cost on the team's backend: credits per finished minute by role (`director`, `script`…). */
export interface LlmQuote {
  backend: LlmBackend
  /** The director's side of the run (every role but the script's) when it runs elsewhere: the API key (decision 0038). */
  directorBackend?: LlmBackend
  perMinute: Readonly<Record<string, number>>
}

/** Credits of an LLM node: its tokens on « crédits Atelier », else 0 (« mon abonnement », or the user's own key). */
export function llmCredits(role: string, minutes: number, llm: LlmQuote | null | undefined): number {
  if (!llm || llm.backend !== 'credits') return 0
  const per = llm.perMinute[role] ?? 0
  return per > 0 ? Math.max(1, Math.ceil(per * minutes)) : 0
}

/**
 * The prices every quote of a run reads (solidite, decision 0078): the engines kept from the Cloud's list, else the list
 * read now, else the placeholder grid. The quote shown before a launch and the quote the run holds itself to MUST read
 * the same: on 01–02/11 the shown one read the Cloud's engines while the run's read the placeholder grid, and the Cloud
 * took about twice the quote the owner had seen.
 */
export async function runPrices(deps: { unitPrices?: () => UnitPrices | null; livePrices?: () => Promise<UnitPrices | null> }): Promise<UnitPrices | null> {
  return deps.unitPrices?.() ?? (await deps.livePrices?.().catch(() => null)) ?? null
}

/** The prices of a node: its own engine's when it names one the book lists (solidite), else its family's default. */
export function pricesFor(params: Record<string, unknown> | undefined, prices: UnitPrices | null | undefined): UnitPrices | null | undefined {
  const engine = params?.engine
  const own = typeof engine === 'string' ? prices?.byEngine?.[engine] : undefined
  return own && prices ? { ...prices, ...own } : prices
}

/** The family default a brick runs on when it names no engine (the Cloud serves the same defaults). */
const FAMILY_OF: Readonly<Record<string, EngineFamily>> = { 'voice.tts': 'voice', 'visuals.fulfil': 'image', 'visuals.stills': 'image', 'thumbnail.make': 'image', 'clip.make': 'clip', 'avatar.speak': 'presenter' }

/** A warning per paid brick whose engine the Cloud publishes down now (its key or access refused on a real call). */
export function downWarnings(plan: ResolvedPipeline, prices: UnitPrices | null | undefined): string[] {
  const down = new Set(prices?.down ?? [])
  if (down.size === 0) return []
  const out: string[] = []
  for (const rn of plan.nodes.values()) {
    const named = rn.node.params?.engine
    const family = FAMILY_OF[rn.def.type.split('@')[0] as string]
    const engine = typeof named === 'string' && !named.startsWith('$') ? named : family ? DEFAULT_ENGINES[family].engine : null
    if (engine && down.has(engine)) out.push(t('runs.quote.engineDown', { step: nodeLabel(rn.node.id, rn.def.type), engine }))
  }
  return out
}

export async function quoteMode(plan: ResolvedPipeline, budgetMode: BudgetMode, o: QuoteOptions): Promise<QuoteMode> {
  const est = await estimatePipeline(plan, {
    budgetMode,
    minutes: o.minutes,
    style: o.style,
    useFakes: o.useFakes,
    ...(o.inputs ? { inputs: o.inputs } : {}),
    ...(o.store ? { store: o.store } : {}),
    ...(o.gates ? { gates: o.gates } : {}),
    ...(o.seeds ? { seeds: o.seeds } : {}),
    ...(o.reuseDir ? { reused: (kind: string, key: string) => readReusable(o.reuseDir as string, kind, key) } : {})
  })
  const nodes: QuoteNode[] = est.nodes.map((n) => {
    const rn = plan.nodes.get(n.nodeId)
    const role = rn?.def.claudeRole
    const llm = role !== undefined && o.llm?.directorBackend && isDirectorRole(role) ? { ...o.llm, backend: o.llm.directorBackend } : o.llm
    const credits = n.cached ? 0 : role !== undefined ? llmCredits(role, o.minutes, llm) : creditsForUnits(n.estimate.units, n.estimate.provider, pricesFor(rn?.node.params, o.prices))
    return {
      nodeId: n.nodeId,
      type: n.type,
      label: nodeLabel(n.nodeId, n.type),
      where: n.where,
      credits,
      ...(role !== undefined && llm ? { backend: llm.backend } : {}),
      durationS: Math.round(n.estimate.durationS),
      cached: n.cached,
      gate: rn?.gate ?? 'none'
    }
  })
  const totalCredits = nodes.reduce((s, n) => s + n.credits, 0)
  const warnings = downWarnings(plan, o.prices)
  return { budgetMode, nodes, totalCredits, totalEur: creditsToEur(totalCredits), durationS: Math.round(est.durationS), ...(warnings.length > 0 ? { warnings } : {}) }
}

/** The two-mode quote of a run: reused nodes (the video's store and gate decisions) cost 0. */
export async function quoteRun(o: {
  doc: Pipeline
  plan: ResolvedPipeline
  minutes: number
  style: Record<string, unknown>
  topic?: string
  demo: boolean
  reuse: { store: ArtefactStore; gates: { state: NodeStateStore; scope: string } } | null
  /** Where the nodes' reuse ledgers are (`<production dir>/cache/reuse`): what a retest will reuse is quoted at 0. */
  reuseDir?: string
  balance: CreditsBalance
  prices?: UnitPrices | null
  llm?: LlmQuote | null
}): Promise<Omit<RunQuote, 'real'>> {
  const common: QuoteOptions = {
    minutes: o.minutes,
    prices: o.prices ?? null,
    llm: o.llm ?? null,
    style: o.style,
    useFakes: o.demo,
    ...(o.topic !== undefined ? { inputs: { topic: { value: o.topic } } } : {}),
    ...(o.reuse && o.topic !== undefined ? o.reuse : {}),
    ...(o.reuseDir ? { reuseDir: o.reuseDir } : {})
  }
  const [usage, quality] = await Promise.all([quoteMode(o.plan, 'usage_max', common), quoteMode(o.plan, 'qualite_max', common)])
  return {
    pipelineId: o.doc.id,
    pipelineLabel: o.doc.name,
    pipelineVersion: o.doc.version,
    minutes: o.minutes,
    demo: o.demo,
    demoReason: o.demo ? t('runs.demo.reason') : '',
    debited: !o.demo,
    modes: { usage_max: usage, qualite_max: quality },
    balance: o.balance
  }
}
