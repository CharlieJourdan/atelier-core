// The conversation with the main agent: used as the right-hand panel of the shell (reachable from every screen, the
// "Jarvis" of the app) and embedded in the dashboard. ChatGPT-like: the user's turns are bubbles, the agent's are plain
// text, cards for reports / tasks, a rounded composer with an ink send button.
import { ArrowUp, Paperclip } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { t } from '../../../shared/fr'
import { AgentAvatar, fmtAgo } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { principal, useProto, useProtoActions } from '@/proto/store'
import type { MessageCard, ProtoMessage } from '@/proto/types'

const THREAD = 'th-principal'

const SUGGESTIONS = [
  'Qu’est-ce qui m’attend ?',
  'Comment vont les vues cette semaine ?',
  'Propose-moi 5 sujets',
  'Montre le planning de la semaine'
]

function Card({ card }: { card: MessageCard }) {
  return (
    <div className="mt-2 rounded-[12px] border border-line-2 bg-surface-1 px-3 py-2.5">
      <p className="text-[13px] font-medium text-fg">{card.title}</p>
      {card.detail && <p className="mt-0.5 text-[12px] text-fg-3">{card.detail}</p>}
    </div>
  )
}

function Message({ m, name }: { m: ProtoMessage; name: string }) {
  if (m.authorId === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[18px] bg-brand-soft px-3.5 py-2 text-[14px] leading-[1.45] text-fg">{m.text}</p>
      </div>
    )
  }
  return (
    <div className="text-[14px] leading-[1.6] text-fg">
      <p className="mb-0.5 text-[12px] font-medium text-fg-3">
        {name} <span className="font-normal text-fg-4">· {fmtAgo(m.minutesAgo)}</span>
      </p>
      <p>{m.text}</p>
      {m.card && <Card card={m.card} />}
    </div>
  )
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-2" aria-label="…">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-pulse rounded-full bg-fg-3" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  )
}

export function Composer({ placeholder, onSend, autoFocus = false }: { placeholder: string; onSend: (text: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const send = () => {
    const v = text.trim()
    if (!v) return
    onSend(v)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }
  return (
    <div className="flex items-end gap-2 rounded-[24px] border border-line-2 bg-surface-pop py-1.5 pr-1.5 pl-2 focus-within:border-line-3">
      <button type="button" aria-label="Joindre un fichier" className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-fg">
        <Paperclip className="size-4" aria-hidden />
      </button>
      <textarea
        data-testid="agent-composer"
        rows={1}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-5 text-fg outline-none placeholder:text-fg-3"
      />
      <button
        type="button"
        data-testid="agent-send"
        aria-label="Envoyer"
        disabled={!text.trim()}
        onClick={send}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink transition-[opacity,transform] duration-150 active:scale-95 disabled:bg-surface-3 disabled:text-fg-3"
      >
        <ArrowUp className="size-4" strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  )
}

export function AgentChat({ className, compact = false }: { className?: string; compact?: boolean }) {
  const state = useProto()
  const { send, markRead } = useProtoActions()
  const agent = principal(state)
  const messages = state.messages.filter((m) => m.threadId === THREAD)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, state.typing.length])
  useEffect(() => markRead(THREAD), [markRead])

  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-testid="agent-chat">
      <div className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-4' : 'px-5')}>
        <div className="flex flex-col gap-5 py-4">
          {messages.map((m) => (
            <Message key={m.id} m={m} name={agent.name} />
          ))}
          {state.typing.length > 0 && (
            <div className="flex items-center gap-2">
              <AgentAvatar agent={agent} size={18} showStatus={false} />
              <TypingDots />
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className={cn('shrink-0 pb-3', compact ? 'px-3' : 'px-4')}>
        {messages.length < 8 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(THREAD, s)}
                className="rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-fg-2 hover:bg-hover hover:text-fg"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <Composer placeholder={t('shell.askAgent', { name: agent.name })} onSend={(v) => send(THREAD, v)} />
      </div>
    </div>
  )
}
