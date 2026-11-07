// Small shared atoms of the three team screens. Token-driven; colour only from status semantics.
import type * as React from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { MODEL_LABEL, restOf } from '@/proto/data-team-agents'
import { cn } from '@/lib/utils'
import type { AgentStatus, ModelTier } from '@/proto/types'

export function ModelChip({ model, className }: { model: ModelTier; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full border border-line-2 px-2 text-[11px] font-medium text-fg-2', className)}>
      {MODEL_LABEL[model]}
    </span>
  )
}

export function NewTag({ className }: { className?: string }) {
  return (
    <span data-testid="agent-new-tag" className={cn('rounded-full bg-ink px-1.5 py-px text-[10px] leading-4 font-semibold text-ink-fg', className)}>
      {t('team.new')}
    </span>
  )
}

const DOT: Record<AgentStatus, string> = { working: 'bg-ok', idle: 'bg-fg-4', sleeping: 'bg-fg-4/50', waiting: 'bg-warn' }

export function StatusText({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] text-fg-2', className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT[status])} />
      {t(`agentStatus.${status}` as MessageKey)}
    </span>
  )
}

/** A thin load bar: ink while comfortable, warn from 80 %, err from 92 %. */
export function LoadBar({ value, className }: { value: number; className?: string }) {
  const tone = value >= 92 ? 'bg-err' : value >= 80 ? 'bg-warn' : 'bg-ink'
  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t('team.load')}
      className={cn('block h-[3px] w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
    </span>
  )
}

export function restLabel(load: number): string {
  return t(`team.rest.${restOf(load)}` as MessageKey)
}

/** A bordered block on the card surface. */
export function Card({ className, children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-[16px] border border-line-2 bg-surface-1', className)} {...rest}>
      {children}
    </div>
  )
}

export function BlockTitle({ title, hint, action, className }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-fg-3">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/** The pill segmented control of the kit, with a test id per option (the kit's one has none). */
export function ViewTabs<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: readonly { value: T; label: React.ReactNode; testId: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              on ? 'bg-surface-pop text-fg shadow-[var(--shadow-1)] ring-1 ring-line-2' : 'text-fg-3 hover:text-fg'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
