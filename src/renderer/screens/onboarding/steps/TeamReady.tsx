// Step 8: the team assembles (orbs appear one by one in a small org chart), a summary of what was decided, and the
// option to carry the main agent on a phone through Discord.
import { MessageCircle } from 'lucide-react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/input'
import { useRoute } from '@/lib/router'
import { useIsLiveOnboarding } from '@/proto/live/use-onboarding-live'
import { cn } from '@/lib/utils'
import { TEAM_LEAD, TEAM_SPECIALISTS, type TeamMember } from '@/proto/data-onboarding'
import { useProto } from '@/proto/store'
import { channelNameOf, reportOf, sourceKind, type Answers, type StepProps } from '../model'
import { MiniOrb, Question, Tag, useElapsed } from '../parts'
import { SimBadge } from '../live/SimBadge'

const STEP_MS = 420

/** The specialists that are hired: a job the user does herself needs no specialist. */
export function hiredSpecialists(a: Answers): TeamMember[] {
  return TEAM_SPECIALISTS.filter((m) => {
    if (m.skippedWhen === 'script') return a.automation.script !== 'human'
    if (m.skippedWhen === 'packaging') return a.automation.packaging !== 'human'
    return true
  })
}

function Member({ m, size, shown, bold }: { m: TeamMember; size: number; shown: boolean; bold?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center text-center transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')} data-testid={`team-${m.id}`} data-shown={shown}>
      <span className={shown ? 'onb-pop' : ''}>
        <MiniOrb colorIndex={m.colorIndex} size={size} />
      </span>
      <span className={cn('mt-2 truncate text-fg', bold ? 'text-[15px] font-semibold' : 'text-[13px] font-medium')}>{m.name}</span>
      <span className="mt-0.5 max-w-[104px] text-[11.5px] leading-[1.3] text-fg-3">{t(m.roleKey)}</span>
    </div>
  )
}

export function TeamStep({ a, set, mode, next }: StepProps) {
  const live = useIsLiveOnboarding()
  const { navigate } = useRoute()
  const { channels, pipelines, principalName } = useProto()
  const specialists = hiredSpecialists(a)
  const total = 2 + specialists.length
  const { elapsed } = useElapsed(total * STEP_MS, 80)
  const shownCount = Math.min(total, Math.floor(elapsed / STEP_MS) + 1)
  const name = a.name.trim() || principalName
  const report = reportOf(a)
  const pipeline = pipelines.find((p) => p.id === report.pipelineId)
  const kind = sourceKind(a)
  const channelName = channelNameOf(a, channels)
  const skipped = TEAM_SPECIALISTS.filter((m) => !specialists.includes(m))
  const owner = 'Charlie'

  return (
    <div>
      <Question title={t('onb.team.title')} hint={t('onb.team.hint', { name })} />

      <div className="rounded-[16px] border border-line-2 bg-surface-1 px-4 pt-7 pb-6" data-testid="team-org" data-count={shownCount}>
        <div className="flex justify-center">
          <Member m={{ id: 'principal', name, roleKey: 'onb.team.role.principal', colorIndex: 0 }} size={72} shown={shownCount >= 1} bold />
        </div>
        <div aria-hidden className="mx-auto h-6 w-px bg-line-3" />
        <div className="flex justify-center">
          <Member m={TEAM_LEAD} size={52} shown={shownCount >= 2} />
        </div>
        <p className="mt-1 text-center text-[11.5px] text-fg-3">{t('onb.team.channel', { name: channelName })}</p>
        <div className="relative mt-5">
          <div aria-hidden className="absolute top-0 h-px bg-line-3" style={{ left: `${50 / specialists.length}%`, right: `${50 / specialists.length}%` }} />
          <div className="absolute -top-5 left-1/2 h-5 w-px bg-line-3" aria-hidden />
          <div className="flex">
            {specialists.map((m, i) => (
              <div key={m.id} className="flex min-w-0 flex-1 flex-col items-center">
                <span aria-hidden className="h-4 w-px bg-line-3" />
                <Member m={m} size={40} shown={shownCount >= 3 + i} />
              </div>
            ))}
          </div>
        </div>
        {skipped.length > 0 && <p className="mt-5 text-center text-[12.5px] text-fg-3">{t('onb.team.skipped', { who: skipped.map((m) => t(m.roleKey).toLowerCase()).join(', ') })}</p>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" data-testid="team-summary">
        {pipeline && <Tag>{pipeline.name}</Tag>}
        <Tag>{t('onb.team.sum.videos', { n: a.videosPerWeek })}</Tag>
        {a.shortsPerDay > 0 && <Tag>{t('onb.team.sum.shorts', { n: a.shortsPerDay })}</Tag>}
        <Tag>{t(`onb.team.sum.voice.${a.voice}`)}</Tag>
        <Tag>{t(`onb.publishing.${a.publishing}`)}</Tag>
        {a.googleConnected && kind === 'own' && <Tag tone="ok">{t('onb.team.sum.analytics')}</Tag>}
      </div>

      <div className="mt-6 flex items-center gap-4 rounded-[16px] border border-line-2 bg-surface-1 p-4" data-testid="team-discord">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-2 text-fg-2">
          <MessageCircle className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
            {t('onb.team.discord.title', { name })}
            {!live && <SimBadge />}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">{live ? t('onb.team.discord.real') : a.discord ? t('onb.team.discord.on', { owner }) : t('onb.team.discord.off')}</p>
        </div>
        {live ? (
          // Real mode: Discord is set up for real in Réglages › Discord (token, channels created for you, bridge switch).
          // The onboarding ends and the settings page opens.
          <Button
            size="sm"
            variant="secondary"
            data-testid="team-discord-link"
            onClick={() => {
              navigate({ section: 'reglages', page: 'discord' })
              next()
            }}
          >
            {t('onb.team.discord.configure')}
          </Button>
        ) : (
          <Switch aria-label={t('onb.team.discord.title', { name })} data-testid="team-discord-switch" checked={a.discord} onCheckedChange={(discord) => set({ discord })} />
        )}
      </div>
      {mode === 'add-channel' && <p className="mt-4 text-[12.5px] text-fg-3">{t('onb.team.addNote')}</p>}
    </div>
  )
}
