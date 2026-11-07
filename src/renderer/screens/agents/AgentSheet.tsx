// The profile of one agent: role and instructions, route (model), cadence and tools, recent tasks, memory, and the
// actions that work (write to the agent, switch it on / off, forget a memory).
import { ExternalLink, MessageSquare } from 'lucide-react'
import type * as React from 'react'
import type { MemoryRow } from '../../../shared/agents'
import { t, type MessageKey } from '../../../shared/fr'
import { roleName } from '../../../shared/roles'
import { ErrorLine, fmtDate } from '@/components/atelier/kit'
import { Panel, StateChip } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/input'
import { stateOf } from './AgentCard'
import { AgentOrb } from './AgentOrb'
import type { AgentCardData } from './model'

const EXCERPT = 600

export function excerpt(text: string, max = EXCERPT): string {
  const s = text.trim()
  return s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`
}

export interface SheetActions {
  write: () => void
  setEnabled: (enabled: boolean) => void
  forget: (memoryId: number) => void
  openClaudeSettings: () => void
}

/** The body of the sheet (pure: data in, markup out). */
export function AgentProfile({
  card,
  memory,
  memoryError,
  error,
  actions
}: {
  card: AgentCardData
  memory: readonly MemoryRow[] | null
  memoryError?: string | null
  error?: string | null
  actions: SheetActions
}) {
  const a = card.agent
  return (
    <div className="flex flex-col gap-4" data-testid="agent-profile" data-agent={a.id}>
      <div className="flex items-center gap-4">
        <AgentOrb index={card.index} live thinking={card.state === 'working'} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {card.state !== 'off' && <StateChip state={stateOf(card)} />}
            {card.state === 'off' && <Badge variant="outline">{t('agents.state.off')}</Badge>}
            <Badge>{t(`chat.dept.${card.department}` as MessageKey)}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-fg-3">{roleName(a.role)}</p>
        </div>
        <Button variant="brand" onClick={actions.write}>
          <MessageSquare /> {t('agents.write', { name: a.name })}
        </Button>
      </div>
      {error && <ErrorLine message={error} />}

      <Panel
        title={t('agents.sheet.about')}
        action={<Badge variant={a.customized ? 'brand' : 'outline'}>{t(a.customized ? 'agents.sheet.customized' : 'agents.sheet.builtin')}</Badge>}
      >
        <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg-2">
          {a.instructions.trim() ? excerpt(a.instructions) : t('agents.sheet.noInstructions')}
        </p>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title={t('agents.sheet.route')}>
          <p className="text-[13px] text-fg" data-testid="agent-route">
            {t('agents.sheet.routeLine', {
              tier: t(`agents.tier.${card.tier}` as MessageKey),
              model: card.model || '—',
              provider: t(`agents.provider.${card.providerId}` as MessageKey)
            })}
          </p>
          <Button variant="link" size="sm" className="mt-2 h-auto px-0" onClick={actions.openClaudeSettings}>
            <ExternalLink /> {t('agents.sheet.routeEdit')}
          </Button>
        </Panel>
        <Panel title={t('agents.sheet.cadence')}>
          <p className="text-[13px] text-fg">{t(`agents.cadence.${a.cadence}` as MessageKey)}</p>
          <label className="mt-3 flex items-center justify-between gap-3">
            <span>
              <span className="block text-[12.5px] text-fg">{t('agents.sheet.enabled')}</span>
              <span className="block text-[11.5px] text-fg-3">{t('agents.sheet.enabled.hint')}</span>
            </span>
            <Switch checked={a.enabled} onCheckedChange={actions.setEnabled} aria-label={t('agents.sheet.enabled')} />
          </label>
        </Panel>
      </div>

      <Panel title={t('agents.sheet.tools')}>
        <div className="flex flex-wrap gap-1.5">
          {a.tools.length === 0 && !a.webSearch && <span className="text-[12.5px] text-fg-3">{t('agents.sheet.noTools')}</span>}
          {a.tools.map((tool) => (
            <Badge key={tool} variant="outline" className="font-mono">
              {tool}
            </Badge>
          ))}
          {a.webSearch && <Badge variant="outline">{t('agents.sheet.webSearch')}</Badge>}
        </div>
      </Panel>

      <Panel title={t('agents.sheet.activity')}>
        {card.recent.length === 0 ? (
          <p className="text-[12.5px] text-fg-3">{t('agents.card.noActivity')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {card.recent.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                <span className="min-w-0 truncate text-fg-2">{task.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-fg-3">
                  <Badge variant={task.status === 'failed' ? 'err' : task.status === 'done' ? 'ok' : 'default'}>
                    {t(`agents.task.status.${task.status}` as MessageKey)}
                  </Badge>
                  {fmtDate(task.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('agents.sheet.memory')}>
        {memoryError ? (
          <ErrorLine message={memoryError} />
        ) : memory === null ? (
          <p className="text-[12.5px] text-fg-3">{t('loading')}</p>
        ) : memory.length === 0 ? (
          <p className="text-[12.5px] text-fg-3">{t('agents.sheet.memoryEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memory.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 text-[12.5px]">
                <span className="text-fg-2">{m.content}</span>
                <Button variant="ghost" size="sm" onClick={() => actions.forget(m.id)}>
                  {t('agents.sheet.memoryForget')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="text-[11.5px] text-fg-3">{t('agents.sheet.spend')}</p>
    </div>
  )
}

export function AgentSheet({ card, onClose, children }: { card: AgentCardData | null; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open={card !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(760px,94vw)] max-w-none overflow-y-auto" closeLabel={t('agents.sheet.close')}>
        <DialogHeader>
          <DialogTitle>{card?.agent.name ?? ''}</DialogTitle>
          <DialogDescription>{card ? roleName(card.agent.role) : ''}</DialogDescription>
        </DialogHeader>
        {card && children}
      </DialogContent>
    </Dialog>
  )
}
