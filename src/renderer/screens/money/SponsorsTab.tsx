// Monétisation › Sponsors: a board by stage. Cards move with the arrow buttons (keyboard friendly) and open the deal sheet.
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { SPONSOR_STAGES, type SponsorDealRow, type SponsorStage } from '../../../shared/money'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, LoadingBlock } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { SponsorSheet, stageLabel } from './SponsorSheet'
import { centsToTyped } from './common'

function DealCard({ deal, onOpen, onMove }: { deal: SponsorDealRow; onOpen: () => void; onMove: (stage: SponsorStage) => void }) {
  const i = SPONSOR_STAGES.indexOf(deal.stage)
  const prev = SPONSOR_STAGES[i - 1]
  const next = SPONSOR_STAGES[i + 1]
  return (
    <li data-testid="deal-card" data-stage={deal.stage} className="rounded-card border border-line bg-surface-2 p-3 transition-colors hover:border-line-3">
      <button type="button" onClick={onOpen} className="block w-full rounded-field text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/70">
        <span className="flex items-center gap-2">
          <span className="line-clamp-1 text-[13px] font-medium text-fg">{deal.brand}</span>
          {deal.example && <ExampleBadge />}
        </span>
        <span className="mt-1 block text-[12px] text-fg-3">
          {deal.amountCents > 0 ? `${centsToTyped(deal.amountCents)} ${deal.currency}` : t('money.sp.noAmount')}
          {deal.channelName ? ` · ${deal.channelName}` : ''}
        </span>
        {deal.dueDate && <span className="mt-0.5 block text-[11.5px] text-fg-3">{t('money.sp.dueOn', { date: deal.dueDate })}</span>}
      </button>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" size="icon-sm" disabled={!prev} aria-label={prev ? t('money.sp.moveTo', { stage: stageLabel(prev) }) : t('money.sp.firstStage')} onClick={() => prev && onMove(prev)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!next} aria-label={next ? t('money.sp.moveTo', { stage: stageLabel(next) }) : t('money.sp.lastStage')} onClick={() => next && onMove(next)}>
          <ChevronRight />
        </Button>
      </div>
    </li>
  )
}

export function SponsorsBoard({ deals, onOpen, onMove }: { deals: readonly SponsorDealRow[]; onOpen: (d: SponsorDealRow) => void; onMove: (d: SponsorDealRow, s: SponsorStage) => void }) {
  return (
    <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2" data-testid="sponsors-board">
      {SPONSOR_STAGES.map((stage) => {
        const column = deals.filter((d) => d.stage === stage)
        return (
          <section key={stage} aria-label={stageLabel(stage)} className="flex min-h-40 flex-col gap-2 rounded-card border border-line bg-surface-1 p-2.5">
            <h3 className="micro-label flex items-center justify-between px-1">
              {stageLabel(stage)}
              <span className="text-fg-3 tabular-nums">{column.length}</span>
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {column.map((d) => (
                <DealCard key={d.id} deal={d} onOpen={() => onOpen(d)} onMove={(s) => onMove(d, s)} />
              ))}
            </ul>
            {column.length === 0 && <p className="px-1 text-[12px] text-fg-3">{t('money.sp.columnEmpty')}</p>}
          </section>
        )
      })}
    </div>
  )
}

export function SponsorsTab() {
  const { data, error, reload } = useApi('money.sponsors.list', ['money', 'example'])
  const [open, setOpen] = useState<SponsorDealRow | 'new' | null>(null)
  const confirm = useConfirm()

  const move = async (d: SponsorDealRow, stage: SponsorStage): Promise<void> => {
    try {
      await call('money.sponsors.move', d.id, stage)
      toast.success(t('money.sp.moved', { brand: d.brand, stage: stageLabel(stage) }))
    } catch (err) {
      toast.error(errText(err))
    }
  }
  const remove = async (d: SponsorDealRow): Promise<void> => {
    const ok = await confirm({ title: t('money.sp.deleteTitle'), description: t('money.sp.deleteBody', { brand: d.brand }), confirmLabel: t('money.delete'), danger: true })
    if (!ok) return
    try {
      await call('money.sponsors.delete', d.id)
      toast.success(t('money.sp.deleted'))
      setOpen(null)
    } catch (err) {
      toast.error(errText(err))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="max-w-[60ch] text-[12.5px] text-fg-3">{t('money.sp.intro')}</p>
        <Button className="ml-auto" onClick={() => setOpen('new')}>
          <Plus /> {t('money.sp.add')}
        </Button>
      </div>
      {error ? <ErrorLine message={error} onRetry={reload} /> : !data ? <LoadingBlock rows={4} /> : <SponsorsBoard deals={data} onOpen={setOpen} onMove={(d, s) => void move(d, s)} />}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open === 'new' ? t('money.sp.add') : t('money.sp.sheet')}</DialogTitle>
            <DialogDescription>{t('money.sp.sheetHint')}</DialogDescription>
          </DialogHeader>
          {open !== null && <SponsorSheet key={open === 'new' ? 'new' : open.id} deal={open === 'new' ? null : open} onClose={() => setOpen(null)} onDelete={(d) => void remove(d)} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
