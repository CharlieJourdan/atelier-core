// Creating a run: its quote in its budget mode, the checks before anything starts (the video's cap, the wallet), then the
// `video_runs` row and its nodes (and the plain video row when asked: no deliverables, no agent tasks). A real run
// (« Moteur réel », production-16) is checked against Atelier Cloud's wallet, a non-demo local run against the app's.
import type { Pipeline } from '../../../engine/pipeline-schema'
import type { ArtefactStore } from '../../../engine/store'
import { t } from '../../../shared/fr'
import type { RunStartInput } from '../../../shared/runs'
import { transaction } from '../../db'
import type { ProductionRunsDeps } from './deps'
import { nodeLabel } from './labels'
import { resolvePipeline } from './pipeline'
import { quoteMode, runPrices } from './quote'
import type { SqliteNodeStateStore } from './state-store'
import type { NodeRegistry } from '../../../engine/registry'

/** The engine's inputs of a run: the topic, plus the pipeline's other text inputs. */
export function runInputs(topic: string, extra: Record<string, string> | undefined): Record<string, { value: string }> {
  const out: Record<string, { value: string }> = { topic: { value: topic } }
  for (const [id, value] of Object.entries(extra ?? {})) if (id !== 'topic') out[id] = { value }
  return out
}

export interface CreateRunCtx {
  deps: ProductionRunsDeps
  registry: NodeRegistry
  state: SqliteNodeStateStore
  /** The app's default mode: demo providers (true) or the local wallet (false, lot Z1's tests). */
  demo: boolean
  storeFor: (videoId: number) => ArtefactStore
  now: string
}

export async function createRun(
  c: CreateRunCtx,
  o: { input: RunStartInput; doc: Pipeline; style: Record<string, unknown>; video: { id: number; channelId: number } | null; redoOf: number | null; maxCredits?: number }
): Promise<number> {
  const { input, doc, style } = o
  const { deps } = c
  const cloud = input.real === true
  const demo = cloud ? false : c.demo
  const plan = resolvePipeline(doc, c.registry, style)
  const seeds = input.seeds ?? {}
  const quote = await quoteMode(plan, input.budgetMode, {
    prices: await runPrices(deps),
    llm: deps.llmQuote?.() ?? null,
    minutes: input.minutes,
    style,
    useFakes: demo,
    inputs: runInputs(input.topic, input.inputs),
    seeds,
    ...(o.video ? { store: c.storeFor(o.video.id), gates: { state: c.state, scope: `video-${o.video.id}` } } : {})
  })
  // the video's cap (`budget.capCredits`, a recipe's per-video cap, decision 0015): a run whose quote is over it does not
  // start, demo or not. While it runs, its hold is the quote, so what it spends never crosses the cap either.
  // a remake on the same video is quoted on that video's cache: only the steps made again count against its ceiling
  if (o.maxCredits !== undefined && quote.totalCredits > o.maxCredits) {
    throw new Error(`Le devis de la réparation (${quote.totalCredits} crédits) dépasse ce qui reste du plafond (${Math.max(0, Math.floor(o.maxCredits))} crédits) : rien n’a été relancé.`)
  }
  const cap = doc.budget.capCredits
  if (cap !== undefined && quote.totalCredits > cap) {
    throw new Error(`Le devis (${quote.totalCredits} crédits) dépasse le plafond de la vidéo (${cap} crédits) : rien n’a été lancé.`)
  }
  if (cloud) {
    if (!deps.cloudRuns) throw new Error(t('runs.real.notSignedIn'))
    const available = (await deps.cloudRuns.balance()).available
    if (available < quote.totalCredits) throw new Error(t('runs.real.short', { need: quote.totalCredits, available }))
  } else if (!demo && deps.credits.balance().available < quote.totalCredits) {
    throw new Error(`Crédits insuffisants : ${quote.totalCredits} nécessaires, ${deps.credits.balance().available} disponibles.`)
  }
  const db = deps.db
  return transaction(db, () => {
    let videoId: number
    let channelId: number
    if (o.video) {
      videoId = o.video.id
      channelId = o.video.channelId
    } else {
      channelId = input.channelId as number
      const res = db
        .prepare("INSERT INTO videos (channel_id, title, brief, status, created_at, updated_at) VALUES (?, ?, ?, 'in_progress', ?, ?)")
        .run(channelId, input.title ?? input.topic, input.topic, c.now, c.now)
      videoId = Number(res.lastInsertRowid)
    }
    const res = db
      .prepare(
        `INSERT INTO video_runs (video_id, channel_id, pipeline_json, pipeline_label, topic, minutes, budget_mode, gate_mode, style_json,
           seeds_json, inputs_json, status, demo, cloud, quote_credits, redo_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
      )
      .run(
        videoId,
        channelId,
        JSON.stringify(doc),
        doc.name,
        input.topic,
        input.minutes,
        input.budgetMode,
        input.gateMode,
        JSON.stringify(style),
        JSON.stringify(seeds),
        JSON.stringify(input.inputs ?? {}),
        demo ? 1 : 0,
        cloud ? 1 : 0,
        demo ? 0 : quote.totalCredits,
        o.redoOf,
        c.now
      )
    const runId = Number(res.lastInsertRowid)
    const insertNode = db.prepare(
      'INSERT INTO video_run_nodes (run_id, node_id, position, type, label, gate_kind, quote_credits) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const [i, nodeId] of plan.order.entries()) {
      const rn = plan.nodes.get(nodeId)
      const q = quote.nodes.find((n) => n.nodeId === nodeId)
      insertNode.run(runId, nodeId, i, rn?.def.type ?? '', nodeLabel(nodeId, rn?.def.type ?? ''), rn?.gate ?? 'none', q?.credits ?? 0)
    }
    return runId
  })
}
