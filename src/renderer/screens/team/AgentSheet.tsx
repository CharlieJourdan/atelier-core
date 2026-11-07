// The agent sheet: a 420 px panel on the right of the team screen. Profile (editable name), what the agent is doing now,
// instructions, model and effort, daily budget, routines, memory, journal and permissions. Edits live in the team store.
import { MessageSquare, Pencil, Trash2, X } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { AgentLook } from '../../../shared/mascot'
import { setLookOverride, useLookOverride } from '@/components/mascot/look-store'
import { MascotEditor } from '@/components/mascot/MascotEditor'
import { AgentAvatar, ChannelTag, Segmented, fmtAgo, fmtNum } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Switch, Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { EFFORTS, EFFORT_MODEL, EFFORT_WHY, MODEL_LABEL, type Effort, type Permissions } from '@/proto/data-team-agents'
import { AgentKnows, AgentTechnologies } from '@/components/orchestra/AgentRuntimePanels'
import { useLiveAgentDetail, useLiveAgentEdits, withLiveDetail } from '@/proto/live/agent-detail'
import { liveDriver } from '@/proto/live/registry'
import { channelOf } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import { LoadBar, ModelChip, NewTag, StatusText, restLabel } from './atoms'
import { detailOf, type TeamAgent } from './model'
import { teamActions, type AgentEdit } from './store'

type Tab = 'settings' | 'routines' | 'memory' | 'journal' | 'knows'

function FieldTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{children}</h3>
      {hint && <p className="mt-0.5 text-[12px] text-fg-3">{hint}</p>}
    </div>
  )
}

function Importance({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span role="img" aria-label={t(`team.sheet.importance.${level}` as MessageKey)} title={t(`team.sheet.importance.${level}` as MessageKey)} className="flex shrink-0 items-end gap-[2px]">
      {[1, 2, 3].map((i) => (
        <span key={i} aria-hidden className={cn('w-[3px] rounded-full', i <= level ? 'bg-fg-2' : 'bg-surface-3')} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  )
}

const PERMISSION_KEYS: { key: keyof Permissions; label: MessageKey; hint: MessageKey }[] = [
  { key: 'browser', label: 'team.sheet.perm.browser', hint: 'team.sheet.perm.browser.hint' },
  { key: 'computer', label: 'team.sheet.perm.computer', hint: 'team.sheet.perm.computer.hint' },
  { key: 'publish', label: 'team.sheet.perm.publish', hint: 'team.sheet.perm.publish.hint' }
]

export function AgentSheet({
  agent,
  agents,
  channels,
  edit,
  onClose,
  onOpenAgent,
  onWrite
}: {
  agent: TeamAgent
  agents: readonly TeamAgent[]
  channels: readonly ProtoChannel[]
  edit: AgentEdit | undefined
  onClose: () => void
  onOpenAgent: (id: string) => void
  onWrite: (agent: TeamAgent) => void
}) {
  const [tab, setTab] = useState<Tab>('settings')
  // Real mode: routines, memory and journal come from the runtime; edits go back to it too.
  const liveDetail = useLiveAgentDetail(agent)
  const pushLive = useLiveAgentEdits(agent)
  const merged = withLiveDetail(detailOf(agent, agents, channels, edit), liveDetail, agent.instructions, edit?.instructions)
  const detail = liveDetail
    ? {
        ...merged,
        routines: merged.routines.map((r) => ({ ...r, on: edit?.routines?.[r.id] ?? r.on })),
        memory: merged.memory.filter((m) => !edit?.deletedMemory?.includes(m.id))
      }
    : merged
  const channel = channelOf({ channels: [...channels] }, agent.channelId)
  // Real mode (a runtime behind the sheet): its technologies and « Ce que l'agent sait » come from it.
  const live = agent.liveId !== undefined && liveDriver() !== null ? agent.liveId : null
  const boss = agent.parentId ? agents.find((a) => a.id === agent.parentId) : undefined
  const set = (patch: AgentEdit) => {
    teamActions.editAgent(agent.id, patch)
    pushLive(patch)
  }
  // The mascot: shown at once on every screen (the look store), and kept on the agent in real mode.
  const chosenLook = useLookOverride(agent.id)
  const look = chosenLook === undefined ? agent.look : chosenLook
  const setLook = (next: AgentLook | null) => {
    setLookOverride(agent.id, next)
    pushLive({ look: next })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs: { value: Tab; label: string }[] = [
    { value: 'settings', label: t('team.sheet.tab.settings') },
    { value: 'routines', label: t('team.sheet.tab.routines') },
    { value: 'memory', label: t('team.sheet.tab.memory') },
    { value: 'journal', label: t('team.sheet.tab.journal') },
    ...(live !== null ? [{ value: 'knows' as const, label: t('team.sheet.tab.knows') }] : [])
  ]

  return (
    <aside
      data-testid="agent-sheet"
      data-agent={agent.id}
      aria-label={t('team.sheet.aria', { name: agent.name })}
      className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-full flex-col border-l border-line-2 bg-surface-1 shadow-[var(--shadow-pop)] animate-[fade-in_180ms_var(--ease-out)]"
    >
      <header className="shrink-0 border-b border-line px-5 pt-5 pb-4">
        <div className="flex items-start gap-3.5">
          <AgentAvatar agent={agent} size={56} />
          <div className="min-w-0 flex-1">
            <label className="group relative -ml-1 flex items-center">
              <span className="sr-only">{t('team.sheet.name')}</span>
              <input
                data-testid="agent-sheet-name"
                value={agent.name}
                onChange={(e) => set({ name: e.target.value })}
                className="w-full rounded-[8px] border border-transparent bg-transparent px-1 py-0.5 text-[18px] font-semibold tracking-[-0.018em] text-fg outline-none transition-colors hover:border-line-2 focus:border-line-3 focus:bg-surface-2"
              />
              <Pencil className="pointer-events-none absolute right-2 size-3.5 text-fg-4 group-focus-within:hidden" aria-hidden />
            </label>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
              <span>{agent.roleLabel}</span>
              {agent.isNew && <NewTag />}
              {channel && <ChannelTag channel={channel} />}
            </div>
            {boss && (
              <button type="button" onClick={() => onOpenAgent(boss.id)} className="mt-2 inline-flex items-center gap-1.5 rounded-full text-[12px] text-fg-3 outline-none transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
                {t('team.sheet.reportsTo')}
                <AgentAvatar agent={boss} size={16} showStatus={false} />
                <span className="font-medium text-fg-2">{boss.name}</span>
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} data-testid="agent-sheet-close" className="-mt-1 -mr-1 rounded-full p-1.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section className="rounded-[14px] border border-line-2 bg-surface-2 p-3.5" data-testid="agent-sheet-now">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{t('team.sheet.now')}</h3>
            <StatusText status={agent.status} />
          </div>
          <p className="mt-1.5 text-[13px] leading-[1.45] text-fg-2">{agent.task ?? t('team.sheet.nothing')}</p>
          <div className="mt-3 flex items-center gap-3">
            <LoadBar value={agent.load} className="flex-1" />
            <span className="num shrink-0 text-[11.5px] text-fg-3">
              {agent.load} % · {restLabel(agent.load)}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            <div>
              <dt className="text-fg-3">{t('team.col.tasks7d')}</dt>
              <dd className="num font-medium text-fg">{fmtNum(agent.tasksDone7d)}</dd>
            </div>
            <div>
              <dt className="text-fg-3">{t('team.col.memory')}</dt>
              <dd className="num font-medium text-fg">{fmtNum(agent.memoryItems)}</dd>
            </div>
            <div>
              <dt className="text-fg-3">{t('team.col.model')}</dt>
              <dd className="font-medium text-fg">{MODEL_LABEL[agent.model]}</dd>
            </div>
          </dl>
        </section>

        <Button className="mt-3 w-full" data-testid="agent-sheet-write" onClick={() => onWrite(agent)}>
          <MessageSquare className="size-4" aria-hidden />
          {t('team.sheet.write', { name: agent.name })}
        </Button>

        <div className="mt-5 flex">
          <Segmented size="sm" value={tab} options={tabs} onChange={setTab} className="w-full [&>button]:flex-1 [&>button]:px-2" />
        </div>

        <div className="mt-5" data-testid={`agent-sheet-tab-${tab}`}>
          {tab === 'settings' && (
            <div className="flex flex-col gap-6">
              <MascotEditor role={agent.role} look={look} colorIndex={agent.colorIndex} onChange={setLook} />

              <section>
                <FieldTitle hint={t('team.sheet.instructions.hint')}>{t('team.sheet.instructions')}</FieldTitle>
                <Textarea
                  data-testid="agent-sheet-instructions"
                  value={detail.instructions}
                  onChange={(e) => set({ instructions: e.target.value })}
                  className="min-h-[132px] resize-y bg-surface-2 text-[13px] leading-[1.5]"
                  aria-label={t('team.sheet.instructions')}
                />
              </section>

              <section>
                <FieldTitle>{t('team.sheet.effort')}</FieldTitle>
                <Segmented
                  size="sm"
                  value={agent.effort}
                  options={EFFORTS.map((e) => ({ value: e, label: t(`team.effort.${e}` as MessageKey) }))}
                  onChange={(e: Effort) => set({ effort: e })}
                  className="w-full [&>button]:flex-1"
                />
                <p className="mt-2.5 flex items-center gap-2 text-[12.5px] text-fg-2">
                  <ModelChip model={EFFORT_MODEL[agent.effort]} />
                  <span className="text-fg-3">{t('team.sheet.effort.maps', { model: MODEL_LABEL[EFFORT_MODEL[agent.effort]] })}</span>
                </p>
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-fg-3">{EFFORT_WHY[agent.effort]}</p>
              </section>

              {live !== null && <AgentTechnologies liveId={live} />}

              <section>
                <FieldTitle hint={t('team.sheet.budget.hint')}>{t('team.sheet.budget')}</FieldTitle>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={20}
                    max={1000}
                    step={10}
                    value={detail.budgetPerDay}
                    aria-label={t('team.sheet.budget')}
                    onChange={(e) => set({ budget: Number(e.target.value) })}
                    className="h-1 flex-1 cursor-pointer accent-[var(--ink)]"
                  />
                  <span className="num w-[108px] text-right text-[13px] font-medium text-fg">{t('team.sheet.budget.value', { n: fmtNum(detail.budgetPerDay) })}</span>
                </div>
              </section>

              <section>
                <FieldTitle hint={t('team.sheet.perm.hint')}>{t('team.sheet.perm')}</FieldTitle>
                <ul className="divide-y divide-line rounded-[12px] border border-line-2">
                  {PERMISSION_KEYS.map((p) => (
                    <li key={p.key} className="flex items-center gap-3 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-fg">{t(p.label)}</p>
                        <p className="text-[12px] text-fg-3">{t(p.hint)}</p>
                      </div>
                      <Switch checked={detail.permissions[p.key]} onCheckedChange={(v) => set({ permissions: { [p.key]: v } })} aria-label={t(p.label)} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {tab === 'routines' && (
            <section>
              <FieldTitle hint={t('team.sheet.routines.hint')}>{t('team.sheet.routines')}</FieldTitle>
              <ul className="divide-y divide-line rounded-[12px] border border-line-2" data-testid="agent-routines">
                {detail.routines.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-[13px] font-medium', r.on ? 'text-fg' : 'text-fg-3')}>{r.label}</p>
                      <p className="text-[12px] text-fg-3">{r.schedule}</p>
                    </div>
                    <Switch checked={r.on} onCheckedChange={(v) => set({ routines: { [r.id]: v } })} aria-label={r.label} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === 'memory' && (
            <section>
              <FieldTitle hint={t('team.sheet.memory.hint', { n: fmtNum(agent.memoryItems) })}>{t('team.sheet.memory')}</FieldTitle>
              {detail.memory.length === 0 ? (
                <p className="rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-[12.5px] text-fg-3">{t('team.sheet.memory.empty')}</p>
              ) : (
                <ul className="divide-y divide-line rounded-[12px] border border-line-2" data-testid="agent-memory">
                  {[...detail.memory]
                    .sort((a, b) => b.importance - a.importance)
                    .map((m) => (
                      <li key={m.id} className="group flex items-start gap-3 px-3.5 py-3">
                        <div className="mt-1">
                          <Importance level={m.importance} />
                        </div>
                        <p className="min-w-0 flex-1 text-[13px] leading-[1.45] text-fg-2">{m.text}</p>
                        <button
                          type="button"
                          aria-label={t('team.sheet.memory.forget')}
                          title={t('team.sheet.memory.forget')}
                          onClick={() => set({ deletedMemory: [m.id] })}
                          className="rounded-full p-1 text-fg-4 transition-colors hover:bg-hover hover:text-fg focus-visible:text-fg"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'knows' && live !== null && <AgentKnows liveId={live} />}

          {tab === 'journal' && (
            <section>
              <FieldTitle hint={t('team.sheet.journal.hint')}>{t('team.sheet.journal')}</FieldTitle>
              <ol className="relative ml-1.5 border-l border-line-2 pl-5" data-testid="agent-journal">
                {detail.journal.map((j) => (
                  <li key={j.id} className="relative pb-4 last:pb-0">
                    <span aria-hidden className="absolute top-[7px] -left-[25px] size-[9px] rounded-full border-2 border-surface-1 bg-fg-4" />
                    <p className="text-[13px] leading-[1.45] text-fg-2">{j.text}</p>
                    <p className="num mt-0.5 text-[11.5px] text-fg-3">{fmtAgo(j.minutesAgo)}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </aside>
  )
}
