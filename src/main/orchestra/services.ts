// What the agents' technologies need from the rest of the app. core.ts builds it from the real services (the channels
// IPC handlers — the very service the screens use —, the eyes, our engine's runs, ffmpeg, Atelier Cloud) through
// app-services.ts; tests pass fakes or the same real services on an in-memory core. Every member is optional: a
// technology whose service is missing answers « not available here » instead of failing the turn.
import type { BrowserService, MediaService } from '../../engine/services'
import type { BrickStore } from '../bricks/store'
import type { Workbench } from '../production/pipeline-agent/tools'
import type { StyleAgentService } from '../production/style-agent'
import type { OutlierRow } from '../../shared/api/eyes'
import type { RunDetail, RunOutput, RunQuote, RunQuoteInput, RunStartInput, RunSummary } from '../../shared/runs'
import type { ProjectDetail, ProjectSummary } from '../../shared/recipes'
import type { StyleProfile } from '../../shared/style-profile'
import type { WholeVideoLog } from '../../shared/shot-log'
import type { AnalysisResult } from '../../shared/video-analysis'
import type { ChannelInput, ChannelRow } from '../../shared/workflow'
import type { RunMedia, YoutubeFacts } from './eyes-look'
import type { FinalPass, OrderProduction } from './orders'

export interface OrchestraServices {
  channels?: {
    /** The same path as the app's « Nouvelle chaîne » (`channels.create`): the channel, then its team and memory. */
    create(input: ChannelInput): ChannelRow
    list(): ChannelRow[]
  }
  eyes?: {
    profileFor(channelId: number): StyleProfile | null
    profileVersion(channelId: number): number | null
    outliers(channelId: number): OutlierRow[]
    inspirationFor(channelId: number, limit: number): { title: string; why: string; channel: string }[]
    read(channelId: number, signal: AbortSignal): Promise<{ channelsRead: number; videos: number; outliers: number; demo: boolean; problems: string[] }>
    youtubeFacts(videoId: string): YoutubeFacts | null
  }
  production?: {
    quote(input: RunQuoteInput): Promise<RunQuote>
    start(input: RunStartInput): Promise<RunDetail>
    get(runId: number): RunDetail
    list(filter: { channelId?: number; limit?: number }): RunSummary[]
    approve(runId: number, nodeId: string): RunDetail
    cancel(runId: number): Promise<RunDetail>
    /** The final video file and the voice's word timings of a run. */
    media(runId: number): Promise<RunMedia>
    /** What a finished node produced (the QC node's report: sound checks included, #110). */
    output(runId: number, nodeId: string): Promise<RunOutput>
    /** Input ids the run's pipeline takes besides the topic (a `script` input takes a written script). */
    pipelineInputs(pipelineId: number | undefined): string[]
  }
  /** The production projects (one video from a pinned recipe version), read by `production.list`. */
  projects?: {
    list(filter: { channelId?: number }): ProjectSummary[]
  }
  /** The team's work on projects (agents-production): a slot's video gets its project, its script, its quote, its run. */
  teamProjects?: {
    /** The project of a team video, made on its channel's pipeline when it has none. */
    ensureForVideo(videoId: number, recipeId?: number): ProjectDetail
    get(id: number): ProjectDetail
    /** The topic the team chose: the video's title and brief, the project's title and idea (the run's topic). */
    setTopic(videoId: number, title: string, idea: string): ProjectDetail | null
    /** A new project for a video whose run is over (a remake after a refused QC). */
    remake(videoId: number): ProjectDetail
    setScript(id: number, script: string): ProjectDetail
    scriptOf(id: number): string | null
    /** The pipeline of the project reads the owner's script (option « Script » : importé). */
    takesScript(id: number): boolean
    quote(id: number, real: boolean): Promise<RunQuote>
    run(id: number, real: boolean): Promise<ProjectDetail>
  }
  /** ffmpeg + ffprobe of this computer (null when not installed). */
  media?: () => MediaService | null
  /** Charlie's video orders (equipe-3-chaines): the production behind them and their final quality pass. */
  orders?: { production: OrderProduction; finalPass: FinalPass; usdPerCredit(): number }
  /** The channels' custom bricks (src/main/bricks): the motion designer's drafts, previews and proposals. */
  bricks?: BrickStore
  /** The headless browser that draws the bricks' previews (null when none is on this computer) and the embedded fonts. */
  motion?: { browser: () => BrowserService | null; fontCss: () => Promise<string> }
  /** The team's pipelines (production-12): read, try and propose edit operations; the owner accepts in the editor. */
  pipelines?: { teamBench(): Promise<Workbench> }
  /** Reproducing a style (production-15): measure links, read a study, quote its sample (only the owner runs it). */
  styles?: Pick<StyleAgentService, 'study' | 'get' | 'quote'>
  youtube?: {
    ready(signal: AbortSignal): Promise<boolean>
    analyse(url: string, minutes: number, signal: AbortSignal): Promise<{ analysis: AnalysisResult; demo: boolean }>
    /** « Watch a whole video »: the whole shot log, null when it cannot be read whole. */
    whole?(url: string, durationS: number | null, signal: AbortSignal): Promise<{ log: WholeVideoLog; line: string } | null>
  }
}
