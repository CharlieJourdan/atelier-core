// `GET /provider-files/:job/:id?exp=…&sig=…` (production-10): how a provider fetches a file of a running job (the voice audio, the
// presenter's portrait, a start still) when the Cloud keeps its files in a local folder, as the beta does (no bucket). The link
// is bound to the job and the file, signed with the Cloud's key, and expires in minutes; it is served only while the job runs
// and only for a file of the job's team. One file per link: there is no listing. A bucket would give presigned links instead.
import type { FastifyInstance } from 'fastify'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import type { RateLimiter } from './route.ts'

export const PROVIDER_FILE_PATH = '/provider-files/:job/:id'

export function registerProviderFileRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  app.get(PROVIDER_FILE_PATH, async (req, reply) => {
    limiter.hit(`ip:${req.ip}`)
    const { job, id } = req.params as { job: string; id: string }
    const q = req.query as { exp?: string; sig?: string }
    const a = cloud.storage.verifyJob(job, id, q.exp, q.sig)
    const row = cloud.db.prepare('SELECT state, team_id FROM jobs WHERE id = ?').get(job) as { state: string; team_id: string } | undefined
    if (!row || row.state !== 'running' || row.team_id !== a.teamId) throw new CloudError('forbidden', 'invalid link')
    const safeName = a.name.replace(/[^A-Za-z0-9._-]/g, '_')
    return reply
      .header('content-type', a.mime)
      .header('content-length', a.size)
      .header('content-disposition', `inline; filename="${safeName}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(await cloud.storage.read(a))
  })
}
