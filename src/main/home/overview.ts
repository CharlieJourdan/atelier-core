// Accueil and Validations (lot Z1): reads the workflow, the production runs, the wallet and the ledger, writes nothing.
import type { HomeAgentActivity, HomeChannel, HomeInbox, HomeOverview, HomeVideo, InboxGate, InboxTopItem } from '../../shared/api/home'
import { t, type MessageKey } from '../../shared/fr'
import type { ApiContext } from '../api/context'

const TOP = 5
const RECENT_TASKS = 6

type Reader = Pick<ApiContext, 'workflow' | 'productionRuns' | 'credits' | 'ledger' | 'agents' | 'example'>

export function readInbox(ctx: Reader): HomeInbox {
  const approvals = ctx.workflow.pendingApprovals()
  const gates: InboxGate[] = []
  for (const run of ctx.productionRuns.list({ status: 'waiting', limit: 100 })) {
    const detail = ctx.productionRuns.get(run.id)
    for (const node of detail.nodes) {
      if (node.gate !== 'waiting' || node.gateKind === 'none') continue
      gates.push({
        runId: run.id,
        nodeId: node.nodeId,
        nodeLabel: node.label,
        gateKind: node.gateKind,
        videoId: run.videoId,
        videoTitle: run.videoTitle,
        channelId: run.channelId,
        channelName: run.channelName,
        pipelineLabel: run.pipelineLabel,
        demo: run.demo,
        step: node.step
      })
    }
  }
  return { approvals, gates, total: approvals.length + gates.length }
}

function topItems(inbox: HomeInbox, channelName: (id: number) => string): InboxTopItem[] {
  const items: InboxTopItem[] = [
    ...inbox.approvals.map((a) => ({
      kind: 'approval' as const,
      key: `deliverable:${a.deliverable.id}`,
      title: t(`home.deliverable.${a.deliverable.type}` as MessageKey),
      videoTitle: a.video.title,
      channelName: channelName(a.video.channelId)
    })),
    ...inbox.gates.map((g) => ({ kind: 'gate' as const, key: `run:${g.runId}:${g.nodeId}`, title: g.nodeLabel, videoTitle: g.videoTitle, channelName: g.channelName }))
  ]
  return items.slice(0, TOP)
}

export function readOverview(ctx: Reader): HomeOverview {
  const channels = ctx.workflow.channels.list()
  const names = new Map(channels.map((c) => [c.id, c.name]))
  const channelName = (id: number): string => names.get(id) ?? '—'
  const exampleIds = new Set(ctx.example.status().channelIds)
  const inbox = readInbox(ctx)
  const videos = ctx.workflow.listVideos()

  const waitingBy = new Map<number, number>()
  const bump = (id: number): void => void waitingBy.set(id, (waitingBy.get(id) ?? 0) + 1)
  for (const a of inbox.approvals) bump(a.video.channelId)
  for (const g of inbox.gates) bump(g.channelId)

  const homeChannels: HomeChannel[] = channels.map((c) => {
    const own = videos.filter((v) => v.channelId === c.id)
    return {
      id: c.id,
      name: c.name,
      niche: c.niche,
      example: exampleIds.has(c.id),
      videosOpen: own.filter((v) => v.status !== 'published' && v.status !== 'cancelled' && v.status !== 'ready').length,
      videosPublished: own.filter((v) => v.status === 'published').length,
      waiting: waitingBy.get(c.id) ?? 0
    }
  })

  const runs = ctx.productionRuns.list({ status: ['queued', 'running', 'waiting'], limit: 50 })
  const withRun = new Set(runs.map((r) => r.videoId))
  const inProgress: HomeVideo[] = [
    ...runs.map((r): HomeVideo => ({
      videoId: r.videoId,
      title: r.videoTitle,
      channelId: r.channelId,
      channelName: r.channelName,
      example: exampleIds.has(r.channelId),
      source: 'production',
      state: r.status === 'waiting' ? 'waiting' : r.status === 'queued' ? 'queued' : 'running',
      progress: r.progress,
      runId: r.id,
      step: r.current?.label ?? null,
      updatedAt: r.createdAt
    })),
    ...videos
      .filter((v) => (v.status === 'in_progress' || v.status === 'waiting_approval') && !withRun.has(v.id))
      .map((v): HomeVideo => ({
        videoId: v.id,
        title: v.title,
        channelId: v.channelId,
        channelName: channelName(v.channelId),
        example: exampleIds.has(v.channelId),
        source: 'workflow',
        state: v.status === 'waiting_approval' ? 'waiting_approval' : 'in_progress',
        progress: null,
        runId: null,
        step: null,
        updatedAt: v.updatedAt
      }))
  ]

  const agentNames = new Map(ctx.agents.list().map((a) => [a.id, a.name]))
  const videoTitles = new Map(videos.map((v) => [v.id, v.title]))
  const tasks = ctx.workflow.listTasks().filter((t) => t.assigneeType === 'agent')
  const recent: HomeAgentActivity[] = [...tasks]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.id - a.id))
    .slice(0, RECENT_TASKS)
    .map((t) => ({
      id: t.id,
      agentId: t.assignee,
      agentName: agentNames.get(t.assignee) ?? t.assignee,
      title: t.title,
      status: t.status,
      videoId: t.videoId,
      videoTitle: t.videoId === null ? null : (videoTitles.get(t.videoId) ?? null),
      updatedAt: t.updatedAt
    }))

  const spend = ctx.ledger.overview()
  return {
    channels: homeChannels,
    videos: inProgress,
    validations: { total: inbox.total, top: topItems(inbox, channelName) },
    credits: ctx.credits.balance(),
    agents: { working: tasks.filter((t) => t.status === 'running').length, recent },
    spend: { month: spend.month, spentUsd: spend.spentUsd, reservedUsd: spend.reservedUsd, capUsd: spend.globalCapUsd }
  }
}
