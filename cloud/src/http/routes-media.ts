// `POST /v1/media/search` (src/shared/cloud-media.ts): the sourcing bricks of src/engine/sourcing run in the Cloud, which holds the
// free keys of the stock, archive and sound libraries in its vault. Free sources only: a paid provider and the web-excerpt provider
// (yt-dlp, human review) are not reachable here, nothing is downloaded and nothing is billed. Each vault read is audited as
// `adapter:media-search`. Answers are cached 24 hours in memory (Pixabay's terms ask for it) and shared by every team.
import type { FastifyInstance } from 'fastify'
import { isYoutubeUrl } from '../../../src/shared/cloud-api.ts'
import { MEDIA_ROUTES } from '../../../src/shared/cloud-media.ts'
import { MemoryCache, type SearchCache } from '../../../src/engine/sourcing/cache.ts'
import { PROVIDERS } from '../../../src/engine/sourcing/catalog.ts'
import { searchMedia } from '../../../src/engine/sourcing/search.ts'
import { geminiWatch, WatchError } from '../../../src/engine/sourcing/watch.ts'
import type { SourcingProvider } from '../../../src/engine/sourcing/types.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { DEFAULT_MEDIA_SEARCHES_PER_MINUTE } from './limits.ts'
import { route, RateLimiter } from './route.ts'

export interface MediaRouteOptions {
  /** Tests: the fetch every provider uses (never the network in a test). */
  fetch?: typeof fetch
  /** Tests: the providers to use instead of the catalog's free ones. */
  providers?: readonly SourcingProvider[]
  cache?: SearchCache
  /** Tests: the Gemini model name and base URL (a fake server) for `POST /v1/media/watch`. */
  watchModel?: string
  watchBaseUrl?: string
  /** Searches a team may ask per minute (default 120; vps-rendu's scale test raises it to see past it). */
  perMinute?: number
}

const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}

export function registerMediaRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter, o: MediaRouteOptions = {}): void {
  const free = (o.providers ?? PROVIDERS).filter((p) => !p.paid && !p.optIn)
  const cache = o.cache ?? new MemoryCache()
  // each search fans out to a dozen free APIs: a team may ask 120 a minute (ten productions at once, decision 0088)
  const own = new RateLimiter(o.perMinute ?? DEFAULT_MEDIA_SEARCHES_PER_MINUTE, () => cloud.clock.now())
  route(
    app,
    cloud,
    limiter,
    MEDIA_ROUTES.mediaSearch,
    async ({ session, body }) => {
      must(session)
      const r = await searchMedia(
        body.query,
        {
          kinds: body.kinds,
          count: body.count,
          ...(body.orientation ? { orientation: body.orientation } : {}),
          ...(body.era ? { era: body.era } : {}),
          ...(body.variants ? { variants: body.variants } : {}),
          ...(body.minDurationS !== undefined ? { minDurationS: body.minDurationS } : {}),
          ...(body.maxDurationS !== undefined ? { maxDurationS: body.maxDurationS } : {}),
          ...(body.providers ? { providers: body.providers } : {}),
          cache
        },
        {
          providers: free,
          secrets: (name) => (cloud.vault.has(name) ? cloud.vault.readForAdapter(name, 'media-search') : undefined),
          ...(o.fetch ? { fetch: o.fetch } : {})
        }
      )
      return r
    },
    { limiter: own }
  )

  // Watching costs real money: refused unless paidCalls is on, the key is in the vault and the team is internal / test (decision 0069).
  route(
    app,
    cloud,
    limiter,
    MEDIA_ROUTES.mediaWatch,
    async ({ session, body }) => {
      const s = must(session)
      if (!isYoutubeUrl(body.url)) throw new CloudError('bad_request', 'url: only https youtube.com / youtu.be links')
      const team = cloud.accounts.team(s.teamId)
      if (!team.internal && !team.test) throw new CloudError('forbidden', 'watching a video costs money and is not billed yet: internal and test teams only')
      if (!cloud.registry.paidCalls) throw new CloudError('forbidden', 'paid calls are off on this Cloud (config.json paidCalls)')
      if (!cloud.vault.has('GEMINI_API_KEY')) throw new CloudError('not_found', 'no GEMINI_API_KEY in the vault (npm run cloud -- vault set GEMINI_API_KEY)')
      try {
        const r = await geminiWatch(
          { url: body.url, startS: body.startS, endS: body.endS, ...(body.focus ? { focus: body.focus } : {}), ...(body.dense ? { dense: true } : {}), ...(body.fps ? { fps: body.fps } : {}) },
          { apiKey: cloud.vault.readForAdapter('GEMINI_API_KEY', 'media-watch'), ...(o.watchModel ? { model: o.watchModel } : {}), ...(o.watchBaseUrl ? { baseUrl: o.watchBaseUrl } : {}), ...(o.fetch ? { fetch: o.fetch } : {}) }
        )
        return { shots: r.shots, model: r.model, costUsd: r.costUsd, ms: r.ms, rangeStartS: r.rangeStartS, rangeEndS: r.rangeEndS, ...(body.dense ? { dense: true } : {}), ...(r.usage ? { usage: r.usage } : {}) }
      } catch (e) {
        if (e instanceof WatchError) throw new CloudError(e.retryable ? 'timeout' : 'bad_request', cloud.vault.mask(e.message))
        throw e
      }
    },
    { limiter: own }
  )
}
