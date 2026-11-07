// The user routes of CLOUD_ROUTES (§4.2): sign-in, account and team, catalog, quotes, jobs and their event stream,
// files, wallet, support.
import { downEngines } from '../key-health.ts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CLOUD_ROUTES, JobEvent, SIGNED_LINK_TTL_S, TERMINAL_JOB_STATES, USAGES, USAGE_INPUTS, type Usage } from '../../../src/shared/cloud-api.ts'
import { ENGINES_ROUTE } from '../../../src/shared/cloud-engines.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { FAKE_ENGINES, engineLineCredits, publishEngines, withHeygenPlan } from '../providers/engines.ts'
import { fxRate } from '../finance-settings.ts'
import { measureUsage } from '../providers/fakes.ts'
import { engineOf } from '../providers/registry.ts'
import { isMinimaxAdapter, minimaxRefusal } from '../../../src/shared/voice-exception.ts'
import { WAV_HEAD_BYTES, wavSeconds } from '../media-duration.ts'
import { listVoices } from '../voices.ts'
import { capWindows } from '../wallet.ts'
import { route, sessionOf, type RateLimiter } from './route.ts'

const MODEL_LABELS: Record<Usage, string> = {
  synthesize: 'Voix',
  generateImage: 'Images',
  generateVideo: 'Vidéo générée',
  talkingAvatar: 'Avatar parlant',
  channelData: 'Données de chaîne',
  analyseVideo: 'Analyse vidéo',
  submitGpuJob: 'Calcul GPU',
  searchStock: 'Banque d’images et de vidéos',
  cloneVoice: 'Clonage de voix',
  designVoice: 'Création de voix'
}

/** The base URL handed out (device verification, file links): the configured public https URL once hosted behind a
 *  proxy, else the address the request came to (the loopback in development). */
let publicBase: string | null = null
export function setPublicBase(url: string | null): void {
  publicBase = url ? url.replace(/\/+$/, '') : null
}
export const baseUrlOf = (req: FastifyRequest): string => publicBase ?? `http://${req.headers.host ?? '127.0.0.1'}`
const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}

export function memberView(cloud: Cloud, teamId: string, accountId: string) {
  const m = cloud.accounts.membership(teamId, accountId)
  const a = cloud.accounts.account(accountId)
  const { dayStart, monthStart } = capWindows(cloud.clock.now())
  return {
    accountId,
    email: a.email,
    name: a.name,
    role: m.role,
    caps: { dailyCredits: m.dailyCap, monthlyCredits: m.monthlyCap },
    spentToday: cloud.wallet.spentSince(teamId, accountId, dayStart),
    spentThisMonth: cloud.wallet.spentSince(teamId, accountId, monthStart)
  }
}

export function registerUserRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = CLOUD_ROUTES

  route(app, cloud, limiter, r.deviceStart, ({ body, req }) =>
    cloud.auth.startDevice({ codeChallenge: body.codeChallenge, deviceName: body.deviceName, baseUrl: baseUrlOf(req) })
  )
  route(app, cloud, limiter, r.devicePoll, ({ body }) => cloud.auth.poll(body))
  route(app, cloud, limiter, r.refresh, ({ body }) => cloud.auth.refresh(body.refreshToken))
  route(app, cloud, limiter, r.testBrain, ({ body }) => cloud.testTeams.exchange(body.key, body.deviceName))
  route(app, cloud, limiter, r.signup, async ({ body }) => {
    if (cloud.accounts.accountByEmail(body.email)) throw new CloudError('conflict', 'an account already uses this e-mail address')
    // a sign-up from the website is unverified until the link of the e-mail is used (paying and paid work wait for it)
    const { account } = cloud.accounts.createAccount({ email: body.email, name: body.name, password: body.password, verified: false, ...(body.lang ? { lang: body.lang } : {}), actor: 'signup' })
    cloud.emailFlows.sendVerification(account.id)
    return cloud.auth.passwordLogin({ email: body.email, password: body.password, deviceName: 'Site Atelier' })
  })
  route(app, cloud, limiter, r.passwordLogin, ({ body }) => cloud.auth.passwordLogin({ email: body.email, password: body.password, deviceName: 'Site Atelier' }))
  route(app, cloud, limiter, r.blueprint, () => {
    const current = cloud.blueprints.current()
    if (!current) throw new CloudError('not_found', 'no blueprint published yet')
    return current
  })
  route(app, cloud, limiter, r.teamMachines, ({ session }) => {
    const machines = cloud.machines()
    return {
      provider: machines.providerKind,
      machines: machines.list(must(session).teamId).map((m) => ({
        id: m.id,
        plan: m.plan,
        serverType: m.serverType,
        location: m.location,
        status: m.status,
        demo: m.provider === 'fake',
        enrolled: m.enrolled,
        online: m.enrolled && cloud.relay.isOnline(m.id)
      }))
    }
  })
  route(app, cloud, limiter, r.logout, ({ session }) => {
    cloud.auth.logout(must(session))
    return { ok: true }
  })
  route(app, cloud, limiter, r.devices, ({ session }) => {
    const s = must(session)
    return { devices: cloud.auth.devices(s.account.id, s.deviceId) }
  })
  route(app, cloud, limiter, r.revokeDevice, ({ session, params }) => {
    const s = must(session)
    cloud.auth.revokeDevice(params.id ?? '', { accountId: s.account.id, platformAdmin: false })
    return { ok: true }
  })

  route(app, cloud, limiter, r.me, ({ session }) => {
    const s = must(session)
    const m = cloud.accounts.membership(s.teamId, s.account.id)
    const w = cloud.wallet.state(s.teamId)
    return {
      account: s.account,
      team: m.team,
      role: m.role,
      caps: { dailyCredits: m.dailyCap, monthlyCredits: m.monthlyCap },
      wallet: { balance: w.balance, held: w.held, available: w.available }
    }
  })
  route(app, cloud, limiter, r.members, ({ session }) => {
    const s = must(session)
    const role = cloud.accounts.membership(s.teamId, s.account.id).role
    const ids = role === 'member' ? [s.account.id] : cloud.accounts.members(s.teamId).map((m) => m.id)
    return { members: ids.map((id) => memberView(cloud, s.teamId, id)) }
  })
  route(app, cloud, limiter, r.setCaps, ({ session, params, body }) => {
    const s = must(session)
    const accountId = params.accountId ?? ''
    cloud.accounts.setCaps({ teamId: s.teamId, byAccountId: s.account.id, accountId, dailyCap: body.dailyCredits, monthlyCap: body.monthlyCredits })
    return memberView(cloud, s.teamId, accountId)
  })

  route(app, cloud, limiter, r.catalog, ({ session }) => ({
    paidCalls: cloud.registry.paidCalls,
    // issue #88: a usage is real when its provider or one of its enabled engines would run for real
    providers: USAGES.map((usage) => {
      const res = cloud.registry.served(usage)
      return { usage, provider: res.adapter.id, status: res.status, reason: res.reason }
    }),
    voices: listVoices(cloud.db, must(session).teamId),
    models: USAGES.map((usage) => {
      const res = cloud.registry.served(usage)
      return { id: res.adapter.id, usage, label: MODEL_LABELS[usage], demo: res.status === 'demo' }
    })
  }))

  // The engines registry (decision 0021): the declarations, who serves each now, and their price on the current grid.
  route(app, cloud, limiter, ENGINES_ROUTE, () => ({
    engines: publishEngines(withHeygenPlan(FAKE_ENGINES, cloud.heygenPlan), cloud.registry, { ...cloud.pricing.current(), priceMultiplier: cloud.pricing.multiplier() }, downEngines(cloud.providerAlerts))
  }))

  route(app, cloud, limiter, r.createQuote, async ({ session, body }) => {
    const s = must(session)
    const parsed = USAGE_INPUTS[body.usage].safeParse(body.input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new CloudError('bad_request', `input${issue?.path.length ? '.' + issue.path.join('.') : ''}: ${issue?.message ?? 'invalid'}`)
    }
    // An input that names a stored file may only name one of this team's files (a voice, a portrait, a start still, references).
    const data = parsed.data as { audioArtefactId?: string; portraitArtefactId?: string; imageArtefactId?: string; referenceArtefactIds?: string[] }
    for (const id of [data.audioArtefactId, data.portraitArtefactId, data.imageArtefactId, ...(data.referenceArtefactIds ?? [])]) if (id !== undefined) cloud.storage.forTeam(s.teamId, id)
    // a talking avatar is billed on the whole voice it speaks: its quote may never declare fewer seconds than the file lasts (0076)
    if (body.usage === 'talkingAvatar' && data.audioArtefactId !== undefined) {
      const audio = cloud.storage.forTeam(s.teamId, data.audioArtefactId)
      const lasts = wavSeconds(await cloud.storage.head(audio, WAV_HEAD_BYTES), audio.size)
      if (lasts === null) throw new CloudError('bad_request', 'input.audioArtefactId: the voice of a talking avatar must be a PCM WAV file')
      const declared = (parsed.data as { seconds: number }).seconds
      if (lasts > declared + 1) throw new CloudError('bad_request', `input.seconds: the voice lasts ${Math.ceil(lasts)} s, more than the ${declared} s declared`)
    }
    // an input that names an engine may only name a declared engine of its usage (decisions 0029, 0034, 0035): a voice engine
    // for the voice usages, a presenter engine for a talking avatar, a still or clip engine for its generation
    const engine = engineOf(parsed.data)
    const engineUsage = body.usage === 'cloneVoice' || body.usage === 'designVoice' ? 'synthesize' : body.usage
    if (engine !== null && !FAKE_ENGINES.some((e) => e.id === engine && e.usage === engineUsage)) {
      const family = engineUsage === 'synthesize' ? 'voice ' : engineUsage === 'talkingAvatar' ? 'presenter ' : ''
      throw new CloudError('bad_request', `input.engine: unknown ${family}engine ${engine} for ${body.usage}`)
    }
    // the one MiniMax exception (decision 0101): a REAL MiniMax adapter serves only Charlie's three avatar channels' voices
    const served = cloud.registry.resolveFor(body.usage, parsed.data)
    const refusal = served.status === 'real' && isMinimaxAdapter(served.adapter.id) ? minimaxRefusal(body.usage, parsed.data) : null
    if (refusal !== null) throw new CloudError('forbidden', refusal)
    const team = cloud.accounts.team(s.teamId)
    return cloud.pricing.quote({
      teamId: s.teamId,
      accountId: s.account.id,
      internal: team.internal,
      usage: body.usage,
      input: parsed.data,
      measure: measureUsage(body.usage, parsed.data as never),
      demo: cloud.registry.resolveFor(body.usage, parsed.data).status === 'demo',
      // the hold of the job is the quote: priced on the engine the input names, not on the grid line's worst case (#89)
      ...(engine !== null ? { engineCredits: ({ quantity }: { quantity: number }, grid: Parameters<typeof engineLineCredits>[3]) => engineLineCredits(body.usage, engine, quantity, grid, team.internal, fxRate(cloud.db, () => new Date(cloud.clock.now()).toISOString()).eurPerUsd) } : {})
    })
  })

  route(app, cloud, limiter, r.createJob, ({ session, body }) => {
    const s = must(session)
    cloud.accounts.requireVerified(s.account.id)
    return cloud.jobs.create({ teamId: s.teamId, accountId: s.account.id, quoteId: body.quoteId, idempotencyKey: body.idempotencyKey, ...(body.real ? { real: true } : {}) })
  })
  route(app, cloud, limiter, r.job, ({ session, params }) => cloud.jobs.get(must(session).teamId, params.id ?? ''))
  route(app, cloud, limiter, r.cancelJob, ({ session, params }) => cloud.jobs.cancel(must(session).teamId, params.id ?? ''))

  // Server-sent events: the backlog after `Last-Event-ID` (or ?after=), then live events; the stream ends after the
  // terminal event. Each `data:` line is a JobEvent of the contract.
  app.get(r.jobEvents.path, async (req, reply) => {
    const s = sessionOf(cloud, req)
    limiter.hit(`acc:${s.account.id}`)
    const id = (req.params as { id: string }).id
    const job = cloud.jobs.get(s.teamId, id)
    const header = req.headers['last-event-id']
    const query = r.jobEvents.query.safeParse(req.query ?? {})
    if (!query.success) throw new CloudError('bad_request', 'query.after: a whole number ≥ 0')
    const asked = typeof header === 'string' && /^\d{1,7}$/.test(header) ? Number(header) : (query.data.after ?? 0)
    // A cursor past the last event would filter out the terminal one and leave the stream open forever.
    let last = Math.min(asked, cloud.jobs.events(id).length)
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      'x-content-type-options': 'nosniff'
    })
    let open = true
    let unsubscribe = (): void => {}
    let ping: NodeJS.Timeout | undefined
    const end = (): void => {
      if (!open) return
      open = false
      unsubscribe()
      if (ping) clearInterval(ping)
      raw.end()
    }
    const send = (e: JobEvent): void => {
      if (!open || e.seq <= last) return
      last = e.seq
      raw.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(JobEvent.parse(e))}\n\n`)
      if (e.type === 'succeeded' || e.type === 'failed' || e.type === 'cancelled') end()
    }
    unsubscribe = cloud.jobs.subscribe(id, send)
    for (const e of cloud.jobs.events(id, last)) send(e)
    if (open && TERMINAL_JOB_STATES.includes(cloud.jobs.state(job.id))) end()
    if (open) {
      // Every 15 s: a keep-alive, and the token is checked again (a revoked device or an expired token ends the stream).
      ping = setInterval(() => {
        try {
          sessionOf(cloud, req)
          raw.write(': ping\n\n')
        } catch {
          end()
        }
      }, 15_000)
      raw.on('close', end)
    }
  })

  route(app, cloud, limiter, r.artefact, ({ session, params, req }) => {
    const a = cloud.storage.forTeam(must(session).teamId, params.id ?? '')
    const link = cloud.storage.signedPath(a.id)
    // In an object store the link goes straight to the bucket (presigned, same lifetime): no bytes through the Cloud.
    const direct = cloud.storage.presign(a, SIGNED_LINK_TTL_S)
    return {
      artefact: { id: a.id, name: a.name, mime: a.mime, size: a.size, sha256: a.sha256, demo: a.demo },
      url: direct ?? `${baseUrlOf(req)}${link.path}`,
      expiresAt: link.expiresAt
    }
  })

  route(app, cloud, limiter, r.wallet, ({ session }) => cloud.wallet.state(must(session).teamId))
  route(app, cloud, limiter, r.walletEntries, ({ session, query }) =>
    cloud.wallet.entries(must(session).teamId, { limit: query.limit, cursor: query.cursor })
  )
  route(app, cloud, limiter, r.support, ({ session, body }) => {
    const s = must(session)
    return cloud.support.create({ accountId: s.account.id, teamId: s.teamId, subject: body.subject, body: body.body })
  })
}
