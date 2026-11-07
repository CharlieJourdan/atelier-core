// The team computer's link (docs/BRAIN-HEADLESS.md §7): its enrolment, the relay routes its brain polls with its own
// credential, and the routes the team's people call. A person only ever reaches a machine of their own team (another
// team's machine id answers the same 404 as an unknown one); every relayed call is audited by method name, never by
// its arguments. The arguments and answers pass through untouched: the Cloud does not read the team's data.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CLOUD_ROUTES, isRelayAdminMethod } from '../../../src/shared/cloud-api.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import type { TeamMachine } from '../machines/service.ts'
import type { RelayOutcome } from '../relay/audit.ts'
import { OFFLINE_MESSAGE, type BrainEnvelopeValue } from '../relay/hub.ts'
import { declaredLength } from './bodies.ts'
import { RateLimiter, route, sessionOf } from './route.ts'

const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}

/** The team's machine a call goes to: the one asked for (of this team only), else an online one, else the first. */
export function teamMachine(cloud: Cloud, teamId: string, machineId?: string): TeamMachine {
  const mine = cloud.machines().list(teamId)
  if (machineId !== undefined) {
    const m = mine.find((x) => x.id === machineId)
    if (!m) throw new CloudError('not_found', 'no such team computer')
    return m
  }
  if (mine.length === 0) throw new CloudError('not_found', 'this team has no team computer')
  return mine.find((m) => m.enrolled && cloud.relay.isOnline(m.id)) ?? mine.find((m) => m.enrolled) ?? (mine[0] as TeamMachine)
}

const outcomeOf = (e: BrainEnvelopeValue): RelayOutcome => (e.ok ? 'ok' : e.error.code === 'TOO_LARGE' ? 'too_large' : 'error')
const outcomeOfError = (err: unknown): RelayOutcome =>
  err instanceof CloudError ? (err.code === 'machine_offline' ? 'offline' : err.code === 'timeout' ? 'timeout' : err.code === 'rate_limited' ? 'busy' : 'error') : 'error'

export function registerRelayRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = CLOUD_ROUTES
  const hub = cloud.relay
  const lim = hub.limits
  const people = new RateLimiter(lim.rpcPerMinute, () => cloud.clock.now())
  const machines = new RateLimiter(lim.machinePerMinute, () => cloud.clock.now())

  route(app, cloud, limiter, r.machineEnrol, ({ body }) => {
    const { machine, credential } = cloud.machines().enrolWithCredential(body.enrolToken)
    hub.drop(machine.id)
    return { machineId: machine.id, teamId: machine.teamId, credential }
  })

  route(
    app,
    cloud,
    limiter,
    r.relayNext,
    async ({ machine, query, reply }) => {
      const requests = await hub.next(machine!.machineId, (query.wait ?? 25) * 1000, (cancel) => reply.raw.once('close', cancel))
      return { requests }
    },
    { limiter: machines }
  )
  route(
    app,
    cloud,
    limiter,
    r.relayReply,
    ({ machine, body }) => {
      if (!hub.reply(machine!.machineId, body.id, body.response as BrainEnvelopeValue)) throw new CloudError('not_found', 'no call waits for this answer')
      return { ok: true as const }
    },
    { limiter: machines, bodyLimit: lim.maxReplyBytes }
  )
  route(
    app,
    cloud,
    limiter,
    r.relayEvents,
    ({ machine, body, req }) => {
      // a byte budget per machine per minute: what it pushes is fanned out to every open stream of its team
      hub.chargeEvents(machine!.machineId, declaredLength(req) ?? Buffer.byteLength(JSON.stringify(body.events)))
      hub.publish(machine!.machineId, body.events)
      return { ok: true as const }
    },
    { limiter: machines, bodyLimit: 2 * 1024 * 1024 }
  )

  route(
    app,
    cloud,
    limiter,
    r.teamBrainRpc,
    async ({ session, body, req }) => {
      const s = must(session)
      // a plain member drives production on the team computer, never its keys, links, caps, prices or people (0076)
      if (isRelayAdminMethod(body.method) && cloud.accounts.membership(s.teamId, s.account.id).role === 'member') {
        throw new CloudError('forbidden', `only the owner or an admin of the team may call ${body.method}`)
      }
      const m = teamMachine(cloud, s.teamId, body.machineId)
      const started = Date.now()
      const audit = (outcome: RelayOutcome): void =>
        cloud.relayAudit.record({ teamId: s.teamId, accountId: s.account.id, machineId: m.id, method: body.method, outcome, ms: Date.now() - started })
      try {
        if (!m.enrolled) throw new CloudError('machine_offline', OFFLINE_MESSAGE)
        const envelope = await hub.call(m.id, body.method, body.args, declaredLength(req) ?? Buffer.byteLength(JSON.stringify(body.args)))
        audit(outcomeOf(envelope))
        return envelope
      } catch (err) {
        audit(outcomeOfError(err))
        throw err
      }
    },
    { limiter: people, bodyLimit: lim.maxRequestBytes }
  )

  // Server-sent events of the team's computer: `changed` and `stream`, as the headless brain's own `GET /events`. The
  // stream ends when the person's token stops being valid or the machine goes offline (the client reconnects).
  app.get(r.teamBrainEvents.path, async (req: FastifyRequest, reply) => {
    const s = sessionOf(cloud, req)
    people.hit(`acc:${s.account.id}`)
    const q = r.teamBrainEvents.query.safeParse(req.query ?? {})
    if (!q.success) throw new CloudError('bad_request', 'query.machineId: a machine id')
    const m = teamMachine(cloud, s.teamId, q.data.machineId)
    if (!m.enrolled || !hub.isOnline(m.id)) throw new CloudError('machine_offline', OFFLINE_MESSAGE)
    const raw = reply.raw
    let open = true
    const timer: { ping?: NodeJS.Timeout } = {}
    let unsubscribe: (() => void) | null = null
    /** `hard`: the client does not read: its buffer is dropped with the connection instead of waiting to be flushed. */
    const end = (hard = false): void => {
      if (!open) return
      open = false
      unsubscribe?.()
      if (timer.ping) clearInterval(timer.ping)
      if (hard) raw.destroy()
      else raw.end()
    }
    const write = (text: string): void => {
      if (!open) return
      // backpressure: a stream whose client lets more than maxStreamBufferBytes pile up is closed (it reconnects)
      if (raw.writableLength > lim.maxStreamBufferBytes) {
        end(true)
        return
      }
      raw.write(text)
    }
    // the hub ends the stream when the machine is dropped (revoked, deleted)
    unsubscribe = hub.subscribe(s.teamId, m.id, (e) => write(`event: ${e.event}\ndata: ${JSON.stringify(e.data ?? null)}\n\n`), () => end())
    if (!unsubscribe) throw new CloudError('rate_limited', 'too many open event streams for this team')
    reply.hijack()
    // hijack() skips Fastify's own headers: the CORS ones set by the onRequest hook are carried over by hand.
    const cors = Object.fromEntries(Object.entries(reply.getHeaders()).filter(([k]) => k.startsWith('access-control-') || k === 'vary'))
    raw.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no'
    })
    raw.write('retry: 3000\n: atelier\n\n')
    timer.ping = setInterval(() => {
      try {
        sessionOf(cloud, req)
        if (!hub.isOnline(m.id)) throw new CloudError('machine_offline', OFFLINE_MESSAGE)
        write(': ping\n\n')
      } catch {
        end()
      }
    }, lim.heartbeatMs)
    raw.on('close', () => end())
  })
}
