// A production run ended (agents-production): the team hears of it. A failure lands in the inbox as an alert with the
// French reason, in the channel's room and in Atlas's conversation (the principal says it), and the planner looks again
// at once (its production step waits for the run, planner.ts). A success or a cancel is said in the channel's room.
// Never throws: the run is finished either way.
import type { RunFinished } from '../production/runs/video-status'
import type { RuntimeParts } from './parts'
import { PLANNER_LAST_RUN } from './planner'
import { truncate } from './util'

export function productionNews(p: RuntimeParts, e: RunFinished): void {
  try {
    const channel = (p.db.prepare('SELECT name FROM channels WHERE id = ?').get(e.channelId) as { name: string } | undefined)?.name ?? `#${e.channelId}`
    const lead = p.tree.bySlug(`lead-${e.channelId}`)
    const what = `« ${truncate(e.title, 120)} » (${channel}${e.demo ? ', démo' : ''})`
    // the planner's production step waits for this run: the next pass looks now
    p.settings.set(PLANNER_LAST_RUN, null)
    if (e.status === 'failed') {
      const reason = e.error ?? 'La fabrication s’est arrêtée sur une erreur.'
      const text = `La fabrication de ${what} a échoué : ${reason}`
      p.events.add('production', text, lead?.id)
      p.inbox.add({
        taskId: null,
        agentId: lead?.id ?? null,
        channelId: e.channelId,
        kind: 'alert',
        title: `Fabrication en échec · ${channel} · ${truncate(e.title, 80)}`,
        body: `${reason}\n\nRelance-la depuis Production (« Relancer ») une fois la cause réglée : les étapes déjà faites sont gardées.`
      })
      say(p, e.channelId, text)
      return
    }
    const text = e.status === 'succeeded' ? `La fabrication de ${what} est finie.` : `La fabrication de ${what} a été arrêtée.`
    p.events.add('production', text, lead?.id)
    say(p, e.channelId, text, false)
  } catch {
    // closing, or the chat is unavailable
  }
}

/** In the channel's room; a failure also in Atlas's conversation, said by the principal. */
function say(p: RuntimeParts, channelId: number, text: string, toAtlas = true): void {
  try {
    p.messaging.system(p.messaging.conversationFor('channel', channelId, null), text)
    if (!toAtlas) return
    const principal = p.tree.principal()
    const conv = p.messaging.conversationFor('principal', null, null)
    if (principal) p.messaging.post(principal, conv, text, 99)
    else p.messaging.system(conv, text)
  } catch {
    // chat unavailable (closing)
  }
}
