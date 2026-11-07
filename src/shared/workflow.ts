// Workflow types and the static deliverable graph (SPEC § Workflow d'une vidéo). Shared by main and renderer.

export const DELIVERABLE_TYPES = [
  'research',
  'thumbnail_brief',
  'script',
  'metadata',
  'narration',
  'thumbnail',
  'edit',
  'qc_report',
  'publish_package'
] as const
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number]

export const VIDEO_STATUSES = ['idea', 'in_progress', 'waiting_approval', 'ready', 'published', 'cancelled', 'failed'] as const
export type VideoStatus = (typeof VIDEO_STATUSES)[number]

export const DELIVERABLE_STATUSES = [
  'pending',
  'in_progress',
  'waiting_approval',
  'revision_requested',
  'approved',
  'done'
] as const
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number]

export const TASK_STATUSES = ['blocked', 'ready', 'running', 'waiting_approval', 'done', 'failed', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface DeliverableDefinition {
  type: DeliverableType
  dependsOn: readonly DeliverableType[]
  /** Needs a human decision by default (an owner gate always needs one). */
  needsApproval: boolean
  /** Agent role that produces it. */
  role: string
  title: string
}

/**
 * SPEC lists publish_package with no dependency ("—"); a package that is ready before anything exists would be
 * meaningless, so it waits for every final asset. Change it here only.
 */
export const DELIVERABLE_GRAPH: readonly DeliverableDefinition[] = [
  { type: 'research', dependsOn: [], needsApproval: false, role: 'researcher', title: 'Research' },
  { type: 'thumbnail_brief', dependsOn: ['research'], needsApproval: true, role: 'thumbnail_designer', title: 'Thumbnail brief' },
  { type: 'script', dependsOn: ['research', 'thumbnail_brief'], needsApproval: true, role: 'scriptwriter', title: 'Script' },
  { type: 'metadata', dependsOn: ['script'], needsApproval: true, role: 'metadata', title: 'Metadata' },
  { type: 'narration', dependsOn: ['script'], needsApproval: false, role: 'voiceover', title: 'Narration' },
  { type: 'thumbnail', dependsOn: ['thumbnail_brief'], needsApproval: true, role: 'thumbnail_designer', title: 'Thumbnail' },
  { type: 'edit', dependsOn: ['narration', 'script'], needsApproval: true, role: 'video_producer', title: 'Edit' },
  { type: 'qc_report', dependsOn: ['script', 'metadata'], needsApproval: false, role: 'qc', title: 'QC report' },
  {
    type: 'publish_package',
    dependsOn: ['metadata', 'thumbnail', 'edit', 'qc_report'],
    needsApproval: true,
    role: 'publisher',
    title: 'Publish package'
  }
]

export const DEFAULT_OWNER_GATES: readonly DeliverableType[] = ['publish_package']

export function isDeliverableType(v: unknown): v is DeliverableType {
  return typeof v === 'string' && (DELIVERABLE_TYPES as readonly string[]).includes(v)
}

export interface ChannelRow {
  id: number
  name: string
  youtubeChannelId: string | null
  niche: string
  standards: string
  monthlyBudgetUsd: number | null
  autopilotOn: boolean
  autopilotTarget: number | null
  autopilotWeeklyMax: number | null
  /** Deliverable types approved without asking (never applies to owner-gated ones). */
  autoApprove: DeliverableType[]
  /** Deliverable types only the owner may approve. */
  ownerGates: DeliverableType[]
  thumbnailStyle: string
  scriptStyle: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type ChannelInput = Partial<Omit<ChannelRow, 'id' | 'archived' | 'createdAt' | 'updatedAt'>> & { name: string }
export type ChannelPatch = Partial<Omit<ChannelRow, 'id' | 'archived' | 'createdAt' | 'updatedAt'>>

export interface VideoRow {
  id: number
  channelId: number
  goalId: number | null
  title: string
  brief: string
  status: VideoStatus
  deadline: string | null
  createdAt: string
  updatedAt: string
}

export interface VideoInput {
  title?: string
  brief?: string
  deadline?: string | null
  goalId?: number | null
}
export type VideoPatch = VideoInput

export interface VersionRow {
  id: number
  deliverableId: number
  number: number
  content: string | null
  filePath: string | null
  mime: string | null
  costUsd: number
  author: string | null
  taskId: number | null
  createdAt: string
}

export interface VersionInput {
  content?: string | null
  filePath?: string | null
  mime?: string | null
  costUsd?: number
  author?: string | null
  taskId?: number | null
}

export interface DeliverableRow {
  id: number
  videoId: number
  type: DeliverableType
  status: DeliverableStatus
  needsApproval: boolean
  ownerGate: boolean
  currentVersionId: number | null
  approvedVersionId: number | null
  dependsOn: DeliverableType[]
  createdAt: string
  updatedAt: string
}

export type ApprovalDecision = 'approved' | 'revision_requested' | 'auto_approved'

export interface ApprovalRow {
  id: number
  deliverableId: number
  versionId: number | null
  decision: ApprovalDecision
  decidedBy: string
  note: string
  createdAt: string
}

export interface TaskRow {
  id: number
  videoId: number | null
  deliverableId: number | null
  title: string
  assigneeType: 'agent' | 'owner'
  assignee: string
  status: TaskStatus
  attempts: number
  maxAttempts: number
  estCostUsd: number | null
  lastError: string | null
  /** Set while the runner holds the task (e.g. a budget cap refused its call); a held task is not started. */
  holdReason: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VideoDetail {
  video: VideoRow
  deliverables: DeliverableRow[]
  tasks: TaskRow[]
}

export interface TaskFilter {
  videoId?: number
  status?: TaskStatus
}

export interface VideoFilter {
  channelId?: number
  status?: VideoStatus
}

/** A deliverable waiting for a human decision, with the version to review. */
export interface PendingApproval {
  deliverable: DeliverableRow
  video: VideoRow
  version: VersionRow | null
}
