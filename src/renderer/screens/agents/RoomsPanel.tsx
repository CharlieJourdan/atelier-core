// Group chats: the Manager of each channel and its department rooms (chat.rooms), with members and last message.
import { MessagesSquare } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { agentIndex } from '../../../shared/chat-folders'
import { AgentDot, EmptyState } from '@/components/atelier/primitives'
import { fmtDate } from '@/components/atelier/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { RoomCardData } from './model'

const MAX_FACES = 6
const deptKey = (d: string): MessageKey => `chat.dept.${d}` as MessageKey

export function RoomCard({ data, channelName, onOpen }: { data: RoomCardData; channelName: string; onOpen: (room: RoomCardData) => void }) {
  const { room, members, conversation } = data
  const last = conversation?.lastMessage
  return (
    <article data-testid="room-card" data-room={room.key} className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-medium text-fg">{room.title}</h3>
          <p className="text-[11.5px] text-fg-3">
            {room.kind === 'manager'
              ? t('agents.rooms.manager')
              : `${t(deptKey(room.department ?? 'operations'))} · ${t('agents.rooms.channel', { name: channelName })}`}
          </p>
        </div>
        {room.unread > 0 && <Badge variant="brand">{t('agents.rooms.unread', { n: room.unread })}</Badge>}
      </header>
      <div className="flex items-center gap-3">
        {members.length > 0 ? (
          <ul className="flex -space-x-2" aria-label={t('chat.members')}>
            {members.slice(0, MAX_FACES).map((m) => (
              <li key={m.id} title={m.name} className="rounded-full ring-2 ring-surface-1">
                <AgentDot index={agentIndex(m.id)} size={24} />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[12px] text-fg-3">{t('agents.rooms.noMembers')}</span>
        )}
        {members.length > 0 && (
          <span className="text-[12px] text-fg-3">{members.length === 1 ? t('agents.rooms.members.one') : t('agents.rooms.members', { n: members.length })}</span>
        )}
      </div>
      <p className="line-clamp-2 min-h-[2.4em] text-[12.5px] text-fg-2">
        {last ? `${last.body.replace(/\s+/g, ' ').trim()}` : t('agents.rooms.notStarted')}
      </p>
      <footer className="flex items-center justify-between">
        <span className="text-[11.5px] text-fg-3">{last ? fmtDate(last.createdAt, true) : ''}</span>
        <Button size="sm" variant="secondary" onClick={() => onOpen(data)}>
          <MessagesSquare /> {t('agents.rooms.open')}
        </Button>
      </footer>
    </article>
  )
}

export function RoomsPanel({
  rooms,
  channelNames,
  onOpen
}: {
  rooms: readonly RoomCardData[]
  channelNames: Readonly<Record<number, string>>
  onOpen: (room: RoomCardData) => void
}) {
  if (rooms.length === 0) return <EmptyState title={t('agents.rooms.empty.title')} blurb={t('agents.rooms.empty.blurb')} />
  const byChannel = new Map<number, RoomCardData[]>()
  for (const r of rooms) byChannel.set(r.room.channelId, [...(byChannel.get(r.room.channelId) ?? []), r])
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-[70ch] text-[13px] text-fg-3">{t('agents.rooms.intro')}</p>
      {[...byChannel.entries()].map(([channelId, list]) => (
        <section key={channelId} className="flex flex-col gap-3" aria-label={channelNames[channelId] ?? String(channelId)}>
          <h2 className="micro-label">{channelNames[channelId] ?? `#${channelId}`}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((r) => (
              <RoomCard key={r.room.key} data={r} channelName={channelNames[channelId] ?? ''} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

