// Équipe (section `agents`): the whole team as employees. Org chart, per-channel table, load view, the agent sheet,
// recruiting, and the engine strip (accounts, queue, watchdog) at the bottom. In real mode: the team's switch on top and
// the live « Activité » tab (docs/AGENT-RUNTIME.md §25).
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { t } from '../../../shared/fr'
import { ActivityView } from '@/components/orchestra/ActivityView'
import { SubscriptionLock } from '@/components/orchestra/SubscriptionLock'
import { TeamPower } from '@/components/orchestra/TeamPower'
import { ProtoPage } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { PRINCIPAL_ID } from '@/proto/store'
import type { ScreenProps } from '../registry'
import { AgentSheet } from './AgentSheet'
import { ViewTabs } from './atoms'
import { BlueprintBar } from './BlueprintBar'
import { ByChannel } from './ByChannel'
import { EngineStrip } from './EngineStrip'
import { LoadView } from './LoadView'
import { dmThreadId, useTeamAgents, type TeamAgent } from './model'
import { OrgChart } from './OrgChart'
import { RecruitDialog } from './RecruitDialog'
import { teamActions } from './store'

type View = 'chart' | 'byChannel' | 'load' | 'activity'

export function TeamScreen({ onRoute }: ScreenProps) {
  const { state, team, agents } = useTeamAgents()
  const [view, setView] = useState<View>('chart')
  const [openId, setOpenId] = useState<string | null>(null)
  const [recruitOpen, setRecruitOpen] = useState(false)

  const scope = state.scope
  const principalAgent = agents.find((a) => a.id === PRINCIPAL_ID) ?? (agents[0] as TeamAgent)
  const channels = scope === 'all' ? state.channels : state.channels.filter((c) => c.id === scope)
  const visible = scope === 'all' ? agents : agents.filter((a) => a.channelId === scope || a.id === PRINCIPAL_ID)
  const workers = visible.filter((a) => a.id !== PRINCIPAL_ID)
  const working = visible.filter((a) => a.status === 'working').length
  const videosRunning = state.videos.filter((v) => v.status === 'running' && (scope === 'all' || v.channelId === scope)).length
  const waitingForUser = state.inbox.filter((i) => scope === 'all' || i.channelId === scope).length
  const opened = openId ? agents.find((a) => a.id === openId) : undefined

  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), [])
  const close = useCallback(() => setOpenId(null), [])
  const write = useCallback(
    (agent: TeamAgent) => {
      teamActions.selectThread(dmThreadId(agent))
      onRoute({ section: 'conversations' })
    },
    [onRoute]
  )

  return (
    <div className="relative h-full min-h-0">
      <ProtoPage
        testId="view-agents"
        wide
        title={t('section.agents')}
        subtitle={t('team.subtitle', { n: workers.length + 1, working, waiting: waitingForUser })}
        actions={
          <Button data-testid="agents-recruit" onClick={() => setRecruitOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('team.recruit')}
          </Button>
        }
      >
        {state.mode === 'live' && <SubscriptionLock className="mb-4" />}
        {state.mode === 'live' && <TeamPower />}
        <BlueprintBar />
        <div className="mb-6">
          <ViewTabs
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: t('team.view.chart'), testId: 'agents-view-chart' },
              { value: 'byChannel', label: t('team.view.byChannel'), testId: 'agents-view-bychannel' },
              { value: 'load', label: t('team.view.load'), testId: 'agents-view-load' },
              { value: 'activity', label: t('team.view.activity'), testId: 'agents-view-activity' }
            ]}
          />
        </div>

        {view === 'chart' && (
          <OrgChart
            agents={visible}
            channels={channels}
            principalAgent={principalAgent}
            activeId={openId}
            onOpen={toggle}
            videosRunning={videosRunning}
            waitingForUser={waitingForUser}
            showShared={scope === 'all'}
          />
        )}
        {view === 'byChannel' && <ByChannel agents={visible} channels={channels} principalAgent={principalAgent} activeId={openId} onOpen={toggle} showShared={scope === 'all'} />}
        {view === 'load' && <LoadView agents={visible} channels={channels} principalAgent={principalAgent} />}
        {view === 'activity' &&
          (state.mode === 'live' ? <ActivityView onAnswer={() => onRoute({ section: 'validations' })} /> : <p className="text-[13px] text-fg-3">{t('auto.desktopOnly')}</p>)}

        <EngineStrip accounts={state.accounts} videos={state.videos} inbox={state.inbox} agents={agents} live={state.mode === 'live' ? state.live.status : undefined} />
      </ProtoPage>

      {opened && <AgentSheet key={opened.id} agent={opened} agents={agents} channels={state.channels} edit={team.edits[opened.id]} onClose={close} onOpenAgent={setOpenId} onWrite={write} />}

      <RecruitDialog
        open={recruitOpen}
        onOpenChange={setRecruitOpen}
        channels={state.channels}
        agents={agents}
        defaultChannelId={scope === 'all' ? null : scope}
        principalId={PRINCIPAL_ID}
        onRecruited={(id) => {
          setView('chart')
          requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-testid="agent-card-${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })))
        }}
      />
    </div>
  )
}
