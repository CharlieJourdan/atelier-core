// The beta, the app's side of the Cloud account (in-process Cloud on the loopback, fakes, nothing paid): the profile the
// sidebar shows (name, team, plan, credits from /v1/me + /v1/billing), the « Équipe » block (members and pending
// invitations, inviting by e-mail and revoking), the address a new install starts from (ATELIER_CLOUD_URL) and the device
// login that stays on this computer when a team computer answers the rest.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_CLOUD_URL } from '../../src/main/cloud/session'
import { LOCAL_WHEN_REMOTE } from '../../src/main/brain/route'
import { loginPage } from '../../src/main/api/cloud'
import { CLOUD_METHODS } from '../../src/shared/api'
import { buildCloudUrl } from '../../src/shared/build-cloud'
import { appCore, connect, startCloud } from './cloud-app-helpers'

describe('the build-time Cloud address', () => {
  it('comes from ATELIER_CLOUD_URL, else ATELIER_BETA_CLOUD (npm run dist), else nothing (the loopback Cloud)', () => {
    expect(buildCloudUrl({})).toBe('')
    expect(buildCloudUrl({ ATELIER_BETA_CLOUD: ' https://beta.example:8443 ' })).toBe('https://beta.example:8443')
    expect(buildCloudUrl({ ATELIER_BETA_CLOUD: 'https://beta.example', ATELIER_CLOUD_URL: 'https://other.example' })).toBe('https://other.example')
    expect(buildCloudUrl({ ATELIER_CLOUD_URL: '', ATELIER_BETA_CLOUD: '' })).toBe('')
  })

  it('the build config feeds the main process with it, and no tailnet or hosted address is written in the source', () => {
    const cfg = readFileSync(path.join(__dirname, '../../electron.vite.config.ts'), 'utf8')
    expect(cfg).toContain('__ATELIER_CLOUD_URL__: JSON.stringify(buildCloudUrl(process.env))')
    for (const f of ['src/main/cloud/session.ts', 'src/main/index.ts', 'src/shared/build-cloud.ts', 'electron.vite.config.ts']) {
      expect(readFileSync(path.join(__dirname, '../..', f), 'utf8'), f).not.toMatch(/ts\.net|tailscale|https:\/\/[a-z0-9-]+\.[a-z]/i)
    }
  })
})

describe('cloud account in the app', () => {
  it('« Créer un compte » opens the Cloud page on its sign-up form; « Rouvrir la page » opens it again', async () => {
    const rig = await startCloud(0)
    const app = appCore()
    try {
      await app.core.api['cloud.setBaseUrl'](rig.baseUrl)
      const state = await app.core.api['cloud.connect']('signup')
      expect(state).toMatchObject({ pending: true })
      expect(app.opened[0]!.startsWith(`${rig.baseUrl}/device?code=`)).toBe(true)
      expect(app.opened[0]).toMatch(/\?code=[A-Z0-9-]+&new=1$/)
      const page = await rig.t.app.inject({ method: 'GET', url: app.opened[0]!.slice(rig.baseUrl.length) })
      expect(page.statusCode).toBe(200)
      expect(page.body).toContain('name="name"')
      await app.core.api['cloud.reopenLogin']()
      expect(app.opened[1]).toMatch(/\/device\?code=[A-Z0-9-]+$/)
      expect(loginPage('https://c.example/device?code=X', 'signup')).toBe('https://c.example/device?code=X&new=1')
      expect(loginPage('https://c.example/device', 'signup')).toBe('https://c.example/device?new=1')
    } finally {
      app.core.close()
    }
  })

  it('profile and team are null while signed out', async () => {
    const app = appCore()
    expect(await app.core.api['cloud.profile']()).toBeNull()
    expect(await app.core.api['cloud.team']()).toBeNull()
    app.core.close()
  })

  it('the profile has the names, the role, no plan yet and the credits', async () => {
    const rig = await startCloud(1500)
    const app = appCore()
    try {
      await connect(app, rig)
      const p = await app.core.api['cloud.profile']()
      expect(p).toEqual({
        email: rig.email,
        name: 'Charlie',
        teamName: 'Studio Charlie',
        role: 'owner',
        emailVerified: true,
        plan: null,
        planStatus: null,
        credits: { balance: 1500, held: 0, available: 1500 }
      })
      // a running plan shows (the Cloud's own billing state)
      ;(rig.t.cloud as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db
        .prepare(`INSERT INTO billing_subscriptions (team_id, plan, period, status, since, updated_at) VALUES (?, 'creator', 'month', 'active', ?, ?)`)
        .run(rig.teamId, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
      expect(await app.core.api['cloud.profile']()).toMatchObject({ plan: 'creator', planStatus: 'active' })
    } finally {
      app.core.close()
    }
  })

  it('the team block lists members, invites by e-mail (the link is never shown) and revokes', async () => {
    const rig = await startCloud(0)
    const app = appCore()
    try {
      await connect(app, rig)
      const api = app.core.api
      const before = await api['cloud.team']()
      expect(before).toEqual({ canInvite: true, members: [{ accountId: rig.accountId, email: rig.email, name: 'Charlie', role: 'owner' }], invites: [] })
      const invite = await api['cloud.invite']('Monteuse@Example.com', 'member')
      expect(invite).toMatchObject({ email: expect.stringMatching(/monteuse@example\.com/i), role: 'member', invitedBy: 'Charlie' })
      expect(JSON.stringify(invite)).not.toMatch(/token|inv_/)
      const team = await api['cloud.team']()
      expect(team?.invites.map((i) => i.id)).toEqual([invite.id])
      await expect(async () => api['cloud.invite']('pas-une-adresse')).rejects.toThrow('Adresse e-mail invalide')
      await expect(async () => api['cloud.invite']('x@example.com', 'owner' as never)).rejects.toThrow('Rôle inconnu')
      await api['cloud.revokeInvite'](invite.id)
      expect((await api['cloud.team']())?.invites).toEqual([])
      await expect(async () => api['cloud.revokeInvite']('../../etc')).rejects.toThrow('Invitation inconnue')
    } finally {
      app.core.close()
    }
  })

  it('a new install starts from the launch or build address, and a set address wins', async () => {
    expect((await appCore().core.api['cloud.status']()).baseUrl).toBe(DEFAULT_CLOUD_URL)
    const app = appCore({ cloudUrl: 'https://api.atelier.example' })
    expect((await app.core.api['cloud.status']()).baseUrl).toBe('https://api.atelier.example')
    // a default that the address rule refuses (plain http to another host) falls back to the local Cloud
    expect((await appCore({ cloudUrl: 'http://evil.example' }).core.api['cloud.status']()).baseUrl).toBe(DEFAULT_CLOUD_URL)
    await app.core.api['cloud.setBaseUrl']('http://127.0.0.1:9999')
    expect((await app.core.api['cloud.status']()).baseUrl).toBe('http://127.0.0.1:9999')
  })

  it('the account methods stay on this computer when a team computer is connected', () => {
    for (const m of ['cloud.reopenLogin', 'cloud.profile', 'cloud.team', 'cloud.invite', 'cloud.revokeInvite'] as const) {
      expect(CLOUD_METHODS).toContain(m)
      expect(LOCAL_WHEN_REMOTE.has(m)).toBe(true)
    }
  })
})
