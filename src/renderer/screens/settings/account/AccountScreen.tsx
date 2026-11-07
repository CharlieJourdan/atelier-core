// Réglages › Compte et crédits: the balance, its history and the cost per video are real (local wallet, lot P5 swaps in
// the Cloud's behind the same IPC). Buying a pack is SIMULATED (feature `buy-credits`, DÉMO): no money ever moves.
import { Coins } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { CreditEntry, CreditPack, CreditsBalance, RunSummary } from '../../../../shared/runs'
import { DemoBoundary } from '@/components/atelier/demo'
import { CloudPanel } from '@/components/cloud/CloudPanel'
import { TeamBlock } from '@/components/cloud/TeamBlock'
import { isDesktopApp } from '@/proto/live/desktop'
import { DataTable, ErrorLine, ExampleBadge, LoadingBlock, fmtCredits, fmtDate, fmtEur, type Column } from '@/components/atelier/kit'
import { Panel, StatTile } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { ExampleCreditsLine } from '../../production/ExampleCredits'
import type { ScreenProps } from '../../registry'
import { SettingsPage } from './common'

/** Average of the credits spent by the productions that spent some (demo runs spend nothing), or null. */
export function costPerVideo(runs: readonly Pick<RunSummary, 'spentCredits' | 'demo' | 'example'>[]): { average: number; n: number } | null {
  const paid = runs.filter((r) => !r.demo && !r.example && r.spentCredits > 0) // example runs are seeded, not real spend
  if (paid.length === 0) return null
  return { average: Math.round(paid.reduce((s, r) => s + r.spentCredits, 0) / paid.length), n: paid.length }
}

export function BalanceTiles({ balance, runs }: { balance: CreditsBalance; runs: readonly RunSummary[] }) {
  const cost = costPerVideo(runs)
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="balance-tiles">
      <StatTile
        label={t('team.account.balance')}
        value={<span data-testid="balance-available">{fmtCredits(balance.available)}</span>}
        hint={t('team.account.balanceHint', { held: balance.held })}
      />
      <StatTile
        label={t('team.account.total')}
        value={fmtCredits(balance.total)}
        hint={
          balance.simulated > 0 ? `${t('team.account.simulated')} : ${fmtCredits(balance.simulated)}` : undefined
        }
      />
      <StatTile
        label={t('team.account.costPerVideo')}
        value={cost ? fmtCredits(cost.average) : '—'}
        hint={cost ? t('team.account.costHint', { n: cost.n }) : t('team.account.costNone')}
      />
      {balance.example > 0 && <ExampleCreditsLine example={balance.example} className="md:col-span-3" />}
    </div>
  )
}

export function History({ entries }: { entries: readonly CreditEntry[] }) {
  const columns: Column<CreditEntry>[] = [
    { key: 'date', header: t('team.account.colDate'), cell: (e) => fmtDate(e.createdAt, true) },
    {
      key: 'kind',
      header: t('team.account.colKind'),
      cell: (e) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {t(`credits.kind.${e.kind}` as MessageKey)}
          {e.source === 'simulated_purchase' && (
            <span data-testid="simulated-chip" className="rounded-full border border-brand/40 px-2 py-0.5 text-[10.5px] text-brand-fg">
              {t('team.account.simulatedLabel')}
            </span>
          )}
          {e.example && <ExampleBadge />}
        </span>
      )
    },
    { key: 'note', header: t('team.account.colNote'), cell: (e) => e.note ?? '' },
    { key: 'amount', header: t('team.account.colAmount'), align: 'right', cell: (e) => `${e.kind === 'capture' || e.kind === 'hold' ? '−' : e.amount > 0 ? '+' : ''}${fmtCredits(e.amount)}` }
  ]
  return <DataTable testId="credit-history" columns={columns} rows={entries} rowKey={(e) => e.id} empty={t('team.account.historyEmpty')} />
}

export function BuyPanel({ packs, busy, onBuy }: { packs: readonly CreditPack[] | null; busy: string | null; onBuy: (p: CreditPack) => void }) {
  return (
    <DemoBoundary feature="buy-credits">
      <Panel title={t('team.account.buy')} data-testid="buy-panel">
        <p className="mb-4 text-[13px] text-fg-3">{t('team.account.buyBlurb')}</p>
        {!packs ? (
          <LoadingBlock rows={1} />
        ) : packs.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t('team.account.packsEmpty')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {packs.map((p) => (
              <div key={p.id} data-testid="pack" className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-4">
                <span className="font-serif text-[28px] leading-none">{fmtCredits(p.credits)}</span>
                <span className="text-[12px] text-fg-3">{t('team.account.packPrice', { price: fmtEur(p.priceEur) })}</span>
                <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => onBuy(p)}>
                  <Coins aria-hidden /> {t('team.account.packBuy')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </DemoBoundary>
  )
}

export function AccountScreen(_props: ScreenProps) {
  const balance = useLoader(() => call('credits.balance'), 'acc-balance', ['credits', 'example'])
  const entries = useLoader(() => call('credits.entries', 100), 'acc-entries', ['credits', 'example'])
  const packs = useLoader(() => call('credits.packs'), 'acc-packs', [])
  const runs = useLoader(() => call('production.list'), 'acc-runs', ['production', 'credits'])
  const [busy, setBusy] = useState<string | null>(null)

  const buy = (p: CreditPack): void => {
    setBusy(p.id)
    call('credits.simulatePurchase', p.id, `buy-${p.id}-${Date.now()}`)
      .then((r) => toast.success(t('team.account.bought', { n: r.entry.amount })))
      .catch((e: unknown) => toast.error(errText(e)))
      .finally(() => setBusy(null))
  }

  const error = balance.error ?? entries.error
  return (
    <SettingsPage page="compte" subtitle={t('team.account.subtitle')}>
      {/* the beta: the Atelier Cloud account (sign-in, address of the server under « avancé ») and its team */}
      {isDesktopApp() && (
        <>
          <CloudPanel />
          <TeamBlock />
        </>
      )}
      {error ? <ErrorLine message={error} onRetry={() => { balance.reload(); entries.reload() }} /> : null}
      {balance.data ? <BalanceTiles balance={balance.data} runs={runs.data ?? []} /> : !error && <LoadingBlock rows={2} />}
      <BuyPanel packs={packs.data} busy={busy} onBuy={buy} />
      <Panel title={t('team.account.history')}>
        {entries.data ? <History entries={entries.data} /> : !error && <LoadingBlock rows={4} />}
      </Panel>
    </SettingsPage>
  )
}
