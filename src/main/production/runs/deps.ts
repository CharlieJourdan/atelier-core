// Dependencies injected into ProductionRuns (the app's core, tests inject light ones).
import type { Clock, RetryPolicy } from '../../../engine/errors'
import type { NodeHost } from '../../../engine/host'
import type { Run } from '../../../engine/scheduler'
import type { NodeRegistry } from '../../../engine/registry'
import type { ChangeTopic } from '../../../shared/api'
import type { StyleProfile } from '../../../shared/style-profile'
import type { Brick } from '../../../engine/formats/brick'
import type { PresenterRef } from '../../../engine/presenter/talk'
import type { CreditsPort } from '../../credits/port'
import type { UnitPrices } from '../../credits/prices'
import type { Db } from '../../db'
import type { CloudRunsPort } from './cloud'
import type { RunMoney } from './money'
import type { LlmQuote } from './quote'
import type { PipelineFactory } from './pipeline'
import type { RunFinished } from './video-status'
import type { Pipeline } from '../../../engine/pipeline-schema'

export interface ProductionRunsDeps {
  db: Db
  credits: CreditsPort
  notify: (topic: ChangeTopic) => void
  /** The app's data folder (Electron userData); production files live in `<dataDir>/production`. */
  dataDir: string
  /** Atelier's `resources/` folder (fonts, music, skills, fake media). */
  resourcesDir: string
  registry?: NodeRegistry
  pipeline?: PipelineFactory
  defaultStyle?: Record<string, unknown>
  /** The style profile of a channel (lot "eyes"); a run for a channel that has one starts from it. Absent or null: as before. */
  styleProfileFor?: (channelId: number) => StyleProfile | null
  /** The outliers of the channel's watched competitors, as inspiration for the research node. `demo`: the run is a demo run. */
  inspirationFor?: (channelId: number, o: { demo: boolean }) => { title: string; why: string; channel: string }[]
  /** The channel's validated custom bricks it uses in its films (src/main/bricks): `motion.render` draws them, the director places them. */
  bricksFor?: (channelId: number) => Brick[]
  /** The channel's voice (production-5): its default voice's id per engine; a run of the channel speaks with it. */
  channelVoiceFor?: (channelId: number) => { voice: string; voices: Record<string, string> } | null
  /** The channel's presenter (production-7): its default presenter's pictures and registrations; a run of the channel uses it as `$style.presenter`. */
  channelPresenterFor?: (channelId: number) => PresenterRef | null
  /** The channel's own words about its scripts (standards + script style), for the script writers (issue #107); '' when it has none. */
  channelScriptStyleFor?: (channelId: number) => string
  /** The channel's sponsor asset (production-9): a run of the channel whose pipeline reads `sponsor` and was given none takes it. */
  channelSponsorFor?: (channelId: number) => string | null
  /** The channel's own assets a background pipeline reads (clone-reddit-shorts): its clip folder (`gameplay`), its avatar, its name. */
  channelInputFor?: (channelId: number, input: string) => string | null
  /** Credits per unit from Atelier Cloud's engines, the same book the pipeline estimate reads (production-11); null: the placeholder grid. */
  unitPrices?: () => UnitPrices | null
  /** The Cloud's engine prices read now, for a quote asked before any estimate kept them (QA B4: it was priced on the placeholder grid, 2.4 times the estimate). Nothing is kept. */
  livePrices?: () => Promise<UnitPrices | null>
  /** The team's LLM backend and the credits per minute of each LLM task (decision 0026); absent: LLM nodes cost 0. */
  llmQuote?: () => LlmQuote | null
  /** The default mode of a run the owner did not turn real: demo providers (true, the default) or lot Z1's local wallet (false, tests). */
  demo?: boolean
  /** Atelier Cloud for the runs the owner turns real (« Moteur réel », production-16); absent: every run is a demo. */
  cloudRuns?: CloudRunsPort
  /** A real run's talking-presenter nodes returned registrations (engine → id, the HeyGen look): kept on the channel's presenter. */
  presenterRegistrations?: (channelId: number, registrations: Record<string, unknown>) => void
  /** Builds the engine's host services (default `nodeHost`; tests inject a light one). */
  host?: (o: { dataDir: string; resourcesDir: string }) => NodeHost
  /** Opens a folder in Finder / Explorer; resolves '' on success or an error text (Electron's `shell.openPath`). */
  opener?: (dir: string) => Promise<string>
  clock?: Clock
  now?: () => Date
  retry?: Partial<RetryPolicy>
  /** Minimum time between two 'production' notifications while runs progress (default 250 ms, ~4/s). */
  notifyEveryMs?: number
  /** A run ended with its upload package built (the app sends it to Atelier Cloud as the video's kit). Never throws into the run. */
  onPackage?: (e: { runId: number; videoId: number; packageDir: string; title: string; durationS: number | null }) => void
  /** A run ended (succeeded, failed or cancelled), its video's status set: the team hears of it (planner, inbox, Atlas). */
  onFinished?: (e: RunFinished) => void
  /** After a crash or quit, resume each interrupted run by itself (the brain on the team computer; solidite, runs/recovery.ts). */
  autoResume?: boolean
  /** Tests only: runs a project's compiled document on light test nodes (the app never sets it). */
  adaptDocument?: (doc: Pipeline) => Pipeline
  platform?: NodeJS.Platform
  /** PATH searched for ffmpeg (default: the process's, which index.ts takes from the login shell on macOS). */
  pathEnv?: string
}

/** A run being executed by the engine in this process. */
export interface Live {
  engine: Run
  host: NodeHost
  money: RunMoney | null
  finished: Promise<void>
  resolveFinished: () => void
  /** Why the whole run was stopped at once (a dead Claude sign-in, production-17): it fails with this message. */
  stop?: string
}
