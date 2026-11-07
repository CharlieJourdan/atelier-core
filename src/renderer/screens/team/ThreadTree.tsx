// Left pane of Messages: the main agent on top, then one foldable branch per channel (group chat, the Big Agent, the
// videos in production, the specialists). A search field filters every row.
import { ChevronRight, Search, Users } from 'lucide-react'
import type * as React from 'react'
import { useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { AgentAvatar, ChannelAvatar } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import type { ProtoVideo } from '@/proto/types'
import { plain, type ChannelBranch, type ThreadInfo } from './chat-model'
import type { TeamAgent } from './model'

function Badge({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span data-testid="unread-badge" className="num ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-brand-ink">
      {n}
    </span>
  )
}

function Row({
  active,
  onClick,
  testId,
  indent = 0,
  unread = 0,
  children
}: {
  active: boolean
  onClick: () => void
  testId: string
  indent?: 0 | 1
  unread?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-[8px] pr-2 text-left text-[13px] outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        indent === 0 ? 'pl-2' : 'pl-7',
        active ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
        unread > 0 && 'font-semibold text-fg'
      )}
    >
      {children}
      <Badge n={unread} />
    </button>
  )
}

function SubHead({ label, count, open, onToggle }: { label: string; count: number; open?: boolean; onToggle?: () => void }) {
  const inner = (
    <>
      {onToggle && <ChevronRight className={cn('size-3 transition-transform duration-150', open && 'rotate-90')} aria-hidden />}
      <span>{label}</span>
      <span className="num text-fg-4">{count}</span>
    </>
  )
  const cls = 'mt-1.5 flex h-6 w-full items-center gap-1 pl-7 text-left text-[11.5px] font-medium text-fg-3'
  return onToggle ? (
    <button type="button" aria-expanded={open} onClick={onToggle} className={cn(cls, 'rounded-[6px] outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-ring')}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

const VIDEO_PREVIEW = 5

function VideoDot({ video }: { video: ProtoVideo }) {
  const needs = video.status === 'waiting' || video.status === 'blocked'
  return <span aria-hidden className={cn('ml-0.5 size-2 shrink-0 rounded-full', needs ? 'bg-warn' : video.status === 'running' ? 'bg-ok' : 'bg-fg-4/60')} />
}

export function ThreadTree({
  principalAgent,
  principalThread,
  branches,
  selected,
  onSelect,
  readIds
}: {
  principalAgent: TeamAgent
  principalThread: ThreadInfo
  branches: readonly ChannelBranch[]
  selected: string
  onSelect: (id: string) => void
  readIds: readonly string[]
}) {
  const [query, setQuery] = useState('')
  const q = plain(query.trim())
  const selectedChannel = branches.find((b) => [b.group, b.leadThread, ...b.videos.map((v) => v.thread), ...b.team.map((x) => x.thread)].some((th) => th?.id === selected))?.channel.id
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [selectedChannel ?? branches[0]?.channel.id ?? '']: true }))
  // Opening a thread from elsewhere (« Lui écrire », a card) unfolds its channel.
  const [shownChannel, setShownChannel] = useState(selectedChannel)
  if (selectedChannel !== shownChannel) {
    setShownChannel(selectedChannel)
    if (selectedChannel) setOpen((o) => (o[selectedChannel] ? o : { ...o, [selectedChannel]: true }))
  }
  const [teamOpen, setTeamOpen] = useState<Record<string, boolean>>({})
  const [allVideos, setAllVideos] = useState<Record<string, boolean>>({})
  const isOpen = (id: string): boolean => q.length > 0 || open[id] === true
  const unreadOf = (th: ThreadInfo | undefined): number => (!th || (th.synthetic && readIds.includes(th.id)) ? 0 : th.unread)

  const principalMatches = !q || plain(principalAgent.name).includes(q)
  const visible = useMemo(
    () =>
      branches.map((b) => {
        const channelHit = !q || plain(b.channel.name).includes(q)
        const keep = <T,>(items: T[], text: (x: T) => string): T[] => (channelHit ? items : items.filter((x) => plain(text(x)).includes(q)))
        return {
          b,
          group: channelHit,
          lead: channelHit || (b.lead ? plain(`${b.lead.name} ${b.lead.roleLabel}`).includes(q) : false),
          videos: keep(b.videos, (v) => v.video.title),
          team: keep(b.team, (x) => `${x.agent.name} ${x.agent.roleLabel}`)
        }
      }),
    [branches, q]
  )
  const nothing = q.length > 0 && !principalMatches && visible.every((v) => !v.group && !v.lead && v.videos.length === 0 && v.team.length === 0)

  return (
    <nav aria-label={t('msg.tree.aria')} data-testid="conv-tree" className="flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-surface-0/40">
      <div className="px-4 pt-5 pb-3">
        <h1 id="title-conversations" className="page-title text-[20px]">
          {t('section.conversations')}
        </h1>
        <label className="relative mt-3 block">
          <span className="sr-only">{t('msg.tree.search')}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            type="search"
            data-testid="conv-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('msg.tree.search')}
            className="h-8 w-full rounded-full border border-line-2 bg-surface-2 pr-3 pl-8 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus-visible:border-line-3"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {principalMatches && (
          <Row active={selected === principalThread.id} onClick={() => onSelect(principalThread.id)} testId={`conv-row-${principalThread.id}`} unread={unreadOf(principalThread)}>
            <AgentAvatar agent={principalAgent} size={22} />
            <span className="truncate">{principalAgent.name}</span>
            <span className="truncate text-[11.5px] font-normal text-fg-3">{t('role.principal')}</span>
          </Row>
        )}
        {visible.map(({ b, group, lead, videos, team }) => {
          if (q && !group && !lead && videos.length === 0 && team.length === 0) return null
          const expanded = isOpen(b.channel.id)
          const shownVideos = allVideos[b.channel.id] || q ? videos : videos.slice(0, VIDEO_PREVIEW)
          const teamExpanded = q.length > 0 || (teamOpen[b.channel.id] ?? false)
          return (
            <div key={b.channel.id} className="mt-2">
              <button
                type="button"
                data-testid={`conv-channel-${b.channel.id}`}
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [b.channel.id]: !expanded }))}
                className="flex h-9 w-full items-center gap-2 rounded-[8px] pr-2 pl-1 text-left text-[13px] font-medium text-fg outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <ChevronRight className={cn('size-3.5 text-fg-3 transition-transform duration-150', expanded && 'rotate-90')} aria-hidden />
                <ChannelAvatar channel={b.channel} size={18} />
                <span className="truncate">{b.channel.name}</span>
                {!expanded && <Badge n={b.unread} />}
              </button>
              {expanded && (
                <div className="mt-0.5">
                  {group && (
                    <Row indent={1} active={selected === b.group.id} onClick={() => onSelect(b.group.id)} testId={`conv-row-${b.group.id}`} unread={unreadOf(b.group)}>
                      <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-2">
                        <Users className="size-3" aria-hidden />
                      </span>
                      <span className="truncate">{t('msg.tree.group', { name: b.channel.name })}</span>
                    </Row>
                  )}
                  {lead && b.lead && b.leadThread && (
                    <Row indent={1} active={selected === b.leadThread.id} onClick={() => onSelect(b.leadThread!.id)} testId={`conv-row-${b.leadThread.id}`} unread={unreadOf(b.leadThread)}>
                      <AgentAvatar agent={b.lead} size={22} />
                      <span className="truncate">{b.lead.name}</span>
                      <span className="truncate text-[11.5px] font-normal text-fg-3">{t('team.chart.bigAgent')}</span>
                    </Row>
                  )}
                  {videos.length > 0 && (
                    <>
                      <SubHead label={t('msg.tree.videos')} count={videos.length} />
                      {shownVideos.map(({ video, thread }) => (
                        <Row key={thread.id} indent={1} active={selected === thread.id} onClick={() => onSelect(thread.id)} testId={`conv-row-${thread.id}`} unread={unreadOf(thread)}>
                          <VideoDot video={video} />
                          <span className="min-w-0 flex-1 truncate">{video.title}</span>
                          <span className="shrink-0 text-[11px] font-normal text-fg-3">{t(`stage.${video.stage}` as MessageKey)}</span>
                        </Row>
                      ))}
                      {!q && videos.length > VIDEO_PREVIEW && (
                        <button type="button" onClick={() => setAllVideos((a) => ({ ...a, [b.channel.id]: !a[b.channel.id] }))} className="h-7 w-full pl-[34px] text-left text-[12px] text-fg-3 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
                          {allVideos[b.channel.id] ? t('msg.tree.fewer') : t('msg.tree.more', { n: videos.length - VIDEO_PREVIEW })}
                        </button>
                      )}
                    </>
                  )}
                  {team.length > 0 && (
                    <>
                      <SubHead label={t('msg.tree.team')} count={team.length} open={teamExpanded} onToggle={() => setTeamOpen((o) => ({ ...o, [b.channel.id]: !teamExpanded }))} />
                      {teamExpanded &&
                        team.map(({ agent, thread }) => (
                          <Row key={thread.id} indent={1} active={selected === thread.id} onClick={() => onSelect(thread.id)} testId={`conv-row-${thread.id}`} unread={unreadOf(thread)}>
                            <AgentAvatar agent={agent} size={22} />
                            <span className="truncate">{agent.name}</span>
                            <span className="truncate text-[11.5px] font-normal text-fg-3">{agent.roleLabel}</span>
                          </Row>
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {nothing && <p className="px-3 py-6 text-center text-[12.5px] text-fg-3">{t('msg.tree.none')}</p>}
      </div>
    </nav>
  )
}
