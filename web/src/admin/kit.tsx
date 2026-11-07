import { createContext, useCallback, useContext, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { Dot, cx } from '../ui'

/* ------------------------------------------------------------------ layout bits */

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-[24px] font-semibold leading-[1.2] tracking-[-0.022em]">{title}</h1>
        {sub && <p className="m-0 mt-1 max-w-[680px] text-[14px] text-fg-3">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({ title, sub, actions, children, className, flush = false }: { title?: string; sub?: string; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx('card', className)} style={{ borderRadius: 16 }}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h2 className="m-0 text-[15px] font-semibold tracking-[-0.014em]">{title}</h2>}
            {sub && <p className="m-0 mt-0.5 text-[13px] text-fg-3">{sub}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? 'pt-3' : 'p-5 pt-4'}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, delta, tone }: { label: string; value: string; delta?: string; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div className="px-5 py-4">
      <p className="m-0 text-[13px] text-fg-3">{label}</p>
      <p className="num m-0 mt-1 text-[28px] font-medium leading-[1.1] tracking-[-0.02em]">{value}</p>
      {delta && <p className={cx('num m-0 mt-1 text-[12px]', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'err' ? 'text-err' : 'text-fg-3')}>{delta}</p>}
    </div>
  )
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="card grid overflow-hidden sm:grid-cols-2 xl:grid-cols-4 [&>*]:border-b [&>*]:border-line xl:[&>*]:border-b-0 xl:[&>*+*]:border-l xl:[&>*+*]:border-line" style={{ borderRadius: 16 }}>
      {children}
    </div>
  )
}

export type StatusTone = 'ok' | 'warn' | 'err' | 'info' | 'idle'
export function Status({ tone, children, pulse }: { tone: StatusTone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-2">
      <Dot tone={tone} pulse={pulse} />
      {children}
    </span>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  )
}
export const th = 'whitespace-nowrap border-b border-line-2 px-4 py-2.5 text-left text-[12px] font-medium text-fg-3'
export const td = 'whitespace-nowrap border-b border-line px-4 py-2.5 text-fg-2'

/* ------------------------------------------------------------------ fields */

const FIELD =
  'rounded-[10px] border border-line-2 bg-surface-1 px-3 text-[13px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-3 hover:border-line-3 focus-visible:border-ink/55 focus-visible:ring-4 focus-visible:ring-ink/10'

/** Fields fill their container unless the caller sets a width. */
const widthOf = (className?: string): string => (className && /(^|\s)w-/.test(className) ? '' : 'w-full')

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, 'h-9', widthOf(className), className)} {...rest} />
}
export function SelectInput({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(FIELD, 'h-9 pr-8', widthOf(className), className)} {...rest}>
      {children}
    </select>
  )
}
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, 'min-h-[88px] py-2 leading-[1.5]', widthOf(className), className)} {...rest} />
}
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-fg-2">
      {children}
    </label>
  )
}

export function Chip2({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium transition-colors',
        active ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'
      )}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ toast */

const ToastCtx = createContext<(msg: string) => void>(() => undefined)
export const useToast = (): ((msg: string) => void) => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([])
  const nextId = useRef(1)
  const push = useCallback((msg: string) => {
    const id = nextId.current++
    setItems((s) => [...s.slice(-2), { id, msg }])
    window.setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="rise pointer-events-auto flex w-[min(420px,100%)] items-center gap-2.5 rounded-[12px] border border-line-2 bg-surface-pop px-4 py-3 text-[13px] shadow-[var(--shadow-pop)]">
            <Dot tone="ok" />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ------------------------------------------------------------------ drawer and dialog */

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

/** Non-modal inspector: floating sheet on the right, the page behind stays usable. */
export function Drawer({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <aside
      role="complementary"
      aria-label={title}
      className="rise fixed bottom-2 right-2 top-2 z-50 flex w-[min(460px,calc(100vw-16px))] flex-col overflow-hidden rounded-[16px] border border-line-2 bg-surface-pop shadow-[var(--shadow-pop)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[16px] font-semibold tracking-[-0.014em]">{title}</h2>
          {sub && <p className="m-0 truncate text-[13px] text-fg-3">{sub}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-fg-2 hover:bg-hover hover:text-fg">
          <X size={16} strokeWidth={1.5} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

export function Dialog({ title, onClose, children, footer, wide = false }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--scrim)]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="rise relative flex max-h-[min(760px,calc(100vh-32px))] w-full flex-col rounded-[20px] border border-line-2 bg-surface-pop shadow-[var(--shadow-modal)]"
        style={{ maxWidth: wide ? 760 : 460 }}
      >
        <h2 className="m-0 px-6 pt-6 text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        <footer className="flex justify-end gap-2 px-6 pb-6 pt-2">{footer}</footer>
      </div>
    </div>
  )
}
