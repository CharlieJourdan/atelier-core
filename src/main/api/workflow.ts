import type { ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

type WorkflowMethods =
  | 'channels.list'
  | 'channels.get'
  | 'channels.create'
  | 'channels.update'
  | 'channels.archive'
  | 'channels.discard'
  | 'videos.list'
  | 'videos.get'
  | 'videos.create'
  | 'videos.update'
  | 'videos.cancel'
  | 'videos.markPublished'
  | 'versions.list'
  | 'versions.add'
  | 'approvals.pending'
  | 'approvals.history'
  | 'approvals.approve'
  | 'approvals.requestRevision'
  | 'tasks.list'
  | 'tasks.retry'

/** Every call from the renderer is the owner acting: decisions are recorded as `owner`. */
export function workflowApi(ctx: ApiContext): Pick<ApiHandlers, WorkflowMethods> {
  const wf = ctx.workflow
  const changed = <T>(value: T): T => {
    ctx.notify('videos')
    return value
  }
  return {
    'channels.list': (includeArchived) => wf.channels.list(includeArchived),
    'channels.get': (id) => wf.channels.get(id),
    'channels.create': (input) => {
      const row = wf.channels.create(input)
      // The agent runtime: the channel's memory block, then its team (docs/AGENT-RUNTIME.md §20).
      ctx.orchestra.channelAdded(row.id)
      ctx.notify('channels')
      return row
    },
    'channels.update': (id, patch) => {
      const before = wf.channels.get(id)
      const row = wf.updateChannel(id, patch)
      // Importing = linking the channel to an existing YouTube channel: its team and its goals, once (AGENT-RUNTIME §25).
      if (before.youtubeChannelId === null && row.youtubeChannelId !== null) ctx.orchestra.channelAdded(row.id, 'import')
      ctx.notify('channels')
      return row
    },
    'channels.archive': (id, archived = true) => {
      const row = wf.channels.setArchived(id, archived)
      // Removed: its memory block and its agents are archived with it (restored with it).
      ctx.orchestra.channelArchived(row.id, archived !== false)
      ctx.notify('channels')
      return row
    },
    'channels.discard': (id) => {
      const row = wf.channels.get(id)
      // its agents' open tasks are cancelled first (the runtime forgets a removed channel), then the rows go
      ctx.orchestra.channelArchived(row.id, true)
      wf.channels.discard(row.id)
      for (const t of ['channels', 'orchestra', 'videos'] as const) ctx.notify(t)
      return { discarded: row.id }
    },

    'videos.list': (filter) => wf.listVideos(filter),
    'videos.get': (id) => wf.detail(id),
    'videos.create': (channelId, input) => changed(wf.createVideo(channelId, input)),
    'videos.update': (id, patch) => changed(wf.updateVideo(id, patch)),
    'videos.cancel': (id) => changed(wf.cancelVideo(id)),
    'videos.markPublished': (id) => changed(wf.markPublished(id)),

    'versions.list': (deliverableId) => wf.listVersions(deliverableId),
    'versions.add': (deliverableId, input) => changed(wf.submitVersion(deliverableId, { ...input, author: 'owner' })),

    'approvals.pending': () => wf.pendingApprovals(),
    'approvals.history': (deliverableId) => wf.listApprovals(deliverableId),
    'approvals.approve': (deliverableId, note, versionId) =>
      changed(wf.approve(deliverableId, { by: 'owner', note, versionId })),
    'approvals.requestRevision': (deliverableId, note, versionId) =>
      changed(wf.requestRevision(deliverableId, { by: 'owner', note, versionId })),

    'tasks.list': (filter) => wf.listTasks(filter),
    'tasks.retry': (id) => changed(wf.retryTask(id))
  }
}
