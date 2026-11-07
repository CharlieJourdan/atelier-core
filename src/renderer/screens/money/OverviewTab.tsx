// Monétisation › Vue d'ensemble: tiles of the month, the weekly curve and the P&L per channel and month.
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { MoneyOverview } from '../../../shared/api/money'
import type { PnlRow } from '../../../shared/money'
import { DataTable, ErrorLine, ExampleBadge, LoadingBlock, type Column } from '@/components/atelier/kit'
import { EmptyState, Panel, StatTile } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { WeeklyBars } from './BarChart'
import { SourceChip, eur, monthLabel } from './common'

function Figure({ value, source }: { value: React.ReactNode; source: PnlRow['sources'][keyof PnlRow['sources']] }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span>{value}</span>
      <SourceChip source={source} />
    </span>
  )
}

export function pnlColumns(names: Map<number | null, { name: string; example: boolean }>): Column<PnlRow>[] {
  return [
    {
      key: 'channel',
      header: t('money.ov.col.channel'),
      cell: (r) => {
        const c = names.get(r.channelId)
        return (
          <span className="inline-flex items-center gap-2 text-fg">
            {c?.name ?? t('money.ov.unassigned')}
            {c?.example && <ExampleBadge />}
          </span>
        )
      }
    },
    { key: 'month', header: t('money.ov.col.month'), cell: (r) => monthLabel(r.month) },
    { key: 'revenue', header: t('money.ov.col.revenue'), align: 'right', cell: (r) => <Figure value={eur(r.revenueCents)} source={r.sources.revenue} /> },
    { key: 'ai', header: t('money.ov.col.ai'), align: 'right', cell: (r) => <Figure value={eur(r.aiCents)} source={r.sources.ai} /> },
    { key: 'engine', header: t('money.ov.col.engine'), align: 'right', cell: (r) => <Figure value={eur(r.engineCents)} source={r.sources.engine} /> },
    { key: 'tools', header: t('money.ov.col.tools'), align: 'right', cell: (r) => <Figure value={eur(r.toolsCents)} source={r.sources.tools} /> },
    {
      key: 'margin',
      header: t('money.ov.col.margin'),
      align: 'right',
      cell: (r) => <Figure value={<span className={r.marginCents < 0 ? 'text-err' : 'text-fg'}>{eur(r.marginCents)}</span>} source={r.sources.margin} />
    },
    {
      key: 'rpm',
      header: t('money.ov.col.rpm'),
      align: 'right',
      cell: (r) => (r.rpmCents === null ? <span title={t('money.ov.viewsUnknown')}>—</span> : <Figure value={eur(r.rpmCents)} source={r.sources.rpm} />)
    },
    {
      key: 'perVideo',
      header: t('money.ov.col.perVideo'),
      align: 'right',
      cell: (r) => (r.costPerVideoCents === null ? '—' : `${eur(r.costPerVideoCents)} · ${t('money.ov.videos', { n: r.publishedVideos })}`)
    },
    {
      key: 'breakEven',
      header: t('money.ov.col.breakEven'),
      align: 'right',
      cell: (r) => (r.breakEvenVideos === null ? '—' : t('money.ov.breakEvenValue', { n: r.breakEvenVideos }))
    }
  ]
}

function RateEditor({ rate, onSaved }: { rate: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(rate).replace('.', ','))
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    const n = Number(value.replace(',', '.'))
    setBusy(true)
    try {
      await call('money.setRate', n)
      toast.success(t('money.ov.rateSaved'))
      onSaved()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="money-rate" className="text-[12px] font-medium text-fg-2">
          {t('money.ov.rate')}
        </label>
        <Input id="money-rate" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="w-28" />
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={busy}>
        {t('money.ov.rateSave')}
      </Button>
      <p className="max-w-[48ch] pb-1 text-[11.5px] text-fg-3">
        <SourceChip source="entered" className="mr-1.5" />
        {t('money.ov.rateHint')}
      </p>
    </form>
  )
}

export function OverviewBody({ data, onChanged, onAddRevenue }: { data: MoneyOverview; onChanged: () => void; onAddRevenue: () => void }) {
  const names = new Map<number | null, { name: string; example: boolean }>(data.channels.map((c) => [c.id, c]))
  const shown = data.rows.filter((r) => r.revenueCents !== 0 || r.costCents !== 0).sort((a, b) => (a.month === b.month ? (a.channelId ?? 0) - (b.channelId ?? 0) : b.month.localeCompare(a.month)))
  const tot = data.totals
  const ex = tot.example
  const exWeeks = ex ? ex.weekly.reduce((acc, w) => ({ revenueCents: acc.revenueCents + w.revenueCents, costCents: acc.costCents + w.costCents }), { revenueCents: 0, costCents: 0 }) : null
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="money-tiles">
        <StatTile label={t('money.ov.revenue')} value={eur(tot.revenueCents)} hint={<SourceChip source="entered" />} />
        <StatTile label={t('money.ov.costs')} value={eur(tot.costCents)} hint={<SourceChip source="measured" />} />
        <StatTile
          label={t('money.ov.margin')}
          value={<span className={tot.marginCents < 0 ? 'text-err' : undefined}>{eur(tot.marginCents)}</span>}
          hint={<SourceChip source="estimated" />}
        />
        <StatTile
          label={t('money.ov.rpm')}
          value={tot.rpmCents === null ? '—' : eur(tot.rpmCents)}
          hint={tot.rpmCents === null ? t('money.ov.viewsUnknown') : <SourceChip source="measured" />}
        />
      </div>
      {ex && (
        <p data-testid="money-example-line" className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
          <ExampleBadge />
          {t('money.ov.exampleLine', { revenue: eur(ex.revenueCents), costs: eur(ex.costCents), margin: eur(ex.marginCents) })}
        </p>
      )}
      <Panel title={t('money.ov.chart')}>
        <WeeklyBars weeks={data.weekly} />
        {exWeeks && (exWeeks.revenueCents !== 0 || exWeeks.costCents !== 0) && (
          <p data-testid="weekly-example-line" className="m-0 mt-2 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
            <ExampleBadge />
            {t('money.ov.exampleWeekly', { revenue: eur(exWeeks.revenueCents), costs: eur(exWeeks.costCents) })}
          </p>
        )}
      </Panel>
      <section className="flex flex-col gap-3" aria-labelledby="money-pnl-title">
        <h2 id="money-pnl-title" className="micro-label">
          {t('money.ov.table')}
        </h2>
        {shown.length === 0 ? (
          <EmptyState title={t('money.ov.empty.title')} blurb={t('money.ov.empty.blurb')} action={<Button onClick={onAddRevenue}>{t('money.ov.empty.action')}</Button>} className="py-10" />
        ) : (
          <DataTable columns={pnlColumns(names)} rows={shown} rowKey={(r) => `${r.channelId}-${r.month}`} testId="pnl-table" />
        )}
        <p className="text-[11.5px] text-fg-3">{t('money.ov.notes')}</p>
      </section>
      <Panel>
        <RateEditor rate={data.usdToEur} onSaved={onChanged} />
      </Panel>
    </div>
  )
}

export function OverviewTab({ onAddRevenue }: { onAddRevenue: () => void }) {
  const { data, error, reload } = useApi('money.overview', ['money', 'spend', 'videos', 'channels', 'example'])
  if (error) return <ErrorLine message={error} onRetry={reload} />
  if (!data) return <LoadingBlock rows={4} />
  return <OverviewBody data={data} onChanged={reload} onAddRevenue={onAddRevenue} />
}
