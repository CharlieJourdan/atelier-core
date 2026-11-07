// What a public YouTube page says about a video or a channel, read on the owner's machine with yt-dlp (essais-utilisateur,
// 03/11). Read-only by construction: no login, no cookies, metadata only (`--skip-download`, `--flat-playlist`), the link after
// `--` (decision 0076). It gives the style study what the eyes do not: a video's real title, its length (to say how much of it
// was watched), its channel (to clone the channel's style from one of its videos), its description and category (a studio's
// credits, « podcast », « aucune IA », a music label: what says a style cannot be made), and a channel's latest videos when
// Atelier Cloud cannot read YouTube. Nothing fails: without yt-dlp, or when YouTube refuses, every read answers null.
import { spawnRun } from '../../engine/sourcing/providers/ytdlp'
import type { RunFn } from '../../engine/sourcing/types'
import type { ChannelDataResult } from '../../shared/cloud-api'

export interface VideoMeta {
  id: string
  title: string
  channel: string | null
  /** The channel's page (`https://www.youtube.com/@handle` or `/channel/UC…`). */
  channelUrl: string | null
  durationS: number | null
  views: number | null
  subscribers: number | null
  /** The first lines of the description (the credits, the sponsor, « aucune IA »). */
  description: string
  categories: string[]
}

export interface YoutubeMetaPort {
  video(url: string, signal: AbortSignal): Promise<VideoMeta | null>
  /** The channel's latest videos (long ones and Shorts), as Atelier Cloud's `channelData` gives them. */
  channel(url: string, max: number, signal: AbortSignal): Promise<ChannelDataResult | null>
}

const BASE = ['--ignore-config', '--no-warnings', '--no-cookies-from-browser', '--socket-timeout', '20']
export const videoArgs = (url: string): string[] => [...BASE, '--no-playlist', '--skip-download', '--dump-single-json', '--', url]
export const tabArgs = (url: string, max: number): string[] => [...BASE, '--flat-playlist', '--dump-single-json', '--playlist-end', String(Math.max(1, Math.min(max, 30))), '--', url]

type Json = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

/** A video's metadata from yt-dlp's single JSON. Pure. */
export function parseVideo(raw: string): VideoMeta | null {
  try {
    const j = JSON.parse(raw) as Json
    const id = str(j.id)
    const title = str(j.title)
    if (!id || !title) return null
    const handle = str(j.uploader_id)
    const channelUrl = str(j.uploader_url) ?? (handle?.startsWith('@') ? `https://www.youtube.com/${handle}` : null) ?? str(j.channel_url)
    return {
      id,
      title: title.slice(0, 200),
      channel: str(j.channel) ?? str(j.uploader),
      channelUrl,
      durationS: int(j.duration),
      views: int(j.view_count),
      subscribers: int(j.channel_follower_count),
      description: (str(j.description) ?? '').slice(0, 1200),
      categories: Array.isArray(j.categories) ? j.categories.filter((c): c is string => typeof c === 'string').slice(0, 4) : []
    }
  } catch {
    return null
  }
}

/** The channel's root page from any of its links (`…/@x/videos` → `…/@x`). */
export const channelRoot = (url: string): string => url.replace(/\/+$/, '').replace(/\/(videos|shorts|featured|streams)$/, '')

/** One tab of a channel (videos or shorts) from yt-dlp's flat single JSON. Pure. */
export function parseTab(raw: string, short: boolean): { title: string | null; subscribers: number | null; videos: ChannelDataResult['videos'] } {
  try {
    const j = JSON.parse(raw) as Json
    const entries = Array.isArray(j.entries) ? (j.entries as Json[]) : []
    const videos = entries.flatMap((e) => {
      const id = str(e.id)
      if (!id || id.length > 20) return []
      // a Short's flat entry carries no duration: under a minute is what YouTube shows on that tab
      const durationS = int(e.duration) ?? (short ? 45 : 0)
      return [{ id, title: (str(e.title) ?? id).slice(0, 200), views: int(e.view_count) ?? 0, likes: null, comments: null, durationS, publishedAt: '', thumbnailUrl: null }]
    })
    const title = (str(j.channel) ?? str(j.uploader) ?? str(j.title))?.replace(/\s+-\s+(Videos|Shorts|Vidéos)$/i, '') ?? null
    return { title, subscribers: int(j.channel_follower_count), videos }
  } catch {
    return { title: null, subscribers: null, videos: [] }
  }
}

/** The app's reader: yt-dlp on the owner's machine (null, never an error, when it is missing or refused). */
export function youtubeMeta(run: RunFn = spawnRun): YoutubeMetaPort {
  const read = async (args: string[], signal: AbortSignal): Promise<string | null> => {
    try {
      return (await run('yt-dlp', args, { signal, timeoutMs: 90_000 })).stdout
    } catch (e) {
      if (signal.aborted) throw e
      return null
    }
  }
  return {
    async video(url, signal) {
      const out = await read(videoArgs(url), signal)
      return out ? parseVideo(out) : null
    },
    async channel(url, max, signal) {
      const root = channelRoot(url)
      const [long, shorts] = await Promise.all([read(tabArgs(`${root}/videos`, max), signal), read(tabArgs(`${root}/shorts`, Math.ceil(max / 2)), signal)])
      const a = long ? parseTab(long, false) : null
      const b = shorts ? parseTab(shorts, true) : null
      const videos = [...(a?.videos ?? []), ...(b?.videos ?? [])]
      if (videos.length === 0) return null
      return { url: root, channelId: '', title: a?.title ?? b?.title ?? root, subscribers: a?.subscribers ?? b?.subscribers ?? null, totalViews: null, videoCount: videos.length, videos, quotaUnits: 0 }
    }
  }
}
