// Lot Z1, team area screens: each Réglages page and the credits pill render in plain Node (first paint, no API call),
// and the presentational parts render on the real data of the backend (example workspace).
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '../../src/shared/features'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { CreditsPillView } from '../../src/renderer/components/shell/CreditsPill'
import { ACCOUNT_SCREENS } from '../../src/renderer/screens/settings/account'
import { SETTINGS_SCREENS } from '../../src/renderer/screens/settings'
import { AccountScreen, BalanceTiles, BuyPanel, History, costPerVideo } from '../../src/renderer/screens/settings/account/AccountScreen'
import { AdminScreen, GrantedTiles, PricesTable, ProvidersList, SupportList } from '../../src/renderer/screens/settings/account/AdminScreen'
import { ClaudeScreen, ProfileCard, ProfileForm, RoutingTable, profileStatusText } from '../../src/renderer/screens/settings/account/ClaudeScreen'
import { CloudScreen } from '../../src/renderer/screens/settings/account/CloudScreen'
import { DevicesList, InviteForm, MembersTable, TeamScreen } from '../../src/renderer/screens/settings/account/TeamScreen'
import { fmtAgo } from '../../src/renderer/screens/settings/account/common'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const render = (el: ReactElement, features = NO_FEATURES): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={features}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )
const props = { route: { section: 'reglages' as const }, onRoute: noop }

describe('registration', () => {
  it('registers the five pages under their route keys and merges them into the settings map', () => {
    expect(Object.keys(ACCOUNT_SCREENS).sort()).toEqual(['reglages/admin', 'reglages/claude', 'reglages/cloud', 'reglages/compte', 'reglages/equipe'])
    for (const [k, v] of Object.entries(ACCOUNT_SCREENS)) expect(SETTINGS_SCREENS[k]).toBe(v)
  })
})

describe('first paint of each page (no API call, one h1, French)', () => {
  const cases: [string, ReactElement, string][] = [
    ['compte', <AccountScreen key="a" {...props} />, 'Compte et crédits'],
    ['equipe', <TeamScreen key="b" {...props} />, 'Équipe'],
    ['claude', <ClaudeScreen key="c" {...props} />, 'Claude et modèles'],
    ['cloud', <CloudScreen key="d" {...props} />, 'Atelier Cloud'],
    ['admin', <AdminScreen key="e" {...props} />, 'Admin plateforme']
  ]
  it.each(cases)('%s', (_page, el, title) => {
    const html = render(el)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-reglages"')
    expect(html).toContain(title)
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('compte shows the DÉMO badge for the simulated purchase from the very first render', () => {
    const html = render(<AccountScreen {...props} />)
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('Acheter des crédits')
    expect(html).toContain('aucun paiement')
  })
})

describe('credits pill', () => {
  it('renders in SSR with a dash, then the formatted balance', () => {
    const loading = render(<CreditsPillView available={null} onOpen={noop} />)
    expect(loading).toContain('data-testid="credits-pill"')
    expect(loading).toContain('>—<')
    const ready = render(<CreditsPillView available={12345} onOpen={noop} />)
    expect(ready).toContain('Crédits disponibles : 12')
    expect(ready).toContain('Voir le compte et les crédits')
  })
})

async function seeded() {
  const core = memoryCore()
  await core.api['example.load']()
  return core
}

describe('Compte et crédits', () => {
  it('shows balance, history with the simulated purchase labelled, packs, and cost per video', async () => {
    const core = await seeded()
    try {
      const pack = (await core.api['credits.packs']())[0]!
      await core.api['credits.simulatePurchase'](pack.id, 'purchase-key-1')
      const balance = await core.api['credits.balance']()
      const entries = await core.api['credits.entries'](100)
      const tiles = render(<BalanceTiles balance={balance} runs={[]} />)
      expect(tiles).toContain('Solde disponible')
      expect(tiles).toContain('Pas encore de vidéo produite')
      const hist = render(<History entries={entries} />)
      expect(hist).toContain('achat simulé')
      const buy = render(<BuyPanel packs={await core.api['credits.packs']()} busy={null} onBuy={noop} />)
      expect(buy).toContain('data-testid="demo-badge"')
      expect(buy.match(/data-testid="pack"/g)!.length).toBeGreaterThanOrEqual(1)
      expect(buy).toContain('Acheter (simulé)')
      expect(render(<History entries={[]} />)).toContain('Aucun mouvement')
    } finally {
      core.close()
    }
  })

  it('averages the credits of productions that spent some, ignoring demo runs', () => {
    expect(costPerVideo([])).toBeNull()
    expect(costPerVideo([{ spentCredits: 0, demo: false, example: false }, { spentCredits: 900, demo: true, example: false }])).toBeNull()
    expect(costPerVideo([{ spentCredits: 100, demo: false, example: false }, { spentCredits: 301, demo: false, example: false }, { spentCredits: 0, demo: false, example: false }])).toEqual({ average: 201, n: 2 })
  })
})

describe('Équipe', () => {
  it('lists members with roles, caps, status, EXEMPLE chips and a remove button for non-owners', async () => {
    const core = await seeded()
    try {
      const members = await core.api['team.members']()
      const html = render(<MembersTable members={members} onSave={noop} onRemove={noop} />)
      expect(html.match(/data-testid="member-row"/g)).toHaveLength(3)
      expect(html).toContain('Propriétaire')
      expect(html).toContain('Léa Martin (exemple)')
      expect(html).toContain('lea.martin@exemple.fr')
      expect(html).toContain('Invité')
      expect(html).toContain('Actif')
      expect(html).toContain('value="8000"')
      expect(html.match(/data-testid="example-badge"/g)).toHaveLength(2)
      expect(html.match(/Retirer /g)).toHaveLength(2)
      const devices = await core.api['team.devices']()
      const d = render(<DevicesList devices={devices} onRevoke={noop} />)
      expect(d.match(/data-testid="device-row"/g)).toHaveLength(2)
      expect(d).toContain('cet appareil')
      expect(d).toContain('MacBook Air de Léa (exemple)')
      expect(d.match(/Révoquer/g)).toHaveLength(1)
    } finally {
      core.close()
    }
  })

  it('says plainly that the invitation sends no e-mail', () => {
    const html = render(<InviteForm onDone={noop} onCancel={noop} />)
    expect(html).toContain('Aucun e-mail n’est envoyé')
    expect(html).toContain('Enregistrer l’invitation')
  })

  it('formats relative times in French', () => {
    const now = Date.parse('2026-10-20T12:00:00Z')
    expect(fmtAgo('2026-10-20T11:59:30Z', now)).toBe('à l’instant')
    expect(fmtAgo('2026-10-20T11:30:00Z', now)).toBe('il y a 30 min')
    expect(fmtAgo('2026-10-20T10:00:00Z', now)).toBe('il y a 2 h')
    expect(fmtAgo('2026-10-19T12:00:00Z', now)).toBe('hier')
  })
})

describe('Claude et modèles', () => {
  it('no longer shows the 25-role routing table nor the old profiles panel (QA D2)', () => {
    const html = render(<ClaudeScreen {...props} />)
    expect(html).not.toContain('Attribution des rôles')
    expect(html).not.toContain('lots suivants')
    expect(html).not.toContain('docs/AGENT-RUNTIME')
  })

  it('shows the three statuses, the limit time, key set or not, and never a key value', async () => {
    const core = await seeded()
    try {
      const profiles = await core.api['claude.profiles']()
      const actions = { onEdit: noop, onRemove: noop, onDefault: noop, onLimit: noop, onTest: noop }
      const html = render(
        <ul>
          {profiles.map((p) => (
            <ProfileCard key={p.id} p={p} actions={actions} testing={false} />
          ))}
        </ul>
      )
      expect(html.match(/data-testid="claude-profile"/g)).toHaveLength(3)
      expect(html).toContain('prêt')
      expect(html).toMatch(/limite atteinte jusqu’à 14:30/)
      expect(html).toContain('non configuré')
      expect(html).toContain('pas de clé')
      expect(html).toContain('Lever la limite')
      expect(html).toContain('Marquer limité (1 h)')
      expect(html).toContain('Tester')
      // The test button exists on CLI profiles only (the API profiles' key is not tested from here).
      expect(html.match(/Tester/g)).toHaveLength(profiles.filter((p) => p.kind === 'cli').length)
      expect(html.match(/>par défaut</g)).toHaveLength(1)
      expect(profileStatusText({ status: 'unset', limitedUntil: null })).toBe('non configuré')
    } finally {
      core.close()
    }
  })

  it('renders the routing table with the tier of each role and the profiles to choose from', async () => {
    const core = await seeded()
    try {
      const profiles = await core.api['claude.profiles']()
      const rows = await core.api['claude.routing']()
      const html = render(<RoutingTable rows={rows} profiles={profiles} onChange={noop} />)
      expect(html).toContain('Scénariste')
      expect(html).toContain('Le meilleur')
      expect(html).toContain('Profil par défaut')
      expect(html).toContain('Mon Claude Code')
      expect(html.match(/<tr/g)!.length).toBe(rows.length + 1)
    } finally {
      core.close()
    }
  })

  it('profile form: API kind asks for a key as a password field, CLI does not', () => {
    const fresh = render(<ProfileForm profile={null} onDone={noop} onCancel={noop} />)
    expect(fresh).toContain('Abonnement Claude Code')
    expect(fresh).not.toContain('type="password"')
    const api = render(
      <ProfileForm profile={{ id: 3, name: 'API', kind: 'api', status: 'ready', limitedUntil: null, keySet: true, isDefault: false, example: false }} onDone={noop} onCancel={noop} />
    )
    expect(api).toContain('type="password"')
    expect(api).toContain('Laisser vide pour garder la clé enregistrée')
  })
})

describe('Admin plateforme', () => {
  it('renders the price grid with margins, credits granted, support requests and provider key status', async () => {
    const core = await seeded()
    try {
      const o = await core.api['admin.overview']()
      const prices = render(<PricesTable prices={o.prices} />)
      expect(prices).toContain('Voix (caractère)')
      expect(prices).toContain('grille provisoire')
      expect(prices).toContain('lot P5')
      expect(prices).not.toContain('demo-badge')
      expect(prices).toContain('25 %')
      expect(prices).toContain('1 crédit = 0,01 €')
      expect(render(<GrantedTiles granted={o.granted} />)).toContain('Achats simulés')
      const support = render(<SupportList rows={await core.api['support.list']()} onClose={noop} />)
      expect(support.length).toBeGreaterThan(0)
      expect(render(<SupportList rows={[]} onClose={noop} />)).toContain('Aucune demande')
      const providers = render(<ProvidersList providers={await core.api['providers.list']()} />)
      expect(providers).toMatch(/clé enregistrée|pas de clé|sans clé/)
    } finally {
      core.close()
    }
  })

  it('the page states it is read-only because the real data lives in the Cloud', () => {
    const html = render(<AdminScreen {...props} />)
    expect(html).toContain('Lecture seule')
    expect(html).toContain('Atelier Cloud')
  })
})
