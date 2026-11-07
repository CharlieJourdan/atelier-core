// The Fastify app. Security choices (§4.11): loopback Host names only (no DNS rebinding through a browser), JSON, form
// or raw upload bodies only, a per-account (per-IP when signed out) rate limit, error answers that never echo internals,
// request logs without the Authorization header or link signatures, and every secret the vault handled masked.
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { Cloud } from '../cloud.ts'
import { CloudError, HTTP_STATUS } from '../errors.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BodyGate, DEFAULT_BODY_LIMIT, spoolParser, tooLarge, type BodyLimits } from './bodies.ts'
import { DEFAULT_REQUESTS_PER_MINUTE } from './limits.ts'
import { RateLimiter, setBodyGate } from './route.ts'
import { registerAdminRoutes } from './routes-admin.ts'
import { registerAdminCrmRoutes } from './routes-admin-crm.ts'
import { registerAdminFinanceRoutes } from './routes-admin-finance.ts'
import { registerBillingRoutes } from './routes-billing.ts'
import { registerInviteRoutes } from './routes-invites.ts'
import { registerBackupRoutes } from './routes-backups.ts'
import { registerMediaRoutes, type MediaRouteOptions } from './routes-media.ts'
import { registerKitRoutes } from './routes-kits.ts'
import { registerReleaseRoutes } from './routes-releases.ts'
import { registerMailRoutes } from './routes-mail.ts'
import { registerP5Routes } from './routes-p5.ts'
import { registerPageRoutes } from './routes-pages.ts'
import { registerProviderFileRoutes } from './routes-provider-files.ts'
import { registerRelayRoutes } from './routes-relay.ts'
import { registerUserRoutes, setPublicBase } from './routes-user.ts'

export const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

export interface ServerOptions {
  requestsPerMinute?: number
  /** Pino options or false; the dev server logs, tests do not. */
  logger?: boolean | Record<string, unknown>
  /** Refuse Host headers that are not a loopback name (on by default; light-my-request tests send `localhost:80`). */
  loopbackHostsOnly?: boolean
  /** Browser origins of the website allowed to call the API (CORS). */
  siteOrigins?: readonly string[]
  /** Host names accepted besides the loopback ones: the public name a reverse proxy (TLS) forwards, once hosted. */
  publicHosts?: readonly string[]
  /** The public https URL once hosted: device links, file links and the device form's origin check use it. */
  publicUrl?: string
  /** Budgets of large bodies (uploads at once, JSON bytes in flight), whole Cloud and per team. */
  bodies?: Partial<BodyLimits>
  /** Where raw uploads are streamed before they go to the file store (default: a folder under the OS temp folder). */
  uploadsDir?: string
  /** Media sourcing (`POST /v1/media/search`): tests inject a fake fetch and providers. */
  media?: MediaRouteOptions
}

/** The website in development and its local preview. A hosted site adds its own origin in the Cloud's config. */
export const DEFAULT_SITE_ORIGINS = ['http://localhost:5190', 'http://127.0.0.1:5190', 'http://localhost:4180', 'http://127.0.0.1:4180'] as const

/** Strips query strings that carry credentials (signed links, user codes) before a URL reaches a log line. */
export const scrubUrl = (url: string): string => url.replace(/([?&](?:sig|code)=)[^&]*/g, '$1•••')

export function hostAllowed(host: string | undefined, publicHosts: readonly string[] = []): boolean {
  if (!host) return false
  const name = (host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '')).toLowerCase()
  return LOOPBACK_NAMES.has(name) || publicHosts.some((h) => h.toLowerCase() === name)
}

export function buildServer(cloud: Cloud, o: ServerOptions = {}): FastifyInstance {
  const logger =
    o.logger === undefined || o.logger === false
      ? false
      : {
          ...(o.logger === true ? {} : o.logger),
          redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '•••' },
          serializers: {
            req: (req: { method: string; url: string }) => ({ method: req.method, url: cloud.vault.mask(scrubUrl(req.url)) })
          }
        }
  // Behind the reverse proxy (hosted), the client address comes from X-Forwarded-For set by the proxy on this machine:
  // without it every client would share one rate-limit bucket.
  const hosted = (o.publicHosts?.length ?? 0) > 0
  const app = Fastify({ logger, bodyLimit: DEFAULT_BODY_LIMIT, trustProxy: hosted ? ['127.0.0.1', '::1'] : false })
  setBodyGate(app, new BodyGate(o.bodies))
  setPublicBase(hosted && o.publicUrl ? o.publicUrl : null)
  const limiter = new RateLimiter(o.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE, () => cloud.clock.now())

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)))
  })

  // Raw uploads (kit files, `POST /v1/uploads`): streamed to a file, never buffered; refused unread on any other route.
  app.addContentTypeParser('application/octet-stream', spoolParser(o.uploadsDir ?? join(tmpdir(), 'atelier-cloud-incoming')))

  // The website (its own origin) calls the API from the browser: allowed origins only, no cookies (bearer tokens).
  const origins = new Set(o.siteOrigins ?? DEFAULT_SITE_ORIGINS)
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (typeof origin !== 'string' || !origins.has(origin)) return
    void reply.header('access-control-allow-origin', origin).header('vary', 'Origin')
    if (req.method === 'OPTIONS') {
      void reply
        .header('access-control-allow-methods', 'GET, POST')
        .header('access-control-allow-headers', 'authorization, content-type')
        .header('access-control-max-age', '600')
        .code(204)
        .send()
    }
  })

  if (o.loopbackHostsOnly !== false) {
    app.addHook('onRequest', async (req) => {
      if (!hostAllowed(req.headers.host, o.publicHosts)) throw new CloudError('forbidden', 'unexpected Host header')
    })
  }

  app.setErrorHandler((err: unknown, req, reply) => {
    let code: CloudError['code'] = 'internal'
    let message = 'internal error'
    if (err instanceof CloudError) {
      code = err.code
      message = cloud.vault.mask(err.message)
    } else if (err instanceof ZodError) {
      code = 'bad_request'
      message = err.issues[0]?.message ?? 'invalid request'
    } else if (typeof err === 'object' && err !== null && 'statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
      // Fastify's own refusals (bad JSON, body too large, unsupported media type).
      code = err.statusCode === 429 ? 'rate_limited' : err.statusCode === 404 ? 'not_found' : 'bad_request'
      // The brain relay, kit files and uploads answer an oversized body with a real 413 (the client shows « trop gros »).
      if (err.statusCode === 413) code = tooLarge(req.url).code
      message = err.statusCode === 413 ? 'body too large' : 'malformed request'
    } else {
      req.log.error({ err: cloud.vault.mask(err instanceof Error ? (err.stack ?? err.message) : String(err)) }, 'unhandled error')
    }
    // An oversized body is not read further: the connection closes after the answer.
    if (message === 'body too large') void reply.header('connection', 'close')
    // a busy refusal says when to come back (production-17: the app waits it out instead of giving up)
    if (err instanceof CloudError && err.retryAfterS !== undefined) void reply.header('retry-after', String(err.retryAfterS))
    void reply.code(HTTP_STATUS[code]).header('cache-control', 'no-store').send({ error: { code, message } })
  })
  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: { code: 'not_found', message: 'no such route' } })
  })

  registerUserRoutes(app, cloud, limiter)
  registerAdminRoutes(app, cloud, limiter)
  registerAdminCrmRoutes(app, cloud, limiter)
  registerAdminFinanceRoutes(app, cloud, limiter)
  registerPageRoutes(app, cloud, limiter)
  registerProviderFileRoutes(app, cloud, limiter)
  registerP5Routes(app, cloud, limiter)
  registerBillingRoutes(app, cloud, limiter, o.siteOrigins ?? DEFAULT_SITE_ORIGINS)
  registerRelayRoutes(app, cloud, limiter)
  registerKitRoutes(app, cloud, limiter)
  registerBackupRoutes(app, cloud, limiter)
  registerMediaRoutes(app, cloud, limiter, o.media)
  registerReleaseRoutes(app, cloud, limiter)
  registerMailRoutes(app, cloud, limiter)
  registerInviteRoutes(app, cloud, limiter)
  return app
}
