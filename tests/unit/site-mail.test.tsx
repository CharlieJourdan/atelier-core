// The site's e-mail pages render in plain Node (renderToStaticMarkup): the « Vérifie ton adresse » banner, /verifier,
// « Mot de passe oublié » and /nouveau-mot-de-passe, in French and English; and the site's Cloud client talks to a real
// in-process Cloud (fetch routed to the Fastify app) through sign-up, verification, resend and password reset.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../web/src/App'
import { signOut, setPendingPlan } from '../../web/src/auth'
import { VerifyBannerView, type ResendState } from '../../web/src/components/VerifyBanner'
import { en } from '../../web/src/content-en'
import { fr } from '../../web/src/content-fr'
import { ForgotPassword, ResetPassword, VerifyEmail } from '../../web/src/pages/AccountMail'
import { setLang, translate } from '../../web/src/i18n'

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: they are loaded
// through a computed path (typed here by hand) so the typecheck never walks into cloud/.
interface TestCloud {
  app: { inject(o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> }
  cloud: {
    mail: { idle(): Promise<void> }
    outbox: { list(o?: { to?: string; limit?: number }): { subject: string; text: string }[] } | null
  }
}
const HELPERS = 'helpers'
const { confirmEmail, mailedToken, makeCloud } = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(): TestCloud
  confirmEmail(t: TestCloud, email: string): Promise<void>
  mailedToken(t: TestCloud, email: string, path: string): Promise<string | null>
}

const textOf = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&amp;|&lt;|&gt;|&quot;/g, (m) => ({ '&#x27;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[m] as string)
    .replace(/\s+/g, ' ')

const render = (path: string): string => textOf(renderToStaticMarkup(<App initialPath={path} />))

beforeEach(() => {
  setLang('fr')
  signOut()
  setPendingPlan(null)
})

describe('the e-mail pages', () => {
  it('/mot-de-passe-oublie asks for an address and links back to the login', () => {
    const html = renderToStaticMarkup(<App initialPath="/mot-de-passe-oublie" />)
    const t = textOf(html)
    expect(t).toContain('Mot de passe oublié')
    expect(t).toContain('si un compte existe, tu reçois un lien')
    expect(t).toContain('Envoyer le lien')
    expect(html).toContain('type="email"')
    expect(html).toContain('href="/connexion"')
  })

  it('the confirmation is the same for every address: it never says whether an account exists', () => {
    const t = textOf(renderToStaticMarkup(<ForgotPassword initialSent />))
    expect(t).toContain('Si un compte existe avec cette adresse, un e-mail vient de partir.')
    expect(t).toContain('valable 1 heure')
    expect(t).not.toMatch(/n’existe pas|introuvable|inconnu/i)
  })

  it('/nouveau-mot-de-passe asks for the new password twice; its done and invalid-link states point to the next step', () => {
    const form = renderToStaticMarkup(<ResetPassword token="rst_abc" />)
    expect((form.match(/type="password"/g) ?? []).length).toBe(2)
    expect(textOf(form)).toContain('au moins 10 caractères')
    expect(textOf(form)).toContain('Tous tes appareils seront déconnectés')
    const done = renderToStaticMarkup(<ResetPassword token="rst_abc" initial="done" />)
    expect(textOf(done)).toContain('Mot de passe changé')
    expect(done).toContain('href="/connexion"')
    const bad = renderToStaticMarkup(<ResetPassword token="rst_abc" initial="invalid" />)
    expect(textOf(bad)).toContain('expiré ou a déjà servi')
    expect(bad).toContain('href="/mot-de-passe-oublie"')
  })

  it('/verifier shows each outcome of the link and the next step', () => {
    const states = {
      working: 'nous vérifions ton lien',
      ok: 'Adresse confirmée',
      invalid: 'Lien invalide',
      network: 'Atelier Cloud ne répond pas',
      demo: 'pas d’adresse à confirmer'
    } as const
    for (const [state, text] of Object.entries(states)) {
      const html = renderToStaticMarkup(<VerifyEmail token="ver_abc" initial={state as keyof typeof states} />)
      expect(textOf(html), state).toContain(text)
      expect(html).toContain(`data-state="${state}"`)
    }
    expect(renderToStaticMarkup(<VerifyEmail initial="ok" />)).toContain('href="/bienvenue"')
    expect(renderToStaticMarkup(<VerifyEmail initial="invalid" />)).toContain('href="/connexion"')
    // the routes exist
    expect(render('/verifier')).toContain('Vérification')
    expect(render('/nouveau-mot-de-passe')).toContain('Nouveau mot de passe')
  })

  it('the login page has « Mot de passe oublié ? »; the sign-up page does not', () => {
    const login = renderToStaticMarkup(<App initialPath="/connexion" />)
    expect(textOf(login)).toContain('Mot de passe oublié ?')
    expect(login).toContain('href="/mot-de-passe-oublie"')
    expect(renderToStaticMarkup(<App initialPath="/inscription" />)).not.toContain('/mot-de-passe-oublie')
  })

  it('the banner says where the link went (the address is escaped), offers the resend, and shows its outcome', () => {
    const t = (key: string, vars?: Record<string, string | number>) => translate('fr', key, vars)
    const view = (state: ResendState, email = 'lea@example.com') => renderToStaticMarkup(<VerifyBannerView email={email} state={state} onResend={() => undefined} t={t} />)
    const idle = view('idle')
    expect(textOf(idle)).toContain('Vérifie ton adresse')
    expect(textOf(idle)).toContain('Nous avons envoyé un lien à lea@example.com')
    expect(textOf(idle)).toContain('ni lancer de travail payant')
    expect(textOf(idle)).toContain('Renvoyer l’e-mail')
    expect(idle).not.toContain('data-testid="verify-note"')
    expect(view('busy')).toContain('disabled')
    expect(textOf(view('sent'))).toContain('E-mail renvoyé')
    expect(textOf(view('limit'))).toContain('réessaie dans quelques minutes')
    expect(textOf(view('already'))).toContain('déjà confirmée')
    expect(view('idle', '<b>x</b>@example.com')).not.toContain('<b>x</b>')
    // and in English
    const en1 = renderToStaticMarkup(<VerifyBannerView email="lea@example.com" state="idle" onResend={() => undefined} t={(k, v) => translate('en', k, v)} />)
    expect(textOf(en1)).toContain('Verify your address')
    expect(textOf(en1)).toContain('Resend the e-mail')
  })

  it('the English pages render too', () => {
    setLang('en')
    expect(render('/mot-de-passe-oublie')).toContain('Enter your e-mail address')
    expect(render('/nouveau-mot-de-passe')).toContain('Choose a password of at least 10 characters')
    expect(render('/connexion')).toContain('Forgot your password?')
  })

  it('the new copy exists in both languages, with no exclamation mark and no emoji', () => {
    const keys = Object.keys(fr).filter((k) => /^(forgot|reset|verify)\./.test(k) || k === 'auth.forgot' || k === 'welcome.pay.unverified' || /^title\.(verify|forgot|reset)$/.test(k))
    expect(keys.length).toBeGreaterThan(30)
    for (const k of keys) {
      const f = (fr as Record<string, string>)[k] as string
      const e = (en as Record<string, string>)[k]
      expect(e, k).toBeTruthy()
      for (const s of [f, e as string]) {
        expect(s, k).not.toContain('!')
        expect(s, k).not.toMatch(/\p{Emoji_Presentation}/u)
      }
    }
  })
})

describe('the site client against a real Cloud', () => {
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
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const u = new URL(url)
      calls.push({ url: u.pathname, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
      const res = await t.app.inject({
        method: (init.method ?? 'GET') as 'GET' | 'POST',
        url: u.pathname + u.search,
        headers: init.headers as Record<string, string>,
        ...(typeof init.body === 'string' ? { payload: init.body } : {})
      })
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
    })
    const site = await import('../../web/src/cloud')
    return { t, site, calls }
  }

  it('sign-up in English mails an English link; the account is unverified until /verifier’s call, the resend is limited, then verified', async () => {
    const { t, site, calls } = await boot()
    expect(site.cloudEnabled()).toBe(true)
    await site.cloudSignup('Léa', 'lea@example.com', 'correct horse battery', 'en')
    expect(calls[0]).toMatchObject({ url: '/v1/auth/signup', body: { lang: 'en' } })
    expect(await site.cloudMe()).toEqual({ name: 'Léa', email: 'lea@example.com', emailVerified: false })
    await t.cloud.mail.idle()
    expect(t.cloud.outbox!.list({ to: 'lea@example.com' })[0]!.subject).toBe('Confirm your e-mail address')
    expect(await site.cloudResendVerification()).toEqual({ ok: true, alreadyVerified: false })
    const err = await (async () => {
      for (let i = 0; i < 5; i++) await site.cloudResendVerification()
    })().catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 429, code: 'rate_limited' })
    const token = (await mailedToken(t, 'lea@example.com', '/verifier'))!
    await site.cloudVerifyEmail(token)
    expect((await site.cloudMe()).emailVerified).toBe(true)
    await expect(site.cloudVerifyEmail(token)).rejects.toMatchObject({ status: 410 })
    expect(await site.cloudResendVerification()).toEqual({ ok: true, alreadyVerified: true })
  })

  it('paying is refused with a 403 until the address is verified', async () => {
    const { t, site } = await boot()
    await site.cloudSignup('Léa', 'pay@example.com', 'correct horse battery')
    await expect(site.cloudSubscribe('starter', 'monthly')).rejects.toMatchObject({ status: 403 })
    await confirmEmail(t, 'pay@example.com')
    await expect(site.cloudSubscribe('starter', 'monthly')).resolves.toBe('paid')
  })

  it('« mot de passe oublié » then the new password: the old one stops working, the new one signs in', async () => {
    const { t, site } = await boot()
    await site.cloudSignup('Léa', 'forgot@example.com', 'correct horse battery', 'fr')
    await site.cloudForgotPassword('forgot@example.com', 'fr')
    // an unknown address gets the very same answer
    await expect(site.cloudForgotPassword('nobody@example.com', 'fr')).resolves.toEqual({ ok: true })
    const token = (await mailedToken(t, 'forgot@example.com', '/nouveau-mot-de-passe'))!
    await expect(site.cloudResetPassword(token, 'short')).rejects.toMatchObject({ status: 400 })
    await site.cloudResetPassword(token, 'a brand new passphrase')
    await expect(site.cloudResetPassword(token, 'another brand new one')).rejects.toMatchObject({ status: 410 })
    await expect(site.cloudLogin('forgot@example.com', 'correct horse battery')).rejects.toMatchObject({ status: 401 })
    await expect(site.cloudLogin('forgot@example.com', 'a brand new passphrase')).resolves.toEqual({ name: 'Léa' })
  })
})
