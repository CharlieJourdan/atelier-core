import type { AppInfo, ChangeTopic, WindowTheme } from '../../shared/api'
import type { ProposalsStore } from '../agents/proposals'
import type { AgentRunner } from '../agents/runner'
import type { AgentsStore } from '../agents/store'
import type { ChatService } from '../chat'
import type { CreditsPort } from '../credits/port'
import type { ProductionRuns } from '../production/runs'
import type { AppCloud } from '../cloud'
import type { CloudKits } from '../cloud/kits'
import type { Db } from '../db'
import type { EyesService } from '../eyes/service'
import type { ExampleWorkspace } from '../example'
import type { AutomationsService } from '../ideas/automations'
import type { IdeasStore } from '../ideas/store'
import type { LlmAccess } from '../llm/access'
import type { Orchestra } from '../orchestra'
import type { DiscordService } from '../discord'
import type { BrainLink } from '../brain/link'
import type { Ledger } from '../ledger'
import type { AskInput, AskResult } from '../llm/ask'
import type { PricesStore } from '../llm/prices'
import type { ProductionPort } from '../production/port'
import type { RoutesStore } from '../llm/routes'
import type { ProviderTester } from '../llm/tester'
import type { SecretsStore } from '../secrets'
import type { SettingsStore } from '../settings'
import type { WorkflowEngine } from '../workflow/engine'
import type { UpdateService } from '../updater/service'
import type { GoogleService } from '../google'
import type { BrickStore } from '../bricks/store'
import type { ChannelVoices } from '../production/voices'
import type { ChannelPresenters } from '../production/presenters'
import type { ChannelSponsors } from '../production/sponsors'
import type { ChannelClips } from '../production/clips'
import type { PipelineAgentService } from '../production/pipeline-agent'
import type { StyleAgentService } from '../production/style-agent'
import type { CloneEngine } from '../production/clone/engine'
import type { PreviewStore } from '../production/previews'

/** Everything the api handlers need, injected so unit tests can build it without Electron. */
export interface ApiContext {
  db: Db
  settings: SettingsStore
  secrets: SecretsStore
  routes: RoutesStore
  prices: PricesStore
  workflow: WorkflowEngine
  ledger: Ledger
  chat: ChatService
  agents: AgentsStore
  runner: AgentRunner
  proposals: ProposalsStore
  /** Production runs behind the agents' tools (UnavailableProduction until lots P5–P7). */
  production: ProductionPort
  /** The channel voices (production-5): make, clone on engines, blind test. */
  channelVoices: ChannelVoices
  /** The channel presenters (production-7): portrait, clone, angles kept by the similarity check, registrations. */
  channelPresenters: ChannelPresenters
  /** The channel's sponsor (production-9). */
  channelSponsors: ChannelSponsors
  /** The channel's clip library and post-card avatar (clone-reddit-shorts). */
  channelClips: ChannelClips
  tester: ProviderTester
  appInfo: () => AppInfo
  /** Applies the theme to the native window (background, caption buttons); a no-op without a window. */
  setWindowTheme: (theme: WindowTheme) => void
  notify: (topic: ChangeTopic) => void
  /** The example workspace (lot Z1). */
  example: ExampleWorkspace
  /** Ideas and automations of the Production section (lot Z1). */
  ideas: IdeasStore
  automations: AutomationsService
  /** Our engine's runs inside the app (lot Z1). */
  productionRuns: ProductionRuns
  /** The credits wallet (local in lot Z1; Atelier Cloud's from lot P5, same interface). */
  credits: CreditsPort
  /** One-shot model call through the role's route and the ledger (lot Z1: Analyste, Builder, offers…). */
  ask: (input: AskInput) => Promise<AskResult>
  /** Atelier Cloud: session (device login, tokens), API client and the spend mirror (lot P5). */
  cloud: AppCloud
  /** The publication kits on the platform: sending a package, asking for a kit, saving its files. */
  cloudKits: CloudKits
  /** Opens an http(s) address in the person's browser (index.ts: shell.openExternal; a no-op in tests). */
  openExternal: (url: string) => void | Promise<void>
  /** The agent runtime: agent tree, task queue, supervisor loop, accounts (docs/AGENT-RUNTIME.md). */
  orchestra: Orchestra
  /** The beta rule on models (decision 0038): subscription gate, director backend. */
  access: LlmAccess
  /** Atlas on Discord: token, created channels, bridge (src/main/discord). */
  discord: DiscordService
  /** The link to the team computer's headless brain (src/main/brain); null in the headless host itself. */
  brain: BrainLink | null
  /** The eyes: competitors, outliers and the channel style profile (lot "eyes"). */
  eyes: EyesService
  /** The app updating itself from Atelier Cloud's update feed (src/main/updater). */
  updates: UpdateService
  /** The owner's YouTube channels read-only through Google: connection, cached figures (src/main/google). */
  google: GoogleService
  /** The channels' custom bricks (« Briques sur mesure »): their index and files. */
  bricks: BrickStore
  /** The agent that prepares and edits pipelines (production-12). */
  pipelineAgent: PipelineAgentService
  styleAgent: StyleAgentService
  /** « Créer une pipeline » on the cloning engine P0→P10 (moteur-assemblage). */
  clones: CloneEngine
  previews: PreviewStore
}
