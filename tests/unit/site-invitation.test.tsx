// The site's /invitation page: rendered in plain Node in its states (French and English), and its Cloud client against a
// real in-process Cloud (fetch routed to the Fastify app): a new person creates an account from the link and joins the
// team, a person with an account signs in and accepts.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../web/src/App'
import { signOut } from '../../web/src/auth'
import { Invitation } from '../../web/src/pages/Invitation'
import { setLang } from '../../web/src/i18n'

// The Cloud's sources import each other with .ts extensions: loaded through a computed path (typed by hand), like site-mail.
interface Inject {
  inject(o: { method?: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<{ statusCode: number; body: string; headers: Record<string, unknown>; json(): unknown }>
}
interface TestCloud {
  app: Inject
  cloud: { accounts: { members(teamId: string): { email: string; role: string }[] } }
}
interface Person {
  teamId: string
  email: string
  auth: { authorization: string }
}
const HELPERS = 'helpers'
const { mailedToken, makeCloud, signUpAndIn, PASSWORD } = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(): TestCloud
  mailedToken(t: TestCloud, email: string, path: string): Promise<string | null>
  signUpAndIn(t: TestCloud, p?: { email?: string }): Promise<Person>
  PASSWORD: string
}

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&amp;|&lt;|&gt;|&quot;/g, (m) => ({ '&#x27;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[m] as string)
    .replace(/\s+/g, ' ')

beforeEach(() => {
  setLang('fr')
  signOut()
})

describe('the invitation page', () => {
  const invite = { teamName: 'Les Énigmes', email: 'lea@example.com', invitedBy: 'Charlie', role: 'member' as const, hasAccount: false }

  it('is routed, and without a Cloud says it is a demo', () => {
    const html = renderToStaticMarkup(<App initialPath="/invitation" />)
    expect(html).toContain('data-testid="invite-state"')
    expect(textOf(renderToStaticMarkup(<Invitation initial={{ kind: 'demo' }} />))).toContain('Démonstration')
  })

  it('a new person sees who invites to which team, and a sign-up form with the address fixed', () => {
    const html = renderToStaticMarkup(<Invitation initial={{ kind: 'ready', invite }} />)
    const text = textOf(html)
    expect(text).toContain('Charlie t’invite dans l’équipe Les Énigmes, comme membre.')
    expect(text).toContain('Créer mon compte et rejoindre l’équipe')
    expect(html).toContain('data-mode="signup"')
    expect(html).toContain('value="lea@example.com"')
    expect(html).toContain('readOnly=""')
  })

  it('a person with an account signs in; done and invalid states; English too', () => {
    const login = renderToStaticMarkup(<Invitation initial={{ kind: 'ready', invite: { ...invite, hasAccount: true, role: 'admin' } }} />)
    expect(login).toContain('data-mode="login"')
    expect(textOf(login)).toContain('comme administrateur')
    expect(login).not.toContain('id="name"')
    expect(textOf(renderToStaticMarkup(<Invitation initial={{ kind: 'done', team: 'Les Énigmes' }} />))).toContain('Tu as rejoint l’équipe Les Énigmes : ouvre Atelier et connecte-toi.')
    expect(textOf(renderToStaticMarkup(<Invitation initial={{ kind: 'invalid' }} />))).toContain('Ce lien n’est plus valable')
    setLang('en')
    expect(textOf(renderToStaticMarkup(<Invitation initial={{ kind: 'ready', invite }} />))).toContain('Charlie invites you to the Les Énigmes team, as a member.')
  })
})

describe('the site client against a real Cloud: invitations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function boot() {
    const t = makeCloud()
    vi.stubEnv('VITE_ATELIER_CLOUD', 'http://127.0.0.1:8787')
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5190', assign: () => undefined } })
    vi.resetModules()
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const u = new URL(url)
      const res = await t.app.inject({
        method: init.method ?? 'GET',
        url: u.pathname + u.search,
        headers: init.headers as Record<string, string>,
        ...(typeof init.body === 'string' ? { payload: init.body } : {})
      })
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
    })
    const site = await import('../../web/src/cloud')
    return { t, site }
  }

  it('a new person creates the account from the link and joins as member; the link then stops working', async () => {
    const { t, site } = await boot()
    const owner = await signUpAndIn(t)
    expect((await t.app.inject({ method: 'POST', url: '/v1/team/invites', headers: owner.auth, payload: { email: 'new@example.com' } })).statusCode).toBe(200)
    const token = (await mailedToken(t, 'new@example.com', '/invitation'))!
    const preview = await site.cloudInvitePreview(token)
    expect(preview).toMatchObject({ email: 'new@example.com', hasAccount: false, role: 'member' })
    await site.cloudInviteSignup(token, 'Nouvelle', 'a long enough passphrase')
    expect(await site.cloudMe()).toEqual({ name: 'Nouvelle', email: 'new@example.com', emailVerified: true })
    expect(t.cloud.accounts.members(owner.teamId).map((m) => [m.email, m.role])).toContainEqual(['new@example.com', 'member'])
    await expect(site.cloudInvitePreview(token)).rejects.toMatchObject({ status: 410 })
  })

  it('a person with an account signs in and accepts; another account cannot', async () => {
    const { t, site } = await boot()
    const owner = await signUpAndIn(t)
    await signUpAndIn(t, { email: 'has@example.com' })
    await signUpAndIn(t, { email: 'other@example.com' })
    await t.app.inject({ method: 'POST', url: '/v1/team/invites', headers: owner.auth, payload: { email: 'has@example.com' } })
    const token = (await mailedToken(t, 'has@example.com', '/invitation'))!
    expect((await site.cloudInvitePreview(token)).hasAccount).toBe(true)
    await site.cloudLogin('other@example.com', PASSWORD)
    await expect(site.cloudInviteAccept(token)).rejects.toMatchObject({ status: 403 })
    await site.cloudLogin('has@example.com', PASSWORD)
    expect(await site.cloudInviteAccept(token)).toEqual({ team: { id: owner.teamId, name: 'Équipe de Test' }, role: 'member' })
  })
})
