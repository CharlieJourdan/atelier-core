// Types of the read-only aggregates behind the Board and Dashboard views.
import type { DeliverableType, VideoRow, VideoStatus } from './workflow'

export const BOARD_STAGES = ['idea', 'research', 'script', 'production', 'packaging', 'ready', 'published'] as const
export type BoardStage = (typeof BOARD_STAGES)[number]

export const STAGE_LABELS: Record<BoardStage, string> = {
  idea: 'Idea',
  research: 'Research',
  script: 'Script',
  production: 'Production',
  packaging: 'Packaging',
  ready: 'Ready',
  published: 'Published'
}

/** The deliverables whose completion closes each working stage, in order. */
export const STAGE_DELIVERABLES: Record<'research' | 'script' | 'production' | 'packaging', readonly DeliverableType[]> = {
  research: ['research', 'thumbnail_brief'],
  script: ['script'],
  production: ['metadata', 'narration', 'thumbnail', 'edit', 'qc_report'],
  packaging: ['publish_package']
}

export type BlockerKind = 'awaiting_approval' | 'revision_requested' | 'failed_task' | 'on_hold' | 'waiting_on'

export interface Blocker {
  kind: BlockerKind
  deliverable: DeliverableType
  text: string
}

export interface BoardCard {
  video: VideoRow
  channelName: string
  stage: BoardStage
  /** Deliverables approved or done, out of all deliverables. */
  doneCount: number
  totalCount: number
  blockers: Blocker[]
}

export interface BoardColumn {
  stage: BoardStage
  label: string
  cards: BoardCard[]
}

export interface FunnelStep {
  status: VideoStatus
  label: string
  count: number
}

export interface AgentRow {
  /** Task assignee: an agent role, or `owner`. */
  assignee: string
  tasks: number
  ready: number
  running: number
  waitingApproval: number
  done: number
  failed: number
  /** Settled spend this month for the tasks of this assignee. */
  spentUsd: number
}

export interface DashboardData {
  month: string
  funnel: FunnelStep[]
  spentUsd: number
  reservedUsd: number
  globalCapUsd: number | null
  pendingApprovals: number
  agents: AgentRow[]
}
