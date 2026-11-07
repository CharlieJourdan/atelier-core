// Atlas beside the Pipeline and Projets pages (production-lab, Charlie 01/11: « quand on passe dans la partie Pipeline ou
// Projet, il y a Atlas »; never on the Lab): a panel on the page’s side on a wide window (≥ 1500 px), a small square in the corner on a
// narrow one (it opens the shell's agent panel). Hidden while the shell's agent panel is open: one Atlas at a time. The panel
// shows only in real mode: presentation mode's conversation is invented, and Production shows no invented data (production-2).
import { Maximize2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../../../shared/fr'
import { AgentChat } from '@/components/agent-panel/AgentChat'
import { AgentAvatar } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { principal, useProto, useProtoActions } from '@/proto/store'

export function WithAtlas({ children }: { children: ReactNode }) {
  const state = useProto()
  const { setAgentPanel } = useProtoActions()
  const agent = principal(state)
  const shown = !state.agentPanelOpen
  const panel = shown && state.mode === 'live'
  const label = t('lab.atlas.ask', { name: agent.name })
  return (
    <div className={cn('grid grid-cols-1 gap-8', panel && 'min-[1500px]:grid-cols-[minmax(0,1fr)_300px]')}>
      <div className="min-w-0">{children}</div>
      {panel && (
        <aside className="hidden min-[1500px]:block" data-testid="atlas-dock" aria-label={label}>
          <div className="card sticky top-0 flex h-[min(560px,calc(100vh-140px))] flex-col overflow-hidden p-0">
            <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <AgentAvatar agent={agent} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{agent.name}</p>
                <p className="truncate text-[11.5px] text-fg-3">{t('lab.atlas.hint')}</p>
              </div>
              <button
                type="button"
                aria-label={t('lab.atlas.open')}
                title={t('lab.atlas.open')}
                onClick={() => setAgentPanel(true)}
                className="flex size-7 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-fg"
              >
                <Maximize2 className="size-3.5" aria-hidden />
              </button>
            </header>
            <AgentChat className="min-h-0 flex-1" compact />
          </div>
        </aside>
      )}
      {shown && (
        <button
          type="button"
          data-testid="atlas-square"
          aria-label={label}
          title={label}
          onClick={() => setAgentPanel(true)}
          className={cn(
            'fixed right-6 bottom-6 z-30 flex size-14 items-center justify-center rounded-[18px] border border-line-2 bg-surface-pop shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-ring',
            panel && 'min-[1500px]:hidden'
          )}
        >
          <AgentAvatar agent={agent} size={32} />
        </button>
      )}
    </div>
  )
}
