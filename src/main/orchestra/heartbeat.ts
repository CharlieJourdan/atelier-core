// The heartbeat (docs/AGENT-RUNTIME.md §26): every pass of the loop, it follows up the threads that went quiet.
//   - A question to Charlie (validate, input, files) unanswered for 24 h: one reminder in the Supervisor chat, never two
//     (`orch_inbox.reminded_at`).
//   - A planned task stuck waiting (on Charlie, sub-tasks, accounts or budget) past its due time — its deadline, or its
//     opening plus its usual duration when it opened already late — : its channel lead gets a `followup` task, once
//     (`payload.staleToldAt`).
import { transaction } from '../db'
import type { RuntimeParts } from './parts'
import { durationOf, stepDef, type PlanStep, type SlotKind } from './plan'
import { iso, isRecord, truncate } from './util'

const HOUR = 3_600_000
export const REMIND_AFTER_MS = 24 * HOUR

export function heartbeat(p: RuntimeParts): number {
  return remindQuestions(p) + tellLeads(p)
}

function remindQuestions(p: RuntimeParts): number {
  const now = p.now()
  const rows = p.db
    .prepare(
      `SELECT id, title, created_at FROM orch_inbox WHERE status = 'open' AND kind IN ('validate','input','files')
         AND reminded_at IS NULL AND created_at <= ? ORDER BY id`
    )
    .all(iso(now - REMIND_AFTER_MS)) as { id: number; title: string; created_at: string }[]
  let n = 0
  for (const r of rows) {
    const changed = p.db.prepare('UPDATE orch_inbox SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL').run(iso(now), r.id)
    if (Number(changed.changes) !== 1) continue
    const hours = Math.floor((now - Date.parse(r.created_at)) / HOUR)
    const text = `Rappel : « ${r.title} » attend ta réponse depuis ${hours} h (boîte de réception).`
    p.events.add('reminder', text)
    try {
      const principal = p.tree.principal()
      const conv = p.messaging.conversationFor('principal', null, null)
      if (principal) p.messaging.post(principal, conv, text, 99)
      else p.messaging.system(conv, text)
    } catch {
      // chat unavailable (closing)
    }
    n++
  }
  return n
}

function tellLeads(p: RuntimeParts): number {
  const now = p.now()
  const rows = p.db
    .prepare(
      `SELECT id FROM orch_tasks WHERE status IN ('waiting','waiting_human') AND json_extract(payload, '$.plan.step') IS NOT NULL
         AND json_extract(payload, '$.staleToldAt') IS NULL ORDER BY id`
    )
    .all() as { id: number }[]
  let n = 0
  for (const { id } of rows) {
    const t = p.queue.get(id)
    const plan = isRecord(t.payload.plan) ? t.payload.plan : {}
    const step = String(plan.step) as PlanStep
    const deadline = Date.parse(String(plan.deadline))
    const kind: SlotKind = plan.kind === 'short' ? 'short' : 'long'
    if (!stepDef(step) || !Number.isFinite(deadline)) continue
    const due = Math.max(deadline, Date.parse(t.createdAt) + durationOf(step, kind))
    if (now <= due || t.channelId === null) continue
    const lead = p.tree.bySlug(`lead-${t.channelId}`)
    if (!lead || lead.archivedAt) continue
    const on = t.status === 'waiting_human' ? 'waits for Charlie' : t.waitReason === 'children' ? 'waits for its sub-tasks' : `waits (${t.waitReason ?? 'blocked'})`
    // the mark and the follow-up together: a crash between them neither loses nor doubles it
    const followup = transaction(p.db, () => {
      p.queue.patchPayload(id, { staleToldAt: iso(now) })
      return p.queue.enqueue({
        kind: 'followup',
        title: `Relance : #${t.id} « ${truncate(t.title, 80)} » bloquée`,
        assigneeId: lead.id,
        payload: {
          brief: `Task #${t.id} "${t.title}" (planned step "${step}" of the slot ${String(plan.slotAt)}) ${on} since ${t.updatedAt}, past its due time ${iso(due)}. Unblock it: remind whoever it waits for, re-plan, or tell Charlie plainly what the slot needs.`,
          staleTask: t.id
        },
        priority: 6,
        channelId: t.channelId,
        videoId: t.videoId
      })
    })
    p.events.add('followup', `${lead.name} : la tâche #${t.id} est bloquée après son échéance (#${followup.id})`, lead.id, followup.id)
    p.tree.refreshStatus(lead.id)
    n++
  }
  return n
}
