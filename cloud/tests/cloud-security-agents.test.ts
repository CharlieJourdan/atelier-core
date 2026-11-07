// securite-agents (decision 0076): a user, or their agent with full access to their own machine, may send the Cloud anything.
// Money stays the Cloud's: a forged price, a tampered input, a replayed quote, another team's job, an oversized request, an
// avatar quote that declares less than its voice lasts, a GPU pod that runs past its quote, a team that floods the queue,
// a plain member driving the team computer's settings. Fake adapters only.
import { describe, expect, it } from 'vitest'
import { ADMIN_CRM_ROUTES } from '../../src/shared/cloud-admin-crm.ts'
import { ADMIN_FINANCE_ROUTES } from '../../src/shared/cloud-admin-finance.ts'
import { CLOUD_ADMIN_ROUTES, CLOUD_ROUTES, isRelayAdminMethod } from '../../src/shared/cloud-api.ts'
import { RELEASE_ROUTES } from '../../src/shared/cloud-releases.ts'
import { JobQueue } from '../src/job-queue.ts'
import { wavSeconds } from '../src/media-duration.ts'
import { SpendWatch, UNUSUAL_MIN_CREDITS } from '../src/spend-watch.ts'
import type { RunpodClient, RunpodPolicy, RunpodStatus } from '../src/runpod/client.ts'
import { GPU_TIMEOUT_SLACK_S, runpodAdapter } from '../src/runpod/adapter.ts'
import { RetryableProviderError, type ProviderAdapter } from '../src/providers/types.ts'
import { ctxFor } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn, wavBytes, type Person, type TestCloud } from './helpers.ts'

const PROD = { NODE_ENV: 'production' }
const IMAGE = { prompt: 'un phare au crépuscule', count: 1 }

async function quote(t: TestCloud, p: Person, usage: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage, input, ...extra } })
}
async function job(t: TestCloud, p: Person, payload: Record<string, unknown>) {
  return t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload })
}

describe('prices and credits come from the Cloud only', () => {
  it('a forged price, cost, credit amount, paid or internal flag in a quote or a job is ignored', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const honest = (await quote(t, p, 'generateImage', IMAGE)).json() as { totalCredits: number }
    const forged = await quote(t, p, 'generateImage', { ...IMAGE, price: 0, credits: 0, costUsd: 0 }, { totalCredits: 0, priceMultiplier: 0, internal: true, test: true, paid: true })
    expect(forged.statusCode).toBe(200)
    const q = forged.json() as { id: string; totalCredits: number }
    expect(q.totalCredits).toBe(honest.totalCredits)
    expect(q.totalCredits).toBeGreaterThan(0)
    const j = await job(t, p, { quoteId: q.id, idempotencyKey: 'forged-1', credits: 0, paid: true, internal: true })
    expect(j.statusCode).toBe(200)
    expect((j.json() as { credits: number }).credits).toBe(q.totalCredits)
    await t.cloud.jobs.whenIdle()
    expect(t.cloud.wallet.state(p.teamId).balance).toBe(1000 - q.totalCredits)
  })

  it('`real: true` never makes real work free: only a demo answer in a real run is', async () => {
    const real: ProviderAdapter = {
      id: 'image:gpt-image-25-low',
      kind: 'real',
      secretName: 'OPENAI_API_KEY',
      generateImage: () => Promise.resolve({ files: [{ name: 'image.png', mime: 'image/png', bytes: Buffer.from('png') }], data: {}, costUsd: 0, costUnknown: true })
    }
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [real], engines: ['image:gpt-image-25-low'] })
    t.cloud.vault.set('OPENAI_API_KEY', 'openai-test-SECRET-key-0001', 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const q = (await quote(t, p, 'generateImage', { ...IMAGE, engine: 'image:gpt-image-25-low' })).json() as { id: string; totalCredits: number }
    const j = (await job(t, p, { quoteId: q.id, idempotencyKey: 'real-flag-1', real: true })).json() as { credits: number; demo: boolean }
    expect(j).toMatchObject({ demo: false, credits: q.totalCredits })
    await t.cloud.jobs.whenIdle()
    expect(t.cloud.wallet.state(p.teamId).balance).toBeLessThan(1000)
  })

  it('a job runs the input stored with its quote: an input sent with the job (an edited recipe) changes nothing', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const q = (await quote(t, p, 'generateImage', IMAGE)).json() as { id: string; totalCredits: number }
    const j = await job(t, p, { quoteId: q.id, idempotencyKey: 'tamper-1', input: { ...IMAGE, count: 8 }, usage: 'generateVideo' })
    expect(j.statusCode).toBe(200)
    await t.cloud.jobs.whenIdle()
    const done = (await t.app.inject({ url: `/v1/jobs/${(j.json() as { id: string }).id}`, headers: p.auth })).json() as { usage: string; artefacts: unknown[]; credits: number }
    expect(done).toMatchObject({ usage: 'generateImage', credits: q.totalCredits })
    expect(done.artefacts).toHaveLength(1)
  })

  it('a quote pays for one job: replayed under a new key it is refused, under the same key it answers the same job', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const q = (await quote(t, p, 'generateImage', IMAGE)).json() as { id: string; totalCredits: number }
    const first = (await job(t, p, { quoteId: q.id, idempotencyKey: 'replay-1' })).json() as { id: string }
    const again = (await job(t, p, { quoteId: q.id, idempotencyKey: 'replay-1' })).json() as { id: string }
    expect(again.id).toBe(first.id)
    expect((await job(t, p, { quoteId: q.id, idempotencyKey: 'replay-2' })).statusCode).toBe(409)
    // an old cheap quote does not outlive its 30 minutes either
    const old = (await quote(t, p, 'generateImage', IMAGE)).json() as { id: string }
    t.clock.advance(31 * 60_000)
    expect((await job(t, p, { quoteId: old.id, idempotencyKey: 'replay-3' })).statusCode).toBe(410)
    await t.cloud.jobs.whenIdle()
    expect(t.cloud.wallet.state(p.teamId).balance).toBe(1000 - q.totalCredits)
  })

  it('an engine outside the catalogue is refused at the quote', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const r = await quote(t, p, 'generateImage', { ...IMAGE, engine: 'image:my-own-free-engine' })
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatch(/unknown/)
  })
})

describe('another team’s things answer as unknown', () => {
  it('its job, events, cancel, quote and files', async () => {
    const t = makeCloud()
    const a = await signUpAndIn(t, { credits: 1000 })
    const b = await signUpAndIn(t, { credits: 1000 })
    const { job: theirs } = await quoteAndRun(t, a, 'generateImage', IMAGE)
    expect((await t.app.inject({ url: `/v1/jobs/${theirs.id}`, headers: b.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/v1/jobs/${theirs.id}/events`, headers: b.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'POST', url: `/v1/jobs/${theirs.id}/cancel`, headers: b.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/v1/artefacts/${theirs.artefacts[0]?.id}`, headers: b.auth })).statusCode).toBe(404)
    const q = (await quote(t, a, 'generateImage', IMAGE)).json() as { id: string }
    expect((await job(t, b, { quoteId: q.id, idempotencyKey: 'stolen-quote' })).statusCode).toBe(404)
    const ref = await quote(t, b, 'generateImage', { ...IMAGE, referenceArtefactIds: [theirs.artefacts[0]?.id] })
    expect(ref.statusCode).toBe(404)
    expect(t.cloud.wallet.state(b.teamId).balance).toBe(1000)
  })
})

describe('oversized requests', () => {
  it('a body over 1 MiB, a text over its limit or too many estimate lines are refused before any work', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const huge = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: { ...p.auth, 'content-type': 'application/json' }, payload: JSON.stringify({ usage: 'synthesize', input: { text: 'a'.repeat(2 * 1024 * 1024), voiceId: 'demo-claire' } }) })
    // refused from its declared length, before a byte is read (bodies.ts: 400 outside the upload routes)
    expect(huge.statusCode).toBe(400)
    expect(huge.body).toMatch(/too large/)
    expect((await quote(t, p, 'synthesize', { text: 'a'.repeat(50_001), voiceId: 'demo-claire' })).statusCode).toBe(400)
    expect((await quote(t, p, 'generateImage', { ...IMAGE, count: 1000 })).statusCode).toBe(400)
    const items = Array.from({ length: 501 }, (_, i) => ({ key: `k${i}`, usage: 'generateImage', quantity: 1 }))
    expect((await t.app.inject({ method: 'POST', url: '/v1/estimates', headers: p.auth, payload: { items } })).statusCode).toBe(400)
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM quotes').get()).toEqual({ n: 0 })
  })
})

describe('a talking avatar is quoted on the voice it really speaks', () => {
  it('reads the WAV length (an upper bound) and refuses a quote that declares less, or a voice it cannot measure', () => {
    expect(wavSeconds(wavBytes(5), wavBytes(5).length)).toBeCloseTo(5, 3)
    // a header that claims a short data chunk cannot hide the bytes after it
    const lying = wavBytes(30)
    lying.writeUInt32LE(8000, 40)
    expect(wavSeconds(lying, lying.length)).toBeCloseTo(30, 3)
    expect(wavSeconds(Buffer.from('ID3-not-a-wav'), 13)).toBeNull()
  })

  it('the route', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const put = (name: string, bytes: Buffer) => t.cloud.storage.put(p.teamId, null, { name, mime: 'audio/wav', bytes }, false)
    const long = await put('long.wav', wavBytes(60))
    const short = await quote(t, p, 'talkingAvatar', { avatarId: 'demo-avatar', audioArtefactId: long.id, seconds: 1 })
    expect(short.statusCode).toBe(400)
    expect(short.body).toMatch(/lasts 60 s/)
    expect((await quote(t, p, 'talkingAvatar', { avatarId: 'demo-avatar', audioArtefactId: long.id, seconds: 60 })).statusCode).toBe(200)
    const mp3 = await put('voice.mp3', Buffer.from('ID3-voice'))
    expect((await quote(t, p, 'talkingAvatar', { avatarId: 'demo-avatar', audioArtefactId: mp3.id, seconds: 60 })).statusCode).toBe(400)
  })
})

describe('a GPU pod never runs past its quote', () => {
  function stubClient(statuses: RunpodStatus[]) {
    const policies: (RunpodPolicy | undefined)[] = []
    const client = {
      run: (_e: string, _i: unknown, _w?: string, _s?: AbortSignal, policy?: RunpodPolicy) => {
        policies.push(policy)
        return Promise.resolve(statuses.shift() as RunpodStatus)
      },
      status: () => Promise.resolve(statuses.shift() as RunpodStatus),
      cancel: () => Promise.resolve({ id: 'pod-1', status: 'CANCELLED' } as RunpodStatus)
    } as unknown as RunpodClient
    return { client, policies }
  }
  const payload = { nodeType: 'render.scene', params: {}, inputs: {}, seed: 1, attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'qualite_max' }, fake: true }

  it('starts the pod with an execution timeout of the quoted GPU seconds plus a minute, and a timeout is final', async () => {
    const { client, policies } = stubClient([{ id: 'pod-1', status: 'IN_QUEUE' }, { id: 'pod-1', status: 'TIMED_OUT' }])
    const adapter = runpodAdapter({ client, endpoints: { render: 'ep-r', 'gpu-video': 'ep-g' }, kind: 'fake', pollMs: 0, waiters: { wait: () => new Promise(() => undefined), deliver: () => false } })
    const ctx = { ...ctxFor(''), callbackUrl: () => 'https://cloud.test/cb' }
    const err = await adapter.submitGpuJob?.({ worker: 'render', payload, estimatedGpuSeconds: 120 }, ctx).catch((e: Error) => e)
    expect(policies).toEqual([{ executionTimeout: (120 + GPU_TIMEOUT_SLACK_S) * 1000 }])
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(RetryableProviderError)
    expect((err as Error).message).toMatch(/past the GPU seconds it was quoted/)
  })
})

describe('one team cannot block the others', () => {
  /** A real-looking image adapter that holds each job until it is let go, and records the order they started in. */
  function held() {
    const started: string[] = []
    const gates: (() => void)[] = []
    const adapter: ProviderAdapter = {
      id: 'image:gpt-image-25-low',
      kind: 'real',
      secretName: 'OPENAI_API_KEY',
      async generateImage(input) {
        started.push(input.prompt)
        await new Promise<void>((r) => gates.push(r))
        return { files: [{ name: 'image.png', mime: 'image/png', bytes: Buffer.from('png') }], data: {}, costUsd: 0.001 }
      }
    }
    return { adapter, started, next: () => gates.shift()?.() }
  }
  const cloudWith = (h: ReturnType<typeof held>, o: { maxConcurrentJobs?: number; maxOpenJobsPerTeam?: number }) => {
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [h.adapter], engines: ['image:gpt-image-25-low'], ...o })
    t.cloud.vault.set('OPENAI_API_KEY', 'openai-test-SECRET-key-0001', 'test')
    return t
  }
  const start = async (t: TestCloud, p: Person, name: string) => {
    const q = (await quote(t, p, 'generateImage', { prompt: name, engine: 'image:gpt-image-25-low' })).json() as { id: string }
    return job(t, p, { quoteId: q.id, idempotencyKey: `flood-${name}` })
  }
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5))
  }

  it('a team’s open jobs are capped (429, Retry-After)', async () => {
    const h = held()
    const t = cloudWith(h, { maxOpenJobsPerTeam: 2 })
    const p = await signUpAndIn(t, { credits: 1000 })
    expect((await start(t, p, 'a1')).statusCode).toBe(200)
    expect((await start(t, p, 'a2')).statusCode).toBe(200)
    const third = await start(t, p, 'a3')
    expect(third.statusCode).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
    // another team is not counted against it
    expect((await start(t, await signUpAndIn(t, { credits: 1000 }), 'b1')).statusCode).toBe(200)
    await until(() => h.started.length === 3)
    for (let i = 0; i < 3; i++) h.next()
    await t.cloud.jobs.whenIdle()
  })

  it('starts the teams in turn: a long queue of one team does not hold back another team’s job', async () => {
    const h = held()
    const t = cloudWith(h, { maxConcurrentJobs: 1 })
    const a = await signUpAndIn(t, { credits: 1000 })
    const b = await signUpAndIn(t, { credits: 1000 })
    for (const n of ['a1', 'a2', 'a3', 'a4']) await start(t, a, n)
    await start(t, b, 'b1')
    for (let i = 0; i < 5; i++) {
      await until(() => h.started.length > i)
      h.next()
    }
    await t.cloud.jobs.whenIdle()
    expect(h.started).toEqual(['a1', 'b1', 'a2', 'a3', 'a4'])
  })

  it('the queue keeps each team’s order and skips a full provider', () => {
    const q = new JobQueue()
    for (const [id, team, provider] of [['a1', 'A', 'x'], ['a2', 'A', 'y'], ['b1', 'B', 'x']] as const) q.push({ id, team, provider })
    const cap = (full: string) => (p: string) => (p === full ? 0 : 1)
    expect(q.take(cap('x'))?.id).toBe('a2')
    expect(q.take(cap('none'))?.id).toBe('a1')
    expect(q.size).toBe(1)
  })
})

describe('the team computer through the relay', () => {
  it('a plain member may not change its keys, links, caps, prices or settings; reading and production pass', async () => {
    expect(isRelayAdminMethod('providers.setKey')).toBe(true)
    expect(isRelayAdminMethod('llm.setTierModel')).toBe(true)
    expect(isRelayAdminMethod('settings.set')).toBe(true)
    expect(isRelayAdminMethod('cloud.setBaseUrl')).toBe(true)
    expect(isRelayAdminMethod('settings.get')).toBe(false)
    expect(isRelayAdminMethod('production.start')).toBe(false)
    expect(isRelayAdminMethod('team.members')).toBe(false)
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const member = await signUpAndIn(t, { teamId: owner.teamId, role: 'member' })
    const rpc = (who: Person, method: string) => t.app.inject({ method: 'POST', url: CLOUD_ROUTES.teamBrainRpc.path, headers: who.auth, payload: { method, args: [] } })
    expect((await rpc(member, 'providers.setKey')).statusCode).toBe(403)
    expect((await rpc(member, 'spend.setGlobalCap')).statusCode).toBe(403)
    // past the role check: this team has no team computer
    expect((await rpc(member, 'channels.list')).statusCode).toBe(404)
    expect((await rpc(owner, 'providers.setKey')).statusCode).toBe(404)
  })
})

describe('admin routes', () => {
  it('every platform-admin route refuses a signed-in user', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 10 })
    const all: { method: string; path: string; auth: string }[] = [CLOUD_ADMIN_ROUTES, ADMIN_CRM_ROUTES, ADMIN_FINANCE_ROUTES, RELEASE_ROUTES].flatMap((g) => Object.values(g))
    const admin = all.filter((r) => r.auth === 'platformAdmin')
    expect(admin.length).toBeGreaterThan(5)
    for (const r of admin) {
      const url = r.path.replace(/:[a-zA-Z]+/g, 'x')
      const res = await t.app.inject({ method: r.method as 'GET', url, headers: p.auth, ...(r.method === 'GET' ? {} : { payload: {} }) })
      expect(res.statusCode, `${r.method} ${r.path}`).toBe(403)
    }
  })
})

describe('the balance is a hard wall, a big spender is not', () => {
  it('parallel jobs racing for the last credits: never past the balance, whatever the client does', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const one = (await quote(t, p, 'generateImage', IMAGE)).json() as { totalCredits: number }
    t.cloud.wallet.adjust({ teamId: p.teamId, credits: 2 * one.totalCredits - 1000, idemKey: 'leave-two', actor: 'test' })
    const quotes = await Promise.all(Array.from({ length: 12 }, () => quote(t, p, 'generateImage', IMAGE)))
    const jobs = await Promise.all(quotes.map((q, i) => job(t, p, { quoteId: (q.json() as { id: string }).id, idempotencyKey: `race-job-${i}` })))
    expect(jobs.filter((j) => j.statusCode === 200)).toHaveLength(2)
    expect(jobs.filter((j) => j.statusCode !== 200).every((j) => j.statusCode === 402)).toBe(true)
    await t.cloud.jobs.whenIdle()
    const w = t.cloud.wallet.state(p.teamId)
    expect(w.balance).toBe(0)
    expect(w.available).toBeGreaterThanOrEqual(0)
  })

  it('a team that spends far more than usual is not blocked: the founder and the team are told, once a day', async () => {
    const t = makeCloud({ maxCreditsPerJob: 10_000_000 })
    const p = await signUpAndIn(t, { credits: 10 * UNUSUAL_MIN_CREDITS })
    const spend = (credits: number, key: string) => {
      const h = t.cloud.wallet.hold({ teamId: p.teamId, accountId: p.accountId, credits, idemKey: `${key}:hold` })
      t.cloud.wallet.capture({ holdId: h.holdId, idemKey: `${key}:capture`, credits })
    }
    spend(UNUSUAL_MIN_CREDITS - 1, 'a')
    expect(t.cloud.spendWatch.check(p.teamId)).toBe(false)
    spend(10, 'b')
    expect(t.cloud.spendWatch.check(p.teamId)).toBe(true)
    expect(t.cloud.spendWatch.check(p.teamId)).toBe(false)
    expect(t.cloud.providerAlerts.list().some((a) => a.provider === SpendWatch.alertKey(p.teamId))).toBe(true)
    expect(t.cloud.audit.list().filter((e) => e.action === 'spend.unusual')).toHaveLength(1)
    await t.cloud.mail.idle()
    expect(t.cloud.outbox?.list({ to: p.email, limit: 20 }).some((m) => /contacte le support|contact support/.test(m.text))).toBe(true)
    // still spending: nothing was blocked
    const { job: more } = await quoteAndRun(t, p, 'generateImage', IMAGE)
    expect(more.state).toBe('succeeded')
  })
})
