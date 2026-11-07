// The website's side of the Cloud: sign-up (own team, signed in at once), password sign-in with the lockout, CORS for
// the site's origins only, and the team computers created by a paid plan, seen from the site.
import { describe, expect, it } from 'vitest'
import { confirmEmail, makeCloud } from './helpers.ts'

const PW = 'correct horse battery'

describe('the website on the Cloud', () => {
  it('signs up, signs in, refuses a second account on the same e-mail and locks after 5 wrong passwords', async () => {
    const t = makeCloud()
    const up = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'site@example.com', name: 'Site', password: PW } })
    expect(up.statusCode).toBe(200)
    const tokens = up.json() as { accessToken: string }
    const me = await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${tokens.accessToken}` } })
    expect(me.json()).toMatchObject({ account: { email: 'site@example.com' } })
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'SITE@example.com', name: 'X', password: PW } })).statusCode).toBe(409)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'short@example.com', name: 'X', password: 'short' } })).statusCode).toBe(400)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'site@example.com', password: PW } })).statusCode).toBe(200)
    for (let i = 0; i < 5; i++) expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'site@example.com', password: 'wrong password!' } })).statusCode).toBe(401)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'site@example.com', password: PW } })).statusCode).toBe(429)
  })

  it('answers CORS for the site origins only', async () => {
    const t = makeCloud()
    const ok = await t.app.inject({ method: 'OPTIONS', url: '/v1/auth/login', headers: { origin: 'http://localhost:5190', 'access-control-request-method': 'POST' } })
    expect(ok.statusCode).toBe(204)
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5190')
    expect(ok.headers['access-control-allow-headers']).toContain('authorization')
    const other = await t.app.inject({ method: 'OPTIONS', url: '/v1/auth/login', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('a plan paid from the site creates the team computer the site then shows', async () => {
    const t = makeCloud()
    const up = (await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'plan@example.com', name: 'P', password: PW } })).json() as { accessToken: string }
    await confirmEmail(t, 'plan@example.com')
    const auth = { authorization: `Bearer ${up.accessToken}` }
    expect((await t.app.inject({ url: '/v1/team/machines', headers: auth })).json()).toEqual({ provider: 'fake', machines: [] })
    const co = (await t.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: auth, payload: { item: { kind: 'subscription', plan: 'agency', period: 'year' }, successUrl: 'http://localhost:5190/bienvenue', cancelUrl: 'http://localhost:5190/tarifs' } })).json() as { sessionId: string }
    await t.app.inject({ method: 'POST', url: '/v1/billing/demo-complete', headers: auth, payload: { sessionId: co.sessionId } })
    await t.cloud.billing.idle()
    const m = (await t.app.inject({ url: '/v1/team/machines', headers: auth })).json() as { machines: { status: string; serverType: string; demo: boolean }[] }
    expect(m.machines).toHaveLength(2)
    expect(m.machines.every((x) => x.status === 'running' && x.serverType === 'cx53' && x.demo)).toBe(true)
  })
})

describe('the founder console on the Cloud', () => {
  it('overview: accounts, active plans, MRR, this month’s revenue, machines and credits; machine actions', async () => {
    const t = makeCloud()
    const { signUpAndIn } = await import('./helpers.ts')
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const up = (await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'buyer@example.com', name: 'B', password: PW } })).json() as { accessToken: string }
    await confirmEmail(t, 'buyer@example.com')
    const auth = { authorization: `Bearer ${up.accessToken}` }
    const pay = async (item: unknown) => {
      const co = (await t.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: auth, payload: { item, successUrl: 'http://localhost:5190/ok', cancelUrl: 'http://localhost:5190/no' } })).json() as { sessionId: string }
      await t.app.inject({ method: 'POST', url: '/v1/billing/demo-complete', headers: auth, payload: { sessionId: co.sessionId } })
      await t.cloud.billing.idle()
    }
    await pay({ kind: 'subscription', plan: 'creator', period: 'year' })
    await pay({ kind: 'pack', pack: 'pack5k' })
    const o = (await t.app.inject({ url: '/v1/admin/overview', headers: admin.auth })).json() as Record<string, unknown>
    expect(o).toMatchObject({ accounts: 2, teams: 2, plans: [{ plan: 'creator', active: 1 }], mrrCents: 7999, monthRevenueCents: { subscription: 95990, pack: 4750, topup: 0 }, machines: { running: 1, hibernated: 0, monthlyCostEur: 16.49, demo: true }, creditsThisMonth: { granted: 41000 }, paymentsProvider: 'fake' })
    const list = (await t.app.inject({ url: '/v1/admin/machines', headers: admin.auth })).json() as { machines: { id: string; teamName: string; status: string }[] }
    expect(list.machines).toHaveLength(1)
    expect(list.machines[0]!.teamName).toBeTruthy()
    const id = list.machines[0]!.id
    expect((await t.app.inject({ method: 'POST', url: `/v1/admin/machines/${id}/action`, headers: admin.auth, payload: { action: 'hibernate' } })).json()).toEqual({ ok: true })
    expect(((await t.app.inject({ url: '/v1/admin/machines', headers: admin.auth })).json() as { machines: { status: string }[] }).machines[0]!.status).toBe('hibernated')
    expect((await t.app.inject({ url: '/v1/admin/overview', headers: auth })).statusCode).toBe(403)
  })
})

describe('blueprints', () => {
  it('the founder publishes versions; the apps read the latest; bad documents are refused', async () => {
    const t = makeCloud()
    const { signUpAndIn } = await import('./helpers.ts')
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const user = await signUpAndIn(t)
    const bp = (instructions: string) => ({ version: 9, agents: [{ id: 'atlas', role: 'Agent principal', tier: 'deep', routines: ['Point du matin'], instructions }], pipelines: [{ id: 'doc', name: 'Documentaire', nodes: [{ id: 'script', label: 'Script', runner: 'agent', provider: 'Claude Code', credits: 0, validate: 'review' }] }] })
    expect((await t.app.inject({ url: '/v1/blueprint', headers: user.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/blueprints', headers: admin.auth, payload: { blueprint: bp('v1'), note: 'premiere' } })).json()).toEqual({ version: 1 })
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/blueprints', headers: admin.auth, payload: { blueprint: bp('v2') } })).json()).toEqual({ version: 2 })
    const current = (await t.app.inject({ url: '/v1/blueprint', headers: user.auth })).json() as { version: number; blueprint: { version: number; agents: { instructions: string }[] } }
    expect(current.version).toBe(2)
    expect(current.blueprint.version).toBe(2)
    expect(current.blueprint.agents[0]!.instructions).toBe('v2')
    const list = (await t.app.inject({ url: '/v1/admin/blueprints', headers: admin.auth })).json() as { versions: { version: number; note: string }[] }
    expect(list.versions.map((v) => [v.version, v.note])).toEqual([[2, ''], [1, 'premiere']])
    const bad = { ...bp('x'), agents: [...bp('x').agents, ...bp('y').agents] }
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/blueprints', headers: admin.auth, payload: { blueprint: bad } })).json()).toMatchObject({ error: { message: expect.stringContaining('duplicate id atlas') } })
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/blueprints', headers: admin.auth, payload: { blueprint: { version: 1, agents: [], pipelines: [] } } })).statusCode).toBe(400)
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/blueprints', headers: user.auth, payload: { blueprint: bp('z') } })).statusCode).toBe(403)
  })
})

describe('hosted behind a reverse proxy', () => {
  it('accepts the configured public host and refuses any other', async () => {
    const t = makeCloud({ server: { loopbackHostsOnly: true, publicHosts: ['api.atelier.test'] } })
    expect((await t.app.inject({ url: '/v1/me', headers: { host: 'api.atelier.test' } })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: { host: 'evil.example' } })).statusCode).toBe(403)
    expect((await t.app.inject({ url: '/v1/me', headers: { host: '127.0.0.1:8787' } })).statusCode).toBe(401)
  })
})

describe('platform hardening (independent review, 25/10)', () => {
  const PW2 = 'correct horse battery'
  const signupAuth = async (t: ReturnType<typeof makeCloud>, email: string) => {
    const up = (await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, name: 'X', password: PW2 } })).json() as { accessToken: string }
    await confirmEmail(t, email)
    return { authorization: `Bearer ${up.accessToken}` }
  }
  const checkout = (t: ReturnType<typeof makeCloud>, auth: Record<string, string>, item: unknown, successUrl = 'http://localhost:5190/ok') =>
    t.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: auth, payload: { item, successUrl, cancelUrl: 'http://localhost:5190/no' } })

  it('the simulated payment is refused while paid calls are on (no free credits for real providers)', async () => {
    const t = makeCloud({ paidCalls: true })
    const auth = await signupAuth(t, 'paid@example.com')
    const co = (await checkout(t, auth, { kind: 'pack', pack: 'pack20k' })).json() as { sessionId: string }
    const res = await t.app.inject({ method: 'POST', url: '/v1/billing/demo-complete', headers: auth, payload: { sessionId: co.sessionId } })
    expect(res.statusCode).toBe(403)
    expect(t.cloud.wallet.state((await t.app.inject({ url: '/v1/me', headers: auth })).json().team.id).balance).toBe(0)
  })

  it('Stripe asked for but its secrets missing: the Cloud refuses to start instead of simulating payments', async () => {
    const { createCloud } = await import('../src/cloud.ts')
    const { staticKeySource } = await import('../src/keysource.ts')
    expect(() => createCloud({ dbPath: ':memory:', filesDir: '.', signingKey: Buffer.alloc(32, 1), keySource: staticKeySource(Buffer.alloc(32, 7)), paidCalls: false, payments: 'stripe' })).toThrow(/STRIPE_SECRET_KEY/)
  })

  it('only the owner or an admin manages billing; return URLs stay on the site; one plan at a time', async () => {
    const t = makeCloud()
    const { signUpAndIn } = await import('./helpers.ts')
    const owner = await signUpAndIn(t)
    const member = await signUpAndIn(t, { teamId: owner.teamId, role: 'member' })
    expect((await checkout(t, member.auth, { kind: 'pack', pack: 'pack2k' })).statusCode).toBe(403)
    expect((await t.app.inject({ method: 'POST', url: '/v1/billing/auto-recharge', headers: member.auth, payload: { enabled: true, thresholdCredits: 1000000 } })).statusCode).toBe(403)
    expect((await checkout(t, owner.auth, { kind: 'pack', pack: 'pack2k' }, 'https://phishing.example/ok')).statusCode).toBe(400)
    expect((await t.app.inject({ method: 'POST', url: '/v1/billing/auto-recharge', headers: owner.auth, payload: { enabled: true, monthlyCapCents: 1_000_000 } })).statusCode).toBe(400)
    const co = (await checkout(t, owner.auth, { kind: 'subscription', plan: 'starter', period: 'month' })).json() as { sessionId: string }
    await t.app.inject({ method: 'POST', url: '/v1/billing/demo-complete', headers: owner.auth, payload: { sessionId: co.sessionId } })
    expect((await checkout(t, owner.auth, { kind: 'subscription', plan: 'network', period: 'month' })).statusCode).toBe(409)
    await t.cloud.billing.idle()
  })

  it('a payment event whose effects fail leaves no trace, so the retry applies it', async () => {
    const { FakePayments } = await import('../src/billing/payments.ts')
    const payments = new FakePayments()
    const t = makeCloud({ paymentProvider: payments })
    const ghost = payments.sign({ id: 'evt_ghost', type: 'checkout.completed', teamId: 'team_missing', item: { kind: 'pack', pack: 'pack2k', cents: 2000 }, customerRef: null, subscriptionRef: null })
    await expect(t.cloud.billing.webhook(ghost.body, ghost.signature)).rejects.toThrow(/no team/)
    expect(t.cloud.db.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE id = 'evt_ghost'").get()).toEqual({ n: 0 })
  })

  it('two automatic top-ups at once charge once', async () => {
    const { FakePayments } = await import('../src/billing/payments.ts')
    const payments = new FakePayments()
    const t = makeCloud({ paymentProvider: payments })
    const team = t.cloud.accounts.createAccount({ email: 'auto@example.com', name: 'A', password: PW2, actor: 'test' }).team.id
    const c = await t.cloud.billing.checkout(team, 'a@example.com', { kind: 'pack', pack: 'pack2k' }, { successUrl: 'http://localhost:5190/ok', cancelUrl: 'http://localhost:5190/no' })
    const s = payments.complete(c.sessionId)
    await t.cloud.billing.webhook(s.body, s.signature)
    t.cloud.billing.setAutoRecharge(team, { enabled: true, thresholdCredits: 5000 })
    const both = await Promise.all([t.cloud.billing.autoRecharge(team), t.cloud.billing.autoRecharge(team)])
    expect(both.filter((r) => r.charged)).toHaveLength(1)
    expect(payments.charges).toHaveLength(1)
  })

  it('wrong passwords sent at once cannot get past the lockout', async () => {
    const t = makeCloud()
    await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'race@example.com', name: 'R', password: PW2 } })
    const tries = await Promise.all(Array.from({ length: 20 }, () => t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'race@example.com', password: 'wrong password!' } })))
    expect(tries.filter((r) => r.statusCode === 401)).toHaveLength(5)
    expect(tries.filter((r) => r.statusCode === 429)).toHaveLength(15)
  })

  it('hosted behind the proxy: client addresses come from the proxy, links and the device form use the public https URL', async () => {
    const t = makeCloud({ server: { loopbackHostsOnly: true, publicHosts: ['api.atelier.test'], publicUrl: 'https://api.atelier.test' } })
    const { newVerifier } = await import('./helpers.ts')
    const start = await t.app.inject({ method: 'POST', url: '/v1/auth/device/start', headers: { host: 'api.atelier.test' }, payload: { codeChallenge: newVerifier().challenge, codeChallengeMethod: 'S256', deviceName: 'Mac' } })
    expect((start.json() as { verificationUri: string }).verificationUri).toMatch(/^https:\/\/api\.atelier\.test\//)
    const { setPublicBase } = await import('../src/http/routes-user.ts')
    setPublicBase(null)
  })
})
