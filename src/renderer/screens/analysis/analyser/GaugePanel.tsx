// The gauge of an analysis with what moves it: the three other notes, the best adaptations, and the yes/no questions about
// the user's own footage (answering recomputes the note).
import { t } from '../../../../shared/fr'
import type { AnalysisDetail } from '../../../../shared/analysis'
import { BUDGET_MODE_IDS, type Adaptation, type GaugeResult, type InputId } from '../../../../shared/gauge'
import { Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ReproGauge } from '../shared/Gauge'
import { gaugeTone } from '../shared/gauge-view'

export function adaptationText(a: Adaptation): string {
  if (a.kind === 'input') return t('analysis.adapt.input', { input: t(`analysis.input.${a.input}`), n: a.score })
  if (a.kind === 'mode') return t('analysis.adapt.mode', { mode: t(`analysis.mode.${a.mode}`), n: a.score })
  return t('analysis.adapt.replace', { component: t(`analysis.comp.${a.component}`), by: t(`analysis.comp.${a.by}`), n: a.score })
}

const TONE_BADGE = { ok: 'ok', info: 'brand', warn: 'warn', err: 'err' } as const

export function GaugePanel({ gauge, delta }: { gauge: GaugeResult; delta: { from: number; to: number } | null }) {
  const tone = gaugeTone(gauge.score)
  const notes = [
    { id: 'v', label: t('analysis.notes.visuals'), value: gauge.v },
    { id: 'vo', label: t('analysis.notes.voice'), value: gauge.vo },
    { id: 's', label: t('analysis.notes.script'), value: gauge.s },
    { id: 'm', label: t('analysis.notes.edit'), value: gauge.m }
  ]
  return (
    <Panel title={t('analysis.gauge.title')} data-testid="gauge-panel">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <ReproGauge score={gauge.score} />
          <Badge variant={TONE_BADGE[tone]} data-testid="gauge-tier">
            {t(`analysis.tier.${gauge.tier}`)}
          </Badge>
          <p className="text-[11.5px] text-fg-3">{t(`analysis.conf.${gauge.confidence}`)}</p>
          {delta && delta.from !== delta.to && (
            <p data-testid="gauge-delta" role="status" className="rounded-full border border-line-2 px-2.5 py-0.5 text-[12px] text-fg-2">
              {t('analysis.gauge.delta', { from: delta.from, to: delta.to })}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <ul className="grid grid-cols-2 gap-2" aria-label={t('analysis.notes.title')}>
            {notes.map((n) => (
              <li key={n.id} className="rounded-field border border-line bg-surface-2 px-3 py-2">
                <p className="micro-label">{n.label}</p>
                <p className="font-serif text-[22px] leading-none">{Math.round(n.value * 100)}</p>
              </li>
            ))}
          </ul>
          {gauge.l < 1 && <p className="rounded-field border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t('analysis.gauge.clipLimit')}</p>}
          <ul className="flex gap-3 text-[12px] text-fg-2" aria-label={t('analysis.gauge.perMode')}>
            {BUDGET_MODE_IDS.map((m) => (
              <li key={m} className={cn('rounded-full border px-2.5 py-0.5', m === gauge.mode ? 'border-brand/50 bg-brand-soft text-fg' : 'border-line-2')}>
                {t(`analysis.mode.${m}`)} · {gauge.perMode[m]}
              </li>
            ))}
          </ul>
          {gauge.adaptations.length > 0 && (
            <div>
              <p className="micro-label mb-1.5">{t('analysis.adapt.title')}</p>
              <ul className="flex flex-col gap-1 text-[12.5px] text-fg-2" data-testid="adaptations">
                {gauge.adaptations.slice(0, 4).map((a, i) => (
                  <li key={i}>{adaptationText(a)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

const ANSWER_LABELS = [
  { value: true, key: 'analysis.input.yes' },
  { value: false, key: 'analysis.input.no' },
  { value: null, key: 'analysis.input.unknown' }
] as const

export function InputsPanel({ detail, busy, onAnswer }: { detail: AnalysisDetail; busy: boolean; onAnswer: (input: InputId, value: boolean | null) => void }) {
  if (detail.questions.length === 0) return null
  const effects = new Map((detail.gauge?.inputsEffect ?? []).map((e) => [e.input, e]))
  return (
    <Panel title={t('analysis.inputs.title')} data-testid="inputs-panel">
      <p className="mb-3 text-[12.5px] text-fg-3">{t('analysis.inputs.blurb')}</p>
      <ul className="flex flex-col gap-4">
        {detail.questions.map((q) => {
          const answer = detail.answers[q]
          const effect = effects.get(q)
          return (
            <li key={q} data-testid={`question-${q}`} className="flex flex-col gap-2">
              <div>
                <p className="text-[13.5px] font-medium text-fg">{t(`analysis.input.${q}.question`)}</p>
                <p className="text-[12px] text-fg-3">{t(`analysis.input.${q}.help`)}</p>
              </div>
              <div role="radiogroup" aria-label={t(`analysis.input.${q}.question`)} className="flex flex-wrap items-center gap-2">
                {ANSWER_LABELS.map((o) => {
                  const on = (answer === undefined ? null : answer) === o.value
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={busy}
                      data-testid={`answer-${q}-${o.value === null ? 'unknown' : o.value ? 'yes' : 'no'}`}
                      onClick={() => onAnswer(q, o.value)}
                      className={cn(
                        'rounded-full border px-3.5 py-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-50',
                        on ? 'border-brand bg-brand-soft text-fg' : 'border-line-2 text-fg-2 hover:bg-surface-2'
                      )}
                    >
                      {t(o.key)}
                    </button>
                  )
                })}
                {effect && <span className="text-[11.5px] text-fg-3">{t('analysis.inputs.effect', { yes: effect.with, no: effect.without })}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
