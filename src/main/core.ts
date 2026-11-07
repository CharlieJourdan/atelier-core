// Builds the main-process services from injectable pieces. No Electron import here: unit tests use it with
// ':memory:' and a test cipher; index.ts passes safeStorage and the userData path.
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ApiHandlers, ChangeTopic, EventContract, WindowTheme } from '../shared/api'
import { BridgeServer } from './agents/bridge'
import { ProposalsStore } from './agents/proposals'
import { AgentRunner, type RunnerDeps } from './agents/runner'
import { AgentsStore } from './agents/store'
import { createApi, type ApiContext } from './api'
import { openDatabase, schemaVersion, type Db } from './db'
import { ChatService, ChatStore, HandoffStore } from './chat'
import { LocalWallet } from './credits'
import { ExampleWorkspace } from './example'
import { AutomationsService } from './ideas/automations'
import { IdeasStore } from './ideas/store'
import { createAppCloud, type AppCloud } from './cloud'
import { EyesService } from './eyes/service'
import { claudeLabeller } from './eyes/labeller'
import { WholeWatcher } from './eyes/whole'
import { WATCH_DEFAULT_MODEL, watchMaxCostUsd } from '../engine/sourcing/watch'
import { CloudKits } from './cloud/kits'
import { engineClaude } from './production/claude'
import { supportReader } from './production/support-reader'
import { createProductionHost, type ProductionHost } from './production/host'
import type { RemoteRenderer } from '../engine/remote-render/executor'
import { cloudRunsPort } from './production/cloud-runs'
import { Ledger } from './ledger'
import { ANTHROPIC_KEY_SECRET, createProviders, type Provider, PricesStore, RoutesStore, type ProviderSet, type ProviderSetDeps } from './llm'
import { LlmAccess } from './llm/access'
import { profileKeyName } from './team/claude'
import { SubscriptionProvider } from './orchestra/subscription'
import { askModel } from './llm/ask'
import { createProviderTester, type ProviderTester } from './llm/tester'
import { ProductionPending } from './production/pending'
import type { ProductionPort } from './production/port'
import { AppProduction } from './production/app-port'
import { ProjectStore, RecipeStore } from './production/recipes'
import { cachedUnitPrices, creditsBook, ENGINES_CACHE_KEY, livePrices } from './production/estimates/book'
import { llmTaskCreditsPerMinute } from '../engine/technologies/cost'
import { ProductionRuns, type ProductionRunsDeps } from './production/runs'
import { SecretsStore, type Cipher } from './secrets'
import { SettingsStore } from './settings'
import { ChannelsStore } from './workflow/channels'
import { WorkflowEngine } from './workflow/engine'
import { MAX_AUTO_REVISIONS, REVISIONS_HOLD } from './workflow/tasks'
import { AccountProviders, Orchestra, type ProviderFactory } from './orchestra'
import { ledgerProviderId } from './orchestra/accounts'
import { appServices } from './orchestra/app-services'
import { createPipelineAgent } from './production/pipeline-agent'
import { createStyleAgent } from './production/style-agent'
import { appCloneEngine, CLONE_JUDGE_ROLE } from './production/clone/app'
import { appOrderProduction } from './orchestra/orders/app'
import { appFinalPass } from './orchestra/orders/app-final'
import { isBlocking } from '../engine/review/blocking'
import { whisperPythonFinder } from './eyes/python'
import { spawnRun } from '../engine/sourcing/providers/ytdlp'
import { readRate } from './money/overview'
import { PreviewStore } from './production/previews'
import type { OrchestraServices } from './orchestra/services'
import type { TerminalLauncher } from './platform/terminal'
import { DiscordService, type FetchLike, type SocketFactory } from './discord'
import { BrainLink } from './brain/link'
import { CLOUD_ROUTES, MachinesResponse } from '../shared/cloud-api'
import type { FetchLike as BrainFetch } from '../shared/brain-client'
import { UpdateService, type UpdaterDriver } from './updater/service'
import { GoogleService, type GoogleFetch } from './google'
import { BrickStore } from './bricks/store'
import { ChannelVoices } from './production/voices'
import { ChannelPresenters, cloudPresenterPictures, fakePresenterPictures, portraitCleaner } from './production/presenters'
import { localFaceIdentity } from '../engine/presenter/face-id'
import { ChannelSponsors } from './production/sponsors'
import { ChannelClips } from './production/clips'
import { BrickStyleStore } from './production/styles'
import { systemMediaService } from '../engine/media/tools'
import { cloudHttpService } from '../engine/cloud-http'
import { motionTools } from './bricks/motion'

export interface AppPaths {
  /** Directory holding atelier.db (Electron: app.getPath('userData')). */
  userData: string
}

export interface CoreOptions {
  paths: AppPaths | { dbPath: ':memory:' }
  cipher: Cipher
  appName?: string
  appVersion?: string
  platform?: string
  notify?: (topic: ChangeTopic) => void
  /** Applies the renderer's theme to the native window (index.ts passes the real one; no-op in tests). */
  setWindowTheme?: (theme: WindowTheme) => void
  providerDeps?: Omit<ProviderSetDeps, 'secrets'>
  tester?: ProviderTester
  /** Receives the `atelier:stream` events of chat replies. */
  emitStream?: (payload: EventContract['atelier:stream']) => void
  /** Replaces the real providers for chat replies and agent runs (tests pass a FakeProvider; never a real API call). */
  chatProvider?: (providerId: string) => Provider
  /**
   * How Claude Code starts the Atelier MCP server (the app passes Electron's binary and out/main/mcp.js). When set,
   * the bridge (named pipe / Unix socket) is started and Claude Code agents get the Atelier tools.
   */
  agentMcp?: { command: string; args: string[]; bridgeId?: string }
  /** Delay before a failed task attempt is retried (tests pass 0). */
  retryDelayMs?: number
  /** Where dropped chat attachments are stored (default: next to the database, or the OS temp folder). */
  attachmentsDir?: string
  /** Clock for the ledger (month boundaries); tests inject one. */
  now?: () => Date
  /** Load the example workspace on first launch (empty database, never loaded or deleted before). The app and
   *  the headless brain pass true only with ATELIER_EXAMPLE=1 (`exampleAtStart`); unit tests leave it off. */
  loadExample?: boolean
  /** Opens an http(s) address in the browser (Atelier Cloud's device login); index.ts passes shell.openExternal. */
  openExternal?: (url: string) => void | Promise<void>
  /** Atelier Cloud test seams: the fetch used for the Cloud and the device-login poll interval. */
  cloudFetch?: typeof fetch
  /** The Atelier Cloud address used until the person sets one (index.ts: ATELIER_CLOUD_URL, else the build's default). */
  cloudUrl?: string
  cloudPollMs?: number
  /**
   * Publication kits on the platform (src/main/cloud/kits.ts): the Downloads folder (the app has one; the headless brain
   * does not), and the team computer's own link to the Cloud, read when a package is sent (headless: the stored credential).
   */
  kits?: { downloadsDir?: () => string | null; machine?: () => { baseUrl: string; credential: string } | null }
  /** Test seam of cloning a voice: how a recording is measured (default: the machine's ffprobe). */
  cloudVoiceDuration?: (file: string, signal: AbortSignal) => Promise<number | null>
  /**
   * Our production engine's host (lot P5): where Atelier's resources are and how to start the local worker. Given by
   * index.ts (out/main/worker.js run by Electron as Node); without it `core.productionHost` is null (unit tests).
   */
  productionHost?: { resourcesDir: string; worker: { command: string; args: string[]; env?: NodeJS.ProcessEnv }; remoteRender?: RemoteRenderer }
  /** Production runs for the agents' tools (tests pass the in-memory fake; the app has none until lot P7). */
  production?: ProductionPort
  /** Our engine's runs (lot Z1): data folder (default: userData, else a temp folder), resources folder, folder opener;
   *  tests also inject a registry, a pipeline factory and a light host. */
  productionRuns?: Partial<Omit<ProductionRunsDeps, 'db' | 'credits' | 'notify'>>
  /** Fire the due automations every minute (the app passes true unless ATELIER_AUTOMATIONS=off; tests leave it off and
   *  call `context.automations.tick()` themselves). */
  automations?: boolean
  /**
   * The agent runtime (src/main/orchestra): account providers (tests pass fakes; default: the chat provider when one is
   * injected, else the real CLIs per account), the agents' data folder, routines in UTC, the loop interval. The loop only
   * runs in the background while the setting `orchestra.enabled` is on.
   */
  orchestra?: {
    providers?: ProviderFactory
    dataDir?: string
    cronUtc?: boolean
    intervalMs?: number
    /** « Ajouter mon compte »: the login terminal (tests pass a fake that opens nothing). */
    terminal?: TerminalLauncher
    /** Replaces some of the services the agents' technologies reach (tests: a fake ffmpeg, a fake Cloud…). */
    services?: Partial<OrchestraServices>
  }
  /** Atlas on Discord (src/main/discord): tests and the e2e build pass an in-memory Discord's fetch (never the network). */
  discord?: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; intervalMs?: number; socket?: SocketFactory | null }
  /**
   * The link to a team computer's headless brain (src/main/brain, Réglages › Ordinateur d'équipe). Built by default and
   * inert until connected; the headless host passes `link: false` (it is the brain). Tests inject a fetch.
   */
  brain?: { link?: boolean; fetch?: BrainFetch; retryMs?: (attempt: number) => number }
  /**
   * The app updating itself from Atelier Cloud's update feed (src/main/updater). Without it (unit tests, the headless
   * brain) the app reports that it does not update itself. index.ts gives `createDriver` (electron-updater, loaded
   * lazily) only for a packaged app; tests give a fake updater.
   */
  updates?: { createDriver?: () => Promise<UpdaterDriver>; unsupported?: 'dev' | 'platform' | 'headless' | null; schedule?: (fn: () => void, ms: number) => () => void; now?: () => number; firstCheckDelayMs?: number }
  /**
   * The owner's YouTube channels through Google (src/main/google): tests pass a fake Google's fetch (never the network) and
   * an environment; the daily refresh runs only when `autoRefresh` is on (the app passes true).
   */
  google?: { fetch?: GoogleFetch; env?: Record<string, string | undefined>; autoRefresh?: boolean; now?: () => number; connectTimeoutMs?: number }
}

export interface Core {
  db: Db
  dbPath: string
  context: ApiContext
  ledger: Ledger
  chat: ChatService
  agents: AgentsStore
  runner: AgentRunner
  proposals: ProposalsStore
  production: ProductionPort
  /** Present when `agentMcp` was given; resolves once the bridge listens (rejects if it cannot). */
  bridgeReady: Promise<string> | null
  providers: ProviderSet
  /** Atelier Cloud (lot P5): session, API client and the spend mirror, for the production host. */
  cloud: AppCloud
  /** Publication kits on the platform. */
  cloudKits: CloudKits
  /** The engine's executors, services and credits for a run (lot P7 starts runs with it); null without `productionHost`. */
  productionHost: ProductionHost | null
  api: ApiHandlers
  /** The agent runtime (docs/AGENT-RUNTIME.md). */
  orchestra: Orchestra
  /** Atlas on Discord (off until a token, the created channels and the switch). */
  discord: DiscordService
  /** The link to the team computer's brain (index.ts routes calls through it once connected); null in the headless host. */
  brainLink: BrainLink | null
  /** The app updating itself (index.ts starts its schedule once the window is up). */
  updates: UpdateService
  close(): void
}

export const DB_FILE = 'atelier.db'

export function createCore(opts: CoreOptions): Core {
  const dbPath = 'dbPath' in opts.paths ? opts.paths.dbPath : path.join(opts.paths.userData, DB_FILE)
  const db = openDatabase(dbPath)
  const settings = new SettingsStore(db)
  const secrets = new SecretsStore(db, opts.cipher)
  const prices = new PricesStore(db)
  const notify = opts.notify ?? (() => undefined)
  // At startup nothing is in flight, so every reservation still open is a leftover of a crash or a quit mid-call:
  // it may have spent, so it is booked at its estimate (never refunded).
  const ledger = new Ledger(db, prices, settings, opts.now, () => notify('spend'))
  ledger.settleStale(0)
  const cloud = createAppCloud({
    db,
    secrets,
    settings,
    notify,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.cloudFetch ? { fetchImpl: opts.cloudFetch } : {}),
    ...(opts.cloudPollMs !== undefined ? { pollMs: opts.cloudPollMs } : {}),
    ...(opts.cloudUrl ? { defaultBaseUrl: opts.cloudUrl } : {}),
    eyes: 'userData' in opts.paths ? { stateDir: path.join(opts.paths.userData, 'cloud-eyes') } : {},
    voices: {
      ...('userData' in opts.paths ? { stateDir: path.join(opts.paths.userData, 'cloud-voices') } : {}),
      ...(opts.cloudVoiceDuration ? { duration: opts.cloudVoiceDuration } : {})
    }
  })
  // Cloud jobs left open by a crash are closed from the Cloud's own answer (in the background; failures leave them open).
  if (cloud.mirror.openJobs().length > 0) void cloud.mirror.reconcile(cloud.api).catch(() => undefined)
  // The published blueprint: fetched now when connected, then every 30 minutes.
  cloud.blueprint.start()
  const productionHost =
    opts.productionHost && 'userData' in opts.paths
      ? createProductionHost({
          dataDir: path.join(opts.paths.userData, 'production'),
          resourcesDir: opts.productionHost.resourcesDir,
          worker: opts.productionHost.worker,
          ...(opts.productionHost.remoteRender ? { remoteRender: opts.productionHost.remoteRender } : {}),
          cloud: { baseUrl: () => cloud.session.baseUrl(), token: () => cloud.session.token(), ...(opts.cloudFetch ? { fetchImpl: opts.cloudFetch } : {}) },
          onJob: (e, tags) => cloud.mirror.record(e, tags),
          // the nodes' Claude calls go to the team's backend, model per use (decision 0013); routes and providers are set below
          claude: { ask: (req) => engineClaude({ ledger, routes, settings, getProvider, access, apiProvider: () => rawProvider('anthropic') }).ask(req) },
          videos: supportReader(() => cloud.intel),
          committedFor: (videoId) => cloud.mirror.committedFor(videoId)
        })
      : null
  // the Anthropic key: the providers' secret, else the default API profile of Réglages › Claude (the director's « ma clé API »)
  const anthropicKeyName = (): string | null => {
    if (secrets.has(ANTHROPIC_KEY_SECRET)) return ANTHROPIC_KEY_SECRET
    const p = db.prepare(`SELECT id FROM claude_profiles WHERE kind = 'api' AND example = 0 ORDER BY is_default DESC, id LIMIT 1`).get() as { id: number } | undefined
    return p && secrets.has(profileKeyName(p.id)) ? profileKeyName(p.id) : null
  }
  const anthropicKey = (): string | null => {
    const name = anthropicKeyName()
    return name ? secrets.get(name) : null
  }
  const providers = createProviders({ secrets, anthropicKey, ...opts.providerDeps })
  const routes = new RoutesStore(db, settings)
  let orchestraRef: Orchestra | null = null
  const workflow = new WorkflowEngine(db, new ChannelsStore(db))
  const store = new ChatStore(db, notify)
  // The beta rule (decision 0038): every LLM feature but the director runs on a working subscription account of the
  // agents' pool (never the login nobody connected, never the API key); locked with a French message when none works.
  const rawProvider = opts.chatProvider ?? ((id: string) => providers[id as keyof ProviderSet])
  const subscription = new SubscriptionProvider({
    pool: () => orchestraRef?.parts.accounts ?? null,
    tierModels: () => routes.tierModels(),
    ...(opts.now ? { now: () => (opts.now as () => Date)().getTime() } : {})
  })
  const access = new LlmAccess({ pool: () => orchestraRef?.parts.accounts ?? null, settings, apiKeySet: () => anthropicKeyName() !== null })
  const getProvider = (id: string): Provider => access.gate(opts.chatProvider ? opts.chatProvider(id) : subscription)
  const agents = new AgentsStore(db, () => notify('agents'))
  agents.seed()
  let runner: AgentRunner | null = null
  // The team's production (agents-production): the same projects and runs as the app's (production-16), built below.
  let productionRunsRef: ProductionRuns | null = null
  let projectStoreRef: ProjectStore | null = null
  const production =
    opts.production ??
    new AppProduction({
      runs: () => productionRunsRef as ProductionRuns,
      projects: () => (projectStoreRef ??= new ProjectStore(db, new RecipeStore(db), productionRunsRef as ProductionRuns, opts.now)),
      ...(opts.now ? { now: () => (opts.now as () => Date)().getTime() } : {})
    })
  const proposals = new ProposalsStore(
    db,
    store,
    workflow,
    () => {
      notify('videos')
      runner?.kick()
    },
    production,
    opts.now ? () => (opts.now as () => Date)().getTime() : Date.now
  )
  const bridge = opts.agentMcp ? new BridgeServer(opts.agentMcp.bridgeId) : null
  const runnerDeps: RunnerDeps = {
    db,
    workflow,
    ledger,
    routes,
    agents,
    chat: store,
    proposals,
    settings,
    getProvider,
    notify,
    mcp: bridge && opts.agentMcp ? { server: bridge, command: opts.agentMcp.command, args: opts.agentMcp.args } : null,
    ...(opts.retryDelayMs !== undefined ? { retryDelayMs: opts.retryDelayMs } : {}),
    // No production engine yet (lots P2 to P7): the video producer's edit is held with a clear message.
    media: new ProductionPending(),
    production
  }
  runner = new AgentRunner(runnerDeps)
  runner.recoverInterrupted()
  const bridgeReady = bridge ? bridge.listen() : null
  // Without the bridge, Claude Code agents still run, without tools (their final text is the deliverable).
  bridgeReady?.catch(() => (runnerDeps.mcp = null))
  const handoffs = new HandoffStore(db)
  const chat = new ChatService({
    db,
    store,
    routes,
    ledger,
    agents,
    runner,
    workflow,
    getProvider,
    production,
    settings,
    notify,
    handoffs,
    emit: opts.emitStream ?? (() => undefined),
    attachmentsDir:
      opts.attachmentsDir ??
      ('userData' in opts.paths
        ? path.join(opts.paths.userData, 'attachments')
        : path.join(os.tmpdir(), `atelier-attachments-${process.pid}`))
  })
  // Cards in the video chat: a deliverable waiting for review, and the owner's decisions.
  workflow.listener = {
    waitingApproval: (d) => {
      store.announceApproval(d.id)
      notify('videos')
    },
    decided: (d, decision, by, note) => {
      runner?.kick()
      const label = d.type.replace(/_/g, ' ')
      const who = by === 'owner' ? 'You' : by
      store.announceDecision(
        d.id,
        decision === 'approved'
          ? `${who} approved ${label}.${note ? ` Note: ${note}` : ''}`
          : `${who} asked for changes on ${label}: ${note}`
      )
      const task = workflow.listTasks({ videoId: d.videoId }).find((t) => t.deliverableId === d.id)
      if (decision === 'revision_requested' && task?.holdReason === REVISIONS_HOLD) {
        store.post(store.open({ kind: 'video', videoId: d.videoId }).id, {
          authorType: 'system',
          body: `${label} was sent back ${MAX_AUTO_REVISIONS} times or more: the next rewrite waits for you. Press "Try again" when the notes are complete.`,
          card: { type: 'task', taskId: task.id, title: task.title, status: task.status, assignee: task.assignee }
        })
      }
    }
  }
  const ideas = new IdeasStore(db)
  const automations = new AutomationsService(db, ideas, opts.now)
  // Lot Z1: the credits wallet and our engine's runs; runs left running by a quit or a crash become `interrupted`.
  const credits = new LocalWallet(db, opts.now, () => notify('credits'))
  // The eyes: competitors, outliers and the style profile; a run reads the profile of its channel when it starts.
  const pipelineAgent = createPipelineAgent({ db, settings, prices, routes, ledger, cloud, getProvider, mcp: () => runnerDeps.mcp ?? null, notify, ...(opts.now ? { now: opts.now } : {}) })
  const eyes = new EyesService({
    db,
    intel: cloud.intel,
    notify: () => notify('channels'),
    // a new style profile: its summary goes into the channel memory the agents read
    onProfile: (channelId, profile, version) => orchestraRef?.profileBuilt(channelId, profile, version),
    ...(opts.now ? { now: opts.now } : {})
  })
  // « Watch a whole video » (chantier regarder-videos): only the real app (a data folder) reads videos; tests never start a program
  let wholeWatcher: WholeWatcher | null = null
  if ('userData' in opts.paths) {
    cloud.intel.setWatcher(
      (wholeWatcher = new WholeWatcher({
        cacheDir: path.join(opts.paths.userData, 'watch-cache'),
        labeller: () => claudeLabeller((input) => askModel({ ledger, routes, settings, getProvider }, input)),
        watchRange: () => cloud.intel.watchRange(),
        maxCost: (r) => watchMaxCostUsd(WATCH_DEFAULT_MODEL, r.endS - r.startS, { dense: true, ...(r.fps ? { fps: r.fps } : {}) }),
        ...(process.env.ATELIER_WHISPER_PYTHON ? { python: process.env.ATELIER_WHISPER_PYTHON } : { findPython: whisperPythonFinder(spawnRun) })
      }))
    )
  }
  let cloudKits: CloudKits | null = null
  const orchestraDir =
    opts.orchestra?.dataDir ??
    ('userData' in opts.paths ? path.join(opts.paths.userData, 'orchestra') : path.join(os.tmpdir(), `atelier-orchestra-${process.pid}`))
  // the channels' custom bricks: files of the workspace data folder, indexed in the database; a run gets the validated ones its channel uses
  const bricks = new BrickStore(db, path.join(orchestraDir, 'bricks'), opts.now ? () => (opts.now as () => Date)().getTime() : Date.now, () => notify('orchestra'))
  const motion = motionTools(opts.productionHost?.resourcesDir ?? opts.productionRuns?.resourcesDir ?? path.join(process.cwd(), 'resources'))
  // the channel voices (production-5): samples and blind tests under userData/voices; Cloud jobs through the app's voices service
  const channelVoices = new ChannelVoices({
    db,
    dir: 'userData' in opts.paths ? path.join(opts.paths.userData, 'voices') : path.join(os.tmpdir(), `atelier-voices-${process.pid}`),
    maker: cloud.voices,
    media: systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }),
    ...(opts.now ? { now: opts.now } : {}),
    notify: () => notify('production')
  })
  // the channel presenters (production-7): portraits and angles under userData/presenters, made on the Cloud's image engine while
  // signed in (style-japanese), stand-in drawings otherwise
  const presenterMedia = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
  const presenterDir = 'userData' in opts.paths ? path.join(opts.paths.userData, 'presenters') : path.join(os.tmpdir(), `atelier-presenters-${process.pid}`)
  const presenterStyles = new BrickStyleStore(db)
  const presenterCloud = () => (cloud.session.connected() ? cloudHttpService({ baseUrl: cloud.session.baseUrl(), token: () => cloud.session.token(), ...(opts.cloudFetch ? { fetchImpl: opts.cloudFetch } : {}) }) : null)
  const channelPresenters = new ChannelPresenters({
    db,
    dir: presenterDir,
    pictures: cloudPresenterPictures({ dir: path.join(presenterDir, 'made'), media: presenterMedia, cloud: presenterCloud, fallback: fakePresenterPictures(path.join(presenterDir, 'drawn'), presenterMedia) }),
    // « nettoyer le portrait » (production-17): GPT Image on the Cloud while signed in, a sharpened stand-in otherwise
    cleaner: portraitCleaner({ dir: path.join(presenterDir, 'clean'), media: presenterMedia, cloud: presenterCloud }),
    media: presenterMedia,
    // the angles' identity check: OpenCV face recognition when this computer has it (director text check), else the skin check
    identity: localFaceIdentity({ platform: process.platform, cacheDir: path.join(path.dirname(presenterDir), 'models', 'face') }),
    styleSuffix: () => presenterStyles.resolve('presenter-studio').doc.promptSuffix ?? null,
    ...(opts.now ? { now: opts.now } : {}),
    notify: () => notify('production')
  })
  // the channel's sponsor (production-9): the runs of the channel take it as the pipeline's `sponsor` input
  const channelSponsors = new ChannelSponsors({ db, ...(opts.now ? { now: opts.now } : {}), notify: () => notify('production') })
  // the channel's clip library and post-card avatar (clone-reddit-shorts): a background pipeline's run takes them as its inputs
  const channelClips = new ChannelClips({
    db,
    dir: 'userData' in opts.paths ? path.join(opts.paths.userData, 'channel-media') : path.join(os.tmpdir(), `atelier-channel-media-${process.pid}`),
    media: presenterMedia,
    // the library is the owner's explicit, one-off request: asked for real (a demo answer is never a clip)
    cloud: () => (cloud.session.connected() ? cloudHttpService({ baseUrl: cloud.session.baseUrl(), token: () => cloud.session.token(), realRun: true, ...(opts.cloudFetch ? { fetchImpl: opts.cloudFetch } : {}) }) : null),
    notify: () => notify('production')
  })
  const productionRuns = new ProductionRuns({
    styleProfileFor: (channelId) => eyes.profileFor(channelId),
    channelVoiceFor: (channelId) => channelVoices.styleFor(channelId),
    channelPresenterFor: (channelId) => channelPresenters.styleFor(channelId),
    channelScriptStyleFor: (channelId) => {
      const c = workflow.channels.find(channelId)
      return c ? [c.standards && `Standards: ${c.standards}`, c.scriptStyle && `Script style: ${c.scriptStyle}`].filter(Boolean).join('\n').slice(0, 3000) : ''
    },
    channelSponsorFor: (channelId) => channelSponsors.textFor(channelId),
    channelInputFor: (channelId, input) => channelClips.inputFor(channelId, input),
    // « Moteur réel » (production-16): runs the owner turns real go through the Cloud; the HeyGen look they return is kept
    ...(productionHost ? { cloudRuns: cloudRunsPort({ host: productionHost, session: cloud.session, api: cloud.api }) } : {}),
    presenterRegistrations: (channelId, regs) => void channelPresenters.registrationsFromRun(channelId, regs),
    // the Cloud's engine prices kept by the estimates (production-11): one source for the pipeline estimate and the run quote
    unitPrices: () => cachedUnitPrices(settings.get(ENGINES_CACHE_KEY)),
    livePrices: () => livePrices(async () => (cloud.session.connected() ? (await cloud.api.engines()).engines : null)),
    // the director's (and the script's) line: 0 on « mon abonnement », their tokens on « crédits Atelier » (decision 0026)
    llmQuote: () => ({
      backend: routes.defaultProvider() === 'claude-code' ? 'subscription' : 'api-key',
      // the beta rule (decision 0038): the script on the subscription, the director where the user put it
      ...(access.directorBackend() === 'api' ? { directorBackend: 'api-key' as const } : {}),
      perMinute: llmTaskCreditsPerMinute(creditsBook([], prices.list()).llm)
    }),
    bricksFor: (channelId) => bricks.approvedFor(channelId),
    inspirationFor: (channelId, o) => eyes.inspirationFor(channelId, { includeDemo: o.demo, lang: 'en' }),
    dataDir: 'userData' in opts.paths ? opts.paths.userData : path.join(os.tmpdir(), `atelier-data-${process.pid}`),
    resourcesDir: path.join(process.cwd(), 'resources'),
    ...opts.productionRuns,
    db,
    credits,
    notify,
    onPackage: (e) => cloudKits?.onPackage(e),
    // a run ended: the team hears of it (the planner, the inbox, Atlas), after a test's own listener
    onFinished: (e) => {
      opts.productionRuns?.onFinished?.(e)
      orchestraRef?.runFinished(e)
    }
  })
  productionRunsRef = productionRuns
  // production-15: the saved previews per technology (the shipped set, then the app's own) and « créer une pipeline »
  const shippedResources = opts.productionHost?.resourcesDir ?? opts.productionRuns?.resourcesDir ?? path.join(process.cwd(), 'resources')
  // launched from out/main (e2e), the app path has no resources: the checkout's own set then (pipeline-ui: the options' before / after too)
  const resources = existsSync(path.join(shippedResources, 'previews')) ? shippedResources : path.join(process.cwd(), 'resources')
  const previews = new PreviewStore([
    path.join(resources, 'previews'),
    path.join(resources, 'option-previews'),
    path.join('userData' in opts.paths ? opts.paths.userData : path.join(os.tmpdir(), `atelier-data-${process.pid}`), 'previews')
  ])
  // production-15: « reproduire un style » — the eyes on the owner's links, the closest pipelines, priced samples as normal runs
  const styleAgent = createStyleAgent({
    db,
    settings,
    prices,
    routes,
    ledger,
    cloud,
    getProvider,
    pipelineAgent,
    runs: () => productionRuns,
    unitPrices: () => cachedUnitPrices(settings.get(ENGINES_CACHE_KEY)),
    notify,
    // the real app (it has a data folder) reads the references' public pages; tests never start yt-dlp
    readPages: 'userData' in opts.paths,
    ...(opts.now ? { now: opts.now } : {})
  })
  // moteur-assemblage: « Créer une pipeline » on the cloning engine P0→P10 (decision 0095); clones live in userData/clones
  const clones = appCloneEngine({
    db,
    dataDir: 'userData' in opts.paths ? opts.paths.userData : path.join(os.tmpdir(), `atelier-data-${process.pid}`),
    run: spawnRun,
    watcher: wholeWatcher,
    ask: (input) => askModel({ ledger, routes, settings, getProvider }, input),
    onSubscription: (role) => routes.resolve(role).providerId === 'claude-code',
    api: () => apiRef as ApiHandlers,
    recipes: pipelineAgent.recipes,
    runs: () => productionRuns,
    presenters: channelPresenters,
    voices: channelVoices,
    channels: workflow.channels,
    usdPerCredit: () => 0.01 / Math.max(0.5, readRate(settings)),
    walletCredits: async () => (cloud.session.connected() ? (await cloud.api.wallet()).available : null),
    notify,
    ...(opts.now ? { now: opts.now } : {}),
    // a clone working when the app stopped goes on (the real app only; tests never start one)
    resumeOnStart: 'userData' in opts.paths && productionHost !== null
  })
  cloudKits = new CloudKits({
    session: cloud.session,
    api: cloud.api,
    settings,
    ...(opts.kits?.machine ? { machine: opts.kits.machine } : {}),
    ...(opts.kits?.downloadsDir ? { downloadsDir: opts.kits.downloadsDir } : {}),
    ...(opts.productionRuns?.opener ? { opener: opts.productionRuns.opener } : {}),
    ...(opts.cloudFetch ? { fetchImpl: opts.cloudFetch } : {}),
    packageOf: (runId) => productionRuns.packageOf(runId)
  })
  productionRuns.markInterrupted()
  // An automation's firing starts our engine on the video it just created.
  automations.starter = async (input) => {
    const run = await productionRuns.start({
      videoId: input.videoId,
      topic: input.topic,
      minutes: input.minutes,
      budgetMode: input.budgetMode,
      gateMode: input.gateMode
    })
    return { runId: run.id }
  }
  let ticking = false
  const automationsTimer = opts.automations
    ? setInterval(() => {
        if (ticking) return
        ticking = true
        automations
          .tick()
          .catch((err: unknown) => console.error('Atelier automations:', err))
          .finally(() => {
            ticking = false
          })
      }, 60_000)
    : null
  automationsTimer?.unref()
  // equipe-3-chaines: Charlie's video orders — made from his scripts, checked (render's blocking checks + edit review, blind judge), fixed once, told
  const orderUsdPerCredit = (): number => 0.01 / Math.max(0.5, readRate(settings))
  const orderServices = {
    production: appOrderProduction({ db, recipes: pipelineAgent.recipes, projects: () => new ProjectStore(db, pipelineAgent.recipes, productionRuns, opts.now), runs: () => productionRuns, usdPerCredit: orderUsdPerCredit, ...(opts.now ? { now: opts.now } : {}) }),
    finalPass: appFinalPass({
      db,
      dataDir: orchestraDir,
      run: spawnRun,
      runs: () => productionRuns,
      settings,
      // the render's own blocking kinds (decision 0102)
      isBlocking,
      ask: async (o) => {
        const r = await askModel({ ledger, routes, settings, getProvider }, { role: CLONE_JUDGE_ROLE, tier: 'balanced', system: 'You compare two video excerpts you have never seen. Answer exactly in the format asked.', prompt: o.prompt, ...(o.images.length ? { images: o.images } : {}), maxTokens: 12000, estimate: { inputTokens: 9000, outputTokens: 2500, cacheReadTokens: 0, cacheWriteTokens: 0 } })
        return { text: r.text, costUsd: r.costUsd, model: r.model }
      }
    }),
    usdPerCredit: orderUsdPerCredit
  }
  // The agent runtime: its accounts run the user's own CLIs (one config folder per subscription), the API key, the relay.
  const accountProviders = new AccountProviders({ defaultClaudeCode: providers['claude-code'], anthropic: providers.anthropic })
  const chatProvider = opts.chatProvider
  const orchestra = new Orchestra({
    db,
    ledger,
    settings,
    routes,
    chat: store,
    handoffs,
    providerFactory:
      opts.orchestra?.providers ?? (chatProvider ? (a) => chatProvider(ledgerProviderId(a.kind)) : accountProviders.factory),
    dataDir: orchestraDir,
    ...(opts.now ? { now: () => (opts.now as () => Date)().getTime() } : {}),
    ...(opts.orchestra?.cronUtc ? { cronUtc: true } : {}),
    blueprint: () => cloud.blueprint.forSeed(),
    notify,
    services: { ...appServices({ db, api: () => apiRef, eyes, runs: productionRuns, cloud }), bricks, motion, pipelines: pipelineAgent, styles: styleAgent, orders: orderServices, ...opts.orchestra?.services },
    mcp: () => runnerDeps.mcp ?? null,
    production,
    ...(opts.orchestra?.terminal ? { terminal: opts.orchestra.terminal } : {})
  })
  orchestraRef = orchestra
  let apiRef: ApiHandlers | null = null
  orchestra.start(opts.orchestra?.intervalMs)
  const example = new ExampleWorkspace(db, settings)
  if (opts.loadExample) example.loadOnFirstLaunch()
  // Atlas on Discord: pull-based bridge over the REST API, only running when switched on (see src/main/discord).
  const discord = new DiscordService({
    ctx: { orchestra, workflow, productionRuns, credits, ledger, agents, example, chat, notify },
    settings,
    secrets,
    notify: () => notify('discord'),
    ...(opts.discord?.fetch ? { fetch: opts.discord.fetch } : {}),
    ...(opts.discord?.sleep ? { sleep: opts.discord.sleep } : {}),
    ...(opts.discord?.intervalMs !== undefined ? { intervalMs: opts.discord.intervalMs } : {}),
    ...(opts.discord?.socket !== undefined ? { socket: opts.discord.socket } : {}),
    ...(opts.now ? { now: () => (opts.now as () => Date)().getTime() } : {})
  })
  const afterPosted = store.onPosted
  store.onPosted = (conversationId, message) => {
    afterPosted?.(conversationId, message)
    discord.kick()
  }
  discord.start()
  const brainLink =
    opts.brain?.link === false
      ? null
      : new BrainLink({
          settings,
          secrets,
          notify,
          emitStream: opts.emitStream ?? (() => undefined),
          // « Se connecter via Atelier Cloud »: the app's own Cloud session is the credential of the relay.
          cloud: {
            connected: () => cloud.session.connected(),
            baseUrl: () => cloud.session.baseUrl(),
            token: () => cloud.session.token(),
            expireAccess: () => cloud.session.expireAccess(),
            machines: async () =>
              (await cloud.session.caller().raw('GET', CLOUD_ROUTES.teamMachines.path, MachinesResponse, AbortSignal.timeout(10_000))).machines.map((m) => ({
                id: m.id,
                status: m.status,
                online: m.online,
                demo: m.demo
              }))
          },
          ...(opts.brain?.fetch ? { fetchImpl: opts.brain.fetch } : {}),
          ...(opts.brain?.retryMs ? { retryMs: opts.brain.retryMs } : {})
        })
  const updates = new UpdateService({
    settings,
    currentVersion: opts.appVersion ?? '0.0.0',
    cloudUrl: () => cloud.session.baseUrl(),
    unsupported: opts.updates?.createDriver ? (opts.updates.unsupported ?? null) : (opts.updates?.unsupported ?? 'headless'),
    createDriver: opts.updates?.createDriver ?? (() => Promise.reject(new Error('no updater'))),
    osPlatform: opts.platform ?? process.platform,
    notify: () => notify('update'),
    ...(opts.updates?.schedule ? { schedule: opts.updates.schedule } : {}),
    ...(opts.updates?.now ? { now: opts.updates.now } : {}),
    ...(opts.updates?.firstCheckDelayMs !== undefined ? { firstCheckDelayMs: opts.updates.firstCheckDelayMs } : {})
  })
  const google = new GoogleService({
    db,
    settings,
    secrets,
    channels: () => workflow.channels.list().map((c) => ({ id: c.id, name: c.name, youtubeChannelId: c.youtubeChannelId })),
    notify: () => notify('google'),
    openExternal: opts.openExternal ?? (() => undefined),
    ...(opts.google?.fetch ? { fetch: opts.google.fetch } : {}),
    ...(opts.google?.env ? { env: opts.google.env } : {}),
    ...(opts.google?.now ? { now: opts.google.now } : opts.now ? { now: () => (opts.now as () => Date)().getTime() } : {}),
    ...(opts.google?.connectTimeoutMs !== undefined ? { connectTimeoutMs: opts.google.connectTimeoutMs } : {})
  })
  if (opts.google?.autoRefresh) google.start()
  const context: ApiContext = {
    db,
    settings,
    secrets,
    routes,
    prices,
    workflow,
    ledger,
    chat,
    agents,
    runner,
    proposals,
    production,
    channelVoices,
    channelPresenters,
    channelSponsors,
    channelClips,
    tester: opts.tester ?? createProviderTester(providers),
    notify,
    example,
    ideas,
    automations,
    productionRuns,
    credits,
    ask: (input) => askModel({ ledger, routes, settings, getProvider }, input),
    cloud,
    cloudKits,
    openExternal: opts.openExternal ?? (() => undefined),
    updates,
    orchestra,
    access,
    discord,
    brain: brainLink,
    eyes,
    google,
    bricks,
    pipelineAgent,
    styleAgent,
    clones,
    previews,
    setWindowTheme: opts.setWindowTheme ?? (() => undefined),
    appInfo: () => ({
      name: opts.appName ?? 'Atelier',
      version: opts.appVersion ?? '0.0.0',
      platform: opts.platform ?? process.platform,
      dbPath,
      schemaVersion: schemaVersion(db)
    })
  }
  const api = createApi(context)
  apiRef = api
  return {
    db,
    dbPath,
    context,
    ledger,
    chat,
    agents,
    runner,
    proposals,
    production,
    bridgeReady,
    providers,
    cloud,
    cloudKits,
    productionHost,
    api,
    orchestra,
    discord,
    brainLink,
    updates,
    // Quit: stop the loops, kill the Claude CLI children synchronously (taskkill /T /F returns once the tree is
    // gone), then close the database. A call still settling afterwards finds the ledger closed and books nothing;
    // its reservation is settled at its estimate at the next start.
    close: () => {
      if (automationsTimer) clearInterval(automationsTimer)
      productionRuns.close()
      runner?.close()
      cloud.blueprint.close()
      cloud.session.close()
      productionHost?.killAll()
      chat.close()
      discord.close()
      brainLink?.close()
      orchestra.close()
      updates.close()
      google.close()
      void motion.close()
      accountProviders.killAll()
      providers['claude-code'].killAll()
      ledger.close()
      void bridge?.close()
      db.close()
    }
  }
}
