// `window.atelier` over HTTP, for a renderer with no main process of its own (the web app): calls go to the team
// computer's brain (`POST /rpc`), events come from its `GET /events` stream. Same unwrapping as the preload, so `call`
// in state/client.ts and every screen work unchanged. No DOM API here: Node tests use this exact module.
import type { ApiArgs, ApiMethod, ApiResult, AtelierBridge, EventContract, EventName } from '../../shared/api'
import { brainCall, openBrainEvents, type BrainEndpoint, type BrainEventsState, type FetchLike } from '../../shared/brain-client'

type Listener = (payload: unknown) => void
type LocalHandler = (...args: never[]) => unknown

export interface RemoteBridgeOptions {
  fetchImpl?: FetchLike
  /** Methods answered in the page itself (the link's own status, the window theme…). */
  local?: Partial<Record<ApiMethod, LocalHandler>>
  onState?: (state: BrainEventsState) => void
  retryMs?: (attempt: number) => number
}

export interface RemoteBridge extends AtelierBridge {
  /** Set on this bridge: the page talks to a remote brain. */
  readonly remote: true
  readonly url: string
  /** Delivers an event raised in the page itself (e.g. the link's state changed) to the listeners. */
  emit<E extends EventName>(event: E, payload: EventContract[E]): void
  close(): void
}

export function createRemoteBridge(ep: BrainEndpoint, opts: RemoteBridgeOptions = {}): RemoteBridge {
  const listeners = new Map<EventName, Set<Listener>>()
  let stream: { close(): void } | null = null
  const deliver = (event: EventName, payload: unknown): void => {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
  }
  const ensureStream = (): void => {
    if (stream) return
    stream = openBrainEvents(
      ep,
      (event, payload) => deliver(event, payload),
      {
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.onState ? { onState: opts.onState } : {}),
        ...(opts.retryMs ? { retryMs: opts.retryMs } : {})
      }
    )
  }
  return {
    remote: true,
    url: ep.url,
    async call<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiResult<M>> {
      const local = opts.local?.[method]
      if (local) return (await (local as (...a: unknown[]) => unknown)(...args)) as ApiResult<M>
      const envelope = await brainCall(ep, method, args, opts.fetchImpl)
      if (envelope.ok) return envelope.value as ApiResult<M>
      const err = new Error(envelope.error.message)
      err.name = envelope.error.code
      throw err
    },
    on<E extends EventName>(event: E, listener: (payload: EventContract[E]) => void): () => void {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener as Listener)
      listeners.set(event, set)
      ensureStream()
      return () => {
        set.delete(listener as Listener)
      }
    },
    emit(event, payload) {
      deliver(event, payload)
    },
    close(): void {
      stream?.close()
      stream = null
      listeners.clear()
    }
  }
}
