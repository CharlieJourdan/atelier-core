// The message flow of a thread: runs of messages per author (avatar, name, role, time once), @mentions, day separators,
// system lines for hand-offs and status changes, cards (video, approval, task, report) and the typing indicator.
import { ArrowRightLeft, CircleDot, ClipboardCheck, FileText, Film, LineChart } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { AgentAvatar, ProgressBar, Thumb } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { SYSTEM_ID } from '@/proto/data-team-chat'
import type { MessageCard, ProtoVideo } from '@/proto/types'
import { MENTION_RE, clock, dayKey, dayLabel, nowMs, plain, type ChatMessage } from './chat-model'
import type { TeamAgent } from './model'

const RUN_GAP_MIN = 6

export function Rich({ text, names }: { text: string; names: ReadonlySet<string> }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0
    const who = m[1] ?? ''
    if (!names.has(plain(who))) continue
    if (idx > last) parts.push(text.slice(last, idx))
    parts.push(
      <span key={idx} data-mention={who} className="font-semibold text-fg underline decoration-line-3 decoration-1 underline-offset-[3px]">
        @{who}
      </span>
    )
    last = idx + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : p))}</>
}

const CARD_ICON = { video: Film, approval: ClipboardCheck, task: FileText, report: LineChart, handoff: ArrowRightLeft } as const

function CardBlock({
  card,
  video,
  onOpenVideo,
  onFeedback,
  onGo
}: {
  card: MessageCard
  video: ProtoVideo | undefined
  onOpenVideo: (videoId: string) => void
  onFeedback: (text: string) => void
  onGo: (target: 'ordinateurs' | 'chaines') => void
}) {
  const [done, setDone] = useState(false)
  const Icon = CARD_ICON[card.type]
  return (
    <div data-testid={`msg-card-${card.type}`} className="mt-2 max-w-[460px] rounded-[14px] border border-line-2 bg-surface-1 p-3.5">
      <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
        <Icon className="size-3.5" aria-hidden />
        {t(`msg.card.${card.type}` as MessageKey)}
      </div>
      <div className="mt-2 flex items-start gap-3">
        {video && card.type === 'video' && <Thumb hue={video.thumbHue} format={video.format} className={video.format === 'short' ? 'h-14' : 'w-[88px]'} />}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-[1.35] font-semibold tracking-[-0.01em] text-fg">{card.title}</p>
          {card.detail && <p className="mt-0.5 text-[12.5px] leading-[1.4] text-fg-3">{card.detail}</p>}
          {video && card.type === 'video' && <ProgressBar value={video.progress} className="mt-2.5" />}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {card.type === 'video' && card.videoId && (
          <Button size="sm" variant="outline" onClick={() => onOpenVideo(card.videoId as string)}>
            {t('msg.card.openProduction')}
          </Button>
        )}
        {card.type === 'approval' &&
          (done ? (
            <span className="inline-flex h-8 items-center gap-1.5 text-[12.5px] font-medium text-ok">
              <ClipboardCheck className="size-3.5" aria-hidden />
              {t('msg.card.approved')}
            </span>
          ) : (
            <>
              <Button
                size="sm"
                data-testid="msg-card-validate"
                onClick={() => {
                  setDone(true)
                  toast.success(t('msg.card.approved'), card.title)
                }}
              >
                {t('common.validate')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onFeedback(t('msg.card.changesText', { title: card.title }))}>
                {t('msg.card.changes')}
              </Button>
            </>
          ))}
        {card.type === 'task' && (
          <Button size="sm" variant="outline" onClick={() => onGo('ordinateurs')}>
            {t('msg.card.drop')}
          </Button>
        )}
        {card.type === 'report' && (
          <Button size="sm" variant="outline" onClick={() => onGo('chaines')}>
            {t('msg.card.report.open')}
          </Button>
        )}
      </div>
    </div>
  )
}

function SystemLine({ text }: { text: string }) {
  const handoff = /confi/.test(text)
  const Icon = handoff ? ArrowRightLeft : CircleDot
  return (
    <div data-testid="msg-system" className="flex items-center justify-center gap-2 px-4 py-2.5 text-center text-[12px] text-fg-3">
      <Icon className="size-3 shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  )
}

function Typing({ agent }: { agent: TeamAgent }) {
  return (
    <div data-testid="msg-typing" className="flex items-center gap-3 px-2 py-2" aria-live="polite">
      <AgentAvatar agent={agent} size={32} showStatus={false} />
      <span className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-2" aria-label={t('msg.typing', { name: agent.name })}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-fg-3" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      <span className="text-[12px] text-fg-3">{t('msg.typing', { name: agent.name })}</span>
    </div>
  )
}

export function MessageList({
  messages,
  agents,
  userName,
  mentionNames,
  typing,
  videos,
  onOpenVideo,
  onFeedback,
  onGo,
  threadId
}: {
  messages: readonly ChatMessage[]
  agents: readonly TeamAgent[]
  userName: string
  mentionNames: ReadonlySet<string>
  typing: readonly TeamAgent[]
  videos: readonly ProtoVideo[]
  onOpenVideo: (videoId: string) => void
  onFeedback: (text: string) => void
  onGo: (target: 'ordinateurs' | 'chaines') => void
  threadId: string
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const now = nowMs()
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [threadId, messages.length, typing.length])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="msg-list">
      <div className="mx-auto flex w-full max-w-[800px] flex-col px-6 pt-4 pb-4">
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || dayKey(prev.minutesAgo, now) !== dayKey(m.minutesAgo, now)
          const sep = newDay ? (
            <div key={`d-${m.id}`} className="flex items-center gap-3 py-3 text-[11.5px] font-medium text-fg-3">
              <span className="h-px flex-1 bg-line" />
              {dayLabel(m.minutesAgo, now)}
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : null
          if (m.authorId === SYSTEM_ID) {
            return (
              <Fragment key={m.id}>
                {sep}
                <SystemLine text={m.text} />
              </Fragment>
            )
          }
          const run = !newDay && prev && prev.authorId === m.authorId && prev.minutesAgo - m.minutesAgo <= RUN_GAP_MIN
          const isUser = m.authorId === 'user'
          const agent = byId.get(m.authorId)
          const video = m.card?.videoId ? videos.find((v) => v.id === m.card?.videoId) : undefined
          return (
            <Fragment key={m.id}>
              {sep}
              <article data-testid="msg" data-author={m.authorId} className={cn('group -mx-2 flex gap-3 rounded-[10px] px-2 hover:bg-hover/60', run ? 'py-px' : 'mt-2.5 py-1')}>
                {run ? (
                  <span className="num w-8 shrink-0 pt-1.5 text-right text-[10px] text-fg-4 opacity-0 transition-opacity group-hover:opacity-100">{clock(m.minutesAgo, now)}</span>
                ) : isUser ? (
                  <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-brand-ink">
                    {userName.slice(0, 1).toUpperCase()}
                  </span>
                ) : agent ? (
                  <AgentAvatar agent={agent} size={32} showStatus={false} />
                ) : (
                  <span className="size-8 shrink-0 rounded-full bg-surface-3" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  {!run && (
                    <header className="flex items-baseline gap-2">
                      <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{isUser ? userName : (agent?.name ?? '—')}</span>
                      {agent && <span className="text-[11.5px] text-fg-3">{agent.roleLabel}</span>}
                      <time className="num text-[11.5px] text-fg-3">{clock(m.minutesAgo, now)}</time>
                    </header>
                  )}
                  {m.text && (
                    <p className="text-[14px] leading-[1.55] whitespace-pre-wrap text-fg">
                      <Rich text={m.text} names={mentionNames} />
                    </p>
                  )}
                  {m.card && <CardBlock card={m.card} video={video} onOpenVideo={onOpenVideo} onFeedback={onFeedback} onGo={onGo} />}
                </div>
              </article>
            </Fragment>
          )
        })}
        {typing.map((a) => (
          <Typing key={a.id} agent={a} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
