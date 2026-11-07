// Chat types shared by main and renderer: conversations, messages and the typed `card` JSON.
import type { Department, HandoffCard } from './chat-rich'
import type { DeliverableStatus, DeliverableType } from './workflow'

/**
 * `channel`: the channel Manager's conversation (one per channel); `room`: a department room of a channel (lot 13).
 */
export const CONVERSATION_KINDS = ['supervisor', 'video', 'agent', 'channel', 'room'] as const
export type ConversationKind = (typeof CONVERSATION_KINDS)[number]

export type AuthorType = 'owner' | 'agent' | 'system'

export interface ConversationRow {
  id: number
  kind: ConversationKind
  title: string
  videoId: number | null
  /** Agent role for kind 'agent'. */
  agentId: string | null
  /** Channel of a 'channel' or 'room' conversation (and of a video's). */
  channelId: number | null
  /** Department of a 'room'. */
  department: Department | null
  /** Messages after `last_read_message_id` that the owner did not write. */
  unread: number
  lastMessage: { body: string; authorType: AuthorType; createdAt: string } | null
  updatedAt: string
}

export interface ConversationInput {
  kind: ConversationKind
  videoId?: number
  agentId?: string
  /** For 'channel' and 'room'. */
  channelId?: number
  /** For 'room'. */
  department?: Department
}

export interface Attachment {
  name: string
  mime: string
  size: number
  /** Absolute path of the stored copy (inside Atelier's data folder). */
  path: string
}

/** An attachment as sent by the renderer: the bytes travel base64 (the sandboxed renderer has no file paths). */
export interface AttachmentUpload {
  name: string
  mime: string
  dataBase64: string
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 8

// ---- cards -------------------------------------------------------------------------------------------------

export interface ApprovalCard {
  type: 'approval'
  deliverableId: number
  versionId: number | null
  deliverableType: DeliverableType
  title: string
  /** First lines of the version content (or the file name). */
  excerpt: string
  ownerGate: boolean
  /** Live deliverable status, filled in when messages are read (not stored). */
  status?: DeliverableStatus
  /** True when a newer version superseded the one on this card (filled in when read). */
  stale?: boolean
}

export interface BudgetCard {
  type: 'budget'
  scope: 'global' | 'channel'
  capUsd: number
  spentUsd: number
  requestedUsd: number
  message: string
  /** The task put on hold by this refusal (runner), if any. */
  taskId?: number
  /** Live: true while that task is still on hold (filled in when read). */
  held?: boolean
}

export interface ProposalCard {
  type: 'proposal'
  proposalId: number | null
  title: string
  detail: string
  /** Live proposal status (filled in when read). */
  status?: 'pending' | 'accepted' | 'rejected' | 'expired'
}

export interface TaskCard {
  type: 'task'
  taskId: number
  title: string
  /** Status when posted; replaced by the live task status when read. */
  status: string
  assignee: string
  /** Live: why the task is on hold, if it is (filled in when read). */
  holdReason?: string | null
  /** Live: last error of the task (filled in when read). */
  lastError?: string | null
}

export interface QcCard {
  type: 'qc'
  passed: boolean
  summary: string
  items: { label: string; ok: boolean; note?: string }[]
}

export type Card = ApprovalCard | BudgetCard | ProposalCard | TaskCard | QcCard | HandoffCard
export const CARD_TYPES = ['approval', 'budget', 'proposal', 'task', 'qc', 'handoff'] as const

/** An Atelier tool an agent used while writing a message (shown folded as "✓ N outils"). */
export interface ToolUse {
  name: string
  state: 'done' | 'error'
}

export interface MessageRow {
  id: number
  conversationId: number
  authorType: AuthorType
  authorId: string | null
  body: string
  card: Card | null
  attachments: Attachment[]
  /** Tools used for this message (agent replies), oldest first. */
  tools: ToolUse[]
  createdAt: string
}

export interface SendResult {
  message: MessageRow
  /** Id of the `atelier:stream` events carrying the reply, or null when nobody replies (no agent yet). */
  streamId: string | null
}
