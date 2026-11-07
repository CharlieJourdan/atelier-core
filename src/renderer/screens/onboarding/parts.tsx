// Small building blocks shared by the onboarding steps and the Chaînes detail view: the big question, selectable cards,
// the "who does what" matrix, inset groups, steppers and the products editor. Token-driven, no colour of their own.
import { Check, Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { agentColors } from '@/components/atelier/primitives'
import { Segmented } from '@/components/proto/kit'
import { Input, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AutomationLevels, AutomationMode, ChannelProduct } from '@/proto/types'
import './onboarding.css'

/* ---------- headings ---------- */

/** The big question of a step (Apple style): 32 px, tight, with a quiet helper line under it. */
export function Question({ title, hint, className, align = 'left' }: { title: string; hint?: ReactNode; className?: string; align?: 'left' | 'center' }) {
  return (
    <div className={cn('mb-7', align === 'center' && 'text-center', className)}>
      <h1 className="text-[32px] leading-[1.18] font-semibold tracking-[-0.03em] text-fg">{title}</h1>
      {hint && <p className="mt-2.5 text-[15px] leading-[1.5] text-fg-3">{hint}</p>}
    </div>
  )
}

/* ---------- selectable cards ---------- */

export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  badge,
  icon,
  testId,
  children,
  className,
  disabled
}: {
  selected: boolean
  onSelect: () => void
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  icon?: ReactNode
  testId?: string
  children?: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'relative rounded-[16px] border bg-surface-1 transition-[border-color,background-color] duration-150',
        selected ? 'border-ink ring-1 ring-ink' : 'border-line-2 hover:border-line-3',
        disabled && 'opacity-50',
        className
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        data-testid={testId}
        onClick={onSelect}
        className="flex w-full items-start gap-3.5 rounded-[16px] p-4 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {icon && <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-fg-2">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium tracking-[-0.01em] text-fg">{title}</span>
            {badge}
          </span>
          {description && <span className="mt-1 block text-[13px] leading-[1.5] text-fg-3">{description}</span>}
        </span>
        <span
          aria-hidden
          className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors', selected ? 'border-ink bg-ink text-ink-fg' : 'border-line-3')}
        >
          {selected && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
      {children}
    </div>
  )
}

export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium',
        tone === 'neutral' && 'bg-surface-3 text-fg-2',
        tone === 'ok' && 'bg-[var(--ok-soft)] text-ok',
        tone === 'warn' && 'bg-[var(--warn-soft)] text-warn',
        className
      )}
    >
      {children}
    </span>
  )
}

/* ---------- the agent orb ---------- */

/**
 * The big orb of the welcome step. The vendored WebGL Orb renders a hard "pinwheel" at this size with our procedural noise,
 * so the hero is a CSS sphere: two agent colours, a soft highlight, a slow turning sheen and a breathing scale (still
 * under prefers-reduced-motion).
 */
export function HeroOrb({ size = 168, colorIndex = 0 }: { size?: number; colorIndex?: number }) {
  const [a, b] = agentColors(colorIndex)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-testid="onboarding-orb" aria-hidden>
      <span className="absolute -inset-[22%] rounded-full opacity-35 blur-3xl" style={{ background: `radial-gradient(circle, ${b}, transparent 68%)` }} />
      <div className="onb-breathe absolute inset-0">
        <span className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle at 34% 26%, rgba(255,255,255,.95) 0, ${a} 34%, ${b} 100%)` }} />
        <span
          className="onb-spin absolute inset-0 rounded-full opacity-70 mix-blend-soft-light"
          style={{ background: 'conic-gradient(from 0deg, transparent 0, rgba(255,255,255,.8) 18%, transparent 38%, rgba(0,0,0,.35) 66%, transparent 85%)' }}
        />
        <span className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.22), inset -12px -18px 36px rgba(0,0,0,.22), inset 8px 10px 26px rgba(255,255,255,.18)' }} />
      </div>
    </div>
  )
}

/** A small static orb with the agent's colours (team assembly, lists). */
export function MiniOrb({ colorIndex, size = 40, className }: { colorIndex: number; size?: number; className?: string }) {
  const [a, b] = agentColors(colorIndex)
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), ${a} 40%, ${b} 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,.18), 0 0 ${Math.round(size / 2)}px -${Math.round(size / 5)}px ${b}`
      }}
    />
  )
}

/* ---------- inset groups (Apple settings) ---------- */

export function Group({ title, hint, children, testId, className }: { title: string; hint?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section data-testid={testId} className={cn('mb-9', className)}>
      <div className="mb-3 px-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-fg-3">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** The rounded container whose rows are separated by hairlines. */
export function Inset({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div data-testid={testId} className={cn('overflow-hidden rounded-[16px] border border-line-2 bg-surface-1 [&>*+*]:border-t [&>*+*]:border-line', className)}>{children}</div>
}

export function Row({ label, hint, children, className, testId }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={cn('flex min-h-[56px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5', className)}>
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-[14px] font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] leading-[1.45] text-fg-3">{hint}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/* ---------- controls ---------- */

export function Stepper({ value, onChange, min = 0, max = 99, label, testId }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; testId?: string }) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="inline-flex items-center gap-1 rounded-full bg-surface-2 p-0.5">
      <button
        type="button"
        aria-label={t('onb.stepper.less')}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex size-8 items-center justify-center rounded-full text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="num w-8 text-center text-[14px] font-medium text-fg">{value}</span>
      <button
        type="button"
        aria-label={t('onb.stepper.more')}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex size-8 items-center justify-center rounded-full text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/** A toggle chip (days of the week, feedback). */
export function Chip({ on, onClick, children, testId, className }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring',
        on ? 'border-ink bg-ink text-ink-fg' : 'border-line-2 bg-transparent text-fg-2 hover:bg-hover hover:text-fg',
        className
      )}
    >
      {children}
    </button>
  )
}

/* ---------- who does what ---------- */

export const AUTOMATION_KEYS = ['idea', 'script', 'production', 'packaging', 'publishing'] as const satisfies readonly (keyof AutomationLevels)[]

const STEP_LABELS: Record<(typeof AUTOMATION_KEYS)[number], { label: MessageKey; hint: MessageKey }> = {
  idea: { label: 'onb.q.step.idea', hint: 'onb.q.step.idea.hint' },
  script: { label: 'onb.q.step.script', hint: 'onb.q.step.script.hint' },
  production: { label: 'onb.q.step.production', hint: 'onb.q.step.production.hint' },
  packaging: { label: 'onb.q.step.packaging', hint: 'onb.q.step.packaging.hint' },
  publishing: { label: 'onb.q.step.publishing', hint: 'onb.q.step.publishing.hint' }
}

export function automationModes(): { value: AutomationMode; label: string }[] {
  return [
    { value: 'auto', label: t('automation.auto') },
    { value: 'validate', label: t('automation.validate') },
    { value: 'human', label: t('automation.human') }
  ]
}

/** The matrix steps × modes. Used by the onboarding and, editable, by the channel detail. */
export function AutomationMatrix({ value, onChange, testId = 'automation-matrix' }: { value: AutomationLevels; onChange: (next: AutomationLevels) => void; testId?: string }) {
  const options = automationModes()
  return (
    <Inset testId={testId}>
      {AUTOMATION_KEYS.map((key) => (
        <Row key={key} testId={`automation-${key}`} label={t(STEP_LABELS[key].label)} hint={t(STEP_LABELS[key].hint)}>
          <Segmented size="sm" value={value[key]} options={options} onChange={(mode) => onChange({ ...value, [key]: mode })} />
        </Row>
      ))}
    </Inset>
  )
}

/* ---------- products and sponsors ---------- */

export const PRODUCT_KINDS: readonly ChannelProduct['kind'][] = ['course', 'ebook', 'app', 'merch', 'sponsor', 'affiliate']

export function productKindLabel(kind: ChannelProduct['kind']): string {
  return t(`onb.product.kind.${kind}` as MessageKey)
}

export interface ProductLike {
  kind: ChannelProduct['kind']
  name: string
  url?: string | undefined
}

/** The list of products and sponsors, with the form that adds one. `detected` are the ones the agent found. */
export function ProductsEditor<T extends ProductLike>({
  items,
  onChange,
  detected = [],
  make
}: {
  items: T[]
  onChange: (next: T[]) => void
  detected?: { kind: ChannelProduct['kind']; name: string }[]
  make: (p: { kind: ChannelProduct['kind']; name: string; url: string }) => T
}) {
  const [kind, setKind] = useState<ChannelProduct['kind']>('course')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const pending = detected.filter((d) => !items.some((i) => i.name === d.name))
  const add = (): void => {
    if (!name.trim()) return
    onChange([...items, make({ kind, name: name.trim(), url: url.trim() })])
    setName('')
    setUrl('')
  }
  return (
    <div data-testid="products-editor">
      {pending.map((d) => (
        <div key={d.name} data-testid="product-detected" className="mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-dashed border-line-3 px-3.5 py-2.5">
          <span className="min-w-0 flex-1 text-[13px] text-fg-2">
            {t('onb.product.detected', { name: d.name })}
          </span>
          <button
            type="button"
            data-testid="product-detected-add"
            onClick={() => onChange([...items, make({ kind: d.kind, name: d.name, url: '' })])}
            className="rounded-full border border-line-3 px-3 py-1 text-[12.5px] font-medium text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t('onb.product.detected.add')}
          </button>
        </div>
      ))}
      {items.length > 0 && (
        <Inset className="mb-3">
          {items.map((p, i) => (
            <div key={`${p.name}-${i}`} data-testid="product-row" className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-[86px] shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-center text-[11.5px] font-medium text-fg-2">{productKindLabel(p.kind)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-fg">{p.name}</span>
                {p.url && <span className="block truncate text-[12px] text-fg-3">{p.url}</span>}
              </span>
              <button
                type="button"
                aria-label={t('onb.product.remove')}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="rounded-full p-1.5 text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </Inset>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('onb.product.type')} value={kind} onChange={(e) => setKind(e.target.value as ChannelProduct['kind'])} className="h-9 w-[140px] rounded-full">
          {PRODUCT_KINDS.map((k) => (
            <option key={k} value={k}>
              {productKindLabel(k)}
            </option>
          ))}
        </Select>
        <Input data-testid="product-name" aria-label={t('onb.product.name')} placeholder={t('onb.product.name')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} className="w-[200px] flex-1 rounded-full" />
        <Input data-testid="product-url" aria-label={t('onb.product.url')} placeholder={t('onb.product.url')} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} className="w-[180px] flex-1 rounded-full" />
        <button
          type="button"
          data-testid="product-add"
          disabled={!name.trim()}
          onClick={add}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-3 px-3.5 text-[13px] font-medium text-fg outline-none hover:bg-selected focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden />
          {t('onb.product.add')}
        </button>
      </div>
    </div>
  )
}

/* ---------- ticking ---------- */

/** Elapsed milliseconds since mount, updated every `every` ms until `until`; `skip()` jumps to the end. */
export function useElapsed(until: number, every = 100, speed = 1): { elapsed: number; skip: () => void; restart: () => void } {
  const [elapsed, setElapsed] = useState(0)
  const ref = useRef(0)
  useEffect(() => {
    if (elapsed >= until) return
    const id = setInterval(() => {
      ref.current = Math.min(until, ref.current + every * speed)
      setElapsed(ref.current)
      if (ref.current >= until) clearInterval(id)
    }, every)
    return () => clearInterval(id)
    // The effect restarts only when the run is over or restarted: `elapsed` is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until, every, speed, elapsed >= until])
  return {
    elapsed,
    skip: () => {
      ref.current = until
      setElapsed(until)
    },
    restart: () => {
      ref.current = 0
      setElapsed(0)
    }
  }
}
