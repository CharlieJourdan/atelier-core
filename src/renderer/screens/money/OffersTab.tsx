// Monétisation › Produits et offres: the offers of the channels and their sheet.
import { Package, Plus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { OfferRow } from '../../../shared/money'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, LoadingBlock } from '@/components/atelier/kit'
import { EmptyState } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { OfferSheet, kindLabel, statusLabel } from './OfferSheet'
import { eur } from './common'

export function OfferCards({ offers, onOpen }: { offers: readonly OfferRow[]; onOpen: (o: OfferRow) => void }) {
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" data-testid="offers-list">
      {offers.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => onOpen(o)} className="flex h-full w-full flex-col gap-2 rounded-card border border-line bg-surface-1 p-4 text-left outline-none transition-colors hover:border-line-3 focus-visible:ring-2 focus-visible:ring-brand/70">
            <span className="flex items-center gap-2">
              <Package className="size-4 text-fg-3" aria-hidden />
              <span className="line-clamp-1 text-[14px] font-medium text-fg">{o.name}</span>
              {o.example && <ExampleBadge />}
            </span>
            <span className="text-[12.5px] text-fg-3">
              {kindLabel(o.kind)} · {o.priceCents > 0 ? eur(o.priceCents) : t('money.offer.noPrice')}
              {o.channelName ? ` · ${o.channelName}` : ''}
            </span>
            <span className="mt-auto flex items-center gap-2 text-[11.5px] text-fg-3">
              <span className="rounded-full border border-line-2 px-2 py-0.5 text-fg-2">{statusLabel(o.status)}</span>
              {o.pack && <span>{t('money.offer.hasPack')}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function OffersTab() {
  const { data, error, reload } = useApi('money.offers.list', ['money', 'example'])
  const [open, setOpen] = useState<OfferRow | 'new' | null>(null)
  const confirm = useConfirm()

  const remove = async (o: OfferRow): Promise<void> => {
    const ok = await confirm({ title: t('money.offer.deleteTitle'), description: t('money.offer.deleteBody', { name: o.name }), confirmLabel: t('money.delete'), danger: true })
    if (!ok) return
    try {
      await call('money.offers.delete', o.id)
      toast.success(t('money.offer.deleted'))
      setOpen(null)
    } catch (err) {
      toast.error(errText(err))
    }
  }
  const add = (
    <Button onClick={() => setOpen('new')}>
      <Plus /> {t('money.offer.add')}
    </Button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="max-w-[60ch] text-[12.5px] text-fg-3">{t('money.offer.intro')}</p>
        <span className="ml-auto">{add}</span>
      </div>
      {error ? (
        <ErrorLine message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingBlock />
      ) : data.length === 0 ? (
        <EmptyState title={t('money.offer.empty.title')} blurb={t('money.offer.empty.blurb')} action={add} className="py-10" />
      ) : (
        <OfferCards offers={data} onOpen={setOpen} />
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open === 'new' ? t('money.offer.add') : t('money.offer.sheet')}</DialogTitle>
            <DialogDescription>{t('money.offer.sheetHint')}</DialogDescription>
          </DialogHeader>
          {open !== null && <OfferSheet key={open === 'new' ? 'new' : open.id} offer={open === 'new' ? null : open} onClose={() => setOpen(null)} onDelete={(o) => void remove(o)} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
