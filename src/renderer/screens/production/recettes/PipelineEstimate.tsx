// The cost, the render time and the fit of the pipeline being edited (production-11, decision 0023): on the left « Coût par
// minute » (the average in euros, min and max, credits, one video), « Temps de rendu moyen » (pipeline-ui: its own length, then
// the usual ones) and « Où va l'argent » (one bar per line: presenter, clips, stills, voice, music, LLM; thumbnails are per
// video), the LLM line by the team's backend and where the prices come from; on the right the fit % to a channel (each
// dimension, and the three biggest gaps with the change that closes each and its cost). No provider, model or provider plan is
// named (pipeline-ui: we sell the presenter, the voice…). Main computes everything (`estimates.pipeline`); this file shows it.
import { t, type MessageKey } from '../../../../shared/fr'
import type { BasePipelineInfo } from '../../../../shared/recipes'
import type { EstimateLineView, FitCloserView, FitView, PipelineEstimateView } from '../../../../shared/estimates'
import { Badge } from '@/components/ui/badge'
import { Label, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { durationText, eurOf, signedEur } from './estimate-format'

function Lines({ view }: { view: PipelineEstimateView }) {
  const total = view.perMinute.avg
  const shown = view.lines.filter((l) => l.perVideo.avg > 0 || l.unpriced.length > 0 || l.id === 'llm')
  return (
    <div className="flex flex-col gap-2.5" data-testid="est-lines">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[12.5px] font-semibold text-fg">{t('est.where')}</h3>
        <span className="text-[11px] text-fg-4">{t('est.where.hint')}</span>
      </div>
      {shown.map((l) => (
        <Line key={l.id} line={l} share={total > 0 ? l.perMinute.avg / total : 0} creditEur={view.creditEur} />
      ))}
    </div>
  )
}

function Line({ line, share, creditEur }: { line: EstimateLineView; share: number; creditEur: number }) {
  const oneOff = line.perMinute.avg === 0 && line.perVideo.avg > 0
  return (
    <div className="flex flex-col gap-1" data-testid={`est-line-${line.id}`}>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="truncate text-fg-2">{t(`est.line.${line.id}` as MessageKey)}</span>
        <span className="num shrink-0 text-fg">{oneOff ? t('est.line.perVideo', { eur: eurOf(line.perVideo.avg, creditEur) }) : `${eurOf(line.perMinute.avg, creditEur)} €`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
      </div>
      {line.unpriced.length > 0 && <span className="text-[11px] text-warn">{t('est.line.unpriced')}</span>}
    </div>
  )
}

function Llm({ view }: { view: PipelineEstimateView }) {
  if (view.llm.tasks.length === 0) return null
  const onCredits = eurOf(view.llm.onCreditsPerVideo, view.creditEur)
  const text =
    view.llm.backend === 'subscription'
      ? t('est.llm.subscription', { eur: onCredits })
      : view.llm.backend === 'api-key'
        ? t('est.llm.apiKey', { eur: view.llm.apiKeyEurPerVideo.toFixed(2).replace('.', ',') })
        : t('est.llm.credits', { eur: onCredits })
  return (
    <p className="text-[12px] leading-[1.5] text-fg-3" data-testid="est-llm">
      {text}
    </p>
  )
}

export function CostPanel({ view }: { view: PipelineEstimateView | null }) {
  if (!view) return <p className="text-[12.5px] text-fg-3">…</p>
  if (!view.available) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-warn" data-testid="est-unavailable">
          {view.reason}
        </p>
        <RenderTimePanel view={view} />
      </div>
    )
  }
  const e = (credits: number): string => eurOf(credits, view.creditEur)
  return (
    <div className="flex flex-col gap-4" data-testid="est-cost">
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-fg">{t('est.title')}</span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-[26px] font-semibold tracking-[-0.02em] text-fg" data-testid="est-avg">
            {t('est.perMinute', { avg: e(view.perMinute.avg) })}
          </span>
          <span className="num text-[12.5px] text-fg-3">{t('est.range', { min: e(view.perMinute.min), max: e(view.perMinute.max) })}</span>
        </div>
        <span className="num text-[12px] text-fg-3">
          {t('est.credits', { n: Math.round(view.perMinute.avg) })} · {t('est.perVideo', { minutes: view.minutes, avg: e(view.perVideo.avg), min: e(view.perVideo.min), max: e(view.perVideo.max) })}
        </span>
        <span className="text-[11px] text-fg-4">{t('est.hint')}</span>
      </div>
      <RenderTimePanel view={view} />
      <Lines view={view} />
      <Llm view={view} />
      <p className="text-[11px] leading-[1.5] text-fg-4">
        {view.assumedMix && `${t('est.assumedMix')} `}
        {t('est.render')}{' '}
        {view.prices && t(view.prices.source === 'live' ? 'est.prices.live' : 'est.prices.cache', { date: view.prices.at.slice(0, 10) })}
      </p>
    </div>
  )
}

/** The average render time: the pipeline's own length big, then the other usual lengths (known even without prices). */
export function RenderTimePanel({ view }: { view: PipelineEstimateView | null }) {
  const [own, ...others] = view?.renderTimes ?? []
  if (!own) return null
  return (
    <div className="flex flex-col gap-1" data-testid="est-time">
      <span className="text-[12.5px] font-semibold text-fg">{t('est.time.title')}</span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-[20px] font-semibold tracking-[-0.02em] text-fg" data-testid="est-time-avg">
          {t('est.time.main', { time: durationText(own.seconds.avg) })}
        </span>
        <span className="num text-[12.5px] text-fg-3">{t('est.time.forLength', { minutes: own.minutes, min: durationText(own.seconds.min), max: durationText(own.seconds.max) })}</span>
      </div>
      <span className="num flex flex-wrap gap-x-3 text-[12px] text-fg-3" data-testid="est-time-lengths">
        {others.map((r) => (
          <span key={r.minutes}>{t('est.time.other', { minutes: r.minutes, time: durationText(r.seconds.avg) })}</span>
        ))}
      </span>
      <span className="text-[11px] text-fg-4">{t('est.time.hint')}</span>
    </div>
  )
}

/** A closer in plain words, with the base's option labels. */
export function closerText(c: FitCloserView, base: BasePipelineInfo | undefined): string {
  switch (c.kind) {
    case 'option': {
      const o = base?.options.find((x) => x.id === c.option)
      const choice = o?.choices.find((x) => x.value === c.value)
      const value = choice ? t(choice.labelKey as MessageKey) : typeof c.value === 'number' ? `${Math.round(c.value * 100)} %` : String(c.value)
      return t('fit.closer.option', { option: o ? t(o.labelKey as MessageKey) : c.option, value })
    }
    case 'mix':
      return t('fit.closer.mix', { presenter: Math.round((c.shares.presenter ?? 0) * 100), clips: Math.round((c.shares.clipAi ?? 0) * 100) })
    case 'rhythm': {
      const ls = [c.shotLengthS.presenter, c.shotLengthS.clipAi, c.shotLengthS.imageAi].filter((x): x is number => typeof x === 'number')
      const s = ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length)
      return t('fit.closer.rhythm', { how: t(s >= 3.7 ? 'fit.closer.rhythm.longer' : 'fit.closer.rhythm.shorter'), s: s.toFixed(1).replace('.', ',') })
    }
    case 'look':
      return t('fit.closer.look', { style: c.style })
    case 'speed':
      return t('fit.closer.speed', { speed: String(c.speed).replace('.', ',') })
    case 'minutes':
      return t('fit.closer.minutes', { minutes: String(c.minutes).replace('.', ',') })
  }
}

function FitBody({ fit, base, creditEur }: { fit: FitView; base: BasePipelineInfo | undefined; creditEur: number }) {
  if (fit.state === 'no-channel') return <p className="text-[12.5px] text-fg-3">{t('fit.noChannel')}</p>
  if (fit.state !== 'ok') {
    return (
      <p className="text-[12.5px] text-fg-3" data-testid="fit-not-enough">
        {fit.state === 'not-enough-videos' ? t('fit.notEnough', { n: fit.videos }) : t('fit.nothing')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4" data-testid="fit-ok">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="num text-[26px] font-semibold tracking-[-0.02em] text-fg" data-testid="fit-percent">
          {fit.percent} %
        </span>
        <span className="text-[12px] text-fg-3">{t('fit.videos', { n: fit.videos })}</span>
        {fit.demo && <Badge variant="warn">{t('fit.demo')}</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {fit.dimensions.map((d) => (
          <div key={d.id} className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-[12px]">
            <span className="text-fg-2">{t(`fit.dim.${d.id}` as MessageKey)}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              {d.score !== null && <span className={cn('block h-full rounded-full', d.score >= 0.8 ? 'bg-ok' : d.score >= 0.5 ? 'bg-ink' : 'bg-warn')} style={{ width: `${Math.round(d.score * 100)}%` }} />}
            </div>
            <span className="num text-right text-fg-3">{d.score === null ? t('fit.unmeasured') : `${Math.round(d.score * 100)} %`}</span>
          </div>
        ))}
      </div>
      {fit.gaps.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="fit-gaps">
          <h3 className="text-[12.5px] font-semibold text-fg">{t('fit.gaps')}</h3>
          <ol className="flex flex-col gap-1.5">
            {fit.gaps.map((g) => (
              <li key={g.dimension} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px]">
                <span className="text-fg-2">
                  <span className="font-medium text-fg">{t(`fit.dim.${g.dimension}` as MessageKey)}</span> — {g.closer ? closerText(g.closer, base) : t('fit.gap.none')}
                </span>
                {g.costDelta !== null && <span className="num text-fg-3">{signedEur(g.costDelta, creditEur)}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

export function FitPanel({
  view,
  base,
  channels,
  channelId,
  onChannel
}: {
  view: PipelineEstimateView | null
  base: BasePipelineInfo | undefined
  channels: readonly { id: number; name: string }[]
  channelId: number | null
  onChannel: (id: number | null) => void
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="est-fit">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-fg">{t('fit.title')}</span>
        <div className="flex items-center gap-2">
          <Label htmlFor="fit-channel" className="text-[11.5px] text-fg-3">
            {t('fit.channel')}
          </Label>
          <Select id="fit-channel" value={channelId === null ? '' : String(channelId)} onChange={(e) => onChannel(e.target.value === '' ? null : Number(e.target.value))} className="h-7 w-44 text-[12px]">
            <option value="">{t('fit.channel.none')}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {view ? <FitBody fit={view.fit} base={base} creditEur={view.creditEur} /> : <p className="text-[12.5px] text-fg-3">…</p>}
    </div>
  )
}

/** Both panels side by side, under the pipeline's header. */
export function PipelineEstimate(props: Parameters<typeof FitPanel>[0]) {
  return (
    <section className="card mb-6 grid grid-cols-1 gap-8 p-5 lg:grid-cols-2" data-testid="pipe-estimate">
      <CostPanel view={props.view} />
      <FitPanel {...props} />
    </section>
  )
}
