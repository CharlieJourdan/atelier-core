// The app's releases (src/shared/cloud-releases.ts). Admin routes (platform admin only, the credential is checked before a
// byte of an installer is read): create a draft, upload its files, publish, withdraw, delete a draft. And the PUBLIC update
// feed electron-updater's "generic" provider reads: `latest.yml` / `latest-mac.yml` and the files next to it. The feed
// needs no login (an updater has none; the installers are not secret) and shows only published releases. A file is sent
// by redirect to a presigned link when the store is a bucket, else streamed from the data folder (with byte ranges, which the
// updater uses to download only what changed between two versions).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  RELEASE_FILE_NAME,
  RELEASE_ROUTES,
  ReleaseChannel,
  ReleaseFileQuery,
  ReleasePlatform,
  UPDATE_FEED_PATH,
  feedFileName
} from '../../../src/shared/cloud-releases.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { isSpooled } from './bodies.ts'
import { route, type Ctx, type RateLimiter } from './route.ts'

/** How long the redirect to the object store lives (the updater follows it at once). */
const DIRECT_LINK_TTL_S = 300

const actorOf = (ctx: Ctx<unknown, unknown>): string => {
  if (!ctx.session) throw new CloudError('unauthorized', 'a bearer token is required')
  return `account:${ctx.session.account.id}`
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` on a file of `size` bytes: the range, null for no header, 'bad' when it cannot be served. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'bad' {
  if (header === undefined) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'bad'
  let start: number
  let end: number
  if (m[1] === '') {
    const n = Number(m[2])
    if (n === 0) return 'bad'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return size === 0 || start >= size || start > end ? 'bad' : { start, end }
}

export function registerReleaseRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = RELEASE_ROUTES
  const releases = cloud.releases

  route(app, cloud, limiter, r.releaseCreate, (ctx) => releases.create(ctx.body, actorOf(ctx)))
  route(app, cloud, limiter, r.releaseList, () => ({ releases: releases.list(), latest: releases.latestAll() }))
  route(
    app,
    cloud,
    limiter,
    r.releaseFile,
    async (ctx) => {
      // streamed to a temporary file and hashed on the way in (bodies.ts); the SHA-512 is computed from that file
      const body = ctx.req.body
      if (!isSpooled(body)) throw new CloudError('bad_request', 'the body must be the raw bytes (application/octet-stream)')
      if (body.sha256 !== ctx.query.sha256) throw new CloudError('bad_request', 'the bytes do not match sha256')
      return releases.addFile(ctx.params.id ?? '', { name: ctx.query.name, path: body.path, size: body.size, sha256: body.sha256 })
    },
    {
      bodyLimit: releases.maxFileBytes,
      upload: true,
      // refused before a byte is read: an unknown or published release, a bad file name
      before: (_c, req) => {
        const id = (req.params as { id?: string }).id ?? ''
        if (releases.state(id) !== 'draft') throw new CloudError('conflict', 'this release is already published: files can no longer be added')
        const q = ReleaseFileQuery.safeParse(req.query)
        if (!q.success) throw new CloudError('bad_request', `query.${q.error.issues[0]?.path.join('.') ?? ''}: ${q.error.issues[0]?.message ?? 'invalid'}`)
      }
    }
  )
  route(app, cloud, limiter, r.releasePublish, (ctx) => releases.publish(ctx.params.id ?? '', actorOf(ctx)))
  route(app, cloud, limiter, r.releaseWithdraw, (ctx) => releases.withdraw(ctx.params.id ?? '', actorOf(ctx)))
  route(app, cloud, limiter, r.releaseDelete, async (ctx) => {
    await releases.remove(ctx.params.id ?? '', actorOf(ctx))
    return { ok: true as const }
  })

  // Public, outside `route()` like the signed kit links: no credential, rate limited by address, answers only what is published.
  app.get(UPDATE_FEED_PATH, async (req: FastifyRequest, reply: FastifyReply) => {
    limiter.hit(`ip:${req.ip}`)
    const params = req.params as { channel: string; platform: string; name: string }
    const channel = ReleaseChannel.safeParse(params.channel)
    const platform = ReleasePlatform.safeParse(params.platform)
    if (!channel.success || !platform.success) throw new CloudError('not_found', 'no such update feed')
    const name = params.name
    if (name === feedFileName(platform.data)) {
      const yml = releases.feed(channel.data, platform.data)
      if (!yml) throw new CloudError('not_found', 'nothing is published on this channel yet')
      return reply.header('content-type', 'text/yaml; charset=utf-8').header('cache-control', 'no-cache').header('x-content-type-options', 'nosniff').send(yml)
    }
    if (!RELEASE_FILE_NAME.test(name)) throw new CloudError('not_found', 'no such file')
    const file = releases.find(channel.data, platform.data, name)
    if (!file) throw new CloudError('not_found', 'no such file')
    const blobs = releases.blobs
    const direct = blobs.presignGet(file.key, { ttlS: DIRECT_LINK_TTL_S, filename: name, mime: 'application/octet-stream' })
    if (direct) return reply.header('cache-control', 'no-store').redirect(direct, 302)
    if (!(await blobs.has(file.key))) throw new CloudError('not_found', 'no such file')
    reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=300')
      .header('accept-ranges', 'bytes')
    const range = parseRange(req.headers.range, file.size)
    if (range === 'bad') return reply.code(416).header('content-range', `bytes */${file.size}`).send()
    if (range) {
      reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${file.size}`).header('content-length', range.end - range.start + 1)
      return reply.send(blobs.readStream ? blobs.readStream(file.key, range) : (await blobs.get(file.key)).subarray(range.start, range.end + 1))
    }
    reply.header('content-length', file.size)
    return reply.send(blobs.readStream ? blobs.readStream(file.key) : await blobs.get(file.key))
  })
}
