// P1 — the corpus (spec §2 P1): the videos analysed, and why each was chosen.
import { z } from 'zod'
import { head } from './common'

export const CORPUS_REASONS = ['asked', 'latest', 'top', 'style-variant'] as const

export const CorpusVideo = z.object({
  /** Stable id inside the clone (`v1`, `v2`…), used by evidence. */
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  publishedAt: z.string().nullable(),
  views: z.number().int().min(0).nullable(),
  durationS: z.number().positive().nullable(),
  why: z.enum(CORPUS_REASONS),
  note: z.string().default(''),
  /** Which brief reference it comes from (index into brief.references; a mix or inspiration brief reads every one). */
  reference: z.number().int().min(0).optional()
})
export type CorpusVideo = z.infer<typeof CorpusVideo>

/** Fewest videos a channel corpus may hold, unless the channel itself has fewer (`channelVideoCount`). */
export const MIN_CHANNEL_CORPUS = 5

export const Corpus = z.object({
  ...head('corpus'),
  mode: z.enum(['single', 'channel']),
  /** How many public videos the channel has (null for a single video). */
  channelVideoCount: z.number().int().min(0).nullable(),
  /** The channel's name (from its link) for the definition's `channel.name`; null for a single video. */
  channelName: z.string().nullable().optional(),
  videos: z.array(CorpusVideo).min(1)
})
export type Corpus = z.infer<typeof Corpus>
