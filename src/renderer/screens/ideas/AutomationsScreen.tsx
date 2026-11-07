// Production › Automatisations: rules « lancer le pipeline Atelier » on a cadence, the next firing, enable / disable, run
// now (a real run of our engine, after a confirmation) and the history of every firing. All real.
import { Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { AutomationRow, AutomationRunRow } from '../../../shared/api/ideas'
import { useConfirm } from '@/components/atelier/confirm'
import { DataTable, ErrorLine, ExampleBadge, LoadingBlock, fmtDate, type Column } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState, Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../registry'
import { AutomationForm } from './AutomationForm'
import { budgetLabel, cadenceText, gateLabel, useChannels } from './common'

export interface AutomationActions {
  onToggle: (a: AutomationRow, enabled: boolean) => void
  onRun: (a: AutomationRow) => void
  onEdit: (a: AutomationRow) => void
  onDelete: (a: AutomationRow) => void
}

export function AutomationCard({ automation: a, busy, ...actions }: { automation: AutomationRow; busy?: boolean } & AutomationActions) {
  return (
    <li data-testid="automation-card" data-enabled={a.enabled} className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-medium text-fg">{a.name}</h3>
        {a.example && <ExampleBadge />}
        <Badge variant={a.enabled ? 'ok' : 'default'}>{t(a.enabled ? 'automations.on' : 'automations.off')}</Badge>
        {a.cadence !== 'manual' && (
          <span className="ml-auto">
            <Switch checked={a.enabled} disabled={busy} aria-label={t('automations.toggle', { name: a.name })} onCheckedChange={(v) => actions.onToggle(a, v)} />
          </span>
        )}
      </div>
      <p className="text-[13px] text-fg-2">
        {t('automations.rule', { channel: a.channelName, cadence: cadenceText(a).toLowerCase() })}
      </p>
      <dl className="m-0 grid grid-cols-[7rem_1fr] gap-y-1 text-[12.5px]">
        <dt className="text-fg-3">{t('automations.field.topicFrom')}</dt>
        <dd className="m-0 text-fg-2">{a.topicFrom === 'ideas' ? t('automations.topic.ideas') : t('automations.topic.fixedValue', { topic: a.topic })}</dd>
        <dt className="text-fg-3">{t('automations.field.settings')}</dt>
        <dd className="m-0 text-fg-2">
          {t('automations.minutes', { n: String(a.minutes).replace('.', ',') })} · {budgetLabel(a.budgetMode)} · {gateLabel(a.gateMode)}
        </dd>
        <dt className="text-fg-3">{t('automations.next')}</dt>
        <dd className="m-0 text-fg-2" data-testid="next-run">
          {a.nextRunAt ? fmtDate(a.nextRunAt, true) : '—'}
        </dd>
        <dt className="text-fg-3">{t('automations.last')}</dt>
        <dd className="m-0 text-fg-2">{a.lastRunAt ? fmtDate(a.lastRunAt, true) : t('automations.never')}</dd>
      </dl>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => actions.onRun(a)}>
          <Play /> {t('automations.runNow')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => actions.onEdit(a)}>
          <Pencil /> {t('automations.edit')}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" disabled={busy} aria-label={t('automations.delete')} onClick={() => actions.onDelete(a)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

const RUN_TONE = { started: 'ok', skipped: 'warn', failed: 'err' } as const

export function HistoryTable({ rows, names }: { rows: readonly AutomationRunRow[]; names: ReadonlyMap<number, string> }) {
  const columns: Column<AutomationRunRow>[] = [
    { key: 'at', header: t('automations.history.when'), cell: (r) => fmtDate(r.createdAt, true) },
    { key: 'rule', header: t('automations.history.rule'), cell: (r) => <span className="inline-flex items-center gap-2">{names.get(r.automationId) ?? '—'}{r.example && <ExampleBadge />}</span> },
    { key: 'status', header: t('automations.history.status'), cell: (r) => <Badge variant={RUN_TONE[r.status]}>{t(`automations.history.${r.status}` as MessageKey)}</Badge> },
    { key: 'message', header: t('automations.history.message'), cell: (r) => <span className="line-clamp-2 max-w-[56ch]">{r.message}</span> }
  ]
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={t('automations.history.empty')} testId="automation-history" />
}

export function AutomationsScreen(_props: ScreenProps) {
  const channels = useChannels()
  const list = useLoader(() => call('automations.list'), 'automations', ['ideas', 'example'])
  const history = useLoader(() => call('automations.history'), 'automations-history', ['ideas', 'production', 'example'])
  const [editing, setEditing] = useState<AutomationRow | 'new' | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const confirm = useConfirm()
  const channelList = channels.data ?? []

  const run = async (id: number, action: () => Promise<unknown>, success?: string): Promise<void> => {
    setBusyId(id)
    try {
      await action()
      if (success) toast.success(success)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusyId(null)
    }
  }
  const runNow = async (a: AutomationRow): Promise<void> => {
    const ok = await confirm({ title: t('automations.runTitle', { name: a.name }), description: t('automations.runBody', { channel: a.channelName }), confirmLabel: t('automations.runNow') })
    if (!ok) return
    setBusyId(a.id)
    try {
      const r = await call('automations.runNow', a.id)
      if (r.status === 'started') toast.success(r.message)
      else toast.info(r.message)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusyId(null)
    }
  }
  const remove = async (a: AutomationRow): Promise<void> => {
    const ok = await confirm({ title: t('automations.deleteTitle'), description: t('automations.deleteBody', { name: a.name }), confirmLabel: t('automations.delete'), danger: true })
    if (ok) await run(a.id, () => call('automations.delete', a.id), t('automations.deleted'))
  }

  const add = (
    <Button onClick={() => setEditing('new')} disabled={channelList.length === 0}>
      <Plus /> {t('automations.new')}
    </Button>
  )
  const names = new Map((list.data ?? []).map((a) => [a.id, a.name] as const))
  return (
    <PageShell section="production" title={t('page.production.automatisations')} subtitle={t('automations.subtitle')} actions={add}>
      <div className="flex flex-col gap-8">
        {list.error ? (
          <ErrorLine message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <LoadingBlock rows={3} />
        ) : list.data.length === 0 ? (
          <EmptyState title={t('automations.empty.title')} blurb={t('automations.empty.blurb')} action={add} className="py-12" />
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 xl:grid-cols-2" data-testid="automations-list">
            {list.data.map((a) => (
              <AutomationCard
                key={a.id}
                automation={a}
                busy={busyId === a.id}
                onToggle={(x, v) => void run(x.id, () => call('automations.update', x.id, { enabled: v }), t(v ? 'automations.enabledDone' : 'automations.disabledDone'))}
                onRun={(x) => void runNow(x)}
                onEdit={setEditing}
                onDelete={(x) => void remove(x)}
              />
            ))}
          </ul>
        )}
        <Panel title={t('automations.history.title')}>
          {history.error ? <ErrorLine message={history.error} onRetry={history.reload} /> : !history.data ? <LoadingBlock rows={2} /> : <HistoryTable rows={history.data} names={names} />}
        </Panel>
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('automations.new') : t('automations.edit')}</DialogTitle>
            <DialogDescription>{t('automations.formHint')}</DialogDescription>
          </DialogHeader>
          {editing !== null && <AutomationForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} channels={channelList} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
