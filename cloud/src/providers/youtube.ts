// YouTube channel data (usage `channelData`), READ-ONLY, written from the YouTube Data API v3 reference
// (https://developers.google.com/youtube/v3/docs, quota table: https://developers.google.com/youtube/v3/determine_quota_cost):
//   channels.list       GET /channels?part=snippet,statistics,contentDetails&id=|forHandle=|forUsername=   1 unit
//                       → items[0] { id, snippet.title, statistics { subscriberCount, hiddenSubscriberCount, viewCount, videoCount },
//                         contentDetails.relatedPlaylists.uploads }
//   playlistItems.list  GET /playlistItems?part=contentDetails&playlistId=<uploads>&maxResults=50&pageToken=            1 unit a page
//                       → items[].contentDetails.videoId, nextPageToken
//   videos.list         GET /videos?part=snippet,statistics,contentDetails&id=a,b,c (at most 50)                          1 unit a call
//                       → items[] { id, snippet { title, publishedAt, thumbnails }, statistics { viewCount, likeCount, commentCount },
//                         contentDetails.duration (ISO 8601) }
// Never `search.list` (100 units a call): a channel is found by its id, @handle or legacy user name, a video link gives its channel.
// Auth: the API key only, in the `x-goog-api-key` header (never in the URL, so no log line can carry it). No OAuth, no scope, and
// nothing but GET on the three list endpoints above: `endpointUrl` refuses any other path, so a write endpoint cannot be reached
// from this file (a test checks it). YouTube writes (upload, comment, Studio) are forbidden in Atelier (CLAUDE.md).
// Quota: the free allowance is 10 000 units a day per Google project. Every call is counted BEFORE it is made, in the Cloud's
// persisted daily counter (QuotaMeter), and refused once the configured budget (`youtube.dailyQuota`, default 8 000) would be passed.
// Cost: Google bills nothing (costUsd 0); the grid's `channel.request` item is 0 credit too (decision 0105).
import { z } from 'zod'
import { call, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderAdapter, type QuotaMeter } from './types.ts'

export const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3'
/** The only endpoints this adapter can reach: the three read-only list methods, 1 quota unit a call. */
export const YOUTUBE_ENDPOINTS = ['channels', 'playlistItems', 'videos'] as const
export type YoutubeEndpoint = (typeof YOUTUBE_ENDPOINTS)[number]
export const YOUTUBE_UNIT_COST: Record<YoutubeEndpoint, number> = { channels: 1, playlistItems: 1, videos: 1 }
/** The free allowance per Google project and day. */
export const YOUTUBE_FREE_UNITS_PER_DAY = 10_000
/** Our own ceiling, under the allowance so the other readers of the same Google project keep some. */
export const DEFAULT_YOUTUBE_DAILY_QUOTA = 8_000
const PAGE = 50

/** Which channel a link names. A custom URL (`/c/name`, `/name`) has no free lookup (only `search.list`, 100 units) and is refused. */
export type ChannelRef =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'user'; value: string }
  | { kind: 'video'; value: string }

export function parseChannelUrl(link: string): ChannelRef {
  const url = new URL(link)
  const host = url.hostname.toLowerCase()
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    if (id) return { kind: 'video', value: id }
  }
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p))
  const first = parts[0] ?? ''
  if (first.startsWith('@') && first.length > 1) return { kind: 'handle', value: first }
  if (first === 'channel' && /^UC[\w-]{20,}$/.test(parts[1] ?? '')) return { kind: 'id', value: parts[1] as string }
  if (first === 'user' && parts[1]) return { kind: 'user', value: parts[1] }
  if (first === 'watch' && url.searchParams.get('v')) return { kind: 'video', value: url.searchParams.get('v') as string }
  if ((first === 'shorts' || first === 'live') && parts[1]) return { kind: 'video', value: parts[1] }
  throw new Error('YouTube channel data: this link form cannot be looked up for free; use the @handle link of the channel or its /channel/UC… link')
}

/** ISO 8601 duration (PT1H2M3S, P1DT2H) in seconds; 0 for a live or an unreadable value. */
export function isoDurationS(value: string | undefined | null): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value ?? '')
  if (!m) return 0
  return Math.round(Number(m[1] ?? 0) * 86_400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0))
}

const count = (v: string | number | undefined | null): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

const Num = z.union([z.string(), z.number()]).optional()
const ChannelsAnswer = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            snippet: z.object({ title: z.string().default('') }).passthrough().optional(),
            statistics: z.object({ subscriberCount: Num, hiddenSubscriberCount: z.boolean().optional(), viewCount: Num, videoCount: Num }).passthrough().optional(),
            contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).passthrough().optional() }).passthrough().optional()
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough()
const PlaylistAnswer = z
  .object({
    items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }).passthrough() }).passthrough()).default([]),
    nextPageToken: z.string().optional()
  })
  .passthrough()
const VideosAnswer = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            snippet: z
              .object({
                title: z.string().default(''),
                publishedAt: z.string().default(''),
                channelId: z.string().optional(),
                thumbnails: z.record(z.string(), z.object({ url: z.string() }).passthrough()).optional()
              })
              .passthrough(),
            statistics: z.object({ viewCount: Num, likeCount: Num, commentCount: Num }).passthrough().optional(),
            contentDetails: z.object({ duration: z.string().optional() }).passthrough().optional()
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough()

const errorReason = (body: string): string | undefined => {
  try {
    const e = (JSON.parse(body) as { error?: { errors?: { reason?: string }[]; status?: string } }).error
    return e?.errors?.[0]?.reason ?? e?.status
  } catch {
    return undefined
  }
}

/** Counts a job's calls against the day's budget. */
class Budget {
  spent = 0
  private readonly meter: QuotaMeter
  readonly limit: number
  constructor(meter: QuotaMeter, limit: number) {
    this.meter = meter
    this.limit = limit
  }
  /** Throws (a permanent error) when `units` more would pass the budget. */
  assert(units: number): void {
    const used = this.meter.used()
    if (used + units > this.limit) {
      throw new Error(
        `YouTube Data API: the daily budget of ${this.limit} units would be passed (${used} used today, ${units} needed); try again after midnight Pacific time or raise youtube.dailyQuota`
      )
    }
  }
  /** Google refused for quota: count the rest of the budget as used. */
  exhaust(): void {
    this.meter.add(Math.max(0, this.limit - this.meter.used()))
  }
  spend(units: number): void {
    this.assert(units)
    this.meter.add(units)
    this.spent += units
  }
}

/** A day's counter that lives in this process only: for a call made without the Cloud's persisted counter (tests, one-off tools). */
export function memoryMeter(): QuotaMeter {
  let used = 0
  return { used: () => used, add: (n) => void (used += n) }
}

export interface YoutubeOptions extends HttpOptions {
  baseUrl?: string
  /** The budget in quota units a day; default 8 000, at most the free allowance of 10 000. */
  dailyQuota?: number
}

/** Units a read of `maxVideos` videos needs at most (channel, one playlist page and one videos call per 50 videos). */
export function estimateUnits(maxVideos: number, ref: ChannelRef['kind'] = 'id'): number {
  const pages = Math.ceil(maxVideos / PAGE)
  return YOUTUBE_UNIT_COST.channels + pages * YOUTUBE_UNIT_COST.playlistItems + pages * YOUTUBE_UNIT_COST.videos + (ref === 'video' ? YOUTUBE_UNIT_COST.videos : 0)
}

export function youtubeAdapter(o: YoutubeOptions = {}): ProviderAdapter {
  const base = (o.baseUrl ?? YOUTUBE_BASE).replace(/\/+$/, '')
  const limit = Math.min(o.dailyQuota ?? DEFAULT_YOUTUBE_DAILY_QUOTA, YOUTUBE_FREE_UNITS_PER_DAY)
  const fallbackMeter = memoryMeter()
  /** The only way to build a request: a list endpoint with its query. */
  const endpointUrl = (endpoint: YoutubeEndpoint, query: Record<string, string>): string => {
    if (!(YOUTUBE_ENDPOINTS as readonly string[]).includes(endpoint)) throw new Error(`YouTube Data API: ${endpoint} is not a read-only list endpoint`)
    const url = new URL(`${base}/${endpoint}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return url.toString()
  }
  return {
    id: 'youtube',
    kind: 'real',
    secretName: 'YOUTUBE_API_KEY',
    async channelData(input, ctx) {
      const secret = ctx.secret()
      const budget = new Budget(ctx.quota ?? fallbackMeter, limit)
      const ref = parseChannelUrl(input.url)
      budget.assert(estimateUnits(input.maxVideos, ref.kind))
      const get = async <T>(label: string, endpoint: YoutubeEndpoint, query: Record<string, string>, schema: z.ZodType<T>): Promise<T> => {
        throwIfAborted(ctx.signal)
        budget.spend(YOUTUBE_UNIT_COST[endpoint])
        let res: Response
        try {
          res = await call(
            { label, url: endpointUrl(endpoint, query), secret, signal: ctx.signal, detail: errorReason, init: { method: 'GET', headers: { 'x-goog-api-key': secret, accept: 'application/json' } } },
            o
          )
        } catch (err) {
          // Google says the day's allowance is gone (another reader of the same project spent it): stop asking until tomorrow
          if (err instanceof Error && /quotaExceeded|dailyLimitExceeded/.test(err.message)) budget.exhaust()
          throw err
        }
        const parsed = schema.safeParse(await readJson(res, label, ctx.signal))
        if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        return parsed.data
      }
      ctx.progress(0.05)
      let channelQuery: Record<string, string>
      if (ref.kind === 'video') {
        const v = await get('YouTube video lookup', 'videos', { part: 'snippet', id: ref.value }, VideosAnswer)
        const channelId = v.items[0]?.snippet.channelId
        if (!channelId) throw new Error('YouTube Data API: no such video, so no channel to read')
        channelQuery = { id: channelId }
      } else {
        channelQuery = { [{ id: 'id', handle: 'forHandle', user: 'forUsername' }[ref.kind]]: ref.value }
      }
      const ch = (await get('YouTube channel', 'channels', { part: 'snippet,statistics,contentDetails', ...channelQuery }, ChannelsAnswer)).items[0]
      if (!ch) throw new Error('YouTube Data API: no such channel')
      const uploads = ch.contentDetails?.relatedPlaylists?.uploads
      ctx.progress(0.2)
      // the ids of the newest uploads, a page of 50 at a time
      const ids: string[] = []
      let token: string | undefined
      if (uploads) {
        do {
          const page = await get(
            'YouTube uploads',
            'playlistItems',
            { part: 'contentDetails', playlistId: uploads, maxResults: String(Math.min(PAGE, input.maxVideos - ids.length)), ...(token ? { pageToken: token } : {}) },
            PlaylistAnswer
          )
          for (const it of page.items) if (!ids.includes(it.contentDetails.videoId)) ids.push(it.contentDetails.videoId)
          token = page.nextPageToken
          ctx.progress(0.2 + 0.3 * Math.min(1, ids.length / input.maxVideos))
        } while (token && ids.length < input.maxVideos)
      }
      const wanted = ids.slice(0, input.maxVideos)
      const byId = new Map<string, z.infer<typeof VideosAnswer>['items'][number]>()
      for (let i = 0; i < wanted.length; i += PAGE) {
        const chunk = wanted.slice(i, i + PAGE)
        const answer = await get('YouTube videos', 'videos', { part: 'snippet,statistics,contentDetails', id: chunk.join(',') }, VideosAnswer)
        for (const v of answer.items) byId.set(v.id, v)
        ctx.progress(0.5 + 0.5 * Math.min(1, (i + chunk.length) / wanted.length))
      }
      // a private or deleted video is simply missing from `videos.list`: it is skipped; the playlist's order (newest first) is kept
      const videos = wanted.flatMap((id) => {
        const v = byId.get(id)
        if (!v) return []
        const thumbs = v.snippet.thumbnails ?? {}
        return [
          {
            id,
            title: v.snippet.title,
            views: count(v.statistics?.viewCount) ?? 0,
            likes: count(v.statistics?.likeCount),
            comments: count(v.statistics?.commentCount),
            durationS: isoDurationS(v.contentDetails?.duration),
            publishedAt: v.snippet.publishedAt,
            thumbnailUrl: (thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null
          }
        ]
      })
      ctx.progress(1)
      const hidden = ch.statistics?.hiddenSubscriberCount === true
      return {
        files: [],
        data: {
          url: input.url,
          channelId: ch.id,
          title: ch.snippet?.title ?? '',
          subscribers: hidden ? null : count(ch.statistics?.subscriberCount),
          totalViews: count(ch.statistics?.viewCount),
          videoCount: count(ch.statistics?.videoCount),
          videos,
          quotaUnits: budget.spent
        },
        costUsd: 0
      }
    }
  }
}
