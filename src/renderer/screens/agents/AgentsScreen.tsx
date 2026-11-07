// Agents (section `agents`): the grid of the team by department (state, model, latest task), the profile of an agent
// and the group rooms. All real: agents, routes, tasks and rooms come from the main process; "Écrire à" opens the real
// conversation (same thread as the Conversations screen) and the switch really enables / disables the agent.
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentRow, MemoryRow } from '../../../shared/agents'
import type { ConversationRow } from '../../../shared/chat'
import { t, type MessageKey } from '../../../shared/fr'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { call, errText, useApi, useLoader } from '@/state/client'
import { cn } from '@/lib/utils'
import type { ScreenProps } from '../registry'
import { AgentCard } from './AgentCard'
import { AgentProfile, AgentSheet } from './AgentSheet'
import { ChatDialog } from './ChatDialog'
import { buildAgentCards, buildRoomCards, groupByDepartment, type AgentCardData, type RoomCardData, type StateFilter } from './model'
import { RoomsPanel } from './RoomsPanel'

/** Real WebGL Orbs only for the agents at work (browsers cap WebGL contexts); the rest use the CSS stand-in. */
const MAX_LIVE_ORBS = 6

const FILTERS: readonly StateFilter[] = ['all', 'working', 'idle']
const FILTER_KEY: Record<StateFilter, MessageKey> = { all: 'agents.filter.all', working: 'agents.filter.working', idle: 'agents.filter.idle' }

export function TeamGrid({
  cards,
  query,
  state,
  selected,
  onQuery,
  onState,
  onOpen
}: {
  cards: readonly AgentCardData[]
  query: string
  state: StateFilter
  selected?: string | null
  onQuery: (q: string) => void
  onState: (s: StateFilter) => void
  onOpen: (agentId: string) => void
}) {
  const groups = groupByDepartment(cards, query, state, (d) => t(`chat.dept.${d}` as MessageKey))
  const working = cards.filter((c) => c.state === 'working').length
  let live = 0
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('agents.search')}
            aria-label={t('agents.search')}
            className="pl-9"
          />
        </div>
        <div role="group" className="inline-flex gap-0.5 rounded-full border border-line-2 bg-surface-1 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={state === f}
              onClick={() => onState(f)}
              className={cn(
                'h-7 rounded-full px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/70',
                state === f ? 'bg-ink text-ink-fg' : 'text-fg-3 hover:text-fg'
              )}
            >
              {t(FILTER_KEY[f])}
            </button>
          ))}
        </div>
        <p className="ml-auto text-[12px] text-fg-3" data-testid="agents-count">
          {cards.length === 1 ? t('agents.count.one') : t('agents.count', { n: cards.length })}
          {working > 0 ? ` · ${t('agents.working.now', { n: working })}` : ''}
        </p>
      </div>
      {cards.length === 0 ? (
        <EmptyState title={t('agents.empty.none.title')} blurb={t('agents.empty.none.blurb')} />
      ) : groups.length === 0 ? (
        <EmptyState title={t('agents.empty.title')} blurb={t('agents.empty.blurb')} />
      ) : (
        groups.map((g) => (
          <section key={g.department} aria-label={t(`chat.dept.${g.department}` as MessageKey)} className="flex flex-col gap-3" data-department={g.department}>
            <h2 className="micro-label">{t(`chat.dept.${g.department}` as MessageKey)}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {g.cards.map((c) => {
                const isLive = c.state === 'working' && live < MAX_LIVE_ORBS
                if (isLive) live += 1
                return <AgentCard key={c.agent.id} card={c} live={isLive} selected={selected === c.agent.id} onOpen={onOpen} />
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

const NO_AGENTS: readonly AgentRow[] = []
const NO_CONVERSATIONS: readonly ConversationRow[] = []

export function AgentsScreen({ onRoute }: ScreenProps) {
  const agents = useApi('agents.list', ['agents'])
  const routes = useApi('routes.list', ['routes'])
  const defaults = useApi('llm.defaults', ['routes', 'settings'])
  const conversations = useApi('chat.conversations', ['chat'])
  const rooms = useApi('chat.rooms', ['chat', 'channels', 'agents'])
  const channels = useLoader(() => call('channels.list'), 'agents-channels', ['channels'])
  const tasks = useLoader(() => call('tasks.list'), 'agents-tasks', ['videos', 'agents'])

  const [tab, setTab] = useState('team')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<StateFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [memory, setMemory] = useState<{ agentId: string; rows: MemoryRow[] | null; error: string | null } | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [chat, setChat] = useState<{ conversation: ConversationRow; title: string } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const cards = useMemo(
    () =>
      buildAgentCards({
        agents: agents.data ?? NO_AGENTS,
        routes: routes.data ?? [],
        defaults: defaults.data,
        tasks: tasks.data ?? []
      }),
    [agents.data, routes.data, defaults.data, tasks.data]
  )
  const roomCards = useMemo(
    () => buildRoomCards({ rooms: rooms.data ?? [], agents: agents.data ?? NO_AGENTS, conversations: conversations.data ?? NO_CONVERSATIONS }),
    [rooms.data, agents.data, conversations.data]
  )
  const channelNames = useMemo(() => Object.fromEntries((channels.data ?? []).map((c) => [c.id, c.name])), [channels.data])
  const current = cards.find((c) => c.agent.id === openId) ?? null

  const loadMemory = (agentId: string): void => {
    setMemory({ agentId, rows: null, error: null })
    call('agents.memory', agentId).then(
      (rows) => setMemory((m) => (m?.agentId === agentId ? { agentId, rows, error: null } : m)),
      (err: unknown) => setMemory((m) => (m?.agentId === agentId ? { agentId, rows: null, error: errText(err) } : m))
    )
  }
  const open = (agentId: string): void => {
    setOpenId(agentId)
    setSheetError(null)
    loadMemory(agentId)
  }

  const openChat = (input: Parameters<typeof call<'chat.open'>>[1], title: string): void => {
    call('chat.open', input).then(
      (conversation) => {
        setOpenId(null)
        setChat({ conversation, title })
        setPageError(null)
      },
      (err: unknown) => {
        const msg = `${t('agents.chat.openError')} : ${errText(err)}`
        setSheetError(msg)
        setPageError(msg)
      }
    )
  }
  const openRoom = (r: RoomCardData): void => {
    const { room } = r
    openChat(
      room.kind === 'manager'
        ? { kind: 'channel', channelId: room.channelId }
        : { kind: 'room', channelId: room.channelId, ...(room.department ? { department: room.department } : {}) },
      room.title
    )
  }

  const loading = !agents.data && !agents.error
  return (
    <PageShell section="agents" title={t('section.agents')} subtitle={t('agents.subtitle')}>
      {(pageError ?? agents.error) && <ErrorLine message={(pageError ?? agents.error) as string} onRetry={agents.reload} />}
      <Tabs value={tab} onValueChange={setTab} className="mt-2 flex flex-col gap-6">
        <TabsList className="self-start">
          <TabsTrigger value="team">{t('agents.tab.team')}</TabsTrigger>
          <TabsTrigger value="rooms">{t('agents.tab.rooms')}</TabsTrigger>
        </TabsList>
        <TabsContent value="team">
          {loading ? (
            <LoadingBlock rows={5} />
          ) : (
            <TeamGrid cards={cards} query={query} state={state} selected={openId} onQuery={setQuery} onState={setState} onOpen={open} />
          )}
        </TabsContent>
        <TabsContent value="rooms">
          {!rooms.data && !rooms.error ? <LoadingBlock rows={3} /> : <RoomsPanel rooms={roomCards} channelNames={channelNames} onOpen={openRoom} />}
        </TabsContent>
      </Tabs>

      <AgentSheet card={current} onClose={() => setOpenId(null)}>
        {current && (
          <AgentProfile
            card={current}
            memory={memory?.agentId === current.agent.id ? memory.rows : null}
            memoryError={memory?.agentId === current.agent.id ? memory.error : null}
            error={sheetError}
            actions={{
              write: () => openChat({ kind: 'agent', agentId: current.agent.id }, t('agents.chat.title', { name: current.agent.name })),
              setEnabled: (enabled) => {
                call('agents.update', current.agent.id, { enabled }).then(
                  () => setSheetError(null),
                  (err: unknown) => setSheetError(`${t('agents.update.error')} : ${errText(err)}`)
                )
              },
              forget: (id) => {
                call('agents.forget', id).then(
                  () => loadMemory(current.agent.id),
                  (err: unknown) => setSheetError(errText(err))
                )
              },
              openClaudeSettings: () => onRoute({ section: 'reglages', page: 'claude' })
            }}
          />
        )}
      </AgentSheet>
      <ChatDialog conversation={chat?.conversation ?? null} title={chat?.title ?? ''} agents={agents.data ?? NO_AGENTS} onClose={() => setChat(null)} />
    </PageShell>
  )
}
