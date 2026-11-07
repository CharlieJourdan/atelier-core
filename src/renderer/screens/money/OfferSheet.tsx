// An offer sheet: its fields, the generated pack (3 ideas, 5 names, prices, funnel) and the simulated « mise en ligne ».
import { Rocket, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { OFFER_KINDS, OFFER_STATUSES, type OfferKind, type OfferPack, type OfferRow, type OfferStatus } from '../../../shared/money'
import { DemoBoundary } from '@/components/atelier/demo'
import { ErrorLine, Field } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { pushToast, toast } from '@/lib/toast'
import { ShimmeringText } from '@/vendor/elevenlabs-ui'
import { call, errText } from '@/state/client'
import { centsToTyped, typedToCents, useChannels } from './common'

export const kindLabel = (k: OfferKind): string => t(`money.offer.kind.${k}` as MessageKey)
export const statusLabel = (s: OfferStatus): string => t(`money.offer.status.${s}` as MessageKey)

export function PackView({ pack, onUseName }: { pack: OfferPack; onUseName: (name: string) => void }) {
  return (
    <div data-testid="offer-pack" className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="pk-ideas">
        <h4 id="pk-ideas" className="micro-label mb-2">
          {t('money.offer.ideas')}
        </h4>
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[13px] text-fg-2">
          {pack.ideas.map((i) => (
            <li key={i.title}>
              <span className="font-medium text-fg">{i.title}</span> — {i.pitch}
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="pk-names">
        <h4 id="pk-names" className="micro-label mb-2">
          {t('money.offer.names')}
        </h4>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {pack.names.map((n) => (
            <li key={n}>
              <button type="button" onClick={() => onUseName(n)} title={t('money.offer.useName')} className="rounded-full border border-line-2 bg-surface-2 px-3 py-1 text-[12.5px] text-fg-2 outline-none hover:bg-surface-pop focus-visible:ring-2 focus-visible:ring-brand/70">
                {n}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="pk-prices">
        <h4 id="pk-prices" className="micro-label mb-2">
          {t('money.offer.prices')}
        </h4>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-fg-2">
          {pack.prices.map((p) => (
            <li key={p.label} className="flex justify-between gap-3">
              <span>{p.label}</span>
              <span className="text-fg tabular-nums">{p.amountEur.toFixed(2).replace('.', ',')} €</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="pk-funnel">
        <h4 id="pk-funnel" className="micro-label mb-2">
          {t('money.offer.funnel')}
        </h4>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-fg-2">
          {pack.funnel.map((s) => (
            <li key={s.step}>
              <span className="font-medium text-fg">{s.step}</span> — {s.detail}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

export function OfferSheet({ offer, onClose, onDelete }: { offer: OfferRow | null; onClose: () => void; onDelete: (o: OfferRow) => void }) {
  const channels = useChannels()
  const [current, setCurrent] = useState<OfferRow | null>(offer)
  const [name, setName] = useState(offer?.name ?? '')
  const [channelId, setChannelId] = useState(offer?.channelId ? String(offer.channelId) : '')
  const [kind, setKind] = useState<OfferKind>(offer?.kind ?? 'ebook')
  const [price, setPrice] = useState(offer ? centsToTyped(offer.priceCents) : '')
  const [status, setStatus] = useState<OfferStatus>(offer?.status ?? 'idea')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [packing, setPacking] = useState(false)

  const save = async (override?: Partial<{ name: string }>): Promise<OfferRow | null> => {
    const cents = price.trim() === '' ? 0 : typedToCents(price)
    if (cents === null || cents < 0) {
      setError(t('money.offer.priceInvalid'))
      return null
    }
    setBusy(true)
    try {
      const saved = await call('money.offers.save', { id: current?.id, name: override?.name ?? name, channelId: channelId ? Number(channelId) : null, kind, priceCents: cents, status })
      setCurrent(saved)
      setName(saved.name)
      setError(null)
      return saved
    } catch (err) {
      setError(errText(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  const generate = async (): Promise<void> => {
    const saved = await save()
    if (!saved) return
    setPacking(true)
    try {
      setCurrent(await call('money.offers.pack', saved.id))
      toast.success(t('money.offer.packDone'))
      setError(null)
    } catch (err) {
      setError(errText(err))
    } finally {
      setPacking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save().then((s) => {
          if (s) {
            toast.success(t('money.offer.saved'))
            onClose()
          }
        })
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('money.offer.name')} htmlFor="of-name" className="col-span-2">
          <Input id="of-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
        </Field>
        <Field label={t('money.rev.channel')} htmlFor="of-channel">
          <Select id="of-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">{t('money.rev.noChannel')}</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.offer.kind')} htmlFor="of-kind">
          <Select id="of-kind" value={kind} onChange={(e) => setKind(e.target.value as OfferKind)}>
            {OFFER_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.offer.price')} htmlFor="of-price">
          <Input id="of-price" inputMode="decimal" placeholder="14,90" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label={t('money.offer.status')} htmlFor="of-status">
          <Select id="of-status" value={status} onChange={(e) => setStatus(e.target.value as OfferStatus)}>
            {OFFER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4" aria-labelledby="of-pack-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="of-pack-title" className="micro-label">
            {t('money.offer.pack')}
          </h3>
          <Button type="button" variant="secondary" size="sm" disabled={packing || busy || !name.trim()} onClick={() => void generate()}>
            <Sparkles /> {t(current?.pack ? 'money.offer.repack' : 'money.offer.generate')}
          </Button>
        </div>
        {packing ? (
          <ShimmeringText text={t('money.offer.packing')} className="text-[13px]" />
        ) : current?.pack ? (
          <PackView pack={current.pack} onUseName={(n) => void save({ name: n })} />
        ) : (
          <p className="text-[12.5px] text-fg-3">{t('money.offer.packEmpty')}</p>
        )}
      </section>

      <DemoBoundary feature="offer-deploy">
        <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-1 p-4">
          <p className="max-w-[46ch] text-[12.5px] text-fg-3">{t('money.offer.deployHint')}</p>
          <Button type="button" variant="outline" onClick={() => pushToast('demo', t('money.offer.deployToast'))}>
            <Rocket /> {t('money.offer.deploy')}
          </Button>
        </div>
      </DemoBoundary>

      {error && <ErrorLine message={error} />}
      <DialogFooter className="sm:justify-between">
        {current ? (
          <Button type="button" variant="ghost" className="text-err" onClick={() => onDelete(current)}>
            {t('money.delete')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('money.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('money.offer.save')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
