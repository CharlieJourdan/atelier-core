// Europeana (Search API v2): museums, libraries and archives of Europe in one index, among them the BnF (so Gallica's open
// material), the Bundesarchiv, the Swiss and Dutch archives. Free key (https://pro.europeana.eu/pages/get-api), vault name
// EUROPEANA_API_KEY; the published demo key `api2demo` works for tests and proofs but is shared and throttled.
//   GET https://api.europeana.eu/record/v2/search.json?wskey=KEY&query=…&qf=TYPE:IMAGE|VIDEO|SOUND&reusability=open&media=true&profile=rich
//   → items[]: { id, guid, title[], dcDescription[], dcCreator[], year[], edmPreview[], edmIsShownBy[], rights[], dataProvider[] }
// `reusability=open` keeps public domain, CC0, CC BY and CC BY-SA; the item's `rights` URL is still read and refused if it is not
// one of those. `edmIsShownBy` is the provider's file; for video and sound it is often a landing or player page, so those
// candidates are flagged for human review (their file URL is not always a direct file).
import { licenceFromRights } from '../legal.ts'
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, clip, getJson, num, rec, str, stripHtml, withEra } from './common.ts'

export const EUROPEANA_SEARCH = 'https://api.europeana.eu/record/v2/search.json'
const TYPE: Record<MediaKind, string> = { image: 'IMAGE', video: 'VIDEO', sfx: 'SOUND', music: 'SOUND' }
const first = (v: unknown): string => str(arr(v)[0])

function europeana(id: string, kind: MediaKind): SourcingProvider {
  return {
    id,
    label: 'Europeana',
    kinds: [kind],
    secret: 'EUROPEANA_API_KEY',
    demoKey: 'api2demo',
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(EUROPEANA_SEARCH)
      const p = url.searchParams
      p.set('wskey', ctx.key ?? '')
      p.set('query', withEra(q.query, q.era))
      p.set('qf', `TYPE:${TYPE[kind]}`)
      p.set('reusability', 'open')
      p.set('media', 'true')
      p.set('profile', 'rich')
      p.set('rows', String(Math.min(40, Math.max(8, q.want * 3))))
      const answer = await getJson(url.toString(), ctx)
      if (answer.success === false) throw new Error(`Europeana refused the search (${clip(str(answer.error), 100)})`)
      const items = arr(answer.items).map(rec)
      const out: MediaCandidate[] = []
      items.forEach((item, i) => {
        const licence = licenceFromRights(first(item.rights))
        const file = first(item.edmIsShownBy)
        if (!licence || !file.startsWith('http')) return
        const direct = kind === 'image' || /\.(mp4|webm|mp3|ogg|wav|m4a|jpe?g|png)(\?|$)/i.test(file)
        const guid = str(item.guid) || `https://www.europeana.eu/item${str(item.id)}`
        out.push(
          candidate({
            provider: id,
            label: 'Europeana',
            id: str(item.id),
            kind,
            title: first(item.title) || str(item.id),
            description: stripHtml(first(item.dcDescription)),
            creator: first(item.dcCreator) || first(item.dataProvider) || undefined,
            date: first(item.year) || undefined,
            pageUrl: guid.split('?')[0]!,
            previewUrl: first(item.edmPreview) || file,
            fileUrl: file,
            width: num(rec(item).width) || undefined,
            licence,
            review: direct ? 'clear' : 'human-review',
            ...(direct ? {} : { reviewReason: 'Europeana gives the provider’s page for this file, not always a direct download' }),
            rank: i,
            total: items.length
          })
        )
      })
      return out
    }
  }
}

export const europeanaImages = europeana('europeana', 'image')
export const europeanaVideo = europeana('europeana-video', 'video')
export const europeanaSounds = europeana('europeana-sfx', 'sfx')
