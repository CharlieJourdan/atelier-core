// The « Atelier Cloud » panel of Réglages (lot P5), rendered from its pure view: every state shows its French text and
// only the buttons that work in that state.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { balanceText, CloudPanelView, type CloudPanelViewProps } from '../../src/renderer/components/cloud/CloudPanel'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { SectionScreen } from '../../src/renderer/screens/SectionScreen'

const noop = () => undefined
const base: CloudPanelViewProps = {
  status: { connected: false, baseUrl: 'http://127.0.0.1:8787', deviceId: null },
  login: 'idle',
  account: null,
  spend: null,
  error: null,
  busy: false,
  address: 'http://127.0.0.1:8787',
  onAddress: noop,
  onSaveAddress: noop,
  onConnect: noop,
  onCancel: noop,
  onDisconnect: noop
}
const render = (p: Partial<CloudPanelViewProps>) => renderToStaticMarkup(<CloudPanelView {...base} {...p} />)
// fr-FR groups thousands with a narrow no-break space
const plain = (html: string) => html.replace(/[\u202f\u00a0]/g, ' ')

describe('Atelier Cloud panel', () => {
  it('not connected: « Se connecter » and the address field', () => {
    const html = render({})
    expect(html).toContain('Non connecté')
    expect(html).toContain('data-testid="cloud-connect"')
    expect(html).toContain('Se connecter')
    expect(html).toContain('Adresse du Cloud')
    expect(html).not.toContain('data-testid="cloud-disconnect"')
    expect(html).not.toContain('data-testid="cloud-cancel"')
  })

  it('pending: the code to type, the browser hint and « Annuler »', () => {
    const html = render({ login: { pending: true, userCode: 'BCDF-2345', verificationUri: 'http://127.0.0.1:8787/device?code=BCDF-2345' } })
    expect(html).toContain('BCDF-2345')
    expect(html).toContain('Le navigateur s’est ouvert')
    expect(html).toContain('data-testid="cloud-cancel"')
    expect(html).not.toContain('data-testid="cloud-connect"')
  })

  it('connected: who, team, balance in credits and euros, « Se déconnecter »', () => {
    const html = plain(
      render({
        status: { connected: true, baseUrl: 'https://cloud.example.com', deviceId: 'dev_1', account: { email: 'c@example.com', name: 'Charlie', teamName: 'Studio' } },
        login: 'connected',
        account: {
          email: 'c@example.com',
          name: 'Charlie',
          teamName: 'Studio',
          role: 'owner',
          wallet: { balance: 1000, held: 40, available: 960 },
          caps: { dailyCredits: null, monthlyCredits: null },
          creditValueEur: 0.01
        },
        spend: { month: '2026-10', reservedCredits: 40, spentCredits: 120, spentEur: 1.2, jobs: 3 }
      })
    )
    expect(html).toContain('Connecté à Charlie (c@example.com)')
    expect(html).toContain('Équipe : Studio')
    expect(html).toContain('Solde : 1 000 crédits (≈ 10,00 €)')
    expect(html).toContain('Disponible : 960 crédits (40 réservés par des tâches en cours).')
    expect(html).toContain('Ce mois-ci : 120 crédits dépensés sur 3 tâches.')
    expect(html).toContain('data-testid="cloud-disconnect"')
    expect(html).not.toContain('data-testid="cloud-connect"')
  })

  it('shows the balance without euros when the credit value is unknown, and errors in French', () => {
    expect(plain(balanceText({ wallet: { balance: 2500, held: 0, available: 2500 }, creditValueEur: null }))).toBe('Solde : 2 500 crédits')
    const html = render({ error: 'Atelier Cloud est injoignable : vérifie que le Cloud tourne, puis réessaie.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Atelier Cloud est injoignable')
    const failed = render({ login: { error: true, message: 'La demande de connexion a expiré ou a été refusée : recommence.' } })
    expect(failed).toContain('La demande de connexion a expiré')
    expect(failed).toContain('data-testid="cloud-connect"')
  })

  it('is mounted in Réglages › Général', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SectionScreen route={{ section: 'reglages', page: 'general' }} onRoute={noop} />
      </TooltipProvider>
    )
    expect(html).toContain('data-testid="cloud-panel"')
    expect(html).toContain('Atelier Cloud')
  })
})
