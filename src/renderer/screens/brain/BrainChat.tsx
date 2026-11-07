// The side chat of the Cerveau: a conversation with the research agent of the channel in scope (or with the main agent
// when every channel is shown). Messages live in the parent so a scope change keeps each conversation. Demo answers.
import { PanelRightClose } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { Composer, TypingDots } from '@/components/agent-panel/AgentChat'
import { AgentAvatar, fmtAgo } from '@/components/proto/kit'
import type { ProtoAgent } from '@/proto/types'

export interface ChatMessage {
  id: string
  from: 'agent' | 'user'
  text: string
  minutesAgo: number
}

const SUGGESTIONS: MessageKey[] = ['brain.chat.s1', 'brain.chat.s2', 'brain.chat.s3']

export function BrainChat({
  agent,
  scopeLabel,
  messages,
  typing,
  onSend,
  onClose
}: {
  agent: ProtoAgent
  scopeLabel: string
  messages: ChatMessage[]
  typing: boolean
  onSend: (text: string) => void
  onClose: () => void
}) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, typing])
  return (
    <aside data-testid="brain-chat" aria-label={agent.name} className="flex h-full w-[360px] shrink-0 flex-col border-l border-line-2 bg-surface-1">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <AgentAvatar agent={agent} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-fg" data-testid="brain-chat-name">
            {agent.name}
          </p>
          <p className="truncate text-[12px] text-fg-3">
            {t(`role.${agent.role}` as MessageKey)} <span aria-hidden>·</span> {scopeLabel}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('brain.chat.close')}
          onClick={onClose}
          data-testid="brain-chat-close"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-fg"
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-5 py-4">
          {messages.map((m) =>
            m.from === 'user' ? (
              <div key={m.id} className="flex justify-end" data-testid="brain-msg-user">
                <p className="max-w-[88%] rounded-[18px] bg-surface-2 px-3.5 py-2 text-[14px] leading-[1.45] text-fg">{m.text}</p>
              </div>
            ) : (
              <div key={m.id} className="text-[14px] leading-[1.6] text-fg" data-testid="brain-msg-agent">
                <p className="mb-0.5 text-[12px] font-medium text-fg-3">
                  {agent.name} {m.minutesAgo > 0 && <span className="font-normal">· {fmtAgo(m.minutesAgo)}</span>}
                </p>
                <p>{m.text}</p>
              </div>
            )
          )}
          {typing && (
            <div className="flex items-center gap-2" data-testid="brain-typing">
              <AgentAvatar agent={agent} size={18} showStatus={false} />
              <TypingDots />
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3">
        {messages.length < 7 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onSend(t(k))}
                className="rounded-full border border-line-2 px-2.5 py-1 text-left text-[12px] text-fg-2 hover:bg-hover hover:text-fg"
              >
                {t(k)}
              </button>
            ))}
          </div>
        )}
        <Composer placeholder={t('brain.chat.placeholder', { name: agent.name })} onSend={onSend} />
      </div>
    </aside>
  )
}
