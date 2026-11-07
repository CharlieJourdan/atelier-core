// « Activité »: what the team does right now, in one read (docs/AGENT-RUNTIME.md §25). Who works on what since when and on
// which account, what waits and on whom (Charlie, other agents, limited accounts, the budget), what is queued next, the
// next routines, the accounts and their limits, what the team's calls cost today and this month, and the latest events.
// Read-only: built from the queue, the tree, the routines, the accounts, the inbox and the ledger.
import type { ActivitySnapshot, ActivityWait, PowerView, WaitOn } from '../../shared/api/autopilot'
import type { OrchTask } from '../../shared/api/orchestra'
import { monthBounds, monthOf } from '../ledger'
import type { RuntimeParts } from './parts'
import type { Supervisor } from './supervisor'
import { iso } from './util'

const WAIT_ON: Record<string, WaitOn> = { human: 'charlie', children: 'team', accounts: 'accounts', budget: 'budget' }

export function activity(p: RuntimeParts, sup: Supervisor, power: PowerView): ActivitySnapshot {
  const now = p.now()
  const agents = new Map(p.tree.list().map((a) => [a.id, a]))
  const channelNames = new Map(
    (p.db.prepare('SELECT id, name FROM channels').all() as { id: number; name: string }[]).map((c) => [c.id, c.name])
  )
  const agentName = (id: number): string => agents.get(id)?.name ?? `#${id}`
  const channelOf = (t: { channelId: number | null; assigneeId?: number }): string | null => {
    const id = t.channelId ?? (t.assigneeId !== undefined ? (agents.get(t.assigneeId)?.channelId ?? null) : null)
    return id === null ? null : (channelNames.get(id) ?? null)
  }
  const accounts = p.accounts.list()
  const accountLabel = new Map(accounts.map((a) => [a.id, a.label]))

  const running = [...sup.running.values()].map((h) => {
    const t = p.queue.find(h.taskId)
    return {
      taskId: h.taskId,
      agentId: h.agentId,
      agentName: agentName(h.agentId),
      channelName: t ? channelOf(t) : null,
      kind: t?.kind ?? '',
      title: t?.title ?? '',
      since: iso(h.startedAt),
      account: accountLabel.get(h.accountId) ?? null
    }
  })

  const openInbox = p.inbox.list(false)
  const waiting: ActivityWait[] = p.queue.list({ status: ['waiting', 'waiting_human'], limit: 100 }).map((t) => {
    const on = t.status === 'waiting_human' ? 'charlie' : (WAIT_ON[t.waitReason ?? ''] ?? 'other')
    return {
      taskId: t.id,
      agentId: t.assigneeId,
      agentName: agentName(t.assigneeId),
      channelName: channelOf(t),
      title: t.title,
      on,
      who: waitsOn(p, t, on, agentName),
      until: on === 'accounts' || on === 'budget' ? t.notBefore : null,
      inboxId: on === 'charlie' ? (openInbox.find((i) => i.taskId === t.id)?.id ?? null) : null,
      since: t.updatedAt
    }
  })

  const queuedTasks = p.queue.list({ status: ['queued', 'failed'], limit: 200 })
  const queued = {
    count: queuedTasks.length,
    next: queuedTasks
      .sort((a, b) => b.priority - a.priority || a.id - b.id)
      .slice(0, 8)
      .map((t) => ({ taskId: t.id, agentId: t.assigneeId, agentName: agentName(t.assigneeId), title: t.title, notBefore: t.notBefore }))
  }

  const nextRoutines = p.routines
    .list()
    .filter((r) => r.enabled && r.nextRunAt !== null && agents.has(r.agentId))
    .sort((a, b) => (a.nextRunAt as string).localeCompare(b.nextRunAt as string))
    .slice(0, 6)
    .map((r) => {
      const a = agents.get(r.agentId)
      return { id: r.id, name: r.name, agentId: r.agentId, agentName: a?.name ?? '', channelName: a?.channelId ? (channelNames.get(a.channelId) ?? null) : null, at: r.nextRunAt as string }
    })

  return {
    at: iso(now),
    power,
    running,
    waiting,
    queued,
    nextRoutines,
    accounts: accounts.map((a) => {
      const limited = p.accounts.isLimited(a)
      return {
        id: a.id,
        label: a.label,
        kind: a.kind,
        ready: a.enabled && !limited && (a.state ?? 'ready') === 'ready' && typeof a.checkedAt === 'string',
        state: a.state ?? 'ready',
        limitedUntil: limited ? a.limitedUntil : null,
        running: p.accounts.running(a.id),
        maxConcurrent: a.maxConcurrent
      }
    }),
    spend: spend(p, now),
    counts: p.queue.counts(),
    events: p.events.list(Math.max(0, lastEventId(p) - 40), 40).reverse()
  }
}

function waitsOn(p: RuntimeParts, t: OrchTask, on: WaitOn, agentName: (id: number) => string): string {
  if (on === 'charlie') return 'Charlie'
  if (on === 'team') {
    const open = p.queue.children(t.id).filter((c) => !['done', 'dead', 'cancelled'].includes(c.status))
    return [...new Set(open.map((c) => agentName(c.assigneeId)))].join(', ')
  }
  if (on === 'accounts') return p.accounts.list().filter((a) => a.enabled && p.accounts.isLimited(a)).map((a) => a.label).join(', ')
  if (on === 'budget') return 'Budget du mois'
  return t.waitReason ?? ''
}

function lastEventId(p: RuntimeParts): number {
  return (p.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM orch_events').get() as { id: number }).id
}

/** The team's calls in the ledger (booked with an account): today (local day) and this month. */
function spend(p: RuntimeParts, now: number): ActivitySnapshot['spend'] {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const { start, end } = monthBounds(monthOf(new Date(now)))
  const sum = (from: string, to: string): { n: number; usd: number } =>
    p.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(CASE status WHEN 'reserved' THEN estimate_usd WHEN 'refunded' THEN 0 ELSE amount_usd END), 0) AS usd
         FROM ledger WHERE account_id IS NOT NULL AND created_at >= ? AND created_at < ?`
      )
      .get(from, to) as { n: number; usd: number }
  const today = sum(day.toISOString(), iso(day.getTime() + 86_400_000))
  const month = sum(start, end)
  const round = (v: number): number => Math.round(v * 1e4) / 1e4
  return { callsToday: today.n, usdToday: round(today.usd), usdMonth: round(month.usd) }
}
