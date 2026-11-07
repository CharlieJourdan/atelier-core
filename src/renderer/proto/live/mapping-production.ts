// Real mode, production side: the engine's pipelines (rebuilt from a run's nodes or from a quote) and the database's
// videos with their newest run (stage, progress, the state of every node) and their slot (the video's deadline is the
// publication slot of the planning). Pure functions, unit-tested.
import type { PipelineDrawing } from '../../../shared/pipeline-drawing'
import type { QuoteNode, RunDetail, RunNode, RunSummary } from '../../../shared/runs'
import type { VideoRow } from '../../../shared/workflow'
import type { NodeKind, NodeRunner, PipelineNode, ProtoPipeline, ProtoVideo, StageId, VideoStatus } from '../types'
import { channelKey, stageOfNode, videoKey } from './mapping'

export const pipelineKey = (pipelineId: string): string => `live-${pipelineId}`

/** True for a pipeline of the engine itself (shown from its runs or a quote), false for a drawing of the editor. */
export const isEnginePipeline = (id: string): boolean => id.startsWith('live-')

/** A pipeline of the editor as the drawing the production engine compiles (its steps in reading order). */
export function toDrawing(p: Pick<ProtoPipeline, 'name' | 'description' | 'nodes'> & Partial<Pick<ProtoPipeline, 'format'>>): PipelineDrawing {
  return {
    name: p.name,
    description: p.description,
    // a short is compiled to a vertical film; long-form (and anything else) keeps the drawing as it was
    ...(p.format === 'short' ? { format: 'short' as const } : {}),
    steps: [...p.nodes]
      .sort((a, b) => a.col - b.col || a.row - b.row)
      .map((n) => ({ id: n.id, kind: n.kind, label: n.label, runner: n.runner, ...(n.gate ? { gate: true } : {}), ...(n.share !== undefined ? { share: n.share } : {}) }))
  }
}

/** What a node of the engine is, for the screens: its kind (icon, stage) and who runs it. */
export function nodeKindOf(type: string): { kind: NodeKind; runner: NodeRunner } {
  const t = type.replace(/@\d+$/, '')
  if (t.startsWith('research')) return { kind: 'idea', runner: 'agent' }
  if (t === 'script.translate') return { kind: 'translate', runner: 'agent' }
  if (t.startsWith('script')) return { kind: 'script', runner: 'agent' }
  if (t.startsWith('background')) return { kind: 'gameplay', runner: 'code' }
  if (t.startsWith('card')) return { kind: 'card', runner: 'code' }
  if (t.startsWith('qc')) return { kind: 'qc', runner: 'code' }
  if (t.startsWith('director') || t.startsWith('beats')) return { kind: 'director', runner: t.startsWith('beats') ? 'code' : 'agent' }
  if (t.startsWith('visuals') || t.startsWith('image')) return { kind: 'image-gen', runner: 'api' }
  if (t.startsWith('video.gen')) return { kind: 'video-gen', runner: 'api' }
  if (t === 'voice.own') return { kind: 'voice', runner: 'human' }
  if (t.startsWith('voice')) return { kind: 'voice', runner: 'api' }
  if (t.startsWith('sound') || t.startsWith('music')) return { kind: 'music', runner: 'code' }
  if (t.startsWith('captions')) return { kind: 'captions', runner: 'code' }
  if (t.startsWith('render')) return { kind: 'edit', runner: 'code' }
  if (t.startsWith('package')) return { kind: 'thumbnail', runner: 'agent' }
  if (t.startsWith('tool.')) return { kind: 'code', runner: 'code' }
  return { kind: 'code', runner: 'code' }
}

const WHERE: Record<QuoteNode['where'], string> = { local: 'Ordinateur de l’équipe', cloud: 'Atelier Cloud', gpu: 'GPU cloud' }

type NodeLike = Pick<RunNode, 'nodeId' | 'type' | 'label'> & { gate: boolean; credits: number; durationS: number; where?: QuoteNode['where'] }

/** A pipeline of the screens from the engine's nodes (in their topological order: one column each). */
export function pipelineFromNodes(
  info: { pipelineId: string; label: string; version: number },
  nodes: readonly NodeLike[],
  channelIds: readonly string[]
): ProtoPipeline {
  const mapped: PipelineNode[] = nodes.map((n, i) => {
    const { kind, runner } = nodeKindOf(n.type)
    return {
      id: n.nodeId,
      kind,
      label: n.label,
      runner,
      provider: n.where ? WHERE[n.where] : runner === 'agent' ? 'Claude Code' : runner === 'api' ? 'Atelier Cloud' : 'Moteur Atelier',
      detail: n.type,
      credits: Math.round(n.credits),
      minutes: Math.max(0, Math.round(n.durationS / 60)),
      col: i,
      row: 1,
      ...(n.gate ? { gate: true } : {})
    }
  })
  const edges: [string, string][] = mapped.slice(1).map((n, i) => [mapped[i]!.id, n.id])
  const credits = mapped.reduce((s, n) => s + n.credits, 0)
  const minutes = Math.round(nodes.reduce((s, n) => s + n.durationS, 0) / 60)
  const agentish = mapped.filter((n) => n.runner === 'agent' || n.runner === 'code').length
  return {
    id: pipelineKey(info.pipelineId),
    name: info.label,
    description: 'Pipeline du moteur de production Atelier (données réelles).',
    kind: 'documentary',
    format: 'long',
    nodes: mapped,
    edges,
    replicability: 100,
    creditsPerVideo: credits,
    minutesPerVideo: minutes,
    minutesCloud: minutes,
    channelIds: [...channelIds],
    preset: false,
    version: info.version,
    subscriptionShare: mapped.length ? Math.round((agentish / mapped.length) * 100) : 0
  }
}

/** Nodes of a run, for pipelineFromNodes. */
export function runNodes(d: RunDetail): NodeLike[] {
  return [...d.nodes]
    .sort((a, b) => a.position - b.position)
    .map((n) => ({ nodeId: n.nodeId, type: n.type, label: n.label, gate: n.gateKind !== 'none', credits: n.quoteCredits, durationS: 0 }))
}

/** Nodes of a quote (usage_max mode), for pipelineFromNodes. */
export function quoteNodes(nodes: readonly QuoteNode[]): NodeLike[] {
  return nodes.map((n) => ({ nodeId: n.nodeId, type: n.type, label: n.label, gate: n.gate !== 'none', credits: n.credits, durationS: n.durationS, where: n.where }))
}

/* ---------- videos ---------- */

const DAY = 86_400_000

/** Whole days between today (local) and a date (local), and the time « HH:MM » of that date. */
export function slotOf(iso: string, now: Date): { days: number; time: string } | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const d1 = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return { days: Math.round((d1 - d0) / DAY), time: time === '00:00' ? '18:00' : time }
}

/** The deadline to store for a slot chosen in the planning. */
export function deadlineOf(days: number, time: string, now: Date): string {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h ?? 18, m ?? 0)
  return d.toISOString()
}

const RUN_STATUS: Record<RunSummary['status'], VideoStatus> = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting',
  succeeded: 'done',
  failed: 'blocked',
  cancelled: 'blocked',
  interrupted: 'blocked'
}

const VIDEO_STAGE: Record<VideoRow['status'], StageId> = {
  idea: 'idea',
  in_progress: 'script',
  waiting_approval: 'script',
  ready: 'ready',
  published: 'published',
  cancelled: 'idea',
  failed: 'edit'
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/**
 * One screen video per database video (cancelled ones left out): its newest run gives stage, progress and status (and,
 * with the run's detail, the state of every node); its deadline gives the publication slot. Runs whose video is not in
 * the list (another filter) still show.
 */
export function mapVideos(rows: readonly VideoRow[], runs: readonly RunSummary[], details: ReadonlyMap<number, RunDetail>, now: Date): ProtoVideo[] {
  const latest = new Map<number, RunSummary>()
  for (const r of runs) if (!latest.has(r.videoId)) latest.set(r.videoId, r)
  const byId = new Map(rows.map((v) => [v.id, v]))
  const ids = [...new Set([...rows.filter((v) => v.status !== 'cancelled').map((v) => v.id), ...latest.keys()])]
  return ids.map((id) => {
    const row = byId.get(id)
    const run = latest.get(id)
    const detail = run ? details.get(run.id) : undefined
    const slot = row?.deadline ? slotOf(row.deadline, now) : null
    let stage: StageId = row ? VIDEO_STAGE[row.status] : 'idea'
    let status: VideoStatus = row?.status === 'published' || row?.status === 'ready' ? 'done' : 'queued'
    let progress = row?.status === 'published' || row?.status === 'ready' ? 100 : 0
    let waitingFor: ProtoVideo['waitingFor']
    if (run) {
      status = RUN_STATUS[run.status]
      progress = Math.round(Math.max(0, Math.min(1, run.progress)) * 100)
      const waiting = run.waitingNodes.length > 0
      if (status === 'done') stage = row?.status === 'published' ? 'published' : slot && slot.days >= 0 ? 'scheduled' : 'ready'
      else if (run.current) stage = stageOfNode(run.current.nodeId, run.current.label)
      else if (waiting) {
        const node = detail?.nodes.find((n) => n.nodeId === run.waitingNodes[0])
        stage = node ? stageOfNode(node.type, node.label) : stageOfNode(run.waitingNodes[0]!)
      }
      if (waiting) {
        status = 'waiting'
        waitingFor = { kind: 'validate', label: 'À valider' }
      } else if (run.error) waitingFor = { kind: 'input', label: run.error }
    }
    const title = row?.title || run?.videoTitle || run?.topic || `Vidéo ${id}`
    const minutes = run?.minutes ?? 8
    return {
      id: videoKey(id),
      channelId: channelKey(row?.channelId ?? run!.channelId),
      title,
      brief: row?.brief ?? run?.topic ?? '',
      format: 'long',
      pipelineId: run ? pipelineKey(run.pipelineId) : '',
      stage,
      progress,
      status,
      ...(waitingFor ? { waitingFor } : {}),
      // The render must be done the day before the slot (same day when the slot is today); no slot: today.
      dueInDays: slot ? Math.max(0, slot.days - 1) : 0,
      ...(slot ? {} : { noRenderDeadline: true as const }),
      publishInDays: slot ? slot.days : null,
      publishTime: slot?.time ?? '18:00',
      durationSec: Math.round(run?.durationS ?? minutes * 60),
      creditsSpent: run?.spentCredits ?? 0,
      creditsEstimate: run?.quoteCredits ?? 0,
      agentId: '',
      thumbHue: hash(String(id)) % 360,
      ...(run && detail
        ? {
            liveRun: {
              runId: run.id,
              videoId: id,
              demo: run.demo,
              nodes: detail.nodes.map((n) => ({ nodeId: n.nodeId, state: n.state, progress: Math.round(n.progress * 100) }))
            }
          }
        : run
          ? { liveRun: { runId: run.id, videoId: id, demo: run.demo, nodes: [] } }
          : {})
    }
  })
}
