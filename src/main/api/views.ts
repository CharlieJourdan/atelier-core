// Read-only aggregates for the Board and Dashboard views. Pure SQL/TS over the workflow tables; no writes.
import type { ApiHandlers } from '../../shared/api'
import {
  BOARD_STAGES,
  STAGE_DELIVERABLES,
  STAGE_LABELS,
  type AgentRow,
  type Blocker,
  type BoardCard,
  type BoardColumn,
  type BoardStage,
  type DashboardData,
  type FunnelStep
} from '../../shared/views'
import { DELIVERABLE_GRAPH, VIDEO_STATUSES, type DeliverableRow, type TaskRow, type VideoRow } from '../../shared/workflow'
import type { ApiContext } from './context'

const SATISFIED = ['approved', 'done']
const title = (type: string): string => DELIVERABLE_GRAPH.find((d) => d.type === type)?.title ?? type

/** The first working stage that still has an unfinished deliverable (published/ready come from the video status). */
export function stageOf(video: VideoRow, deliverables: DeliverableRow[]): BoardStage {
  if (video.status === 'published') return 'published'
  if (video.status === 'ready') return 'ready'
  if (deliverables.every((d) => d.status === 'pending')) return 'idea'
  for (const stage of ['research', 'script', 'production', 'packaging'] as const) {
    const types: readonly string[] = STAGE_DELIVERABLES[stage]
    if (deliverables.some((d) => types.includes(d.type) && !SATISFIED.includes(d.status))) return stage
  }
  return 'packaging'
}

export function blockersOf(deliverables: DeliverableRow[], tasks: TaskRow[]): Blocker[] {
  const out: Blocker[] = []
  for (const d of deliverables) {
    if (d.status === 'waiting_approval') {
      out.push({ kind: 'awaiting_approval', deliverable: d.type, text: `${title(d.type)} waits for your approval` })
    } else if (d.status === 'revision_requested') {
      out.push({ kind: 'revision_requested', deliverable: d.type, text: `${title(d.type)} was sent back for revision` })
    }
  }
  for (const t of tasks) {
    const d = deliverables.find((x) => x.id === t.deliverableId)
    if (!d) continue
    if (t.status === 'failed') {
      out.push({ kind: 'failed_task', deliverable: d.type, text: `${title(d.type)} failed: ${t.lastError ?? 'unknown error'}` })
    } else if (t.holdReason !== null && t.status === 'ready') {
      const why = t.holdReason === 'budget' ? 'a budget cap was reached' : 'it could not start'
      out.push({ kind: 'on_hold', deliverable: d.type, text: `${title(d.type)} is on hold: ${why}` })
    }
  }
  // Nothing needs a decision: name what the next pending deliverable is waiting on.
  if (!out.length) {
    const byType = new Map(deliverables.map((d) => [d.type, d]))
    for (const d of deliverables) {
      if (d.status !== 'pending') continue
      const dep = d.dependsOn.find((x) => !SATISFIED.includes(byType.get(x)?.status ?? ''))
      if (dep && byType.get(dep)?.status !== 'pending') {
        out.push({ kind: 'waiting_on', deliverable: d.type, text: `${title(d.type)} waits for ${title(dep)}` })
        break
      }
    }
  }
  return out
}

const FUNNEL_LABELS: Record<string, string> = {
  idea: 'Ideas',
  in_progress: 'In progress',
  waiting_approval: 'Waiting for you',
  ready: 'Ready to publish',
  published: 'Published'
}

interface TaskCountRow {
  assignee: string
  tasks: number
  ready: number
  running: number
  waiting: number
  done: number
  failed: number
}

export function viewsApi(ctx: ApiContext): Pick<ApiHandlers, 'board.columns' | 'dashboard.overview'> {
  const wf = ctx.workflow
  return {
    'board.columns': (channelId) => {
      const names = new Map(wf.channels.list(true).map((c) => [c.id, c.name]))
      const columns: BoardColumn[] = BOARD_STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage], cards: [] }))
      for (const video of wf.listVideos(channelId === undefined ? {} : { channelId })) {
        if (video.status === 'cancelled') continue
        const { deliverables, tasks } = wf.detail(video.id)
        const stage = stageOf(video, deliverables)
        const card: BoardCard = {
          video,
          channelName: names.get(video.channelId) ?? '',
          stage,
          doneCount: deliverables.filter((d) => SATISFIED.includes(d.status)).length,
          totalCount: deliverables.length,
          blockers: video.status === 'published' ? [] : blockersOf(deliverables, tasks)
        }
        columns.find((c) => c.stage === stage)?.cards.push(card)
      }
      return columns
    },

    'dashboard.overview': (month) => {
      const spend = ctx.ledger.overview(month)
      const videos = wf.listVideos()
      const funnel: FunnelStep[] = VIDEO_STATUSES.filter((s) => s !== 'cancelled' && s !== 'failed').map((status) => ({
        status,
        label: FUNNEL_LABELS[status] ?? status,
        count: videos.filter((v) => v.status === status).length
      }))
      const taskRows = ctx.db
        .prepare(
          `SELECT assignee,
                  COUNT(*) AS tasks,
                  COALESCE(SUM(status = 'ready'), 0) AS ready,
                  COALESCE(SUM(status = 'running'), 0) AS running,
                  COALESCE(SUM(status = 'waiting_approval'), 0) AS waiting,
                  COALESCE(SUM(status = 'done'), 0) AS done,
                  COALESCE(SUM(status = 'failed'), 0) AS failed
           FROM tasks WHERE status <> 'cancelled' GROUP BY assignee ORDER BY assignee`
        )
        .all() as unknown as TaskCountRow[]
      const spentRows = ctx.db
        .prepare(
          `SELECT t.assignee AS assignee, SUM(l.amount_usd) AS spent FROM ledger l JOIN tasks t ON t.id = l.task_id
           WHERE l.status IN ('settled','adjustment') AND substr(l.created_at, 1, 7) = ? GROUP BY t.assignee`
        )
        .all(spend.month) as unknown as { assignee: string; spent: number }[]
      const spent = new Map(spentRows.map((r) => [r.assignee, r.spent]))
      const agents: AgentRow[] = taskRows.map((r) => ({
        assignee: r.assignee,
        tasks: r.tasks,
        ready: r.ready,
        running: r.running,
        waitingApproval: r.waiting,
        done: r.done,
        failed: r.failed,
        spentUsd: spent.get(r.assignee) ?? 0
      }))
      const data: DashboardData = {
        month: spend.month,
        funnel,
        spentUsd: spend.spentUsd,
        reservedUsd: spend.reservedUsd,
        globalCapUsd: spend.globalCapUsd,
        pendingApprovals: wf.pendingApprovals().length,
        agents
      }
      return data
    }
  }
}
