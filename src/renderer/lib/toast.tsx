// Toasts: a tiny store plus a <Toaster/> viewport. Written in-house instead of a library because the strict CSP
// (`style-src 'self'`) forbids libraries that inject a <style> tag at runtime. Everything is Tailwind classes.
import { CircleAlert, CircleCheck, FlaskConical, Info, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { t } from '../../shared/fr'
import { cn } from '@/lib/utils'

export type ToastKind = 'info' | 'success' | 'error' | 'demo'

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
}

type Listener = () => void

let items: readonly ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const l of listeners) l()
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  items = items.filter((x) => x.id !== id)
  emit()
}

export function pushToast(kind: ToastKind, title: string, description?: string, ms = 5000): number {
  const id = nextId++
  items = [...items.slice(-3), { id, kind, title, ...(description ? { description } : {}) }]
  if (ms > 0) timers.set(id, setTimeout(() => dismissToast(id), ms))
  emit()
  return id
}

/** Removes every toast (tests). */
export function clearToasts(): void {
  for (const id of [...timers.keys()]) dismissToast(id)
  items = []
  emit()
}

export const toast = {
  info: (title: string, description?: string) => pushToast('info', title, description),
  success: (title: string, description?: string) => pushToast('success', title, description),
  error: (title: string, description?: string) => pushToast('error', title, description, 8000),
  /** Every demo action ends here: nothing was sent, nothing was spent. */
  demo: () => pushToast('demo', t('demo.nothingDone'))
}

function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = (): readonly ToastItem[] => items

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert, demo: FlaskConical } as const
const TONE: Record<ToastKind, string> = {
  info: 'text-info',
  success: 'text-ok',
  error: 'text-err',
  demo: 'text-brand-fg'
}

export function ToastList({ toasts, onDismiss }: { toasts: readonly ToastItem[]; onDismiss?: (id: number) => void }) {
  return (
    <ol className="pointer-events-none flex flex-col gap-2" aria-live="polite">
      {toasts.map((x) => {
        const Icon = ICONS[x.kind]
        return (
          <li
            key={x.id}
            role="status"
            data-testid="toast"
            data-kind={x.kind}
            className="fade-in pointer-events-auto flex w-[340px] items-start gap-3 glass rounded-card border border-line-2 p-3 shadow-[var(--shadow-pop)]"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', TONE[x.kind])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-fg">{x.title}</p>
              {x.description && <p className="mt-0.5 text-xs text-fg-3">{x.description}</p>}
            </div>
            <button
              type="button"
              aria-label={t('toast.close')}
              className="no-drag rounded-chip p-0.5 text-fg-4 transition-colors hover:text-fg"
              onClick={() => onDismiss?.(x.id)}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Mount once near the root. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => clearToasts, [])
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100]" data-testid="toaster">
      <ToastList toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
