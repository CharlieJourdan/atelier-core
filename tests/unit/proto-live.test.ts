// Real mode of the new screens: the mapping from the runtime / chat / runs / gates to the proto model, and the store's
// actions going through a live driver (a fake one here: nothing reaches the main process).
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRow, MessageRow } from '../../src/shared/chat'
import type { InboxGate } from '../../src/shared/api/home'
import type { OrchAccount, OrchAgent, OrchInboxItem, OrchStatus, OrchTask } from '../../src/shared/api/orchestra'
import type { RunSummary } from '../../src/shared/runs'
import type { ChannelRow } from '../../src/shared/workflow'
import {
  PRINCIPAL_KEY,
  mapAccounts,
  mapAgents,
  mapChannels,
  mapChat,
  mapInbox,
  mapRuns,
  recipientOf,
  shortName,
  stageOfNode,
  stripLeadingMention
} from '../../src/renderer/proto/live/mapping'
import { setLiveDriver, type LiveDriver, type LiveSnapshot } from '../../src/renderer/proto/live/registry'
import { applySnapshot, createProtoStore, initialState } from '../../src/renderer/proto/store'
import { cronLabel } from '../../src/renderer/proto/live/agent-detail'

const NOW = Date.parse('2026-10-24T20:00:00Z')

function agent(p: Partial<OrchAgent> & Pick<OrchAgent, 'id' | 'slug' | 'role' | 'name'>): OrchAgent {
  return {
    parentId: null,
    channelId: null,
    status: 'sleeping',
    instructions: '',
    policy: {},
    budgetUsdMonth: null,
    spentUsdMonth: 0,
    custom: false,
    paused: false,
    currentTaskId: null,
    queued: 0,
    lastActiveAt: null,
    ...p
  } as OrchAgent
}

const AGENTS: OrchAgent[] = [
  agent({ id: 1, slug: 'principal', role: 'principal', name: 'Agent principal', status: 'working', currentTaskId: 10, policy: { tier: 'best' } }),
  agent({ id: 2, slug: 'lead-7', role: 'channel_lead', name: 'Responsable · Histoire', parentId: 1, channelId: 7, status: 'waiting' }),
  agent({ id: 3, slug: 'researcher-7', role: 'researcher', name: 'Recherchiste · Histoire', parentId: 2, channelId: 7, policy: { tier: 'fast' }, queued: 2 }),
  agent({ id: 4, slug: 'video-producer-7', role: 'video_producer', name: 'Monteur · Histoire', parentId: 2, channelId: 7, paused: true, status: 'paused' })
]

const TASKS = [
  { id: 10, kind: 'plan', title: 'Planifier la semaine', status: 'running', assigneeId: 1 },
  { id: 11, kind: 'topics', title: 'Sujets de lundi', status: 'waiting_human', assigneeId: 2 }
] as unknown as OrchTask[]

const CHANNELS = [{ id: 7, name: 'Histoires oubliées', youtubeChannelId: null, niche: 'Histoire', autopilotOn: false, autopilotTarget: 2 }] as unknown as ChannelRow[]

describe('real mode: mapping', () => {
  it('channels get stable ids, initials and colours, and are never « connected » without YouTube Analytics', () => {
    const [c] = mapChannels(CHANNELS, NOW)
    expect(c).toMatchObject({ id: 'db-7', name: 'Histoires oubliées', initials: 'HO', color: 1, connected: false, cadence: '2 vidéos par semaine' })
  })

  it('agents: the principal keeps the fixed id the screens use; roles, status, model and the current task line', () => {
    const out = mapAgents(AGENTS, TASKS)
    expect(out.map((a) => a.id)).toEqual([PRINCIPAL_KEY, 'orch-2', 'orch-3', 'orch-4'])
    expect(out[0]).toMatchObject({ role: 'principal', parentId: null, model: 'opus', status: 'working', task: 'Planifier la semaine', liveId: 1 })
    expect(out[1]).toMatchObject({ role: 'channel-manager', parentId: PRINCIPAL_KEY, channelId: 'db-7', status: 'waiting', task: 'Attend ta réponse : Sujets de lundi' })
    expect(out[2]).toMatchObject({ role: 'researcher', model: 'haiku', task: '2 tâches en file', parentId: 'orch-2' })
    expect(out[3]).toMatchObject({ role: 'editor', status: 'sleeping', task: 'En pause' })
  })

  it('accounts: a limit in force shows as « limited », a disabled account as « off »', () => {
    const rows = [
      { id: 1, kind: 'claude-code', label: 'Claude Code', configDir: null, enabled: true, maxConcurrent: 2, running: 1, calls: 12, limitedUntil: null },
      { id: 2, kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\c2', enabled: true, maxConcurrent: 2, running: 0, calls: 3, limitedUntil: '2026-10-24T21:00:00Z' },
      { id: 3, kind: 'codex', label: 'Codex', configDir: null, enabled: false, maxConcurrent: 1, running: 0, calls: 0, limitedUntil: null }
    ] as unknown as OrchAccount[]
    expect(mapAccounts(rows, NOW).map((a) => [a.provider, a.status, a.usage5h])).toEqual([
      ['claude-code', 'ok', 50],
      ['claude-code', 'limited', 100],
      ['codex', 'off', 0]
    ])
  })

  it('runs become videos: one per DB video (newest run), stage from the node, waiting at a gate', () => {
    const runs = [
      { id: 2, videoId: 5, videoTitle: 'Les Templiers', channelId: 7, topic: 'Templiers', status: 'waiting', progress: 0.42, waitingNodes: ['script'], current: null, error: null, minutes: 8, quoteCredits: 300, spentCredits: 40 },
      { id: 1, videoId: 5, videoTitle: 'Vieux run', channelId: 7, topic: 'x', status: 'failed', progress: 0, waitingNodes: [], current: null, error: 'boom', minutes: 8, quoteCredits: 0, spentCredits: 0 },
      { id: 3, videoId: 6, videoTitle: 'Voynich', channelId: 7, topic: 'Voynich', status: 'running', progress: 0.7, waitingNodes: [], current: { nodeId: 'voice', label: 'Voix', step: null }, error: null, minutes: 10, quoteCredits: 200, spentCredits: 90 }
    ] as unknown as RunSummary[]
    const v = mapRuns(runs)
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({ id: 'vid-5', channelId: 'db-7', stage: 'script', status: 'waiting', progress: 42, waitingFor: { kind: 'validate' } })
    expect(v[1]).toMatchObject({ id: 'vid-6', stage: 'voice', status: 'running', progress: 70 })
    expect(stageOfNode('render-final')).toBe('edit')
    expect(stageOfNode('thumbnail')).toBe('packaging')
  })

  it('inbox: open runtime items and production gates, each with what answering it needs', () => {
    const items = [
      { id: 9, taskId: 11, agentId: 2, kind: 'validate', title: 'Sujets à valider', body: 'Trois sujets :\n1. …', options: ['Valider', 'Refaire'], status: 'open', answer: null, createdAt: '2026-10-24T19:30:00Z', answeredAt: null },
      { id: 8, taskId: null, agentId: 1, kind: 'alert', title: 'Vieille alerte', body: '…', options: [], status: 'answered', answer: null, createdAt: '2026-10-24T10:00:00Z', answeredAt: null }
    ] as OrchInboxItem[]
    const gates = [{ runId: 2, nodeId: 'script', nodeLabel: 'Script', gateKind: 'review', videoId: 5, videoTitle: 'Les Templiers', channelId: 7, channelName: 'x', pipelineLabel: 'Vidéo simple', demo: true, step: null }] as InboxGate[]
    const out = mapInbox(items, gates, AGENTS, NOW)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'orch-in-9', agentId: 'orch-2', channelId: 'db-7', minutesAgo: 30, detail: 'Trois sujets :', live: { source: 'orchestra', id: 9, options: ['Valider', 'Refaire'] } })
    expect(out[1]).toMatchObject({ id: 'gate-2-script', kind: 'validate-script', videoId: 'vid-5', title: 'Script de « Les Templiers »', live: { source: 'gate', runId: 2, nodeId: 'script' } })
  })

  it('chat: Supervisor → principal thread, channel → group, agent lines also in its DM; the « @Name » prefix is hidden', () => {
    const conv = (p: Partial<ConversationRow>): ConversationRow => ({ title: '', videoId: null, agentId: null, channelId: null, department: null, unread: 0, lastMessage: null, updatedAt: '', ...p }) as ConversationRow
    const msg = (p: Partial<MessageRow>): MessageRow => ({ card: null, attachments: [], tools: [], createdAt: '2026-10-24T19:58:00Z', authorId: null, ...p }) as MessageRow
    const chat = {
      conversations: [conv({ id: 1, kind: 'supervisor' }), conv({ id: 2, kind: 'channel', channelId: 7, title: 'Histoires oubliées', unread: 2 }), conv({ id: 3, kind: 'agent' })],
      messages: {
        1: [msg({ id: 100, conversationId: 1, authorType: 'owner', body: '@Agent_principal Prépare la semaine' }), msg({ id: 101, conversationId: 1, authorType: 'agent', authorId: 'orch:principal', body: 'C’est parti.' })],
        2: [msg({ id: 200, conversationId: 2, authorType: 'agent', authorId: 'orch:researcher-7', body: 'J’ai 3 sujets.' }), msg({ id: 201, conversationId: 2, authorType: 'system', body: 'Responsable attend ta réponse' })]
      }
    }
    const { threads, messages } = mapChat(chat, AGENTS, 'Atlas', NOW)
    expect(threads.map((t) => [t.id, t.kind, t.liveConversationId])).toEqual([
      ['th-principal', 'principal', 1],
      ['th-group-db-7', 'channel-group', 2]
    ])
    expect(threads[1]!.participantIds).toEqual(['orch-2', 'orch-3', 'orch-4', 'user'])
    const byThread = (id: string) => messages.filter((m) => m.threadId === id).map((m) => [m.authorId, m.text])
    expect(byThread('th-principal')).toEqual([
      ['user', 'Prépare la semaine'],
      [PRINCIPAL_KEY, 'C’est parti.']
    ])
    expect(byThread('th-group-db-7')).toEqual([
      ['orch-3', 'J’ai 3 sujets.'],
      ['system', 'Responsable attend ta réponse']
    ])
    expect(byThread('th-dm-orch-3')).toEqual([['orch-3', 'J’ai 3 sujets.']])
    expect(stripLeadingMention('@Someone else hi', ['Agent principal'])).toBe('@Someone else hi')
  })

  it('who a message goes to: principal, a DM agent, the channel lead for a group or a video', () => {
    const agents = mapAgents(AGENTS, [])
    const videos = mapRuns([{ id: 1, videoId: 5, videoTitle: 'T', channelId: 7, topic: 'T', status: 'running', progress: 0, waitingNodes: [], current: null, error: null, minutes: 1, quoteCredits: 0, spentCredits: 0 }] as unknown as RunSummary[])
    expect(recipientOf('th-principal', agents, videos)).toEqual({ liveId: 1, videoId: null })
    expect(recipientOf('th-dm-orch-3', agents, videos)).toEqual({ liveId: 3, videoId: null })
    expect(recipientOf('th-group-db-7', agents, videos)).toEqual({ liveId: 2, videoId: null })
    expect(recipientOf('th-video-vid-5', agents, videos)).toEqual({ liveId: 2, videoId: 5 })
    expect(recipientOf('th-unknown', agents, videos)).toBeNull()
  })

  it('names: the channel suffix goes when the screen already shows the channel', () => {
    expect(shortName('Responsable de chaîne · Histoire', 'Histoire')).toBe('Responsable de chaîne')
    expect(shortName('Clippeur', 'Histoire')).toBe('Clippeur')
    expect(mapAgents(AGENTS, [], new Map([[7, 'Histoire']]))[1]!.name).toBe('Responsable')
  })

  it('routine schedules read in French', () => {
    expect(cronLabel('0 8 * * *')).toBe('Chaque jour à 08 h')
    expect(cronLabel('30 9 * * 1')).toBe('Chaque lundi à 09 h 30')
    expect(cronLabel('*/15 * * * *')).toBe('*/15 * * * *')
  })
})

/* ---------- the store in real mode ---------- */

function snapshot(): LiveSnapshot {
  return {
    status: { enabled: false, running: 1, maxConcurrent: 3, tasks: { queued: 1 }, agents: 4, accountsReady: 1, accountsLimited: 0, resumesAt: null, openInbox: 1 } as OrchStatus,
    channels: mapChannels(CHANNELS, NOW),
    agents: mapAgents(AGENTS, TASKS),
    videos: [],
    pipelines: [],
    inbox: mapInbox(
      [{ id: 9, taskId: 11, agentId: 2, kind: 'validate', title: 'Sujets', body: 'b', options: [], status: 'open', answer: null, createdAt: '2026-10-24T19:30:00Z', answeredAt: null, gate: null, channelId: null, series: null }] as OrchInboxItem[],
      [],
      AGENTS,
      NOW
    ),
    accounts: [],
    threads: [{ id: 'th-principal', kind: 'principal', title: 'Agent principal', participantIds: [PRINCIPAL_KEY, 'user'], unread: 0 }],
    messages: []
  }
}

function fakeDriver(): LiveDriver & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    load: async () => snapshot(),
    answer: async (item, a) => {
      calls.push(`answer:${item.id}:${a.choice ?? a.text ?? ''}`)
    },
    say: async (_s, threadId, text) => {
      calls.push(`say:${threadId}:${text}`)
    },
    createAgent: async (_s, a, instructions) => {
      calls.push(`create:${a.name}:${instructions ?? ''}`)
    },
    updateAgent: async () => undefined,
    memory: async () => [],
    deleteMemory: async () => undefined,
    routines: async () => [],
    toggleRoutine: async () => undefined,
    tasks: async () => [],
    inboxItem: async () => undefined,
    status: async () => snapshot().status,
    tick: async () => undefined,
    schedule: async () => undefined,
    startRun: async () => ({ libraryId: null, notes: [] })
  }
}

describe('real mode: the store', () => {
  afterEach(() => setLiveDriver(null))

  it('a snapshot only applies in real mode, and replaces the demo workspace', () => {
    const demo = initialState({ mode: 'demo' })
    expect(applySnapshot(demo, snapshot())).toBe(demo)
    const live = applySnapshot(initialState({ mode: 'live', scope: 'ch-enigmes' }), snapshot())
    expect(live.channels.map((c) => c.id)).toEqual(['db-7'])
    expect(live.agents[0]!.id).toBe(PRINCIPAL_KEY)
    expect(live.principalName).toBe('Agent principal')
    expect(live.scope).toBe('all') // the demo channel shown before is gone
    expect(live.live).toMatchObject({ loading: false, error: null, status: { agents: 4 } })
  })
})

describe('real mode: store actions without React', () => {
  afterEach(() => setLiveDriver(null))

  it('resolve / send / addAgent call the driver and update the state optimistically', async () => {
    vi.useFakeTimers()
    const driver = fakeDriver()
    setLiveDriver(driver)
    const { storeActions } = await import('../../src/renderer/proto/store')
    const store = createProtoStore(initialState({ mode: 'live' }))
    store.set((s) => applySnapshot(s, snapshot()))
    const act = storeActions(store)

    act.resolveInbox('orch-in-9', { choice: 'Valider' })
    expect(store.get().inbox).toEqual([])
    act.send('th-principal', 'Bonjour')
    expect(store.get().messages.at(-1)).toMatchObject({ authorId: 'user', text: 'Bonjour', threadId: 'th-principal' })
    expect(store.get().typing).toEqual(['live-th-principal-0'])
    act.addAgent({ name: 'Clippeur', role: 'custom', channelId: null, parentId: PRINCIPAL_KEY, status: 'idle', model: 'sonnet', load: 0, memoryItems: 0, tasksDone7d: 0, colorIndex: 1 }, 'Découpe les shorts')
    await vi.runAllTimersAsync()
    expect(driver.calls).toEqual(['answer:orch-in-9:Valider', 'say:th-principal:Bonjour', 'create:Clippeur:Découpe les shorts'])

    // the agent answered: the typing mark goes, the user's message is kept until the snapshot holds it
    const next = snapshot()
    next.messages = [
      { id: 'msg-1', threadId: 'th-principal', authorId: 'user', text: 'Bonjour', minutesAgo: 0 },
      { id: 'msg-2', threadId: 'th-principal', authorId: PRINCIPAL_KEY, text: 'Salut', minutesAgo: 0 }
    ]
    store.set((s) => applySnapshot(s, next))
    expect(store.get().typing).toEqual([])
    expect(store.get().messages.filter((m) => m.authorId === 'user')).toHaveLength(1)

    act.setMode('demo')
    expect(store.get().mode).toBe('demo')
    expect(store.get().channels.some((c) => c.id === 'ch-enigmes')).toBe(true)
    vi.useRealTimers()
  })

  it('a failed answer puts the item back and shows the error', async () => {
    const driver = fakeDriver()
    driver.answer = async () => {
      throw new Error('moteur injoignable')
    }
    setLiveDriver(driver)
    const { storeActions } = await import('../../src/renderer/proto/store')
    const store = createProtoStore(initialState({ mode: 'live' }))
    store.set((s) => applySnapshot(s, snapshot()))
    storeActions(store).resolveInbox('orch-in-9')
    await Promise.resolve()
    await Promise.resolve()
    expect(store.get().inbox.map((i) => i.id)).toEqual(['orch-in-9'])
    expect(store.get().live.error).toBe('moteur injoignable')
  })
})
