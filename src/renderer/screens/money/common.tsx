// Shared bits of the Monétisation screens: source chips, money formatting, the channel list hook.
import { t, type MessageKey } from '../../../shared/fr'
import type { FigureSource } from '../../../shared/money'
import { fmtEur } from '@/components/atelier/kit'
import { cn } from '@/lib/utils'
import { call, useLoader } from '@/state/client'

const SOURCE_TONE: Record<FigureSource, string> = {
  measured: 'border-ok/40 text-ok',
  entered: 'border-line-3 text-fg-2',
  estimated: 'border-warn/40 text-warn',
  example: 'border-line-3 text-fg-3',
  demo: 'border-brand/50 text-brand-fg'
}

/** « mesuré », « saisi », « estimé », « exemple », « démo »: where a figure comes from. */
export function SourceChip({ source, className }: { source: FigureSource; className?: string }) {
  return (
    <span
      data-testid="source-chip"
      data-source={source}
      className={cn('inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[9.5px] leading-none tracking-[0.8px] uppercase', SOURCE_TONE[source], className)}
    >
      {t(`money.source.${source}` as MessageKey)}
    </span>
  )
}

/** Cents → « 1 234,50 € ». */
export function eur(cents: number): string {
  return fmtEur(cents / 100)
}

/** `2026-10` → « oct. 2026 ». */
export function monthLabel(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? month : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** `2026-10-19` → « 19/10 ». */
export function dayLabel(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export function useChannels() {
  return useLoader(() => call('channels.list'), 'money-channels', ['channels', 'example'])
}

/** « 12,50 » or « 12.5 » typed by the user → cents, or null. */
export function typedToCents(raw: string): number | null {
  const s = raw.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}

export function centsToTyped(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}
