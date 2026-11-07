// Messages (section `conversations`): the team as a group chat. A folding tree on the left (the main agent, then a branch
// per channel: group chat, Big Agent, videos, specialists) and the thread on the right. A discreet switch hands the
// whole screen to the old conversation screen backed by the real chat engine.
import { useEffect, useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { AgentAvatar, ChannelAvatar, ProgressBar, Thumb, stageLabel } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/input'
import { plain } from './chat-model'
import { cn } from '@/lib/utils'
import { PRINCIPAL_ID, useProtoActions } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import { ConversationsScreen } from '../ConversationsScreen'
import type { ScreenProps } from '../registry'
import { sendLocal, type Attachment } from './chat-engine'
import { buildTree, messagesFor, mentionables, resolveThread, type ThreadInfo } from './chat-model'
import { SubscriptionLock } from '@/components/orchestra/SubscriptionLock'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { detailOf, useTeamAgents } from './model'
import { teamActions } from './store'
import { ThreadTree } from './ThreadTree'

const FEEDBACK: { key: 'pace' | 'thumb' | 'archives'; label: MessageKey; text: MessageKey }[] = [
  { key: 'pace', label: 'msg.feedback.pace', text: 'msg.feedback.pace.text' },
  { key: 'thumb', label: 'msg.feedback.thumb', text: 'msg.feedback.thumb.text' },
  { key: 'archives', label: 'msg.feedback.archives', text: 'msg.feedback.archives.text' }
]

function RealEngineSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11.5px] text-fg-3 transition-colors hover:text-fg-2">
      <Switch checked={checked} onCheckedChange={onChange} aria-label={t('msg.real')} data-testid="msg-real-switch" className="scale-[0.85]" />
      {t('msg.real')}
    </label>
  )
}

export function MessagesScreen({ onRoute }: ScreenProps) {
  const { state, team, agents } = useTeamAgents()
  const { send, markRead } = useProtoActions()
  const [real, setReal] = useState(false)

  const scope = state.scope
  const channels: ProtoChannel[] = scope === 'all' ? state.channels : state.channels.filter((c) => c.id === scope)
  const principalAgent = agents.find((a) => a.id === PRINCIPAL_ID) ?? agents[0]
  const principalThread = resolveThread('th-principal', state, agents)
  const branches = useMemo(() => buildTree(state, agents, channels, team.read), [state, agents, channels, team.read])

  const wanted = team.selectedThread ?? 'th-principal'
  const resolved = resolveThread(wanted, state, agents)
  const inScope = resolved && (!resolved.channelId || channels.some((c) => c.id === resolved.channelId))
  const thread: ThreadInfo | undefined = inScope ? resolved : principalThread
  const threadId = thread?.id ?? 'th-principal'

  useEffect(() => {
    if (!thread) return
    if (thread.synthetic) teamActions.markRead(thread.id)
    else if (thread.unread > 0) markRead(thread.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the user opens another thread
  }, [threadId])

  if (real) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="messages-real">
        <div className="flex h-11 shrink-0 items-center justify-end gap-3 border-b border-line px-5">
          <RealEngineSwitch checked onChange={setReal} />
        </div>
        <div className="min-h-0 flex-1">
          <ConversationsScreen />
        </div>
      </div>
    )
  }

  if (!thread || !principalAgent || !principalThread) return null

  const channel = state.channels.find((c) => c.id === thread.channelId)
  const video = thread.videoId ? state.videos.find((v) => v.id === thread.videoId) : undefined
  const agent = thread.agentId ? agents.find((a) => a.id === thread.agentId) : undefined
  const members = agents.filter((a) => thread.participantIds.includes(a.id))
  const memoryOf = (a: (typeof agents)[number]): string | undefined => [...detailOf(a, agents, state.channels, team.edits[a.id]).memory].sort((x, y) => y.importance - x.importance)[0]?.text
  const messages = messagesFor(thread, state, agents, team.chat, memoryOf)
  const mentionPool = mentionables(thread, agents)
  const names = new Set<string>([...agents.map((a) => plain(a.name.split(' ')[0] ?? a.name)), 'charlie', plain(state.principalName)])
  const typingAgents =
    thread.kind === 'principal'
      ? state.typing.length > 0
        ? [principalAgent]
        : []
      : (team.typing[thread.id] ?? []).flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const userName = state.workspace.members[0]?.name ?? t('beta.you')

  const title = thread.kind === 'channel-group' ? t('msg.tree.group', { name: channel?.name ?? thread.title }) : thread.title
  const subtitle =
    thread.kind === 'principal'
      ? `${t('role.principal')} · ${t(`agentStatus.${principalAgent.status}` as MessageKey)}`
      : thread.kind === 'channel-group'
        ? t('msg.header.group', { n: members.length })
        : thread.kind === 'video'
          ? `${channel?.name ?? ''} · ${video ? stageLabel(video.stage) : ''}`
          : `${agent?.roleLabel ?? ''}${channel ? ` · ${channel.name}` : ''}`
  const placeholder =
    thread.kind === 'principal'
      ? t('msg.composer.principal', { name: principalAgent.name })
      : thread.kind === 'agent-dm'
        ? t('msg.composer.dm', { name: agent?.name ?? '' })
        : thread.kind === 'video'
          ? t('msg.composer.video')
          : t('msg.composer.group')

  function onSend(text: string, attachment?: Attachment) {
    if (!thread) return
    if (thread.kind === 'principal' || state.mode === 'live') {
      send(thread.id, attachment ? `${text}\n${t('msg.attached', { name: attachment.name })}`.trim() : text)
      return
    }
    sendLocal(thread, text, agents, attachment)
  }

  return (
    <section data-testid="view-conversations" aria-labelledby="title-conversations" className="flex h-full min-h-0">
      <ThreadTree principalAgent={principalAgent} principalThread={principalThread} branches={branches} selected={threadId} onSelect={teamActions.selectThread} readIds={team.read} />
      <div className="flex min-w-0 flex-1 flex-col" data-testid="msg-pane" data-thread={threadId}>
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-6" data-testid="msg-header">
          {thread.kind === 'channel-group' ? (
            <ChannelAvatar channel={channel} size={36} />
          ) : thread.kind === 'video' && video ? (
            <Thumb hue={video.thumbHue} format={video.format} className={video.format === 'short' ? 'h-9' : 'h-9'} />
          ) : agent ? (
            <AgentAvatar agent={agent} size={36} />
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.014em] text-fg">{title}</h2>
            <p className="truncate text-[12px] text-fg-3">{subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            {members.length > 1 && (
              <ul className="flex items-center" aria-label={t('msg.header.members')} data-testid="msg-members">
                {members.slice(0, 5).map((m, i) => (
                  <li key={m.id} title={`${m.name} · ${m.roleLabel}`} className={cn('rounded-full ring-2 ring-bg', i > 0 && '-ml-1.5')}>
                    <AgentAvatar agent={m} size={24} showStatus={false} />
                  </li>
                ))}
                {members.length > 5 && <li className="num ml-1.5 text-[11.5px] text-fg-3">+{members.length - 5}</li>}
              </ul>
            )}
            <RealEngineSwitch checked={false} onChange={setReal} />
          </div>
        </header>

        {thread.kind === 'video' && video && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface-0/40 px-6 py-2.5" data-testid="msg-video-bar">
            <div className="flex min-w-0 items-center gap-3">
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-medium text-fg-2">{stageLabel(video.stage)}</span>
              <div className="flex w-56 items-center gap-2.5">
                <ProgressBar value={video.progress} className="flex-1" />
                <span className="num shrink-0 text-[12px] whitespace-nowrap text-fg-2">{video.progress} %</span>
              </div>
              {video.waitingFor && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
                  <span aria-hidden className="size-1.5 rounded-full bg-warn" />
                  {video.waitingFor.label}
                </span>
              )}
            </div>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => onRoute({ section: 'production', page: 'apercu' })}>
              {t('msg.card.openProduction')}
            </Button>
          </div>
        )}

        <MessageList
          threadId={threadId}
          messages={messages}
          agents={agents}
          userName={userName}
          mentionNames={names}
          typing={typingAgents}
          videos={state.videos}
          onOpenVideo={() => onRoute({ section: 'production', page: 'apercu' })}
          onFeedback={(text) => onSend(text)}
          onGo={(target) => onRoute({ section: target })}
        />

        {thread.kind === 'video' && (
          <div className="mx-auto flex w-full max-w-[800px] flex-wrap items-center gap-2 px-6 pb-2" data-testid="msg-feedback">
            <span className="mr-1 text-[12px] text-fg-3">{t('msg.feedback.label')}</span>
            {FEEDBACK.map((f) => (
              <Button key={f.key} size="sm" variant="outline" data-testid={`feedback-${f.key}`} onClick={() => onSend(t(f.text))}>
                {t(f.label)}
              </Button>
            ))}
          </div>
        )}
        {state.mode === 'live' && <SubscriptionLock className="mx-auto mb-2 w-full max-w-[800px]" />}
        <Composer key={threadId} onSend={onSend} mentionPool={mentionPool} placeholder={placeholder} />
      </div>
    </section>
  )
}
