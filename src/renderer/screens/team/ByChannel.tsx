// Par chaîne: a table-like list of every agent, grouped by channel (agent, role, status, current task, model,
// tasks over 7 days, memory items, load). A row opens the agent sheet.
import type * as React from 'react'
import { t } from '../../../shared/fr'
import { AgentAvatar, ChannelAvatar, fmtNum } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { channelColorVar } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import { LoadBar, ModelChip, NewTag, StatusText } from './atoms'
import { averageLoad, type TeamAgent } from './model'

const COLS = 'grid-cols-[minmax(140px,1fr)_minmax(160px,1fr)_150px_minmax(190px,1.6fr)_70px_80px_72px_112px]'

function HeaderRow() {
  return (
    <div className={cn('grid items-center gap-x-4 px-4 pb-1.5 text-[11.5px] font-medium text-fg-3', COLS)} role="row">
      <span>{t('team.col.agent')}</span>
      <span>{t('team.col.role')}</span>
      <span>{t('team.col.status')}</span>
      <span>{t('team.col.task')}</span>
      <span>{t('team.col.model')}</span>
      <span className="text-right">{t('team.col.tasks7d')}</span>
      <span className="text-right">{t('team.col.memory')}</span>
      <span>{t('team.col.load')}</span>
    </div>
  )
}

function Row({ agent, onOpen, active }: { agent: TeamAgent; onOpen: (id: string) => void; active: boolean }) {
  return (
    <button
      type="button"
      role="row"
      data-testid={`agent-row-${agent.id}`}
      aria-pressed={active}
      onClick={() => onOpen(agent.id)}
      className={cn(
        'grid w-full items-center gap-x-4 border-t border-line px-4 py-2.5 text-left transition-colors outline-none first:border-t-0 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        COLS,
        active && 'bg-selected'
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar agent={agent} size={24} showStatus={false} />
        <span className="truncate text-[13px] font-medium text-fg">{agent.name}</span>
        {agent.isNew && <NewTag />}
      </span>
      <span className="truncate text-[12.5px] text-fg-2">{agent.roleLabel}</span>
      <StatusText status={agent.status} />
      <span className="truncate text-[12.5px] text-fg-2">{agent.task ?? '—'}</span>
      <ModelChip model={agent.model} className="justify-self-start" />
      <span className="num text-right text-[12.5px] text-fg-2">{fmtNum(agent.tasksDone7d)}</span>
      <span className="num text-right text-[12.5px] text-fg-2">{fmtNum(agent.memoryItems)}</span>
      <span className="flex items-center gap-2">
        <LoadBar value={agent.load} className="flex-1" />
        <span className="num w-8 text-right text-[11.5px] text-fg-3">{agent.load} %</span>
      </span>
    </button>
  )
}

export function ByChannel({
  agents,
  channels,
  principalAgent,
  activeId,
  onOpen,
  showShared
}: {
  agents: readonly TeamAgent[]
  channels: readonly ProtoChannel[]
  principalAgent: TeamAgent
  activeId: string | null
  onOpen: (id: string) => void
  showShared: boolean
}) {
  const shared = showShared ? agents.filter((a) => a.channelId === null) : []
  return (
    <div role="table" aria-label={t('team.view.byChannel')} data-testid="team-by-channel" className="flex flex-col gap-5 overflow-x-auto pb-2">
      <div className="min-w-[1080px] flex flex-col gap-5">
        <HeaderRow />
        {shared.length > 0 && (
          <Group title={t('team.chart.shared')} count={shared.length} load={averageLoad(shared)} mark={<span className="size-2 rounded-full bg-fg-4" aria-hidden />}>
            {[principalAgent, ...shared.filter((a) => a.id !== principalAgent.id)].map((a) => (
              <Row key={a.id} agent={a} onOpen={onOpen} active={activeId === a.id} />
            ))}
          </Group>
        )}
        {channels.map((ch) => {
          const rows = agents.filter((a) => a.channelId === ch.id)
          return (
            <Group key={ch.id} title={ch.name} count={rows.length} load={averageLoad(rows)} mark={<ChannelAvatar channel={ch} size={18} />} color={channelColorVar(ch)} testId={`group-${ch.id}`}>
              {rows.map((a) => (
                <Row key={a.id} agent={a} onOpen={onOpen} active={activeId === a.id} />
              ))}
            </Group>
          )
        })}
      </div>
    </div>
  )
}

function Group({ title, count, load, mark, color, testId, children }: { title: string; count: number; load: number; mark: React.ReactNode; color?: string; testId?: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="overflow-hidden rounded-[16px] border border-line-2 bg-surface-1" style={color ? { borderTopColor: color, borderTopWidth: 2 } : undefined}>
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
        {mark}
        <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-fg">{title}</h2>
        <span className="text-[12px] text-fg-3">{t('team.group.count', { n: count })}</span>
        <span className="num ml-auto text-[12px] text-fg-3">{t('team.group.avgLoad', { n: load })}</span>
      </header>
      <div>{children}</div>
    </section>
  )
}
