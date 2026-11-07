// Founder console › Utilisateurs et CRM on the real Atelier Cloud: the table (plan, credits, spend over 30 days, machines,
// last activity, state), search filters and pages, the account drawer with its actions behind a confirmation, and the
// site's own client against a real in-process Cloud: answers parse with the shared contract, an admin action goes through
// and is audited. Without VITE_ATELIER_CLOUD the page stays the mock-up (site-admin.test.tsx).
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Admin } from '../../web/src/admin/Admin'
import { confirmText, listPath, planLabel, sinceLabel, type CrmAccount, type CrmDetail, type CrmPage } from '../../web/src/admin/crm'
import { AccountDrawer, UsersView } from '../../web/src/admin/LiveUsers'
import { setAdmin } from '../../web/src/auth'
import { Router } from '../../web/src/router'
import { CrmAccountDetail, CrmListResponse } from '../../src/shared/cloud-admin-crm'
import { cloudHelpers, startCloud, type CloudRig } from './cloud-app-helpers'

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

const noop = (): void => undefined

function account(p: Partial<CrmAccount> & Pick<CrmAccount, 'id' | 'email' | 'name'>): CrmAccount {
  return {
    platformAdmin: false,
    emailVerified: true,
    disabled: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    lastActiveAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    activeSessions: 2,
    team: { id: 'team_1', name: 'Studio Alpha', internal: false, role: 'owner', plan: 'pro', planStatus: 'active', balance: 4_250, available: 4_000, spent30d: 750, machines: 1 },
    ...p
  }
}

const PAGE: CrmPage = {
  accounts: [
    account({ id: 'acc_1', email: 'alice@example.com', name: 'Alice' }),
    account({ id: 'acc_2', email: 'bob@example.com', name: 'Bob', emailVerified: false, team: { id: 'team_2', name: 'Équipe de Bob', internal: false, role: 'owner', plan: null, planStatus: null, balance: 0, available: 0, spent30d: 0, machines: 0 } }),
    account({ id: 'acc_3', email: 'eve@example.com', name: 'Eve', disabled: true, lastActiveAt: null, activeSessions: 0 })
  ],
  total: 28,
  limit: 25,
  offset: 25
}

const view = (page: CrmPage = PAGE): string =>
  renderToStaticMarkup(<UsersView page={page} query="" status="all" openId={null} onQuery={noop} onStatus={noop} onOffset={noop} onOpen={noop} />)

describe('console › Utilisateurs (real Cloud view)', () => {
  it('lists accounts with team, plan, credits, 30-day spend, machines, last activity and state', () => {
    const html = view()
    const t = textOf(html)
    for (const h of ['Compte', 'Équipe et plan', 'Crédits', 'Dépensé 30 j', 'Machines', 'Dernière activité', 'État']) expect(t).toContain(h)
    expect(t).toContain('alice@example.com')
    expect(t).toContain('Studio Alpha')
    expect(t).toContain('Pro')
    expect(t).toContain('Sans plan')
    expect(t).toMatch(/4\s250/)
    expect(t).toContain('750')
    expect(t).toContain('il y a 3 h')
    expect(t).toContain('jamais')
    expect(t).toContain('Actif')
    expect(t).toContain('Adresse à vérifier')
    expect(t).toContain('Désactivé')
    expect((html.match(/data-testid="crm-row"/g) ?? []).length).toBe(3)
    // page 2 of 2
    expect(t).toContain('26–28 sur 28')
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('has a search, the state filters, and an empty state', () => {
    const html = view({ accounts: [], total: 0, limit: 25, offset: 0 })
    expect(html).toContain('aria-label="Rechercher un compte"')
    for (const f of ['Tous', 'Actifs', 'Adresse à vérifier', 'Désactivés']) expect(textOf(html)).toContain(f)
    expect(textOf(html)).toContain('Aucun compte ne correspond')
    expect(listPath('  alice ', 'disabled', 25)).toBe('/v1/admin/accounts?limit=25&offset=25&q=alice&status=disabled')
    expect(listPath('', 'all', 0)).toBe('/v1/admin/accounts?limit=25&offset=0')
  })

  it('the drawer shows the detail and offers the actions that fit the account', () => {
    const detail: CrmDetail = {
      account: PAGE.accounts[1]!,
      teams: [PAGE.accounts[1]!.team!],
      devices: [{ id: 'dev_1', name: 'Site (Chrome)', createdAt: '2026-10-01T10:00:00.000Z', lastSeenAt: null, revokedAt: null }],
      wallet: [{ id: 'we_1', kind: 'grant', credits: 500, note: 'bienvenue', createdAt: '2026-10-02T10:00:00.000Z' }],
      audit: [{ id: 9, at: '2026-10-02T10:00:00.000Z', actor: 'acc_admin', action: 'wallet.grant', target: 'team_2' }]
    }
    const html = renderToStaticMarkup(<AccountDrawer detail={detail} busy={false} onClose={noop} onAsk={noop} />)
    const t = textOf(html)
    expect(t).toContain('Bob')
    expect(t).toContain('Équipe de Bob')
    expect(t).toContain('Site (Chrome)')
    expect(t).toContain('+500')
    expect(t).toContain('wallet.grant')
    expect(html).toContain('data-testid="crm-grant"')
    expect(html).toContain('data-testid="crm-verify"') // the address is not verified
    expect(html).toContain('data-testid="crm-disable"')
    expect(html).toContain('data-testid="crm-revoke"')
    const off = renderToStaticMarkup(<AccountDrawer detail={{ ...detail, account: PAGE.accounts[2]! }} busy={false} onClose={noop} onAsk={noop} />)
    expect(off).toContain('data-testid="crm-enable"')
    expect(off).not.toContain('data-testid="crm-verify"')
  })

  it('every action is confirmed in plain words', () => {
    const bob = PAGE.accounts[1]!
    expect(confirmText({ kind: 'grant', credits: 1500, note: '', idempotencyKey: 'k-12345678' }, bob).ok).toMatch(/^Accorder 1\s500 crédits$/)
    expect(confirmText({ kind: 'disable' }, bob).body).toContain('déconnecté partout')
    expect(confirmText({ kind: 'revoke' }, bob).body).toContain('2 session(s)')
    expect(confirmText({ kind: 'verify' }, bob).body).toContain('bob@example.com')
    expect(planLabel({ ...PAGE.accounts[0]!.team!, planStatus: 'past_due' })).toBe('Pro (impayé)')
    expect(sinceLabel(null)).toBe('jamais')
  })

  it('in the mock-up console (no VITE_ATELIER_CLOUD) the page is still the demo CRM', () => {
    setAdmin(true)
    const html = renderToStaticMarkup(
      <Router initialPath="/admin/utilisateurs">
        <Admin />
      </Router>
    )
    expect(html).not.toContain('admin-live-users')
    expect(textOf(html)).toContain('Utilisateurs et CRM')
  })
})

describe('console › Utilisateurs against a real Cloud', () => {
  let rig: CloudRig
  beforeEach(async () => {
    rig = await startCloud(1200)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    const app = rig.t.app as unknown as { close(): Promise<void>; server: { closeAllConnections(): void } }
    app.server.closeAllConnections()
    await app.close()
  })

  it('the site signs in as a platform admin, reads the accounts and a detail (shared contract), and grants credits once', async () => {
    const helpers = cloudHelpers as unknown as { signUpAndIn(t: CloudRig['t'], p: { platformAdmin?: boolean; email?: string }): Promise<{ accessToken: string; accountId: string }> }
    await helpers.signUpAndIn(rig.t, { platformAdmin: true, email: 'founder@example.com' })
    vi.stubEnv('VITE_ATELIER_CLOUD', rig.baseUrl)
    vi.resetModules()
    const site = await import('../../web/src/cloud')
    const crm = await import('../../web/src/admin/crm')
    // not signed in: refused
    await expect(crm.fetchPage('', 'all', 0)).rejects.toMatchObject({ status: 401 })
    expect(await site.cloudAdminLogin('founder@example.com', cloudHelpers.PASSWORD)).toBe(true)
    const raw = await crm.fetchPage('charlie', 'all', 0)
    const page = CrmListResponse.parse(raw)
    expect(page.total).toBe(1)
    expect(page.accounts[0]).toMatchObject({ id: rig.accountId, team: { name: 'Studio Charlie', balance: 1200 } })
    const html = view(raw)
    expect(textOf(html)).toContain('Studio Charlie')
    const detail = CrmAccountDetail.parse(await crm.fetchDetail(rig.accountId))
    expect(detail.wallet[0]).toMatchObject({ kind: 'grant', credits: 1200 })
    const key = crm.newGrantKey()
    await crm.runAction(rig.accountId, { kind: 'grant', credits: 300, note: 'test console', idempotencyKey: key })
    await crm.runAction(rig.accountId, { kind: 'grant', credits: 300, note: 'test console', idempotencyKey: key })
    expect(rig.t.cloud.wallet.state(rig.teamId).balance).toBe(1500)
    const after = CrmAccountDetail.parse(await crm.fetchDetail(rig.accountId))
    expect(after.audit.filter((e) => e.action === 'wallet.grant')).toHaveLength(2) // the seed and the console's, once
    await crm.runAction(rig.accountId, { kind: 'revoke' })
    expect(CrmAccountDetail.parse(await crm.fetchDetail(rig.accountId)).audit.map((e) => e.action)).toContain('admin.revoke_sessions')
  })
})
