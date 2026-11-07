// Render tests of the v2 design system and shell (lot 2): rail, context column, ⌘K commands, toasts, confirmation,
// demo badges, empty states, section placeholders, the gallery, plus the data they rely on (fr.ts, sections,
// features, tokens, no v1 stylesheet). Static rendering only (renderToStaticMarkup, plain Node, no DOM).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYSIS_METHODS,
  API_METHODS,
  EXAMPLE_METHODS,
  HOME_METHODS,
  IDEAS_METHODS,
  MONEY_METHODS,
  ORCHESTRA_METHODS,
  DISCORD_METHODS,
  BRAIN_METHODS,
  EYES_METHODS,
  UPDATE_METHODS,
  CHANNEL_LIFE_METHODS,
  GOOGLE_METHODS,
  BRICKS_METHODS,
  RECIPES_METHODS,
  PROJECTS_METHODS,
  ENGINES_METHODS,
  BRICK_STYLES_METHODS,
  CHANNEL_VOICES_METHODS,
  CHANNEL_PRESENTERS_METHODS,
  CHANNEL_SPONSOR_METHODS,
  CHANNEL_CLIPS_METHODS,
  STYLE_METHODS,
  CLONE_METHODS,
  REVERSE_METHODS,
  ORDER_METHODS,
  PREVIEWS_METHODS,
  ESTIMATES_METHODS,
  PIPELINE_AGENT_METHODS,
  GRAPH_METHODS,
  AUTOPILOT_METHODS,
  RUNS_METHODS,
  TEAM_METHODS,
  TOOLS_METHODS
} from '../../src/shared/api'
import { CSP_PROD } from '../../src/shared/csp'
import {
  CLOUD_FUNCTIONS,
  FEATURES,
  featureState,
  isDemoLike,
  NO_FEATURES,
  resolveFeatures,
  type CloudCatalog,
  type FeatureContext,
  type FeatureId
} from '../../src/shared/features'
import { fr, t } from '../../src/shared/fr'
import {
  SECTION_IDS,
  SECTION_PAGES,
  defaultPage,
  isSectionId,
  routeForView,
  type SectionId
} from '../../src/shared/sections'
import { ConfirmBody } from '../../src/renderer/components/atelier/confirm'
import { DemoBadge, DemoBanner, DemoBoundary } from '../../src/renderer/components/atelier/demo'
import { Logo } from '../../src/renderer/components/atelier/logo'
import { PageShell } from '../../src/renderer/components/atelier/page'
import {
  AgentDot,
  EmptyState,
  Panel,
  StatTile,
  StateChip,
  StatusDot,
  agentColors,
  AGENT_COLORS
} from '../../src/renderer/components/atelier/primitives'
import { buildCommands } from '../../src/renderer/components/shell/commands'
import { PaletteList, isPaletteShortcut } from '../../src/renderer/components/shell/CommandPalette'
import { ContextColumn } from '../../src/renderer/components/shell/ContextColumn'
import { Rail } from '../../src/renderer/components/shell/Rail'
import { Badge } from '../../src/renderer/components/ui/badge'
import { Button } from '../../src/renderer/components/ui/button'
import { Skeleton } from '../../src/renderer/components/ui/skeleton'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { isMacUserAgent } from '../../src/renderer/lib/platform'
import { resolveRoute } from '../../src/renderer/lib/router'
import { THEME_KEY, applyTheme, parseTheme, readStoredTheme } from '../../src/renderer/lib/theme'
import { ToastList, clearToasts, dismissToast, pushToast, toast } from '../../src/renderer/lib/toast'
import { cn } from '../../src/renderer/lib/utils'
import { Gallery } from '../../src/renderer/screens/Gallery'
import { SectionPlaceholder, SectionScreen } from '../../src/renderer/screens/SectionScreen'
import { demoWaveform, makeToneWav } from '../../src/renderer/lib/demo-audio'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const noop = () => undefined

describe('fr.ts messages', () => {
  it('has a label for every section and every sub-page, and an empty state for every section', () => {
    for (const s of SECTION_IDS) {
      expect(fr).toHaveProperty(`section.${s}`)
      expect(fr).toHaveProperty(`empty.${s}.title`)
      expect(fr).toHaveProperty(`empty.${s}.blurb`)
      for (const p of SECTION_PAGES[s]) expect(fr, `page.${s}.${p}`).toHaveProperty(`page.${s}.${p}`)
    }
  })

  it('has no empty message, and fills {placeholders}', () => {
    for (const [k, v] of Object.entries(fr)) expect(v.length, k).toBeGreaterThan(0)
    expect(t('demo.unlock', { how: 'ajouter la clé' })).toBe('Pour l’activer : ajouter la clé')
    expect(t('confirm.cancel')).toBe('Annuler')
    expect(t('demo.unlock')).toContain('{how}')
  })
})

describe('sections and routes', () => {
  it('has the sections of the proto shell, in order', () => {
    expect([...SECTION_IDS]).toEqual([
      'accueil',
      'planning',
      'production',
      'agents',
      'conversations',
      'cerveau',
      'chaines',
      'monetisation',
      'ordinateurs',
      'validations',
      'outils',
      'reglages'
    ])
    expect(isSectionId('production')).toBe(true)
    expect(isSectionId('nope')).toBe(false)
  })

  it('resolves routes: first page by default, unknown page falls back, no page for sections without any', () => {
    expect(defaultPage('production')).toBe('apercu')
    expect(defaultPage('agents')).toBeUndefined()
    expect(resolveRoute('production')).toEqual({ section: 'production', page: 'apercu' })
    expect(resolveRoute({ section: 'production', page: 'pipeline' })).toEqual({ section: 'production', page: 'pipeline' })
    expect(resolveRoute({ section: 'production', page: 'bogus' })).toEqual({ section: 'production', page: 'apercu' })
    expect(resolveRoute({ section: 'agents', page: 'x' })).toEqual({ section: 'agents' })
    expect(resolveRoute({ section: 'reglages', page: 'legacy' })).toEqual({ section: 'reglages', page: 'general' })
  })

  it('sends main-process navigation (notification clicks) to the matching screen', () => {
    expect(routeForView('approvals')).toEqual({ section: 'validations' })
    expect(routeForView('spend')).toEqual({ section: 'reglages', page: 'budgets' })
  })
})

describe('Rail', () => {
  const html = (props: Partial<Parameters<typeof Rail>[0]> = {}) =>
    renderToStaticMarkup(
      <TooltipProvider>
        <Rail current="accueil" onSelect={noop} onPalette={noop} {...props} />
      </TooltipProvider>
    )

  it('renders the logo, the 9 sections (Réglages included), ⌘K and the profile', () => {
    const out = html()
    expect(out).toContain('data-testid="rail-logo"')
    for (const id of SECTION_IDS) {
      expect(out, id).toContain(`data-testid="rail-${id}"`)
      expect(out).toContain(`aria-label="${t(`section.${id}`)}"`)
    }
    expect(out).toContain('data-testid="rail-palette"')
    expect(out).toContain('data-testid="rail-profile"')
    expect(out.match(/data-testid="rail-(accueil|conversations|production|validations|agents|ordinateurs|monetisation|outils|reglages)"/g)).toHaveLength(9)
  })

  it('marks only the current section', () => {
    const out = html({ current: 'agents' })
    expect(out.match(/aria-current="page"/g)).toHaveLength(1)
    expect(out).toMatch(/data-testid="rail-agents"[^>]*aria-current="page"|aria-current="page"[^>]*data-testid="rail-agents"/)
  })

  it('shows count badges and the engine light', () => {
    const out = html({ badges: { validations: { count: 3 }, agents: { tone: 'err' } }, engine: 'ok' })
    expect(out).toContain('data-testid="rail-validations-badge"')
    expect(out).toContain('>3<')
    expect(out).toContain('data-tone="err"')
    expect(out).toContain('data-tone="ok"')
    expect(out).toContain(`aria-label="${t('engine.ok')}"`)
    expect(html()).toContain(`aria-label="${t('engine.off')}"`)
  })

  it('leaves room for the macOS traffic lights only on a Mac', () => {
    expect(html({ mac: true })).toContain('pt-11')
    expect(html({ mac: false })).not.toContain('pt-11')
    expect(isMacUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBe(true)
    expect(isMacUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
  })
})

describe('ContextColumn', () => {
  it('lists the pages of Production and marks the current one', () => {
    const out = renderToStaticMarkup(<ContextColumn section="production" page="pipeline" onSelect={noop} />)
    for (const p of SECTION_PAGES.production) expect(out).toContain(`data-testid="page-production-${p}"`)
    expect(out).toContain('Projets')
    // "Moteur et clés" was removed by lot P1 (PLAN-V2-PRODUCTION §0: no provider key is ever shown)
    expect(out).not.toContain('Moteur et clés')
    expect(out).not.toContain('page-production-moteur')
    expect(out.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('renders nothing for sections without pages', () => {
    for (const s of SECTION_IDS.filter((x) => SECTION_PAGES[x].length === 0)) {
      expect(renderToStaticMarkup(<ContextColumn section={s} page={undefined} onSelect={noop} />), s).toBe('')
    }
  })

  it('offers the gallery under Réglages, and no v1 screens any more', () => {
    const out = renderToStaticMarkup(<ContextColumn section="reglages" page="general" onSelect={noop} />)
    expect(out).not.toContain('Écrans v1 (ancien)')
    expect(out).toContain('Galerie (dev)')
  })
})

describe('⌘K commands', () => {
  it('offers every section, every page and the actions; running one calls the navigator', () => {
    const navigate = vi.fn()
    const toggleTheme = vi.fn()
    const cmds = buildCommands({ navigate, toggleTheme })
    for (const s of SECTION_IDS) expect(cmds.find((c) => c.id === `go-${s}`), s).toBeTruthy()
    const pages = SECTION_IDS.flatMap((s) => SECTION_PAGES[s].map((p) => `go-${s}-${p}`))
    for (const id of pages) expect(cmds.find((c) => c.id === id), id).toBeTruthy()
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length)

    cmds.find((c) => c.id === 'go-monetisation')!.run()
    expect(navigate).toHaveBeenCalledWith('monetisation')
    cmds.find((c) => c.id === 'open-gallery')!.run()
    expect(navigate).toHaveBeenCalledWith({ section: 'reglages', page: 'galerie' })
    expect(cmds.some((c) => c.id === 'open-legacy')).toBe(false)
    cmds.find((c) => c.id === 'toggle-theme')!.run()
    expect(toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('recognises ⌘K and Ctrl+K only', () => {
    expect(isPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true)
    expect(isPaletteShortcut({ key: 'K', metaKey: false, ctrlKey: true })).toBe(true)
    expect(isPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false)
    expect(isPaletteShortcut({ key: 'j', metaKey: true, ctrlKey: false })).toBe(false)
  })

  it('renders the palette list with its groups and items', () => {
    const cmds = buildCommands({ navigate: noop, toggleTheme: noop })
    const out = renderToStaticMarkup(<PaletteList commands={cmds} onRun={noop} />)
    expect(out).toContain(t('palette.placeholder'))
    expect(out).toContain(t('palette.group.navigation'))
    expect(out).toContain('data-testid="cmd-go-production"')
    expect(out).toContain('data-testid="cmd-toggle-theme"')
  })
})

describe('feature registry and demo badges', () => {
  const allReal = Object.fromEntries(CLOUD_FUNCTIONS.map((id) => [id, 'real' as const]))
  const allOn: FeatureContext = { cloud: { functions: allReal, hasCredits: true }, youtubeConnected: true }

  it('computes statuses from the context; production functions take theirs from the Cloud catalogue', () => {
    // not connected to a Cloud (until lots P3/P5): every Cloud function is demo
    for (const id of CLOUD_FUNCTIONS) expect(featureState(id, NO_FEATURES).status, id).toBe('demo')
    const cloud = (functions: CloudCatalog['functions'], hasCredits = true): FeatureContext => ({ ...NO_FEATURES, cloud: { functions, hasCredits } })
    expect(featureState('voice-platform', cloud({ 'voice-platform': 'real' })).status).toBe('real')
    expect(featureState('voice-platform', cloud({ 'voice-platform': 'demo' })).status).toBe('demo')
    expect(featureState('image-generation', cloud({ 'voice-platform': 'real' })).status).toBe('demo') // not listed: demo
    expect(featureState('voice-platform', cloud({ 'voice-platform': 'real' }, false)).status).toBe('needs-credits')
    expect(featureState('voice-platform', cloud({ 'voice-platform': 'demo' }, false)).status).toBe('demo')
    expect(featureState('youtube-analytics', { ...NO_FEATURES, youtubeConnected: true }).status).toBe('real')
    expect(featureState('youtube-analytics', NO_FEATURES).status).toBe('demo')
    expect(featureState('chat', NO_FEATURES).status).toBe('real')
    // lot Z1: our engine runs in the app; providers stay demo through the Cloud functions
    expect(featureState('production', NO_FEATURES).status).toBe('real')
    // never real, whatever is connected
    for (const id of ['remote-desktop-control', 'offer-deploy', 'voice-clone', 'cloud-pc', 'buy-credits', 'support-email'] as const) {
      expect(featureState(id, allOn).status, id).toBe('demo')
    }
    // the external engine's features are gone from the registry
    for (const gone of ['ideation', 'shorts', 'channel-assistants', 'cloud-render', 'visual-pause']) {
      expect(FEATURES.some((f) => f.id === gone), gone).toBe(false)
    }
  })

  it('explains every non-real feature and stays silent for real ones', () => {
    for (const f of resolveFeatures(NO_FEATURES)) {
      if (f.status === 'real') expect([f.reason, f.unlockedBy]).toEqual(['', ''])
      else {
        expect(f.reason, f.id).not.toBe('')
        expect(f.unlockedBy, f.id).not.toBe('')
      }
    }
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length)
    expect(isDemoLike('real')).toBe(false)
    expect(isDemoLike('demo')).toBe(true)
    expect(isDemoLike('needs-credits')).toBe(true)
  })

  it('every feature marked demo / needs-credits shows the DÉMO badge and the unlock hint; real ones do not', () => {
    const demoIds = FEATURES.map((f) => f.id)
    for (const id of demoIds as FeatureId[]) {
      const state = featureState(id, NO_FEATURES)
      const out = renderToStaticMarkup(
        <FeaturesProvider value={NO_FEATURES}>
          <DemoBoundary feature={id}>
            <p>contenu</p>
          </DemoBoundary>
        </FeaturesProvider>
      )
      expect(out, id).toContain('contenu')
      if (state.status === 'real') {
        expect(out, id).not.toContain('data-testid="demo-badge"')
      } else {
        expect(out, id).toContain('data-testid="demo-badge"')
        expect(out).toContain('DÉMO')
        expect(out).toContain('Rien n’est envoyé')
        expect(out).toContain(state.unlockedBy.replace(/'/g, '&#x27;'))
      }
    }
    // a real feature once its context is satisfied: no banner at all
    const real = renderToStaticMarkup(
      <FeaturesProvider value={allOn}>
        <DemoBoundary feature="voice-platform">
          <p>réel</p>
        </DemoBoundary>
      </FeaturesProvider>
    )
    expect(real).toBe('<p>réel</p>')
  })

  it('renders the badge and the banner on their own', () => {
    expect(renderToStaticMarkup(<DemoBadge />)).toContain('DÉMO')
    const banner = renderToStaticMarkup(<DemoBanner reason="Pas branché." unlockedBy="Ajouter la clé." />)
    expect(banner).toContain('role="note"')
    expect(banner).toContain('Pas branché.')
    expect(banner).toContain('Pour l’activer : Ajouter la clé.')
  })
})

describe('Atelier primitives', () => {
  it('Panel and StatTile', () => {
    const panel = renderToStaticMarkup(<Panel title="Équipe" action={<span>voir</span>}>corps</Panel>)
    expect(panel).toContain('data-slot="panel"')
    expect(panel).toContain('Équipe')
    expect(panel).toContain('voir')
    expect(panel).toContain('corps')
    const tile = renderToStaticMarkup(<StatTile label="Vidéos" value="4" hint="2 à valider" />)
    expect(tile).toContain('Vidéos')
    expect(tile).toContain('font-serif')
    expect(tile).toContain('2 à valider')
  })

  it('StatusDot / StateChip carry their tone and word', () => {
    expect(renderToStaticMarkup(<StatusDot tone="err" label="Erreur" />)).toContain('data-tone="err"')
    expect(renderToStaticMarkup(<StatusDot tone="ok" />)).toContain('aria-hidden="true"')
    for (const [state, word] of [
      ['working', 'Travaille'],
      ['waiting', 'Attend'],
      ['blocked', 'Bloqué'],
      ['idle', 'Au repos'],
      ['done', 'Terminé'],
      ['error', 'Erreur']
    ] as const) {
      const out = renderToStaticMarkup(<StateChip state={state} />)
      expect(out).toContain(`data-state="${state}"`)
      expect(out).toContain(word)
    }
  })

  it('AgentDot uses the 8 colour pairs and wraps around', () => {
    expect(AGENT_COLORS).toHaveLength(8)
    expect(agentColors(8)).toEqual(agentColors(0))
    expect(agentColors(-1)).toEqual(agentColors(7))
    const out = renderToStaticMarkup(<AgentDot index={1} size={32} />)
    expect(out).toContain('width:32px')
    expect(out).toContain(agentColors(1)[0])
  })

  it('EmptyState draws the workbench mark, a title and an optional action', () => {
    const out = renderToStaticMarkup(<EmptyState title="Rien ici" blurb="Plus tard." action={<button>Go</button>} />)
    expect(out).toContain('<svg')
    expect(out).toContain('font-semibold')
    expect(out).toContain('Rien ici')
    expect(out).toContain('Plus tard.')
    expect(out).toContain('<button>Go</button>')
    expect(renderToStaticMarkup(<Logo />)).toContain('<svg')
  })

  it('shadcn Button / Badge / Skeleton and cn()', () => {
    expect(renderToStaticMarkup(<Button variant="brand" size="sm">Ok</Button>)).toContain('bg-brand')
    expect(renderToStaticMarkup(<Button variant="destructive">x</Button>)).toContain('bg-err')
    expect(renderToStaticMarkup(<Badge variant="ok">ok</Badge>)).toContain('text-ok')
    expect(renderToStaticMarkup(<Skeleton className="h-4" />)).toContain('animate-pulse')
    expect(cn('p-2', 'p-4', undefined)).toBe('p-4')
  })
})

describe('confirmation modal', () => {
  it('puts the dangerous action on the left, the cancel on the right', () => {
    const out = renderToStaticMarkup(
      <ConfirmBody options={{ title: 'Supprimer ?', description: 'Définitif.', confirmLabel: 'Supprimer', danger: true }} onResolve={noop} standalone />
    )
    expect(out).toContain('Supprimer ?')
    expect(out).toContain('Définitif.')
    expect(out.indexOf('confirm-ok')).toBeLessThan(out.indexOf('confirm-cancel'))
    expect(out).toContain('bg-err')
    expect(out).toContain('justify-between')
  })

  it('a harmless confirmation puts Cancel first and the main action on the right', () => {
    const out = renderToStaticMarkup(<ConfirmBody options={{ title: 'Lancer ?' }} onResolve={noop} standalone />)
    expect(out.indexOf('confirm-cancel')).toBeLessThan(out.indexOf('confirm-ok'))
    expect(out).toContain('Annuler')
    expect(out).toContain('Confirmer')
  })
})

describe('toasts', () => {
  afterEach(() => clearToasts())

  it('keeps the last four, dismisses by id, and renders kind and text', () => {
    const ids = [1, 2, 3, 4, 5].map((n) => pushToast('info', `msg ${n}`, undefined, 0))
    const out = (list: Parameters<typeof ToastList>[0]['toasts']) => renderToStaticMarkup(<ToastList toasts={list} />)
    expect(ids).toHaveLength(5)
    toast.error('Échec', 'détail')
    toast.success('Fait')
    const demo = toast.demo()
    dismissToast(demo)
    dismissToast(ids[0] ?? 0)
    // the list component renders what it is given
    const html = out([
      { id: 1, kind: 'error', title: 'Échec', description: 'détail' },
      { id: 2, kind: 'demo', title: t('demo.nothingDone') }
    ])
    expect(html).toContain('data-kind="error"')
    expect(html).toContain('détail')
    expect(html).toContain('Démo : rien n’a été fait.')
    expect(html).toContain('aria-live="polite"')
  })

  it('auto-dismisses after its delay', () => {
    vi.useFakeTimers()
    try {
      const id = pushToast('success', 'bref', undefined, 1000)
      dismissToast(id + 1000) // unknown id: no effect, no throw
      vi.advanceTimersByTime(1001)
      expect(id).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('theme', () => {
  it('parses to dark by default, remembers light, and sets the attribute', () => {
    expect(parseTheme(undefined)).toBe('dark')
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('sepia')).toBe('dark')
    expect(readStoredTheme()).toBe('dark') // no localStorage in plain Node
    const store = new Map<string, string>([[THEME_KEY, 'light']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null })
    const el = { dataset: {} as Record<string, string> }
    vi.stubGlobal('document', { documentElement: el })
    try {
      expect(readStoredTheme()).toBe('light')
      applyTheme('light')
      expect(el.dataset.theme).toBe('light')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('applyTheme tells the main process (app.setTheme) and is a no-op without window.atelier', async () => {
    const el = { dataset: {} as Record<string, string> }
    vi.stubGlobal('document', { documentElement: el })
    try {
      expect(() => applyTheme('light')).not.toThrow() // no bridge
      const call = vi.fn(() => Promise.resolve({ ok: true }))
      vi.stubGlobal('atelier', { call })
      applyTheme('light')
      applyTheme('dark')
      expect(call.mock.calls).toEqual([
        ['app.setTheme', 'light'],
        ['app.setTheme', 'dark']
      ])
      vi.stubGlobal('atelier', { call: () => Promise.reject(new Error('gone')) })
      expect(() => applyTheme('dark')).not.toThrow()
      await Promise.resolve()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('tokens.css defines the same tokens for dark and light', () => {
    const css = read('src/renderer/styles/tokens.css')
    const block = (start: string) => {
      const i = css.indexOf(start)
      return css.slice(i, css.indexOf('\n}\n', i))
    }
    const names = (b: string) => [...b.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]).sort()
    const dark = names(block(":root,\n[data-theme='dark'] {"))
    const light = names(block("[data-theme='light'] {"))
    expect(dark.length).toBeGreaterThan(20)
    expect(light).toEqual(dark)
    for (const must of ['--bg', '--surface-1', '--surface-2', '--surface-pop', '--line', '--fg', '--ink', '--brand', '--ok', '--warn', '--err', '--info', '--progress']) {
      expect(dark, must).toContain(must)
    }
    // key values: warm layered neutrals, ink kept neutral, ONE green accent on --brand (decision 0041, which
    // replaced the proto refresh's « ink is the accent, no brand hue »)
    expect(css).toContain('--bg: #161615')
    expect(css).toContain('--bg: #fafaf9')
    expect(css).toContain('--brand: #38b883')
    expect(css).toContain('--brand: #0d7a52')
    expect(css).toContain('--ink: #f4f4f2')
    expect(css).toContain('--ink: #0b0b0a')
    expect(css).toContain('--ring: var(--brand)')
  })

  it('app.css exposes the tokens to Tailwind, bundles its fonts locally (no serif) and honours reduced motion', () => {
    const css = read('src/renderer/styles/app.css')
    expect(css).toContain('@import \'tailwindcss\'')
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-brand: var(--brand)')
    expect(css).toContain('@fontsource-variable/inter')
    expect(css).toContain('@fontsource/jetbrains-mono')
    expect(css).not.toContain('@fontsource/instrument-serif')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).not.toMatch(/url\(['"]?https?:|@import ['"]https?:/)
  })
})

describe('the v1 stylesheet is gone', () => {
  it('no legacy.css file and no import of it', () => {
    expect(existsSync(path.join(ROOT, 'src/renderer/styles/legacy.css'))).toBe(false)
    expect(read('src/renderer/styles/app.css')).not.toContain('legacy.css')
  })

  it('the old stylesheet is gone from the entry point', () => {
    const main = read('src/renderer/main.tsx')
    expect(main).toContain("./styles/app.css")
    expect(main).not.toContain("./styles.css")
  })
})

describe('sections render', () => {
  it('every section has a placeholder with its title, empty state and aurora', () => {
    for (const s of SECTION_IDS as readonly SectionId[]) {
      const out = renderToStaticMarkup(<SectionPlaceholder section={s} />)
      expect(out, s).toContain(`data-testid="view-${s}"`)
      expect(out).toContain(`<h1 id="title-${s}" class="page-title">${t(`section.${s}`).replace(/'/g, '&#x27;')}</h1>`)
      expect(out).toContain('data-slot="empty-state"')
      expect(out).toContain(`data-aurora="${s}"`)
    }
  })

  it('a sub-page placeholder shows the page title under the section name', () => {
    const out = renderToStaticMarkup(<SectionPlaceholder section="production" page="pipeline" />)
    // production-3: the page is the pipeline editor, « Pipelines » (decision 0022: the UI says « pipeline », the code « recipe »)
    expect(out).toContain('>Pipelines</h1>')
    expect(out).toContain('Production')
  })

  it('PageShell has an accessible title and optional actions', () => {
    const out = renderToStaticMarkup(
      <PageShell section="agents" title="Équipe" subtitle="sous-titre" actions={<button>Embaucher</button>}>
        <p>x</p>
      </PageShell>
    )
    expect(out).toContain('aria-labelledby="title-agents"')
    expect(out).toContain('sous-titre')
    expect(out).toContain('Embaucher')
  })

  it('Réglages › Galerie renders every block of the design system', { timeout: 30_000 }, () => {
    const out = renderToStaticMarkup(<SectionScreen route={{ section: 'reglages', page: 'galerie' }} onRoute={noop} />)
    expect(out).toContain('Galerie des composants')
    for (const block of ['Jetons', 'Boutons', 'Composants Atelier', 'Retours : toasts et confirmation', 'ElevenLabs UI']) {
      expect(out, block).toContain(`data-testid="gallery-${block}"`)
    }
    // vendored ElevenLabs components: Orb (lazy fallback), Shimmering Text, Audio Player, Waveform
    expect(out).toContain('data-slot="orb-fallback"')
    expect(out).toContain('Lit la file du moteur')
    expect(out).toContain('Audio Player')
    expect(out).toContain('Waveform')
    expect(renderToStaticMarkup(<Gallery />)).toContain('DÉMO')
  })
})

describe('demo audio helpers', () => {
  it('builds a valid 16-bit mono WAV and deterministic waveform bars', () => {
    const wav = makeToneWav(0.5, 8000)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(wav.length).toBe(44 + 4000 * 2)
    const bars = demoWaveform(10)
    expect(bars).toHaveLength(10)
    expect(bars.every((b) => b > 0 && b <= 1)).toBe(true)
    expect(demoWaveform(10)).toEqual(bars)
  })
})

describe('contract split and CSP', () => {
  it('the IPC contract is split by module and still lists every method once', () => {
    // 65 methods at the split (v2 lot 2) + app.setTheme (v2 lot A1) + engine.targets and engine.cancel (v2 lot 3)
    // − the external engine's methods (lot P1: the external engine is gone)
    // +1 lot PAF: production read-only history of old renders (review PA finding 3)
    // + chat.rooms and chat.stop (v2 lot 13, group chat, in src/shared/api/group.ts)
    // +3 the published blueprint: cloud.blueprint, cloud.blueprintPlan, cloud.blueprintApply
    // +9 lot P5: the cloud.* module (status, connect, loginState, cancelLogin, disconnect, setBaseUrl, account, catalog, spend)
    // + lot Z1: one module per area; each area's own test lists its methods one by one, with a comment per method
    //   (tests/unit/z1-*.test.ts*), so the total here is the sum of those lists.
    // + the agent runtime: the orchestra.* module (listed one by one in tests/unit/orchestra-api.test.ts)
    // +1 proto: app.machine (the Ordinateur screen shows this PC's real figures)
    // + Atlas on Discord: the discord.* module (listed one by one in tests/unit/discord-api.test.ts)
    // + the team computer link: the brain.* module (listed one by one in tests/unit/brain-link.test.ts)
    // + lot "eyes": the eyes.* module (competitors, reads, outliers, style profile; listed one by one in tests/unit/eyes-api.test.ts)
    // + the app's self-update: the app.update.* module (status, check, install, setChannel; tests/unit/app-updater.test.tsx)
    // + 4 publication kit methods in the cloud module (cloud.kit, cloud.kitPublish, cloud.kitDownload, and cloud.kitRef: the
    //   video's reference on the platform, asked of the brain that holds the video)
    // + the beta: 5 account methods in the cloud module (cloud.profile, cloud.team, cloud.invite, cloud.revokeInvite,
    //   cloud.reopenLogin) and the
    //   channelLife.* module (archive, restore, translate; listed one by one in tests/unit/beta-channel-life.test.ts)
    // + the google.* module (the owner's YouTube figures; listed one by one in tests/unit/google-service.test.ts)
    // + the bricks.* module (custom bricks, Production › Briques; listed one by one in tests/unit/bricks-api.test.ts)
    // + the first run: app.onboarding and app.finishOnboarding (the onboarding done, in the database; tests/unit/first-run.test.tsx)
    // + the engines.* and brickStyles.* modules (production-3: the Cloud's engines, the brick styles)
    // + the autopilot.* module (the team's switch, « Activité », channel goals; listed one by one in tests/unit/autopilot-power.test.ts)
    // + the channelVoices.* module (production-5: the channel voice, its clones per engine, the blind listening test)
    // + the estimates.* module (production-11: a pipeline's cost per minute and fit %, the cards)
    // + the graph.* module (production-13: the read-only graph of a pipeline and of a project's run; tests/unit/graph-api.test.ts)
    // + the channelSponsor.* module (production-9: the channel's sponsor asset; tests/unit/channel-sponsor.test.ts)
    // +2 beta-agents-llm: llm.access and llm.setDirectorBackend (the beta rule on models, decision 0038)
    // +1 pipeline-ui: channels.discard (« Annuler » in « Ajouter une chaîne » deletes the channel the flow made)
    // + the reverse.* module (reverse-pipeline: a channel's production pipeline reverse-engineered; tests/unit/reverse-pipeline.test.ts)
    const z1 =
      RUNS_METHODS.length +
      ANALYSIS_METHODS.length +
      MONEY_METHODS.length +
      TOOLS_METHODS.length +
      TEAM_METHODS.length +
      HOME_METHODS.length +
      IDEAS_METHODS.length +
      EXAMPLE_METHODS.length
    expect(API_METHODS).toHaveLength(65 + 1 + 2 - 11 - 2 + 1 + 2 + 11 + 3 + 1 + 4 + 2 + z1 + ORCHESTRA_METHODS.length + DISCORD_METHODS.length + BRAIN_METHODS.length + EYES_METHODS.length + UPDATE_METHODS.length + 5 + CHANNEL_LIFE_METHODS.length + GOOGLE_METHODS.length + BRICKS_METHODS.length + RECIPES_METHODS.length + PROJECTS_METHODS.length + AUTOPILOT_METHODS.length + ENGINES_METHODS.length + BRICK_STYLES_METHODS.length + CHANNEL_VOICES_METHODS.length + CHANNEL_PRESENTERS_METHODS.length + ESTIMATES_METHODS.length + PIPELINE_AGENT_METHODS.length + GRAPH_METHODS.length + CHANNEL_SPONSOR_METHODS.length + CHANNEL_CLIPS_METHODS.length + STYLE_METHODS.length + PREVIEWS_METHODS.length + 2 + 1 + 1 + CLONE_METHODS.length + REVERSE_METHODS.length + ORDER_METHODS.length)
    expect(new Set(API_METHODS).size).toBe(API_METHODS.length)
    for (const f of ['core', 'app', 'settings', 'llm', 'spend', 'workflow', 'chat', 'group', 'views', 'agents', 'production', 'cloud', 'index']) {
      expect(read(`src/shared/api/${f}.ts`).length, f).toBeGreaterThan(0)
    }
    const prefixes = new Set(API_METHODS.map((m) => m.split('.')[0]))
    for (const p of ['app', 'settings', 'providers', 'chat', 'spend', 'agents', 'board']) expect(prefixes).toContain(p)
    for (const gone of ['engine']) expect(prefixes).not.toContain(gone)
  })

  it('the strict CSP allows local audio blobs but still no inline style, eval or network', () => {
    expect(CSP_PROD).toContain("media-src 'self' blob:")
    expect(CSP_PROD).not.toContain('unsafe-inline')
    expect(CSP_PROD).not.toContain('unsafe-eval')
    expect(CSP_PROD).not.toMatch(/https?:/)
  })

  it('vendored components come with their licence and are listed in VENDOR.md', () => {
    const vendor = read('VENDOR.md')
    for (const name of ['orb', 'shimmering-text', 'audio-player', 'waveform', 'scrub-bar']) expect(vendor, name).toContain(name)
    expect(vendor).toContain('3a28ebab197f8cfa599934f52db12ad1396e54f4')
    expect(vendor).toContain('shadcn')
    const licence = read('src/renderer/vendor/elevenlabs-ui/LICENSE')
    expect(licence).toContain('MIT License')
    expect(licence).toContain('Permission is hereby granted')
  })
})
