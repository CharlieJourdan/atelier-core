// The message bubbles of one conversation (pure: the data and the card actions come in as props).
import { useEffect, useRef } from 'react'
import type { MessageRow } from '../../../shared/chat'
import { CardView, type CardActions } from './Cards'

export interface StreamingReply {
  streamId: string
  text: string
}

export interface ThreadProps {
  messages: MessageRow[]
  streaming: StreamingReply | null
  actions: CardActions
  agentLabel: (authorId: string | null) => string
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Thread({ messages, streaming, actions, agentLabel }: ThreadProps) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, streaming?.text])

  return (
    <div className="chat-thread" data-testid="chat-thread" role="log" aria-live="polite">
      {messages.length === 0 && !streaming && <p className="muted chat-empty">No messages yet. Say hello.</p>}
      {messages.map((m) => (
        <Bubble key={m.id} message={m} actions={actions} agentLabel={agentLabel} />
      ))}
      {streaming && (
        <div className="chat-row agent" data-testid="chat-streaming">
          <div className="chat-bubble agent">
            {streaming.text ? streaming.text : <span className="typing" aria-label="Typing">•••</span>}
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}

function Bubble({ message: m, actions, agentLabel }: { message: MessageRow } & Pick<ThreadProps, 'actions' | 'agentLabel'>) {
  if (m.authorType === 'system' && !m.card) {
    return (
      <div className="chat-system" data-testid="chat-message" data-author="system">
        {m.body}
      </div>
    )
  }
  return (
    <div className={`chat-row ${m.authorType}`} data-testid="chat-message" data-author={m.authorType}>
      <div className={`chat-bubble ${m.authorType}`}>
        {m.authorType === 'agent' && <div className="chat-author">{agentLabel(m.authorId)}</div>}
        {m.body && <div className="chat-body">{m.body}</div>}
        {m.attachments.length > 0 && (
          <ul className="chat-attachments">
            {m.attachments.map((a, i) => (
              <li key={`${i}-${a.name}`} className="chip" title={a.mime}>
                📎 {a.name}
              </li>
            ))}
          </ul>
        )}
        {m.card && <CardView card={m.card} actions={actions} />}
        <div className="chat-time">{formatTime(m.createdAt)}</div>
      </div>
    </div>
  )
}
