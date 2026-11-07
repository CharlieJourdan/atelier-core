// Credits pill of the top bar (PLAN-V2-PRODUCTION §5): the spendable balance, live (refreshed on the 'credits' topic),
// a click opens Réglages › Compte et crédits. Nothing is fetched while rendering: the first paint shows a dash.
import { Coins } from 'lucide-react'
import { t } from '../../../shared/fr'
import { fmtInt } from '@/components/atelier/kit'
import { call, useLoader } from '@/state/client'

export function CreditsPillView({ available, onOpen }: { available: number | null; onOpen: () => void }) {
  const text = available === null ? '—' : fmtInt(available)
  return (
    <button
      type="button"
      data-testid="credits-pill"
      title={t('team.pill.title')}
      aria-label={t('team.pill.label', { n: text })}
      onClick={onOpen}
      className="no-drag inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-surface-1 px-3 text-[12px] text-fg-2 tabular-nums transition-colors duration-200 outline-none hover:border-line-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <Coins className="size-3.5 text-brand-fg" aria-hidden />
      <span data-testid="credits-pill-value">{text}</span>
    </button>
  )
}

export function CreditsPill({ onOpen }: { onOpen: () => void }) {
  const balance = useLoader(() => call('credits.balance'), 'credits-pill', ['credits', 'example'])
  return <CreditsPillView available={balance.data ? balance.data.available : null} onOpen={onOpen} />
}
