// Registers one contract route: auth by its level (in the route's onRequest hook, before any byte of the body is read:
// see bodies.ts), the body and query parsed with its zod schemas, and the answer checked against its response schema before it leaves (a mismatch is a server bug and answers 500, never a
// malformed body). This is how the server honours src/shared/cloud-api.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import type { CloudRoute } from '../../../src/shared/cloud-api.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import type { MachineIdentity } from '../machines/credentials.ts'
import { BodyGate, DEFAULT_BODY_LIMIT, declaredLength, discardSpooled, tooLarge } from './bodies.ts'

export interface Ctx<B, Q> {
  req: FastifyRequest
  reply: FastifyReply
  session: Session | null
  /** The team computer behind a `machine` route's credential. */
  machine: MachineIdentity | null
  body: B
  query: Q
  params: Record<string, string>
}

type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (typeof h !== 'string') return null
  const m = /^Bearer ([A-Za-z0-9_-]{8,200})$/.exec(h)
  return m ? (m[1] as string) : null
}

/** The session behind the request's bearer token; the rate limiter counts per account (per IP when signed out). */
export function sessionOf(cloud: Cloud, req: FastifyRequest): Session {
  const token = bearer(req)
  if (!token) throw new CloudError('unauthorized', 'a bearer token is required')
  return cloud.auth.session(token)
}

export class RateLimiter {
  private readonly perMinute: number
  private readonly now: () => number
  private window = 0
  private readonly counts = new Map<string, number>()
  constructor(perMinute: number, now: () => number) {
    this.perMinute = perMinute
    this.now = now
  }
  hit(key: string): void {
    const w = Math.floor(this.now() / 60_000)
    if (w !== this.window) {
      this.window = w
      this.counts.clear()
    }
    const n = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, n)
    if (n > this.perMinute) throw new CloudError('rate_limited', `more than ${this.perMinute} requests in a minute`, Math.max(1, Math.ceil(((w + 1) * 60_000 - this.now()) / 1000)))
  }
}

/** Who a request comes from, settled in its `onRequest` hook (before any byte of the body is read). */
export interface Caller {
  session: Session | null
  machine: MachineIdentity | null
}

const callers = new WeakMap<FastifyRequest, Caller>()
const gates = new WeakMap<FastifyInstance, BodyGate>()

/** The large-body budgets of a server (set once by buildServer; a bare app gets the defaults). */
export function bodyGateOf(app: FastifyInstance): BodyGate {
  let g = gates.get(app)
  if (!g) {
    g = new BodyGate()
    gates.set(app, g)
  }
  return g
}
export function setBodyGate(app: FastifyInstance, gate: BodyGate): void {
  gates.set(app, gate)
}

export interface RouteOptions {
  /** This route's body limit (the server's is 1 MiB). */
  bodyLimit?: number
  limiter?: RateLimiter
  /** Raw bytes (`application/octet-stream` only), streamed to a temporary file, never held in memory (bodies.ts). */
  upload?: boolean
  /** More refusals that need no body (the plan, the room left), run once the caller is known and before the body is read. */
  before?: (caller: Caller, req: FastifyRequest) => void
}

/** The credential check of a contract route: its session or machine, or the refusal. Refusals count against the address. */
function authenticate(cloud: Cloud, limiter: RateLimiter, def: CloudRoute, req: FastifyRequest): Caller {
  let session: Session | null = null
  let machine: MachineIdentity | null = null
  if (def.auth !== 'none') {
    try {
      if (def.auth === 'machine') machine = cloud.machines().credentials.verify(bearer(req))
      else session = sessionOf(cloud, req)
    } catch (err) {
      // Refused credentials count against the caller's address too, so a flood of bad tokens is limited.
      limiter.hit(`ip:${req.ip}`)
      throw err
    }
    if (def.auth === 'platformAdmin' && !session?.account.platformAdmin) throw new CloudError('forbidden', 'platform admins only')
  }
  return { session, machine }
}

export function route<R extends CloudRoute>(
  app: FastifyInstance,
  cloud: Cloud,
  limiter: RateLimiter,
  def: R,
  handler: (ctx: Ctx<Infer<R['body']>, Infer<R['query']>>) => unknown,
  opts: RouteOptions = {}
): void {
  const counter = opts.limiter ?? limiter
  const limit = opts.bodyLimit ?? DEFAULT_BODY_LIMIT
  const gate = bodyGateOf(app)
  const releases = new WeakMap<FastifyRequest, () => void>()
  const release = (req: FastifyRequest): void => {
    releases.get(req)?.()
    releases.delete(req)
  }
  app.route({
    method: def.method,
    url: def.path,
    bodyLimit: limit,
    config: { upload: opts.upload === true },
    // Everything that can refuse a request without its body runs here, before Fastify reads a byte of it: the
    // credential, the content type and declared length, the rate, the route's own checks, then the large-body budget.
    onRequest: async (req, reply) => {
      const declared = declaredLength(req)
      const hasBody = declared !== null ? declared > 0 : req.headers['transfer-encoding'] !== undefined
      let caller: Caller
      try {
        caller = authenticate(cloud, limiter, def, req)
      } catch (err) {
        // the body of a refused caller is never read: the connection closes after the answer
        if (hasBody) void reply.header('connection', 'close')
        throw err
      }
      callers.set(req, caller)
      const { session, machine } = caller
      if (opts.upload && hasBody && !/^application\/octet-stream\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
        void reply.header('connection', 'close')
        throw new CloudError('bad_request', 'the body must be the raw bytes (application/octet-stream)')
      }
      if (declared !== null && declared > limit) {
        void reply.header('connection', 'close')
        throw tooLarge(req.url)
      }
      // (as before: a body refused for its size or type does not count against the caller's rate)
      counter.hit(machine ? `mch:${machine.machineId}` : session ? `acc:${session.account.id}` : `ip:${req.ip}`)
      opts.before?.(caller, req)
      if (hasBody && (opts.upload || limit > DEFAULT_BODY_LIMIT)) {
        const team = machine?.teamId ?? session?.teamId ?? `ip:${req.ip}`
        releases.set(req, gate.admit(opts.upload ? 'upload' : 'buffered', team, declared ?? limit))
      }
    },
    onResponse: async (req) => {
      release(req)
      await discardSpooled(req.body)
    },
    onRequestAbort: async (req) => {
      release(req)
    },
    handler: async (req, reply) => {
      const caller = callers.get(req) ?? authenticate(cloud, limiter, def, req)
      try {
        const body = def.body ? parse(def.body, req.body ?? {}, 'body') : undefined
        const query = def.query ? parse(def.query, req.query ?? {}, 'query') : undefined
        const result = await handler({
          req,
          reply,
          session: caller.session,
          machine: caller.machine,
          body: body as Infer<R['body']>,
          query: query as Infer<R['query']>,
          params: (req.params ?? {}) as Record<string, string>
        })
        if (def.response === null || reply.sent) return reply
        const checked = def.response.safeParse(result)
        if (!checked.success) {
          req.log.error({ route: def.path, issue: checked.error.issues[0]?.path.join('.') }, 'response does not match the contract')
          throw new CloudError('internal', 'internal error')
        }
        return reply.send(checked.data)
      } finally {
        // a raw upload's temporary file never outlives its request (the store has its own copy by now)
        await discardSpooled(req.body)
      }
    }
  })
}

function parse(schema: z.ZodType, value: unknown, where: string): unknown {
  const r = schema.safeParse(value)
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new CloudError('bad_request', `${where}${issue?.path.length ? '.' + issue.path.join('.') : ''}: ${issue?.message ?? 'invalid'}`)
  }
  return r.data
}
