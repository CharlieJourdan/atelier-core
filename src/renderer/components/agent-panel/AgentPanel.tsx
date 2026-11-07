// The right-hand panel of the shell: the main agent, one click away from every screen.
import { X } from 'lucide-react'
import { t } from '../../../shared/fr'
import { AgentAvatar } from '@/components/proto/kit'
import { principal, useProto, useProtoActions } from '@/proto/store'
import { AgentChat } from './AgentChat'

export function AgentPanel() {
  const state = useProto()
  const { setAgentPanel } = useProtoActions()
  if (!state.agentPanelOpen) return null
  const agent = principal(state)
  return (
    <aside
      data-testid="agent-panel"
      aria-label={agent.name}
      className="fade-in flex h-full w-[400px] shrink-0 flex-col border-t border-l border-line bg-bg"
    >
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <AgentAvatar agent={agent} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{agent.name}</p>
          <p className="truncate text-[11.5px] text-fg-3">{agent.task}</p>
        </div>
        <button
          type="button"
          aria-label={t('shell.agentPanel.close')}
          onClick={() => setAgentPanel(false)}
          className="no-drag flex size-7 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <AgentChat className="min-h-0 flex-1" compact />
    </aside>
  )
}
