// The team computer through Atelier Cloud (docs/BRAIN-HEADLESS.md §7): enrolment (once, wrong token refused, the
// credential stored hashed and revocable), a fake machine loop answering calls relayed from a person, team isolation,
// the offline machine, the timeout, oversized calls and answers, rate limits, events streamed as SSE, and the audit of
// who called which method without the arguments. Everything in memory or on the loopback.
import { describe, expect, it } from 'vitest'
import { cloudInit } from '../src/machines/cloud-init.ts'
import { OFFLINE_MESSAGE } from '../src/relay/hub.ts'
import { TEST_MASTER_KEY, makeCloud, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const SECRET_ARG = 'argument-secret-0f9e8d7c'

async function enrolledMachine(t: TestCloud, owner: Person) {
  const machines = t.cloud.machines()
  const [m] = await machines.provision(owner.teamId, 'starter', 'test')
  const enrolToken = machines.newEnrolToken(m!.id, 'test')
  const res = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken } })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { machineId: string; teamId: string; credential: string }
  return { machineId: m!.id, enrolToken, credential: body.credential, auth: { authorization: `Bearer ${body.credential}` }, body }
}

/** One turn of a fake brain: takes the waiting calls and answers each with `answer`. */
async function machineTurn(t: TestCloud, auth: { authorization: string }, answer: (r: { id: string; method: string; args: unknown[] }) => unknown, wait = 5) {
  const next = await t.app.inject({ url: `/v1/relay/machine/next?wait=${wait}`, headers: auth })
  expect(next.statusCode).toBe(200)
  const { requests } = next.json() as { requests: { id: string; method: string; args: unknown[] }[] }
  for (const r of requests) {
    const rep = await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: auth, payload: { id: r.id, response: answer(r) } })
    expect(rep.statusCode).toBe(200)
  }
  return requests
}

const rpc = (t: TestCloud, who: Person, payload: unknown) => t.app.inject({ method: 'POST', url: '/v1/team/brain/rpc', headers: who.auth, payload: payload as object })

describe('the brain service in cloud-init', () => {
  it('installs atelier-brain as the atelier user, enrolling by itself, with no secret of the Cloud', async () => {
    const t = makeCloud({ machineAppBundleUrl: 'https://files.atelier.test/atelier-0.1.0.tgz' })
    t.cloud.vault.set('HETZNER_API_TOKEN', 'hz-test-VAULT-0a1b2c', 'test')
    const owner = await signUpAndIn(t)
    const m = await enrolledMachine(t, owner)
    const yaml = cloudInit({
      hostname: 'atelier-team-ab12',
      cloudUrl: 'https://api.atelier.test',
      enrolToken: 'enr_abcdefghijklmnop',
      sshKeys: [],
      appBundleUrl: 'https://files.atelier.test/atelier-0.1.0.tgz'
    })
    for (const want of [
      'path: /etc/systemd/system/atelier-brain.service',
      'User=atelier',
      'ExecStart=/usr/bin/npm run brain:headless -- --cloud-enrol',
      'Environment=ATELIER_ENROL_FILE=/etc/atelier/enrol',
      'NoNewPrivileges=true',
      'ReadWritePaths=/etc/atelier',
      "[chown, -R, 'atelier:atelier', /etc/atelier]",
      '[systemctl, enable, --now, atelier-brain]',
      'curl -fsSL "https://files.atelier.test/atelier-0.1.0.tgz" | tar -xz -C /opt/atelier'
    ])
      expect(yaml).toContain(want)
    // the single-use enrolment token is the only credential on the machine; nothing of the Cloud's own
    for (const secret of [m.credential, 'hz-test-VAULT-0a1b2c', TEST_MASTER_KEY.toString('hex'), 'amc_']) expect(yaml).not.toContain(secret)
    expect(yaml).not.toMatch(/API_KEY|sk-|password:|--port|0\.0\.0\.0/i)
    expect(() => cloudInit({ hostname: 'atelier-a', cloudUrl: 'https://a.b', enrolToken: 'enr_abcdefghijklmnop', sshKeys: [], appBundleUrl: 'https://a.b/x"; rm -rf /' })).toThrow(/bundle/)
    expect(() => cloudInit({ hostname: 'atelier-a', cloudUrl: 'https://a.b', enrolToken: 'enr_abcdefghijklmnop', sshKeys: [], appBundleUrl: 'http://a.b/x.tgz' })).toThrow(/bundle/)
  })
})

describe('enrolment of a team computer', () => {
  it('trades the token once for a credential kept hashed; wrong and used tokens are refused; revocation cuts it', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const m = await enrolledMachine(t, owner)
    expect(m.body).toMatchObject({ machineId: m.machineId, teamId: owner.teamId })
    expect(m.credential).toMatch(/^amc_[A-Za-z0-9_-]{43}$/)
    const again = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: m.enrolToken } })
    expect(again.statusCode).toBe(401)
    const wrong = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: 'enr_' + 'x'.repeat(43) } })
    expect(wrong.statusCode).toBe(401)
    expect(JSON.stringify(t.cloud.db.prepare('SELECT * FROM machine_credentials').all())).not.toContain(m.credential)
    expect(JSON.stringify(t.cloud.audit.list())).not.toContain(m.credential)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(200)
    // a person's token is not a machine credential, and a machine credential is not a person's token
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: owner.auth })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: m.auth })).statusCode).toBe(401)
    expect(t.cloud.machines().credentials.revoke(m.machineId, 'test')).toBe(1)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(401)
    // a new enrolment token (admin tool) brings it back with a new credential; the old one stays dead
    const back = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: t.cloud.machines().newEnrolToken(m.machineId, 'test') } })
    const fresh = (back.json() as { credential: string }).credential
    expect(fresh).not.toBe(m.credential)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: { authorization: `Bearer ${fresh}` } })).statusCode).toBe(200)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(401)
  })

  it('an admin revokes a credential and the relay ends at once; deleting the machine revokes it too', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const m = await enrolledMachine(t, admin)
    const res = await t.app.inject({ method: 'POST', url: `/v1/admin/machines/${m.machineId}/action`, headers: admin.auth, payload: { action: 'revoke' } })
    expect(res.statusCode).toBe(200)
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })).statusCode).toBe(401)
    const m2 = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: t.cloud.machines().newEnrolToken(m.machineId, 'test') } })
    const cred = { authorization: `Bearer ${(m2.json() as { credential: string }).credential}` }
    await t.cloud.machines().destroy(m.machineId, 'test')
    expect((await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: cred })).statusCode).toBe(401)
    const actions = t.cloud.audit.list().map((e) => e.action)
    expect(actions).toContain('machine.credential_revoke')
    expect(actions).toContain('machine.enrol_token')
  })
})

describe('the brain relay', () => {
  it('relays a call to the machine and its envelope back; the machine shows online; the audit has the method, never the args', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const m = await enrolledMachine(t, owner)
    const offline = await rpc(t, owner, { method: 'app.info', args: [] })
    expect(offline.statusCode).toBe(503)
    expect(offline.json()).toEqual({ error: { code: 'machine_offline', message: OFFLINE_MESSAGE } })
    await machineTurn(t, m.auth, () => ({ ok: true }), 0)
    const listed = await t.app.inject({ url: '/v1/team/machines', headers: owner.auth })
    expect((listed.json() as { machines: { enrolled: boolean; online: boolean }[] }).machines[0]).toMatchObject({ enrolled: true, online: true })
    const [answer, served] = await Promise.all([
      rpc(t, owner, { method: 'channels.create', args: [{ name: SECRET_ARG }] }),
      machineTurn(t, m.auth, (r) => ({ ok: true, value: { method: r.method, args: r.args } }))
    ])
    expect(served).toHaveLength(1)
    expect(answer.statusCode).toBe(200)
    expect(answer.json()).toEqual({ ok: true, value: { method: 'channels.create', args: [{ name: SECRET_ARG }] } })
    // an error envelope passes through as is (HTTP 200, like the IPC bus)
    const [failed] = await Promise.all([
      rpc(t, owner, { method: 'production.revealPackage', args: ['x'] }),
      machineTurn(t, m.auth, () => ({ ok: false, error: { code: 'UNAVAILABLE_REMOTE', message: 'Indisponible sur l’ordinateur d’équipe : …' } }))
    ])
    expect(failed.json()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE_REMOTE' } })
    const calls = t.cloud.relayAudit.list({ teamId: owner.teamId })
    expect(calls.map((c) => [c.method, c.outcome, c.accountId, c.machineId])).toEqual([
      ['production.revealPackage', 'error', owner.accountId, m.machineId],
      ['channels.create', 'ok', owner.accountId, m.machineId],
      ['app.info', 'offline', owner.accountId, m.machineId]
    ])
    const stored = JSON.stringify(t.cloud.db.prepare('SELECT * FROM relay_calls').all()) + JSON.stringify(t.cloud.audit.list())
    expect(stored).not.toContain(SECRET_ARG)
    // a method name that is not an IPC name never reaches the machine nor the audit
    expect((await rpc(t, owner, { method: 'rm -rf /', args: [] })).statusCode).toBe(400)
    expect(t.cloud.relayAudit.list()).toHaveLength(3)
  })

  it('a person only reaches their own team’s machine; a machine only answers its own calls', async () => {
    const t = makeCloud()
    const a = await signUpAndIn(t)
    const b = await signUpAndIn(t)
    const ma = await enrolledMachine(t, a)
    const mb = await enrolledMachine(t, b)
    await machineTurn(t, ma.auth, () => ({ ok: true }), 0)
    const named = await rpc(t, b, { method: 'app.info', args: [], machineId: ma.machineId })
    expect(named.statusCode).toBe(404)
    const outsider = await signUpAndIn(t)
    expect((await rpc(t, outsider, { method: 'app.info', args: [] })).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/v1/team/brain/events?machineId=${ma.machineId}`, headers: b.auth })).statusCode).toBe(404)
    // B's machine polls but never sees A's call; it cannot answer it either
    const pending = rpc(t, a, { method: 'app.info', args: [] })
    const bNext = await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: mb.auth })
    expect((bNext.json() as { requests: unknown[] }).requests).toEqual([])
    const aNext = await t.app.inject({ url: '/v1/relay/machine/next?wait=5', headers: ma.auth })
    const [req] = (aNext.json() as { requests: { id: string }[] }).requests
    const steal = await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: mb.auth, payload: { id: req!.id, response: { ok: true, value: 'hijacked' } } })
    expect(steal.statusCode).toBe(404)
    await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: ma.auth, payload: { id: req!.id, response: { ok: true, value: 'mine' } } })
    expect((await pending).json()).toEqual({ ok: true, value: 'mine' })
  })

  it('a machine that stopped polling is offline; a call nobody answers times out', async () => {
    const t = makeCloud({ relay: { timeoutMs: 150 } })
    const owner = await signUpAndIn(t)
    const m = await enrolledMachine(t, owner)
    await machineTurn(t, m.auth, () => ({ ok: true }), 0)
    const late = await rpc(t, owner, { method: 'app.info', args: [] })
    expect(late.statusCode).toBe(504)
    expect((late.json() as { error: { code: string } }).error.code).toBe('timeout')
    // the late answer finds nobody waiting
    const next = await t.app.inject({ url: '/v1/relay/machine/next?wait=0', headers: m.auth })
    expect((next.json() as { requests: unknown[] }).requests).toEqual([])
    t.clock.advance(t.cloud.relay.limits.onlineGraceMs + 1)
    const off = await rpc(t, owner, { method: 'app.info', args: [] })
    expect(off.statusCode).toBe(503)
    expect((off.json() as { error: { message: string } }).error.message).toBe('L’ordinateur d’équipe est en veille ou hors ligne.')
    expect(t.cloud.relayAudit.list().map((c) => c.outcome)).toEqual(['offline', 'timeout'])
  })

  it('refuses oversized calls and answers (413) and limits a person’s rate', async () => {
    const t = makeCloud({ relay: { maxRequestBytes: 4096, maxReplyBytes: 4096, rpcPerMinute: 1 } })
    const owner = await signUpAndIn(t)
    const m = await enrolledMachine(t, owner)
    await machineTurn(t, m.auth, () => ({ ok: true }), 0)
    const big = await rpc(t, owner, { method: 'chat.send', args: ['x'.repeat(8000)] })
    expect(big.statusCode).toBe(413)
    expect((big.json() as { error: { code: string } }).error.code).toBe('too_large')
    const pending = rpc(t, owner, { method: 'app.info', args: [] })
    const next = await t.app.inject({ url: '/v1/relay/machine/next?wait=5', headers: m.auth })
    const [req] = (next.json() as { requests: { id: string }[] }).requests
    const huge = await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: m.auth, payload: { id: req!.id, response: { ok: true, value: 'y'.repeat(8000) } } })
    expect(huge.statusCode).toBe(413)
    await t.app.inject({ method: 'POST', url: '/v1/relay/machine/reply', headers: m.auth, payload: { id: req!.id, response: { ok: false, error: { code: 'TOO_LARGE', message: 'trop gros' } } } })
    expect((await pending).json()).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
    expect((await rpc(t, owner, { method: 'app.info', args: [] })).statusCode).toBe(429)
  })

  it('streams the machine’s events to the team as SSE, and ends the stream when the machine goes offline', async () => {
    const t = makeCloud({ relay: { heartbeatMs: 50 } })
    const owner = await signUpAndIn(t)
    const m = await enrolledMachine(t, owner)
    await machineTurn(t, m.auth, () => ({ ok: true }), 0)
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
    const ctrl = new AbortController()
    const res = await fetch(`${base}/v1/team/brain/events`, { headers: owner.auth, signal: ctrl.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const push = await t.app.inject({
      method: 'POST',
      url: '/v1/relay/machine/events',
      headers: m.auth,
      payload: { events: [{ event: 'changed', data: { topic: 'channels' } }, { event: 'stream', data: { conversationId: 'c1', delta: 'Bon' } }] }
    })
    expect(push.statusCode).toBe(200)
    while (!text.includes('event: stream')) text += decoder.decode((await reader.read()).value, { stream: true })
    expect(text).toContain('event: changed\ndata: {"topic":"channels"}')
    expect(text).toContain('event: stream\ndata: {"conversationId":"c1","delta":"Bon"}')
    t.clock.advance(t.cloud.relay.limits.onlineGraceMs + 1)
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    ctrl.abort()
    const offline = await fetch(`${base}/v1/team/brain/events`, { headers: owner.auth })
    expect(offline.status).toBe(503)
  })
})
