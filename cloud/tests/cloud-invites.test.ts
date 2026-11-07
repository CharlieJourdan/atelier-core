// Team invitations: an owner or admin invites by e-mail (a single-use, hashed, 7-day link, e-mailed and never answered),
// a member cannot; the invitee creates an account from the link (confirmed address) or accepts with the account it
// has, and its next sign-in lands in the inviting team. Plus the device page's « Créer un compte » mode.
import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../src/clock.ts'
import { INVITE_LIMIT, INVITE_TTL_MS } from '../src/invites.ts'
import { render } from '../src/mail/templates.ts'
import { mailedToken, makeCloud, newVerifier, PASSWORD, signIn, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const NEW_PW = 'a long enough passphrase'

async function invite(t: TestCloud, by: Person, email: string, role: 'admin' | 'member' = 'member') {
  return t.app.inject({ method: 'POST', url: '/v1/team/invites', headers: by.auth, payload: { email, role } })
}

async function me(t: TestCloud, auth: { authorization: string }) {
  const res = await t.app.inject({ url: '/v1/me', headers: auth })
  expect(res.statusCode).toBe(200)
  return res.json() as { account: { email: string; emailVerified?: boolean }; team: { id: string; name: string }; role: string }
}

describe('team invitations', () => {
  it('the owner invites by e-mail: the link is mailed (never answered), listed, previewed, and the new account joins as member', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const res = await invite(t, owner, 'lea@example.com')
    expect(res.statusCode).toBe(200)
    const created = res.json() as Record<string, unknown>
    expect(created).toMatchObject({ email: 'lea@example.com', role: 'member', invitedBy: 'Test' })
    expect(JSON.stringify(created)).not.toContain('inv_')
    const token = await mailedToken(t, 'lea@example.com', '/invitation')
    expect(token).toMatch(/^inv_/)
    // only the hash is stored
    expect(JSON.stringify(t.cloud.db.prepare('SELECT * FROM team_invites').all())).not.toContain(token!)

    const list = await t.app.inject({ url: '/v1/team/invites', headers: owner.auth })
    expect((list.json() as { invites: { email: string }[] }).invites.map((i) => i.email)).toEqual(['lea@example.com'])

    const preview = await t.app.inject({ method: 'POST', url: '/v1/invites/preview', payload: { token } })
    expect(preview.json()).toEqual({ teamName: 'Équipe de Test', email: 'lea@example.com', invitedBy: 'Test', role: 'member', hasAccount: false })

    const signup = await t.app.inject({ method: 'POST', url: '/v1/invites/signup', payload: { token, name: 'Léa', password: NEW_PW } })
    expect(signup.statusCode).toBe(200)
    const tokens = signup.json() as { accessToken: string }
    const who = await me(t, { authorization: `Bearer ${tokens.accessToken}` })
    expect(who.team.id).toBe(owner.teamId)
    expect(who.role).toBe('member')
    expect(who.account.emailVerified).toBe(true)

    // single use, and no longer pending
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/signup', payload: { token, name: 'X', password: NEW_PW } })).statusCode).toBe(410)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/preview', payload: { token } })).statusCode).toBe(410)
    expect(((await t.app.inject({ url: '/v1/team/invites', headers: owner.auth })).json() as { invites: unknown[] }).invites).toEqual([])
    // the members list now shows her
    const members = await t.app.inject({ url: '/v1/team/members', headers: owner.auth })
    expect((members.json() as { members: { email: string; role: string }[] }).members.map((m) => [m.email, m.role])).toContainEqual(['lea@example.com', 'member'])
    // a device login of hers lands in that team too
    const device = await signIn(t, 'lea@example.com', NEW_PW)
    expect((await me(t, { authorization: `Bearer ${device.accessToken}` })).team.id).toBe(owner.teamId)
  })

  it('a member can neither invite nor list; an admin invites members, only the owner invites admins', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const member = await signUpAndIn(t, { teamId: owner.teamId, role: 'member' })
    const admin = await signUpAndIn(t, { teamId: owner.teamId, role: 'admin' })
    expect((await invite(t, member, 'x@example.com')).statusCode).toBe(403)
    expect((await t.app.inject({ url: '/v1/team/invites', headers: member.auth })).statusCode).toBe(403)
    expect((await invite(t, admin, 'y@example.com')).statusCode).toBe(200)
    expect((await invite(t, admin, 'z@example.com', 'admin')).statusCode).toBe(403)
    expect((await invite(t, owner, 'z@example.com', 'admin')).statusCode).toBe(200)
    expect((await t.app.inject({ url: '/v1/team/invites', headers: admin.auth })).statusCode).toBe(200)
  })

  it('an address that is already a member is refused; a new invitation retires the pending link', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const member = await signUpAndIn(t, { teamId: owner.teamId, role: 'member' })
    expect((await invite(t, owner, member.email.toUpperCase())).statusCode).toBe(409)
    await invite(t, owner, 'max@example.com')
    const first = await mailedToken(t, 'max@example.com', '/invitation')
    await invite(t, owner, 'max@example.com')
    const second = await mailedToken(t, 'max@example.com', '/invitation')
    expect(second).not.toBe(first)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/preview', payload: { token: first } })).statusCode).toBe(410)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/preview', payload: { token: second } })).statusCode).toBe(200)
    expect(((await t.app.inject({ url: '/v1/team/invites', headers: owner.auth })).json() as { invites: unknown[] }).invites).toHaveLength(1)
  })

  it('a revoked invitation stops working', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const created = (await invite(t, owner, 'rev@example.com')).json() as { id: string }
    const token = await mailedToken(t, 'rev@example.com', '/invitation')
    expect((await t.app.inject({ method: 'POST', url: `/v1/team/invites/${created.id}/revoke`, headers: owner.auth })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'POST', url: `/v1/team/invites/${created.id}/revoke`, headers: owner.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/signup', payload: { token, name: 'R', password: NEW_PW } })).statusCode).toBe(410)
  })

  it('an existing account accepts with its own address and signs in to the new team from its next device login', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const other = await signUpAndIn(t, { email: 'nina@example.com' })
    await invite(t, owner, 'Nina@Example.com')
    const token = await mailedToken(t, 'Nina@Example.com', '/invitation')
    const preview = await t.app.inject({ method: 'POST', url: '/v1/invites/preview', payload: { token } })
    expect((preview.json() as { hasAccount: boolean }).hasAccount).toBe(true)
    // creating a second account for that address is refused
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/signup', payload: { token, name: 'N', password: NEW_PW } })).statusCode).toBe(409)
    // another person's account cannot use the link
    const stranger = await signUpAndIn(t)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/accept', headers: stranger.auth, payload: { token } })).statusCode).toBe(403)
    // an anonymous call is refused
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/accept', payload: { token } })).statusCode).toBe(401)

    const accept = await t.app.inject({ method: 'POST', url: '/v1/invites/accept', headers: other.auth, payload: { token } })
    expect(accept.statusCode).toBe(200)
    expect(accept.json()).toEqual({ team: { id: owner.teamId, name: 'Équipe de Test' }, role: 'member' })
    // the current device keeps its team; the next login uses the new one
    expect((await me(t, other.auth)).team.id).toBe(other.teamId)
    const next = await signIn(t, 'nina@example.com', PASSWORD)
    expect((await me(t, { authorization: `Bearer ${next.accessToken}` })).team.id).toBe(owner.teamId)
    // used once
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/accept', headers: other.auth, payload: { token } })).statusCode).toBe(410)
  })

  it('a link expires after 7 days', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    await invite(t, owner, 'late@example.com')
    const token = await mailedToken(t, 'late@example.com', '/invitation')
    expect(INVITE_TTL_MS).toBe(7 * DAY_MS)
    t.clock.advance(INVITE_TTL_MS + 1000)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/preview', payload: { token } })).statusCode).toBe(410)
    expect((await t.app.inject({ method: 'POST', url: '/v1/invites/signup', payload: { token, name: 'L', password: NEW_PW } })).statusCode).toBe(410)
    // the owner's access token expired meanwhile: a fresh sign-in sees no pending invitation
    const fresh = await signIn(t, owner.email)
    const list = await t.app.inject({ url: '/v1/team/invites', headers: { authorization: `Bearer ${fresh.accessToken}` } })
    expect((list.json() as { invites: unknown[] }).invites).toEqual([])
  })

  it('a team sends at most 20 invitations an hour', async () => {
    const t = makeCloud({ server: { requestsPerMinute: 1000 } })
    const owner = await signUpAndIn(t)
    for (let i = 0; i < INVITE_LIMIT.perTeam; i++) expect((await invite(t, owner, `p${i}@example.com`)).statusCode).toBe(200)
    expect((await invite(t, owner, 'one-too-many@example.com')).statusCode).toBe(429)
  })

  it('the invitation e-mail exists in French and English and names the inviter and the team', () => {
    const tpl = { kind: 'invite' as const, name: '', inviter: 'Charlie', team: 'Les Énigmes', role: 'member' as const, link: 'https://atelier.example/invitation?token=inv_x' }
    expect(render(tpl, 'fr').subject).toBe('Charlie t’invite dans l’équipe Les Énigmes sur Atelier')
    expect(render(tpl, 'en').text).toContain('join the Les Énigmes team')
    expect(render(tpl, 'fr').text).toContain('https://atelier.example/invitation?token=inv_x')
  })
})

describe('the device page: « Créer un compte »', () => {
  async function start(t: TestCloud) {
    const { verifier, challenge } = newVerifier()
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/device/start', payload: { codeChallenge: challenge, codeChallengeMethod: 'S256', deviceName: 'PC de test' } })
    return { ...(res.json() as { deviceCode: string; userCode: string }), verifier }
  }
  const post = (t: TestCloud, fields: Record<string, string>) =>
    t.app.inject({ method: 'POST', url: '/device', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() })

  it('the login page links to the sign-up form, which creates an unverified account and approves the device', async () => {
    const t = makeCloud()
    const { deviceCode, userCode, verifier } = await start(t)
    const login = await t.app.inject({ url: `/device?code=${userCode}` })
    expect(login.body).toContain('Créer un compte')
    expect(login.body).toContain('new=1')
    const form = await t.app.inject({ url: `/device?code=${userCode}&new=1` })
    expect(form.statusCode).toBe(200)
    expect(form.body).toContain('name="name"')
    expect(form.headers['content-security-policy']).toContain("default-src 'none'")
    expect(form.body).not.toContain('<script')

    const done = await post(t, { code: userCode, name: 'Sam', email: 'sam@example.com', password: NEW_PW })
    expect(done.statusCode).toBe(200)
    expect(done.body).toContain('Appareil autorisé')
    const poll = await t.app.inject({ method: 'POST', url: '/v1/auth/device/poll', payload: { deviceCode, codeVerifier: verifier } })
    expect(poll.statusCode).toBe(200)
    const who = await me(t, { authorization: `Bearer ${(poll.json() as { accessToken: string }).accessToken}` })
    expect(who).toMatchObject({ account: { email: 'sam@example.com', emailVerified: false }, role: 'owner' })
    expect(await mailedToken(t, 'sam@example.com', '/verifier')).not.toBeNull()
  })

  it('a taken address, a short password or a dead code re-show the form in French, and make no account', async () => {
    const t = makeCloud()
    await signUpAndIn(t, { email: 'taken@example.com' })
    const { userCode } = await start(t)
    const taken = await post(t, { code: userCode, name: 'T', email: 'taken@example.com', password: NEW_PW })
    expect(taken.statusCode).toBe(400)
    expect(taken.body).toContain('Un compte utilise déjà cette adresse')
    const short = await post(t, { code: userCode, name: 'S', email: 'short@example.com', password: 'short' })
    expect(short.statusCode).toBe(400)
    expect(short.body).toContain('10 caractères au moins')
    const dead = await post(t, { code: 'ZZZZ-ZZZZ', name: 'D', email: 'dead@example.com', password: NEW_PW })
    expect(dead.statusCode).toBe(400)
    expect(dead.body).toContain('inconnu ou a expiré')
    expect(t.cloud.accounts.accountByEmail('short@example.com')).toBeNull()
    expect(t.cloud.accounts.accountByEmail('dead@example.com')).toBeNull()
  })
})
