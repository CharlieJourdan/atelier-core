// Lot Z1, Accueil / Validations / Ordinateurs: each screen renders in plain Node (no IPC), with its French labels, the
// EXEMPLE chip on example rows and the DÉMO badge where the screen is demo (PC cloud, browser live view).
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { NO_FEATURES } from '../../src/shared/features'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { HOME_SCREENS } from '../../src/renderer/screens/home'
import { HomeScreen } from '../../src/renderer/screens/home/HomeScreen'
import { InboxList, ValidationsScreen, type InboxActions } from '../../src/renderer/screens/home/ValidationsScreen'
import { COMPUTERS_SCREENS } from '../../src/renderer/screens/computers'
import { ComputerScreen } from '../../src/renderer/screens/team/ComputerScreen'
import { CloudPcCard, ComputersScreen } from '../../src/renderer/screens/computers/ComputersScreen'
import { SessionList } from '../../src/renderer/screens/computers/BrowsersBlock'
import { MachineList } from '../../src/renderer/screens/computers/MachinesBlock'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const render = (el: ReactElement): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )
const clean = (html: string): void => {
  for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
}
const actions: InboxActions = { busy: null, onApprove: noop, onSendBack: noop, onGateApprove: noop, onGateChanges: noop, onOpenRun: noop }

describe('Accueil', () => {
  it('registers accueil and validations, renders the shell with one title', () => {
    expect(HOME_SCREENS.accueil).toBe(HomeScreen)
    expect(HOME_SCREENS.validations).toBe(ValidationsScreen)
    const html = render(<HomeScreen route={{ section: 'accueil' }} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-accueil"')
    expect(html).toContain('À valider')
    clean(html)
  })
})

describe('Validations', () => {
  it('renders the shell with its three tabs and one title', () => {
    const html = render(<ValidationsScreen route={{ section: 'validations' }} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-validations"')
    for (const k of ['Tout', 'Livrables des agents', 'Étapes de production']) expect(html).toContain(k)
    clean(html)
  })

  it('shows the empty state when nothing waits', async () => {
    const core = memoryCore()
    try {
      const html = render(<InboxList inbox={await core.api['home.inbox']()} tab="all" actions={actions} />)
      expect(html).toContain('Rien à valider')
      expect(html).not.toContain('inbox-card')
      clean(html)
    } finally {
      core.close()
    }
  })

  it('shows a waiting deliverable and a production gate with their actions', async () => {
    const core = memoryCore()
    try {
      const ch = await core.api['channels.create']({ name: 'Ma chaîne' })
      const v = await core.api['videos.create'](ch.id, { title: 'Ma vidéo' })
      await core.api['versions.add'](v.deliverables.find((d) => d.type === 'research')!.id, { content: 'faits' })
      await core.api['versions.add'](v.deliverables.find((d) => d.type === 'thumbnail_brief')!.id, { content: 'Un fond sombre, un titre en jaune.' })
      const inbox = await core.api['home.inbox']()
      inbox.gates.push({ runId: 1, nodeId: 'script', nodeLabel: 'Script', gateKind: 'owner', videoId: v.video.id, videoTitle: 'Ma vidéo', channelId: ch.id, channelName: 'Ma chaîne', pipelineLabel: 'Atelier', demo: true, step: null })
      inbox.total = 2
      const html = render(<InboxList inbox={inbox} tab="all" actions={actions} />)
      for (const k of ['Brief de miniature', 'Un fond sombre', 'Valider', 'Renvoyer avec une note', 'Ouvrir dans Production', 'Décision réservée à toi', 'Fabriqué en démo']) expect(html).toContain(k)
      expect(html.match(/data-testid="inbox-card"/g)).toHaveLength(2)
      expect(render(<InboxList inbox={inbox} tab="gates" actions={actions} />).match(/data-testid="inbox-card"/g)).toHaveLength(1)
      expect(render(<InboxList inbox={inbox} tab="approvals" actions={actions} />)).toContain('data-kind="approval"')
      clean(html)
    } finally {
      core.close()
    }
  })
})

describe('Ordinateurs', () => {
  it('routes to the proto computer screen; the old screen still renders its three blocks and the DÉMO badge', () => {
    expect(COMPUTERS_SCREENS.ordinateurs).toBe(ComputerScreen)
    const html = render(<ComputersScreen route={{ section: 'ordinateurs' }} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-ordinateurs"')
    for (const k of ['PC distant (H1)', 'Navigateurs des agents', 'PC cloud', 'Ajouter', 'Ouvrir']) expect(html).toContain(k)
    expect(html).toContain('data-testid="demo-badge"')
    clean(html)
  })

  it('the PC cloud card is DÉMO, says why and shows the hourly cost', () => {
    const html = render(<CloudPcCard />)
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('data-feature="cloud-pc"')
    expect(html).toContain('Écran d’exemple seulement.')
    expect(html).toContain('de l’heure')
    clean(html)
  })

  it('lists the example machine and browser session with the EXEMPLE chip; the live view is a labelled DÉMO mock', async () => {
    const core = memoryCore()
    try {
      await core.api['example.load']()
      const machines = render(<MachineList machines={await core.api['machines.list']()} actions={{ busy: null, onTest: noop, onRename: noop, onRemove: noop }} />)
      for (const k of ['H1 (exemple)', 'Windows', '192.168.1.42:22', 'Joignable', 'Tester la connexion', 'example-badge']) expect(machines).toContain(k)
      const sessions = render(<SessionList sessions={await core.api['browsers.list']()} busy={null} onClose={noop} onRemove={noop} />)
      for (const k of ['Ouverte', 'Fermer la session', 'example-badge', 'Maquette de la vue en direct']) expect(sessions).toContain(k)
      expect(sessions).toContain('data-testid="demo-badge"')
      clean(machines + sessions)
    } finally {
      core.close()
    }
  })

  it('shows empty states', () => {
    expect(render(<MachineList machines={[]} actions={{ busy: null, onTest: noop, onRename: noop, onRemove: noop }} />)).toContain('Aucun PC distant déclaré.')
    expect(render(<SessionList sessions={[]} busy={null} onClose={noop} onRemove={noop} />)).toContain('Aucune session de navigateur.')
  })
})

describe('French messages', () => {
  it('has no empty home, inbox or computers message', () => {
    const keys = Object.keys(fr).filter((k) => /^(home|inbox|computers)\./.test(k))
    expect(keys.length).toBeGreaterThan(100)
    for (const k of keys) expect((fr as Record<string, string>)[k]).not.toBe('')
  })
})
