// Cerveau (route `cerveau`): where the ideas come from. Three views (the competitors around a channel, the map of the
// niches, the idea board) and, on the right, a chat with the research agent of the channel in scope. Demo data; in real
// mode the idea board is the database's ideas, the chat is the real agent, and the blocks with no source yet (competitors,
// niche map) keep their demo data under a « Données de démonstration » badge.
import { MessagesSquare, Plus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { LiveDemoNote } from '@/components/proto/LiveDemoBadge'
import { Segmented } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { CHANNELS } from '@/proto/data-core'
import { CHAT_SEEDS, competitorsOf, IDEA_BOARD, OUTPERFORMERS, type Competitor, type Idea, type IdeaColumn, type Outperformer } from '@/proto/data-brain'
import { channelOf, principal, useProto, useProtoActions } from '@/proto/store'
import { dmThreadId } from '../team/model'
import type { ScreenProps } from '../registry'
import { brainReply, generateIdeas, ideasInScope, moveIdea, researchAgent, styleAnalysis, type NicheView } from './brain-model'
import { BrainChat, type ChatMessage } from './BrainChat'
import { styleLabel } from './CompetitorCard'
import { CompetitorMap } from './CompetitorMap'
import { IdeaDialog } from './IdeaDialog'
import { IdeasBoard } from './IdeasBoard'
import { NichesTab } from './NichesTab'
import { Outperformers } from './Outperformers'
import { LiveCompetitors } from './LiveCompetitors'

type Tab = 'competitors' | 'niches' | 'ideas'

const NO_IDEAS: Idea[] = []

let seq = 0
const nextId = (p: string): string => `${p}-${(seq += 1)}`

export function BrainScreen({ onRoute, initialTab = 'competitors' }: ScreenProps & { initialTab?: Tab }) {
  const state = useProto()
  const { addVideo, send, createIdea, updateIdea, moveIdea: moveLiveIdea, deleteIdea, generateIdeas: generateLiveIdeas } = useProtoActions()
  const live = state.mode === 'live'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [chatOpen, setChatOpen] = useState(true)
  const [pick, setPick] = useState<string>(state.channels.find((c) => competitorsOf(c.id).length > 0)?.id ?? '')
  const [selectedComp, setSelectedComp] = useState<string | null>(null)
  const [watched, setWatched] = useState<ReadonlySet<string>>(new Set())
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const [demoIdeas, setIdeas] = useState<Idea[]>(IDEA_BOARD)
  const [generating, setGenerating] = useState(false)
  const [dialog, setDialog] = useState<{ idea?: Idea } | null>(null)
  const [askChannel, setAskChannel] = useState('')
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({})
  const [typing, setTyping] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const scope = state.scope
  // Real mode: nothing tracks real competitors yet, so the map keeps its demo channels (labelled), not the real ones.
  const compChannels = useMemo(() => (live ? CHANNELS : state.channels).filter((c) => competitorsOf(c.id).length > 0), [live, state.channels])
  const compPick = compChannels.some((c) => c.id === pick) ? pick : (compChannels[0]?.id ?? '')
  const channelId = live ? compPick : scope === 'all' ? pick : scope
  const channel = live ? compChannels.find((c) => c.id === compPick) : channelOf(state, channelId)
  const scopeChannel = scope === 'all' ? undefined : channelOf(state, scope)
  const agent = researchAgent(state.agents, scope) ?? principal(state)
  const scopeLabel = scope === 'all' ? t('scope.all') : (scopeChannel?.name ?? '')
  const threadId = dmThreadId(agent)
  const liveMessages: ChatMessage[] = state.messages
    .filter((m) => m.threadId === threadId)
    .map((m) => ({ id: m.id, from: m.authorId === 'user' ? ('user' as const) : ('agent' as const), text: m.text, minutesAgo: m.minutesAgo }))
  const seeds = CHAT_SEEDS[scope] ?? CHAT_SEEDS.all ?? []
  const messages: ChatMessage[] = live
    ? liveMessages
    : (chats[agent.id] ?? seeds.map((m, i) => ({ id: `seed-${agent.id}-${i}`, from: 'agent' as const, text: m.text, minutesAgo: m.minutesAgo })))
  const typingNow = live ? state.typing.some((id) => id.startsWith(`live-${threadId}-`)) : typing === agent.id

  const list = useMemo(() => competitorsOf(channelId), [channelId])
  const ideas = live ? (state.liveIdeas ?? NO_IDEAS) : demoIdeas
  const inBoard = useMemo(() => ideasInScope(ideas, scope), [ideas, scope])
  // Real mode: the channel the « Demander 5 idées » button and a new idea are for.
  const ideaChannelId = scope !== 'all' ? scope : state.channels.some((c) => c.id === askChannel) ? askChannel : (state.channels[0]?.id ?? '')
  const nicheName = (id: string): string => t(`brain.niche.${id}` as MessageKey)

  const say = (text: string, reply?: string) => {
    setChatOpen(true)
    if (live) {
      send(threadId, text)
      return
    }
    const mine: ChatMessage = { id: nextId('u'), from: 'user', text, minutesAgo: 0 }
    setChats((c) => ({ ...c, [agent.id]: [...(c[agent.id] ?? messages), mine] }))
    setTyping(agent.id)
    const id = window.setTimeout(() => {
      const answer: ChatMessage = { id: nextId('a'), from: 'agent', text: reply ?? brainReply(text, { scope, channel, nicheName }), minutesAgo: 0 }
      setChats((c) => ({ ...c, [agent.id]: [...(c[agent.id] ?? []), answer] }))
      setTyping((x) => (x === agent.id ? null : x))
    }, 1100)
    timers.current.push(id)
  }

  const askAboutCompetitor = (kind: 'style' | 'translate', c: Competitor) => {
    if (kind === 'style') say(t('brain.chat.ask.style', { name: c.name }), styleAnalysis(c, styleLabel(c)))
    else say(t('brain.chat.ask.translate', { name: c.name }), t('brain.chat.reply.translate', { name: c.name }))
  }

  const askAboutNiche = (v: NicheView) =>
    say(
      t('brain.chat.ask.nicheTranslate', { niche: nicheName(v.niche.id) }),
      t('brain.chat.reply.nicheTranslate', { niche: nicheName(v.niche.id), best: v.niche.top[0]?.name ?? '' })
    )

  const addOutperformer = (o: Outperformer) => {
    const comp = list.find((c) => c.id === o.competitorId)
    setAdded((s) => new Set(s).add(o.id))
    setIdeas((all) => [
      {
        id: `id-op-${o.id}`,
        channelId,
        title: o.title,
        angle: t('brain.idea.fromOut', {
          name: comp?.name ?? '',
          n: o.multiple.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        }),
        source: 'competitor',
        potential: Math.min(95, Math.round(70 + o.multiple * 5)),
        estViews: Math.round((o.views * 0.3) / 1000) * 1000,
        column: 'proposed'
      },
      ...all
    ])
  }

  const move = (id: string, column: IdeaColumn) => {
    if (live) {
      void moveLiveIdea(id, column)
      return
    }
    const idea = ideas.find((i) => i.id === id)
    setIdeas((all) => moveIdea(all, id, column))
    if (column === 'production' && idea) {
      const ch = channelOf(state, idea.channelId)
      const pipeline = state.pipelines.find((p) => p.id === ch?.pipelineIds[0])
      const worker = researchAgent(state.agents, idea.channelId) ?? agent
      addVideo({
        channelId: idea.channelId,
        title: idea.title,
        brief: idea.angle,
        format: pipeline?.format ?? (ch?.format === 'short' ? 'short' : 'long'),
        pipelineId: pipeline?.id ?? ch?.pipelineIds[0] ?? 'pl-docu',
        stage: 'idea',
        progress: 5,
        status: 'queued',
        dueInDays: 7,
        publishInDays: null,
        publishTime: '18:00',
        durationSec: 0,
        creditsSpent: 0,
        creditsEstimate: pipeline?.creditsPerVideo ?? 0,
        agentId: worker.id,
        thumbHue: (idea.title.length * 37) % 360
      })
    }
  }

  const ask5 = () => {
    if (generating) return
    setGenerating(true)
    if (live) {
      void generateLiveIdeas(ideaChannelId, 5).finally(() => setGenerating(false))
      return
    }
    const id = window.setTimeout(() => {
      setIdeas((all) => [
        ...generateIdeas(
          all,
          scope,
          state.channels.map((c) => c.id),
          5,
          Date.now()
        ),
        ...all
      ])
      setGenerating(false)
    }, 1000)
    timers.current.push(id)
  }

  const proposedCount = inBoard.filter((i) => i.column === 'proposed').length

  return (
    <section data-testid="view-cerveau" className="flex h-full min-h-0">
      <div className="@container min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1120px] px-8 pt-6 pb-12">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="page-title">{t('section.cerveau')}</h1>
              <p className="mt-1 text-[13px] text-fg-3">{t('brain.subtitle')}</p>
            </div>
            {!chatOpen && (
              <Button variant="outline" size="sm" onClick={() => setChatOpen(true)} data-testid="brain-chat-open" className="shrink-0">
                <MessagesSquare aria-hidden />
                {t('brain.chat.open', { name: agent.name })}
              </Button>
            )}
          </header>

          <div className="mb-6" data-testid="brain-tabs">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'competitors', label: <span data-testid="brain-tab-competitors">{t('brain.tab.competitors')}</span> },
                { value: 'niches', label: <span data-testid="brain-tab-niches">{t('brain.tab.niches')}</span> },
                {
                  value: 'ideas',
                  label: (
                    <span data-testid="brain-tab-ideas" className="inline-flex items-center gap-1.5">
                      {t('brain.tab.ideas')}
                      {proposedCount > 0 && <span className="num rounded-full bg-surface-3 px-1.5 text-[11px] text-fg-2">{proposedCount}</span>}
                    </span>
                  )
                }
              ]}
            />
          </div>

          {tab === 'competitors' && live && (
            <div data-testid="competitors-tab">
              <LiveCompetitors channels={state.channels} scope={scope} onRoute={onRoute} />
            </div>
          )}
          {tab === 'competitors' && !live && (
            <div data-testid="competitors-tab">
              <LiveDemoNote block="competitors" note="live.demo.competitors" />
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{t('brain.comp.title', { name: channel?.name ?? '' })}</h2>
                  <p className="text-[12.5px] text-fg-3">{t('brain.comp.sub', { n: list.length, w: watched.size })}</p>
                </div>
                {(live || scope === 'all') && (
                  <Segmented<string>
                    size="sm"
                    value={live ? compPick : pick}
                    onChange={(v) => {
                      setPick(v)
                      setSelectedComp(null)
                    }}
                    options={compChannels.map((c) => ({ value: c.id, label: c.name }))}
                  />
                )}
              </div>
              {channel && list.length > 0 ? (
                <>
                  <CompetitorMap
                    channel={channel}
                    list={list}
                    selectedId={list.some((c) => c.id === selectedComp) ? selectedComp : null}
                    onSelect={setSelectedComp}
                    watched={watched}
                    onWatch={(id) => setWatched((s) => new Set(s).add(id))}
                    onAsk={askAboutCompetitor}
                    readOnly={live}
                  />
                  <Outperformers items={OUTPERFORMERS[channelId] ?? []} added={added} {...(live ? {} : { onAdd: addOutperformer })} />
                </>
              ) : (
                <p className="rounded-[16px] border border-dashed border-line-2 px-4 py-12 text-center text-[13px] text-fg-3" data-testid="competitors-empty">
                  {t('brain.comp.none')}
                </p>
              )}
            </div>
          )}

          {tab === 'niches' && (
            <>
              <LiveDemoNote block="niches" note="live.demo.niches" />
              <NichesTab onCreate={() => onRoute({ section: 'chaines' })} onTranslate={askAboutNiche} />
            </>
          )}

          {tab === 'ideas' && (
            <div data-testid="ideas-tab">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">
                    {scope === 'all' ? t('brain.ideas.titleAll') : t('brain.ideas.title', { name: scopeChannel?.name ?? '' })}
                  </h2>
                  <p className="text-[12.5px] text-fg-3">{t('brain.ideas.sub', { n: inBoard.length })}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {live && scope === 'all' && state.channels.length > 1 && (
                    <Segmented<string>
                      size="sm"
                      value={ideaChannelId}
                      onChange={setAskChannel}
                      options={state.channels.map((c) => ({ value: c.id, label: c.name }))}
                      className="max-w-full overflow-x-auto"
                    />
                  )}
                  {live && (
                    <Button variant="outline" onClick={() => setDialog({})} disabled={ideaChannelId === ''} data-testid="idea-add">
                      <Plus aria-hidden />
                      {t('brain.idea.add')}
                    </Button>
                  )}
                  <Button onClick={ask5} disabled={generating || (live && ideaChannelId === '')} data-testid="ideas-ask">
                    <Sparkles aria-hidden />
                    {generating ? t('brain.ideas.asking', { name: agent.name }) : t('brain.ideas.ask')}
                  </Button>
                </div>
              </div>
              {live && state.channels.length === 0 && <p className="mb-3 text-[12.5px] text-fg-3">{t('brain.ideas.noChannel')}</p>}
              <IdeasBoard
                ideas={inBoard}
                generating={generating}
                onMove={move}
                {...(live ? { edits: { onEdit: (idea: Idea) => setDialog({ idea }), onDelete: (id: string) => void deleteIdea(id) } } : {})}
              />
            </div>
          )}
        </div>
      </div>
      {chatOpen && (
        <BrainChat
          agent={agent}
          scopeLabel={scopeLabel}
          messages={messages}
          typing={typingNow}
          onSend={(text) => say(text)}
          onClose={() => setChatOpen(false)}
        />
      )}
      {dialog && (
        <IdeaDialog
          {...(dialog.idea ? { idea: dialog.idea } : {})}
          channels={state.channels}
          defaultChannelId={ideaChannelId}
          onClose={() => setDialog(null)}
          onSave={(v) => void (dialog.idea ? updateIdea(dialog.idea.id, v) : createIdea(v))}
        />
      )}
    </section>
  )
}
