// Shared building blocks of the proto screens (2026-10-24 refresh). Small, token-driven, no colour of their own except
// the channel identity marks. Every new screen uses these so the app reads as one system.
import type * as React from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { agentColors } from '@/components/atelier/primitives'
import { useLookOverride } from '@/components/mascot/look-store'
import { Mascot } from '@/components/mascot/Mascot'
import { cn } from '@/lib/utils'
import { channelColorVar } from '@/proto/store'
import type { AgentStatus, ProtoAgent, ProtoChannel, StageId } from '@/proto/types'

/* ---------- formatting ---------- */

const nf = new Intl.NumberFormat('fr-FR')
export function fmtNum(n: number): string {
  return nf.format(n)
}

/** 12 400 → « 12,4 k », 2 410 000 → « 2,4 M ». */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
  return nf.format(n)
}

export function fmtEuro(n: number): string {
  return `${nf.format(Math.round(n))} €`
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtAgo(minutes: number): string {
  if (minutes < 1) return t('common.minutesAgo', { n: 0 })
  if (minutes < 60) return t('common.minutesAgo', { n: Math.round(minutes) })
  if (minutes < 60 * 24) return t('common.hoursAgo', { n: Math.round(minutes / 60) })
  return t('common.daysAgo', { n: Math.round(minutes / 1440) })
}

/** A day offset as a short label: Aujourd'hui, Demain, Hier, or « jeu. 30 oct. ». */
export function fmtDay(offset: number, today = new Date()): string {
  if (offset === 0) return t('common.today')
  if (offset === 1) return t('common.tomorrow')
  if (offset === -1) return t('common.yesterday')
  const d = new Date(today)
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function stageLabel(stage: StageId): string {
  return t(`stage.${stage}` as MessageKey)
}

/* ---------- identity marks ---------- */

export function ChannelAvatar({ channel, size = 24, className }: { channel: ProtoChannel | undefined; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="channel-avatar"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[#0a0a0a]', className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)), background: channelColorVar(channel) }}
    >
      {channel?.initials ?? '·'}
    </span>
  )
}

/** A 8 px dot of the channel colour followed by its name. */
export function ChannelTag({ channel, className }: { channel: ProtoChannel | undefined; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3', className)}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: channelColorVar(channel) }} />
      <span className="truncate">{channel?.name ?? '—'}</span>
    </span>
  )
}

const STATUS_DOT: Record<AgentStatus, string> = {
  working: 'bg-ok',
  idle: 'bg-fg-4',
  sleeping: 'bg-fg-4/50',
  waiting: 'bg-warn'
}

/**
 * An agent's face in lists, threads and sheets: its mascot (decision 0057) with an optional status dot. Without a role to
 * draw (a caller that only knows the colour) it stays the coloured bubble, the fallback.
 */
export function AgentAvatar({
  agent,
  size = 28,
  showStatus = true,
  className
}: {
  agent: Pick<ProtoAgent, 'colorIndex' | 'status' | 'name'> & Partial<Pick<ProtoAgent, 'id' | 'role' | 'look'>>
  size?: number
  showStatus?: boolean
  className?: string
}) {
  const [a, b] = agentColors(agent.colorIndex)
  const chosen = useLookOverride(agent.id)
  const look = chosen === undefined ? agent.look : chosen
  const dot = Math.max(7, Math.round(size * 0.28))
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }} aria-hidden data-slot="agent-avatar">
      {agent.role ? (
        <Mascot role={agent.role} look={look} colorIndex={agent.colorIndex} size={size} />
      ) : (
        <span
          className="inline-block size-full rounded-full"
          style={{ background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), ${a} 40%, ${b} 100%)` }}
        />
      )}
      {showStatus && (
        <span
          className={cn('absolute rounded-full ring-2 ring-bg', agent.role ? '-top-px -right-px' : '-right-px -bottom-px', STATUS_DOT[agent.status])}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  )
}

/* ---------- progress ---------- */

// the default tone (still named 'ink') fills with the green accent since decision 0041

export function ProgressBar({ value, className, tone = 'ink' }: { value: number; className?: string; tone?: 'ink' | 'warn' | 'ok' | 'err' }) {
  const fill = tone === 'ink' ? 'bg-brand' : tone === 'warn' ? 'bg-warn' : tone === 'ok' ? 'bg-ok' : 'bg-err'
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', fill)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

export function ProgressRing({ value, size = 28, stroke = 3, className, children }: { value: number; size?: number; stroke?: number; className?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  )
}

/* ---------- controls ---------- */

/** Apple-style pill segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md'
}: {
  value: T
  options: readonly { value: T; label: React.ReactNode }[]
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-8 px-3.5 text-[13px]',
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

/* ---------- media ---------- */

/** Generated thumbnail placeholder (no image assets in the demo): a quiet two-tone gradient and the format. */
export function Thumb({ hue, format = 'long', className, children }: { hue: number; format?: 'long' | 'short'; className?: string; children?: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn('relative shrink-0 overflow-hidden rounded-[10px] ring-1 ring-line', format === 'short' ? 'aspect-[9/16]' : 'aspect-video', className)}
      style={{
        background: `linear-gradient(135deg, oklch(0.42 0.06 ${hue}), oklch(0.22 0.03 ${(hue + 40) % 360}))`
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_70%_20%,rgba(255,255,255,.18),transparent_60%)]" />
      {children}
    </div>
  )
}

/* ---------- layout ---------- */

/** A section heading inside a page: title on the left, an optional action on the right. */
export function SectionHead({ title, count, action, className }: { title: string; count?: number; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.014em] text-fg">
        {title}
        {count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 py-px text-[11px] font-medium text-fg-3 num">{count}</span>}
      </h2>
      {action}
    </div>
  )
}

/** The standard page frame of the proto screens: a title row and a scrolling body with the content width capped. */
export function ProtoPage({
  testId,
  title,
  subtitle,
  actions,
  children,
  wide = false,
  className
}: {
  testId: string
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <section data-testid={testId} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn('mx-auto w-full px-8 pt-6 pb-12', wide ? 'max-w-[1440px]' : 'max-w-[1180px]', className)}>
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="page-title">{title}</h1>
              {subtitle && <p className="mt-1 text-[13px] text-fg-3">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </section>
  )
}
