// The real `channel` service of the cloning engine (chantier moteur-analyse, spec §2 P1): a channel's public videos as its
// pages list them, read with yt-dlp on the owner's machine (read-only: flat listing, no download, no cookies; decision
// 0076). Long videos and Shorts both come back, newest first; P1 keeps the channel's main format and one variant.
import type { RunFn } from '../../../../engine/sourcing/types'
import { youtubeMeta } from '../../../eyes/youtube-meta'
import type { ChannelVideo } from '../services'

/** Videos listed per channel (the pages' newest first, plus up to half as many Shorts). */
export const LISTED_VIDEOS = 30

export function realChannel(run?: RunFn): { videos(url: string): Promise<ChannelVideo[]> } {
  const meta = youtubeMeta(run)
  return {
    async videos(url) {
      const data = await meta.channel(url, LISTED_VIDEOS, new AbortController().signal)
      if (!data) throw new Error(`the channel ${url} could not be listed (yt-dlp missing or refused)`)
      return data.videos.map((v) => ({
        url: `https://www.youtube.com/watch?v=${v.id}`,
        title: v.title,
        publishedAt: v.publishedAt || null,
        views: v.views,
        durationS: v.durationS > 0 ? v.durationS : null
      }))
    }
  }
}
