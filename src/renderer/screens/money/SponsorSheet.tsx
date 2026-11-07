// A sponsor deal sheet: every field, the stage, and the DRAFT message the Rédacteur sponsor writes. Nothing is ever sent.
import { Copy, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { CURRENCIES, SPONSOR_STAGES, type Currency, type SponsorDealRow, type SponsorStage } from '../../../shared/money'
import { ErrorLine, Field } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { ShimmeringText } from '@/vendor/elevenlabs-ui'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { centsToTyped, typedToCents, useChannels } from './common'

export const stageLabel = (s: SponsorStage): string => t(`money.stage.${s}` as MessageKey)

export function SponsorSheet({ deal, onClose, onDelete }: { deal: SponsorDealRow | null; onClose: () => void; onDelete: (d: SponsorDealRow) => void }) {
  const channels = useChannels()
  const videos = useLoader(() => call('videos.list'), 'sponsor-videos', ['videos', 'example'])
  const [current, setCurrent] = useState<SponsorDealRow | null>(deal)
  const [brand, setBrand] = useState(deal?.brand ?? '')
  const [contact, setContact] = useState(deal?.contact ?? '')
  const [amount, setAmount] = useState(deal ? centsToTyped(deal.amountCents) : '')
  const [currency, setCurrency] = useState<Currency>(deal?.currency ?? 'EUR')
  const [terms, setTerms] = useState(deal?.terms ?? '')
  const [phrases, setPhrases] = useState(deal?.requiredPhrases ?? '')
  const [link, setLink] = useState(deal?.link ?? '')
  const [placement, setPlacement] = useState(deal?.placement ?? '')
  const [due, setDue] = useState(deal?.dueDate ?? '')
  const [channelId, setChannelId] = useState(deal?.channelId ? String(deal.channelId) : '')
  const [videoId, setVideoId] = useState(deal?.videoId ? String(deal.videoId) : '')
  const [stage, setStage] = useState<SponsorStage>(deal?.stage ?? 'prospect')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)

  const save = async (): Promise<SponsorDealRow | null> => {
    const cents = amount.trim() === '' ? 0 : typedToCents(amount)
    if (cents === null || cents < 0) {
      setError(t('money.sp.amountInvalid'))
      return null
    }
    setBusy(true)
    try {
      const saved = await call('money.sponsors.save', {
        id: current?.id,
        brand,
        contact,
        amountCents: cents,
        currency,
        terms,
        requiredPhrases: phrases,
        link,
        placement,
        dueDate: due || null,
        channelId: channelId ? Number(channelId) : null,
        videoId: videoId ? Number(videoId) : null,
        stage
      })
      setCurrent(saved)
      setError(null)
      return saved
    } catch (err) {
      setError(errText(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  const draft = async (): Promise<void> => {
    const saved = await save()
    if (!saved) return
    setDrafting(true)
    try {
      setCurrent(await call('money.sponsors.draft', saved.id))
      toast.success(t('money.sp.drafted'))
    } catch (err) {
      setError(errText(err))
    } finally {
      setDrafting(false)
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(current?.draftMessage ?? '')
      toast.success(t('money.sp.copied'))
    } catch {
      toast.error(t('money.sp.copyFailed'))
    }
  }

  const channelVideos = (videos.data ?? []).filter((v) => !channelId || v.channelId === Number(channelId))

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save().then((s) => {
          if (s) {
            toast.success(t('money.sp.saved'))
            onClose()
          }
        })
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('money.sp.brand')} htmlFor="sp-brand">
          <Input id="sp-brand" value={brand} onChange={(e) => setBrand(e.target.value)} required maxLength={120} />
        </Field>
        <Field label={t('money.sp.contact')} htmlFor="sp-contact">
          <Input id="sp-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-[1fr_5.5rem] gap-2">
          <Field label={t('money.sp.amount')} htmlFor="sp-amount">
            <Input id="sp-amount" inputMode="decimal" placeholder="800,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('money.rev.currency')} htmlFor="sp-currency">
            <Select id="sp-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('money.sp.stage')} htmlFor="sp-stage">
          <Select id="sp-stage" value={stage} onChange={(e) => setStage(e.target.value as SponsorStage)}>
            {SPONSOR_STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.rev.channel')} htmlFor="sp-channel">
          <Select id="sp-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">{t('money.rev.noChannel')}</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.sp.video')} htmlFor="sp-video">
          <Select id="sp-video" value={videoId} onChange={(e) => setVideoId(e.target.value)}>
            <option value="">{t('money.sp.noVideo')}</option>
            {channelVideos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.sp.due')} htmlFor="sp-due">
          <Input id="sp-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label={t('money.sp.placement')} htmlFor="sp-placement">
          <Input id="sp-placement" value={placement} onChange={(e) => setPlacement(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('money.sp.link')} htmlFor="sp-link">
          <Input id="sp-link" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
      </div>
      <Field label={t('money.sp.terms')} htmlFor="sp-terms">
        <Textarea id="sp-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} />
      </Field>
      <Field label={t('money.sp.phrases')} htmlFor="sp-phrases" hint={t('money.sp.phrasesHint')}>
        <Textarea id="sp-phrases" value={phrases} onChange={(e) => setPhrases(e.target.value)} rows={2} />
      </Field>

      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface-1 p-4" aria-labelledby="sp-draft-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="sp-draft-title" className="micro-label">
            {t('money.sp.draft')}
          </h3>
          <div className="flex gap-2">
            {current?.draftMessage && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
                <Copy /> {t('money.sp.copy')}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" disabled={drafting || busy || !brand.trim()} onClick={() => void draft()}>
              <Sparkles /> {t(current?.draftMessage ? 'money.sp.redraft' : 'money.sp.write')}
            </Button>
          </div>
        </div>
        {drafting ? (
          <ShimmeringText text={t('money.sp.writing')} className="text-[13px]" />
        ) : current?.draftMessage ? (
          <pre data-testid="sponsor-draft" className="max-h-60 overflow-auto font-sans text-[13px] leading-[1.5] whitespace-pre-wrap text-fg-2">
            {current.draftMessage}
          </pre>
        ) : (
          <p className="text-[12.5px] text-fg-3">{t('money.sp.draftEmpty')}</p>
        )}
        <p className="text-[11.5px] text-fg-3">{t('money.sp.neverSent')}</p>
      </section>

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
            {t('money.sp.save')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
