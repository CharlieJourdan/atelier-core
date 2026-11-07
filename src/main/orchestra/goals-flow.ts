// What creating or importing a channel sets off for its goals (docs/AGENT-RUNTIME.md §25), once per channel: the baseline
// proposal (goals.ts), an item in Charlie's inbox to confirm it (or edit it on the channel sheet), and a task for the
// channel lead to analyse the channel and its competitors and refine the proposal (`goals.propose`) while Charlie has not
// confirmed it. The task waits in the queue while the team is off: switching the team on is Charlie's call.
import type { ChannelGoals } from '../../shared/api/autopilot'
import type { OrchInboxItem } from '../../shared/api/orchestra'
import type { RuntimeParts } from './parts'

export const CONFIRM_CHOICE = 'Confirmer'
export const EDIT_CHOICE = 'Je modifie dans la fiche'

export function goalsOnChannel(p: RuntimeParts, channelId: number, trigger: 'create' | 'import'): ChannelGoals {
  const { goals, created } = p.goals.propose(channelId, trigger)
  if (!created) return goals
  const name = (p.db.prepare('SELECT name FROM channels WHERE id = ?').get(channelId) as { name: string } | undefined)?.name ?? `#${channelId}`
  const lead = p.tree.bySlug(`lead-${channelId}`)
  const item = p.inbox.add({
    taskId: null,
    agentId: lead?.id ?? null,
    kind: 'validate',
    title: `Objectifs proposés · ${name}`,
    body: `${p.goals.block(channelId)}\n\n${goals.reasons}\n\nConfirme-les, ou modifie-les dans Chaînes › ${name} › Objectifs.`,
    options: [CONFIRM_CHOICE, EDIT_CHOICE]
  })
  p.goals.setInbox(channelId, item.id)
  if (lead) {
    const task = p.queue.enqueue({
      kind: 'goals',
      title: 'Analyser la chaîne et ses concurrents, proposer ses objectifs',
      assigneeId: lead.id,
      payload: {
        brief:
          (trigger === 'import'
            ? 'This channel was just imported (an existing YouTube channel). '
            : 'This channel was just created in Atelier. ') +
          'Analyse it and its competitors (channel_read, channel_outliers, style_profile; delegate to your competitor analyst if useful), ' +
          'then propose its standing goals with goals_propose: publication slots, formats and lengths, a monthly budget in credits, deadlines, and your reasons. ' +
          'The draft in your prompt is a baseline computed from what Atelier read. Charlie confirms or edits; never claim they are confirmed.'
      },
      priority: 5,
      channelId
    })
    p.events.add('goals', `${lead.name}: goals analysis queued (#${task.id})`, lead.id, task.id)
    p.tree.refreshStatus(lead.id)
  }
  return p.goals.get(channelId) as ChannelGoals
}

/** Charlie answered the « Objectifs proposés » item: « Confirmer » confirms them as they are now. */
export function goalsAnswered(p: RuntimeParts, item: OrchInboxItem): boolean {
  const row = p.db.prepare('SELECT channel_id FROM channel_goals WHERE inbox_id = ?').get(item.id) as { channel_id: number } | undefined
  if (!row) return false
  if (item.answer?.choice === CONFIRM_CHOICE) p.goals.save(row.channel_id, { confirm: true })
  return true
}

/** Confirmed from the channel sheet: the inbox item is closed with the same answer. */
export function closeGoalsItem(p: RuntimeParts, goals: ChannelGoals): void {
  if (goals.status !== 'confirmed' || goals.inboxId === null) return
  try {
    const item = p.inbox.get(goals.inboxId)
    if (item.status === 'open') p.inbox.answer(item.id, { choice: CONFIRM_CHOICE })
  } catch {
    // the item is gone
  }
}
