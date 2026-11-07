// The onboarding, full window (Apple style): one big question per screen for the essentials, grouped screens for the rest,
// then the team assembling. Reused to add a channel later (mode "add-channel" skips the agent and engine steps and creates
// the channel at the end). First run: shown by App while the workspace is not set up.
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { createElement, useState, type ComponentType, type KeyboardEvent } from 'react'
import { t } from '../../../shared/fr'
import { Logo } from '@/components/atelier/logo'
import { Button } from '@/components/ui/button'
import { IS_MAC } from '@/lib/platform'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { channelKey } from '@/proto/live/mapping'
import { useLiveSession } from '@/proto/live/use-onboarding-live'
import { useProto, useProtoActions } from '@/proto/store'
import { afterStep, buildChannel, initialAnswers, stepsOf, stepValid, type Answers, type FlowMode, type StepProps } from './model'
import { AnalysisStep } from './steps/Analysis'
import { ChannelStep } from './steps/Channel'
import { EngineStep } from './steps/Engine'
import { QuestionsStep } from './steps/Questions'
import { ReportStep } from './steps/Report'
import { TeamStep } from './steps/TeamReady'
import { TestVideoStep } from './steps/TestVideo'
import { WelcomeStep } from './steps/Welcome'
import { leaveStep } from './live/flow'
import { LiveAnalysisStep } from './live/LiveAnalysis'
import { LiveEngineStep } from './live/LiveEngine'
import { LiveQuestionsStep, LiveTeamStep } from './live/LiveExtras'
import { LiveReportStep } from './live/LiveReport'
import { LiveTestStep } from './live/LiveTest'
import './onboarding.css'

interface StepDef {
  Component: ComponentType<StepProps>
  /** Max width of the content column. */
  width: number
  /** Short content is centred; long content starts at the top. */
  center?: boolean
  /** The step has its own work to finish before "Continuer" (the analysis, the test video). */
  needsReady?: boolean
}

const STEPS: Record<number, StepDef> = {
  1: { Component: WelcomeStep, width: 560, center: true },
  2: { Component: EngineStep, width: 640 },
  3: { Component: ChannelStep, width: 680 },
  4: { Component: AnalysisStep, width: 980, needsReady: true },
  5: { Component: ReportStep, width: 1000 },
  6: { Component: QuestionsStep, width: 760 },
  7: { Component: TestVideoStep, width: 820, needsReady: true },
  8: { Component: TeamStep, width: 760 }
}

/** In real mode these steps are replaced by their real versions (the others get small real-mode additions inside). */
const LIVE_STEPS: Record<number, ComponentType<StepProps>> = { 2: LiveEngineStep, 4: LiveAnalysisStep, 5: LiveReportStep, 6: LiveQuestionsStep, 7: LiveTestStep, 8: LiveTeamStep }

function stepComponent(step: number, real: boolean): ComponentType<StepProps> {
  return (real ? LIVE_STEPS[step] : undefined) ?? (STEPS[step] ?? STEPS[1]!).Component
}

export function OnboardingFlow({ onDone, mode = 'first-run', onClose }: { onDone?: () => void; mode?: FlowMode; onClose?: () => void }) {
  const state = useProto()
  const { setOnboarded, setPrincipalName, addChannel, setScope } = useProtoActions()
  const live = useLiveSession()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const steps = stepsOf(mode)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(state.principalName))
  const [ready, setReadyState] = useState<Record<number, boolean>>({})
  const step = steps[index] ?? 1
  const def = STEPS[step] ?? STEPS[1]!
  // the last step, or « Plus tard » on the channel question (the first run ends there, with no channel)
  const last = afterStep(step, answers, mode) === 'finish'
  const later = step === 3 && last && answers.hasChannel === 'later'

  const set = (patch: Partial<Answers>): void => setAnswers((prev) => ({ ...prev, ...patch }))
  const setReady = (v: boolean): void => setReadyState((prev) => (prev[step] === v ? prev : { ...prev, [step]: v }))

  const canContinue = !busy && stepValid(step, answers) && (!def.needsReady || ready[step] === true)

  const advance = (): void => {
    if (last) {
      const name = answers.name.trim()
      if (name && mode === 'first-run') setPrincipalName(name)
      const channelId = later ? null : (live?.getState().channelId ?? null)
      // Real mode: the channel already exists in the database (the next snapshot brings it); demo: it is added now.
      if (channelId !== null) setScope(channelKey(channelId))
      else if (mode === 'add-channel') addChannel(buildChannel(answers, state))
      if (mode !== 'add-channel') setOnboarded(true)
      onDone?.()
      return
    }
    if (step === 1 && answers.name.trim()) setPrincipalName(answers.name.trim())
    setIndex((i) => Math.min(steps.length - 1, i + 1))
  }
  // Real mode: leaving a step may do real work first (create the channel, answer the analysis, make the pipeline).
  const next = (): void => {
    // « Plus tard »: nothing to create, the flow ends here
    if (!live || later) return advance()
    if (busy) return
    setBusy(true)
    setFailure(null)
    leaveStep(live, step, answers, state.channels)
      .then(advance, (err: unknown) => setFailure(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }
  const back = (): void => setIndex((i) => Math.max(0, i - 1))
  const skip = (): void => {
    if (mode === 'add-channel') {
      // « Annuler » creates nothing: real mode deletes the channel the flow already made (demo mode adds it only at the end)
      live?.discard().catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
      onClose?.()
    } else {
      setOnboarded(true)
      onDone?.()
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (e.key === 'Enter' && (step === 1 || step === 3) && target.tagName === 'INPUT' && canContinue) {
      e.preventDefault()
      next()
    }
  }

  const stepProps: StepProps = { a: answers, set, mode, next, ready: ready[step] === true, setReady, live }

  return (
    <div data-testid="onboarding" data-mode={mode} data-step={step} onKeyDown={onKeyDown} className="relative flex h-full min-h-0 flex-col bg-bg text-fg">
      <header className={cn('drag grid h-[var(--titlebar-h)] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 pl-5', IS_MAC ? 'pr-5' : 'pr-[140px]')}>
        <span className={cn('flex items-center gap-2', IS_MAC && 'pl-[60px]')}>
          <Logo size={20} />
          <span className="text-[13.5px] font-semibold tracking-[-0.014em]">{t('app.name')}</span>
        </span>
        <div className="no-drag flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label={t('onb.progress')} data-testid="onboarding-progress">
          {steps.map((s, i) => (
            <span key={s} data-done={i <= index} className={cn('h-[3px] w-8 rounded-full transition-colors duration-[240ms]', i <= index ? 'bg-ink' : 'bg-surface-3')} />
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="onboarding-skip"
            onClick={skip}
            className="no-drag rounded-full px-3 py-1.5 text-[13px] font-medium text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            {mode === 'add-channel' ? t('common.cancel') : t('onb.later')}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="flex min-h-full flex-col px-6 pt-4 pb-10">
          <div key={step} data-testid={`onboarding-step-${step}`} className={cn('fade-in mx-auto w-full', def.center ? 'my-auto' : 'pt-6')} style={{ maxWidth: def.width }}>
            {createElement(stepComponent(step, live !== null), stepProps)}
          </div>
        </div>
      </main>

      <footer className="flex h-[72px] shrink-0 items-center justify-between border-t border-line px-6">
        <div className="min-w-[120px]">
          {index > 0 && (
            <Button variant="ghost" data-testid="onboarding-back" onClick={back}>
              <ArrowLeft aria-hidden />
              {t('onb.back')}
            </Button>
          )}
        </div>
        {failure ? (
          <p role="alert" data-testid="onboarding-failure" className="max-w-[46ch] text-center text-[12.5px] text-err">
            {t('onb.live.failed', { error: failure })}
          </p>
        ) : (
          <p className="num hidden text-[12.5px] text-fg-3 sm:block">{busy ? t('onb.live.busy') : t('onb.step', { n: index + 1, total: steps.length })}</p>
        )}
        <div className="flex min-w-[120px] justify-end">
          <Button size="lg" data-testid={last ? 'onboarding-finish' : 'onboarding-next'} disabled={!canContinue} onClick={next}>
            {last ? (mode === 'add-channel' ? t('onb.finish.add') : t('onb.finish')) : t('onb.next')}
            {!last && <ArrowRight aria-hidden />}
          </Button>
        </div>
      </footer>
    </div>
  )
}
