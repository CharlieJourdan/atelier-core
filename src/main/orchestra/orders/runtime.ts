// The orders inside the agent runtime (equipe-3-chaines): built from the app's order services when production is wired;
// what an order says goes in the channel's room and in Atlas's conversation (said by Atlas), its money is read against the
// channel's confirmed monthly budget.
import type { RuntimeParts } from '../parts'
import { VideoOrders } from '.'

function say(p: RuntimeParts, channelId: number, text: string): void {
  try {
    p.messaging.system(p.messaging.conversationFor('channel', channelId, null), text)
    const principal = p.tree.principal()
    const conv = p.messaging.conversationFor('principal', null, null)
    if (principal) p.messaging.post(principal, conv, text, 99)
    else p.messaging.system(conv, text)
  } catch {
    // chat unavailable (closing)
  }
}

/** The channel's monthly budget left in dollars (its goals minus this month's runs), null without confirmed goals. */
function budgetLeftUsd(p: RuntimeParts, channelId: number, usdPerCredit: number): number | null {
  const goals = p.goals.get(channelId)
  if (!goals) return null
  const month = new Date(p.now()).toISOString().slice(0, 7)
  const runs = p.services.production?.list({ channelId, limit: 200 }) ?? []
  const spent = runs.filter((r) => (r.startedAt ?? r.createdAt).slice(0, 7) === month).reduce((n, r) => n + r.spentCredits, 0)
  return (goals.budgetCredits - spent) * usdPerCredit
}

export function ordersOf(p: RuntimeParts, notify: () => void): VideoOrders | null {
  const s = p.services.orders
  if (!s) return null
  return new VideoOrders({
    db: p.db,
    now: p.now,
    events: p.events,
    inbox: p.inbox,
    production: s.production,
    finalPass: s.finalPass,
    say: (channelId, text) => say(p, channelId, text),
    budgetLeftUsd: (channelId) => budgetLeftUsd(p, channelId, s.usdPerCredit()),
    notify
  })
}
