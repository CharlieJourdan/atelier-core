// Wikimedia Commons archives (usage `searchStock`, public-domain and Creative Commons files), written from the MediaWiki
// Action API documentation (https://www.mediawiki.org/wiki/API:Search , API:Imageinfo) and Commons' own help pages:
//   GET https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search
//       &gsrsearch=<query> filetype:bitmap|video &gsrnamespace=6 &gsrlimit=N &prop=imageinfo
//       &iiprop=url|size|mime|mediatype|extmetadata &iiurlwidth=1920
//   → query.pages[]: { title, index (rank), imageinfo [{ url, thumburl, width, height, mime, mediatype, descriptionurl,
//     extmetadata { LicenseShortName, Artist (HTML), AttributionRequired, ObjectName } }] }
// No key: the API is public. It is still the network, so this adapter is only reachable behind the paidCalls guard and the
// configuration (`providers.searchStock: "wikimedia"`), like every real adapter. Wikimedia's etiquette is followed: a
// descriptive User-Agent with a contact, one request at a time, files only from upload.wikimedia.org.
// Licences: only public domain, CC0, CC BY and CC BY-SA files are kept (never NC or ND: the videos are sold). The licence name,
// the author and the attribution line are kept with every result; CC BY / BY-SA REQUIRE the credit (`attributionRequired`),
// and BY-SA asks that a derived work carry the same licence, so the app shows the licence next to the credit.
// The API cannot filter by orientation: results are filtered afterwards on their size.
// Cost: free (costUsd 0); the grid's `stock.searches` item is 0 credit too (decision 0105).
import { z } from 'zod'
import { orientationOf, type StockResult } from '../../../src/shared/cloud-api.ts'
import { call, readJson, type HttpOptions } from './http.ts'
import { collect, type Candidate } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const WIKIMEDIA_BASE = 'https://commons.wikimedia.org'
export const WIKIMEDIA_FILE_HOST = 'upload.wikimedia.org'
export const WIKIMEDIA_DEFAULT_CONTACT = 'atelier-cloud (stock search for video makers)'

const Meta = z.object({ value: z.union([z.string(), z.number(), z.boolean()]).nullish() }).passthrough()
const Info = z
  .object({
    url: z.string().optional(),
    thumburl: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    mime: z.string().optional(),
    descriptionurl: z.string().optional(),
    extmetadata: z.record(z.string(), Meta).optional()
  })
  .passthrough()
const Answer = z
  .object({
    error: z.object({ code: z.string().optional() }).passthrough().optional(),
    query: z
      .object({
        pages: z.array(z.object({ title: z.string(), index: z.number().optional(), imageinfo: z.array(Info).optional() }).passthrough()).default([])
      })
      .passthrough()
      .optional()
  })
  .passthrough()

/** Public domain, CC0, CC BY and CC BY-SA only. NC (non-commercial) and ND (no derivatives) are refused. */
export function licenceUsable(shortName: string): boolean {
  const l = shortName.trim().toLowerCase()
  if (!l) return false
  if (/(^|[\s-])(nc|nd)([\s-]|$)/.test(l)) return false
  return /^(public domain|pd[\s-]|pd$|cc0|cc[\s-]by)/.test(l) || l === 'no restrictions'
}

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

const meta = (m: Record<string, z.infer<typeof Meta>> | undefined, key: string): string => {
  const v = m?.[key]?.value
  return v === undefined || v === null ? '' : stripHtml(String(v))
}

/** "File:Phare de Créac'h 2008.jpg" → "Phare de Créac'h 2008". */
export const titleOf = (fileTitle: string): string => fileTitle.replace(/^File:/i, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_/g, ' ').trim()

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
const VIDEO_MIMES = ['video/webm', 'video/ogg', 'video/mp4'] as const

const isCommonsFile = (url: string | undefined): url is string => {
  try {
    return Boolean(url) && new URL(url as string).protocol === 'https:' && new URL(url as string).hostname === WIKIMEDIA_FILE_HOST
  } catch {
    return false
  }
}

export interface WikimediaOptions extends HttpOptions {
  baseUrl?: string
  /** Appended to the User-Agent so Wikimedia can reach whoever runs the Cloud (config.json "wikimedia.contact"). */
  contact?: string
}

export function wikimediaAdapter(o: WikimediaOptions = {}): ProviderAdapter {
  const base = (o.baseUrl ?? WIKIMEDIA_BASE).replace(/\/+$/, '')
  const userAgent = `AtelierCloud/1.0 (${o.contact ?? WIKIMEDIA_DEFAULT_CONTACT})`
  const label = 'Wikimedia search'
  return {
    id: 'wikimedia',
    kind: 'real',
    keyless: true,
    async searchStock(input, ctx) {
      const video = input.kind === 'video'
      const url = new URL(`${base}/w/api.php`)
      const q = url.searchParams
      q.set('action', 'query')
      q.set('format', 'json')
      q.set('formatversion', '2')
      q.set('generator', 'search')
      q.set('gsrsearch', `${input.query} filetype:${video ? 'video' : 'bitmap'}`)
      q.set('gsrnamespace', '6')
      // many are dropped afterwards (licence, orientation, type)
      q.set('gsrlimit', String(Math.min(50, input.count * 6)))
      q.set('prop', 'imageinfo')
      q.set('iiprop', 'url|size|mime|mediatype|extmetadata')
      q.set('iiurlwidth', '1920')
      q.set('iiextmetadatafilter', 'LicenseShortName|Artist|AttributionRequired|ObjectName')
      ctx.progress(0.1)
      const res = await call(
        { label, url: url.toString(), secret: '', signal: ctx.signal, init: { method: 'GET', headers: { 'user-agent': userAgent, accept: 'application/json' } } },
        o
      )
      const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      // the API reports its own failures inside a 200 answer
      if (parsed.data.error) throw new Error(`${label}: the API refused the search (${parsed.data.error.code ?? 'error'})`)
      const pages = [...(parsed.data.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const candidates: Candidate[] = []
      for (const page of pages) {
        const info = page.imageinfo?.[0]
        if (!info?.width || !info.height) continue
        const licence = meta(info.extmetadata, 'LicenseShortName')
        if (!licenceUsable(licence)) continue
        if (orientationOf(info.width, info.height) !== input.orientation) continue
        const mimes = video ? VIDEO_MIMES : IMAGE_MIMES
        if (!info.mime || !(mimes as readonly string[]).includes(info.mime)) continue
        // a photo: the 1920-wide rendition when there is one (the original may be 30 MB); a video: the file itself
        const link = video ? info.url : (info.thumburl ?? info.url)
        if (!isCommonsFile(link)) continue
        const artist = meta(info.extmetadata, 'Artist') || 'Wikimedia Commons'
        const title = meta(info.extmetadata, 'ObjectName') || titleOf(page.title)
        const publicDomain = /^(public domain|pd|cc0|no restrictions)/i.test(licence)
        const result: Omit<StockResult, 'file'> = {
          id: `wikimedia-${page.title.replace(/^File:/i, '').replace(/[^\w.-]+/g, '_').slice(0, 120)}`,
          source: 'wikimedia',
          kind: input.kind,
          title,
          creator: artist.slice(0, 200),
          creatorUrl: null,
          pageUrl: info.descriptionurl ?? null,
          licence,
          attribution: `${title} by ${artist.slice(0, 120)}, ${licence}, via Wikimedia Commons`,
          attributionRequired: !publicDomain && meta(info.extmetadata, 'AttributionRequired').toLowerCase() !== 'false',
          width: info.thumburl && !video ? (info.width > 1920 ? 1920 : info.width) : info.width,
          height: info.thumburl && !video ? Math.round(((info.width > 1920 ? 1920 : info.width) * info.height) / info.width) : info.height,
          orientation: input.orientation,
          durationS: null
        }
        candidates.push({ result, url: link, mimes: video ? VIDEO_MIMES : IMAGE_MIMES })
      }
      // Commons' own relevance order is kept
      const { files, results } = await collect(candidates, input.count, 'Wikimedia download', ctx.signal, o, (f) => ctx.progress(0.1 + 0.9 * f), { 'user-agent': userAgent })
      ctx.progress(1)
      return { files, data: { query: input.query, kind: input.kind, orientation: input.orientation, provider: 'wikimedia', results }, costUsd: 0 }
    }
  }
}
