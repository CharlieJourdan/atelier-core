// Marketing site, pricing and account pages render in plain Node (renderToStaticMarkup, no window): key French texts,
// the plan grid of research note BUSINESS-INFRA (old repository) §6.2, the English dictionary and the fictive auth flow.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { App, NotFound } from '../../web/src/App'
import { saveUser, signOut, setPendingPlan } from '../../web/src/auth'
import { en } from '../../web/src/content-en'
import { fr } from '../../web/src/content-fr'
import { fmtEuro, setLang, translate } from '../../web/src/i18n'
import { CREDIT_PACKS, PLANS, computerSpec, monthlyPrice, yearlyTotal } from '../../web/src/plans'

/** Visible text of a rendered page: tags removed, every kind of space collapsed (the euro format uses narrow no-break spaces). */
const textOf = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#x27;|&amp;/g, (m) => (m === '&amp;' ? '&' : m === '&#x27;' ? "'" : ' '))
    .replace(/\s+/g, ' ')

const render = (path: string): string => textOf(renderToStaticMarkup(<App initialPath={path} />))
const renderHtml = (path: string): string => renderToStaticMarkup(<App initialPath={path} />)

beforeEach(() => {
  setLang('fr')
  signOut()
  setPendingPlan(null)
})

describe('landing page', () => {
  it('shows the hero, the CTAs and the nav', () => {
    const t = render('/')
    expect(t).toContain('L’équipe IA qui fait tourner tes chaînes YouTube.')
    expect(t).toContain('Commencer')
    expect(t).toContain('Voir la démo')
    expect(t).toContain('Se connecter')
    expect(t).toContain('Essayer')
    expect(t).toContain('Produit')
    expect(t).toContain('Tarifs')
  })

  it('has every section of the brief', () => {
    const t = render('/')
    for (const title of [
      'Une équipe, pas un outil',
      'Ton planning se remplit tout seul',
      'Des pipelines qui copient ce qui marche',
      'Il regarde les vidéos comme un expert',
      'Traduis une chaîne qui marche',
      'Tu valides ce que tu veux',
      'Ton abonnement Claude Code fait le gros du travail'
    ])
      expect(t).toContain(title)
    // automation matrix, pricing teaser, closing call to action
    expect(t).toContain('Jamais sans ton accord')
    expect(t).toContain('Un prix à la taille de ton équipe')
    expect(t).toContain('Mets ton équipe au travail.')
  })

  it('links the demo to /app/ and the product screenshots by stable name', () => {
    const html = renderHtml('/')
    expect(html).toContain('href="/app/"')
    expect(html).toContain('/shots/accueil-dark.png')
    expect(html).toContain('/shots/agents-dark.png')
  })

  it('has eight honest FAQ entries', () => {
    const html = renderHtml('/')
    expect((html.match(/<details/g) ?? []).length).toBe(8)
    const t = textOf(html)
    expect(t).toContain('Atelier ne met jamais une vidéo en ligne sans ton accord explicite.')
    expect(t).toContain('Atelier ne partage ni ne revend aucun abonnement')
    expect(t).toContain('1 crédit = 0,01 €')
    expect(t).toContain('n’est affilié ni à Anthropic, ni à OpenAI, ni à YouTube')
  })

  it('has no emoji and no exclamation mark in the copy', () => {
    const t = render('/')
    expect(t).not.toMatch(/\p{Emoji_Presentation}/u)
    expect(t).not.toContain('!')
  })
})

describe('pricing page', () => {
  it('lists the five plans and the enterprise offer with the exact prices', () => {
    const t = render('/tarifs')
    for (const price of ['49,99 €', '99,99 €', '199,99 €', '399,99 €', '799,99 €']) expect(t).toContain(price)
    for (const name of ['Starter', 'Creator', 'Studio', 'Agency', 'Network', 'Entreprise']) expect(t).toContain(name)
    expect(t).toContain('Sur devis')
    expect(t).toContain('1 999 €')
  })

  it('shows seats, channels, credits, computer and storage per plan', () => {
    const t = render('/tarifs')
    for (const p of PLANS) {
      expect(t).toContain(`${p.seats} place`)
      expect(t).toContain(computerSpec(p, 'fr'))
    }
    expect(t).toContain('1 500 crédits par mois')
    expect(t).toContain('30 000 crédits par mois')
    expect(t).toContain('4 vCPU · 8 Go · 80 Go')
    expect(t).toContain('50 Go de stockage')
    expect(t).toContain('2 To de stockage')
  })

  it('emphasises exactly one plan (Studio) and has the monthly / yearly toggle', () => {
    const html = renderHtml('/tarifs')
    expect((html.match(/Recommandé/g) ?? []).length).toBe(1)
    expect(html).toContain('Mensuel')
    expect(html).toContain('Annuel')
    expect(textOf(html)).toContain('−20 % en annuel')
  })

  it('explains credits, packs, top-up and what a video costs', () => {
    const t = render('/tarifs')
    expect(t).toContain('1 crédit = 0,01 €')
    for (const p of CREDIT_PACKS) expect(t).toContain(`Pack de ${new Intl.NumberFormat('fr-FR').format(p.credits).replace(/\s/g, ' ')} crédits`)
    expect(t).toContain('Recharge automatique')
    expect(t).toContain('≈ 40')
    expect(t).toContain('≈ 370')
    expect(t).toContain('≈ 1 200')
    expect(t).toContain('2 900 – 5 200')
    expect(t).toContain('Short Reddit de 60 secondes')
  })

  it('has a comparison table with one column per plan', () => {
    const html = renderHtml('/tarifs')
    expect(html).toContain('<table')
    expect(textOf(html)).toContain('Comparer tous les plans')
    expect((html.match(/<th[^>]*scope="col"/g) ?? []).length).toBe(7)
  })

  it('computes the yearly price with 20 % off', () => {
    const studio = PLANS.find((p) => p.id === 'studio')!
    expect(monthlyPrice(studio, 'yearly')).toBeCloseTo(159.99, 2)
    expect(yearlyTotal(studio)).toBeCloseTo(1919.88, 2)
    expect(fmtEuro(49.99, 'fr')).toMatch(/49,99\s€/)
  })
})

describe('account pages', () => {
  it('renders the login and signup forms with the simulated Google button', () => {
    const login = render('/connexion')
    expect(login).toContain('Se connecter')
    expect(login).toContain('Continuer avec Google')
    expect(login).toContain('Mot de passe')
    const signup = render('/inscription')
    expect(signup).toContain('Créer un compte')
    expect(signup).toContain('Prénom')
    expect(signup).toContain('aucun vrai compte n’est créé')
  })

  it('shows the plan choice first, with a signed-in user', () => {
    saveUser({ name: 'Alex', email: 'alex@example.com' })
    const t = render('/bienvenue')
    expect(t).toContain('Bienvenue, Alex')
    expect(t).toContain('Choisis ton plan')
    expect(t).toContain('199,99 €')
  })

  it('shows the simulated payment panel with a single confirm button once a plan is chosen', () => {
    saveUser({ name: 'Alex', email: 'alex@example.com', plan: 'studio' })
    // the step starts at the plan choice; the payment copy lives in the dictionary and never asks for card fields
    expect(fr['welcome.sim.title']).toBe('Paiement simulé')
    expect(fr['welcome.sim.confirm']).toBe('Confirmer (simulé)')
    expect(fr['welcome.sim.body']).toContain('Aucune carte n’est demandée')
    const html = renderHtml('/bienvenue')
    expect(html).not.toMatch(/autocomplete="cc-/)
  })

  it('resumes at the provisioning screen, then at the download screen', () => {
    saveUser({ name: 'Alex', email: 'alex@example.com', plan: 'studio', billing: 'monthly', subscribedAt: 1 })
    const prov = render('/bienvenue')
    for (const step of ['On prépare ton ordinateur d’équipe', 'Commande de la machine', 'Installation de Claude Code', 'Sécurisation', 'Prêt']) expect(prov).toContain(step)
    saveUser({ name: 'Alex', email: 'alex@example.com', plan: 'studio', billing: 'monthly', subscribedAt: 1, provisioned: true })
    const ready = render('/bienvenue')
    expect(ready).toContain('Télécharger pour Mac')
    expect(ready).toContain('Télécharger pour Windows')
    expect(ready).toContain('Ouvrir la web app')
    expect(renderHtml('/bienvenue')).toContain('href="/app/"')
  })
})

describe('i18n', () => {
  it('has the same keys in French and English, with the same placeholders', () => {
    const frKeys = Object.keys(fr).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(frKeys)
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort()
    for (const k of frKeys) expect(vars(en[k as keyof typeof en]), k).toEqual(vars(fr[k as keyof typeof fr]))
  })

  it('translates and interpolates', () => {
    expect(translate('en', 'hero.title')).toBe('The AI team that runs your YouTube channels.')
    expect(translate('fr', 'pr.cta', { plan: 'Studio' })).toBe('Choisir Studio')
    expect(translate('fr', 'does.not.exist')).toBe('does.not.exist')
  })

  it('renders the landing page in English once the toggle is flipped', () => {
    setLang('en')
    const t = render('/')
    expect(t).toContain('The AI team that runs your YouTube channels.')
    expect(t).toContain('A team, not a tool')
    expect(t).toContain('Atelier never puts a video online without your permission')
  })

  it('renders the pricing page in English with euro formatting', () => {
    setLang('en')
    const t = render('/tarifs')
    expect(t).toContain('Pricing sized to your team')
    expect(t).toContain('€199.99')
  })
})

describe('not found', () => {
  it('has a page for unknown routes', () => {
    expect(render('/nimportequoi')).toContain('Cette page n’existe pas')
    expect(textOf(renderToStaticMarkup(<NotFound />))).toContain('Retour à l’accueil')
  })
})
