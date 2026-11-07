// Rows of `video_runs` / `video_run_nodes` (migration 012) and their mapping to the shared types.
// `video_runs.video_file` holds the final video's REF (relative to the video's artefact folder, what
// `production.file` accepts), `package_dir` the absolute package folder.
import type { Db } from '../../db'
import type {
  RunBudgetMode,
  RunDetail,
  RunGateMode,
  RunListFilter,
  RunNode,
  RunNodeEngine,
  RunNodeGate,
  RunNodeState,
  RunStatus,
  RunStyle,
  RunSummary
} from '../../../shared/runs'
import { RUN_STATUSES } from '../../../shared/runs'
import { nodeLabel } from './labels'

export interface RunRow {
  id: number
  video_id: number
  channel_id: number
  pipeline_json: string
  pipeline_label: string
  topic: string
  minutes: number
  budget_mode: RunBudgetMode
  gate_mode: RunGateMode
  style_json: string
  seeds_json: string
  inputs_json: string
  status: RunStatus
  demo: number
  /** « Moteur réel »: its paid bricks go through Atelier Cloud's jobs (migration 035). */
  cloud: number
  quote_credits: number
  spent_credits: number
  /** JSON list of French notes (migration 038). */
  notes_json?: string
  attempt: number
  /** The wallet hold of the current attempt (non-demo runs), released when the attempt ends. */
  hold_id: number | null
  redo_of: number | null
  error: string | null
  video_file: string | null
  package_dir: string | null
  duration_s: number | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  example: number
  video_title?: string
  channel_name?: string
}

export interface NodeRow {
  run_id: number
  node_id: string
  position: number
  type: string
  label: string
  state: RunNodeState
  progress: number
  step: string | null
  quote_credits: number
  credits: number
  fingerprint: string | null
  previous_fingerprint: string | null
  error_code: string | null
  error_message: string | null
  error_detail: string | null
  gate: RunNodeGate
  gate_kind: 'none' | 'review' | 'owner'
  change_note: string | null
  pending_decision: 'approve' | 'change' | null
  started_at: string | null
  finished_at: string | null
}

const RUN_SELECT = `SELECT r.*, v.title AS video_title, c.name AS channel_name
  FROM video_runs r JOIN videos v ON v.id = r.video_id JOIN channels c ON c.id = v.channel_id`

export function findRun(db: Db, id: number): RunRow | undefined {
  return db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id) as RunRow | undefined
}

export function readRun(db: Db, id: unknown): RunRow {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new Error('Identifiant de fabrication invalide.')
  const r = findRun(db, id)
  if (!r) throw new Error('Fabrication introuvable.')
  return r
}

/** A label that is only the node's id (runs made before its French label existed) is read as the French label (QA B9). */
const labelled = (n: NodeRow): NodeRow => (n.label === n.node_id ? { ...n, label: nodeLabel(n.node_id, n.type) } : n)

export function readNodes(db: Db, runId: number): NodeRow[] {
  return (db.prepare('SELECT * FROM video_run_nodes WHERE run_id = ? ORDER BY position').all(runId) as unknown as NodeRow[]).map(labelled)
}

export function readNode(db: Db, runId: number, nodeId: unknown): NodeRow {
  if (typeof nodeId !== 'string' || nodeId === '' || nodeId.length > 64) throw new Error('Étape invalide.')
  const n = db.prepare('SELECT * FROM video_run_nodes WHERE run_id = ? AND node_id = ?').get(runId, nodeId) as NodeRow | undefined
  if (!n) throw new Error('Cette étape n’existe pas dans la fabrication.')
  return labelled(n)
}

export function listRunRows(db: Db, filter: RunListFilter = {}): RunRow[] {
  const where: string[] = []
  const args: (number | string)[] = []
  if (filter.videoId !== undefined) {
    where.push('r.video_id = ?')
    args.push(filter.videoId)
  }
  if (filter.channelId !== undefined) {
    where.push('r.channel_id = ?')
    args.push(filter.channelId)
  }
  if (filter.status !== undefined) {
    const list = Array.isArray(filter.status) ? filter.status : [filter.status]
    where.push(`r.status IN (${list.map(() => '?').join(', ')})`)
    args.push(...list)
  }
  const limit = filter.limit ?? 100
  return db
    .prepare(`${RUN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`)
    .all(...args, limit) as unknown as RunRow[]
}

/** Validates a list filter coming from the renderer. */
export function checkFilter(f: unknown): RunListFilter {
  if (f === undefined || f === null) return {}
  if (typeof f !== 'object' || Array.isArray(f)) throw new Error('Filtre de fabrications invalide.')
  const o = f as Record<string, unknown>
  const id = (v: unknown, what: string): number | undefined => {
    if (v === undefined) return undefined
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error(`Filtre invalide : ${what}.`)
    return v
  }
  const out: RunListFilter = {}
  const videoId = id(o.videoId, 'vidéo')
  const channelId = id(o.channelId, 'chaîne')
  if (videoId !== undefined) out.videoId = videoId
  if (channelId !== undefined) out.channelId = channelId
  if (o.status !== undefined) {
    const list = Array.isArray(o.status) ? o.status : [o.status]
    if (list.length === 0 || !list.every((s) => (RUN_STATUSES as readonly unknown[]).includes(s))) throw new Error('Filtre invalide : statut.')
    out.status = list as RunStatus[]
  }
  if (o.limit !== undefined) {
    if (typeof o.limit !== 'number' || !Number.isInteger(o.limit) || o.limit < 1 || o.limit > 500) throw new Error('Filtre invalide : limite (1 à 500).')
    out.limit = o.limit
  }
  return out
}

export function toNode(n: NodeRow, engines: RunNodeEngine[] = []): RunNode {
  return {
    nodeId: n.node_id,
    position: n.position,
    type: n.type,
    label: n.label,
    state: n.state,
    progress: n.progress,
    step: n.step,
    quoteCredits: n.quote_credits,
    credits: n.credits,
    engines,
    fingerprint: n.fingerprint,
    error: n.error_code ? { code: n.error_code, message: n.error_message ?? '', detail: n.error_detail } : null,
    gate: n.gate,
    gateKind: n.gate_kind,
    changeNote: n.change_note,
    startedAt: n.started_at,
    finishedAt: n.finished_at
  }
}

const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function pipelineOf(r: RunRow): { id: string; version: number } {
  const p = parse<{ id?: string; version?: number }>(r.pipeline_json, {})
  return { id: typeof p.id === 'string' ? p.id : '', version: typeof p.version === 'number' ? p.version : 0 }
}

export function toSummary(r: RunRow, nodes: NodeRow[], live: boolean): RunSummary {
  const p = pipelineOf(r)
  const finished = (s: RunNodeState): boolean => s === 'done' || s === 'cached'
  const progress = nodes.length === 0 ? 0 : nodes.reduce((s, n) => s + (finished(n.state) ? 1 : Math.min(1, Math.max(0, n.progress))), 0) / nodes.length
  const running = nodes.find((n) => n.state === 'running')
  return {
    id: r.id,
    videoId: r.video_id,
    videoTitle: r.video_title ?? '',
    channelId: r.channel_id,
    channelName: r.channel_name ?? '',
    pipelineId: p.id,
    pipelineLabel: r.pipeline_label,
    pipelineVersion: p.version,
    topic: r.topic,
    minutes: r.minutes,
    budgetMode: r.budget_mode,
    gateMode: r.gate_mode,
    style: parse<RunStyle>(r.style_json, {}),
    status: r.status,
    demo: r.demo === 1,
    cloud: r.cloud === 1,
    live,
    quoteCredits: r.quote_credits,
    spentCredits: r.spent_credits,
    progress: r.status === 'succeeded' ? 1 : Math.round(progress * 1000) / 1000,
    waitingNodes: nodes.filter((n) => n.gate === 'waiting').map((n) => n.node_id),
    current: running ? { nodeId: running.node_id, label: running.label, step: running.step } : null,
    error: r.error,
    videoFileRef: r.video_file,
    packageDir: r.package_dir,
    durationS: r.duration_s,
    attempt: r.attempt,
    redoOf: r.redo_of,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    example: r.example === 1
  }
}

export function toDetail(r: RunRow, nodes: NodeRow[], live: boolean, engines: Map<string, RunNodeEngine[]> = new Map()): RunDetail {
  return { ...toSummary(r, nodes, live), nodes: nodes.map((n) => toNode(n, engines.get(n.node_id) ?? [])), notes: notesOf(r.notes_json) }
}

/** The run's notes (migration 038), never throwing on an odd value. */
function notesOf(raw: string | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
