// « Ajouter un revenu » and « Ajouter une dépense »: one small form, the row is added to the screen's own list.
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/input'
import { EXPENSE_KINDS, REVENUE_KINDS, type EntryKind, type MoneyEntry } from '@/proto/data-brain-money'
import type { ProtoChannel } from '@/proto/types'

const TITLE = 'font-sans text-[18px] leading-tight font-semibold tracking-[-0.018em]'

const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Whole days between a yyyy-mm-dd day and today (never negative: a future date counts as today). */
export function daysAgoOf(day: string, today = new Date()): number {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return 0
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const b = new Date(y, m - 1, d).getTime()
  return Math.max(0, Math.round((a - b) / 86_400_000))
}

export function EntryDialog({
  type,
  channels,
  onClose,
  onAdd,
  kinds: offered
}: {
  type: 'revenue' | 'expense'
  channels: ProtoChannel[]
  /** The kinds offered (real mode: the database's revenue types); default: the demo's. */
  kinds?: readonly EntryKind[]
  onClose: () => void
  onAdd: (entry: Omit<MoneyEntry, 'id'>) => void
}) {
  const kinds = offered ?? (type === 'revenue' ? REVENUE_KINDS : EXPENSE_KINDS)
  const [kind, setKind] = useState<EntryKind>(kinds[0] ?? 'sponsor')
  const [channelId, setChannelId] = useState<string>(type === 'revenue' ? (channels[0]?.id ?? '') : '')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(isoDay(new Date()))
  const value = Number(amount.replace(',', '.'))
  const valid = label.trim().length > 0 && Number.isFinite(value) && value > 0

  const submit = () => {
    if (!valid) return
    onAdd({ type, kind, label: label.trim(), channelId: channelId || null, amount: Math.round(value * 100) / 100, daysAgo: daysAgoOf(day) })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(460px,92vw)]" closeLabel={t('common.close')} data-testid={`entry-dialog-${type}`}>
        <DialogHeader>
          <DialogTitle className={TITLE}>{type === 'revenue' ? t('money2.add.revenue') : t('money2.add.expense')}</DialogTitle>
          <DialogDescription>{type === 'revenue' ? t('money2.add.revenue.hint') : t('money2.add.expense.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="entry-kind">{t('money2.add.kind')}</Label>
            <Select id="entry-kind" value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`money2.kind.${k}` as MessageKey)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-channel">{t('money2.add.channel')}</Label>
            <Select id="entry-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">{t('money2.add.general')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="entry-label">{t('money2.add.label')}</Label>
            <Input
              id="entry-label"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={type === 'revenue' ? t('money2.add.label.revenue') : t('money2.add.label.expense')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-amount">{t('money2.add.amount')}</Label>
            <Input
              id="entry-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-date">{t('money2.add.date')}</Label>
            <Input id="entry-date" type="date" value={day} max={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} onClick={submit} data-testid="entry-confirm">
            {t('money2.add.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
