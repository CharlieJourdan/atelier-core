// Real mode: turns what the main process knows (the agent runtime `orchestra.*`, the chat, the channels, the production
// runs and their gates) into the proto model the new screens read. Pure functions, no IPC: unit-tested, and the screens
// stay the same in demo and in real mode. Ids are prefixed so they never collide with the demo ones:
// channels `db-<id>`, agents `orch-<id>`, videos `vid-<videoId>`, inbox `orch-in-<id>` / `gate-<runId>-<nodeId>`.
import type { ChannelMeta } from '../../../shared/api/channel-life'
import type { ConversationRow, MessageRow } from '../../../shared/chat'
import { mentionSlug } from '../../../shared/chat-rich'
import type { InboxGate } from '../../../shared/api/home'
import type { OrchAccount, OrchAgent, OrchInboxItem, OrchTask } from '../../../shared/api/orchestra'
import type { RunSummary } from '../../../shared/runs'
import type { ChannelRow } from '../../../shared/workflow'
import type {
  AgentRole,
  AgentStatus,
  ChannelColor,
  EngineAccount,
  InboxItem,
  ModelTier,
  ProtoAgent,
  ProtoChannel,
  ProtoMessage,
  ProtoThread,
  ProtoVideo,
  StageId,
  VideoStatus
} from '../types'

export const channelKey = (id: number): string => `db-${id}`
export const agentKey = (id: number): string => `orch-${id}`
/** The screens find the main agent by its fixed id (`ag-principal`): the runtime's principal keeps it in real mode. */
export const PRINCIPAL_KEY = 'ag-principal'

/** Runtime agent id → the id the screens use. */
export function agentKeys(agents: readonly Pick<OrchAgent, 'id' | 'role' | 'parentId'>[]): (id: number) => string {
  const principal = agents.find((a) => a.role === 'principal' && a.parentId === null)
  return (id) => (principal && id === principal.id ? PRINCIPAL_KEY : agentKey(id))
}
export const videoKey = (videoId: number): string => `vid-${videoId}`
export const PRINCIPAL_THREAD = 'th-principal'

function minutesSince(iso: string, now: number): number {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 60_000)) : 0
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/* ---------- channels ---------- */

/** The app's channels; `meta` (channelLife.meta) gives their language and, for a translation, its source. */
export function mapChannels(rows: readonly ChannelRow[], now = Date.now(), meta: readonly ChannelMeta[] = []): ProtoChannel[] {
  const byId = new Map(meta.map((m) => [m.channelId, m]))
  return rows.map((c, i) => ({
    id: channelKey(c.id),
    name: c.name,
    handle: c.youtubeChannelId ? `@${c.youtubeChannelId}` : '',
    color: ((i % 6) + 1) as ChannelColor,
    initials:
      c.name
        .split(/\s+/)
        .filter((w) => /^[\p{L}\p{N}]/u.test(w))
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('') || '·',
    niche: c.niche,
    language: byId.get(c.id)?.language ?? 'fr',
    ...(byId.get(c.id)?.translatedFrom ? { translatedFrom: channelKey(byId.get(c.id)!.translatedFrom!) } : {}),
    format: 'long',
    // The real dashboard numbers need YouTube Analytics (lot 20): until then the screens say « non connectées ».
    connected: false,
    subscribers: 0,
    views28d: 0,
    revenue28d: 0,
    trend: 0,
    cadence: c.autopilotTarget ? `${c.autopilotTarget} vidéos par semaine` : '',
    automation: c.autopilotOn
      ? { idea: 'auto', script: 'auto', production: 'auto', packaging: 'validate', publishing: 'validate' }
      : { idea: 'validate', script: 'validate', production: 'auto', packaging: 'validate', publishing: 'validate' },
    pipelineIds: ['pl-docu'],
    products: [],
    createdDaysAgo: minutesSince((c as { createdAt?: string }).createdAt ?? new Date(now).toISOString(), now) / 1440
  }))
}

/* ---------- agents ---------- */

const ROLE_MAP: Record<string, AgentRole> = {
  principal: 'principal',
  channel_lead: 'channel-manager',
  researcher: 'researcher',
  trend_scout: 'researcher',
  seo_researcher: 'researcher',
  scriptwriter: 'scriptwriter',
  director: 'director',
  packaging: 'packaging',
  thumbnail_designer: 'packaging',
  production_supervisor: 'production-supervisor',
  production_coordinator: 'production-supervisor',
  video_producer: 'editor',
  editor: 'editor',
  competitor_analyst: 'competitor-analyst',
  voiceover: 'voice',
  qc_eye: 'qc-eye',
  qc: 'qc-eye',
  publisher: 'publisher',
  pipeline_architect: 'pipeline-architect',
  sponsor_manager: 'sponsor-manager'
}

export function roleOf(role: string): AgentRole {
  return ROLE_MAP[role] ?? 'custom'
}

const STATUS_MAP: Record<OrchAgent['status'], AgentStatus> = {
  working: 'working',
  idle: 'idle',
  sleeping: 'sleeping',
  waiting: 'waiting',
  paused: 'sleeping',
  error: 'waiting'
}

function modelOf(a: OrchAgent): ModelTier {
  const m = a.policy.model ?? ''
  if (/codex|gpt/i.test(m)) return 'codex'
  if (a.policy.tier === 'best' || /opus/i.test(m)) return 'opus'
  if (a.policy.tier === 'fast' || /haiku/i.test(m)) return 'haiku'
  return 'sonnet'
}

/** One line under the agent's name: what it does now, or why it is stopped. */
function taskLine(a: OrchAgent, current: OrchTask | undefined): string | undefined {
  if (a.paused) return 'En pause'
  if (a.status === 'error') return 'Dernière tâche en échec'
  if (current) return current.status === 'waiting_human' ? `Attend ta réponse : ${current.title}` : current.title
  if (a.queued > 0) return `${a.queued} tâche${a.queued > 1 ? 's' : ''} en file`
  return undefined
}

/** « Responsable de chaîne · Histoire » → « Responsable de chaîne » when the screen already shows the channel. */
export function shortName(name: string, channelName: string | undefined): string {
  if (!channelName) return name
  const suffix = ` · ${channelName}`
  return name.endsWith(suffix) && name.length > suffix.length ? name.slice(0, -suffix.length) : name
}

export function mapAgents(agents: readonly OrchAgent[], tasks: readonly OrchTask[], channelNames: ReadonlyMap<number, string> = new Map()): ProtoAgent[] {
  const key = agentKeys(agents)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const openByAgent = new Map<number, OrchTask>()
  for (const t of tasks) if (!openByAgent.has(t.assigneeId) && ['leased', 'running', 'waiting_human', 'waiting'].includes(t.status)) openByAgent.set(t.assigneeId, t)
  return agents.map((a) => {
    const current = (a.currentTaskId !== null ? byId.get(a.currentTaskId) : undefined) ?? openByAgent.get(a.id)
    const line = taskLine(a, current)
    const budgetUse = a.budgetUsdMonth ? Math.min(100, Math.round((a.spentUsdMonth / a.budgetUsdMonth) * 100)) : 0
    const load = Math.min(100, Math.max(budgetUse, (a.status === 'working' ? 45 : a.status === 'waiting' ? 25 : 5) + a.queued * 12))
    return {
      id: key(a.id),
      liveId: a.id,
      name: shortName(a.name, a.channelId !== null ? channelNames.get(a.channelId) : undefined),
      role: roleOf(a.role),
      channelId: a.channelId !== null ? channelKey(a.channelId) : null,
      parentId: a.parentId !== null ? key(a.parentId) : null,
      status: STATUS_MAP[a.status],
      ...(line ? { task: line } : {}),
      model: modelOf(a),
      load,
      memoryItems: 0,
      tasksDone7d: 0,
      colorIndex: a.parentId === null ? 0 : hash(a.slug) % 8,
      ...(a.look ? { look: a.look } : {}),
      spentUsdMonth: a.spentUsdMonth,
      instructions: a.instructions
    }
  })
}

/* ---------- accounts ---------- */

export function mapAccounts(rows: readonly OrchAccount[], now = Date.now()): EngineAccount[] {
  return rows.map((a) => {
    const limited = a.limitedUntil !== null && Date.parse(a.limitedUntil) > now
    const busy = a.maxConcurrent > 0 ? Math.round((a.running / a.maxConcurrent) * 100) : 0
    return {
      id: `acc-live-${a.id}`,
      provider: a.kind === 'codex' ? 'codex' : a.kind === 'relay' ? 'atelier' : 'claude-code',
      label: a.label,
      // the profile folder's name tells accounts apart; the default sign-in has none (no invented owner)
      owner: a.configDir ? (a.configDir.split(/[\\/]/).pop() ?? '') : '',
      plan: a.kind === 'anthropic' ? 'Clé API' : a.kind === 'relay' ? 'Relais en crédits' : 'Abonnement',
      usage5h: limited ? 100 : busy,
      usageWeek: Math.min(100, a.calls),
      status: !a.enabled ? 'off' : limited ? 'limited' : 'ok'
    }
  })
}

/* ---------- videos (production runs) ---------- */

const STAGE_HINTS: [RegExp, StageId][] = [
  [/research|recherche|sujet|idea|topic/i, 'idea'],
  [/script|outline|plan/i, 'script'],
  [/director|réalis|beats|shot|cut/i, 'director'],
  [/still|image|visual|visuel|broll|stock|gen/i, 'assets'],
  [/voice|voix|tts|speech/i, 'voice'],
  [/edit|montage|caption|sous|music|musique|render|rendu/i, 'edit'],
  [/thumb|miniature|package|paquet|title|titre/i, 'packaging']
]

export function stageOfNode(nodeId: string, label = ''): StageId {
  const text = `${nodeId} ${label}`
  for (const [re, stage] of STAGE_HINTS) if (re.test(text)) return stage
  return 'edit'
}

const RUN_STATUS: Record<RunSummary['status'], VideoStatus> = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting',
  succeeded: 'done',
  failed: 'blocked',
  cancelled: 'blocked',
  interrupted: 'blocked'
}

export function mapRuns(runs: readonly RunSummary[]): ProtoVideo[] {
  // One video per DB video: the newest run wins (production.list is newest first).
  const seen = new Set<number>()
  const out: ProtoVideo[] = []
  for (const r of runs) {
    if (seen.has(r.videoId)) continue
    seen.add(r.videoId)
    const status = RUN_STATUS[r.status]
    const waiting = r.waitingNodes.length > 0
    const stage: StageId = status === 'done' ? 'ready' : r.current ? stageOfNode(r.current.nodeId, r.current.label) : waiting ? stageOfNode(r.waitingNodes[0]!) : 'idea'
    out.push({
      id: videoKey(r.videoId),
      channelId: channelKey(r.channelId),
      title: r.videoTitle || r.topic,
      brief: r.topic,
      format: 'long',
      pipelineId: 'pl-docu',
      stage,
      progress: Math.round(Math.max(0, Math.min(1, r.progress)) * 100),
      status: waiting ? 'waiting' : status,
      ...(waiting ? { waitingFor: { kind: 'validate' as const, label: 'À valider' } } : r.error ? { waitingFor: { kind: 'input' as const, label: r.error } } : {}),
      dueInDays: 0,
      publishInDays: null,
      publishTime: '18:00',
      durationSec: Math.round(r.minutes * 60),
      creditsSpent: r.spentCredits,
      creditsEstimate: r.quoteCredits,
      agentId: '',
      thumbHue: hash(String(r.videoId)) % 360
    })
  }
  return out
}

/* ---------- inbox ---------- */

const ORCH_INBOX_KIND: Record<OrchInboxItem['kind'], InboxItem['kind']> = {
  validate: 'validate-director',
  input: 'upload-input',
  files: 'upload-input',
  alert: 'approve-publish'
}

export function mapInbox(items: readonly OrchInboxItem[], gates: readonly InboxGate[], agents: readonly OrchAgent[], now = Date.now()): InboxItem[] {
  const agentsById = new Map(agents.map((a) => [a.id, a]))
  const key = agentKeys(agents)
  const fromAgents: InboxItem[] = items
    .filter((i) => i.status === 'open')
    .map((i) => {
      const agent = i.agentId !== null ? agentsById.get(i.agentId) : undefined
      return {
        id: `orch-in-${i.id}`,
        live: { source: 'orchestra', id: i.id, kind: i.kind, body: i.body, options: i.options, taskId: i.taskId, gate: i.gate, series: i.series, channelLiveId: i.channelId },
        kind: ORCH_INBOX_KIND[i.kind],
        videoId: null,
        channelId: agent?.channelId != null ? channelKey(agent.channelId) : null,
        title: i.title,
        detail: i.body.split('\n')[0]?.slice(0, 160) ?? '',
        agentId: agent ? key(agent.id) : '',
        minutesAgo: minutesSince(i.createdAt, now)
      }
    })
  const fromGates: InboxItem[] = gates.map((g) => ({
    id: `gate-${g.runId}-${g.nodeId}`,
    live: { source: 'gate', runId: g.runId, nodeId: g.nodeId, nodeLabel: g.nodeLabel, pipelineLabel: g.pipelineLabel, demo: g.demo },
    kind: stageOfNode(g.nodeId, g.nodeLabel) === 'script' ? 'validate-script' : 'validate-director',
    videoId: videoKey(g.videoId),
    channelId: channelKey(g.channelId),
    title: `${g.nodeLabel} de « ${g.videoTitle} »`,
    detail: g.step ?? g.pipelineLabel,
    agentId: '',
    minutesAgo: 0
  }))
  return [...fromAgents, ...fromGates]
}

/* ---------- conversations ---------- */

export interface LiveChat {
  conversations: ConversationRow[]
  /** Messages per conversation id (the last ones). */
  messages: Record<number, MessageRow[]>
}

/** The thread a conversation shows as: the principal (Supervisor chat), a channel group, or a video. */
export function threadIdOf(c: ConversationRow): string | null {
  if (c.kind === 'supervisor') return PRINCIPAL_THREAD
  if (c.kind === 'channel' && c.channelId !== null) return `th-group-${channelKey(c.channelId)}`
  if (c.kind === 'video' && c.videoId !== null) return `th-video-${videoKey(c.videoId)}`
  return null
}

/** Removes the leading « @Name » the app adds when Charlie writes to one agent. */
export function stripLeadingMention(body: string, names: readonly string[]): string {
  const m = /^@([\p{L}\p{N}_-]+)\s+/u.exec(body)
  if (!m) return body
  return names.some((n) => mentionSlug(n).toLowerCase() === m[1]!.toLowerCase()) ? body.slice(m[0].length) : body
}

export function mapChat(chat: LiveChat, agents: readonly OrchAgent[], principalName: string, now = Date.now()): { threads: ProtoThread[]; messages: ProtoMessage[] } {
  const bySlug = new Map(agents.map((a) => [a.slug, a]))
  const key = agentKeys(agents)
  const principal = agents.find((a) => a.parentId === null)
  const names = agents.map((a) => a.name)
  const threads: ProtoThread[] = []
  const messages: ProtoMessage[] = []
  for (const c of chat.conversations) {
    const threadId = threadIdOf(c)
    if (!threadId) continue
    const channelAgents = c.channelId !== null ? agents.filter((a) => a.channelId === c.channelId) : []
    threads.push({
      id: threadId,
      liveConversationId: c.id,
      kind: c.kind === 'supervisor' ? 'principal' : c.kind === 'video' ? 'video' : 'channel-group',
      title: c.kind === 'supervisor' ? principalName : c.title,
      ...(c.channelId !== null ? { channelId: channelKey(c.channelId) } : {}),
      ...(c.videoId !== null ? { videoId: videoKey(c.videoId) } : {}),
      ...(c.kind === 'supervisor' && principal ? { agentId: key(principal.id) } : {}),
      participantIds: c.kind === 'supervisor' ? [PRINCIPAL_KEY, 'user'] : [...channelAgents.map((a) => key(a.id)), 'user'],
      unread: c.unread
    })
    for (const m of chat.messages[c.id] ?? []) {
      const agent = m.authorType === 'agent' && m.authorId?.startsWith('orch:') ? bySlug.get(m.authorId.slice('orch:'.length)) : undefined
      const authorId = m.authorType === 'owner' ? 'user' : agent ? key(agent.id) : m.authorType === 'agent' && c.kind === 'supervisor' && principal ? key(principal.id) : 'system'
      const text = m.authorType === 'owner' ? stripLeadingMention(m.body, names) : m.body
      const base = { threadId, authorId, text, minutesAgo: minutesSince(m.createdAt, now) }
      messages.push({ id: `msg-${m.id}`, ...base })
      // An agent's own lines (and Charlie's messages to it) also show in its direct thread.
      const target = m.authorType === 'owner' ? /^@([\p{L}\p{N}_-]+)/u.exec(m.body)?.[1] : undefined
      const dmAgent = agent ?? (target ? agents.find((a) => mentionSlug(a.name).toLowerCase() === target.toLowerCase()) : undefined)
      if (dmAgent && c.kind !== 'supervisor' && dmAgent.parentId !== null) messages.push({ id: `msg-${m.id}-dm`, ...base, threadId: `th-dm-${key(dmAgent.id)}` })
    }
  }
  return { threads, messages }
}

/** The agent (runtime id) a message typed in a thread goes to: the principal, the agent of a DM, a channel's lead. */
export function recipientOf(threadId: string, agents: readonly ProtoAgent[], videos: readonly ProtoVideo[]): { liveId: number; videoId: number | null } | null {
  const live = agents.filter((a) => a.liveId !== undefined)
  const principal = live.find((a) => a.role === 'principal')
  if (threadId === PRINCIPAL_THREAD) return principal ? { liveId: principal.liveId!, videoId: null } : null
  if (threadId.startsWith('th-dm-')) {
    const a = live.find((x) => x.id === threadId.slice('th-dm-'.length))
    return a ? { liveId: a.liveId!, videoId: null } : null
  }
  const leadOf = (channelId: string | null) => live.find((a) => a.role === 'channel-manager' && a.channelId === channelId) ?? principal
  if (threadId.startsWith('th-group-')) {
    const lead = leadOf(threadId.slice('th-group-'.length))
    return lead ? { liveId: lead.liveId!, videoId: null } : null
  }
  if (threadId.startsWith('th-video-')) {
    const key = threadId.slice('th-video-'.length)
    const video = videos.find((v) => v.id === key)
    const lead = leadOf(video?.channelId ?? null)
    const videoId = key.startsWith('vid-') ? Number(key.slice(4)) : NaN
    return lead ? { liveId: lead.liveId!, videoId: Number.isInteger(videoId) ? videoId : null } : null
  }
  return null
}
