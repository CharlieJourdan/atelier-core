// Right column of the dashboard: the main agent's chat, the channels with their numbers, and the engine (the
// Claude Code / Codex subscriptions that run the agents, and the credits left).
import { AgentChat } from '@/components/agent-panel/AgentChat'
import { AgentAvatar, ChannelAvatar, fmtCompact, fmtNum, ProgressBar, SectionHead } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { principal, useProto } from '@/proto/store'
import type { EngineAccount, ProtoChannel } from '@/proto/types'
import { t } from '../../../shared/fr'
import type { Route } from '../../../shared/sections'
import { addChannel } from '../channels/add-intent'
import { channelsInScope } from './home-model'
import { Trend } from './Kpis'

export function AgentCard() {
  const state = useProto()
  const agent = principal(state)
  return (
    <section data-testid="home-agent" aria-label={agent.name} className="flex h-[520px] flex-col overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <AgentAvatar agent={agent} size={32} showStatus={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-fg">{agent.name}</p>
          <p className="truncate text-[12px] text-fg-3">{agent.task}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-fg-3">
          <span aria-hidden className="size-1.5 rounded-full bg-ok" />
          {t('home.dash.online')}
        </span>
      </header>
      <AgentChat className="min-h-0 flex-1" compact />
    </section>
  )
}

function ChannelRow({ channel, onRoute }: { channel: ProtoChannel; onRoute: (r: Route) => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid="home-channel" data-connected={channel.connected}>
      <ChannelAvatar channel={channel} size={26} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg">{channel.name}</p>
        <p className="num truncate text-[12px] text-fg-3">{t('home.dash.subs', { n: fmtCompact(channel.subscribers) })}</p>
      </div>
      {channel.connected ? (
        <div className="shrink-0 text-right">
          <p className="num text-[13px] font-medium text-fg">{t('home.dash.views28', { n: fmtCompact(channel.views28d) })}</p>
          <Trend value={channel.trend} />
        </div>
      ) : (
        <button type="button" onClick={() => onRoute({ section: 'chaines' })} className="shrink-0 text-right text-[12px] text-fg-3 hover:text-fg">
          <span className="block">{t('home.dash.notConnected')}</span>
          <span className="font-medium text-fg-2 underline-offset-4 hover:underline">{t('home.dash.connect.action')}</span>
        </button>
      )}
    </li>
  )
}

export function ChannelsCard({ onRoute }: { onRoute: (r: Route) => void }) {
  const state = useProto()
  const channels = channelsInScope(state.channels, state.scope)
  return (
    <section data-testid="home-channels" aria-label={t('home.dash.channels')}>
      <SectionHead
        title={t('home.dash.channels')}
        action={
          <button type="button" onClick={() => onRoute({ section: 'chaines' })} className="text-[12.5px] font-medium text-fg-3 hover:text-fg">
            {t('home.dash.manage')}
          </button>
        }
      />
      {channels.length === 0 ? (
        // the beta: an empty workspace says what to do next instead of showing nothing
        <div data-testid="home-channels-empty" className="rounded-[16px] border border-dashed border-line-2 px-4 py-5 text-center">
          <p className="text-[13px] font-medium text-fg">{t('beta.empty.channels.title')}</p>
          <p className="mt-1 text-[12.5px] text-fg-3">{t('beta.empty.channels.blurb')}</p>
          <button
            type="button"
            data-testid="home-add-channel"
            onClick={() => addChannel(onRoute)}
            className="mt-3 rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-medium text-brand-ink outline-none transition-colors duration-150 hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('beta.empty.channels.action')}
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} onRoute={onRoute} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-fg-3">
        <span>{label}</span>
        <span className="num text-fg-2">{value} %</span>
      </div>
      <ProgressBar value={value} tone={value >= 85 ? 'warn' : 'ink'} className="h-[3px]" />
    </div>
  )
}

function AccountRow({ account }: { account: EngineAccount }) {
  return (
    <li className="px-4 py-3" data-testid="engine-account" data-status={account.status}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-fg">{account.label}</p>
        <p className="shrink-0 text-[12px] text-fg-3">
          {account.status === 'limited' ? <span className="text-warn">{t('home.dash.engine.limited')} · </span> : null}
          {account.owner}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Meter label={t('home.dash.engine.window')} value={account.usage5h} />
        <Meter label={t('home.dash.engine.week')} value={account.usageWeek} />
      </div>
    </li>
  )
}

export function EngineCard({ onRoute }: { onRoute: (r: Route) => void }) {
  const state = useProto()
  const { credits, creditsMonthly, cloud } = state.workspace
  // real mode: the Cloud account's credits, no monthly allowance to compare with; offline: no credits at all
  const left = creditsMonthly > 0 ? Math.max(0, Math.min(100, (credits / creditsMonthly) * 100)) : null
  return (
    <section data-testid="home-engine" aria-label={t('home.dash.engine')}>
      <SectionHead
        title={t('home.dash.engine')}
        action={
          <button type="button" onClick={() => onRoute({ section: 'reglages', page: 'moteur' })} className="text-[12.5px] font-medium text-fg-3 hover:text-fg">
            {t('home.dash.manage')}
          </button>
        }
      />
      <div className="overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
        <p className="border-b border-line px-4 py-2.5 text-[12px] text-fg-3">{t('home.dash.engine.hint')}</p>
        <ul className="divide-y divide-line">
          {state.accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </ul>
        <div className="border-t border-line px-4 py-3" data-testid="engine-credits">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-fg">{t('home.dash.credits')}</p>
            <p className="num text-[12px] text-fg-3">
              {cloud === 'offline' ? (
                t('beta.account.offline.sub')
              ) : (
                <>
                  <span className={cn('font-medium', left !== null && left < 15 ? 'text-warn' : 'text-fg')}>{fmtNum(credits)}</span>
                  {left !== null && <> / {fmtNum(creditsMonthly)}</>}
                </>
              )}
            </p>
          </div>
          {left !== null && <ProgressBar value={left} className="h-[3px]" />}
        </div>
      </div>
    </section>
  )
}
