// Monétisation › Coûts et budgets: the spend ledger of the month (measured), the caps editable in place, the per-channel
// budgets, the summary by provider or model and the detailed entries. Uses the existing spend.* methods.
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { SpendChannelRow, SpendEntry, SpendGroup, SpendOverview, SpendSummaryRow } from '../../../shared/api'
import { DataTable, ErrorLine, LoadingBlock, fmtDate, fmtInt, fmtUsd, type Column } from '@/components/atelier/kit'
import { Panel, StatTile } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { SourceChip } from './common'

export function CapEditor({ id, label, cap, onSave }: { id: string; label: string; cap: number | null; onSave: (usd: number | null) => Promise<void> }) {
  const [value, setValue] = useState(cap === null ? '' : String(cap).replace('.', ','))
  const [busy, setBusy] = useState(false)
  const run = async (usd: number | null): Promise<void> => {
    setBusy(true)
    try {
      await onSave(usd)
      toast.success(t(usd === null ? 'money.cost.capRemoved' : 'money.cost.capSaved'))
      if (usd === null) setValue('')
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  const submit = (): void => {
    const n = Number(value.replace(',', '.'))
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) return void toast.error(t('money.cost.capInvalid'))
    void run(n)
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input id={id} aria-label={label} inputMode="decimal" placeholder={t('money.cost.noCap')} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-28" />
      <span className="text-[12px] text-fg-3">$</span>
      <Button type="submit" variant="secondary" size="sm" disabled={busy}>
        {t('money.ov.rateSave')}
      </Button>
      {cap !== null && (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(null)}>
          {t('money.cost.removeCap')}
        </Button>
      )}
    </form>
  )
}

export function CostsBody({ overview, summary, entries, group, onGroup }: { overview: SpendOverview; summary: SpendSummaryRow[]; entries: SpendEntry[]; group: SpendGroup; onGroup: (g: SpendGroup) => void }) {
  const cap = overview.globalCapUsd
  const pct = cap && cap > 0 ? Math.min(100, ((overview.spentUsd + overview.reservedUsd) / cap) * 100) : 0
  const channelColumns: Column<SpendChannelRow>[] = [
    { key: 'name', header: t('money.rev.channel'), cell: (r) => <span className="text-fg">{r.name}</span> },
    { key: 'spent', header: t('money.cost.spent'), align: 'right', cell: (r) => fmtUsd(r.spentUsd) },
    { key: 'reserved', header: t('money.cost.reserved'), align: 'right', cell: (r) => fmtUsd(r.reservedUsd) },
    {
      key: 'budget',
      header: t('money.cost.budget'),
      cell: (r) => (
        <CapEditor
          id={`cap-${r.channelId}`}
          label={t('money.cost.budgetOf', { name: r.name })}
          cap={r.budgetUsd}
          onSave={(usd) => call('spend.setChannelCap', r.channelId, usd)}
        />
      )
    }
  ]
  const summaryColumns: Column<SpendSummaryRow>[] = [
    { key: 'label', header: t(`money.cost.group.${group}` as never), cell: (r) => <span className="text-fg">{r.label}</span> },
    { key: 'calls', header: t('money.cost.calls'), align: 'right', cell: (r) => fmtInt(r.calls) },
    { key: 'tokens', header: t('money.cost.tokens'), align: 'right', cell: (r) => `${fmtInt(r.inputTokens)} / ${fmtInt(r.outputTokens)}` },
    { key: 'usd', header: t('money.cost.spent'), align: 'right', cell: (r) => fmtUsd(r.spentUsd) }
  ]
  const entryColumns: Column<SpendEntry>[] = [
    { key: 'at', header: t('money.cost.when'), cell: (e) => fmtDate(e.createdAt, true) },
    { key: 'model', header: t('money.cost.model'), cell: (e) => <span className="font-mono text-[12px]">{e.model}</span> },
    { key: 'channel', header: t('money.rev.channel'), cell: (e) => e.channelName ?? '—' },
    { key: 'video', header: t('money.sp.video'), cell: (e) => <span className="line-clamp-1 max-w-[24ch]">{e.videoTitle ?? '—'}</span> },
    { key: 'status', header: t('money.cost.status'), cell: (e) => t(`money.cost.status.${e.status}` as never) },
    { key: 'amount', header: t('money.cost.spent'), align: 'right', cell: (e) => fmtUsd(e.status === 'reserved' ? e.estimateUsd : e.amountUsd) }
  ]
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('money.cost.monthSpent')} value={fmtUsd(overview.spentUsd)} hint={<SourceChip source="measured" />} />
        <StatTile label={t('money.cost.reserved')} value={fmtUsd(overview.reservedUsd)} hint={t('money.cost.reservedHint')} />
        <StatTile label={t('money.cost.cap')} value={cap === null ? '—' : fmtUsd(cap)} hint={cap === null ? t('money.cost.noCap') : `${pct.toFixed(0)} %`} />
        <StatTile label={t('money.cost.calls')} value={fmtInt(overview.calls)} />
      </div>
      <Panel title={t('money.cost.globalCap')}>
        <div className="flex flex-col gap-3">
          {cap !== null && <Progress value={pct} aria-label={t('money.cost.capUsed')} />}
          <CapEditor id="cap-global" label={t('money.cost.globalCap')} cap={cap} onSave={(usd) => call('spend.setGlobalCap', usd)} />
          <p className="text-[11.5px] text-fg-3">{t('money.cost.capHint')}</p>
        </div>
      </Panel>
      <section className="flex flex-col gap-2" aria-labelledby="cost-channels">
        <h2 id="cost-channels" className="micro-label">
          {t('money.cost.perChannel')}
        </h2>
        <DataTable columns={channelColumns} rows={overview.channels} rowKey={(r) => r.channelId} empty={t('money.cost.noChannels')} testId="channel-budgets" />
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="cost-summary">
        <div className="flex items-center justify-between gap-3">
          <h2 id="cost-summary" className="micro-label">
            {t('money.cost.summary')}
          </h2>
          <Tabs value={group} onValueChange={(v) => onGroup(v as SpendGroup)}>
            <TabsList>
              <TabsTrigger value="provider">{t('money.cost.group.provider')}</TabsTrigger>
              <TabsTrigger value="model">{t('money.cost.group.model')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <DataTable columns={summaryColumns} rows={summary} rowKey={(r) => r.key} empty={t('money.cost.noSpend')} />
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="cost-entries">
        <h2 id="cost-entries" className="micro-label">
          {t('money.cost.entries')}
        </h2>
        <DataTable columns={entryColumns} rows={entries} rowKey={(e) => e.id} empty={t('money.cost.noSpend')} />
      </section>
      <p className="text-[11.5px] text-fg-3">{t('money.cost.note')}</p>
    </div>
  )
}

export function CostsTab() {
  const [group, setGroup] = useState<SpendGroup>('provider')
  const overview = useLoader(() => call('spend.overview'), 'costs-overview', ['spend', 'channels'])
  const rest = useLoader(
    async () => ({ summary: await call('spend.summary', group), entries: await call('spend.entries', undefined, 100) }),
    `costs:${group}`,
    ['spend']
  )
  const error = overview.error ?? rest.error
  if (error) return <ErrorLine message={error} onRetry={() => (overview.reload(), rest.reload())} />
  if (!overview.data || !rest.data) return <LoadingBlock rows={4} />
  return <CostsBody overview={overview.data} summary={rest.data.summary} entries={rest.data.entries} group={group} onGroup={setGroup} />
}
