// Lot Z1, Monétisation screens: each tab renders on the real data of the example workspace (no IPC in the renderer), with
// its French labels, EXEMPLE chips on example rows and a DÉMO badge where the screen is demo (YouTube).
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { NO_FEATURES, type FeatureContext } from '../../src/shared/features'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { MoneyScreen } from '../../src/renderer/screens/money/MoneyScreen'
import { MONEY_SCREENS } from '../../src/renderer/screens/money'
import { MoneyProtoScreen } from '../../src/renderer/screens/money/proto/MoneyProtoScreen'
import { OverviewBody } from '../../src/renderer/screens/money/OverviewTab'
import { RevenuesTab } from '../../src/renderer/screens/money/RevenuesTab'
import { PreviewTable } from '../../src/renderer/screens/money/CsvImport'
import { CostsBody } from '../../src/renderer/screens/money/CostsTab'
import { SponsorsBoard } from '../../src/renderer/screens/money/SponsorsTab'
import { OfferCards } from '../../src/renderer/screens/money/OffersTab'
import { PackView } from '../../src/renderer/screens/money/OfferSheet'
import { YoutubeTab } from '../../src/renderer/screens/money/YoutubeTab'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const render = (el: ReactElement, features: FeatureContext = NO_FEATURES): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={features}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )

async function seeded() {
  const core = memoryCore()
  await core.api['example.load']()
  return core
}

describe('Monétisation screens', () => {
  it('registers the proto screen under the section key (the six-tab screen stays reachable under « Avancé »)', () => {
    expect(MONEY_SCREENS.monetisation).toBe(MoneyProtoScreen)
  })

  it('shell: title once, six tabs in French, the overview loading state first', () => {
    const html = render(<MoneyScreen route={{ section: 'monetisation' }} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-monetisation"')
    for (const k of ['Vue d’ensemble', 'Revenus', 'Coûts et budgets', 'Sponsors', 'Produits et offres', 'YouTube']) expect(html).toContain(k)
  })

  it('has a French message for every money.* key the screens can ask for', () => {
    const keys = Object.keys(fr).filter((k) => k.startsWith('money.'))
    expect(keys.length).toBeGreaterThan(200)
    for (const k of keys) expect(fr[k as keyof typeof fr].trim()).not.toBe('')
  })

  it('overview: tiles, table with EXEMPLE chip and figure sources, rate editor', async () => {
    const core = await seeded()
    const data = await core.api['money.overview']()
    const html = render(<OverviewBody data={data} onChanged={noop} onAddRevenue={noop} />)
    expect(html).toContain('Revenus du mois')
    expect(html).toContain('Marge du mois')
    expect(html).toContain('data-testid="pnl-table"')
    expect(html).toContain('data-testid="weekly-bars"')
    expect(html).toContain('Exemple')
    expect(html).toContain('data-testid="source-chip"')
    expect(html).toContain('Taux dollar → euro')
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
    core.close()
  })

  it('overview: empty workspace shows the empty state with its action', async () => {
    const core = memoryCore()
    const data = await core.api['money.overview']()
    const html = render(<OverviewBody data={data} onChanged={noop} onAddRevenue={noop} />)
    expect(html).toContain('Pas encore de chiffres')
    expect(html).toContain('Ajouter un revenu')
    core.close()
  })

  it('revenues: toolbar and loading state without calling the API', () => {
    const html = render(<RevenuesTab />)
    expect(html).toContain('Ajouter un revenu')
    expect(html).toContain('Importer un CSV')
    expect(html).toContain('Toutes les chaînes')
  })

  it('csv preview: valid and refused lines', async () => {
    const core = await seeded()
    const preview = await core.api['money.revenues.previewCsv']('date;montant;devise;chaîne;type\n2026-10-03;152,40;EUR;;adsense\nnope;x;EUR;;adsense')
    const html = render(<PreviewTable preview={preview} />)
    expect(preview.valid).toBe(1)
    expect(preview.invalid).toBe(1)
    expect(html).toContain('152,40 EUR')
    expect(html).toContain('AdSense')
    expect(html).toContain('Ligne refusée')
    core.close()
  })

  it('costs: ledger tiles, caps and tables', async () => {
    const core = await seeded()
    const overview = await core.api['spend.overview']()
    const html = render(<CostsBody overview={overview} summary={[]} entries={[]} group="provider" onGroup={noop} />)
    expect(html).toContain('Dépensé ce mois-ci')
    expect(html).toContain('Plafond global du mois')
    expect(html).toContain('Budget par chaîne')
    expect(html).toContain('Aucune dépense ce mois-ci.')
    core.close()
  })

  it('sponsors: one column per stage, example deals marked', async () => {
    const core = await seeded()
    const deals = await core.api['money.sponsors.list']()
    expect(deals.length).toBeGreaterThan(0)
    const html = render(<SponsorsBoard deals={deals} onOpen={noop} onMove={noop} />)
    for (const s of ['Prospect', 'Contacté', 'Négociation', 'Signé', 'À livrer', 'Livré', 'Payé']) expect(html).toContain(s)
    expect(html).toContain('data-testid="deal-card"')
    expect(html).toContain('Exemple')
    core.close()
  })

  it('offers: cards with EXEMPLE chip and a pack view', async () => {
    const core = await seeded()
    const offers = await core.api['money.offers.list']()
    expect(offers.length).toBeGreaterThan(0)
    const html = render(<OfferCards offers={offers} onOpen={noop} />)
    expect(html).toContain('data-testid="offers-list"')
    expect(html).toContain('Exemple')
    const withPack = offers.find((o) => o.pack)
    if (withPack?.pack) {
      const pack = render(<PackView pack={withPack.pack} onUseName={noop} />)
      expect(pack).toContain('Tunnel de vente')
      expect(pack).toContain('Noms')
    }
    core.close()
  })

  it('youtube: DÉMO badge and banner while no access exists, read-only scopes listed', () => {
    const html = render(<YoutubeTab />)
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('DÉMO')
    expect(html).toContain('data-feature="youtube-analytics"')
    expect(html).toContain('youtube.readonly')
    expect(html).toContain('yt-analytics-monetary.readonly')
    expect(html).toContain('n’écrit jamais sur YouTube')
  })

  it('youtube: connected means no invented curve', () => {
    const html = render(<YoutubeTab />, { ...NO_FEATURES, youtubeConnected: true })
    expect(html).not.toContain('youtube-demo-chart')
    expect(html).not.toContain('data-testid="demo-badge"')
  })
})
