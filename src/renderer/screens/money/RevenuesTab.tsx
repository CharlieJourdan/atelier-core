// Monétisation › Revenus: the table, the add / edit form and the delete action. CSV import lives in CsvImport.tsx.
import { Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { CURRENCIES, REVENUE_TYPES, type Currency, type RevenueRow, type RevenueType } from '../../../shared/money'
import { useConfirm } from '@/components/atelier/confirm'
import { DataTable, ErrorLine, ExampleBadge, Field, LoadingBlock, type Column } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { CsvImport } from './CsvImport'
import { SourceChip, centsToTyped, eur, typedToCents, useChannels } from './common'

export const typeLabel = (type: RevenueType): string => t(`money.type.${type}` as MessageKey)

function RevenueForm({ initial, onClose, channels }: { initial: RevenueRow | null; onClose: () => void; channels: { id: number; name: string }[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(initial?.date ?? today)
  const [channelId, setChannelId] = useState<string>(initial?.channelId ? String(initial.channelId) : '')
  const [type, setType] = useState<RevenueType>(initial?.type ?? 'adsense')
  const [amount, setAmount] = useState(initial ? centsToTyped(initial.amountCents) : '')
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'EUR')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const cents = typedToCents(amount)
    if (cents === null) return setError(t('money.rev.amountInvalid'))
    setBusy(true)
    try {
      await call('money.revenues.save', { id: initial?.id, date, channelId: channelId ? Number(channelId) : null, type, amountCents: cents, currency, note })
      toast.success(t(initial ? 'money.rev.saved' : 'money.rev.added'))
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('money.rev.date')} htmlFor="rev-date">
          <Input id="rev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={t('money.rev.channel')} htmlFor="rev-channel">
          <Select id="rev-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">{t('money.rev.noChannel')}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.rev.type')} htmlFor="rev-type">
          <Select id="rev-type" value={type} onChange={(e) => setType(e.target.value as RevenueType)}>
            {REVENUE_TYPES.map((k) => (
              <option key={k} value={k}>
                {typeLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_5.5rem] gap-2">
          <Field label={t('money.rev.amount')} htmlFor="rev-amount">
            <Input id="rev-amount" inputMode="decimal" placeholder="12,50" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label={t('money.rev.currency')} htmlFor="rev-currency">
            <Select id="rev-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <Field label={t('money.rev.note')} htmlFor="rev-note">
        <Input id="rev-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      {error && <ErrorLine message={error} />}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('money.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {t('money.rev.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function RevenuesTab() {
  const channels = useChannels()
  const [filter, setFilter] = useState('')
  const list = useLoader(() => call('money.revenues.list', filter ? { channelId: Number(filter) } : {}), `rev:${filter}`, ['money', 'example'])
  const [editing, setEditing] = useState<RevenueRow | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const confirm = useConfirm()
  const channelList = channels.data ?? []

  const remove = async (r: RevenueRow): Promise<void> => {
    const ok = await confirm({ title: t('money.rev.deleteTitle'), description: t('money.rev.deleteBody', { amount: eur(r.amountCents), date: r.date }), confirmLabel: t('money.delete'), danger: true })
    if (!ok) return
    try {
      await call('money.revenues.delete', r.id)
      toast.success(t('money.rev.deleted'))
    } catch (err) {
      toast.error(errText(err))
    }
  }

  const columns: Column<RevenueRow>[] = [
    { key: 'date', header: t('money.rev.date'), cell: (r) => r.date },
    { key: 'channel', header: t('money.rev.channel'), cell: (r) => r.channelName ?? '—' },
    { key: 'type', header: t('money.rev.type'), cell: (r) => typeLabel(r.type) },
    {
      key: 'amount',
      header: t('money.rev.amount'),
      align: 'right',
      cell: (r) => (
        <span className={r.amountCents < 0 ? 'text-err' : 'text-fg'}>
          {r.currency === 'USD' ? `${(r.amountCents / 100).toFixed(2).replace('.', ',')} $` : eur(r.amountCents)}
        </span>
      )
    },
    {
      key: 'source',
      header: t('money.rev.source'),
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <SourceChip source={r.source === 'example' ? 'example' : 'entered'} />
          {r.source === 'csv' && <span className="text-[11px] text-fg-3">CSV</span>}
          {r.example && <ExampleBadge />}
        </span>
      )
    },
    { key: 'note', header: t('money.rev.note'), cell: (r) => <span className="line-clamp-1 max-w-[28ch] text-fg-3">{r.note}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('money.actions')}</span>,
      align: 'right',
      cell: (r) => (
        <span className="inline-flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={t('money.rev.edit')} onClick={() => setEditing(r)}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('money.delete')} onClick={() => void remove(r)}>
            <Trash2 />
          </Button>
        </span>
      )
    }
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label={t('money.rev.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56">
          <option value="">{t('money.rev.allChannels')}</option>
          {channelList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload /> {t('money.rev.import')}
          </Button>
          <Button onClick={() => setEditing('new')}>
            <Plus /> {t('money.rev.add')}
          </Button>
        </div>
      </div>
      {list.error ? (
        <ErrorLine message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingBlock />
      ) : (
        <DataTable columns={columns} rows={list.data} rowKey={(r) => r.id} empty={t('money.rev.empty')} testId="revenues-table" />
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(editing === 'new' ? 'money.rev.add' : 'money.rev.edit')}</DialogTitle>
            <DialogDescription>{t('money.rev.formHint')}</DialogDescription>
          </DialogHeader>
          {editing !== null && <RevenueForm initial={editing === 'new' ? null : editing} channels={channelList} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('money.csv.title')}</DialogTitle>
            <DialogDescription>{t('money.csv.hint')}</DialogDescription>
          </DialogHeader>
          {importing && <CsvImport onDone={() => setImporting(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

