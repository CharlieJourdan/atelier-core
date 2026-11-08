// The demo bridge (dist-demo/, `npm run demo:web`): `window.atelier` answered entirely in the browser from fictional data.
// No network, no Cloud, no team computer. Each domain file of this folder gives typed handlers (`DemoHandlers`); a call no
// handler knows gets a calm default from its name (lists empty, actions accepted) and is noted in `window.__demoMissing`
// so a tour can list what still lacks a fixture. Progress is "streamed" by emitting the same events as the desktop app.
import { toast } from '@/lib/toast'
import type { ApiArgs, ApiMethod, ApiResult, ChangeTopic, EventContract, EventName } from '../../../shared/api'

export type DemoHandlers = Partial<{ [M in ApiMethod]: (...args: ApiArgs<M>) => ApiResult<M> | Promise<ApiResult<M>> }>

type Listener = (payload: unknown) => void

const listeners = new Map<string, Set<Listener>>()

export function emit<E extends EventName>(event: E, payload: EventContract[E]): void {
  for (const l of listeners.get(event) ?? []) l(payload)
}

/** Tells the screens that a topic changed (they reload what they show). */
export function changed(...topics: ChangeTopic[]): void {
  for (const topic of topics) emit('atelier:changed', { topic })
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Read-like method names: an empty list is the calm answer. */
const LIST_RE = /(^|\.)(list|entries|history|runs|members|devices|guilds|profiles|accounts|tasks|inbox|routines|memory|rooms|conversations|messages|references|revenues|sponsors|offers|packs|voices|outliers|catalog|templates|bases|technologies|thread|activity|rules|goals|pending|options|files)$/i

/** Read-like names that are not lists: nothing to show, silently. */
const READ_RE = /^(get|status|info|overview|summary|balance|state|loginState|profile|account|power|report|progress|engineStatus|catalog|spend|usage|claudeUsage|machine|onboarding)$/i

function fallback(method: string): unknown {
  const last = method.split('.').pop() ?? ''
  if (LIST_RE.test(last)) return []
  // an action no fixture covers: accepted, and said so, so no button looks dead
  if (!READ_RE.test(last)) toast.demo()
  return null
}

declare global {
  interface Window {
    /** Methods the demo answered by default (no fixture yet), for the tour. */
    __demoMissing?: Record<string, number>
  }
}

export function createDemoBridge(handlers: DemoHandlers): Window['atelier'] & { web: true; demo: true } {
  const table = handlers as Record<string, ((...args: unknown[]) => unknown) | undefined>
  const missing: Record<string, number> = {}
  window.__demoMissing = missing
  return {
    web: true,
    demo: true,
    call: ((method: string, ...args: unknown[]): Promise<unknown> => {
      const fn = table[method]
      if (fn) return Promise.resolve().then(() => fn(...args))
      missing[method] = (missing[method] ?? 0) + 1
      return Promise.resolve(fallback(method))
    }) as Window['atelier']['call'],
    on: ((event: string, listener: Listener): (() => void) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    }) as Window['atelier']['on']
  }
}
