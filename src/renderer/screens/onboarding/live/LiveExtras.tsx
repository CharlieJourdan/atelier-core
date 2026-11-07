// Real mode additions to steps that stay mostly as they are: the questions (what is sent to the analysis, what is not) and
// the team (really created in the agent runtime, with the jobs the user does herself paused).
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { useLiveState } from '@/proto/live/use-onboarding-live'
import { useProto } from '@/proto/store'
import type { StepProps } from '../model'
import { QuestionsStep } from '../steps/Questions'
import { TeamStep } from '../steps/TeamReady'
import { liveDraftOf, pausedRolesOf } from './draft'
import { SimBadge } from './SimBadge'

export function LiveQuestionsStep(props: StepProps) {
  return (
    <div data-live="true">
      <p data-testid="live-questions-note" className="mb-5 flex flex-wrap items-center gap-2 rounded-[12px] bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.5] text-fg-2">
        <SimBadge />
        {t('onb.live.questions.note')}
      </p>
      <QuestionsStep {...props} />
    </div>
  )
}

export function LiveTeamStep(props: StepProps) {
  const { a, live } = props
  const state = useLiveState(live)
  const { channels } = useProto()
  const paused = pausedRolesOf(a)
  const key = paused.join(',')
  useEffect(() => {
    live?.setupTeam(key ? key.split(',') : []).catch(() => undefined)
  }, [live, key])
  const team = state?.team ?? []
  const idle = team.filter((m) => m.paused && state?.pausedRoles.includes(m.role)).map((m) => m.name)
  return (
    <div data-live="true">
      <TeamStep {...props} />
      <div data-testid="live-team" data-phase={state?.teamPhase ?? 'idle'} className="mt-4 rounded-[12px] bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.5] text-fg-2">
        {state?.teamPhase === 'done' ? (
          <>
            <p>{t('onb.live.team.ready', { n: team.length, channel: liveDraftOf(a, channels).name })}</p>
            {idle.length > 0 && <p className="mt-1 text-fg-3">{t('onb.live.team.paused', { who: idle.join(', ') })}</p>}
          </>
        ) : state?.teamPhase === 'error' ? (
          <>
            <p role="alert">{t('onb.live.failed', { error: state.error ?? '' })}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => void live?.setupTeam(paused).catch(() => undefined)}>
              {t('onb.live.retry')}
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t('onb.live.team.creating')}
          </p>
        )}
      </div>
    </div>
  )
}
