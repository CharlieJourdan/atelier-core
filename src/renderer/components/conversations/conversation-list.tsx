// The context column of Conversations (PLAN-V2 §2.2): channel folder selector, search, then the Supervisor, the new
// replies, the channel Manager, the videos and the team by department (room first, then private messages).
import { Clapperboard, Search, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FolderChannel, FolderView, ListEntry } from '../../../shared/chat-folders'
import type { MessageKey } from '../../../shared/fr'
import { t } from '../../../shared/fr'
import { AgentDot } from '@/components/atelier/primitives'
import { cn } from '@/lib/utils'

export interface ConversationListProps {
  channels: readonly FolderChannel[]
  channelId: number | null
  onChannel: (id: number | null) => void
  query: string
  onQuery: (q: string) => void
  view: FolderView
  selectedKey: string | null
  onSelect: (entry: ListEntry) => void
}

function Entry({ entry, selected, onSelect, testPrefix }: { entry: ListEntry; selected: boolean; onSelect: (e: ListEntry) => void; testPrefix: string }) {
  const pending = entry.conversationId === null && entry.open === null // a room lot 13 has not opened yet
  return (
    <button
      type="button"
      data-testid={`${testPrefix}-${entry.key}`}
      data-kind={entry.kind}
      data-conversation={entry.conversationId ?? undefined}
      aria-current={selected ? 'true' : undefined}
      disabled={pending}
      onClick={() => onSelect(entry)}
      className={cn(
        'no-drag flex w-full items-center gap-2.5 rounded-field px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/60 enabled:hover:bg-surface-2 disabled:opacity-50',
        selected && 'bg-surface-2'
      )}
    >
      {entry.kind === 'video' ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-pop text-fg-2">
          <Clapperboard className="size-3.5" aria-hidden />
        </span>
      ) : entry.kind === 'room' ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-pop text-fg-2">
          <Users className="size-3.5" aria-hidden />
        </span>
      ) : (
        <AgentDot index={entry.index} size={28} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-fg">{entry.title}</span>
        <span className="block truncate text-[11.5px] text-fg-3">{entry.subtitle}</span>
      </span>
      {entry.unread > 0 && (
        <span
          data-testid={`unread-${entry.key}`}
          aria-label={`${entry.unread}`}
          className="min-w-[18px] rounded-full bg-brand px-1.5 py-px text-center font-mono text-[10px] text-brand-ink"
        >
          {entry.unread}
        </span>
      )}
    </button>
  )
}

function Group({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="mb-3">
      <h3 className="micro-label mb-1 px-2">{title}</h3>
      {children}
    </section>
  )
}

export function ConversationList({ channels, channelId, onChannel, query, onQuery, view, selectedKey, onSelect }: ConversationListProps) {
  const row = (e: ListEntry, prefix = 'conversation') => (
    <Entry key={`${prefix}-${e.key}`} entry={e} selected={selectedKey === e.key} onSelect={onSelect} testPrefix={prefix} />
  )
  const empty =
    !view.supervisor && view.newReplies.length === 0 && !view.manager && view.videos.length === 0 && view.team.length === 0
  return (
    <aside
      aria-label={t('chat.list')}
      data-testid="conversation-list"
      className={cn('relative z-10 flex w-[var(--context-w)] shrink-0 flex-col border-r border-line bg-bg px-3 pt-3 pb-3')}
    >
      <select
        aria-label={t('chat.folder')}
        data-testid="channel-folder"
        value={channelId ?? ''}
        onChange={(e) => onChannel(e.target.value === '' ? null : Number(e.target.value))}
        className="no-drag mb-2 h-9 rounded-field border border-line-2 bg-surface-1 px-2.5 text-[13px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      >
        {channels.length === 0 && <option value="">{t('chat.folder.none')}</option>}
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="no-drag relative mb-3 block">
        <span className="sr-only">{t('chat.search')}</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-4" aria-hidden />
        <input
          type="search"
          data-testid="conversation-search"
          value={query}
          placeholder={t('chat.search.placeholder')}
          onChange={(e) => onQuery(e.target.value)}
          className="h-8 w-full rounded-field border border-line bg-surface-1 pr-2 pl-8 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus-visible:ring-2 focus-visible:ring-brand/60"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.supervisor && row(view.supervisor)}
        <div className="h-3" />
        {view.newReplies.length > 0 && (
          <Group title={t('chat.newReplies')} testId="group-new">
            {view.newReplies.map((e) => row(e, 'new'))}
          </Group>
        )}
        {view.manager && (
          <Group title={t('chat.manager')} testId="group-manager">
            {row(view.manager)}
          </Group>
        )}
        {view.videos.length > 0 && (
          <Group title={t('chat.videos')} testId="group-videos">
            {view.videos.map((e) => row(e))}
          </Group>
        )}
        {view.team.map((g) => (
          <Group key={g.department} title={`${t('chat.team')} · ${t(`chat.dept.${g.department}` as MessageKey)}`} testId={`group-team-${g.department}`}>
            {g.room && row(g.room)}
            {g.agents.map((e) => row(e))}
          </Group>
        ))}
        {empty && <p className="px-2 text-[12.5px] text-fg-3">{t('chat.noResult')}</p>}
      </div>
    </aside>
  )
}
