// IPC contract, module "workflow": Channels, videos, versions, approvals and tasks.
import type {
  ApprovalRow,
  ChannelInput,
  ChannelPatch,
  ChannelRow,
  DeliverableRow,
  PendingApproval,
  TaskFilter,
  TaskRow,
  VersionInput,
  VersionRow,
  VideoDetail,
  VideoFilter,
  VideoInput,
  VideoPatch,
  VideoRow
} from '../workflow'

export interface WorkflowContract {
  'channels.list': { args: [includeArchived?: boolean]; result: ChannelRow[] }

  'channels.get': { args: [id: number]; result: ChannelRow }

  'channels.create': { args: [input: ChannelInput]; result: ChannelRow }

  'channels.update': { args: [id: number, patch: ChannelPatch]; result: ChannelRow }

  'channels.archive': { args: [id: number, archived?: boolean]; result: ChannelRow }

  /** « Annuler » in « Ajouter une chaîne »: the channel the flow already made is deleted (refused once a video is published). */
  'channels.discard': { args: [id: number]; result: { discarded: number } }

  'videos.list': { args: [filter?: VideoFilter]; result: VideoRow[] }

  'videos.get': { args: [id: number]; result: VideoDetail }

  'videos.create': { args: [channelId: number, input?: VideoInput]; result: VideoDetail }

  'videos.update': { args: [id: number, patch: VideoPatch]; result: VideoRow }

  'videos.cancel': { args: [id: number]; result: VideoRow }

  'videos.markPublished': { args: [id: number]; result: VideoRow }

  'versions.list': { args: [deliverableId: number]; result: VersionRow[] }

  /** Manual submission by the owner (agents go through the engine in main). */
  'versions.add': { args: [deliverableId: number, input: VersionInput]; result: VersionRow }

  'approvals.pending': { args: []; result: PendingApproval[] }

  'approvals.history': { args: [deliverableId: number]; result: ApprovalRow[] }

  'approvals.approve': { args: [deliverableId: number, note?: string, versionId?: number]; result: DeliverableRow }

  'approvals.requestRevision': { args: [deliverableId: number, note: string, versionId?: number]; result: DeliverableRow }

  'tasks.list': { args: [filter?: TaskFilter]; result: TaskRow[] }

  'tasks.retry': { args: [id: number]; result: TaskRow }

  /** Takes a task off hold (after raising a budget cap) so the runner tries it again. */
  'tasks.resume': { args: [id: number]; result: TaskRow }
}

export const WORKFLOW_METHODS = [
  'channels.list',
  'channels.get',
  'channels.create',
  'channels.update',
  'channels.archive',
  'channels.discard',
  'videos.list',
  'videos.get',
  'videos.create',
  'videos.update',
  'videos.cancel',
  'videos.markPublished',
  'versions.list',
  'versions.add',
  'approvals.pending',
  'approvals.history',
  'approvals.approve',
  'approvals.requestRevision',
  'tasks.list',
  'tasks.retry',
  'tasks.resume'
] as const satisfies readonly (keyof WorkflowContract)[]
