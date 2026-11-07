// Model of the Messages screen: which threads exist (the shared store's plus the ones synthesised from the team and the
// videos), the folding tree, and the messages of a thread (shared store + extra history + generated history + the ones
// posted in this session). Pure functions, no React.
import { t, type MessageKey } from '../../../shared/fr'
import { SYSTEM_ID, EXTRA_MESSAGES } from '@/proto/data-team-chat'
import { hash } from '@/proto/data-team-agents'
import type { ProtoState } from '@/proto/store'
import { STAGES, type ProtoChannel, type ProtoMessage, type ProtoThread, type ProtoVideo, type StageId } from '@/proto/types'
import { dmThreadId, leadOf, roleLabelOf, type TeamAgent } from './model'

export interface ThreadInfo extends ProtoThread {
  /** True for threads that are not in the shared store (their unread count lives in the team store). */
  synthetic: boolean
}

const ROLE_ORDER: TeamAgent['role'][] = ['production-supervisor', 'researcher', 'scriptwriter', 'director', 'editor', 'packaging', 'competitor-analyst', 'qc-eye']

export function videoThreadId(state: Pick<ProtoState, 'threads'>, videoId: string): string {
  return state.threads.find((th) => th.kind === 'video' && th.videoId === videoId)?.id ?? `th-video-${videoId}`
}

/** The agents who carry a video: its lead, its current agent, and one agent per step already done. */
function videoParticipants(video: ProtoVideo, agents: readonly TeamAgent[]): string[] {
  const channelAgents = agents.filter((a) => a.channelId === video.channelId)
  const lead = video.channelId ? leadOf(agents, video.channelId) : undefined
  const ids = new Set<string>()
  if (lead) ids.add(lead.id)
  ids.add(video.agentId)
  const done = STAGES.indexOf(video.stage)
  for (const role of ROLE_ORDER.slice(0, Math.max(2, Math.min(ROLE_ORDER.length, done)))) {
    const a = channelAgents.find((x) => x.role === role)
    if (a) ids.add(a.id)
  }
  return [...ids, 'user']
}

export function resolveThread(id: string, state: ProtoState, agents: readonly TeamAgent[]): ThreadInfo | undefined {
  const stored = state.threads.find((th) => th.id === id)
  if (stored) return { ...stored, synthetic: false }
  if (id.startsWith('th-dm-')) {
    const agent = agents.find((a) => a.id === id.slice('th-dm-'.length))
    if (!agent) return undefined
    return { id, kind: 'agent-dm', title: agent.name, ...(agent.channelId ? { channelId: agent.channelId } : {}), agentId: agent.id, participantIds: [agent.id, 'user'], unread: 0, synthetic: true }
  }
  if (id.startsWith('th-video-')) {
    const video = state.videos.find((v) => v.id === id.slice('th-video-'.length))
    if (!video) return undefined
    return {
      id,
      kind: 'video',
      title: video.title,
      ...(video.channelId ? { channelId: video.channelId } : {}),
      videoId: video.id,
      participantIds: videoParticipants(video, agents),
      unread: 0,
      synthetic: true
    }
  }
  return undefined
}

/** Videos still in production, the ones that need the user first. */
export function productionVideos(videos: readonly ProtoVideo[], channelId: string): ProtoVideo[] {
  const rank = (v: ProtoVideo): number => (v.status === 'waiting' || v.status === 'blocked' ? 0 : v.status === 'running' ? 1 : v.status === 'queued' ? 2 : 3)
  return videos.filter((v) => v.channelId === channelId && v.stage !== 'published').sort((a, b) => rank(a) - rank(b) || a.dueInDays - b.dueInDays)
}

export interface ChannelBranch {
  channel: ProtoChannel
  group: ThreadInfo
  lead: TeamAgent | undefined
  leadThread: ThreadInfo | undefined
  videos: { video: ProtoVideo; thread: ThreadInfo }[]
  team: { agent: TeamAgent; thread: ThreadInfo }[]
  unread: number
}

export function buildTree(state: ProtoState, agents: readonly TeamAgent[], channels: readonly ProtoChannel[], read: readonly string[]): ChannelBranch[] {
  const unreadOf = (th: ThreadInfo): number => (th.synthetic && read.includes(th.id) ? 0 : th.unread)
  return channels.map((channel) => {
    const group = resolveThread(`th-group-${channel.id}`, state, agents) ?? {
      id: `th-group-${channel.id}`,
      kind: 'channel-group' as const,
      title: channel.name,
      channelId: channel.id,
      participantIds: agents.filter((a) => a.channelId === channel.id).map((a) => a.id),
      unread: 0,
      synthetic: true
    }
    const lead = leadOf(agents, channel.id)
    const leadThread = lead ? resolveThread(dmThreadId(lead), state, agents) : undefined
    const videos = productionVideos(state.videos, channel.id).flatMap((video) => {
      const thread = resolveThread(videoThreadId(state, video.id), state, agents)
      return thread ? [{ video, thread }] : []
    })
    const team = agents
      .filter((a) => a.channelId === channel.id && a.id !== lead?.id)
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .flatMap((agent) => {
        const thread = resolveThread(dmThreadId(agent), state, agents)
        return thread ? [{ agent, thread }] : []
      })
    const unread = [group, leadThread, ...videos.map((v) => v.thread), ...team.map((x) => x.thread)].reduce((n, th) => n + (th ? unreadOf(th) : 0), 0)
    return { channel, group, lead, leadThread, videos, team, unread }
  })
}

/* ---------- messages ---------- */

export type ChatMessage = ProtoMessage

/** The clock used to label messages (a function of its own, so renders stay readable). */
export const nowMs = (): number => Date.now()

/** Local messages keep the instant they were posted, so their time stays put while the screen re-renders. */
export const postedAt = new Map<string, number>()

function minutesOf(m: ProtoMessage, now: number): number {
  const at = postedAt.get(m.id)
  return at === undefined ? m.minutesAgo : Math.max(0, (now - at) / 60_000)
}

const STEP_ROLE: Partial<Record<StageId, TeamAgent['role']>> = {
  idea: 'researcher',
  script: 'scriptwriter',
  director: 'director',
  assets: 'production-supervisor',
  voice: 'production-supervisor',
  edit: 'editor',
  packaging: 'packaging'
}

function pickAgent(agents: readonly TeamAgent[], channelId: string | null, role: TeamAgent['role'] | undefined): TeamAgent | undefined {
  const inChannel = agents.filter((a) => a.channelId === channelId)
  return (role ? inChannel.find((a) => a.role === role) : undefined) ?? (channelId ? leadOf(agents, channelId) : undefined) ?? inChannel[0]
}

function videoSeed(thread: ThreadInfo, state: ProtoState, agents: readonly TeamAgent[], existing: number): ProtoMessage[] {
  const video = state.videos.find((v) => v.id === thread.videoId)
  if (!video) return []
  const out: ProtoMessage[] = []
  const stageIdx = STAGES.indexOf(video.stage)
  const h = hash(video.id)
  const lead = video.channelId ? leadOf(agents, video.channelId) : undefined
  let prev = lead
  const add = (m: Omit<ProtoMessage, 'id' | 'threadId'>) => out.push({ ...m, id: `seed-${thread.id}-${out.length}`, threadId: thread.id })
  for (let k = 0; k <= Math.min(stageIdx, 6); k += 1) {
    const stage = STAGES[k] as StageId
    const owner = pickAgent(agents, video.channelId, STEP_ROLE[stage])
    if (!owner) continue
    const current = k === stageIdx
    const base = (stageIdx - k) * 190 + 50 + (h % 25)
    if (prev && prev.id !== owner.id) {
      add({ authorId: SYSTEM_ID, text: t('msg.sys.handoff', { from: prev.name, what: t(`msg.vid.what.${stage}` as MessageKey), to: owner.name }), minutesAgo: base + 6 })
    }
    prev = owner
    if (current) continue
    const words = 1_300 + (h % 500)
    add({
      authorId: owner.id,
      minutesAgo: base,
      text: t(`msg.vid.done.${stage}` as MessageKey, {
        title: video.title,
        words,
        min: Math.round(words / 145),
        n: 40 + (h % 30),
        a: 18 + (h % 12),
        g: 14 + (h % 9),
        k: 3 + (h % 5)
      })
    })
    if (stage === 'idea' || stage === 'script' || stage === 'packaging') add({ authorId: 'user', minutesAgo: base - 6, text: t('msg.vid.userOk') })
  }
  if (existing === 0) {
    const cur = pickAgent(agents, video.channelId, undefined)
    const author = agents.find((a) => a.id === video.agentId) ?? cur
    if (author) {
      if (video.status === 'waiting' && video.waitingFor) {
        add({ authorId: author.id, minutesAgo: 20, text: t('msg.vid.waiting', { what: video.waitingFor.label }), card: { type: 'approval', title: video.waitingFor.label, detail: video.title, videoId: video.id } })
      } else if (video.status === 'blocked' && video.waitingFor) {
        add({ authorId: author.id, minutesAgo: 20, text: t('msg.vid.blocked', { what: video.waitingFor.label }), card: { type: 'task', title: video.waitingFor.label, detail: video.title, videoId: video.id } })
      } else if (video.status === 'running') {
        add({ authorId: author.id, minutesAgo: 8, text: t('msg.vid.running', { pct: video.progress }), card: { type: 'video', title: video.title, detail: `${t(`stage.${video.stage}` as MessageKey)} · ${video.progress} %`, videoId: video.id } })
      } else if (video.status === 'queued') {
        add({ authorId: SYSTEM_ID, minutesAgo: 20, text: t('msg.vid.queued') })
      } else {
        add({ authorId: SYSTEM_ID, minutesAgo: 20, text: t('msg.vid.done') })
      }
    }
  }
  return out
}

function dmSeed(thread: ThreadInfo, state: ProtoState, agent: TeamAgent, memory: string | undefined, channelName: string | undefined): ProtoMessage[] {
  const out: ProtoMessage[] = []
  const add = (m: Omit<ProtoMessage, 'id' | 'threadId'>) => out.push({ ...m, id: `seed-${thread.id}-${out.length}`, threadId: thread.id })
  add({
    authorId: agent.id,
    minutesAgo: 1_500,
    text: channelName ? t('msg.dm.intro', { name: agent.name, role: roleLabelOf(agent.role).toLowerCase(), channel: channelName }) : t('msg.dm.introTeam', { name: agent.name, role: roleLabelOf(agent.role).toLowerCase() })
  })
  if (memory) add({ authorId: agent.id, minutesAgo: 900, text: t('msg.dm.memory', { memory }) })
  const inbox = state.inbox.find((i) => i.agentId === agent.id)
  if (agent.status === 'waiting' || inbox) {
    add({
      authorId: agent.id,
      minutesAgo: inbox?.minutesAgo ?? 30,
      text: t('msg.dm.waiting', { task: agent.task ?? inbox?.title ?? '' }),
      ...(inbox ? { card: { type: 'approval' as const, title: inbox.title, detail: inbox.detail, ...(inbox.videoId ? { videoId: inbox.videoId } : {}) } } : {})
    })
  } else if (agent.status === 'working') {
    add({ authorId: agent.id, minutesAgo: 18, text: t('msg.dm.working', { task: agent.task ?? '' }) })
  } else if (agent.status === 'sleeping') {
    add({ authorId: agent.id, minutesAgo: 240, text: t('msg.dm.sleeping') })
  } else {
    add({ authorId: agent.id, minutesAgo: 90, text: t('msg.dm.idle') })
  }
  return out
}

/** All the messages of a thread, oldest first. `now` fixes the clock for local messages. */
export function messagesFor(
  thread: ThreadInfo,
  state: ProtoState,
  agents: readonly TeamAgent[],
  local: readonly ProtoMessage[],
  memoryOf: (agent: TeamAgent) => string | undefined,
  now = Date.now()
): ChatMessage[] {
  const stored = state.messages.filter((m) => m.threadId === thread.id)
  // Real mode: only what the chat really holds (no invented history).
  if (state.mode === 'live') return [...stored].sort((a, b) => b.minutesAgo - a.minutesAgo)
  const extra = EXTRA_MESSAGES.filter((m) => m.threadId === thread.id)
  const mine = local.filter((m) => m.threadId === thread.id).map((m) => ({ ...m, minutesAgo: minutesOf(m, now) }))
  let seeded: ProtoMessage[] = []
  if (thread.kind === 'video') seeded = videoSeed(thread, state, agents, stored.length + extra.length)
  else if (thread.kind === 'agent-dm') {
    const agent = agents.find((a) => a.id === thread.agentId)
    if (agent) seeded = dmSeed(thread, state, agent, memoryOf(agent), state.channels.find((c) => c.id === agent.channelId)?.name)
  }
  return [...seeded, ...extra, ...stored, ...mine].sort((a, b) => b.minutesAgo - a.minutesAgo)
}

/* ---------- mentions and rich text ---------- */

export const MENTION_RE = /@([\p{L}œŒ][\p{L}œŒ'’-]*)/gu

export function mentionables(thread: ThreadInfo, agents: readonly TeamAgent[]): TeamAgent[] {
  if (thread.kind === 'principal') return agents.filter((a) => a.role === 'principal' || a.role === 'channel-manager')
  const ids = new Set(thread.participantIds)
  const pool = agents.filter((a) => ids.has(a.id))
  if (thread.kind === 'agent-dm') return pool
  const principalAgent = agents.find((a) => a.role === 'principal')
  return principalAgent && !ids.has(principalAgent.id) ? [principalAgent, ...pool] : pool
}

export function plain(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** The agent addressed by the first @mention of a text, if any. */
export function firstMentioned(text: string, candidates: readonly TeamAgent[]): TeamAgent | undefined {
  for (const m of text.matchAll(MENTION_RE)) {
    const name = plain(m[1] ?? '')
    const hit = candidates.find((a) => plain(a.name.split(' ')[0] ?? a.name) === name)
    if (hit) return hit
  }
  return undefined
}

/** Short clock label (« 14:32 ») of a message that is `minutesAgo` old. */
export function clock(minutesAgo: number, now = Date.now()): string {
  const d = new Date(now - minutesAgo * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** « Aujourd’hui », « Hier » or a date, for the separators between days. */
export function dayLabel(minutesAgo: number, now = Date.now()): string {
  const d = new Date(now - minutesAgo * 60_000)
  const today = new Date(now)
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000)
  if (diff <= 0) return t('common.today')
  if (diff === 1) return t('common.yesterday')
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function dayKey(minutesAgo: number, now = Date.now()): string {
  const d = new Date(now - minutesAgo * 60_000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
