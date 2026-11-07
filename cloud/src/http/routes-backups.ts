// The team computer's backup routes (src/shared/cloud-backup.ts): upload, list and download with the machine's own
// credential, scoped to its team. An oversized declared body or a team past its daily count is refused before a byte of
// the body is read.
import type { FastifyInstance } from 'fastify'
import { BACKUP_ID, BACKUP_ROUTES, MAX_BACKUP_BYTES } from '../../../src/shared/cloud-backup.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import type { MachineIdentity } from '../machines/credentials.ts'
import { declaredLength, isSpooled } from './bodies.ts'
import { route, type Caller, type RateLimiter } from './route.ts'

const must = (m: MachineIdentity | null): MachineIdentity => {
  if (!m) throw new CloudError('unauthorized', 'a machine credential is required')
  return m
}

export function registerBackupRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = BACKUP_ROUTES
  const backups = cloud.backups

  route(
    app,
    cloud,
    limiter,
    r.machineBackupUpload,
    async ({ machine, req, query }) => {
      const m = must(machine)
      const body = req.body
      if (!isSpooled(body)) throw new CloudError('bad_request', 'the body must be the raw bytes (application/octet-stream)')
      if (body.sha256 !== query.sha256) throw new CloudError('bad_request', 'the bytes do not match sha256')
      return backups.add(m.teamId, m.machineId, body)
    },
    {
      bodyLimit: MAX_BACKUP_BYTES,
      upload: true,
      before: (c: Caller, req) => backups.checkUpload(must(c.machine).teamId, declaredLength(req))
    }
  )
  route(app, cloud, limiter, r.machineBackups, ({ machine }) => ({ backups: backups.list(must(machine).teamId) }))
  route(app, cloud, limiter, r.machineBackupGet, async ({ machine, params, reply }) => {
    const id = params.id ?? ''
    if (!BACKUP_ID.test(id)) throw new CloudError('not_found', 'no such backup')
    const { backup, body } = await backups.read(must(machine).teamId, id)
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', backup.size)
      .header('x-backup-sha256', backup.sha256)
      .header('cache-control', 'private, no-store')
      .send(body)
  })
}
