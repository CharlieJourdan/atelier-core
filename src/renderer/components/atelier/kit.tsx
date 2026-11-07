// Small shared pieces of the lot Z1 screens: the EXEMPLE chip (rows of the example workspace), a labelled field, a
// plain table, loading / error lines and number formatters. Own code, Atelier tokens only.
import { CircleAlert } from 'lucide-react'
import type * as React from 'react'
import { t } from '../../../shared/fr'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Marks data of the example workspace (stored in the DB, deletable in one click). Not the DÉMO badge: example rows
 *  are real rows the user can edit or delete; DÉMO is for features that cannot work yet. */
export function ExampleBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="example-badge"
      className={cn(
        'inline-flex items-center rounded-full border border-line-3 px-1.5 py-0.5 font-mono text-[9.5px] leading-none tracking-[1px] text-fg-3 uppercase',
        className
      )}
    >
      {t('example.badge')}
    </span>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  className,
  children
}: {
  label: string
  hint?: React.ReactNode
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-fg-3">{hint}</p>}
    </div>
  )
}

export interface Column<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  className?: string
  align?: 'left' | 'right'
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  className,
  testId
}: {
  columns: readonly Column<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string | number
  empty?: React.ReactNode
  onRowClick?: (row: T) => void
  className?: string
  testId?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-line', className)} data-testid={testId}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-1">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('micro-label px-3 py-2 font-normal', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-fg-3">
                {empty ?? t('kit.empty')}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('border-b border-line last:border-b-0', onRowClick && 'cursor-pointer hover:bg-surface-2')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2 text-fg-2', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-label={t('loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-field border border-err/30 bg-err/10 px-3 py-2 text-[13px] text-err">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-[12px] underline underline-offset-2">
          {t('error.retry')}
        </button>
      )}
    </div>
  )
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

/** « 1 240 crédits » */
export function fmtCredits(n: number): string {
  return t('kit.credits', { n: nf0.format(Math.round(n)) })
}
export function fmtEur(n: number): string {
  return eur.format(n)
}
export function fmtUsd(n: number): string {
  return usd.format(n)
}
export function fmtInt(n: number): string {
  return nf0.format(n)
}
/** Date (and time) in French, from an ISO string. */
export function fmtDate(iso: string, withTime = false): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
}
