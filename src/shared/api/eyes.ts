// IPC contract, module "eyes" (lot "eyes"): the competitor channels a channel follows, their public numbers read through Atelier
// Cloud (YouTube Data API, read-only), the outliers among their videos, the analysis of some of those videos by the eyes, and the
// channel's STYLE PROFILE built from it (versioned, editable). Every method added here must also be listed in EYES_METHODS and
// counted in tests/unit/eyes-api.test.ts.
import type { WholeVideoLog } from '../shot-log'
import type { StyleProfile } from '../style-profile'

/** « Watch a whole video »: what to read and how much the model's reading may spend. */
export interface WatchVideoOptions {
  /** A video file the user supplied or has rights to (absolute path). */
  file?: string
  title?: string
  durationS?: number
  /** Dollars the model's reading of a link may spend (default 0.5). */
  maxUsd?: number
  refresh?: boolean
  language?: string
  /** Only Google's model reading the link (no download), to compare the ways. */
  modelOnly?: boolean
}

export interface WatchVideoResult {
  /** Plain French: what was read (the whole video, or which part and why). */
  line: string
  cached: boolean
  /** The ways tried before the one that served (French). */
  tried: string[]
  log: WholeVideoLog
}

export interface CompetitorRow {
  id: number
  channelId: number
  url: string
  /** Empty until the channel was read once. */
  name: string
  subscribers: number | null
  watched: boolean
  /** Null until read. */
  lastReadAt: string | null
  videos: number
  outliers: number
  /** The last read came from the Cloud's demonstration provider. */
  demo: boolean
}

export interface OutlierRow {
  videoId: string
  url: string
  title: string
  /** 0 = the channel itself. */
  sourceKey: number
  channelName: string
  views: number
  /** Views divided by the median of the channel's videos of the same age. */
  score: number
  /** Why it worked, from the numbers (French). */
  why: string
  publishedAt: string
  analysed: boolean
  demo: boolean
}

export interface StyleProfileVersionRow {
  version: number
  note: string
  origin: 'built' | 'edited'
  createdAt: string
}

export interface EyesDetail {
  channelId: number
  /** The YouTube link of the channel itself, when it is known (the channel sheet's YouTube id). */
  ownUrl: string | null
  current: StyleProfile | null
  currentVersion: number | null
  versions: StyleProfileVersionRow[]
  competitors: CompetitorRow[]
  /** How many videos were analysed, by origin, and whether any is a demonstration. */
  analysed: { own: number; competitors: number; demo: boolean }
  /** Atelier Cloud answers (connected): the reads and the analyses need it. */
  cloudConnected: boolean
}

export interface EyesReadResult {
  channelsRead: number
  videos: number
  outliers: number
  quotaUnits: number
  demo: boolean
  problems: string[]
}

export interface EyesAnalyseResult {
  analysed: number
  /** Outliers already analysed earlier. */
  alreadyDone: number
  demo: boolean
  problems: string[]
  /** Per analysed video, plain French: read whole, or only its first minutes. */
  coverage: string[]
}

export interface EyesContract {
  'eyes.get': { args: [channelId: number]; result: EyesDetail }
  'eyes.addCompetitor': { args: [channelId: number, url: string]; result: EyesDetail }
  'eyes.setWatched': { args: [competitorId: number, watched: boolean]; result: EyesDetail }
  'eyes.removeCompetitor': { args: [competitorId: number]; result: EyesDetail }
  /** Reads the channel and its watched competitors through the Cloud (YouTube Data API, read-only): numbers only. */
  'eyes.read': { args: [channelId: number]; result: EyesReadResult }
  /** The outliers among the read videos, the strongest first. */
  'eyes.outliers': { args: [channelId: number]; result: OutlierRow[] }
  /** Has the eyes analyse up to `max` outliers (billed in credits by the Cloud). */
  'eyes.analyse': { args: [channelId: number, max?: number]; result: EyesAnalyseResult }
  /** Builds a new profile version from the analyses kept. */
  'eyes.build': { args: [channelId: number, note?: string]; result: EyesDetail }
  /** Saves the owner's edit of the profile as a new version. */
  'eyes.save': { args: [channelId: number, profile: StyleProfile, note: string]; result: EyesDetail }
  'eyes.version': { args: [channelId: number, version: number]; result: StyleProfile }
  /** Reads a whole video (a public link, or a file the user supplied): the shot log, hook and cadence, cached per video. */
  'eyes.watchVideo': { args: [url: string, options?: WatchVideoOptions]; result: WatchVideoResult }
}

export const EYES_METHODS = [
  'eyes.get',
  'eyes.addCompetitor',
  'eyes.setWatched',
  'eyes.removeCompetitor',
  'eyes.read',
  'eyes.outliers',
  'eyes.analyse',
  'eyes.build',
  'eyes.save',
  'eyes.version',
  'eyes.watchVideo'
] as const satisfies readonly (keyof EyesContract)[]
