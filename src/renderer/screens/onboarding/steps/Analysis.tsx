// Step 4, the "eyes" moment: a staged analysis (about 8 s, skippable). On the left the timeline of what the agent does,
// on the right the frames it looks at and the competitors it finds. Purely a demo animation driven by a ticking clock.
import { Check, FastForward, Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../../../../shared/fr'
import { fmtCompact, ProgressBar, Thumb } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { ANALYSIS_FRAME_COUNT, ANALYSIS_STEPS, ANALYSIS_TOTAL_MS, FOUND_COMPETITORS } from '@/proto/data-onboarding'
import { sourceKind, type StepProps } from '../model'
import { Question, useElapsed } from '../parts'

/** Which step is running at `elapsed`, and how far (0–1) each one is. */
export function stageAt(elapsed: number): { current: number; progress: number[] } {
  let start = 0
  let current = ANALYSIS_STEPS.length
  const progress = ANALYSIS_STEPS.map((s, i) => {
    const p = Math.max(0, Math.min(1, (elapsed - start) / s.ms))
    if (p < 1 && current === ANALYSIS_STEPS.length) current = i
    start += s.ms
    return p
  })
  return { current, progress }
}

function tc(i: number): string {
  const s = (i + 1) * 2
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Timeline({ progress, current }: { progress: number[]; current: number }) {
  return (
    <ol className="relative space-y-0" data-testid="analysis-timeline">
      {ANALYSIS_STEPS.map((s, i) => {
        const done = progress[i] === 1
        const running = i === current
        return (
          <li key={s.id} data-state={done ? 'done' : running ? 'running' : 'todo'} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < ANALYSIS_STEPS.length - 1 && <span aria-hidden className={cn('absolute top-6 left-[10px] h-[calc(100%-1.25rem)] w-px', done ? 'bg-fg-3' : 'bg-line-2')} />}
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
              <span className={cn('block text-[14px] leading-[1.35] font-medium transition-colors duration-300', done || running ? 'text-fg' : 'text-fg-3')}>{t(s.labelKey)}</span>
              {done && <span className="onb-rise mt-0.5 block text-[12.5px] text-fg-3">{t(s.doneKey)}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function FramesPanel({ filled, scanning }: { filled: number; scanning: boolean }) {
  return (
    <div className="rounded-[16px] border border-line-2 bg-surface-1 p-4" data-testid="analysis-frames">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{t('onb.analysis.frames.title')}</h2>
        <span className="num text-[12px] text-fg-3">{t('onb.analysis.frames.count', { n: filled })}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: ANALYSIS_FRAME_COUNT }, (_, i) => {
          const on = i < filled
          const last = scanning && i === filled - 1
          return on ? (
            <Thumb key={i} hue={(i * 47 + 20) % 360} className={cn('rounded-[6px]', last && 'onb-scan ring-2 ring-ink')}>
              <span className="num absolute bottom-0.5 left-1 text-[9.5px] font-medium text-white/85">{tc(i)}</span>
            </Thumb>
          ) : (
            <div key={i} aria-hidden className="aspect-video rounded-[6px] bg-surface-2" />
          )
        })}
      </div>
    </div>
  )
}

export function CompetitorsPanel({ shown }: { shown: number }) {
  return (
    <div className="rounded-[16px] border border-line-2 bg-surface-1 p-4" data-testid="analysis-competitors">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{t('onb.analysis.competitors.title')}</h2>
        <span className="num text-[12px] text-fg-3">{shown > 0 ? t('onb.analysis.competitors.count', { n: shown }) : t('onb.analysis.competitors.waiting')}</span>
      </div>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-3">
        {FOUND_COMPETITORS.map((c, i) => {
          const on = i < shown
          return (
            <li key={c.id} className={cn('flex min-w-0 items-center gap-2.5', on ? 'onb-pop' : 'opacity-0')} aria-hidden={!on}>
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-[#0a0a0a]"
                style={{ background: `oklch(0.76 0.08 ${c.hue})` }}
              >
                {c.initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] leading-tight font-medium text-fg">{c.name}</span>
                <span className="num block text-[11.5px] text-fg-3">{fmtCompact(c.subscribers)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AnalysisStep({ a, ready, setReady }: StepProps) {
  const { elapsed, skip } = useElapsed(ANALYSIS_TOTAL_MS)
  const finished = ready || elapsed >= ANALYSIS_TOTAL_MS
  const at = stageAt(finished ? ANALYSIS_TOTAL_MS : elapsed)
  useEffect(() => {
    if (elapsed >= ANALYSIS_TOTAL_MS && !ready) setReady(true)
  }, [elapsed, ready, setReady])
  const framesIdx = ANALYSIS_STEPS.findIndex((s) => s.id === 'frames')
  const compIdx = ANALYSIS_STEPS.findIndex((s) => s.id === 'competitors')
  const frames = Math.round(ANALYSIS_FRAME_COUNT * (at.progress[framesIdx] ?? 0))
  const competitors = Math.round(FOUND_COMPETITORS.length * (at.progress[compIdx] ?? 0))
  const pct = Math.round((Math.min(elapsed, ANALYSIS_TOTAL_MS) / ANALYSIS_TOTAL_MS) * 100)
  const kind = sourceKind(a)
  return (
    <div>
      <Question title={t(`onb.analysis.title.${kind}`)} hint={t('onb.analysis.hint')} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" data-testid="analysis" data-state={finished ? 'done' : 'running'}>
        <div>
          <Timeline progress={at.progress} current={finished ? -1 : at.current} />
          <div className="mt-7">
            <ProgressBar value={finished ? 100 : pct} tone="ink" />
            <div className="mt-2.5 flex items-center justify-between">
              <span className="num text-[12.5px] text-fg-3">{finished ? t('onb.analysis.finished') : t('onb.analysis.running', { pct })}</span>
              {!finished && (
                <button
                  type="button"
                  data-testid="onboarding-skip-analysis"
                  onClick={() => {
                    skip()
                    setReady(true)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <FastForward className="size-3.5" aria-hidden />
                  {t('onb.analysis.skip')}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <FramesPanel filled={frames} scanning={!finished && at.current === framesIdx} />
          <CompetitorsPanel shown={competitors} />
        </div>
      </div>
    </div>
  )
}
