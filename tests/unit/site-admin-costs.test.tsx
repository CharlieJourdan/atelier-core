// Founder console › Coûts et rentabilité on the real Atelier Cloud (decision 0040): the beta banner (sold at cost), the
// top line, the team table (sortable, with totals), providers and engines with their failures, the fixed costs, the
// overall result and the break-even, the alerts; the helpers (sort, labels, amounts); and the site's own client
// against a real in-process Cloud: the answer parses with the shared contract and a fixed cost is saved and removed.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceDashboard as FinanceDashboardSchema } from '../../src/shared/cloud-admin-finance'
import { bucketLabel, parseAmount, sortTeams, usd, type FinanceDashboard, type FinanceTeamRow } from '../../web/src/admin/finance'
import { CostsView } from '../../web/src/admin/LiveCosts'
import { cloudHelpers, startCloud, type CloudRig } from './cloud-app-helpers'

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

const noop = (): void => undefined

function team(p: Partial<FinanceTeamRow> & Pick<FinanceTeamRow, 'teamId' | 'teamName'>): FinanceTeamRow {
  return {
    ownerEmail: `${p.teamId}@example.com`,
    internal: false,
    test: false,
    creditsOffered: 5000,
    creditsBought: 0,
    creditsSpent: 1200,
    balance: 3800,
    offeredLeft: 3800,
    jobs: 12,
    costUsdCents: 1304,
    costEurCents: 1200,
    revenueEurCents: 0,
    marginEurCents: -1200,
    videos: 2,
    minutes: 18,
    costPerMinuteEurCents: 66.67,
    ...p
  }
}

const SAMPLE: FinanceDashboard = {
  period: 'month',
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-01T15:00:00.000Z',
  includeDemo: false,
  demoCallsHidden: 3,
  paymentsSimulated: true,
  settings: { priceMultiplier: 1, eurPerUsd: 0.92, fxAsOf: '2026-10-30', creditValueEur: 0.01 },
  top: { offeredLeftCredits: 7600, offeredLeftCostEurCents: 7600, monthCostUsdCents: 2608, monthCostEurCents: 2400, monthCreditsSpent: 2400, alerts: 1 },
  teams: [team({ teamId: 'team_a', teamName: 'Studio Alpha' }), team({ teamId: 'team_b', teamName: 'Bêta Docs', costEurCents: 300, costUsdCents: 326, creditsSpent: 300, minutes: 0, videos: 0, costPerMinuteEurCents: null, marginEurCents: -300 })],
  totals: {
    creditsOffered: 10000,
    creditsBought: 0,
    creditsSpent: 1500,
    balance: 8500,
    offeredLeft: 8500,
    jobs: 24,
    costUsdCents: 1630,
    costEurCents: 1500,
    revenueEurCents: 0,
    marginEurCents: -1500,
    videos: 2,
    minutes: 18,
    costPerMinuteEurCents: 83.33
  },
  providers: [
    { provider: 'elevenlabs', engine: 'voice:elevenlabs-v3', demo: false, calls: 10, succeeded: 9, failed: 1, cancelled: 0, creditsBilled: 900, costUsdCents: 978, costEurCents: 900, estimated: 0 },
    { provider: 'fal-image', engine: 'image:flux-schnell', demo: false, calls: 30, succeeded: 30, failed: 0, cancelled: 0, creditsBilled: 600, costUsdCents: 652, costEurCents: 600, estimated: 2 }
  ],
  spend: [
    { bucket: '2026-11-01', costUsdCents: 1630, credits: 1500 },
    { bucket: '2026-11-02', costUsdCents: 0, credits: 0 }
  ],
  fixed: {
    costs: [
      { id: 'fc_heygen_plan', label: 'Abonnement HeyGen', amountCents: 14900, currency: 'USD', note: 'Business 149 $', monthlyEurCents: 13708, auto: false, demo: false },
      { id: 'auto:machines', label: 'Ordinateurs d’équipe (1 en marche, 0 en veille)', amountCents: 599, currency: 'EUR', note: null, monthlyEurCents: 599, auto: true, demo: true }
    ],
    monthlyEurCents: 13708,
    month: { revenueEurCents: 0, providerCostEurCents: 2400, fixedEurCents: 13708, resultEurCents: -16108, minutes: 18 },
    costPerMinuteEurCents: 83.33,
    marginPerMinuteEurCents: 0,
    breakEvenMinutes: null,
    breakEvenAt: { multiplier: 1.3, minutes: 549 }
  },
  alerts: [{ jobId: 'job_1', teamName: 'Studio Alpha', provider: 'elevenlabs', engine: 'voice:elevenlabs-v3', at: '2026-11-01T10:00:00.000Z', quotedUsdCents: 100, realUsdCents: 125, overPct: 25 }]
}

const render = (d: FinanceDashboard = SAMPLE): string =>
  renderToStaticMarkup(<CostsView d={d} period="month" includeDemo={false} onPeriod={noop} onDemo={noop} onChanged={noop} />)

describe('console › Coûts et rentabilité (real Cloud view)', () => {
  it('the sample is the shared contract’s shape', () => {
    expect(FinanceDashboardSchema.parse(SAMPLE)).toEqual(SAMPLE)
  })

  it('says the beta sells at cost, then the top line, the period filter and the demo switch', () => {
    const t = textOf(render())
    for (const s of [
      'Bêta : crédits vendus et offerts au prix coûtant (marge 0 %)',
      'Paiements simulés',
      'Crédits offerts restants',
      '7 600',
      'Dépense fournisseurs ce mois-ci',
      'Résultat du mois',
      '-161,08 €',
      'Alertes de dépassement',
      'Aujourd’hui',
      '7 derniers jours',
      'Depuis le début',
      'Compter les appels en démo'
    ]) {
      expect(t).toContain(s)
    }
  })

  it('a row per team with credits offered / bought / spent, real cost in € and $, revenue, margin, minutes and cost per minute; a total', () => {
    const html = render()
    const t = textOf(html)
    expect(html.match(/data-testid="finance-team"/g)).toHaveLength(2)
    for (const s of ['Studio Alpha', 'team_a@example.com', 'Offerts', 'Achetés', 'Dépensés', 'Coût réel', 'Revenus', 'Marge', '€ / minute', '12,00 €', '13,04 $US', '0,67 €', 'Total']) {
      expect(t).toContain(s)
    }
    // sorted by real cost, biggest first, by default
    expect(t.indexOf('Studio Alpha')).toBeLessThan(t.indexOf('Bêta Docs'))
    expect(html).toContain('aria-sort="descending"')
  })

  it('providers and engines with calls, failures (not billed), credits and real cost; fixed costs; the result and the break-even', () => {
    const html = render()
    const t = textOf(html)
    expect(html.match(/data-testid="finance-provider"/g)).toHaveLength(2)
    for (const s of ['voice:elevenlabs-v3', 'Échecs (non facturés)', '2 estimés', 'Abonnement HeyGen', '149,00 $US', 'calculé par le Cloud · démo, non compté']) expect(t).toContain(s)
    for (const s of ['Résultat global', 'Point mort', 'jamais à marge 0 %', 'Avec un multiplicateur × 1,30, il faudrait 549 minutes finies par mois']) expect(t).toContain(s)
    for (const s of ['Alertes', '+25 %', 'Multiplicateur de prix', '1 $ en €']) expect(t).toContain(s)
  })

  it('a margin: no beta banner, the break-even in minutes', () => {
    const t = textOf(
      render({ ...SAMPLE, settings: { ...SAMPLE.settings, priceMultiplier: 1.3 }, fixed: { ...SAMPLE.fixed, breakEvenMinutes: 549, marginPerMinuteEurCents: 25 } })
    )
    expect(t).not.toContain('Bêta : crédits vendus')
    expect(t).toContain('× 1,30 (marge 30 %)')
    expect(t).toContain('549 minutes finies par mois paient les frais fixes')
  })

  it('helpers: sort (null cost per minute last), bucket labels, amounts, small dollar amounts', () => {
    const rows = SAMPLE.teams
    expect(sortTeams(rows, 'teamName', 'asc').map((r) => r.teamName)).toEqual(['Bêta Docs', 'Studio Alpha'])
    expect(sortTeams(rows, 'costPerMinuteEurCents', 'asc').map((r) => r.teamId)).toEqual(['team_a', 'team_b'])
    expect(sortTeams(rows, 'costPerMinuteEurCents', 'desc').map((r) => r.teamId)).toEqual(['team_a', 'team_b'])
    expect(sortTeams(rows, 'creditsSpent', 'asc').map((r) => r.teamId)).toEqual(['team_b', 'team_a'])
    expect([bucketLabel('2026-11-01T14'), bucketLabel('2026-11-01'), bucketLabel('2026-11')]).toEqual(['14 h', '01/11', 'nov. 26'])
    expect([parseAmount('49'), parseAmount('5,99'), parseAmount(' 1 200 '), parseAmount('abc'), parseAmount('-3')]).toEqual([4900, 599, 120000, null, null])
    expect(usd(0.3).replace(/\s/g, ' ')).toBe('0,003 $US')
  })
})

describe('console › Coûts et rentabilité against a real Cloud', () => {
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

  it('the site signs in as a platform admin, reads the dashboard (shared contract), saves and removes a fixed cost', async () => {
    const helpers = cloudHelpers as unknown as { signUpAndIn(t: CloudRig['t'], p: { platformAdmin?: boolean; email?: string }): Promise<unknown> }
    await helpers.signUpAndIn(rig.t, { platformAdmin: true, email: 'founder@example.com' })
    vi.stubEnv('VITE_ATELIER_CLOUD', rig.baseUrl)
    vi.resetModules()
    const site = await import('../../web/src/cloud')
    const fin = await import('../../web/src/admin/finance')
    await expect(fin.fetchFinance('month', false)).rejects.toMatchObject({ status: 401 })
    expect(await site.cloudAdminLogin('founder@example.com', cloudHelpers.PASSWORD)).toBe(true)
    const d = FinanceDashboardSchema.parse(await fin.fetchFinance('all', true))
    expect(d.settings.priceMultiplier).toBe(1)
    expect(d.teams.find((x) => x.teamId === rig.teamId)).toMatchObject({ creditsOffered: 1200, creditsSpent: 0, balance: 1200 })
    const saved = await fin.saveFixedCost({ label: 'Abonnement Claude', amountCents: 9000, currency: 'EUR' })
    expect((await fin.fetchFinance('month', false)).fixed.costs.map((c) => c.label)).toContain('Abonnement Claude')
    await fin.removeFixedCost(saved.cost.id)
    expect((await fin.fetchFinance('month', false)).fixed.costs.map((c) => c.label)).not.toContain('Abonnement Claude')
    expect((await fin.saveSettings({ priceMultiplier: 1.25 })).priceMultiplier).toBe(1.25)
  })
})
