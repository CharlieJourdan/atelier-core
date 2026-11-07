// Real mode, production side: the engine's pipelines rebuilt from run / quote nodes, the database's videos with their
// newest run and their slot (deadline), the per-node states of the overview sheet, and the store's planning and launch
// actions going through a (fake) live driver.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuoteNode, RunDetail, RunSummary } from '../../src/shared/runs'
import type { VideoRow } from '../../src/shared/workflow'
import { deadlineOf, isEnginePipeline, mapVideos, nodeKindOf, pipelineFromNodes, quoteNodes, runNodes, slotOf, toDrawing } from '../../src/renderer/proto/live/mapping-production'
import { PIPELINES } from '../../src/renderer/proto/data-pipelines'
import { setLiveDriver, type LiveDriver, type LiveRunInput, type LiveSnapshot } from '../../src/renderer/proto/live/registry'
import { applySnapshot, createProtoStore, initialState, storeActions } from '../../src/renderer/proto/store'
import { renderDeadlines } from '../../src/renderer/screens/planning/planning-model'

const NOW = new Date(2026, 9, 24, 15, 0) // local time

const NODES = [
  { nodeId: 'research', position: 0, type: 'research.topic@1', label: 'Recherche', gateKind: 'none', quoteCredits: 0, state: 'done', progress: 1 },
  { nodeId: 'script', position: 1, type: 'script.write@1', label: 'Script', gateKind: 'review', quoteCredits: 0, state: 'waiting_gate', progress: 1 },
  { nodeId: 'voice', position: 2, type: 'voice.tts@1', label: 'Voix', gateKind: 'none', quoteCredits: 140, state: 'pending', progress: 0 },
  { nodeId: 'render', position: 3, type: 'render.assemble@1', label: 'Rendu', gateKind: 'none', quoteCredits: 0, state: 'pending', progress: 0 }
]

function run(p: Partial<RunSummary> & Pick<RunSummary, 'id' | 'videoId' | 'status'>): RunSummary {
  return {
    videoTitle: 'Les Templiers',
    channelId: 7,
    channelName: 'Histoire',
    pipelineId: 'simple-narrated',
    pipelineLabel: 'Vidéo simple narrée',
    pipelineVersion: 1,
    topic: 'Templiers',
    minutes: 8,
    progress: 0.3,
    waitingNodes: [],
    current: null,
    error: null,
    quoteCredits: 300,
    spentCredits: 20,
    durationS: null,
    demo: true,
    ...p
  } as RunSummary
}

const DETAIL = { ...run({ id: 2, videoId: 5, status: 'waiting', waitingNodes: ['script'] }), nodes: NODES } as unknown as RunDetail

describe('real mode: production mapping', () => {
  it('engine node types read as kinds and runners', () => {
    expect(nodeKindOf('research.topic@1')).toEqual({ kind: 'idea', runner: 'agent' })
    expect(nodeKindOf('script.write@1')).toEqual({ kind: 'script', runner: 'agent' })
    expect(nodeKindOf('visuals.fulfil@1')).toEqual({ kind: 'image-gen', runner: 'api' })
    expect(nodeKindOf('voice.own@1')).toEqual({ kind: 'voice', runner: 'human' })
    expect(nodeKindOf('render.assemble@1')).toEqual({ kind: 'edit', runner: 'code' })
    expect(nodeKindOf('package.youtube@1')).toEqual({ kind: 'thumbnail', runner: 'agent' })
  })

  it('a pipeline is rebuilt from a run (one column per node, its gates) or from a quote (credits, duration, where)', () => {
    const p = pipelineFromNodes({ pipelineId: 'simple-narrated', label: 'Vidéo simple narrée', version: 1 }, runNodes(DETAIL), ['db-7'])
    expect(p).toMatchObject({ id: 'live-simple-narrated', name: 'Vidéo simple narrée', channelIds: ['db-7'], creditsPerVideo: 140, preset: false })
    expect(p.nodes.map((n) => [n.id, n.kind, n.col, n.gate ?? false])).toEqual([
      ['research', 'idea', 0, false],
      ['script', 'script', 1, true],
      ['voice', 'voice', 2, false],
      ['render', 'edit', 3, false]
    ])
    expect(p.edges).toEqual([
      ['research', 'script'],
      ['script', 'voice'],
      ['voice', 'render']
    ])
    const q = [{ nodeId: 'voice', type: 'voice.tts@1', label: 'Voix', where: 'cloud', credits: 143, durationS: 75, cached: false, gate: 'none' }] as QuoteNode[]
    const fromQuote = pipelineFromNodes({ pipelineId: 'x', label: 'X', version: 2 }, quoteNodes(q), [])
    expect(fromQuote.nodes[0]).toMatchObject({ provider: 'Atelier Cloud', credits: 143, minutes: 1 })
    expect(fromQuote.minutesPerVideo).toBe(1)
  })

  it('slots: a deadline is a day offset and a time; a chosen slot is a deadline (round trip)', () => {
    const iso = deadlineOf(3, '19:30', NOW)
    expect(slotOf(iso, NOW)).toEqual({ days: 3, time: '19:30' })
    expect(slotOf(new Date(2026, 9, 23, 0, 0).toISOString(), NOW)).toEqual({ days: -1, time: '18:00' })
    expect(slotOf('not a date', NOW)).toBeNull()
  })

  it('videos: one per database video, the newest run for stage / status / node states, the deadline for the slot', () => {
    const rows = [
      { id: 5, channelId: 7, goalId: null, title: 'Les Templiers', brief: 'b', status: 'in_progress', deadline: deadlineOf(2, '18:00', NOW), createdAt: '', updatedAt: '' },
      { id: 6, channelId: 7, goalId: null, title: 'Une idée', brief: '', status: 'idea', deadline: null, createdAt: '', updatedAt: '' },
      { id: 8, channelId: 7, goalId: null, title: 'Annulée', brief: '', status: 'cancelled', deadline: null, createdAt: '', updatedAt: '' },
      { id: 9, channelId: 7, goalId: null, title: 'Finie', brief: '', status: 'ready', deadline: deadlineOf(4, '12:00', NOW), createdAt: '', updatedAt: '' }
    ] as VideoRow[]
    const runs = [
      run({ id: 2, videoId: 5, status: 'waiting', waitingNodes: ['script'] }),
      run({ id: 1, videoId: 5, status: 'failed', error: 'vieux' }),
      run({ id: 4, videoId: 9, status: 'succeeded', progress: 1, durationS: 512 })
    ]
    const v = mapVideos(rows, runs, new Map([[2, DETAIL]]), NOW)
    expect(v.map((x) => x.id)).toEqual(['vid-5', 'vid-6', 'vid-9'])
    expect(v[0]).toMatchObject({ channelId: 'db-7', pipelineId: 'live-simple-narrated', stage: 'script', status: 'waiting', progress: 30, publishInDays: 2, publishTime: '18:00', dueInDays: 1, waitingFor: { kind: 'validate' } })
    expect(v[0]!.liveRun).toMatchObject({ runId: 2, demo: true })
    expect(v[0]!.liveRun!.nodes.map((n) => n.state)).toEqual(['done', 'waiting_gate', 'pending', 'pending'])
    expect(v[1]).toMatchObject({ stage: 'idea', status: 'queued', publishInDays: null, pipelineId: '', noRenderDeadline: true })
    // no slot, no render marker in the planning
    expect(renderDeadlines(v, 'all').flatMap((d) => d.videos.map((x) => x.id))).toEqual(['vid-5', 'vid-9'])
    expect(v[2]).toMatchObject({ stage: 'scheduled', status: 'done', progress: 100, durationSec: 512 })
  })
})

/* ---------- store actions ---------- */

function snap(): LiveSnapshot {
  const p = pipelineFromNodes({ pipelineId: 'simple-narrated', label: 'V', version: 1 }, runNodes(DETAIL), ['db-7'])
  return {
    status: { enabled: false, running: 0, maxConcurrent: 3, tasks: {}, agents: 0, accountsReady: 1, accountsLimited: 0, resumesAt: null, openInbox: 0 },
    channels: [{ id: 'db-7', name: 'Histoire', handle: '', color: 1, initials: 'H', niche: '', language: 'fr', format: 'long', connected: false, subscribers: 0, views28d: 0, revenue28d: 0, trend: 0, cadence: '', automation: { idea: 'auto', script: 'auto', production: 'auto', packaging: 'auto', publishing: 'auto' }, pipelineIds: [], products: [], createdDaysAgo: 0 }],
    agents: [],
    videos: mapVideos([{ id: 5, channelId: 7, goalId: null, title: 'T', brief: '', status: 'idea', deadline: null, createdAt: '', updatedAt: '' }] as VideoRow[], [], new Map(), new Date()),
    pipelines: [p],
    inbox: [],
    accounts: [],
    threads: [],
    messages: []
  }
}

function driver(): LiveDriver & { scheduled: [number, string | null][]; started: LiveRunInput[] } {
  const scheduled: [number, string | null][] = []
  const started: LiveRunInput[] = []
  const noop = async () => undefined
  return {
    scheduled,
    started,
    load: async () => snap(),
    answer: noop,
    say: noop,
    createAgent: noop,
    updateAgent: noop,
    memory: async () => [],
    deleteMemory: noop,
    routines: async () => [],
    toggleRoutine: noop,
    tasks: async () => [],
    inboxItem: async () => undefined,
    status: async () => snap().status,
    tick: noop,
    schedule: async (id, deadline) => {
      scheduled.push([id, deadline])
    },
    startRun: async (input) => {
      started.push(input)
      return { libraryId: input.drawing ? 42 : null, notes: [] }
    }
  }
}

describe('real mode: the drawings of the editor', () => {
  it('a drawing is the steps of the pipeline in reading order; engine pipelines are not drawings', () => {
    const docu = PIPELINES.find((p) => p.id === 'pl-docu')!
    const d = toDrawing(docu)
    expect(d.name).toBe('Documentaire narré')
    expect(d.steps[0]).toMatchObject({ id: 'n-idea', kind: 'idea', gate: true })
    expect(d.steps.find((x) => x.id === 'n-stock')).toMatchObject({ kind: 'stock', runner: 'api', share: 45 })
    expect(isEnginePipeline('live-simple-video')).toBe(true)
    expect(isEnginePipeline('pl-docu')).toBe(false)
  })
  // production-2: « Nouvelle vidéo »'s engine notes and the overview sheet's node states left with those screens (decision 0008)
})

/** A drawing as the editor makes it in real mode (the demo's own drawings are not in real mode since the beta). */
function drawn(store: ReturnType<typeof createProtoStore>, id: 'pl-docu' | 'pl-reddit'): string {
  const { id: _demo, ...rest } = PIPELINES.find((p) => p.id === id)!
  return storeActions(store).addPipeline({ ...rest, channelIds: [] })
}

describe('real mode: planning and launch actions', () => {
  afterEach(() => setLiveDriver(null))

  it('the engine pipelines come first in the library; the drawings of the editor stay; no pre-made template', () => {
    // production-2 (decision 0008): real mode starts with no pipeline at all (it had Atelier's templates before)
    expect(initialState({ mode: 'live' }).pipelines).toEqual([])
    const store = createProtoStore(initialState({ mode: 'live' }))
    const mine = drawn(store, 'pl-docu')
    const s = applySnapshot(store.get(), snap())
    expect(s.pipelines[0]!.id).toBe('live-simple-narrated')
    expect(s.pipelines.slice(1).every((p) => !isEnginePipeline(p.id))).toBe(true)
    expect(s.pipelines.some((p) => p.preset)).toBe(false)
    expect(s.pipelines.some((p) => p.id === mine)).toBe(true)
    expect(s.pipelines.some((p) => p.id === 'pl-docu')).toBe(false)
  })

  it('scheduling a real video writes its deadline; launching starts a real run (with its slot); a launch without a channel is refused', async () => {
    const d = driver()
    setLiveDriver(d)
    const store = createProtoStore(initialState({ mode: 'live' }))
    store.set((s) => applySnapshot(s, snap()))
    const act = storeActions(store)

    act.updateVideo('vid-5', { publishInDays: 2, publishTime: '19:00' })
    expect(store.get().videos[0]).toMatchObject({ publishInDays: 2, publishTime: '19:00' })
    await vi.waitFor(() => expect(d.scheduled).toHaveLength(1))
    expect(d.scheduled[0]![0]).toBe(5)
    expect(slotOf(d.scheduled[0]![1]!, new Date())).toEqual({ days: 2, time: '19:00' })

    act.updateVideo('vid-5', { title: 'Nouveau titre' }) // not a slot: nothing sent
    act.addVideo({ channelId: 'db-7', title: 'Voynich', brief: 'Le manuscrit', format: 'long', pipelineId: 'live-simple-narrated', stage: 'idea', progress: 3, status: 'running', dueInDays: 0, publishInDays: 4, publishTime: '18:00', durationSec: 600, creditsSpent: 0, creditsEstimate: 0, agentId: '', thumbHue: 1 })
    await vi.waitFor(() => expect(d.started).toHaveLength(1))
    expect(d.started[0]).toMatchObject({ channelId: 7, title: 'Voynich', topic: 'Le manuscrit', minutes: 10, gateMode: 'step' })
    expect(slotOf(d.started[0]!.deadline!, new Date())).toEqual({ days: 4, time: '18:00' })
    expect(d.scheduled).toHaveLength(1)

    act.addVideo({ channelId: null, title: 'Sans chaîne', brief: '', format: 'long', pipelineId: '', stage: 'idea', progress: 0, status: 'running', dueInDays: 0, publishInDays: null, publishTime: '18:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 0, agentId: '', thumbHue: 1 })
    expect(d.started).toHaveLength(1)
    expect(store.get().live.error).toMatch(/chaîne/)
  })

  it('launching with a drawing sends it, remembers the library pipeline it became and reuses it next time; drawings survive snapshots', async () => {
    const d = driver()
    setLiveDriver(d)
    const store = createProtoStore(initialState({ mode: 'live' }))
    const mine = drawn(store, 'pl-docu')
    store.set((s) => applySnapshot(s, snap()))
    expect(store.get().pipelines.some((p) => p.id === mine)).toBe(true) // the editor's drawings stay
    const act = storeActions(store)
    const video = { channelId: 'db-7', title: 'Voynich', brief: 'b', format: 'long' as const, pipelineId: mine, stage: 'idea' as const, progress: 3, status: 'running' as const, dueInDays: 0, publishInDays: null, publishTime: '18:00', durationSec: 600, creditsSpent: 0, creditsEstimate: 0, agentId: '', thumbHue: 1 }
    act.addVideo(video)
    await vi.waitFor(() => expect(store.get().pipelines.find((p) => p.id === mine)?.libraryId).toBe(42))
    expect(d.started[0]!.drawing?.name).toBe('Documentaire narré')
    expect(d.started[0]!.libraryId).toBeUndefined()
    act.addVideo(video)
    await vi.waitFor(() => expect(d.started).toHaveLength(2))
    expect(d.started[1]!.libraryId).toBe(42)
    store.set((s) => applySnapshot(s, snap()))
    expect(store.get().pipelines.find((p) => p.id === mine)?.libraryId).toBe(42)
    // the engine's own pipeline runs without a drawing
    act.addVideo({ ...video, pipelineId: 'live-simple-narrated' })
    await vi.waitFor(() => expect(d.started).toHaveLength(3))
    expect(d.started[2]!.drawing).toBeUndefined()
  })

  it('launching with a person’s script and a clips folder: the inputs go to the engine, the drawing’s script becomes the person’s', async () => {
    const d = driver()
    setLiveDriver(d)
    const store = createProtoStore(initialState({ mode: 'live' }))
    const mine = drawn(store, 'pl-reddit')
    store.set((s) => applySnapshot(s, snap()))
    const act = storeActions(store)
    const video = { channelId: 'db-7', title: 'AITA', brief: 'b', format: 'short' as const, pipelineId: mine, stage: 'idea' as const, progress: 0, status: 'running' as const, dueInDays: 0, publishInDays: null, publishTime: '18:00', durationSec: 60, creditsSpent: 0, creditsEstimate: 0, agentId: '', thumbHue: 1 }
    act.addVideo(video, { inputs: { script: 'Mon histoire.', gameplay: 'C:/clips' } })
    await vi.waitFor(() => expect(d.started).toHaveLength(1))
    expect(d.started[0]!.inputs).toEqual({ script: 'Mon histoire.', gameplay: 'C:/clips' })
    expect(d.started[0]!.drawing!.steps.filter((st) => st.kind === 'script').every((st) => st.runner === 'human')).toBe(true)
    // without a script the drawing is sent as drawn
    act.addVideo(video)
    await vi.waitFor(() => expect(d.started).toHaveLength(2))
    expect(d.started[1]!.inputs).toBeUndefined()
    expect(d.started[1]!.drawing!.steps.find((st) => st.kind === 'script')!.runner).not.toBe('human')
  })
})
