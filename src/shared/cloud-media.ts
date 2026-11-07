// Media sourcing on Atelier Cloud (src/engine/sourcing): one search over the free archives, stock libraries, sound banks and
// their free keys. The keys live in the Cloud's vault and never leave it: the app sends a query, the Cloud runs the providers it
// holds a key for (and the keyless ones), and answers ranked candidates with their legal status, preview URL and a cost of 0.
// Nothing is downloaded or billed here; paid sources and web excerpts are not reachable through this route.
//
// A separate file from cloud-api.ts (already large): it imports only zod, so the Cloud (type stripping, imports end in `.ts`)
// and the app (bundler) both read it as it is. Routes use the same shape as CLOUD_ROUTES.
import { z } from 'zod'

export const MEDIA_KINDS = ['image', 'video', 'sfx', 'music'] as const

export const MediaSearchRequest = z.object({
  query: z.string().trim().min(1).max(300),
  kinds: z.array(z.enum(MEDIA_KINDS)).min(1).max(4).default(['image']),
  /** Candidates per kind. */
  count: z.number().int().min(1).max(12).default(6),
  orientation: z.enum(['landscape', 'portrait', 'any']).optional(),
  era: z.string().trim().max(60).optional(),
  /** Other ways to ask for the same thing, in the archive's own words (at most 3). */
  variants: z.array(z.string().trim().min(1).max(300)).max(3).optional(),
  minDurationS: z.number().min(0).max(3600).optional(),
  maxDurationS: z.number().min(0).max(3600).optional(),
  /** Restrict to these provider ids (`GET` of the catalog is not a route: ids are in research note technos-medias-2026-11 (old repository)). */
  providers: z.array(z.string().max(40)).max(20).optional()
})
export type MediaSearchRequest = z.infer<typeof MediaSearchRequest>

export const MediaCandidate = z.object({
  provider: z.string(),
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  title: z.string(),
  description: z.string().optional(),
  creator: z.string().optional(),
  date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pageUrl: z.string(),
  previewUrl: z.string(),
  fileUrl: z.string(),
  mime: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationS: z.number().optional(),
  licence: z.object({
    short: z.string(),
    status: z.enum(['public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'free-licence', 'fair-use-excerpt', 'forbidden']),
    url: z.string().optional(),
    attributionRequired: z.boolean()
  }),
  credit: z.string(),
  review: z.enum(['clear', 'human-review']),
  reviewReason: z.string().optional(),
  costUsd: z.number(),
  score: z.number(),
  excerpt: z.object({ startS: z.number(), endS: z.number() }).optional(),
  logo: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional()
})
export type MediaCandidate = z.infer<typeof MediaCandidate>

export const MediaSearchResponse = z.object({
  candidates: z.array(MediaCandidate),
  errors: z.array(z.object({ provider: z.string(), message: z.string() })),
  /** Providers not asked: a key the Cloud's vault does not hold (`detail` = the vault name), or a paid one. */
  skipped: z.array(z.object({ provider: z.string(), reason: z.enum(['no-key', 'paid', 'kind', 'disabled']), detail: z.string().optional() })),
  asked: z.array(z.string()),
  costUsd: z.number(),
  droppedForbidden: z.number().int(),
  timingsMs: z.record(z.string(), z.number())
})
export type MediaSearchResponse = z.infer<typeof MediaSearchResponse>

/** « Watching » a public YouTube video: Gemini answers its shot log. It costs real money (≈ 0.004 $ per minute watched), so the route
 *  refuses unless the Cloud has paidCalls on, GEMINI_API_KEY in its vault, and the team is an internal or test team (no billing is built
 *  for it yet: the cost is reported, not charged). */
export const MediaWatchRequest = z.object({
  /** Only public https youtube.com / youtu.be links (checked by the route with `isYoutubeUrl` of cloud-api.ts). */
  url: z.string().max(500),
  startS: z.number().int().min(0).max(36_000).default(0),
  /** The range is cut to 8 minutes. */
  endS: z.number().int().min(1).max(36_000),
  /** What the shots should preferably show. */
  focus: z.string().trim().max(300).optional(),
  /** The dense shot log of « watch a whole video » (verbatim text, words said, camera move). An older Cloud ignores it. */
  dense: z.boolean().optional(),
  /** Frames a second sampled (Gemini's default 1). */
  fps: z.number().min(0.1).max(5).optional()
})
export type MediaWatchRequest = z.infer<typeof MediaWatchRequest>

export const MediaShot = z.object({
  startS: z.number(),
  endS: z.number(),
  shows: z.string(),
  kind: z.string(),
  text: z.string(),
  logo: z.string(),
  ai: z.boolean(),
  edited: z.boolean(),
  subtitles: z.boolean(),
  quality: z.number().int().min(1).max(5),
  onText: z.string().optional(),
  says: z.string().optional(),
  camera: z.string().optional()
})

export const MediaWatchResponse = z.object({
  shots: z.array(MediaShot),
  model: z.string(),
  costUsd: z.number(),
  ms: z.number(),
  rangeStartS: z.number(),
  rangeEndS: z.number(),
  /** Echoed when the dense log was really made: an older Cloud never sends it (the client then knows the extra fields are missing). */
  dense: z.boolean().optional(),
  usage: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional(), thoughtsTokenCount: z.number().optional() }).passthrough().optional()
})
export type MediaWatchResponse = z.infer<typeof MediaWatchResponse>

export const MEDIA_ROUTES = {
  mediaSearch: { method: 'POST', path: '/v1/media/search', auth: 'user', body: MediaSearchRequest, response: MediaSearchResponse },
  mediaWatch: { method: 'POST', path: '/v1/media/watch', auth: 'user', body: MediaWatchRequest, response: MediaWatchResponse }
} as const
