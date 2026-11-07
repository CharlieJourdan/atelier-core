// Accueil (route `accueil`): a summary dashboard more than a page. What waits for the user (with the action inline),
// the videos in production and how far they are, the coming week; on the right the main agent's chat, the channels and
// the engine. Everything reads the proto store and follows the global channel scope.
import { t } from '../../../shared/fr'
import { ProtoPage } from '@/components/proto/kit'
import { inScope, useProto } from '@/proto/store'
import type { ScreenProps } from '../registry'
import { channelsInScope, daypart, kpisOf, productionVideos, runningCount } from './home-model'
import { FirstChannel } from './FirstChannel'
import { InboxSection } from './InboxSection'
import { ConnectRow, KpiRow } from './Kpis'
import { ProductionSection } from './ProductionSection'
import { AgentCard, ChannelsCard, EngineCard } from './SideColumn'
import { WeekStrip } from './WeekStrip'

const GREETING = { morning: 'home.dash.hello.morning', afternoon: 'home.dash.hello.afternoon', evening: 'home.dash.hello.evening' } as const

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** One sentence in the voice of the main agent: « 4 vidéos avancent, 3 choses t’attendent. » */
export function summaryLine(running: number, waiting: number): string {
  const a = running === 0 ? t('home.dash.sum.running.none') : t(running === 1 ? 'home.dash.sum.running.one' : 'home.dash.sum.running.other', { n: running })
  const b = waiting === 0 ? t('home.dash.sum.waiting.none') : t(waiting === 1 ? 'home.dash.sum.waiting.one' : 'home.dash.sum.waiting.other', { n: waiting })
  return `${capitalize(a)}, ${b}.`
}

export function HomeScreen({ onRoute, now = new Date() }: ScreenProps & { now?: Date }) {
  const state = useProto()
  const inbox = inScope(state.inbox, state.scope)
  const inProduction = productionVideos(state.videos, state.scope)
  const channels = channelsInScope(state.channels, state.scope)
  const kpis = kpisOf(channels, state.videos)
  const owner = state.workspace.members.find((m) => m.role === 'owner')?.name ?? ''
  const running = runningCount(inProduction)

  return (
    <ProtoPage
      testId="view-accueil"
      wide
      title={`${t(GREETING[daypart(now)])}${owner ? ` ${owner}` : ''}`}
      subtitle={<span data-testid="home-summary">{summaryLine(running, inbox.length)}</span>}
    >
      <div className="@container">
        {state.mode === 'live' && state.live.syncedAt !== null && state.channels.length === 0 ? (
          <FirstChannel onRoute={onRoute} />
        ) : kpis ? (
          <KpiRow kpis={kpis} scopeKey={state.scope} />
        ) : (
          <ConnectRow onRoute={onRoute} />
        )}
        <div className="grid gap-x-8 gap-y-8 @[1020px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-8">
            <InboxSection items={inbox} />
            <ProductionSection videos={inProduction} onRoute={onRoute} />
            <WeekStrip onRoute={onRoute} today={now} />
          </div>
          <aside className="min-w-0 space-y-8" aria-label={t('home.dash.side')}>
            {!state.agentPanelOpen && <AgentCard />}
            <ChannelsCard onRoute={onRoute} />
            <EngineCard onRoute={onRoute} />
          </aside>
        </div>
      </div>
    </ProtoPage>
  )
}
