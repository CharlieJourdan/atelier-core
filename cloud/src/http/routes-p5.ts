// The lot P5 routes of CLOUD_ROUTES: raw uploads (deduplicated per team by content), unit estimates for the engine's
// Quoter, and RunPod's completion callback (no bearer: the signed URL is the credential).
import type { FastifyInstance } from 'fastify'
import { CLOUD_ROUTES, MAX_UPLOAD_BYTES, RunpodCallback, Sha256Hex } from '../../../src/shared/cloud-api.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { fxRate } from '../finance-settings.ts'
import { FAKE_ENGINES, engineLineCredits } from '../providers/engines.ts'
import { mimeFor, type StoredArtefact } from '../storage.ts'
import { isSpooled } from './bodies.ts'
import { route, type RateLimiter } from './route.ts'

const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}
const view = ({ id, name, mime, size, sha256, demo }: StoredArtefact) => ({ id, name, mime, size, sha256, demo })

export function registerP5Routes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = CLOUD_ROUTES

  route(app, cloud, limiter, r.uploadByHash, ({ session, params }) => {
    const s = must(session)
    const sha = Sha256Hex.safeParse(params.sha256)
    if (!sha.success) throw new CloudError('bad_request', 'sha256: lowercase hex SHA-256')
    const a = cloud.storage.findByHash(s.teamId, sha.data)
    if (!a) throw new CloudError('not_found', 'no file with this content')
    return view(a)
  })

  route(
    app,
    cloud,
    limiter,
    r.upload,
    async ({ session, query, req }) => {
      const s = must(session)
      // streamed to a temporary file and hashed on the way in (bodies.ts): never a whole buffer in memory
      const body = req.body
      if (!isSpooled(body)) throw new CloudError('bad_request', 'the body must be the raw bytes (application/octet-stream)')
      if (body.sha256 !== query.sha256) throw new CloudError('bad_request', 'the bytes do not match sha256')
      // Same team, same content: the stored file answers, nothing is written again.
      const known = cloud.storage.findByHash(s.teamId, query.sha256)
      if (known) return view(known)
      return view(await cloud.storage.putFile(s.teamId, { name: query.name, mime: mimeFor(query.name), path: body.path, size: body.size, sha256: body.sha256 }))
    },
    { bodyLimit: MAX_UPLOAD_BYTES, upload: true }
  )

  route(app, cloud, limiter, r.estimates, ({ session, body }) => {
    const s = must(session)
    const internal = cloud.accounts.team(s.teamId).internal
    // an engine may only be one declared for the item's usage, as in a quote (voice usages share the synthesize engines)
    for (const it of body.items) {
      if (it.engine !== undefined && !FAKE_ENGINES.some((e) => e.id === it.engine && e.usage === (it.usage === 'cloneVoice' || it.usage === 'designVoice' ? 'synthesize' : it.usage))) {
        throw new CloudError('bad_request', `items.${it.key}.engine: unknown engine ${it.engine} for ${it.usage}`)
      }
    }
    return cloud.pricing.estimate({
      internal,
      items: body.items,
      demo: (usage) => cloud.registry.resolve(usage).status === 'demo',
      engineCredits: (usage, engine, quantity, grid) => engineLineCredits(usage, engine, quantity, grid, internal, fxRate(cloud.db, () => new Date(cloud.clock.now()).toISOString()).eurPerUsd)
    })
  })

  // Not through `route()`: any defect of the signature must answer 403 before the query or body is even read.
  app.route({
    method: r.runpodWebhook.method,
    url: r.runpodWebhook.path,
    handler: async (req, reply) => {
      limiter.hit(`ip:${req.ip}`)
      const { jobId } = req.params as { jobId: string }
      const { sig } = (req.query ?? {}) as { sig?: unknown }
      if (typeof sig !== 'string' || !cloud.webhooks.verify(jobId, sig)) throw new CloudError('forbidden', 'invalid callback signature')
      const body = RunpodCallback.safeParse(req.body ?? {})
      if (!body.success) throw new CloudError('bad_request', 'body: a RunPod status object')
      cloud.webhooks.deliver(jobId, body.data)
      return reply.send(r.runpodWebhook.response.parse({ ok: true }))
    }
  })
}
