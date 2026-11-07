// Step 4 in real mode: the real analysis of the reference channel. The timeline shows the analysis' own steps with their
// real states and figures; the right side lists the example videos it read. Finding competitors has no service yet: that
// panel stays a simulation and says so.
import { Check, Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../../../../shared/fr'
import { STEP_IDS, type AnalysisStep } from '../../../../shared/analysis'
import { fmtCompact, ProgressBar } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLiveState } from '@/proto/live/use-onboarding-live'
import { useProto } from '@/proto/store'
import { sourceKind, type StepProps } from '../model'
import { Question } from '../parts'
import { CompetitorsPanel } from '../steps/Analysis'
import { liveDraftOf } from './draft'
import { SimBadge } from './SimBadge'

function stepsOf(state: NonNullable<ReturnType<typeof useLiveState>>): AnalysisStep[] {
  if (state.analysis) return state.analysis.steps
  return STEP_IDS.map((id, i) => ({ id, status: i === 0 && state.analysisPhase === 'running' ? 'waiting' : 'pending', n: 0 }))
}

function LiveTimeline({ steps }: { steps: AnalysisStep[] }) {
  return (
    <ol className="relative" data-testid="analysis-timeline">
      {steps.map((s, i) => {
        const done = s.status === 'done'
        const running = !done && (s.status === 'waiting' || steps[i - 1]?.status === 'done')
        return (
          <li key={s.id} data-state={done ? 'done' : running ? 'running' : 'todo'} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className={cn('absolute top-6 left-[10px] h-[calc(100%-1.25rem)] w-px', done ? 'bg-fg-3' : 'bg-line-2')} />}
            <span
              aria-hidden
              className={cn(
                'relative z-10 mt-0.5 flex size-[21px] shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
                done ? 'border-ink bg-ink text-ink-fg' : running ? 'border-fg-2 bg-bg text-fg' : 'border-line-3 bg-bg'
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : running ? <Loader2 className="size-3 animate-spin" /> : null}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-[14px] leading-[1.35] font-medium', done || running ? 'text-fg' : 'text-fg-3')}>{t(`analysis.step.${s.id}`)}</span>
              {done && <span className="onb-rise mt-0.5 block text-[12.5px] text-fg-3">{t(`analysis.step.${s.id}.done`, { n: s.n })}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function LiveAnalysisStep({ a, live, ready, setReady }: StepProps) {
  const state = useLiveState(live)
  const { channels } = useProto()
  const kind = sourceKind(a)
  const analysisReady = state?.analysisPhase === 'done'
  useEffect(() => {
    // StrictMode runs this twice: the session runs one analysis per channel and reference.
    live?.runAnalysis(liveDraftOf(a, channels)).catch(() => undefined)
    // The analysis starts when the step opens; later edits of the answers do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])
  useEffect(() => {
    if (analysisReady && !ready) setReady(true)
  }, [analysisReady, ready, setReady])
  if (!state) return null
  const steps = stepsOf(state)
  const done = steps.filter((s) => s.status === 'done').length
  const detail = state.analysis
  const reference = state.reference
  return (
    <div>
      <Question title={t(`onb.analysis.title.${kind}`)} hint={t('onb.analysis.hint')} />
      {reference && (
        <p data-testid="live-analysis-reference" className="mb-5 rounded-[12px] bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.5] text-fg-2">
          {t(reference.standsInForLink ? 'onb.live.analysis.stand' : 'onb.live.analysis.reference', { name: reference.name })}
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" data-testid="analysis" data-live="true" data-state={analysisReady ? 'done' : state.analysisPhase === 'error' ? 'error' : 'running'}>
        <div>
          <LiveTimeline steps={steps} />
          <div className="mt-7">
            <ProgressBar value={Math.round((done / steps.length) * 100)} tone="ink" />
            <p className="num mt-2.5 text-[12.5px] text-fg-3">{analysisReady ? t('onb.analysis.finished') : t('onb.analysis.running', { pct: Math.round((done / steps.length) * 100) })}</p>
          </div>
          {state.analysisPhase === 'error' && (
            <div role="alert" data-testid="live-analysis-error" className="mt-5 rounded-[12px] border border-err/40 bg-surface-1 p-3.5 text-[13px] text-fg-2">
              <p>{t('onb.live.failed', { error: state.error ?? '' })}</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void live?.runAnalysis(liveDraftOf(a, channels), true).catch(() => undefined)}>
                {t('onb.live.retry')}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-[16px] border border-line-2 bg-surface-1 p-4" data-testid="analysis-examples">
            <h2 className="mb-3 text-[14px] font-semibold tracking-[-0.01em] text-fg">{t('onb.live.analysis.examples')}</h2>
            {detail && detail.examples.length > 0 ? (
              <ul className="space-y-2.5">
                {detail.examples.map(({ video }) => (
                  <li key={video.id} className="onb-pop flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate font-medium text-fg">{video.title}</span>
                    <span className="num shrink-0 text-[12px] text-fg-3">{t('onb.live.analysis.example.meta', { views: fmtCompact(video.views), min: Math.round(video.durationS / 60) })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-fg-3">{t('onb.live.analysis.waiting')}</p>
            )}
          </div>
          {analysisReady && (
            <div>
              <div className="mb-1.5 flex justify-end">
                <SimBadge />
              </div>
              <CompetitorsPanel shown={9} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
