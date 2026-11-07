// Lot Z1, Idées / Automatisations / Ressources screens: render on the real data of the example workspace (no IPC in the
// renderer), in French, EXEMPLE chips on example rows, DÉMO badge for the platform voices.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { NO_FEATURES, type FeatureContext } from '../../src/shared/features'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { IDEAS_SCREENS } from '../../src/renderer/screens/ideas'
import { AutomationCard, AutomationsScreen, HistoryTable } from '../../src/renderer/screens/ideas/AutomationsScreen'
import { AutomationForm } from '../../src/renderer/screens/ideas/AutomationForm'
import { IdeasList, IdeasScreen } from '../../src/renderer/screens/ideas/IdeasScreen'
import { BundledPanel, ResourcesScreen, VoicesPanel, languageLabel } from '../../src/renderer/screens/ideas/ResourcesScreen'
import { cadenceText } from '../../src/renderer/screens/ideas/common'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const render = (el: ReactElement, features: FeatureContext = NO_FEATURES): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={features}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )
const route = (page: string) => ({ section: 'production' as const, page })
const handlers = { onKeep: noop, onReject: noop, onCreate: noop, onDelete: noop }

async function seeded() {
  const core = memoryCore()
  await core.api['example.load']()
  return core
}

describe('Idées, Automatisations, Ressources screens', () => {
  it('registers the three routes', () => {
    expect(Object.keys(IDEAS_SCREENS).sort()).toEqual(['production/automatisations', 'production/idees', 'production/ressources'])
    expect(IDEAS_SCREENS['production/idees']).toBe(IdeasScreen)
    expect(IDEAS_SCREENS['production/automatisations']).toBe(AutomationsScreen)
    expect(IDEAS_SCREENS['production/ressources']).toBe(ResourcesScreen)
  })

  it('has a French message for every key of the three screens', () => {
    const keys = Object.keys(fr).filter((k) => /^(ideas|automations|resources)\./.test(k))
    expect(keys.length).toBeGreaterThan(100)
    for (const k of keys) expect(fr[k as keyof typeof fr].trim()).not.toBe('')
  })

  it('ideas: one h1 in the production section, toolbar and filters', () => {
    const html = render(<IdeasScreen route={route('idees')} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-production"')
    expect(html).toContain('Idées')
    expect(html).toContain('Trouver des idées')
    expect(html).toContain('Nouvelle idée')
    expect(html).toContain('Toutes les chaînes')
    for (const s of ['Toutes', 'Nouvelle', 'Gardée', 'Écartée', 'Utilisée']) expect(html).toContain(s)
    expect(html).toContain('disabled=""') // no channel picked: asking the agent is disabled, with its reason
    expect(html).toContain('Choisis une chaîne')
  })

  it('ideas: cards of the example workspace with status, source, score, EXEMPLE chip and the right actions', async () => {
    const core = await seeded()
    const ideas = await core.api['ideas.list']()
    expect(ideas.length).toBeGreaterThan(0)
    const html = render(<IdeasList ideas={ideas} filter="all" {...handlers} />)
    expect(html).toContain('data-testid="ideas-list"')
    expect(html).toContain('Exemple')
    expect(html).toContain('Créer la vidéo')
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
    const agent = ideas.find((i) => i.source === 'agent' && i.score !== null)
    if (agent) expect(html).toContain(`Potentiel ${agent.score}/100`)
    const used = ideas.find((i) => i.status === 'used')
    if (used) {
      const usedHtml = render(<IdeasList ideas={[used]} filter="used" {...handlers} />)
      expect(usedHtml).toContain('Vidéo créée')
      expect(usedHtml).not.toContain('Garder')
    }
    core.close()
  })

  it('ideas: filter and empty states', async () => {
    const core = await seeded()
    const ideas = await core.api['ideas.list']()
    const none = render(<IdeasList ideas={ideas.filter((i) => i.status !== 'rejected')} filter="rejected" {...handlers} />)
    expect(none).toContain('Aucune idée avec ce statut')
    expect(render(<IdeasList ideas={[]} filter="all" {...handlers} />)).toContain('Aucune idée ici')
    core.close()
  })

  it('automations: cards with the rule, next firing, switch and run-now; EXEMPLE chip', async () => {
    const core = await seeded()
    const list = await core.api['automations.list']()
    expect(list.length).toBeGreaterThan(0)
    const html = render(
      <ul>
        {list.map((a) => (
          <AutomationCard key={a.id} automation={a} onToggle={noop} onRun={noop} onEdit={noop} onDelete={noop} />
        ))}
      </ul>
    )
    expect(html).toContain('data-testid="automation-card"')
    expect(html).toContain('Lance le pipeline Atelier pour')
    expect(html).toContain('Lancer maintenant')
    expect(html).toContain('Prochain lancement')
    expect(html).toContain('Exemple')
    expect(html).toContain('role="switch"')
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
    core.close()
  })

  it('automations: cadence wording and the history table', async () => {
    expect(cadenceText({ cadence: 'daily', weekday: null, hour: 8 })).toBe('Chaque jour à 08 h')
    expect(cadenceText({ cadence: 'weekly', weekday: 1, hour: 9 })).toBe('Chaque lundi à 09 h')
    expect(cadenceText({ cadence: 'manual', weekday: null, hour: 8 })).toBe('À la main')
    const core = await seeded()
    const [list, history] = [await core.api['automations.list'](), await core.api['automations.history']()]
    const html = render(<HistoryTable rows={history} names={new Map(list.map((a) => [a.id, a.name] as const))} />)
    expect(html).toContain('data-testid="automation-history"')
    expect(render(<HistoryTable rows={[]} names={new Map()} />)).toContain('Aucun lancement')
    core.close()
  })

  it('automations: shell and form', async () => {
    const shell = render(<AutomationsScreen route={route('automatisations')} onRoute={noop} />)
    expect(shell.match(/<h1/g)).toHaveLength(1)
    expect(shell).toContain('Automatisations')
    expect(shell).toContain('Nouvelle automatisation')
    expect(shell).toContain('Historique des lancements')
    const form = render(<AutomationForm initial={null} channels={[{ id: 1, name: 'Ma chaîne' }]} onClose={noop} />)
    for (const k of ['Nom', 'Chaîne', 'Rythme', 'Heure', 'Sujet', 'Durée visée', 'Budget', 'Validations', 'Enregistrer']) expect(form).toContain(k)
    expect(form).toContain('Chaque jour')
    expect(form).toContain('Usage max')
  })

  it('resources: system voices are real, platform voices and the personal voice are DÉMO through the registry', async () => {
    const html = render(<ResourcesScreen route={route('ressources')} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain(fr['page.production.ressources'])
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('data-feature="voice-platform"')
    expect(html).toContain('data-feature="voice-clone"')
    expect(html).toContain('Voix de la plateforme')

    const connected = render(<ResourcesScreen route={route('ressources')} onRoute={noop} />, { cloud: { functions: { 'voice-platform': 'real' }, hasCredits: true }, youtubeConnected: false })
    expect(connected).not.toContain('data-feature="voice-platform"')

    const core = memoryCore()
    const voices = await core.api['production.voices']()
    const table = render(<VoicesPanel data={voices} />)
    expect(table).toContain('data-testid="voices-table"')
    if (voices.voices[0]) expect(table).toContain(voices.voices[0].name)
    const status = await core.api['production.engineStatus']()
    expect(render(<BundledPanel status={status} />)).toContain('data-testid="resources-folder"')
    expect(languageLabel('fr')).toBe('Français')
    expect(languageLabel('xx')).toBe('XX')
    core.close()
  })
})
