// The detail of one channel, in the page (back to the list): who does what, styles and pipelines, competitors, products and
// sponsors, rules, connections. Edits go to the proto store (automation, pipelines, products, Analytics) or to the small
// extras store (mix of styles, rules, watched competitors, other connections).
import { ArrowLeft, Languages } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { GOOGLE_SETTINGS_ROUTE } from '@/components/proto/GoogleCta'
import { ChannelAvatar } from '@/components/proto/kit'
import { GoalsPanel } from '@/components/orchestra/GoalsPanel'
import { MemoryBlockPanel } from '@/components/orchestra/MemoryBlockPanel'
import { cn } from '@/lib/utils'
import { useProto, useProtoActions } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import type { ScreenProps } from '../registry'
import { useChannelExtras } from './extras'
import { CompetitorsTab } from './CompetitorsTab'
import { AutomationTab, ConnectionsTab, ProductsTab, RulesTab } from './OtherTabs'
import { StylesTab } from './StylesTab'
import { ChannelLifeActions } from './ChannelLife'

export const DETAIL_TABS = ['automation', 'styles', 'competitors', 'products', 'rules', 'connections'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

const TAB_LABELS: Record<DetailTab, MessageKey> = {
  automation: 'chan.tab.automation',
  styles: 'chan.tab.styles',
  competitors: 'chan.tab.competitors',
  products: 'chan.tab.products',
  rules: 'chan.tab.rules',
  connections: 'chan.tab.connections'
}

export function isDetailTab(v: string | undefined): v is DetailTab {
  return !!v && (DETAIL_TABS as readonly string[]).includes(v)
}

export function ChannelDetail({ channel, tab, onTab, onBack, onRoute }: { channel: ProtoChannel; tab: DetailTab; onTab: (t: DetailTab) => void; onBack: () => void; onRoute: ScreenProps['onRoute'] }) {
  const state = useProto()
  const { updateChannel } = useProtoActions()
  const [extras, setExtras] = useChannelExtras(channel)
  const source = channel.translatedFrom ? state.channels.find((c) => c.id === channel.translatedFrom) : undefined
  return (
    <div data-testid="channel-detail" data-channel={channel.id}>
      <button
        type="button"
        data-testid="channel-back"
        onClick={onBack}
        className="-ml-2 mb-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('chan.back')}
      </button>
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <ChannelAvatar channel={channel} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="page-title truncate">{channel.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-fg-3">
            <span>{channel.handle}</span>
            <span aria-hidden>·</span>
            <span>{t(`onb.lang.${channel.language}`)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{channel.niche}</span>
            {source && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-0.5 text-[11.5px] text-fg-2">
                <Languages className="size-3" aria-hidden />
                {t('chan.translatedFrom', { name: source.name })}
              </span>
            )}
          </p>
        </div>
        <ChannelLifeActions channel={channel} onArchived={onBack} />
      </header>

      <div role="tablist" aria-label={channel.name} className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {DETAIL_TABS.map((id) => {
          const on = id === tab
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              data-testid={`channel-tab-${id}`}
              onClick={() => onTab(id)}
              className={cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13.5px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                on ? 'border-ink text-fg' : 'border-transparent text-fg-3 hover:text-fg'
              )}
            >
              {t(TAB_LABELS[id])}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" data-testid={`channel-panel-${tab}`} className="fade-in max-w-[860px]">
        {tab === 'automation' && /^db-\d+$/.test(channel.id) && <GoalsPanel key={channel.id} channelId={Number(channel.id.slice(3))} />}
        {/* a real channel has ONE system of validations, the goals' approval level above (QA C2); the step switches below are the examples' */}
        {tab === 'automation' && !/^db-\d+$/.test(channel.id) && <AutomationTab channel={channel} onChange={(automation) => updateChannel(channel.id, { automation })} />}
        {tab === 'styles' && (
          <StylesTab
            channel={channel}
            pipelines={state.pipelines}
            mix={extras.mix}
            onMix={(mix) => {
              setExtras({ mix })
              updateChannel(channel.id, { pipelineIds: Object.keys(mix) })
            }}
            onRoute={onRoute}
          />
        )}
        {tab === 'competitors' && <CompetitorsTab channel={channel} watched={extras.watched} onWatched={(watched) => setExtras({ watched })} />}
        {tab === 'products' && <ProductsTab channel={channel} onChange={(products) => updateChannel(channel.id, { products })} />}
        {tab === 'rules' && <RulesTab rules={extras.rules} onChange={(rules) => setExtras({ rules })} />}
        {tab === 'rules' && /^db-\d+$/.test(channel.id) && (
          <div className="mt-6">
            <MemoryBlockPanel key={channel.id} scope="channel" channelId={Number(channel.id.slice(3))} />
          </div>
        )}
        {tab === 'connections' && (
          <ConnectionsTab
            channel={channel}
            connections={extras.connections}
            onConnection={(id, on) => {
              // real mode: YouTube Analytics is the owner's Google account, connected in Réglages › Chaînes
              if (id === 'analytics' && state.mode === 'live') onRoute(GOOGLE_SETTINGS_ROUTE)
              else if (id === 'analytics') updateChannel(channel.id, { connected: on })
              else setExtras({ connections: { ...extras.connections, [id]: on ? 'on' : 'off' } })
            }}
          />
        )}
      </div>
    </div>
  )
}
