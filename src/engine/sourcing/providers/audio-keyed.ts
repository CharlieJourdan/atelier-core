// Sound libraries with a free key.
//   Freesound  GET https://freesound.org/apiv2/search/text/?query=&filter=license:("Creative Commons 0" OR "Attribution")&fields=…&token=KEY
//              Free token (https://freesound.org/apiv/apply/), vault name FREESOUND_API_KEY. The filter keeps CC0 and CC BY (never the
//              NonCommercial and Sampling+ licences). `previews` are public mp3/ogg renditions that need no OAuth; the original
//              file would. Rate limit: 60 requests a minute / 2000 a day by default (UNVERIFIED on the official page).
//   Jamendo    GET https://api.jamendo.com/v3.0/tracks/?client_id=KEY&search=&include=licenses&audioformat=mp32
//              Free client id (https://devportal.jamendo.com), vault name JAMENDO_CLIENT_ID. Tracks are CC, but most are NC: the licence
//              URL is read and NC / ND tracks are dropped. Jamendo's API terms limit the free API to non-commercial apps (commercial
//              use goes through Jamendo Licensing): every Jamendo track is therefore flagged for human review. Music is off by default.
import { licenceFromLink } from '../legal.ts'
import type { MediaCandidate, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, clip, getJson, num, rec, str } from './common.ts'

export const FREESOUND_SEARCH = 'https://freesound.org/apiv2/search/text/'
export const JAMENDO_TRACKS = 'https://api.jamendo.com/v3.0/tracks/'

export const freesound: SourcingProvider = {
  id: 'freesound',
  label: 'Freesound',
  kinds: ['sfx', 'music'],
  secret: 'FREESOUND_API_KEY',
  async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
    const url = new URL(FREESOUND_SEARCH)
    const p = url.searchParams
    p.set('query', q.query)
    const dur = `duration:[${q.minDurationS ?? 0} TO ${q.maxDurationS ?? (q.kind === 'sfx' ? 30 : 600)}]`
    p.set('filter', `license:("Creative Commons 0" OR "Attribution") ${dur}`)
    p.set('fields', 'id,name,description,tags,username,license,duration,previews,url,created')
    p.set('page_size', String(Math.min(50, Math.max(6, q.want * 3))))
    p.set('token', ctx.key ?? '')
    const answer = await getJson(url.toString(), ctx)
    if (answer.detail) throw new Error(`Freesound refused the search (${clip(str(answer.detail), 80)})`)
    const results = arr(answer.results).map(rec)
    const out: MediaCandidate[] = []
    results.forEach((r, i) => {
      const licence = licenceFromLink(str(r.license))
      const previews = rec(r.previews)
      const file = str(previews['preview-hq-mp3']) || str(previews['preview-lq-mp3'])
      if (!licence || !file) return
      out.push(
        candidate({
          provider: 'freesound', label: 'Freesound', id: String(num(r.id)), kind: q.kind, title: str(r.name), description: str(r.description),
          creator: str(r.username) || undefined, date: str(r.created).slice(0, 4) || undefined, tags: arr(r.tags).map(str),
          pageUrl: str(r.url), previewUrl: str(previews['preview-lq-mp3']) || file, fileUrl: file, mime: 'audio/mpeg', durationS: num(r.duration),
          licence, rank: i, total: results.length
        })
      )
    })
    return out
  }
}

export const jamendo: SourcingProvider = {
  id: 'jamendo',
  label: 'Jamendo',
  kinds: ['music'],
  secret: 'JAMENDO_CLIENT_ID',
  async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
    const url = new URL(JAMENDO_TRACKS)
    const p = url.searchParams
    p.set('client_id', ctx.key ?? '')
    p.set('format', 'json')
    p.set('search', q.query)
    p.set('include', 'licenses')
    p.set('audioformat', 'mp32')
    p.set('limit', String(Math.min(50, Math.max(6, q.want * 3))))
    const answer = await getJson(url.toString(), ctx)
    const header = rec(answer.headers)
    if (str(header.status) === 'failed') throw new Error(`Jamendo refused the search (${clip(str(header.error_message), 100)})`)
    const results = arr(answer.results).map(rec)
    const out: MediaCandidate[] = []
    results.forEach((r, i) => {
      const licence = licenceFromLink(str(r.license_ccurl))
      if (!licence || !str(r.audio)) return
      out.push(
        candidate({
          provider: 'jamendo', label: 'Jamendo', id: str(r.id), kind: 'music', title: str(r.name), creator: str(r.artist_name) || undefined,
          date: str(r.releasedate).slice(0, 4) || undefined, pageUrl: str(r.shareurl), previewUrl: str(r.audio), fileUrl: str(r.audiodownload) || str(r.audio),
          mime: 'audio/mpeg', durationS: num(r.duration), licence, review: 'human-review',
          reviewReason: 'Jamendo’s free API is for non-commercial apps: commercial use of a track needs Jamendo Licensing', rank: i, total: results.length
        })
      )
    })
    return out
  }
}
