// Lot Z1, Mes outils screens: the list, the sheet panels, the import validation and the test console render on the real
// data of the backend (example workspace), in French, with EXEMPLE chips on example rows and no secret value shown.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { NO_FEATURES } from '../../src/shared/features'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { TOOLS_SCREENS } from '../../src/renderer/screens/tools'
import { ToolsBody, ToolsScreen } from '../../src/renderer/screens/tools/ToolsScreen'
import { ToolList } from '../../src/renderer/screens/tools/ToolList'
import { AgentsExposure, OverviewPanel } from '../../src/renderer/screens/tools/ToolSheet'
import { PermissionsPanel, SecretsPanel } from '../../src/renderer/screens/tools/SecretsPanel'
import { DiffView, VersionsPanel } from '../../src/renderer/screens/tools/VersionsPanel'
import { ImportForm, ValidationView } from '../../src/renderer/screens/tools/ImportForm'
import { ResultView, RunHistory, TestConsole, renderedLines } from '../../src/renderer/screens/tools/TestConsole'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const act = (): Promise<boolean> => Promise.resolve(true)
const render = (el: ReactElement): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )

async function seeded() {
  const core = memoryCore()
  await core.api['example.load']()
  return core
}

const AGENTS = [
  { id: 'voiceover', name: 'Voix off' },
  { id: 'researcher', name: 'Chercheur' }
]

describe('Mes outils screens', () => {
  it('registers the screen under the section key', () => {
    expect(TOOLS_SCREENS.outils).toBe(ToolsScreen)
  })

  it('shell: one h1, the add button and the loading state', () => {
    const html = render(<ToolsScreen route={{ section: 'outils' }} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-outils"')
    expect(html).toContain('Mes outils')
    expect(html).toContain('Ajouter un outil')
  })

  it('has a French message for every tools.* key', () => {
    const keys = Object.keys(fr).filter((k) => k.startsWith('tools.'))
    expect(keys.length).toBeGreaterThan(100)
    for (const k of keys) expect(fr[k as keyof typeof fr].trim()).not.toBe('')
  })

  it('empty workspace: empty state with its action', async () => {
    const core = memoryCore()
    const html = render(<ToolsBody tools={await core.api['tools.list']()} selected={null} onSelect={noop} onAdd={noop} onDeleted={noop} />)
    expect(html).toContain('Aucun outil branché')
    expect(html).toContain('Ajouter un outil')
    core.close()
  })

  it('list: status, kind, version, agents, permissions and the EXEMPLE chip', async () => {
    const core = await seeded()
    const tools = await core.api['tools.list']()
    expect(tools).toHaveLength(3)
    const html = render(<ToolList tools={tools} selected="voix-maison" onSelect={noop} />)
    expect(html).toContain('data-testid="tools-list"')
    expect(html).toContain('Voix maison (exemple)')
    expect(html).toContain('Exemple')
    expect(html).toContain('Commande')
    expect(html).toContain('Service HTTP')
    expect(html).toContain('v1.2.0')
    expect(html).toContain('Désactivé')
    expect(html).toContain('En erreur')
    expect(html).toContain('2 agent(s)')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
    core.close()
  })

  it('overview: manifest summary, entry line, ports and exposure to agents and production', async () => {
    const core = await seeded()
    const tool = await core.api['tools.get']('voix-maison')
    const html = render(<OverviewPanel tool={tool} agents={AGENTS} act={act} />)
    expect(html).toContain('python3 voix_maison/cli.py')
    expect(html).toContain('script')
    expect(html).toContain('Vitesse de lecture')
    expect(html).toContain('data-testid="tool-production"')
    expect(html).toContain('Peut remplacer l’étape « Voix »')
    const agents = render(<AgentsExposure tool={tool} agents={AGENTS} act={act} />)
    expect(agents).toMatch(/checked=""[^>]*\/>\s*Voix off|Voix off/)
    expect(agents.match(/checked=""/g)).toHaveLength(1)
    core.close()
  })

  it('permissions and secrets: by NAME, set or not set, and never a value', async () => {
    const core = await seeded()
    let tool = await core.api['tools.get']('recherche-web')
    let html = render(<SecretsPanel tool={tool} act={act} />)
    expect(html).toContain('SEARCH_API_KEY')
    expect(html).toContain('Non défini')
    expect(html).toContain('type="password"')
    tool = await core.api['tools.setSecret']('recherche-web', 'SEARCH_API_KEY', 'sk-ultra-secret-123')
    html = render(<SecretsPanel tool={tool} act={act} />)
    expect(html).toContain('Défini')
    expect(html).not.toContain('sk-ultra-secret-123')
    expect(html).not.toContain('value="sk-')
    const perms = render(<PermissionsPanel tool={tool} act={act} />)
    expect(perms).toContain('Joindre le serveur api.recherche-exemple.fr')
    expect(perms).toContain('Utiliser le secret SEARCH_API_KEY')
    expect(perms).toContain('role="switch"')
    core.close()
  })

  it('versions: active badge, rollback and diff against the active version', async () => {
    const core = await seeded()
    const first = await core.api['tools.get']('voix-maison')
    const next = JSON.stringify({ ...first.manifest, version: '1.3.0', description: 'Nouvelle description.' })
    const { tool } = await core.api['tools.importVersion']('voix-maison', next)
    expect(tool.version).toBe('1.3.0')
    const html = render(<VersionsPanel tool={tool} act={act} onImported={noop} />)
    expect(html).toContain('v1.3.0')
    expect(html).toContain('v1.2.0')
    expect(html).toContain('Active')
    expect(html).toContain('Revenir à cette version')
    expect(html).toContain('Importer une version')
    const old = tool.versions.find((v) => v.version === '1.2.0')!
    const cur = tool.versions.find((v) => v.version === '1.3.0')!
    const diff = render(<DiffView before={old.manifestText} after={cur.manifestText} />)
    expect(diff).toContain('data-line="add"')
    expect(diff).toContain('data-line="del"')
    expect(render(<DiffView before="a" after="a" />)).toContain('identiques')
    core.close()
  })

  it('import: French errors with their path, then the permissions the manifest asks for', async () => {
    const core = await seeded()
    const bad = await core.api['tools.validate'](JSON.stringify({ id: 'Pas Kebab', name: 'X', version: '1', kind: 'command', entry: {} }))
    expect(bad.ok).toBe(false)
    const badHtml = render(<ValidationView result={bad} mode={{ kind: 'add' }} />)
    expect(badHtml).toContain('data-testid="manifest-errors"')
    expect(badHtml).toContain('id')
    expect(badHtml).toContain('kebab-case')
    expect(badHtml).not.toMatch(/undefined|\[object Object\]/)

    const good = await core.api['tools.validate'](
      JSON.stringify({ id: 'mon-outil', name: 'Mon outil', version: '1.0.0', kind: 'command', entry: { command: 'python3', args: [] }, permissions: { fs: { read: ['$TOOL_DIR'] } } })
    )
    expect(good.ok).toBe(true)
    const goodHtml = render(<ValidationView result={good} mode={{ kind: 'add' }} />)
    expect(goodHtml).toContain('data-testid="manifest-ok"')
    expect(goodHtml).toContain('Lancer le programme python3')
    expect(goodHtml).toContain('Lire $TOOL_DIR')

    const exists = await core.api['tools.validate'](JSON.stringify({ id: 'voix-maison', name: 'V', version: '9.0.0', kind: 'command', entry: { command: 'x', args: [] } }))
    expect(render(<ValidationView result={exists} mode={{ kind: 'add' }} />)).toContain('Un outil porte déjà cet identifiant')

    const form = render(<ImportForm mode={{ kind: 'add' }} onDone={noop} onCancel={noop} />)
    expect(form).toContain('Choisir un fichier')
    expect(form).toContain('Ajouter l’outil')
    expect(form).toContain('disabled=""')
    core.close()
  })

  it('test console: form from the manifest inputs, dry-run result with its checks and the rendered call', async () => {
    const core = await seeded()
    const tool = await core.api['tools.get']('voix-maison')
    const html = render(<TestConsole tool={tool} />)
    expect(html).toContain('Essai à blanc')
    expect(html).toContain('Rien n’est exécuté')
    expect(html).toContain('script *')
    expect(html).toContain('vitesse')
    expect(html).toContain('Lancer l’essai')
    expect(html).toContain('Historique des essais')

    const result = await core.api['tools.dryRun']('voix-maison', { script: 'Bonjour', vitesse: '1,1' })
    const out = render(<ResultView result={result} />)
    expect(out).toContain('data-testid="dry-run-result"')
    expect(out).toContain('Entrées valides')
    expect(out).toContain('Permissions accordées')
    expect(out).toContain('Ce qui serait lancé')
    expect(out).toContain('python3 voix_maison/cli.py --vitesse 1.1')
    expect(renderedLines(result.rendered!)[0]).toContain('python3')

    const missing = await core.api['tools.dryRun']('voix-maison', {})
    const missingHtml = render(<ResultView result={missing} />)
    expect(missing.ok).toBe(false)
    expect(missingHtml).toContain('champ obligatoire')
    expect(missingHtml).not.toContain('Ce qui serait lancé')

    const runs = await core.api['tools.runs']('voix-maison')
    const history = render(<RunHistory runs={runs} />)
    expect(history).toContain('Essai à blanc')
    expect(history).toContain('Exemple')
    expect(render(<RunHistory runs={[]} />)).toContain('Aucun essai')
    core.close()
  })
})
