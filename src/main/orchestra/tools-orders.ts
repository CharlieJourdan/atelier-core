// Atlas's tools for Charlie's video orders (equipe-3-chaines): `videos.order` makes the videos of « lance-moi 3 vidéos, une
// par chaîne, avec ces scripts » from Charlie's OWN message (read from the chat, never retyped by the model, so each script
// reaches its pipeline word for word), `videos.orders` says where they stand. The making, the final check, the fix and the
// notification are code (orders/index.ts): nothing waits on a turn.
import { parseOrder, type OrderItem } from './orders/parse'
import type { OrderView, VideoOrders } from './orders'
import { int, num, opt, type Handler, type ToolCtx } from './tool-args'
import { truncate } from './util'

function orders(c: ToolCtx): VideoOrders {
  const o = c.env.orders
  if (!o) throw new Error('Video orders are not available here')
  return o
}

/** Charlie's own message that woke this task (an owner message), or null. */
export function ownerMessage(c: ToolCtx): string | null {
  const id = c.task.payload.messageId
  if (typeof id !== 'number') return null
  const r = c.env.db.prepare("SELECT body FROM messages WHERE id = ? AND author_type = 'owner'").get(id) as { body: string } | undefined
  return r?.body ?? null
}

function channels(c: ToolCtx): { id: number; name: string }[] {
  return c.env.db.prepare('SELECT id, name FROM channels ORDER BY id').all() as { id: number; name: string }[]
}

const line = (o: OrderView): string => `#${o.id} ${o.channelName} « ${truncate(o.title, 70)} » — ${o.status}${o.runId ? ` (run #${o.runId})` : ''}${o.error ? ` : ${truncate(o.error, 160)}` : ''}`

export const ORDER_TOOLS: Record<string, Handler> = {
  'videos.order': async (c, a) => {
    const done = c.effect('videos-order')
    if (typeof done === 'string') return `Already ordered in this task (batch ${done}): videos_orders shows where they stand.`
    const real = a.real === undefined ? true : a.real === true
    if (a.real !== undefined && typeof a.real !== 'boolean') throw new Error('real: true or false')
    const maxUsd = a.maxUsd === undefined ? undefined : num(a.maxUsd, 'maxUsd', 0, 50)
    if (real && maxUsd === undefined) throw new Error('A real order needs maxUsd (the most one video may cost): ask Charlie if he did not say it, or order demos (real: false)')
    let items: OrderItem[]
    const list = channels(c)
    if (Array.isArray(a.items) && a.items.length > 0) {
      // scripts given by channel; their text must be Charlie's own words: each one is looked up in his message
      const message = ownerMessage(c)
      if (!message) throw new Error('No message of Charlie in this task: his scripts can only come from his own message (ask him to paste them, each under its channel name)')
      const flat = (s: string): string => s.replace(/\s+/g, ' ').trim()
      items = a.items.map((x, i) => {
        if (typeof x !== 'object' || x === null) throw new Error(`items[${i}] must be an object`)
        const it = x as Record<string, unknown>
        const ch = list.find((l) => l.id === int(it.channel, `items[${i}].channel`))
        if (!ch) throw new Error(`items[${i}]: no channel #${String(it.channel)}`)
        const script = opt(it.script, `items[${i}].script`, 60_000)
        if (!script) throw new Error(`items[${i}].script is missing`)
        if (!flat(message).includes(flat(script))) throw new Error(`items[${i}].script is not in Charlie's message: never rewrite his script; call videos_order with fromMessage instead`)
        return { channelId: ch.id, channelName: ch.name, title: opt(it.title, `items[${i}].title`, 200) ?? null, script }
      })
    } else {
      const message = ownerMessage(c)
      if (!message) throw new Error('No message of Charlie in this task to read the scripts from: ask him to paste them, each under its channel name')
      const parsed = parseOrder(message, list)
      if (parsed.items.length === 0) throw new Error(`No script found in Charlie's message: ${parsed.problems.join('; ')}. Channels: ${list.map((l) => l.name).join(', ')}`)
      items = parsed.items
      if (parsed.problems.length > 0) c.env.events.add('order', `commande lue avec des manques : ${parsed.problems.join('; ')}`, c.agent.id, c.task.id)
    }
    const placed = await orders(c).place({ items, real, ...(maxUsd !== undefined ? { maxUsdEach: maxUsd } : {}), batch: `task-${c.task.id}` })
    c.remember('videos-order', placed[0]?.batch ?? '')
    return [
      `${placed.length} video(s) ordered (${real ? `REAL, at most ${maxUsd?.toFixed(2)} $ each` : 'demo, nothing spent'}). Each is made on its channel's pipeline with Charlie's script word for word (its [PUB] marker becomes the channel's promo), checked (blocking checks, edit review, blind judge), fixed once if a real error is measured, then Charlie is told in his inbox. Nothing to do for you but tell him; videos_orders shows where they stand.`,
      ...placed.map(line)
    ].join('\n')
  },
  'videos.orders': (c, a) => {
    const batch = opt(a.batch, 'batch', 80)
    const all = orders(c).list(batch)
    if (all.length === 0) return 'No video order yet.'
    return all.slice(0, 30).map(line).join('\n')
  }
}

