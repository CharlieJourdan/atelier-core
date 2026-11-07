// Réglages › Admin plateforme (owner only): the local price grid with margins, credits granted, support requests and
// provider key status. Read-only on the grid: the real prices, wallets and queue live in Atelier Cloud (lot P5).
import type { AdminOverview } from '../../../../shared/api/team'
import { t, type MessageKey } from '../../../../shared/fr'
import type { ProviderInfo } from '../../../../shared/api/llm'
import type { SupportRequestRow } from '../../../../shared/analysis'
import { DataTable, ErrorLine, ExampleBadge, LoadingBlock, fmtCredits, fmtDate, fmtUsd, type Column } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { SettingsPage } from './common'

type PriceLine = AdminOverview['prices']['lines'][number]

export function PricesTable({ prices }: { prices: AdminOverview['prices'] }) {
  const columns: Column<PriceLine>[] = [
    { key: 'unit', header: t('team.admin.colUnit'), cell: (l) => t(`team.admin.unit.${l.unit}` as MessageKey) },
    { key: 'cost', header: t('team.admin.colCost'), align: 'right', cell: (l) => fmtUsd(l.providerCostUsd) },
    { key: 'margin', header: t('team.admin.colMargin'), align: 'right', cell: (l) => `${l.marginPct} %` },
    { key: 'credits', header: t('team.admin.colCredits'), align: 'right', cell: (l) => l.creditsPerUnit.toLocaleString('fr-FR', { maximumSignificantDigits: 3 }) }
  ]
  return (
    <>
      <p className="mb-2 flex items-center gap-2 text-[12px] text-fg-3" data-testid="prices-provisional">
        <Badge variant="warn">{t('team.admin.provisional')}</Badge>
        {t('team.admin.provisionalNote')}
      </p>
      <p className="mb-3 text-[12px] text-fg-3">
        {t('team.admin.grid', { v: prices.version, eur: `${prices.creditValueEur.toLocaleString('fr-FR')} €`, overhead: prices.overheadPct })}
      </p>
      <DataTable testId="prices-table" columns={columns} rows={prices.lines} rowKey={(l) => l.unit} />
    </>
  )
}

export function GrantedTiles({ granted }: { granted: AdminOverview['granted'] }) {
  const items: [string, number][] = [
    [t('team.admin.grantedLocal'), granted.local],
    [t('team.admin.grantedSimulated'), granted.simulated],
    [t('team.admin.grantedExample'), granted.example]
  ]
  return (
    <div className="grid gap-3 md:grid-cols-3" data-testid="granted-tiles">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-card border border-line bg-surface-2 p-4">
          <div className="micro-label">{label}</div>
          <div className="mt-1 font-serif text-[28px] leading-none">{fmtCredits(n)}</div>
        </div>
      ))}
    </div>
  )
}

export function SupportList({ rows, onClose }: { rows: readonly SupportRequestRow[]; onClose: (id: number) => void }) {
  if (rows.length === 0) return <p className="text-[13px] text-fg-3">{t('team.admin.supportEmpty')}</p>
  return (
    <ul className="divide-y divide-line rounded-card border border-line" data-testid="support-list">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg">
              <span className="truncate">{r.what}</span>
              {r.example && <ExampleBadge />}
              <Badge variant={r.status === 'open' ? 'warn' : 'default'}>{r.status === 'open' ? t('team.admin.supportOpen') : t('team.admin.supportDone')}</Badge>
            </div>
            <div className="text-[12px] text-fg-3">
              {fmtDate(r.createdAt, true)}
              {r.contact ? ` · ${r.contact}` : ''}
            </div>
          </div>
          {r.status === 'open' && (
            <Button size="sm" variant="outline" onClick={() => onClose(r.id)}>
              {t('team.admin.supportClose')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ProvidersList({ providers }: { providers: readonly ProviderInfo[] }) {
  return (
    <ul className="divide-y divide-line rounded-card border border-line" data-testid="providers-list">
      {providers.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
          <span className="flex-1 text-fg">{p.label}</span>
          <Badge variant={p.keySet === null ? 'default' : p.keySet ? 'ok' : 'warn'}>
            {p.keySet === null ? t('team.admin.keyNone') : p.keySet ? t('team.admin.keySet') : t('team.admin.keyUnset')}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export function AdminScreen(_props: ScreenProps) {
  const overview = useLoader(() => call('admin.overview'), 'admin-overview', ['team', 'credits', 'example'])
  const support = useLoader(() => call('support.list'), 'admin-support', ['analysis', 'example'])
  const providers = useLoader(() => call('providers.list'), 'admin-providers', ['providers'])

  const close = (id: number): void => {
    call('support.close', id).then(
      () => {
        toast.success(t('team.admin.supportClosed'))
        support.reload()
      },
      (e: unknown) => toast.error(errText(e))
    )
  }

  return (
    <SettingsPage page="admin" subtitle={t('team.admin.subtitle')}>
      <p className="rounded-card border border-line bg-surface-1 px-4 py-3 text-[12.5px] text-fg-3" role="note">
        {t('team.admin.readOnly')}
      </p>
      {overview.error ? (
        <ErrorLine message={overview.error} onRetry={overview.reload} />
      ) : !overview.data ? (
        <LoadingBlock rows={4} />
      ) : (
        <>
          <Panel title={t('team.admin.prices')}>
            <PricesTable prices={overview.data.prices} />
          </Panel>
          <Panel title={t('team.admin.granted')}>
            <GrantedTiles granted={overview.data.granted} />
          </Panel>
        </>
      )}
      <Panel title={t('team.admin.support')}>
        {support.error ? <ErrorLine message={support.error} onRetry={support.reload} /> : support.data ? <SupportList rows={support.data} onClose={close} /> : <LoadingBlock rows={2} />}
      </Panel>
      <Panel title={t('team.admin.providers')}>
        {providers.error ? <ErrorLine message={providers.error} onRetry={providers.reload} /> : providers.data ? <ProvidersList providers={providers.data} /> : <LoadingBlock rows={2} />}
      </Panel>
    </SettingsPage>
  )
}
