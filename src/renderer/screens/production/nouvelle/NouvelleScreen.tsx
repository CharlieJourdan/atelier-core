// Production › Nouvelle vidéo: the composer. Channel, subject, length, budget mode (+ optional ceiling), voice, step by
// step or all at once, and the live quote of the engine; « Lancer » starts a real run and opens « En cours » on it.
import { AlertTriangle, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { RunBudgetMode, RunGateMode, RunQuote, RunStyle } from '../../../../shared/runs'
import { DemoBoundary } from '@/components/atelier/demo'
import { ErrorLine, Field } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useFeature } from '@/lib/features'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { focusRun, useChannelList } from '../shared'
import { QuotePanel } from './QuotePanel'

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; hint?: string }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex flex-col items-start gap-0.5 rounded-field border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
            o.value === value ? 'border-brand/70 bg-brand-soft text-fg' : 'border-line-2 bg-surface-2 text-fg-2 hover:bg-surface-pop'
          )}
        >
          <span className="text-[13px] font-medium">{o.label}</span>
          {o.hint && <span className="text-[11.5px] text-fg-3">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

/** Where the video is made: only this computer is real; the remote machine stays disabled with the registry's reason. */
function WhereToRender() {
  const gpu = useFeature('gpu-render')
  return (
    <div role="radiogroup" aria-label={t('production.new.where')} className="grid auto-cols-fr grid-flow-col gap-2">
      <button type="button" role="radio" aria-checked className="flex flex-col items-start gap-0.5 rounded-field border border-brand/70 bg-brand-soft px-3 py-2 text-left text-fg">
        <span className="text-[13px] font-medium">{t('production.new.where.mine')}</span>
        <span className="text-[11.5px] text-fg-3">{t('production.new.where.mineHint')}</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={false}
        disabled
        title={gpu.reason || t('production.new.where.remoteReason')}
        className="flex flex-col items-start gap-0.5 rounded-field border border-line-2 bg-surface-2 px-3 py-2 text-left text-fg-2 opacity-60"
      >
        <span className="text-[13px] font-medium">{t('production.new.where.remote')}</span>
        <span className="text-[11.5px] text-fg-3">{gpu.reason || t('production.new.where.remoteReason')}</span>
      </button>
    </div>
  )
}

export function NouvelleScreen({ onRoute }: ScreenProps) {
  const channels = useChannelList()
  const voices = useApi('production.voices')
  const balance = useApi('credits.balance', ['credits', 'example'])
  const [channelId, setChannelId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [minutes, setMinutes] = useState('8')
  const [budget, setBudget] = useState<RunBudgetMode>('usage_max')
  const [gate, setGate] = useState<RunGateMode>('step')
  const [voice, setVoice] = useState('')
  const [cap, setCap] = useState('')
  const [answer, setAnswer] = useState<{ key: string; quote: RunQuote | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const list = channels.data ?? []
  const chosenChannel = channelId ?? list[0]?.id ?? null
  const minutesNum = Number(minutes.replace(',', '.'))
  const minutesOk = Number.isFinite(minutesNum) && minutesNum >= 0.5 && minutesNum <= 30

  const style = useMemo<RunStyle>(() => {
    const v = voices.data?.voices.find((x) => x.id === voice)
    if (!v) return {}
    return v.system ? { systemVoice: v.id } : { voice: v.id }
  }, [voice, voices.data])

  // The quote follows the form (debounced); the previous answer stays visible while the next one is computed.
  // the channel's style profile (the eyes) shapes the run, so the quote asks for it too
  const quoteKey = `${minutesNum}|${topic.trim()}|${JSON.stringify(style)}|${chosenChannel ?? ''}`
  useEffect(() => {
    if (!minutesOk) return
    let live = true
    const timer = setTimeout(() => {
      call('production.quote', { minutes: minutesNum, ...(topic.trim() ? { topic: topic.trim() } : {}), ...(chosenChannel !== null ? { channelId: chosenChannel } : {}), style }).then(
        (q) => live && setAnswer({ key: quoteKey, quote: q, error: null }),
        (err: unknown) => live && setAnswer({ key: quoteKey, quote: null, error: errText(err) })
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [minutesOk, minutesNum, topic, style, quoteKey, chosenChannel])
  const quote = minutesOk ? (answer?.quote ?? null) : null
  const quoteError = minutesOk ? (answer?.error ?? null) : null
  const quoting = minutesOk && answer?.key !== quoteKey

  const mode = quote?.modes[budget] ?? null
  const capNum = cap.trim() === '' ? null : Number(cap.replace(',', '.'))
  const capBad = capNum !== null && (!Number.isFinite(capNum) || capNum < 0)
  const overCap = mode !== null && capNum !== null && !capBad && mode.totalCredits > capNum
  const available = balance.data?.available ?? quote?.balance.available ?? 0
  const short = quote !== null && quote.debited && mode !== null && mode.totalCredits > available
  const canLaunch = chosenChannel !== null && topic.trim() !== '' && minutesOk && mode !== null && !overCap && !capBad && !short && !busy

  const launch = async (): Promise<void> => {
    if (chosenChannel === null) return
    setBusy(true)
    setStartError(null)
    try {
      const run = await call('production.start', {
        channelId: chosenChannel,
        title: (title.trim() || topic.trim()).slice(0, 200),
        topic: topic.trim(),
        minutes: minutesNum,
        budgetMode: budget,
        gateMode: gate,
        style
      })
      focusRun(run.id)
      toast.success(t('production.new.started'))
      onRoute({ section: 'production', page: 'encours' })
    } catch (err) {
      setStartError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const insufficient = short || (startError !== null && startError.startsWith('Crédits insuffisants'))

  return (
    <PageShell section="production" title={t('page.production.nouvelle')} subtitle={t('production.new.subtitle')}>
      <DemoBoundary feature="voice-platform">
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form
            className="flex flex-col gap-5"
            data-testid="composer"
            onSubmit={(e) => {
              e.preventDefault()
              if (canLaunch) void launch()
            }}
          >
            <Panel className="flex flex-col gap-4">
              <Field label={t('production.new.channel')} htmlFor="nv-channel">
                <Select id="nv-channel" value={chosenChannel ?? ''} onChange={(e) => setChannelId(Number(e.target.value))} disabled={list.length === 0}>
                  {list.length === 0 && <option value="">{t('production.new.noChannel')}</option>}
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('production.new.topic')} htmlFor="nv-topic" hint={t('production.new.topicHint')}>
                <Textarea id="nv-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={2000} placeholder={t('production.new.topicPlaceholder')} />
              </Field>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label={t('production.new.title')} htmlFor="nv-title" hint={t('production.new.titleHint')}>
                  <Input id="nv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </Field>
                <Field label={t('production.new.minutes')} htmlFor="nv-minutes">
                  <Input id="nv-minutes" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-invalid={!minutesOk} />
                </Field>
              </div>
              {!minutesOk && <p className="m-0 text-[12px] text-err">{t('production.new.minutesBad')}</p>}
            </Panel>
            <Panel className="flex flex-col gap-4">
              <Field label={t('production.new.budget')}>
                <Segmented
                  label={t('production.new.budget')}
                  value={budget}
                  onChange={setBudget}
                  options={[
                    { value: 'usage_max', label: t('runs.budget.usage_max'), hint: t('production.new.budget.usage') },
                    { value: 'qualite_max', label: t('runs.budget.qualite_max'), hint: t('production.new.budget.quality') }
                  ]}
                />
              </Field>
              <Field label={t('production.new.cap')} htmlFor="nv-cap" hint={t('production.new.capHint')}>
                <Input id="nv-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className="w-40" placeholder={t('production.new.capNone')} aria-invalid={capBad} />
              </Field>
              {overCap && mode && <p className="m-0 text-[12px] text-err">{t('production.new.overCap', { total: mode.totalCredits, cap: capNum ?? 0 })}</p>}
              {capBad && <p className="m-0 text-[12px] text-err">{t('production.new.capBad')}</p>}
              <Field label={t('production.new.voice')} htmlFor="nv-voice" hint={voices.data?.note}>
                <Select id="nv-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  <option value="">{t('production.new.voiceAuto')}</option>
                  {(voices.data?.voices ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.language}){v.system ? ` · ${t('production.new.voiceSystem')}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('production.new.gates')}>
                <Segmented
                  label={t('production.new.gates')}
                  value={gate}
                  onChange={setGate}
                  options={[
                    { value: 'step', label: t('runs.gateMode.step'), hint: t('production.new.gates.step') },
                    { value: 'all', label: t('runs.gateMode.all'), hint: t('production.new.gates.all') }
                  ]}
                />
              </Field>
              <Field label={t('production.new.where')}>
                <WhereToRender />
              </Field>
            </Panel>
            {insufficient && (
              <div role="alert" data-testid="insufficient" className="flex items-start gap-3 rounded-card border border-warn/40 bg-warn/10 p-3 text-[13px] text-fg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                <div className="flex flex-col gap-1">
                  <span>{startError?.startsWith('Crédits insuffisants') ? startError : mode ? t('production.new.short', { need: mode.totalCredits, have: available }) : ''}</span>
                  <Button type="button" variant="link" className="h-auto self-start p-0" onClick={() => onRoute({ section: 'reglages', page: 'compte' })}>
                    {t('production.new.buyCredits')}
                  </Button>
                </div>
              </div>
            )}
            {startError && !insufficient && <ErrorLine message={startError} />}
            <div className="flex items-center gap-3">
              <Button type="submit" variant="brand" size="lg" disabled={!canLaunch} data-testid="launch">
                <Rocket aria-hidden />
                {busy ? t('production.new.launching') : t('production.new.launch')}
              </Button>
              {topic.trim() === '' && <span className="text-[12px] text-fg-3">{t('production.new.needTopic')}</span>}
            </div>
          </form>
          <QuotePanel quote={quote} mode={mode} error={quoteError} loading={quoting} />
        </div>
      </DemoBoundary>
    </PageShell>
  )
}
