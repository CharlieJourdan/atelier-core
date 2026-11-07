// IPC contract, module "channelLife": a channel's life beyond creating it. Archiving a channel (nothing is deleted: its
// videos stay readable, its agents are paused and leave the runtime's tree until the channel is restored) and translating a
// channel (a new channel in another language that keeps the source as its reference, with a pipeline whose script is
// translated and the source's style copied).
import type { LibraryPipelineRow } from '../analysis'
import type { ChannelRow } from '../workflow'

/** Two letters (`en`, `es`…): the languages a channel can be translated into. */
export const CHANNEL_LANGUAGES = ['fr', 'en', 'es', 'de', 'pt'] as const
export type ChannelLanguage = (typeof CHANNEL_LANGUAGES)[number]

/** What the app keeps about a channel beside its row: its language and, for a translation, the channel it comes from. */
export interface ChannelMeta {
  channelId: number
  /** null: never said (the app's default, French). */
  language: ChannelLanguage | null
  /** The source channel of a translation (kept as its reference), or null. */
  translatedFrom: number | null
  /** The source's name when the translation was made (still shown if the source is archived later). */
  translatedFromName: string | null
}

export interface ChannelArchiveResult {
  channel: ChannelRow
  /** Agents of the channel the runtime paused (and will resume on restore). */
  agentsPaused: number
}

export interface ChannelRestoreResult {
  channel: ChannelRow
  agentsResumed: number
}

export interface ChannelTranslateInput {
  sourceId: number
  language: ChannelLanguage
  /** The new channel's name; « <source> (EN) » when empty. */
  name?: string
  /** The language the source's scripts are written in (default: the source's language, else French). */
  sourceLanguage?: ChannelLanguage
}

export interface ChannelTranslateResult {
  channel: ChannelRow
  meta: ChannelMeta
  /** The library pipeline of the new channel (its default), whose script is translated. */
  pipeline: LibraryPipelineRow
  /** Whether the source had a style sheet / a style profile, copied to the new channel. */
  copied: { styleSheet: boolean; styleProfile: boolean }
}

export interface ChannelLifeContract {
  /** Archives the channel: hidden from the lists, its agents paused; videos, runs and history kept. */
  'channelLife.archive': { args: [channelId: number]; result: ChannelArchiveResult }
  /** Brings an archived channel back, with the agents the archive paused. */
  'channelLife.restore': { args: [channelId: number]; result: ChannelRestoreResult }
  /** The language and the translation source of each channel the app knows something about. */
  'channelLife.meta': { args: []; result: ChannelMeta[] }
  /** A translated copy already exists in that language (not archived): its id, else null. */
  'channelLife.findTranslation': { args: [sourceId: number, language: ChannelLanguage]; result: number | null }
  /** Creates the translated channel (refused when one already exists in that language). Throws a French message. */
  'channelLife.translate': { args: [input: ChannelTranslateInput]; result: ChannelTranslateResult }
}

export const CHANNEL_LIFE_METHODS = [
  'channelLife.archive',
  'channelLife.restore',
  'channelLife.meta',
  'channelLife.findTranslation',
  'channelLife.translate'
] as const satisfies readonly (keyof ChannelLifeContract)[]
