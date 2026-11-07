// Smithsonian Open Access (api.si.edu, api.data.gov key): 11 million records, CC0 for the open ones. Free key
// (https://api.data.gov/signup/), vault name SMITHSONIAN_API_KEY; `DEMO_KEY` works for tests (30 requests an hour per IP).
//   GET https://api.si.edu/openaccess/api/v1.0/search?q=<words> AND online_media_type:"Images"&api_key=KEY&rows=N
//   → response.rows[]: { id, title, content { descriptiveNonRepeating { record_link, data_source,
//     online_media { media [{ type, content, thumbnail, usage { access } }] } }, freetext { date[], name[], notes[] } } }
// Only media whose `usage.access` is « CC0 » is kept.
import type { MediaCandidate, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, clip, getJson, plain, rec, str, withEra } from './common.ts'

export const SMITHSONIAN_SEARCH = 'https://api.si.edu/openaccess/api/v1.0/search'
const text = (v: unknown): string => arr(v).map((x) => str(rec(x).content)).filter(Boolean)[0] ?? ''

export const smithsonianImages: SourcingProvider = {
  id: 'smithsonian',
  label: 'Smithsonian Open Access',
  kinds: ['image'],
  secret: 'SMITHSONIAN_API_KEY',
  demoKey: 'DEMO_KEY',
  async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
    const url = new URL(SMITHSONIAN_SEARCH)
    url.searchParams.set('q', `${plain(withEra(q.query, q.era))} AND online_media_type:"Images"`)
    url.searchParams.set('api_key', ctx.key ?? '')
    url.searchParams.set('rows', String(Math.min(40, Math.max(8, q.want * 3))))
    const answer = await getJson(url.toString(), ctx)
    if (answer.error) throw new Error(`Smithsonian refused the search (${clip(str(rec(answer.error).message ?? answer.error), 100)})`)
    const rows = arr(rec(answer.response).rows).map(rec)
    const out: MediaCandidate[] = []
    rows.forEach((row, i) => {
      const content = rec(row.content)
      const desc = rec(content.descriptiveNonRepeating)
      const media = arr(rec(desc.online_media).media)
        .map(rec)
        .find((m) => /^images?$/i.test(str(m.type)) && str(rec(m.usage).access).toUpperCase() === 'CC0' && str(m.content).startsWith('http'))
      if (!media) return
      const free = rec(content.freetext)
      const file = str(media.content)
      out.push(
        candidate({
          provider: 'smithsonian',
          label: 'Smithsonian Open Access',
          id: str(row.id),
          kind: 'image',
          title: str(row.title),
          description: text(free.notes),
          creator: text(free.name) || str(desc.data_source) || undefined,
          date: text(free.date) || undefined,
          pageUrl: str(desc.record_link) || `https://www.si.edu/object/${str(row.id)}`,
          previewUrl: str(media.thumbnail) || file,
          fileUrl: file,
          licence: { short: 'CC0', status: 'cc0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false },
          rank: i,
          total: rows.length
        })
      )
    })
    return out
  }
}
