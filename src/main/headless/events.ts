// The headless host's stand-in for `webContents.send`: the core's notify/emitStream publish here, every open
// `GET /events` stream subscribes.
import type { EventContract, EventName } from '../../shared/api'

export type HubListener = <E extends EventName>(event: E, payload: EventContract[E]) => void

export class EventHub {
  private readonly listeners = new Set<HubListener>()

  subscribe(fn: HubListener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  publish<E extends EventName>(event: E, payload: EventContract[E]): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(event, payload)
      } catch {
        // one broken stream never stops the others
      }
    }
  }

  get size(): number {
    return this.listeners.size
  }
}
