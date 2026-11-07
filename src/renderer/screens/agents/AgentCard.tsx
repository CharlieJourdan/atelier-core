// One agent in the grid: Orb, name, department, state, route and its latest task.
import { t, type MessageKey } from '../../../shared/fr'
import { roleName } from '../../../shared/roles'
import { StateChip, type AgentState } from '@/components/atelier/primitives'
import { AgentOrb } from './AgentOrb'
import type { AgentCardData } from './model'
import { cn } from '@/lib/utils'

export function stateOf(c: AgentCardData): AgentState {
  return c.state === 'working' ? 'working' : c.state === 'waiting' ? 'waiting' : 'idle'
}

export function AgentCard({ card, live, selected, onOpen }: { card: AgentCardData; live: boolean; selected?: boolean; onOpen: (id: string) => void }) {
  const last = card.recent[0]
  return (
    <button
      type="button"
      data-testid="agent-card"
      data-agent={card.agent.id}
      data-state={card.state}
      aria-label={t('agents.card.open', { name: card.agent.name })}
      onClick={() => onOpen(card.agent.id)}
      className={cn(
        'group flex flex-col gap-3 rounded-card border bg-surface-1 p-4 text-left transition-colors duration-200 outline-none hover:border-line-3 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/60',
        selected ? 'border-brand/60' : 'border-line',
        card.state === 'off' && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-3">
        <AgentOrb index={card.index} live={live} thinking={card.state === 'working'} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-fg">{card.agent.name}</p>
          <p className="truncate text-[11.5px] text-fg-3">{roleName(card.agent.role)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {card.state === 'off' ? (
          <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-fg-3">{t('agents.state.off')}</span>
        ) : (
          <StateChip state={stateOf(card)} />
        )}
        <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-fg-2" title={card.model}>
          {t(`agents.tier.${card.tier}` as MessageKey)}
        </span>
      </div>
      <p className="line-clamp-1 text-[12px] text-fg-3">{last ? last.title : t('agents.card.noActivity')}</p>
    </button>
  )
}
