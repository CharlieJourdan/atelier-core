// Organigramme: the main agent on top, one column per channel (its Big Agent, then the specialists in a calm tree),
// and a column for the agents who serve every channel. Thin connector lines; click an agent to open its sheet.
import { Layers } from 'lucide-react'
import { t } from '../../../shared/fr'
import { AgentAvatar, ChannelAvatar } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { channelColorVar } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import { LoadBar, NewTag } from './atoms'
import { childrenOf, leadOf, withLeadsAsParents, type TeamAgent } from './model'

const COL_MIN = 200
/** Distance from the top of a node's row to the centre of its orb, where the elbow connector lands. */
const TICK_Y = '31px'

function Bus({ n }: { n: number }) {
  const w = 100 * n
  const stroke = { stroke: 'var(--line-3)', strokeWidth: 1, fill: 'none', vectorEffect: 'non-scaling-stroke' } as const
  return (
    <svg viewBox={`0 0 ${w} 28`} preserveAspectRatio="none" className="block h-7 w-full" aria-hidden data-testid="org-bus">
      <path d={`M${w / 2} 0V${n > 1 ? 14 : 28}`} {...stroke} />
      {n > 1 && <path d={`M50 14H${w - 50}`} {...stroke} />}
      {n > 1 && Array.from({ length: n }, (_, i) => <path key={i} d={`M${50 + 100 * i} 14V28`} {...stroke} />)}
    </svg>
  )
}

function Node({ agent, onOpen, active }: { agent: TeamAgent; onOpen: (id: string) => void; active: boolean }) {
  return (
    <button
      type="button"
      data-testid={`agent-card-${agent.id}`}
      data-status={agent.status}
      aria-pressed={active}
      onClick={() => onOpen(agent.id)}
      className={cn(
        'block w-full rounded-[12px] border bg-surface-1 px-3 py-[7px] text-left transition-colors duration-150 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
        active ? 'border-line-3 bg-selected' : 'border-line-2'
      )}
    >
      <span className="flex items-center gap-2.5">
        <AgentAvatar agent={agent} size={24} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-fg">{agent.name}</span>
            {agent.isNew && <NewTag />}
          </span>
          <span className="block truncate text-[11.5px] text-fg-3">{agent.roleLabel}</span>
        </span>
      </span>
      <span className="mt-1.5 block truncate text-[12px] text-fg-2">{agent.task ?? t('team.chart.free')}</span>
      <LoadLine value={agent.load} />
    </button>
  )
}

function LoadLine({ value }: { value: number }) {
  return (
    <span className="mt-2 flex items-center gap-2">
      <LoadBar value={value} className="flex-1" />
      <span className="num w-8 shrink-0 text-right text-[10.5px] text-fg-3">{value} %</span>
    </span>
  )
}

function Elbow({ last }: { last: boolean }) {
  return (
    <>
      <span aria-hidden className={cn('absolute left-0 w-px bg-line-3', last ? 'top-0' : 'inset-y-0')} style={last ? { height: TICK_Y } : undefined} />
      <span aria-hidden className="absolute left-0 h-px w-3 bg-line-3" style={{ top: TICK_Y }} />
    </>
  )
}

/** A vertical list with elbow connectors; nested agents (the team of a production supervisor) indent once more. */
function Tree({ agents, parentId, onOpen, activeId }: { agents: readonly TeamAgent[]; parentId: string; onOpen: (id: string) => void; activeId: string | null }) {
  const kids = childrenOf(agents, parentId)
  if (kids.length === 0) return null
  return (
    <ul className="ml-4">
      {kids.map((k, i) => (
        <li key={k.id} className="relative pt-1.5 pl-3">
          <Elbow last={i === kids.length - 1} />
          <Node agent={k} onOpen={onOpen} active={activeId === k.id} />
          <Tree agents={agents} parentId={k.id} onOpen={onOpen} activeId={activeId} />
        </li>
      ))}
    </ul>
  )
}

function LeadCard({ channel, lead, onOpen, active }: { channel: ProtoChannel; lead: TeamAgent | undefined; onOpen: (id: string) => void; active: boolean }) {
  return (
    <div className="rounded-[14px] border border-line-2 bg-surface-1" style={{ borderTopColor: channelColorVar(channel), borderTopWidth: 2 }}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <ChannelAvatar channel={channel} size={20} />
        <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-fg">{channel.name}</span>
      </div>
      {lead ? (
        <button
          type="button"
          data-testid={`agent-card-${lead.id}`}
          data-status={lead.status}
          aria-pressed={active}
          onClick={() => onOpen(lead.id)}
          className={cn('mt-1 block w-full rounded-b-[12px] px-3 pt-1.5 pb-2.5 text-left transition-colors outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring', active && 'bg-selected')}
        >
          <span className="flex items-center gap-2.5">
            <AgentAvatar agent={lead} size={32} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium text-fg">{lead.name}</span>
                {lead.isNew && <NewTag />}
              </span>
              <span className="block truncate text-[11.5px] text-fg-3">{t('team.chart.bigAgent')}</span>
            </span>
          </span>
          <span className="mt-1.5 block truncate text-[12px] text-fg-2">{lead.task ?? t('team.chart.free')}</span>
          <LoadLine value={lead.load} />
        </button>
      ) : (
        <p className="px-3 py-3 text-[12px] text-fg-3">{t('team.chart.noLead')}</p>
      )}
    </div>
  )
}

export function OrgChart({
  agents: rawAgents,
  channels,
  principalAgent,
  activeId,
  onOpen,
  videosRunning,
  waitingForUser,
  showShared
}: {
  agents: readonly TeamAgent[]
  channels: readonly ProtoChannel[]
  principalAgent: TeamAgent
  activeId: string | null
  onOpen: (id: string) => void
  videosRunning: number
  waitingForUser: number
  showShared: boolean
}) {
  const agents = withLeadsAsParents(rawAgents)
  const shared = showShared ? agents.filter((a) => a.channelId === null && a.id !== principalAgent.id) : []
  const n = Math.max(1, channels.length + (shared.length > 0 ? 1 : 0))
  return (
    <div className="overflow-x-auto pb-2" data-testid="org-chart">
      <div style={{ minWidth: n * COL_MIN }}>
        <button
          type="button"
          data-testid={`agent-card-${principalAgent.id}`}
          aria-pressed={activeId === principalAgent.id}
          onClick={() => onOpen(principalAgent.id)}
          className={cn(
            'mx-auto flex w-[min(440px,100%)] items-center gap-4 rounded-[18px] border bg-surface-1 px-5 py-4 text-left transition-colors outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
            activeId === principalAgent.id ? 'border-line-3 bg-selected' : 'border-line-2'
          )}
        >
          <AgentAvatar agent={principalAgent} size={56} />
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-semibold tracking-[-0.018em] text-fg">{principalAgent.name}</span>
            <span className="block text-[12.5px] text-fg-3">{t('role.principal')}</span>
            <span className="mt-1.5 block truncate text-[12.5px] text-fg-2">{principalAgent.task}</span>
            <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
              <span className="num">{t('team.chart.videosRunning', { n: videosRunning })}</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-warn" />
                <span className="num">{t('team.chart.waitingForYou', { n: waitingForUser })}</span>
              </span>
            </span>
          </span>
        </button>
        <Bus n={n} />
        <div className="grid gap-x-4" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {channels.map((ch) => {
            const lead = leadOf(agents, ch.id)
            return (
              <div key={ch.id} data-testid={`org-col-${ch.id}`} className="min-w-0">
                <LeadCard channel={ch} lead={lead} onOpen={onOpen} active={lead?.id === activeId} />
                {lead && <Tree agents={agents} parentId={lead.id} onOpen={onOpen} activeId={activeId} />}
              </div>
            )
          })}
          {shared.length > 0 && (
            <div data-testid="org-col-shared" className="min-w-0">
              <div className="rounded-[14px] border border-dashed border-line-3 px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface-3 text-fg-2">
                    <Layers className="size-3" aria-hidden />
                  </span>
                  <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{t('team.chart.shared')}</span>
                </span>
                <span className="mt-1 block text-[12px] text-fg-3">{t('team.chart.shared.hint')}</span>
              </div>
              <ul className="ml-4">
                {shared.map((k, i) => (
                  <li key={k.id} className="relative pt-1.5 pl-3">
                    <Elbow last={i === shared.length - 1} />
                    <Node agent={k} onOpen={onOpen} active={activeId === k.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
