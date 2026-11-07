// When no subscription account works (every login expired, none connected), and when one works again. The chat never
// stays silent: a message to an agent gets an answer at once saying what to click (Réglages › Claude › Reconnecter),
// and the message is kept. When an account works again (a good « Vérifier »), the tasks that waited go at once, and the
// ones a dead login stopped before this rule existed (dead letters of the last day) go back to the queue by themselves.
import type { OrchTask } from '../../shared/api/orchestra'
import { t } from '../../shared/fr'
import { detectAuthFailure } from './limits'
import type { RuntimeParts } from './parts'

const REVIVE_WINDOW_MS = 86_400_000

/** The French answer of the chat when no subscription works, naming the accounts to reconnect. */
export function noAccountText(p: RuntimeParts): string {
  const labels = p.accounts.needsReconnect().map((a) => a.label)
  return t('llmAccess.chat.noAccount', { who: labels.length ? t('llmAccess.chat.who', { labels: labels.join(' », « ') }) : '' })
}

/** Says it in a conversation, as the agent the message was for (else the principal, else a system line). */
export function sayNoAccount(p: RuntimeParts, task: OrchTask | null): void {
  const conv = typeof task?.payload.conversationId === 'number' ? task.payload.conversationId : null
  const text = noAccountText(p)
  p.events.add('blocked', text, task?.assigneeId ?? null, task?.id ?? null)
  try {
    const conversationId = conv ?? p.messaging.conversationFor('principal', null, null)
    const agent = task ? p.tree.get(task.assigneeId) : p.tree.principal()
    if (agent) p.messaging.post(agent, conversationId, text, 99)
    else p.messaging.system(conversationId, text)
  } catch {
    // chat unavailable (closing)
  }
}

/** An account works again: the tasks waiting for accounts go now, and recent dead letters of a dead login are retried. */
export function accountsBack(p: RuntimeParts): number {
  p.db.prepare(`UPDATE orch_tasks SET not_before = ? WHERE status = 'waiting' AND wait_reason = 'accounts'`).run(new Date(p.now()).toISOString())
  p.queue.wakeParked()
  return reviveAuthDead(p)
}

/** Dead letters of the last day whose last error was a dead login: back to the queue, attempts reset. */
export function reviveAuthDead(p: RuntimeParts): number {
  if (p.accounts.usableSubscriptions().length === 0) return 0
  const since = new Date(p.now() - REVIVE_WINDOW_MS).toISOString()
  const rows = p.db.prepare(`SELECT id, error FROM orch_tasks WHERE status = 'dead' AND updated_at >= ?`).all(since) as { id: number; error: string | null }[]
  let n = 0
  for (const r of rows) {
    if (!r.error || !detectAuthFailure(r.error)) continue
    const task = p.queue.retry(r.id)
    p.tree.setError(task.assigneeId, false)
    p.events.add('retry', `#${r.id} stopped by a dead login: back in the queue now that an account works`, task.assigneeId, r.id)
    n++
  }
  return n
}
