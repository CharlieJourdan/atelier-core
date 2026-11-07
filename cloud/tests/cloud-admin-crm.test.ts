// The founder console's CRM (cloud/src/admin-crm.ts, ADMIN_CRM_ROUTES): the list with plan, credits, spend over 30 days,
// machines, last activity and verified address; search and pages; the detail; and the admin actions (grant with an
// idempotency key, verify the address, disable / enable, revoke sessions), each refused to non-admins before the body is
// read and each written to the audit log. Every answer parses with the shared contract.
import { describe, expect, it } from 'vitest'
import { ADMIN_CRM_ROUTES, CrmAccountDetail, CrmActionResponse, CrmGrantResponse, CrmListResponse, CrmRevokeResponse } from '../../src/shared/cloud-admin-crm.ts'
import { givePlan, makeCloud, PASSWORD, quoteAndRun, signIn, signUpAndIn, type TestCloud } from './helpers.ts'

async function rig() {
  const t = makeCloud()
  const admin = await signUpAndIn(t, { platformAdmin: true, email: 'founder@atelier.test' })
  const alice = await signUpAndIn(t, { email: 'alice@example.com', credits: 5000 })
  const bob = await signUpAndIn(t, { email: 'bob@example.com' })
  t.cloud.db.prepare('UPDATE teams SET name = ? WHERE id = ?').run('Studio Alpha', alice.teamId)
  return { t, admin, alice, bob }
}

const get = async (t: TestCloud, url: string, auth: Record<string, string>) => t.app.inject({ method: 'GET', url, headers: auth })
const post = async (t: TestCloud, url: string, auth: Record<string, string>, payload: object = {}) => t.app.inject({ method: 'POST', url, headers: auth, payload })

describe('CRM list and detail', () => {
  it('lists every account with its team, plan, balance, 30-day spend, machines, last activity and verified address', async () => {
    const { t, admin, alice } = await rig()
    givePlan(t, alice.teamId, 'pro')
    await quoteAndRun(t, alice, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'demo-claire' })
    const res = await get(t, '/v1/admin/accounts', admin.auth)
    expect(res.statusCode).toBe(200)
    const list = CrmListResponse.parse(res.json())
    expect(list.total).toBe(3)
    expect(list.accounts.map((a) => a.email)).toEqual(expect.arrayContaining(['founder@atelier.test', 'alice@example.com', 'bob@example.com']))
    const a = list.accounts.find((x) => x.email === 'alice@example.com')!
    expect(a).toMatchObject({ emailVerified: true, disabled: false, platformAdmin: false, activeSessions: 1 })
    expect(a.lastActiveAt).not.toBeNull()
    expect(a.team).toMatchObject({ name: 'Studio Alpha', role: 'owner', plan: 'pro', planStatus: 'active', machines: 0 })
    expect(a.team!.spent30d).toBeGreaterThan(0)
    expect(a.team!.balance).toBe(5000 - a.team!.spent30d)
    const bob = list.accounts.find((x) => x.email === 'bob@example.com')!
    expect(bob.team).toMatchObject({ plan: null, balance: 0, spent30d: 0 })
  })

  it('searches the e-mail, the name or the team (a plain substring, wildcards are not special), and pages', async () => {
    const { t, admin } = await rig()
    const q = async (query: string) => CrmListResponse.parse((await get(t, `/v1/admin/accounts?${query}`, admin.auth)).json())
    expect((await q('q=ALICE')).accounts.map((a) => a.email)).toEqual(['alice@example.com'])
    expect((await q('q=studio%20alp')).accounts.map((a) => a.email)).toEqual(['alice@example.com'])
    expect((await q('q=%25')).total).toBe(0)
    expect((await q('q=_')).total).toBe(0)
    const page1 = await q('limit=2&offset=0')
    const page2 = await q('limit=2&offset=2')
    expect(page1).toMatchObject({ total: 3, limit: 2, offset: 0 })
    expect(page1.accounts).toHaveLength(2)
    expect(page2.accounts).toHaveLength(1)
    expect(new Set([...page1.accounts, ...page2.accounts].map((a) => a.id)).size).toBe(3)
    expect((await get(t, '/v1/admin/accounts?limit=500', admin.auth)).statusCode).toBe(400)
  })

  it('the detail has the teams, devices, wallet moves and audit entries of the account', async () => {
    const { t, admin, alice } = await rig()
    const res = await get(t, `/v1/admin/accounts/${alice.accountId}`, admin.auth)
    expect(res.statusCode).toBe(200)
    const d = CrmAccountDetail.parse(res.json())
    expect(d.account.email).toBe('alice@example.com')
    expect(d.teams).toHaveLength(1)
    expect(d.devices).toHaveLength(1)
    expect(d.wallet[0]).toMatchObject({ kind: 'grant', credits: 5000 })
    expect(d.audit.map((e) => e.action)).toEqual(expect.arrayContaining(['account.create', 'auth.login', 'wallet.grant']))
    expect((await get(t, '/v1/admin/accounts/acc_nobody', admin.auth)).statusCode).toBe(404)
  })
})

describe('CRM actions', () => {
  it('grants credits once per idempotency key, to the account’s team, audited', async () => {
    const { t, admin, bob } = await rig()
    const body = { credits: 750, idempotencyKey: 'grant-bob-0001', note: 'geste commercial' }
    const first = CrmGrantResponse.parse((await post(t, `/v1/admin/accounts/${bob.accountId}/grant`, admin.auth, body)).json())
    const again = CrmGrantResponse.parse((await post(t, `/v1/admin/accounts/${bob.accountId}/grant`, admin.auth, body)).json())
    expect(first).toMatchObject({ teamId: bob.teamId, replayed: false, balance: 750 })
    expect(again).toMatchObject({ entryId: first.entryId, replayed: true, balance: 750 })
    expect(t.cloud.wallet.state(bob.teamId).balance).toBe(750)
    const audits = t.cloud.audit.list().filter((e) => e.action === 'wallet.grant' && e.target === bob.teamId)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actor: admin.accountId })
    // another team than its own: refused
    const other = await post(t, `/v1/admin/accounts/${bob.accountId}/grant`, admin.auth, { ...body, idempotencyKey: 'grant-bob-0002', teamId: 'team_other' })
    expect(other.statusCode).toBe(400)
    expect((await post(t, `/v1/admin/accounts/${bob.accountId}/grant`, admin.auth, { credits: 0, idempotencyKey: 'grant-bob-0003' })).statusCode).toBe(400)
  })

  it('verifies an address, audited', async () => {
    const { t, admin } = await rig()
    const { account } = t.cloud.accounts.createAccount({ email: 'new@example.com', name: 'Nouveau', password: PASSWORD, verified: false, actor: 'test' })
    const res = CrmActionResponse.parse((await post(t, `/v1/admin/accounts/${account.id}/verify-email`, admin.auth)).json())
    expect(res.account.emailVerified).toBe(true)
    expect(t.cloud.accounts.account(account.id).emailVerified).toBe(true)
    expect(t.cloud.audit.list().find((e) => e.action === 'admin.verify_email')).toMatchObject({ actor: admin.accountId, target: account.id })
  })

  it('disabling signs the account out everywhere and refuses its sign-ins and refreshes; enabling lets it back in', async () => {
    const { t, admin, alice } = await rig()
    expect((await get(t, '/v1/me', alice.auth)).statusCode).toBe(200)
    const off = CrmActionResponse.parse((await post(t, `/v1/admin/accounts/${alice.accountId}/status`, admin.auth, { disabled: true })).json())
    expect(off.account).toMatchObject({ disabled: true, activeSessions: 0 })
    expect((await get(t, '/v1/me', alice.auth)).statusCode).toBe(401)
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: alice.refreshToken } })).statusCode).toBe(401)
    const login = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'alice@example.com', password: PASSWORD } })
    expect(login.statusCode).toBe(403)
    expect(login.body).toContain('désactivé')
    // a wrong password says nothing about the account being disabled
    const wrong = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'alice@example.com', password: 'not the password at all' } })
    expect(wrong.statusCode).toBe(401)
    await expect(signIn(t, 'alice@example.com')).rejects.toThrow()
    expect(CrmListResponse.parse((await get(t, '/v1/admin/accounts?status=disabled', admin.auth)).json()).accounts.map((a) => a.id)).toEqual([alice.accountId])
    const on = CrmActionResponse.parse((await post(t, `/v1/admin/accounts/${alice.accountId}/status`, admin.auth, { disabled: false })).json())
    expect(on.account.disabled).toBe(false)
    const back = await signIn(t, 'alice@example.com')
    expect((await get(t, '/v1/me', { authorization: `Bearer ${back.accessToken}` })).statusCode).toBe(200)
    const actions = t.cloud.audit.list().filter((e) => e.target === alice.accountId).map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(['admin.account_disable', 'admin.account_enable']))
    // an admin cannot lock themselves out
    expect((await post(t, `/v1/admin/accounts/${admin.accountId}/status`, admin.auth, { disabled: true })).statusCode).toBe(409)
  })

  it('revokes every session of an account, audited with the count', async () => {
    const { t, admin, bob } = await rig()
    await signIn(t, 'bob@example.com')
    const res = CrmRevokeResponse.parse((await post(t, `/v1/admin/accounts/${bob.accountId}/revoke-sessions`, admin.auth)).json())
    expect(res).toMatchObject({ revoked: 2, account: { activeSessions: 0, disabled: false } })
    expect((await get(t, '/v1/me', bob.auth)).statusCode).toBe(401)
    expect(t.cloud.audit.list().find((e) => e.action === 'admin.revoke_sessions')).toMatchObject({ actor: admin.accountId, target: bob.accountId, detail: { devices: 2 } })
    // the account itself still works: it signs in again
    expect((await signIn(t, 'bob@example.com')).accessToken).toBeTruthy()
  })
})

describe('CRM access', () => {
  it('every CRM route refuses anonymous callers (401) and people who are not platform admins (403), before reading the body', async () => {
    const { t, alice } = await rig()
    for (const r of Object.values(ADMIN_CRM_ROUTES)) {
      const url = r.path.replace(':id', alice.accountId)
      expect((await t.app.inject({ method: r.method, url })).statusCode, url).toBe(401)
      const res = await t.app.inject({ method: r.method, url, headers: alice.auth, ...(r.method === 'POST' ? { payload: { credits: 1_000, idempotencyKey: 'self-grant-0001', disabled: false } } : {}) })
      expect(res.statusCode, url).toBe(403)
      if (r.method === 'POST') expect(res.headers.connection).toBe('close')
    }
    // nothing happened
    expect(t.cloud.wallet.state(alice.teamId).balance).toBe(5000)
    expect(t.cloud.audit.list().some((e) => e.action.startsWith('admin.'))).toBe(false)
  })
})
