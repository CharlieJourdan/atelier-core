// Row mappers between SQLite snake_case rows and the shared camelCase types.
import {
  DELIVERABLE_GRAPH,
  type ApprovalRow,
  type DeliverableRow,
  type DeliverableStatus,
  type DeliverableType,
  type TaskRow,
  type TaskStatus,
  type VersionRow,
  type VideoRow,
  type VideoStatus
} from '../../shared/workflow'

export interface VideoDb {
  id: number
  channel_id: number
  goal_id: number | null
  title: string
  brief: string
  status: VideoStatus
  deadline: string | null
  created_at: string
  updated_at: string
}
export interface DeliverableDb {
  id: number
  video_id: number
  type: DeliverableType
  status: DeliverableStatus
  needs_approval: number
  owner_gate: number
  current_version_id: number | null
  approved_version_id: number | null
  created_at: string
  updated_at: string
}
export interface VersionDb {
  id: number
  deliverable_id: number
  number: number
  content: string | null
  file_path: string | null
  mime: string | null
  cost_usd: number
  author: string | null
  task_id: number | null
  created_at: string
}
export interface ApprovalDb {
  id: number
  deliverable_id: number
  version_id: number | null
  decision: ApprovalRow['decision']
  decided_by: string
  note: string
  created_at: string
}
export interface TaskDb {
  id: number
  video_id: number | null
  deliverable_id: number | null
  title: string
  assignee_type: 'agent' | 'owner'
  assignee: string
  status: TaskStatus
  attempts: number
  max_attempts: number
  est_cost_usd: number | null
  last_error: string | null
  hold_reason: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export const videoRow = (r: VideoDb): VideoRow => ({
  id: r.id,
  channelId: r.channel_id,
  goalId: r.goal_id,
  title: r.title,
  brief: r.brief,
  status: r.status,
  deadline: r.deadline,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export const deliverableRow = (r: DeliverableDb): DeliverableRow => ({
  id: r.id,
  videoId: r.video_id,
  type: r.type,
  status: r.status,
  needsApproval: r.needs_approval === 1,
  ownerGate: r.owner_gate === 1,
  currentVersionId: r.current_version_id,
  approvedVersionId: r.approved_version_id,
  dependsOn: [...(DELIVERABLE_GRAPH.find((d) => d.type === r.type)?.dependsOn ?? [])],
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export const versionRow = (r: VersionDb): VersionRow => ({
  id: r.id,
  deliverableId: r.deliverable_id,
  number: r.number,
  content: r.content,
  filePath: r.file_path,
  mime: r.mime,
  costUsd: r.cost_usd,
  author: r.author,
  taskId: r.task_id,
  createdAt: r.created_at
})

export const approvalRow = (r: ApprovalDb): ApprovalRow => ({
  id: r.id,
  deliverableId: r.deliverable_id,
  versionId: r.version_id,
  decision: r.decision,
  decidedBy: r.decided_by,
  note: r.note,
  createdAt: r.created_at
})

export const taskRow = (r: TaskDb): TaskRow => ({
  id: r.id,
  videoId: r.video_id,
  deliverableId: r.deliverable_id,
  title: r.title,
  assigneeType: r.assignee_type,
  assignee: r.assignee,
  status: r.status,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  estCostUsd: r.est_cost_usd,
  lastError: r.last_error,
  holdReason: r.hold_reason ?? null,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})
