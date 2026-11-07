// Real mode, the IPC side: reads a snapshot of the runtime and the app (agents, tasks, inbox, accounts, chat, channels,
// runs, gates) and sends the user's actions back (answer an item, approve a gate, write to an agent, recruit, edit an
// agent). Only used in the desktop app (the web demo has no main process).
import type { OrchAgentPatch, OrchInboxItem, OrchMemoryItem, OrchRoutine, OrchStatus, OrchTask } from '../../../shared/api/orchestra'
import { call } from '@/state/client'
import type { ProtoState } from '../store'
import type { BlueprintStatus } from '../../../shared/blueprint'
import type { InboxAnswer, InboxItem, ProtoAgent } from '../types'
import type { RunDetail } from '../../../shared/runs'
import { mapAccounts, mapAgents, mapChannels, mapChat, mapInbox, recipientOf, type LiveChat } from './mapping'
import { brainDriver, loadBrainMoney, loadGoogle, moneyDriver } from './driver-brain-money'
import { withGoogle } from './mapping-google'
import { mapVideos, pipelineFromNodes, quoteNodes, runNodes } from './mapping-production'
import { mapVoices, type LiveVoices } from './mapping-voices'
import type { LiveDriver, LiveRunInput, LiveRunResult, LiveSnapshot } from './registry'

/** True in the desktop app: the preload bridge exists and is not the web demo's stub. */
export { isDesktopApp as isDesktop } from './desktop'

/** The runtime's seed name of the main agent. */
const DEFAULT_RUNTIME_PRINCIPAL = 'Atlas'

/** How many messages of each conversation the screens show. */
const MESSAGES_PER_CONVERSATION = 80

export async function loadSnapshot(principalName: string): Promise<LiveSnapshot> {
  let agents = await call('orchestra.agents')
  // First time: the hierarchy is seeded from the channels of the database.
  if (agents.length === 0) {
    await call('orchestra.seed')
    agents = await call('orchestra.agents')
  }
  const [status, tasks, inbox, accounts, channels, runs, homeInbox, conversations, videoRows] = await Promise.all([
    call('orchestra.status'),
    call('orchestra.tasks', { status: ['queued', 'leased', 'running', 'waiting', 'waiting_human', 'failed'], limit: 300 }),
    call('orchestra.inbox'),
    call('orchestra.accounts'),
    call('channels.list'),
    call('production.list', { limit: 300 }),
    call('home.inbox'),
    call('chat.conversations'),
    call('videos.list')
  ])
  const channelMeta = await call('channelLife.meta').catch(() => [])
  // an archived channel leaves the screens: its group, its videos' threads and its (paused) agents
  const active = new Set(channels.map((c) => c.id))
  const kept = (channelId: number | null): boolean => channelId === null || active.has(channelId)
  agents = agents.filter((a) => kept(a.channelId))
  const shown = conversations.filter((c) => (c.kind === 'supervisor' || c.kind === 'channel' || c.kind === 'video') && kept(c.channelId))
  const lists = await Promise.all(shown.map((c) => call('chat.messages', c.id)))
  const chat: LiveChat = { conversations: shown, messages: {} }
  shown.forEach((c, i) => {
    chat.messages[c.id] = (lists[i] ?? []).slice(-MESSAGES_PER_CONVERSATION)
  })
  // The main agent takes the name chosen in the app (onboarding) the first time it is seen with its default name.
  const principalRow = agents.find((a) => a.role === 'principal' && a.parentId === null)
  if (principalRow && principalRow.name === DEFAULT_RUNTIME_PRINCIPAL && principalName.trim() && principalName !== DEFAULT_RUNTIME_PRINCIPAL) {
    await call('orchestra.updateAgent', principalRow.id, { name: principalName.trim() })
    principalRow.name = principalName.trim()
  }
  const { videos, pipelines } = await loadProduction(runs, videoRows, channels.map((c) => c.id))
  const mappedAgents = mapAgents(agents, tasks, new Map(channels.map((c) => [c.id, c.name])))
  const principal = mappedAgents.find((a) => a.role === 'principal')
  const { threads, messages } = mapChat(chat, agents, principal?.name ?? principalName)
  const google = await loadGoogle(channels)
  const brainMoney = await loadBrainMoney(runs, videoRows, google)
  const voices = await loadVoices()
  const blueprint = await loadBlueprint()
  return {
    ...brainMoney,
    ...(voices ? { voices } : {}),
    ...(blueprint ? { blueprint } : {}),
    status,
    channels: withGoogle(mapChannels(channels, Date.now(), channelMeta), google),
    agents: mappedAgents,
    videos,
    pipelines,
    inbox: mapInbox(inbox, homeInbox.gates, agents),
    accounts: mapAccounts(accounts),
    threads,
    messages
  }
}

/** The Cloud's voices; undefined when they could not be read (the screens keep the previous list). */
async function loadVoices(): Promise<LiveVoices | undefined> {
  try {
    return mapVoices(await call('cloud.voices'))
  } catch {
    return undefined
  }
}

/** The published blueprint (cached by the main process); undefined when it could not be read. */
async function loadBlueprint(): Promise<BlueprintStatus | undefined> {
  try {
    return await call('cloud.blueprint')
  } catch {
    return undefined
  }
}

/** How many runs in progress get their node detail (the overview's lanes and the video sheet). */
const DETAILED_RUNS = 20

/**
 * The production side of a snapshot: the node detail of the runs in progress (and of one run per pipeline, for its
 * shape), the engine's current pipeline from a quote when no run uses it yet, then videos and pipelines for the screens.
 */
async function loadProduction(
  runs: Awaited<ReturnType<typeof call<'production.list'>>>,
  videoRows: Awaited<ReturnType<typeof call<'videos.list'>>>,
  channelIds: number[]
): Promise<Pick<LiveSnapshot, 'videos' | 'pipelines'>> {
  const wanted = new Set<number>()
  for (const r of runs) if (['queued', 'running', 'waiting'].includes(r.status) && wanted.size < DETAILED_RUNS) wanted.add(r.id)
  const perPipeline = new Map<string, number>()
  for (const r of runs) if (!perPipeline.has(r.pipelineId)) perPipeline.set(r.pipelineId, r.id)
  for (const id of perPipeline.values()) wanted.add(id)
  const details = new Map<number, RunDetail>()
  await Promise.all(
    [...wanted].map(async (id) => {
      try {
        details.set(id, await call('production.get', id))
      } catch {
        // a run deleted meanwhile: shown without its nodes
      }
    })
  )
  const pipelines = []
  for (const [pipelineId, runId] of perPipeline) {
    const d = details.get(runId)
    if (!d) continue
    const used = [...new Set(runs.filter((r) => r.pipelineId === pipelineId).map((r) => `db-${r.channelId}`))]
    pipelines.push(pipelineFromNodes({ pipelineId, label: d.pipelineLabel, version: d.pipelineVersion }, runNodes(d), used))
  }
  try {
    const quote = await call('production.quote', { minutes: 8 })
    const fromQuote = pipelineFromNodes({ pipelineId: quote.pipelineId, label: quote.pipelineLabel, version: quote.pipelineVersion }, quoteNodes(quote.modes.usage_max.nodes), [])
    const same = pipelines.find((p) => p.id === fromQuote.id)
    if (same) Object.assign(same, { creditsPerVideo: fromQuote.creditsPerVideo, minutesPerVideo: fromQuote.minutesPerVideo, minutesCloud: fromQuote.minutesCloud, nodes: same.nodes.map((n) => ({ ...n, minutes: fromQuote.nodes.find((q) => q.id === n.id)?.minutes ?? n.minutes, credits: fromQuote.nodes.find((q) => q.id === n.id)?.credits ?? n.credits })) })
    else pipelines.push({ ...fromQuote, channelIds: channelIds.map((c) => `db-${c}`) })
  } catch {
    // no engine (ffmpeg missing…): the pipelines of the runs only
  }
  return { videos: mapVideos(videoRows, runs, details, new Date()), pipelines }
}

async function startRun(input: LiveRunInput): Promise<LiveRunResult> {
  let libraryId: number | null = null
  let notes: LiveRunResult['notes'] = []
  if (input.drawing) {
    const saved = await call('pipelines.saveDrawing', input.drawing, { ...(input.libraryId !== undefined ? { pipelineId: input.libraryId } : {}), channelId: input.channelId })
    libraryId = saved.pipelineId
    notes = saved.notes
  }
  const run = await call('production.start', {
    ...(libraryId !== null ? { pipelineId: libraryId } : input.pipelineId !== undefined ? { pipelineId: input.pipelineId } : {}),
    channelId: input.channelId,
    title: input.title,
    topic: input.topic,
    minutes: Math.min(30, Math.max(0.5, input.minutes)),
    budgetMode: 'usage_max',
    gateMode: input.gateMode,
    ...(input.inputs && Object.keys(input.inputs).length > 0 ? { inputs: input.inputs } : {}),
    ...(input.style && Object.keys(input.style).length > 0 ? { style: input.style } : {})
  })
  if (input.deadline) await call('videos.update', run.videoId, { deadline: input.deadline })
  return { libraryId, notes, runId: run.id }
}

async function answer(item: InboxItem, a: InboxAnswer): Promise<void> {
  const ref = item.live
  if (!ref) return
  if (ref.source === 'gate') {
    if (a.changes) await call('production.requestChanges', ref.runId, ref.nodeId, (a.text ?? '').trim() || 'À revoir')
    else await call('production.approve', ref.runId, ref.nodeId)
    return
  }
  if (ref.kind === 'alert') {
    // An alert is a dead-lettered task: « Relancer » retries it, anything else just closes the alert.
    if (a.choice === 'retry' && ref.taskId !== null) await call('orchestra.retryTask', ref.taskId)
    await call('orchestra.answer', ref.id, { choice: a.choice ?? 'ok' })
    return
  }
  if (a.always && ref.kind === 'validate') {
    await call('autopilot.allowAlways', ref.id, { series: a.always === 'series' })
    return
  }
  const out: { text?: string; choice?: string; files?: string[] } = {}
  if (a.choice) out.choice = a.choice
  if (a.text?.trim()) out.text = a.text.trim()
  if (a.files?.length) out.files = a.files
  if (!out.choice && !out.text && !out.files) out.choice = 'Valider'
  await call('orchestra.answer', ref.id, out)
}

async function say(state: ProtoState, threadId: string, text: string): Promise<void> {
  const to = recipientOf(threadId, state.agents, state.videos)
  if (!to) throw new Error('Aucun agent du moteur pour ce fil')
  await call('orchestra.say', { agentId: to.liveId, text, ...(to.videoId !== null ? { videoId: to.videoId } : {}) })
}

async function createAgent(state: ProtoState, agent: Omit<ProtoAgent, 'id'>, instructions?: string): Promise<void> {
  const parent = state.agents.find((a) => a.id === agent.parentId)?.liveId ?? state.agents.find((a) => a.role === 'principal')?.liveId
  if (parent === undefined) throw new Error('Pas d’agent principal dans le moteur')
  await call('orchestra.createAgent', {
    name: agent.name,
    role: agent.role.replace(/-/g, '_'),
    parentId: parent,
    ...(instructions ? { instructions } : {}),
    policy: { tier: agent.model === 'opus' ? 'best' : agent.model === 'haiku' ? 'fast' : 'balanced' }
  })
}

export const desktopDriver: LiveDriver = {
  load: loadSnapshot,
  answer,
  say,
  createAgent,
  updateAgent: async (liveId: number, patch: OrchAgentPatch) => {
    await call('orchestra.updateAgent', liveId, patch)
  },
  memory: (liveId: number): Promise<OrchMemoryItem[]> => call('orchestra.memory', liveId),
  deleteMemory: async (id: number) => {
    await call('orchestra.deleteMemory', id)
  },
  routines: (liveId: number): Promise<OrchRoutine[]> => call('orchestra.routines', liveId),
  toggleRoutine: async (id: number, on: boolean) => {
    await call('orchestra.toggleRoutine', id, on)
  },
  tasks: (liveId: number): Promise<OrchTask[]> => call('orchestra.tasks', { assigneeId: liveId, limit: 30 }),
  inboxItem: async (id: number): Promise<OrchInboxItem | undefined> => (await call('orchestra.inbox', true)).find((i) => i.id === id),
  status: (): Promise<OrchStatus> => call('orchestra.status'),
  tick: async () => {
    await call('orchestra.tick', {})
  },
  schedule: async (videoId: number, deadline: string | null) => {
    await call('videos.update', videoId, { deadline })
  },
  startRun,
  brain: brainDriver,
  money: moneyDriver,
  voices: { clone: (request) => call('cloud.cloneVoice', request) },
  blueprint: {
    plan: () => call('cloud.blueprintPlan'),
    apply: (version, agentIds) => call('cloud.blueprintApply', version, agentIds),
    refresh: () => call('cloud.blueprint', true)
  }
}
