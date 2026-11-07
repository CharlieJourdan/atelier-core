// Atelier's own small building blocks (PLAN-V2 §7.3): Panel, StatTile, StatusDot, StateChip, AgentDot, EmptyState.
import type * as React from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { cn } from '@/lib/utils'

export function Panel({
  title,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & { title?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section
      data-slot="panel"
      className={cn('rounded-card border border-line bg-surface-1 p-4', className)}
      {...props}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="micro-label">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  className
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  className?: string
}) {
  return (
    <div data-slot="stat-tile" className={cn('flex flex-col gap-1 rounded-card border border-line bg-surface-1 p-4', className)}>
      <span className="micro-label">{label}</span>
      <span className="font-serif text-[34px] leading-none">{value}</span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </div>
  )
}

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'off'

const TONE_BG: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  info: 'bg-info',
  off: 'bg-fg-4'
}

export function StatusDot({ tone, label, pulse = false, className }: { tone: Tone; label?: string; pulse?: boolean; className?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-tone={tone}
      className={cn('inline-block size-2 rounded-full', TONE_BG[tone], pulse && 'animate-pulse', className)}
    />
  )
}

export type AgentState = 'working' | 'waiting' | 'blocked' | 'idle' | 'done' | 'error'

const STATE_META: Record<AgentState, { tone: Tone; label: MessageKey }> = {
  working: { tone: 'info', label: 'state.working' },
  waiting: { tone: 'warn', label: 'state.waiting' },
  blocked: { tone: 'err', label: 'state.blocked' },
  idle: { tone: 'off', label: 'state.idle' },
  done: { tone: 'ok', label: 'state.done' },
  error: { tone: 'err', label: 'state.error' }
}

/** Small state pill: a status dot and its word. */
export function StateChip({ state, className }: { state: AgentState; className?: string }) {
  const meta = STATE_META[state]
  return (
    <span
      data-slot="state-chip"
      data-state={state}
      className={cn('inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-2 py-0.5 text-[11px] text-fg-2', className)}
    >
      <StatusDot tone={meta.tone} pulse={state === 'working'} />
      {t(meta.label)}
    </span>
  )
}

/** The 8 agent colour pairs (PLAN-V2 §7.1), used by the static CSS orb and by the real Orb. */
export const AGENT_COLORS: readonly (readonly [string, string])[] = [
  ['#B7A8FF', '#F5A3D0'],
  ['#8FF0C8', '#6FD6F2'],
  ['#FFC27A', '#FF8F7A'],
  ['#7FB2FF', '#A98BFF'],
  ['#B9D1A0', '#8FA06A'],
  ['#8FD0FF', '#D6EEFF'],
  ['#FFD0B0', '#E8D3A8'],
  ['#B9BCC6', '#E4E6EC']
]

export function agentColors(index: number): readonly [string, string] {
  return AGENT_COLORS[((index % AGENT_COLORS.length) + AGENT_COLORS.length) % AGENT_COLORS.length] ?? AGENT_COLORS[0]!
}

/** A static CSS orb for lists: the WebGL Orb is too costly to repeat. */
export function AgentDot({ index, size = 28, className }: { index: number; size?: number; className?: string }) {
  const [a, b] = agentColors(index)
  return (
    <span
      data-slot="agent-dot"
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 28%, rgba(255,255,255,.85), ${a} 38%, ${b} 100%)`,
        boxShadow: `0 0 ${Math.round(size / 2)}px -${Math.round(size / 6)}px ${b}`
      }}
    />
  )
}

export function EmptyState({
  title,
  blurb,
  action,
  className
}: {
  title: string
  blurb?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}
    >
      <WorkbenchMark />
      <p className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-fg">{title}</p>
      {blurb && <p className="max-w-[44ch] text-[13px] text-fg-3">{blurb}</p>}
      {action}
    </div>
  )
}

/** Empty-state illustration: a set square and a circle (the "workbench" motif). */
export function WorkbenchMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden className="text-fg-4">
      <path d="M10 8v38h38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 46 46 10v36z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity=".55" />
      <circle cx="34" cy="34" r="7" stroke="var(--brand)" strokeWidth="1.5" />
    </svg>
  )
}
