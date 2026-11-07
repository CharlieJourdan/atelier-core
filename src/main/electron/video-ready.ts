// The desktop toast when an ordered video is ready or not delivered (equipe-3-chaines). It reads the orders through the same
// call path as the screens (`orders.list`), so it works with the local brain AND with the team computer's brain the app is
// linked to; only orders told after the app started are toasted, each once. Clicking opens the inbox.
import { Notification } from 'electron'
import type { OrderView } from '../../shared/api/orders'

/** The orders to toast now (pure): told after `since`, not toasted yet. */
export function toToast(list: readonly OrderView[], since: string, seen: ReadonlySet<number>): OrderView[] {
  return list.filter((o) => o.notifiedAt !== null && o.notifiedAt >= since && !seen.has(o.id) && (o.status === 'ready' || o.status === 'failed'))
}

export function toastText(o: OrderView): { title: string; body: string } {
  return o.status === 'ready'
    ? { title: `Vidéo prête · ${o.channelName}`, body: `« ${o.title} » est vérifiée et prête.${o.report?.judge ? ` Juge : ${o.report.judge.score}/100.` : ''}` }
    : { title: `Vidéo non livrée · ${o.channelName}`, body: `« ${o.title} » : ${o.error ?? 'voir la boîte de réception'}` }
}

const live = new Set<Notification>()

export function watchVideoReady(o: { list: () => Promise<OrderView[]>; onClick: () => void; intervalMs?: number }): () => void {
  // the brain may run on another computer (its clock): what was told before the app started is what its first list holds
  let since: string | null = null
  const seen = new Set<number>()
  let busy = false
  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const list = await o.list()
      if (since === null) {
        for (const x of list) if (x.notifiedAt !== null) seen.add(x.id)
        since = ''
      }
      for (const ord of toToast(list, since, seen)) {
        seen.add(ord.id)
        if (!Notification.isSupported()) continue
        const n = new Notification(toastText(ord))
        live.add(n)
        n.on('click', () => {
          live.delete(n)
          o.onClick()
        })
        n.on('close', () => live.delete(n))
        n.show()
      }
    } catch {
      // no brain yet, or orders not available there
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void tick(), o.intervalMs ?? 30_000)
  timer.unref?.()
  return () => clearInterval(timer)
}
