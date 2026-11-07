// Production tools of the Supervisor (PLAN-V2 §5.3, PLAN-V2-PRODUCTION §6.3) and of the Opérateur production: read the
// videos in progress and the production runs, quote, and PROPOSE the actions that spend or change a run (analyse a
// channel, run a pipeline, retry a node, cancel a run). Nothing is started here: a proposal card carries the quote and
// the owner's Confirm runs it (ProposalsStore.decide). In a channel's conversation, only that channel's videos and runs. Arguments come from a model and are all checked.
import type { AtelierTool } from '../../shared/agents'
import { BUDGET_MODES, type BudgetMode } from '../../engine/types'
import type { ToolSpec } from '../llm/types'
import type { ProductionPort, ProductionQuote, RunDetail, RunSummary } from '../production/port'
import type { WorkflowEngine } from '../workflow/engine'
import type { ProposalsStore } from './proposals'

export const PRODUCTION_TOOLS = [
  'list_runs',
  'run_status',
  'estimate',
  'analyse_channel',
  'run_pipeline',
  'retry_node',
  'cancel_run'
] as const satisfies readonly AtelierTool[]
export type ProductionTool = (typeof PRODUCTION_TOOLS)[number]
export const isProductionTool = (n: string): n is ProductionTool => (PRODUCTION_TOOLS as readonly string[]).includes(n)

const OBJ = { type: 'object', additionalProperties: false } as const
const MODE = { type: 'string', enum: [...BUDGET_MODES], description: 'qualite_max (best result) or usage_max (most videos per credit).' }
const VIDEO = { type: 'integer', description: 'Video id (see list_videos).' }

export const PRODUCTION_SPECS: Record<ProductionTool | 'list_videos', Omit<ToolSpec, 'name'>> = {
  list_videos: {
    description: 'Videos in progress: steps (deliverables) with their status and what waits for Charlie.',
    inputSchema: { ...OBJ, properties: { channel: { type: 'integer', description: 'Only this channel id.' } } }
  },
  list_runs: {
    description: 'Production runs of our engine (state, progress, credits, the failed node if any).',
    inputSchema: { ...OBJ, properties: { video: VIDEO, active: { type: 'boolean', description: 'Only runs still going.' } } }
  },
  run_status: {
    description: 'One run in detail: every node, its state, attempts, error and last log lines.',
    inputSchema: { ...OBJ, properties: { run: { type: 'string' } }, required: ['run'] }
  },
  estimate: {
    description: 'Quote the production of a video in credits (nothing is started or spent).',
    inputSchema: { ...OBJ, properties: { video: VIDEO, mode: MODE, pipeline: { type: 'string' } }, required: ['video', 'mode'] }
  },
  analyse_channel: {
    description: 'Propose to analyse a public channel or video link. Charlie gets a card with the quote; it starts only if he confirms.',
    inputSchema: { ...OBJ, properties: { url: { type: 'string', description: 'https link of a channel or a video.' } }, required: ['url'] }
  },
  run_pipeline: {
    description: 'Propose to produce a video with a pipeline. Charlie gets a card with the quote; it starts only if he confirms.',
    inputSchema: { ...OBJ, properties: { video: VIDEO, mode: MODE, pipeline: { type: 'string' } }, required: ['video', 'mode'] }
  },
  retry_node: {
    description: 'Propose to retry a failed node of a run (after explaining the failure). Charlie confirms on a card.',
    inputSchema: { ...OBJ, properties: { run: { type: 'string' }, node: { type: 'string' }, why: { type: 'string' } }, required: ['run', 'node', 'why'] }
  },
  cancel_run: {
    description: 'Propose to cancel a run. Charlie confirms on a card.',
    inputSchema: { ...OBJ, properties: { run: { type: 'string' }, why: { type: 'string' } }, required: ['run', 'why'] }
  }
}

export interface ProductionToolContext {
  production: ProductionPort | null
  workflow: WorkflowEngine
  proposals: ProposalsStore
  conversationId: number
  role: string
  /** Channel of the conversation: a proposal may only touch a video of it (null = any channel, the Supervisor). */
  channelId: number | null
}

const LABEL: Record<string, string> = { waiting_approval: 'WAITS FOR CHARLIE', revision_requested: 'sent back' }

/** list_videos: real data from the workflow tables. */
export function listVideos(wf: WorkflowEngine, a: Record<string, unknown>, scopeChannel: number | null): string {
  const channel = a.channel === undefined ? scopeChannel : int(a.channel, 'channel')
  const videos = wf
    .listVideos(channel === null ? {} : { channelId: channel })
    .filter((v) => v.status !== 'published' && v.status !== 'cancelled')
    .slice(0, 20)
  if (!videos.length) return 'No video in progress.'
  return videos
    .map((v) => {
      const steps = wf.listDeliverables(v.id).map((d) => `${d.type}: ${LABEL[d.status] ?? d.status}`)
      return `#${v.id} "${v.title || 'untitled'}" (channel #${v.channelId}, ${v.status})\n  ${steps.join(' · ')}`
    })
    .join('\n')
}

/** Runs one production tool. Throws on bad arguments or a refused action (the caller turns it into a tool error). */
export async function runProductionTool(name: ProductionTool, a: Record<string, unknown>, ctx: ProductionToolContext): Promise<string> {
  const p = ctx.production
  if (!p?.available) throw new Error('Production runs are not connected yet (our engine arrives with lots P5–P7): nothing can be quoted or started.')
  switch (name) {
    case 'list_runs': {
      const runs = (
        await p.listRuns({
          ...(a.video !== undefined ? { videoId: int(a.video, 'video') } : {}),
          ...(typeof a.active === 'boolean' ? { active: a.active } : {})
        })
      ).filter((r) => inScope(r, ctx))
      return runs.length ? runs.slice(0, 20).map(runLine).join('\n') : 'No production run.'
    }
    case 'run_status':
      return detailText(scoped(await p.runStatus(str(a.run, 'run', 80)), ctx))
    case 'estimate': {
      const req = pipelineReq(a, ctx)
      return `Quote ${quoteText(await p.quotePipeline(req))} Nothing was started.`
    }
    case 'run_pipeline': {
      const req = pipelineReq(a, ctx)
      const video = ctx.workflow.getVideo(req.videoId)
      const quote = await p.quotePipeline(req)
      const card = ctx.proposals.create({
        conversationId: ctx.conversationId,
        authorId: ctx.role,
        kind: 'run_pipeline',
        title: `Produire « ${video.title || `#${video.id}`} » (${modeLabel(req.mode)}) : ${quote.credits} crédits`,
        detail: quoteDetail(quote),
        data: { ...req, quoteId: quote.id, credits: quote.credits, expiresAt: quote.expiresAt }
      })
      return `Proposal #${card.id} posted with the quote (${quote.credits} credits). Nothing starts unless Charlie confirms it.`
    }
    case 'analyse_channel': {
      const url = link(a.url)
      const quote = await p.quoteAnalysis({ url })
      const card = ctx.proposals.create({
        conversationId: ctx.conversationId,
        authorId: ctx.role,
        kind: 'analyse_channel',
        title: `Analyser ${url} : ${quote.credits} crédits`,
        detail: quoteDetail(quote),
        data: { url, quoteId: quote.id, credits: quote.credits, expiresAt: quote.expiresAt }
      })
      return `Proposal #${card.id} posted with the quote (${quote.credits} credits). Nothing starts unless Charlie confirms it.`
    }
    case 'retry_node':
    case 'cancel_run': {
      const run = scoped(await p.runStatus(str(a.run, 'run', 80)), ctx)
      const why = str(a.why, 'why', 1000)
      if (name === 'retry_node') {
        const node = str(a.node, 'node', 80)
        const info = run.nodes.find((n) => n.nodeId === node)
        if (!info) throw new Error(`Run ${run.id} has no node ${node}. Nodes: ${run.nodes.map((n) => n.nodeId).join(', ')}`)
        if (info.state !== 'error') throw new Error(`Node ${node} is ${info.state}: only a node in error can be retried`)
        const card = ctx.proposals.create({
          conversationId: ctx.conversationId,
          authorId: ctx.role,
          kind: 'retry_node',
          title: `Relancer l’étape ${node} de « ${run.title} »`,
          detail: why,
          data: { runId: run.id, nodeId: node }
        })
        return `Proposal #${card.id} posted. The node is retried only if Charlie confirms.`
      }
      if (run.state === 'done' || run.state === 'cancelled') throw new Error(`Run ${run.id} is already ${run.state}`)
      const card = ctx.proposals.create({
        conversationId: ctx.conversationId,
        authorId: ctx.role,
        kind: 'cancel_run',
        title: `Arrêter la production de « ${run.title} »`,
        detail: why,
        data: { runId: run.id }
      })
      return `Proposal #${card.id} posted. The run is cancelled only if Charlie confirms.`
    }
  }
}

/** True when the run belongs to the conversation's channel (always, for a conversation without channel). */
function inScope(r: RunSummary, ctx: ProductionToolContext): boolean {
  if (ctx.channelId === null) return true
  if (r.videoId === null) return false
  try {
    return ctx.workflow.getVideo(r.videoId).channelId === ctx.channelId
  } catch {
    return false
  }
}

function scoped<T extends RunSummary>(r: T, ctx: ProductionToolContext): T {
  if (!inScope(r, ctx)) throw new Error(`Run ${r.id} belongs to another channel`)
  return r
}

function pipelineReq(a: Record<string, unknown>, ctx: ProductionToolContext): { videoId: number; mode: BudgetMode; pipeline?: string } {
  const videoId = int(a.video, 'video')
  const video = ctx.workflow.getVideo(videoId)
  if (ctx.channelId !== null && video.channelId !== ctx.channelId) throw new Error(`Video #${videoId} belongs to another channel`)
  if (video.status === 'cancelled' || video.status === 'published') throw new Error(`Video #${videoId} is ${video.status}`)
  if (!(BUDGET_MODES as readonly unknown[]).includes(a.mode)) throw new Error(`mode must be one of ${BUDGET_MODES.join(', ')}`)
  const pipeline = a.pipeline === undefined ? undefined : str(a.pipeline, 'pipeline', 80)
  return { videoId, mode: a.mode as BudgetMode, ...(pipeline ? { pipeline } : {}) }
}

const modeLabel = (m: BudgetMode): string => (m === 'qualite_max' ? 'qualité max' : 'usage max')

function quoteText(q: ProductionQuote): string {
  return `${q.id}: ${q.credits} credits (${q.lines.map((l) => `${l.label} ${l.credits}`).join(', ')}), valid until ${q.expiresAt}.`
}

function quoteDetail(q: ProductionQuote): string {
  const lines = q.lines.map((l) => `- ${l.label} : ${l.credits} crédits`)
  return [`Devis ${q.id} : ${q.credits} crédits au total.`, ...lines, `Valable jusqu’à ${q.expiresAt}. Rien n’est lancé sans ta confirmation.`].join('\n')
}

function runLine(r: RunSummary): string {
  const fail = r.failure ? ` — FAILED at ${r.failure.nodeId}: ${r.failure.message}` : ''
  return `${r.id} "${r.title}" (video #${r.videoId ?? '-'}, ${r.pipeline}): ${r.state}, ${Math.round(r.progress * 100)} %, ${r.credits} credits${fail}`
}

function detailText(r: RunDetail): string {
  const nodes = r.nodes.map((n) => {
    const err = n.error ? ` — ${n.error.permanent ? 'permanent' : 'temporary'} error ${n.error.code}: ${n.error.message}` : ''
    const log = n.log.length ? `\n    log: ${n.log.slice(-5).join(' | ')}` : ''
    return `  ${n.nodeId} (${n.type}): ${n.state}, ${n.attempts} attempt(s)${err}${log}`
  })
  return [runLine(r), ...nodes].join('\n')
}

function int(v: unknown, field: string): number {
  const n = typeof v === 'string' && /^#?\d+$/.test(v.trim()) ? Number(v.trim().replace('#', '')) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new Error(`${field} must be an id (a positive integer)`)
  return n
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} must be non-empty text`)
  if (v.length > max) throw new Error(`${field} is limited to ${max} characters`)
  return v.trim()
}

function link(v: unknown): string {
  const s = str(v, 'url', 500)
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new Error('url must be a full https link')
  }
  if (u.protocol !== 'https:') throw new Error('url must be an https link')
  return u.toString()
}
