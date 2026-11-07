// The proto store: one small external store (useSyncExternalStore) holding the demo workspace, so every new screen
// reads and changes the same data (approve an item on the dashboard → it leaves the inbox everywhere). A few user
// choices (main agent's name, onboarding done, channel shown) are remembered in localStorage. No IPC: the store also
// runs in a plain browser (web demo) and in unit renders.
//
// Real mode (desktop app only): the same state is filled from the main process — the agent runtime, the chat, the
// channels, the production runs — by `live/LiveSync.tsx`, and the actions below go through the registered live driver
// (`live/registry.ts`) instead of answering with demo text.
//
// The beta: in the desktop app real mode is the default and starts EMPTY (no demo channel, video or agent shows before the
// first snapshot); the demo workspace is only the « Mode présentation » of Réglages › Avancé (a main-process setting,
// `app.presentation`, mirrored here so the first render already knows). The web demo and unit renders keep the demo.
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Idea } from './data-brain'
import { CHANNELS, ENGINE_ACCOUNTS, TEAM_COMPUTER, WORKSPACE } from './data-core'
import { PIPELINES } from './data-pipelines'
import { AGENTS, DEFAULT_PRINCIPAL_NAME, INBOX, MESSAGES, PRINCIPAL_ID, THREADS } from './data-team'
import { VIDEOS } from './data-videos'
import { brainMoneyActions } from './live/actions-brain-money'
import type { LiveMoney } from './live/mapping-money'
import type { LiveVoices } from './live/mapping-voices'
import { withBlueprintPipelines } from './live/mapping-blueprint'
import { deadlineOf, isEnginePipeline, toDrawing } from './live/mapping-production'
import { isDesktopApp } from './live/desktop'
import { liveDriver, type LiveRunInput, type LiveRunResult, type LiveSnapshot } from './live/registry'
import type { OrchStatus } from '../../shared/api/orchestra'
import type { BlueprintStatus } from '../../shared/blueprint'
import type {
  ChannelId,
  EngineAccount,
  InboxAnswer,
  InboxItem,
  ProtoAgent,
  ProtoChannel,
  ProtoMessage,
  ProtoPipeline,
  ProtoThread,
  ProtoVideo,
  TeamComputer,
  Workspace
} from './types'

export type Scope = 'all' | ChannelId

/** Demo: invented workspace. Live: what the agent runtime and the app's database really hold. */
export type DataMode = 'demo' | 'live'

export interface LiveInfo {
  status: OrchStatus | null
  loading: boolean
  error: string | null
  /** Last time a snapshot was applied (ms). */
  syncedAt: number | null
}

export interface ProtoState {
  channels: ProtoChannel[]
  videos: ProtoVideo[]
  pipelines: ProtoPipeline[]
  agents: ProtoAgent[]
  threads: ProtoThread[]
  messages: ProtoMessage[]
  inbox: InboxItem[]
  accounts: EngineAccount[]
  computer: TeamComputer
  workspace: Workspace
  principalName: string
  scope: Scope
  onboarded: boolean
  agentPanelOpen: boolean
  /** Ids of messages the main agent is still "typing". */
  typing: string[]
  mode: DataMode
  live: LiveInfo
  /** Real mode: the ideas board of the database (Cerveau); null until the first snapshot has it. */
  liveIdeas: Idea[] | null
  /** Real mode: the measured money facts (Monétisation); null until the first snapshot has them. */
  liveMoney: LiveMoney | null
  /** Real mode: the Cloud's voices (Briques, Nouvelle video); null until the first snapshot has them. */
  liveVoices: LiveVoices | null
  /** Real mode: the published blueprint (« version publiée N ») the Cloud serves; null until the first snapshot has it. */
  liveBlueprint: BlueprintStatus | null
}

const PREFS_KEY = 'atelier.proto.prefs'

interface Prefs {
  principalName?: string
  scope?: Scope
  onboarded?: boolean
  /** Last known value of the « Mode présentation » setting (main holds the truth). The old `mode` pref is ignored. */
  presentation?: boolean
}

function readPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as Prefs) : {}
  } catch {
    return {}
  }
}

function writePrefs(state: ProtoState): void {
  try {
    const prefs: Prefs = { principalName: state.principalName, scope: state.scope, onboarded: state.onboarded, presentation: state.mode === 'demo' }
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode: not remembered */
  }
}

/** The demo workspace (also what switching back to demo restores). */
function demoData(principalName: string): Pick<ProtoState, 'channels' | 'videos' | 'pipelines' | 'agents' | 'threads' | 'messages' | 'inbox' | 'accounts'> {
  return {
    channels: CHANNELS,
    videos: VIDEOS,
    pipelines: PIPELINES,
    agents: AGENTS.map((a) => (a.id === PRINCIPAL_ID ? { ...a, name: principalName } : a)),
    threads: THREADS.map((t) => (t.id === 'th-principal' ? { ...t, title: principalName } : t)),
    messages: MESSAGES,
    inbox: INBOX,
    accounts: ENGINE_ACCOUNTS
  }
}

export const EMPTY_LIVE: LiveInfo = { status: null, loading: false, error: null, syncedAt: null }

/** Real mode before the Cloud account is known (or without one): nothing invented, the account block says « hors ligne ». */
export const OFFLINE_WORKSPACE: Workspace = { name: '', plan: '', credits: 0, creditsMonthly: 0, autoTopUp: false, seats: 1, members: [], cloud: 'offline' }

/** The real workspace before its first snapshot: only the main agent (the runtime seeds it) and Atelier's own templates. */
export function emptyLiveData(
  principalName: string
): Pick<ProtoState, 'channels' | 'videos' | 'pipelines' | 'agents' | 'threads' | 'messages' | 'inbox' | 'accounts' | 'workspace'> {
  const p = AGENTS.find((a) => a.id === PRINCIPAL_ID)
  return {
    channels: [],
    videos: [],
    // production-2 (decision 0008): no pre-made pipeline in real mode; recipes live in Production, from the database
    pipelines: [],
    agents: p ? [{ ...p, name: principalName, status: 'idle', load: 0, memoryItems: 0, tasksDone7d: 0, task: undefined }] : [],
    threads: THREADS.filter((th) => th.id === 'th-principal').map((th) => ({ ...th, title: principalName, unread: 0 })),
    messages: [],
    inbox: [],
    accounts: [],
    workspace: OFFLINE_WORKSPACE
  }
}

/** The data mode of a new store: real in the desktop app unless the presentation mode was on; demo elsewhere. */
function startMode(prefs: Prefs): DataMode {
  return isDesktopApp() && prefs.presentation !== true ? 'live' : 'demo'
}

export function initialState(overrides: Partial<ProtoState> = {}): ProtoState {
  const prefs = readPrefs()
  const principalName = prefs.principalName ?? DEFAULT_PRINCIPAL_NAME
  const mode = overrides.mode ?? startMode(prefs)
  const data = mode === 'live' ? emptyLiveData(principalName) : { ...demoData(principalName), workspace: WORKSPACE }
  return {
    ...data,
    computer: TEAM_COMPUTER,
    principalName,
    scope: prefs.scope && (prefs.scope === 'all' || data.channels.some((c) => c.id === prefs.scope)) ? prefs.scope : 'all',
    // Only the onboarding replayed by hand: the first run itself is the database's `app.onboarded` (screens/welcome/gate.ts).
    onboarded: prefs.onboarded ?? true,
    agentPanelOpen: false,
    typing: [],
    mode,
    live: EMPTY_LIVE,
    liveIdeas: null,
    liveMoney: null,
    liveVoices: null,
    liveBlueprint: null,
    ...overrides
  }
}

type Listener = () => void

export interface ProtoStore {
  get: () => ProtoState
  set: (fn: (s: ProtoState) => ProtoState) => void
  subscribe: (l: Listener) => () => void
}

export function createProtoStore(state: ProtoState = initialState()): ProtoStore {
  let current = state
  const listeners = new Set<Listener>()
  return {
    get: () => current,
    set: (fn) => {
      current = fn(current)
      writePrefs(current)
      for (const l of listeners) l()
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }
  }
}

const StoreContext = createContext<ProtoStore | null>(null)

export function ProtoProvider({ children, store }: { children: ReactNode; store?: ProtoStore }) {
  // Created once (lazy state initialiser): reading a ref during render is refused by react-hooks/refs.
  const [value] = useState<ProtoStore>(() => store ?? createProtoStore())
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

/** A fallback store for components rendered outside a provider (unit renders of a single screen). */
let fallback: ProtoStore | null = null
function useStore(): ProtoStore {
  const ctx = useContext(StoreContext)
  if (ctx) return ctx
  fallback ??= createProtoStore(initialState())
  return fallback
}

/** The whole proto state (re-renders on every change; the data set is small). */
export function useProto(): ProtoState {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** Canned answers of the main agent in the demo (a real agent replaces this when the engine is wired). */
export function demoReply(text: string, name: string): string {
  const q = text.toLowerCase()
  if (/(valid|attend|inbox)/.test(q)) return 'Trois choses t’attendent : le script de « Col Dyatlov », la miniature d’« Atlantide » et des clips de gameplay pour Histoires Vraies. Je t’ouvre la première ?'
  if (/(vue|stat|perf|chiffre)/.test(q)) return 'Sur 28 jours : 12,9 M de vues (+18 %), 9 680 € de revenus estimés. Histoires Vraies porte les vues, Les Grandes Énigmes porte les revenus.'
  if (/(sujet|idée|idee)/.test(q)) return 'Léa a 5 sujets prêts pour Les Grandes Énigmes, dont un format « 3 énigmes en 20 min » qui monte chez les concurrents. Je les mets dans ton Accueil.'
  if (/(planning|semaine|calendrier|programme)/.test(q)) return 'Cette semaine : 7 vidéos longues et 21 shorts programmés. Le seul trou est jeudi sur Top Savoirs, faute de script.'
  if (/(vidéo|video|lance|crée|cree)/.test(q)) return 'Dis-moi la chaîne et le sujet, je prends le pipeline habituel et je te donne le devis avant de lancer.'
  return `C’est noté. Je m’en occupe avec l’équipe et je reviens vers toi ici. — ${name}`
}

/** The actions on a store (also usable outside React: tests, the live sync). */
export function storeActions(store: ProtoStore) {
  return {
    setScope: (scope: Scope) => store.set((s) => ({ ...s, scope })),
    setOnboarded: (onboarded: boolean) => store.set((s) => ({ ...s, onboarded })),
    setAgentPanel: (open: boolean) => store.set((s) => ({ ...s, agentPanelOpen: open })),
    toggleAgentPanel: () => store.set((s) => ({ ...s, agentPanelOpen: !s.agentPanelOpen })),
    setPrincipalName: (name: string) =>
      store.set((s) => ({
        ...s,
        principalName: name,
        agents: s.agents.map((a) => (a.id === PRINCIPAL_ID ? { ...a, name } : a)),
        threads: s.threads.map((t) => (t.id === 'th-principal' ? { ...t, title: name } : t))
      })),
    resolveInbox: (id: string, answer: InboxAnswer = {}) => {
      const before = store.get()
      const item = before.inbox.find((i) => i.id === id)
      const driver = liveDriver()
      if (before.mode === 'live' && item?.live && driver) {
        store.set((s) => ({ ...s, inbox: s.inbox.filter((i) => i.id !== id) }))
        driver.answer(item, answer).catch((err: unknown) =>
          store.set((s) => ({ ...s, inbox: s.inbox.some((i) => i.id === id) ? s.inbox : [item, ...s.inbox], live: { ...s.live, error: errorText(err) } }))
        )
        return
      }
      store.set((s) => {
        const item = s.inbox.find((i) => i.id === id)
        return {
          ...s,
          inbox: s.inbox.filter((i) => i.id !== id),
          videos: item?.videoId
            ? s.videos.map((v) => {
                if (v.id !== item.videoId) return v
                const { waitingFor: _done, ...rest } = v
                return { ...rest, status: 'running' as const, progress: Math.min(100, v.progress + 8) }
              })
            : s.videos
        }
      })
    },
    addVideo: (video: Omit<ProtoVideo, 'id'>, extra: { inputs?: Record<string, string>; style?: LiveRunInput['style'] } = {}) => {
      const id = nextId('v')
      const driver = liveDriver()
      const s0 = store.get()
      if (s0.mode === 'live' && driver) {
        // Real mode: a real run on a real channel (the engine needs one); the video appears with the next snapshot.
        const channel = video.channelId?.startsWith('db-') ? Number(video.channelId.slice(3)) : NaN
        if (!Number.isInteger(channel)) {
          store.set((s) => ({ ...s, live: { ...s.live, error: 'Choisis une chaîne : le moteur de production fabrique une vidéo pour une chaîne.' } }))
          return id
        }
        const pipeline = s0.pipelines.find((x) => x.id === video.pipelineId)
        // a drawing of the editor runs once compiled into a library pipeline; an engine pipeline runs as it is
        const drawn = pipeline && !isEnginePipeline(pipeline.id) ? pipeline : undefined
        // a script given by the person: the drawing's script step is theirs, so the engine waits for it
        const drawing = drawn ? toDrawing(drawn) : undefined
        if (drawing && extra.inputs?.script) drawing.steps = drawing.steps.map((st) => (st.kind === 'script' ? { ...st, runner: 'human' } : st))
        const done = driver
          .startRun({
            ...(drawing && drawn ? { drawing, ...(drawn.libraryId !== undefined ? { libraryId: drawn.libraryId } : {}) } : {}),
            ...(extra.inputs && Object.keys(extra.inputs).length > 0 ? { inputs: extra.inputs } : {}),
            ...(extra.style && Object.keys(extra.style).length > 0 ? { style: extra.style } : {}),
            channelId: channel,
            title: video.title,
            topic: video.brief || video.title,
            minutes: video.durationSec > 0 ? video.durationSec / 60 : 8,
            gateMode: pipeline?.nodes.some((n) => n.gate) === false ? 'all' : 'step',
            deadline: video.publishInDays === null ? null : deadlineOf(video.publishInDays, video.publishTime, new Date())
          })
          .then((res) => {
            const libraryId = res.libraryId
            if (drawn && libraryId !== null) store.set((s) => ({ ...s, pipelines: s.pipelines.map((x) => (x.id === drawn.id ? { ...x, libraryId } : x)) }))
            return res
          })
        lastLaunch = done
        done.catch((err: unknown) => store.set((s) => ({ ...s, live: { ...s.live, error: errorText(err) } })))
        return id
      }
      store.set((s) => ({ ...s, videos: [{ ...video, id }, ...s.videos] }))
      return id
    },
    updateVideo: (id: string, patch: Partial<ProtoVideo>) => {
      const before = store.get().videos.find((v) => v.id === id)
      store.set((s) => ({ ...s, videos: s.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)) }))
      const driver = liveDriver()
      // Real mode: a new slot (planning drag and drop) is the video's deadline in the database.
      if (store.get().mode === 'live' && driver && before && id.startsWith('vid-') && ('publishInDays' in patch || 'publishTime' in patch)) {
        const days = patch.publishInDays !== undefined ? patch.publishInDays : before.publishInDays
        const time = patch.publishTime ?? before.publishTime
        driver
          .schedule(Number(id.slice(4)), days === null ? null : deadlineOf(days, time, new Date()))
          .catch((err: unknown) =>
            store.set((s) => ({ ...s, videos: s.videos.map((v) => (v.id === id ? before : v)), live: { ...s.live, error: errorText(err) } }))
          )
      }
    },
    addChannel: (channel: Omit<ProtoChannel, 'id'>) => {
      const id = nextId('ch')
      store.set((s) => ({ ...s, channels: [...s.channels, { ...channel, id }] }))
      return id
    },
    updateChannel: (id: ChannelId, patch: Partial<ProtoChannel>) =>
      store.set((s) => ({ ...s, channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    addPipeline: (pipeline: Omit<ProtoPipeline, 'id'>) => {
      const id = nextId('pl')
      store.set((s) => ({ ...s, pipelines: [...s.pipelines, { ...pipeline, id }] }))
      return id
    },
    updatePipeline: (id: string, patch: Partial<ProtoPipeline>) =>
      store.set((s) => ({ ...s, pipelines: s.pipelines.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    addAgent: (agent: Omit<ProtoAgent, 'id'>, instructions?: string) => {
      const id = nextId('ag')
      const driver = liveDriver()
      if (store.get().mode === 'live' && driver) {
        driver.createAgent(store.get(), agent, instructions).catch((err: unknown) => store.set((s) => ({ ...s, live: { ...s.live, error: errorText(err) } })))
        return id
      }
      store.set((s) => ({ ...s, agents: [...s.agents, { ...agent, id }] }))
      return id
    },
    /** Posts the user's message; in a thread with an agent, a demo answer follows after a short "typing" pause. */
    send: (threadId: string, text: string, replyAs?: string) => {
      const driver = liveDriver()
      const s0 = store.get()
      if (s0.mode === 'live' && driver) {
        const mine: ProtoMessage = { id: nextId('m'), threadId, authorId: 'user', text, minutesAgo: 0 }
        // « typing » until the agent's answer arrives in a snapshot (or for two minutes at most)
        const typingId = `live-${threadId}-${s0.messages.filter((m) => m.threadId === threadId && m.authorId !== 'user').length}`
        store.set((s) => ({ ...s, messages: [...s.messages, mine], typing: [...s.typing, typingId] }))
        setTimeout(() => store.set((s) => ({ ...s, typing: s.typing.filter((x) => x !== typingId) })), 120_000)
        driver.say(store.get(), threadId, text).catch((err: unknown) =>
          store.set((s) => ({ ...s, typing: s.typing.filter((x) => x !== typingId), live: { ...s.live, error: errorText(err) } }))
        )
        return
      }
      const mine: ProtoMessage = { id: nextId('m'), threadId, authorId: 'user', text, minutesAgo: 0 }
      store.set((s) => ({ ...s, messages: [...s.messages, mine], threads: s.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)) }))
      const thread = store.get().threads.find((t) => t.id === threadId)
      const author = replyAs ?? thread?.agentId ?? thread?.participantIds.find((p) => p !== 'user')
      if (!author) return
      const typingId = nextId('typing')
      store.set((s) => ({ ...s, typing: [...s.typing, typingId] }))
      setTimeout(() => {
        const s0 = store.get()
        const reply: ProtoMessage = { id: nextId('m'), threadId, authorId: author, text: demoReply(text, s0.principalName), minutesAgo: 0 }
        store.set((s) => ({ ...s, typing: s.typing.filter((x) => x !== typingId), messages: [...s.messages, reply] }))
      }, 1100)
    },
    setMode: (mode: DataMode) =>
      store.set((s): ProtoState => {
        if (mode === s.mode) return s
        const reset = { typing: [], liveIdeas: null, liveMoney: null, liveVoices: null, liveBlueprint: null, scope: 'all' as const }
        return mode === 'demo'
          ? { ...s, ...demoData(s.principalName), workspace: WORKSPACE, mode, ...reset, live: EMPTY_LIVE }
          : // real mode starts empty: nothing of the demo stays on screen until the first snapshot
            { ...s, ...emptyLiveData(s.principalName), mode, ...reset, live: { ...EMPTY_LIVE, loading: true } }
      }),
    /** Real mode: the Cloud account (names, plan, credits) or the offline workspace. */
    setWorkspace: (workspace: Workspace) => store.set((s) => (s.mode === 'live' ? { ...s, workspace } : s)),
    setLive: (patch: Partial<LiveInfo>) => store.set((s) => ({ ...s, live: { ...s.live, ...patch } })),
    applyLive: (snap: LiveSnapshot) => store.set((s) => applySnapshot(s, snap)),
    markRead: (threadId: string) =>
      store.set((s) => ({ ...s, threads: s.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)) })),
    // Cerveau (ideas) and Monétisation (revenues, subscription prices) in real mode
    ...brainMoneyActions(store)
  }
}

export function useProtoActions() {
  const store = useStore()
  return useMemo(() => storeActions(store), [store])
}

/** The last real launch (Nouvelle vidéo awaits it to tell what the engine left out of the drawing). */
let lastLaunch: Promise<LiveRunResult> | null = null
export function lastLiveLaunch(): Promise<LiveRunResult> | null {
  return lastLaunch
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Replaces the workspace with a live snapshot. Messages the user just typed stay until the snapshot holds them; a
 * « typing » mark goes away as soon as the thread has more agent messages than when it was set.
 */
export function applySnapshot(s: ProtoState, snap: LiveSnapshot): ProtoState {
  if (s.mode !== 'live') return s
  const pending = s.messages.filter(
    (m) => m.authorId === 'user' && m.id.startsWith('m-') && !snap.messages.some((x) => x.threadId === m.threadId && x.authorId === 'user' && x.text === m.text)
  )
  const typing = s.typing.filter((id) => {
    const m = /^live-(.+)-(\d+)$/.exec(id)
    if (!m) return false
    const answered = snap.messages.filter((x) => x.threadId === m[1] && x.authorId !== 'user').length
    return answered <= Number(m[2])
  })
  const principalAgent = snap.agents.find((a) => a.role === 'principal')
  const blueprint = snap.blueprint ?? s.liveBlueprint
  return {
    ...s,
    channels: snap.channels,
    videos: snap.videos,
    // the engine's pipelines, then the editor's drawings and Atelier's templates (a drawing runs once launched)
    // plus the published blueprint's pipelines among Atelier's templates
    pipelines: [...snap.pipelines, ...withBlueprintPipelines(s.pipelines.filter((x) => !isEnginePipeline(x.id)), blueprint)],
    agents: snap.agents,
    threads: snap.threads,
    messages: [...snap.messages, ...pending],
    inbox: snap.inbox,
    accounts: snap.accounts,
    principalName: principalAgent?.name ?? s.principalName,
    scope: s.scope === 'all' || snap.channels.some((c) => c.id === s.scope) ? s.scope : 'all',
    typing,
    liveIdeas: snap.ideas ?? s.liveIdeas,
    liveMoney: snap.money ?? s.liveMoney,
    liveVoices: snap.voices ?? s.liveVoices,
    liveBlueprint: blueprint,
    live: { status: snap.status, loading: false, error: null, syncedAt: Date.now() }
  }
}

/* ---------- selectors ---------- */

export function inScope<T extends { channelId: ChannelId | null }>(items: T[], scope: Scope): T[] {
  return scope === 'all' ? items : items.filter((i) => i.channelId === scope)
}

export function channelOf(state: Pick<ProtoState, 'channels'>, id: ChannelId | null): ProtoChannel | undefined {
  return id ? state.channels.find((c) => c.id === id) : undefined
}

export function channelColorVar(channel: Pick<ProtoChannel, 'color'> | undefined): string {
  return channel ? `var(--ch-${channel.color})` : 'var(--fg-4)'
}

export function principal(state: Pick<ProtoState, 'agents'>): ProtoAgent {
  const p = state.agents.find((a) => a.id === PRINCIPAL_ID) ?? state.agents.find((a) => a.role === 'principal')
  if (!p) throw new Error('the main agent is missing')
  return p
}

export { PRINCIPAL_ID }
