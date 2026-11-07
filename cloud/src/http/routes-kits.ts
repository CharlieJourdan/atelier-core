// The publication kit routes (src/shared/cloud-kit.ts): upload (start, files, complete) by a person's app or by a team
// computer's own credential, for teams with a plan or an enrolled team computer, within the plan's storage, and download (the texts and a short-lived link per file) for the team's people. The signed
// local link of a kit file (a Cloud with files on its own disk) is also here; with a bucket the links go to the bucket.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { MAX_UPLOAD_BYTES } from '../../../src/shared/cloud-api.ts'
import { KIT_FILE_PATH, KIT_ROUTES, VideoRef, type KitTexts } from '../../../src/shared/cloud-kit.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { declaredLength, isSpooled } from './bodies.ts'
import { baseUrlOf } from './routes-user.ts'
import { route, type Caller, type Ctx, type RateLimiter } from './route.ts'

const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}

const videoOf = (params: Record<string, string>): string => {
  const v = VideoRef.safeParse(params.id)
  if (!v.success) throw new CloudError('bad_request', 'id: a video id')
  return v.data
}

export function registerKitRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = KIT_ROUTES
  const kits = cloud.kits

  /** Who is calling, as the upload handlers need it: the team, and a name for the audit log. */
  const caller = (ctx: Ctx<unknown, unknown>): { teamId: string; by: string } =>
    ctx.machine ? { teamId: ctx.machine.teamId, by: `machine:${ctx.machine.machineId}` } : { teamId: must(ctx.session).teamId, by: `account:${must(ctx.session).account.id}` }

  const start = (ctx: Ctx<KitTexts, unknown>) => {
    const c = caller(ctx)
    return kits.start(c.teamId, videoOf(ctx.params), ctx.body, c.by)
  }
  const file = async (ctx: Ctx<unknown, { name: string; sha256: string }>) => {
    const c = caller(ctx)
    // streamed to a temporary file and hashed on the way in (bodies.ts), then to the store part by part
    const body = ctx.req.body
    if (!isSpooled(body)) throw new CloudError('bad_request', 'the body must be the raw bytes (application/octet-stream)')
    if (body.sha256 !== ctx.query.sha256) throw new CloudError('bad_request', 'the bytes do not match sha256')
    return kits.addFile(c.teamId, videoOf(ctx.params), ctx.params.kitId ?? '', { name: ctx.query.name, sha256: body.sha256, path: body.path, size: body.size })
  }
  const complete = (ctx: Ctx<unknown, unknown>) => {
    const c = caller(ctx)
    return kits.complete(c.teamId, videoOf(ctx.params), ctx.params.kitId ?? '', c.by)
  }

  // Refused before a byte of the body is read: a team without a plan nor an enrolled team computer, and (files) a
  // declared size that does not fit in the team's storage.
  const teamOf = (c: Caller): string => c.machine?.teamId ?? c.session?.teamId ?? ''
  const allowed = { before: (c: Caller) => void kits.requireAllowance(teamOf(c)) }
  const room = {
    bodyLimit: MAX_UPLOAD_BYTES,
    upload: true,
    before: (c: Caller, req: FastifyRequest) => {
      const params = req.params as { kitId?: string }
      const query = req.query as { name?: unknown }
      kits.checkFileRoom(teamOf(c), params.kitId ?? '', typeof query.name === 'string' ? query.name : '', declaredLength(req) ?? 0)
    }
  }
  route(app, cloud, limiter, r.kitStart, start, allowed)
  route(app, cloud, limiter, r.kitFile, file, room)
  route(app, cloud, limiter, r.kitComplete, complete, allowed)
  route(app, cloud, limiter, r.machineKitStart, start, allowed)
  route(app, cloud, limiter, r.machineKitFile, file, room)
  route(app, cloud, limiter, r.machineKitComplete, complete, allowed)

  route(app, cloud, limiter, r.kit, ({ session, params, req }) => {
    const teamId = must(session).teamId
    return kits.withLinks(kits.latest(teamId, videoOf(params)), teamId, baseUrlOf(req))
  })
  route(app, cloud, limiter, r.kits, ({ session }) => ({ kits: kits.list(must(session).teamId) }))

  // Not through `route()`: the signature is the credential and any defect answers before anything else is read.
  app.get(KIT_FILE_PATH, async (req, reply) => {
    limiter.hit(`ip:${req.ip}`)
    const { kitId, name } = req.params as { kitId: string; name: string }
    const q = req.query as { exp?: string; sig?: string }
    cloud.storage.verifyKit(kitId, name, q.exp, q.sig)
    const f = await kits.readFile(kitId, name)
    return reply
      .header('content-type', f.mime)
      .header('content-length', f.size)
      .header('content-disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(f.bytes)
  })
}
