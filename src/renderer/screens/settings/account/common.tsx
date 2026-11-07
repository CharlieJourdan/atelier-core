// Shared bits of the team Réglages pages: the page frame, time formatting and the native select.
import type * as React from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { PageShell } from '@/components/atelier/page'

export function SettingsPage({ page, subtitle, actions, children }: { page: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <PageShell section="reglages" title={t(`page.reglages.${page}` as MessageKey)} subtitle={subtitle} actions={actions}>
      <div className="flex max-w-5xl flex-col gap-6">{children}</div>
    </PageShell>
  )
}

/** « 14:30 » in the user's local time. */
export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** « il y a 2 h », « à l’instant », « hier »… from an ISO string. */
export function fmtAgo(iso: string, now: number = Date.now()): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const min = Math.round(ms / 60_000)
  if (min < 2) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'hier' : `il y a ${d} jours`
}
