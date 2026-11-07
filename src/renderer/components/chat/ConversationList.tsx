// Left column of the Chats view: conversations with unread badges, plus shortcuts to open agent / video chats.
import type { ConversationInput, ConversationRow } from '../../../shared/chat'
import { ROLES } from '../../../shared/roles'
import type { VideoRow } from '../../../shared/workflow'

export interface ConversationListProps {
  conversations: ConversationRow[]
  selectedId: number | null
  videos: VideoRow[]
  onSelect: (id: number) => void
  onOpen: (input: ConversationInput) => void
}

function initial(c: ConversationRow): string {
  return (c.title.trim()[0] ?? '?').toUpperCase()
}

function preview(c: ConversationRow): string {
  if (!c.lastMessage) return 'No messages yet'
  const text = c.lastMessage.body.replace(/\s+/g, ' ').trim() || '(card)'
  return c.lastMessage.authorType === 'owner' ? `You: ${text}` : text
}

export function ConversationList({ conversations, selectedId, videos, onSelect, onOpen }: ConversationListProps) {
  return (
    <aside className="chat-list" data-testid="conversation-list" aria-label="Conversations">
      <ul>
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              className={c.id === selectedId ? 'chat-item selected' : 'chat-item'}
              data-testid={`conversation-${c.id}`}
              data-kind={c.kind}
              aria-current={c.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(c.id)}
            >
              <span className={`chat-avatar ${c.kind}`} aria-hidden>
                {initial(c)}
              </span>
              <span className="chat-item-text">
                <span className="chat-item-title">{c.title}</span>
                <span className="chat-item-preview">{preview(c)}</span>
              </span>
              {c.unread > 0 && (
                <span className="chat-unread" data-testid={`unread-${c.id}`} aria-label={`${c.unread} unread`}>
                  {c.unread}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="chat-list-new">
        <select
          className="select"
          aria-label="Chat about a video"
          value=""
          onChange={(e) => e.target.value && onOpen({ kind: 'video', videoId: Number(e.target.value) })}
        >
          <option value="">Chat about a video…</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title || `Video ${v.id}`}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Chat with an agent"
          value=""
          onChange={(e) => e.target.value && onOpen({ kind: 'agent', agentId: e.target.value })}
        >
          <option value="">Chat with an agent…</option>
          {ROLES.filter((r) => r.role !== 'supervisor').map((r) => (
            <option key={r.role} value={r.role}>
              {r.role.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
    </aside>
  )
}
