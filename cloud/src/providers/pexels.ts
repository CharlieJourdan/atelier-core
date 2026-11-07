// Pexels stock photos and videos (usage `searchStock`), written from the official documentation read on 2026-10-24:
//   https://www.pexels.com/api/documentation/
//   Photos  GET https://api.pexels.com/v1/search?query=&orientation=landscape|portrait|square&per_page=
//           → { photos: [{ id, width, height, url, photographer, photographer_url, alt, src { original, large2x, large, … } }] }
//   Videos  GET https://api.pexels.com/v1/videos/search?query=&orientation=&per_page=
//           → { videos: [{ id, width, height, url, duration, user { name, url }, video_files [{ file_type, width, height,
//           link }] }] }
//   Auth    `Authorization: <key>` (the bare key, no "Bearer"). Limits: 200 requests an hour, 20 000 a month by default; a 429
//           carries no headers and is retried by the jobs module.
//   Terms   free to use, commercially too; attribution is not required but asked for ("Photo by X on Pexels"), so it is kept
//           with every result (`attribution`) and the edit lists it in the video's credits. Pexels content may not be
//           resold as is or used to rebuild Pexels: the Cloud only hands a user the pictures a video needs.
// Cost: Pexels bills nothing (costUsd 0); the grid's `stock.searches` item is 0 credit too (decision 0105).
// Photos are taken at `large2x` (about 1880 px on the long side), videos at the smallest mp4 whose long side reaches 1280 px,
// so a shot is not a 4K download. TO VERIFY with a real key: that `large2x` of a portrait photo is tall enough for a 9:16 still.
import { z } from 'zod'
import { orientationOf } from '../../../src/shared/cloud-api.ts'
import { call, readJson, type HttpOptions } from './http.ts'
import { collect, type Candidate } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const PEXELS_BASE = 'https://api.pexels.com'

const Photo = z
  .object({
    id: z.number(),
    width: z.number(),
    height: z.number(),
    url: z.string().optional(),
    photographer: z.string().optional(),
    photographer_url: z.string().optional(),
    alt: z.string().nullish(),
    src: z.object({ original: z.string().optional(), large2x: z.string().optional(), large: z.string().optional() }).passthrough()
  })
  .passthrough()
const PhotoAnswer = z.object({ photos: z.array(Photo).default([]) }).passthrough()

const VideoFile = z.object({ file_type: z.string().nullish(), width: z.number().nullish(), height: z.number().nullish(), link: z.string() }).passthrough()
const Video = z
  .object({
    id: z.number(),
    width: z.number(),
    height: z.number(),
    url: z.string().optional(),
    duration: z.number().optional(),
    user: z.object({ name: z.string().optional(), url: z.string().optional() }).passthrough().nullish(),
    video_files: z.array(VideoFile).default([])
  })
  .passthrough()
const VideoAnswer = z.object({ videos: z.array(Video).default([]) }).passthrough()

/** The mp4 to download: the smallest one whose long side reaches `minLong`, else the biggest there is. */
export function pickVideoFile(files: readonly z.infer<typeof VideoFile>[], minLong = 1280): string | null {
  const mp4 = files.filter((f) => (f.file_type ?? 'video/mp4') === 'video/mp4' && f.link)
  const size = (f: z.infer<typeof VideoFile>): number => Math.max(f.width ?? 0, f.height ?? 0)
  const sorted = [...mp4].sort((a, b) => size(a) - size(b))
  return (sorted.find((f) => size(f) >= minLong) ?? sorted.at(-1))?.link ?? null
}

const errorDetail = (body: string): string | undefined => {
  try {
    const e = (JSON.parse(body) as { error?: unknown }).error
    return typeof e === 'string' ? e : undefined
  } catch {
    return undefined
  }
}

export interface PexelsOptions extends HttpOptions {
  baseUrl?: string
}

export function pexelsAdapter(o: PexelsOptions = {}): ProviderAdapter {
  const base = (o.baseUrl ?? PEXELS_BASE).replace(/\/+$/, '')
  const label = 'Pexels search'
  return {
    id: 'pexels',
    kind: 'real',
    secretName: 'PEXELS_API_KEY',
    async searchStock(input, ctx) {
      const secret = ctx.secret()
      const video = input.kind === 'video'
      // a few more than asked for: a file that is too big or not an mp4 is skipped
      const url = new URL(`${base}${video ? '/v1/videos/search' : '/v1/search'}`)
      url.searchParams.set('query', input.query)
      url.searchParams.set('orientation', input.orientation)
      url.searchParams.set('per_page', String(Math.min(80, input.count + 3)))
      ctx.progress(0.1)
      const res = await call(
        { label, url: url.toString(), secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: { authorization: secret, accept: 'application/json' } } },
        o
      )
      const json = await readJson(res, label, ctx.signal)
      const candidates: Candidate[] = []
      if (video) {
        const parsed = VideoAnswer.safeParse(json)
        if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        for (const v of parsed.data.videos) {
          const link = pickVideoFile(v.video_files)
          if (!link) continue
          const who = v.user?.name ?? 'Pexels'
          candidates.push({
            url: link,
            mimes: ['video/mp4'],
            result: {
              id: `pexels-video-${v.id}`,
              source: 'pexels',
              kind: 'video',
              title: input.query,
              creator: who,
              creatorUrl: v.user?.url ?? null,
              pageUrl: v.url ?? null,
              licence: 'Pexels License',
              attribution: `Video by ${who} on Pexels`,
              attributionRequired: false,
              width: v.width,
              height: v.height,
              orientation: orientationOf(v.width, v.height),
              durationS: v.duration ?? null
            }
          })
        }
      } else {
        const parsed = PhotoAnswer.safeParse(json)
        if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        for (const p of parsed.data.photos) {
          const link = p.src.large2x ?? p.src.large ?? p.src.original
          if (!link) continue
          const who = p.photographer ?? 'Pexels'
          candidates.push({
            url: link,
            mimes: ['image/jpeg', 'image/png', 'image/webp'],
            result: {
              id: `pexels-photo-${p.id}`,
              source: 'pexels',
              kind: 'photo',
              title: p.alt?.trim() || input.query,
              creator: who,
              creatorUrl: p.photographer_url ?? null,
              pageUrl: p.url ?? null,
              licence: 'Pexels License',
              attribution: `Photo by ${who} on Pexels`,
              attributionRequired: false,
              width: p.width,
              height: p.height,
              orientation: orientationOf(p.width, p.height),
              durationS: null
            }
          })
        }
      }
      // Pexels filters by orientation itself: its order is its relevance order, kept as is
      const { files, results } = await collect(candidates, input.count, 'Pexels download', ctx.signal, o, (f) => ctx.progress(0.1 + 0.9 * f))
      ctx.progress(1)
      return { files, data: { query: input.query, kind: input.kind, orientation: input.orientation, provider: 'pexels', results }, costUsd: 0 }
    }
  }
}
