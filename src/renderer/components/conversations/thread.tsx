// The thread of a conversation (PLAN-V2 §2.2): ElevenLabs' Conversation (sticks to the bottom), Message (bubbles) and
// Response (markdown), with Atelier's cards and rich blocks, tool steps in Shimmering Text, and smooth streaming.
import { ChevronRight, Loader2, Paperclip, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Attachment, AuthorType, ToolUse } from '../../../shared/chat'
import { nextRevealLength, splitBody, asAnyCard, type AnyCard } from '../../../shared/chat-rich'
import { t } from '../../../shared/fr'
import { AgentDot } from '@/components/atelier/primitives'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Message,
  MessageAvatar,
  MessageContent,
  Response,
  ShimmeringText
} from '@/vendor/elevenlabs-ui'
import { cn } from '@/lib/utils'
import { RichBlock } from './blocks'
import { ContentBoundary } from './boundary'
import { CardView, type CardActions } from './cards'
import { toolLabel } from './tool-labels'

export interface ToolStep {
  id: string
  /** Present tense while running ("Lit la file du moteur…"), past tense when done. */
  label: string
  state: 'running' | 'done' | 'error'
}

export interface ThreadMessage {
  id: number | string
  authorType: AuthorType
  authorId: string | null
  body: string
  /** Raw card JSON (validated here: unknown types are not drawn). */
  card: unknown
  attachments: Attachment[]
  createdAt: string
  toolSteps?: ToolStep[]
  /** Tools saved with the message (main's MessageRow), shown folded when there are no live steps. */
  tools?: ToolUse[]
}

export interface StreamingReply {
  streamId: string
  text: string
  toolSteps?: ToolStep[]
  /** Agent writing it (group chats); absent: the conversation's own agent. */
  authorId?: string
}

export interface AuthorInfo {
  name: string
  /** Colour index of the agent dot. */
  index: number
}

export interface ThreadProps {
  messages: ThreadMessage[]
  /** Replies being written: one, several (group chats, oldest first) or none. */
  streaming: StreamingReply | readonly StreamingReply[] | null
  actions: CardActions
  author: (authorId: string | null) => AuthorInfo
  /** Shown when the thread has no message. */
  empty?: React.ReactNode
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Text revealed progressively toward `target` (rAF), so chunks of a stream glide in instead of jumping. */
export function useSmoothText(target: string, active: boolean): string {
  const [shown, setShown] = useState(0)
  const mirror = useRef(0)
  const total = target.length
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = now - last
      last = now
      // The text only grows; if it was replaced by a shorter one, snap to it.
      const next = mirror.current > total ? total : nextRevealLength(mirror.current, total, dt)
      mirror.current = next
      setShown(next)
      // Caught up: stop drawing frames; the effect restarts when more text arrives.
      if (next < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, total])
  return active ? target.slice(0, Math.min(shown, total)) : target
}

export function ToolSteps({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null
  const running = steps.filter((s) => s.state === 'running')
  const fold = running.length === 0
  const list = fold && !open ? [] : steps
  return (
    <div data-testid="tool-steps" data-folded={fold && !open ? 'true' : 'false'} className="text-[12.5px] text-fg-3">
      {fold && (
        <button
          type="button"
          data-testid="tool-steps-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-chip px-1.5 py-0.5 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
          {steps.length === 1 ? t('thread.toolsOne') : t('thread.toolsMany', { n: steps.length })}
        </button>
      )}
      <ul className={cn('space-y-0.5', fold ? 'mt-1 pl-5' : '')}>
        {list.map((s) => (
          <li key={s.id} data-state={s.state} className="flex items-center gap-1.5">
            {s.state === 'running' ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : s.state === 'error' ? (
              <TriangleAlert className="size-3.5 text-err" aria-hidden />
            ) : (
              <span aria-hidden className="size-3.5 text-center text-ok">
                ✓
              </span>
            )}
            {s.state === 'running' ? <ShimmeringText text={s.label} duration={1.6} repeatDelay={0.2} /> : <span>{s.label}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A message body: markdown (Response) interleaved with rich blocks. */
export function Body({ text, final = true }: { text: string; final?: boolean }) {
  const segments = splitBody(text, { final })
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'md' ? (
          <Response key={i}>{s.text}</Response>
        ) : (
          <ContentBoundary key={i}>
            <RichBlock segment={s} />
          </ContentBoundary>
        )
      )}
    </>
  )
}

function AttachmentChips({ items }: { items: Attachment[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('thread.attachment')}>
      {items.map((a, i) => (
        <li key={`${i}-${a.name}`} title={a.mime} className="flex items-center gap-1 rounded-chip border border-line-2 bg-bg/40 px-2 py-0.5 text-[12px]">
          <Paperclip className="size-3" aria-hidden />
          {a.name}
        </li>
      ))}
    </ul>
  )
}

function MessageView({
  message: m,
  card,
  actions,
  info,
  head,
  nameOf
}: {
  message: ThreadMessage
  card: AnyCard | null
  actions: CardActions
  info: AuthorInfo
  nameOf: (id: string) => string
  /** First message of a run by the same author: shows the avatar and the name. */
  head: boolean
}) {
  if (m.authorType === 'system' && !card) {
    return (
      <div data-testid="chat-message" data-author="system" className="py-2 text-center text-[12px] text-fg-3">
        {m.body}
      </div>
    )
  }
  const owner = m.authorType === 'owner'
  const steps = m.toolSteps ?? (m.tools?.length ? m.tools.map((u, i) => ({ id: `${i}`, label: toolLabel(u.name, u.state), state: u.state })) : undefined)
  return (
    <Message from={owner ? 'user' : 'assistant'} data-testid="chat-message" data-author={m.authorType} className={head ? 'pt-3' : 'py-0.5'}>
      <div className={cn('flex min-w-0 max-w-[82%] flex-col gap-1.5', owner ? 'items-end' : 'items-start')}>
        {!owner && head && (
          <div data-testid="chat-author" className="px-1 text-[12px] font-medium text-fg-2">
            {info.name}
          </div>
        )}
        {steps && <ToolSteps steps={steps} />}
        {(m.body || m.attachments.length > 0) && (
          <MessageContent className={cn('max-w-none', owner && 'items-end')}>
            {m.body && (owner ? <p className="whitespace-pre-wrap">{m.body}</p> : <Body text={m.body} />)}
            {m.attachments.length > 0 && <AttachmentChips items={m.attachments} />}
          </MessageContent>
        )}
        {card && (
          <ContentBoundary>
            <CardView card={card} actions={actions} nameOf={nameOf} />
          </ContentBoundary>
        )}
        {head || card ? (
          <div className="px-1 font-mono text-[10.5px] text-fg-4">{formatTime(m.createdAt)}</div>
        ) : null}
      </div>
      {!owner && <MessageAvatar>{head && <AgentDot index={info.index} size={28} />}</MessageAvatar>}
    </Message>
  )
}

function StreamingView({ reply, info }: { reply: StreamingReply; info: AuthorInfo }) {
  const text = useSmoothText(reply.text, true)
  return (
    <Message from="assistant" data-testid="chat-streaming" className="pt-3">
      <div className="flex min-w-0 max-w-[82%] flex-col items-start gap-1.5">
        <div className="px-1 text-[12px] font-medium text-fg-2">{info.name}</div>
        {reply.toolSteps && <ToolSteps steps={reply.toolSteps} />}
        <MessageContent className="max-w-none">
          {text ? <Body text={text} final={false} /> : <ShimmeringText text={t('chat.working')} />}
        </MessageContent>
      </div>
      <MessageAvatar>
        <AgentDot index={info.index} size={28} />
      </MessageAvatar>
    </Message>
  )
}

export function Thread({ messages, streaming, actions, author, empty }: ThreadProps) {
  const live: readonly StreamingReply[] = streaming === null ? [] : 'streamId' in streaming ? [streaming] : streaming
  return (
    <Conversation className="min-h-0 flex-1" data-testid="chat-thread">
      <ConversationContent className="mx-auto w-full max-w-[860px] px-6 py-4">
        {messages.length === 0 && live.length === 0
          ? (empty ?? <ConversationEmptyState title={t('chat.empty.title')} description={t('chat.empty.blurb')} />)
          : messages.map((m, i) => {
              const prev = messages[i - 1]
              const head = !prev || prev.authorType !== m.authorType || prev.authorId !== m.authorId || prev.card !== null
              return <MessageView key={m.id} message={m} card={asAnyCard(m.card)} actions={actions} info={author(m.authorId)} head={head} nameOf={(id) => author(id).name} />
            })}
        {live.map((s) => (
          <StreamingView key={s.streamId} reply={s} info={author(s.authorId ?? null)} />
        ))}
      </ConversationContent>
      <ConversationScrollButton aria-label={t('thread.scroll')} />
    </Conversation>
  )
}
