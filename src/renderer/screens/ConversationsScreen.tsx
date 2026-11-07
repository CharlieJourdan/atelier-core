// Conversations v2 (lot 12): the folder list on the left, the thread (Conversation / Message / Response) and the pill
// composer on the right. Lot 13 feeds it from the group engine: department rooms and channel Managers (`chat.rooms`),
// who answers in each conversation (Producteur, Chef d'équipe, Manager), several agents streaming at once, Stop.
import { useCallback, useMemo, useState } from 'react'
import type { ConversationRow } from '../../shared/chat'
import { agentIndex, buildFolders, departmentOf, type ListEntry } from '../../shared/chat-folders'
import type { MentionTarget, RoomInfo } from '../../shared/chat-rich'
import { t, type MessageKey } from '../../shared/fr'
import type { VideoRow } from '../../shared/workflow'
import { AgentDot, agentColors } from '@/components/atelier/primitives'
import { Composer } from '@/components/conversations/composer'
import { ConversationList } from '@/components/conversations/conversation-list'
import { Thread, type AuthorInfo } from '@/components/conversations/thread'
import { useThread } from '@/components/conversations/use-thread'
import { call, useApi, useLoader } from '@/state/client'
import { LazyOrb } from '@/vendor/elevenlabs-ui'

const NO_ROOMS: readonly RoomInfo[] = []
/** Department rooms and channel Managers of every active channel (group engine, lot 13). */
function useRooms(): readonly RoomInfo[] {
  return useApi('chat.rooms', ['chat', 'channels', 'agents']).data ?? NO_ROOMS
}

/** The lead's name in a conversation (its messages are written by the Supervisor's route). */
function leadName(kind: ConversationRow['kind']): MessageKey | null {
  return kind === 'video' ? 'chat.persona.producer' : kind === 'room' ? 'chat.persona.team_lead' : kind === 'channel' ? 'chat.persona.manager' : null
}

const NO_VIDEOS: readonly VideoRow[] = []
const prettify = (id: string): string => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function Header({
  conversation,
  name,
  index,
  faces
}: {
  conversation: ConversationRow
  name: string
  index: number
  /** Agents active in this conversation (who wrote or is writing), newest first. */
  faces: { id: string; name: string; index: number }[]
}) {
  const [a, b] = agentColors(index)
  return (
    <header className="no-drag flex h-14 shrink-0 items-center gap-3 border-b border-line px-6" data-testid="chat-header">
      <div className="size-9 shrink-0">
        <LazyOrb colors={[a, b]} agentState={null} />
      </div>
      <div className="min-w-0">
        <h1 id="title-conversations" className="truncate text-[15px] font-medium text-fg">
          {conversation.kind === 'supervisor' ? t('chat.supervisor') : conversation.title}
        </h1>
        <p className="text-[11.5px] text-fg-3">{`${t(`chat.kind.${conversation.kind}` as MessageKey)} · ${name}`}</p>
      </div>
      {faces.length > 0 && (
        <ul data-testid="chat-faces" aria-label={t('chat.members')} className="ml-auto flex -space-x-2">
          {faces.map((f) => (
            <li key={f.id} title={f.name} data-agent={f.id} className="rounded-full ring-2 ring-bg">
              <AgentDot index={f.index} size={24} />
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}

function Pane({
  conversation,
  agentName,
  mentions
}: {
  conversation: ConversationRow
  agentName: (id: string | null) => string
  mentions: MentionTarget[]
}) {
  const thread = useThread(conversation.id, conversation.unread)
  const defaultAgent = conversation.kind === 'agent' ? conversation.agentId : 'supervisor'
  const lead = leadName(conversation.kind)
  const author = useCallback(
    (id: string | null): AuthorInfo => {
      const agent = id ?? defaultAgent
      // In a video, a room or a channel the Supervisor's route answers under the lead's name.
      return { name: agent === 'supervisor' && lead ? t(lead) : agentName(agent), index: agentIndex(agent) }
    },
    [agentName, defaultAgent, lead]
  )
  const faces = useMemo(() => {
    const ids: string[] = []
    const add = (id: string | null | undefined): void => {
      if (id && !ids.includes(id)) ids.push(id)
    }
    for (const s of [...thread.streaming].reverse()) add(s.authorId)
    for (const m of [...thread.messages].reverse()) if (m.authorType === 'agent') add(m.authorId)
    return ids.slice(0, 6).map((id) => ({ id, name: author(id).name, index: agentIndex(id) }))
  }, [thread.streaming, thread.messages, author])
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-pane" data-conversation={conversation.id}>
      <Header conversation={conversation} name={author(null).name} index={agentIndex(defaultAgent)} faces={faces} />
      {thread.error && (
        <p role="alert" className="px-6 pt-2 text-[12.5px] text-err">
          {t('chat.error.load')} : {thread.error}
        </p>
      )}
      <Thread messages={thread.messages} streaming={thread.streaming} actions={thread.actions} author={author} />
      <Composer mentions={conversation.kind === 'agent' ? [] : mentions} onSend={thread.send} busy={thread.busy} onStop={thread.stop} />
    </div>
  )
}

export function ConversationsScreen() {
  const conversations = useApi('chat.conversations', ['chat'])
  const channels = useLoader(() => call('channels.list'), 'channels', ['channels'])
  const videosLoaded = useLoader(() => call('videos.list'), 'videos', ['videos'])
  const agents = useApi('agents.list', ['agents'])
  const rooms = useRooms()
  const [channelId, setChannelId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // The row chat.open returned, kept until the list contains it (no flash of the Supervisor in between).
  const [opened, setOpened] = useState<ConversationRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const videos = videosLoaded.data ?? NO_VIDEOS

  const channelList = useMemo(() => (channels.data ?? []).filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })), [channels.data])
  const activeChannel = channelId !== null && channelList.some((c) => c.id === channelId) ? channelId : (channelList[0]?.id ?? null)
  const list = conversations.data ?? []

  const view = useMemo(
    () =>
      buildFolders({
        conversations: conversations.data ?? [],
        channels: channelList,
        videos,
        agents: (agents.data ?? []).map((a) => ({ id: a.id, name: a.name })),
        rooms,
        channelId: activeChannel,
        query,
        labels: {
          noMessage: t('chat.noMessagePreview'),
          you: t('chat.you'),
          card: t('chat.cardPreview'),
          manager: t('chat.kind.manager'),
          supervisor: t('chat.supervisor'),
          room: (d) => `${t('chat.room')} · ${t(`chat.dept.${d}` as MessageKey)}`
        }
      }),
    [conversations.data, channelList, videos, agents.data, rooms, activeChannel, query]
  )

  const selected =
    list.find((c) => c.id === selectedId) ?? (opened?.id === selectedId ? opened : null) ?? list.find((c) => c.kind === 'supervisor') ?? null
  const selectedKey = useMemo(() => {
    const all = [view.supervisor, view.manager, ...view.videos, ...view.team.flatMap((g) => [g.room, ...g.agents])]
    return all.find((e) => e && e.conversationId !== null && e.conversationId === selected?.id)?.key ?? null
  }, [view, selected])

  const select = (entry: ListEntry): void => {
    if (entry.conversationId !== null) return setSelectedId(entry.conversationId)
    if (!entry.open) return
    call('chat.open', entry.open).then(
      (c) => {
        setOpened(c)
        setSelectedId(c.id)
        conversations.reload()
        setError(null)
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err))
    )
  }

  const nameOf = useCallback(
    (id: string | null): string => (id === null ? t('chat.supervisor') : (agents.data?.find((a) => a.id === id)?.name ?? prettify(id))),
    [agents.data]
  )
  const mentions = useMemo<MentionTarget[]>(
    () =>
      (agents.data ?? [])
        .filter((a) => a.enabled)
        .map((a) => ({ id: a.id, name: a.name, index: agentIndex(a.id), hint: t(`chat.dept.${departmentOf(a.id)}` as MessageKey) })),
    [agents.data]
  )

  return (
    <section data-testid="view-conversations" aria-labelledby="title-conversations" className="flex h-full min-h-0">
      <ConversationList
        channels={channelList}
        channelId={activeChannel}
        onChannel={setChannelId}
        query={query}
        onQuery={setQuery}
        view={view}
        selectedKey={selectedKey}
        onSelect={select}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {(error ?? conversations.error) && (
          <p role="alert" className="px-6 pt-2 text-[12.5px] text-err">
            {error ?? conversations.error}
          </p>
        )}
        {selected ? (
          <Pane key={selected.id} conversation={selected} agentName={nameOf} mentions={mentions} />
        ) : (
          <>
            <h1 id="title-conversations" className="sr-only">
              {t('chat.title')}
            </h1>
            <p className="m-auto text-[13px] text-fg-3">{t('chat.empty.pick')}</p>
          </>
        )}
      </div>
    </section>
  )
}
