// Proto Accueil: the dashboard renders from the proto store in plain Node, follows the global channel scope, adapts when
// YouTube Analytics is not connected, and its inbox actions go through the store.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { enPHome } from '../../src/shared/en-p-home'
import { frPHome } from '../../src/shared/fr-p-home'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { HOME_SCREENS } from '../../src/renderer/screens/home'
import { HomeScreen, summaryLine } from '../../src/renderer/screens/home/HomeScreen'
import { dialogKindOf } from '../../src/renderer/screens/home/InboxSection'
import { channelsInScope, daypart, kpisOf, productionVideos, publishedIn28d, runningCount, sparkPath, sparkSeries, weekStrip } from '../../src/renderer/screens/home/home-model'
import { createProtoStore, initialState, ProtoProvider, useProtoActions, type ProtoState } from '../../src/renderer/proto/store'
import { CHANNELS } from '../../src/renderer/proto/data-core'
import { INBOX } from '../../src/renderer/proto/data-team'

const noop = (): void => undefined
const NOW = new Date(2026, 9, 24, 20, 30)

function render(overrides: Partial<ProtoState> = {}, now = NOW): string {
  const store = createProtoStore(initialState(overrides))
  const el: ReactElement = (
    <ProtoProvider store={store}>
      <TooltipProvider>
        <HomeScreen route={{ section: 'accueil' }} onRoute={noop} now={now} />
      </TooltipProvider>
    </ProtoProvider>
  )
  return renderToStaticMarkup(el)
}
const clean = (html: string): void => {
  for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
}
const count = (html: string, needle: string): number => html.split(needle).length - 1

describe('Accueil dashboard', () => {
  it('is registered under accueil and renders the root, one h1, the greeting and the summary', () => {
    expect(HOME_SCREENS.accueil).toBe(HomeScreen)
    const html = render()
    expect(html).toContain('data-testid="view-accueil"')
    expect(count(html, '<h1')).toBe(1)
    expect(html).toContain('Bonsoir Charlie')
    const state = initialState()
    const running = runningCount(productionVideos(state.videos, 'all'))
    expect(html).toContain(summaryLine(running, INBOX.length).replace('’', '’'))
    expect(html).toContain('choses t’attendent')
    clean(html)
  })

  it('greets by time of day', () => {
    expect(daypart(new Date(2026, 9, 24, 8))).toBe('morning')
    expect(daypart(new Date(2026, 9, 24, 15))).toBe('afternoon')
    expect(daypart(new Date(2026, 9, 24, 22))).toBe('evening')
    expect(daypart(new Date(2026, 9, 24, 3))).toBe('evening')
    expect(render({}, new Date(2026, 9, 24, 9))).toContain('Bonjour Charlie')
    expect(render({}, new Date(2026, 9, 24, 14))).toContain('Bon après-midi Charlie')
  })

  it('writes the summary like the agent, with singular and empty cases', () => {
    expect(summaryLine(4, 3)).toBe('4 vidéos avancent, 3 choses t’attendent.')
    expect(summaryLine(1, 1)).toBe('1 vidéo avance, 1 chose t’attend.')
    expect(summaryLine(0, 0)).toBe('Aucune vidéo n’avance pour l’instant, rien ne t’attend.')
  })

  it('lists what waits with the inline action of each kind', () => {
    const html = render()
    expect(count(html, 'data-testid="inbox-row"')).toBe(5)
    for (const label of ['Lire et valider', 'Choisir cette miniature', 'Déposer les fichiers', 'Importer le script', 'Choisir les sujets']) expect(html).toContain(label)
    // the thumbnail row shows three variants to pick from
    expect(count(html, 'aria-label="Miniature ')).toBe(3)
    expect(html).toContain('Script de « Col Dyatlov »')
    clean(html)
  })

  it('maps inbox kinds to dialogs', () => {
    const byId = (id: string) => INBOX.find((i) => i.id === id)!
    expect(dialogKindOf(byId('in-1'))).toBe('script')
    expect(dialogKindOf(byId('in-2'))).toBeNull()
    expect(dialogKindOf(byId('in-3'))).toBe('import-files')
    expect(dialogKindOf(byId('in-4'))).toBe('import-script')
    expect(dialogKindOf(byId('in-5'))).toBe('ideas')
  })

  it('shows the empty state when nothing waits', () => {
    const html = render({ inbox: [] })
    expect(html).toContain('Rien ne t’attend. L’équipe avance.')
    expect(html).not.toContain('data-testid="inbox-row"')
    expect(html).toContain('rien ne t’attend')
  })

  it('shows the videos in production with progress, stage and a status chip, sorted by publication', () => {
    const html = render()
    expect(html).toContain('data-testid="home-production"')
    expect(html).toContain('Le trésor des Templiers a-t-il vraiment existé ?')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('Montage')
    expect(html).not.toContain('Roswell, 1947 : le dossier complet') // published: not in production
    const state = initialState()
    const list = productionVideos(state.videos, 'all')
    expect(list.every((v) => ['running', 'waiting', 'blocked', 'queued'].includes(v.status))).toBe(true)
    const days = list.map((v) => v.publishInDays ?? 999)
    expect(days).toEqual([...days].sort((a, b) => a - b))
    expect(html).toContain('Tout voir (')
  })

  it('shows KPIs with sparklines when channels are connected', () => {
    const html = render()
    expect(html).toContain('data-testid="home-kpis"')
    for (const l of ['Vues, 28 jours', 'Revenus estimés, 28 jours', 'Abonnés', 'Vidéos publiées, 28 jours']) expect(html).toContain(l)
    expect(count(html, 'data-testid="sparkline"')).toBe(4)
    expect(html).toContain('12,3')
    expect(html).not.toContain('data-testid="home-connect"')
  })

  it('adapts to a channel without YouTube Analytics', () => {
    const html = render({ scope: 'ch-top' })
    expect(html).not.toContain('data-testid="home-kpis"')
    expect(html).toContain('data-testid="home-connect"')
    expect(html).toContain('Connecter YouTube Analytics')
    expect(html).toContain('Analytics non connectées')
    clean(html)
  })

  it('filters every block by the global scope', () => {
    const html = render({ scope: 'ch-enigmes' })
    const inbox = (h: string): string => h.slice(h.indexOf('data-testid="home-inbox"'), h.indexOf('data-testid="home-production"'))
    expect(count(html, 'data-testid="inbox-row"')).toBe(3)
    expect(inbox(html)).not.toContain('10 animaux les plus rapides')
    expect(inbox(html)).not.toContain('Clips de gameplay')
    expect(inbox(html)).toContain('Col Dyatlov')
    expect(count(html, 'data-testid="home-channel"')).toBe(1)
    expect(html).not.toContain('Histoires Vraies')
    const top = render({ scope: 'ch-top' })
    expect(count(top, 'data-testid="inbox-row"')).toBe(1)
    expect(inbox(top)).toContain('10 animaux les plus rapides')
    expect(inbox(top)).not.toContain('Col Dyatlov')
    expect(top).not.toContain('Atlantide')
    clean(html + top)
  })

  it('has the week strip, the agent chat card, the channels and the engine', () => {
    const html = render()
    expect(count(html, 'data-testid="week-day"')).toBe(7)
    expect(html).toContain('data-testid="home-agent"')
    expect(html).toContain('data-testid="agent-chat"')
    expect(html).toContain('En ligne')
    expect(count(html, 'data-testid="home-channel"')).toBe(CHANNELS.length)
    expect(count(html, 'data-testid="engine-account"')).toBe(4)
    for (const k of ['Claude Max 20×', 'ChatGPT Plus (Codex)', 'Crédits restants', 'Fenêtre 5 h']) expect(html).toContain(k)
    expect(html).toContain('data-status="limited"')
  })

  it('leaves the chat to the side panel when it is open', () => {
    expect(render({ agentPanelOpen: true })).not.toContain('data-testid="home-agent"')
  })
})

describe('home model', () => {
  const state = initialState()

  it('counts the week per day from today', () => {
    const days = weekStrip(state.videos, 'all')
    expect(days).toHaveLength(7)
    expect(days[0]?.dots).toHaveLength(4)
    expect(days[1]?.dots.length).toBeGreaterThanOrEqual(3)
    expect(weekStrip(state.videos, 'ch-top')[3]?.dots).toHaveLength(1)
  })

  it('sums the connected channels only', () => {
    expect(kpisOf(channelsInScope(state.channels, 'ch-top'), state.videos)).toBeNull()
    const k = kpisOf(channelsInScope(state.channels, 'all'), state.videos)!
    expect(k.views).toBe(2_410_000 + 9_840_000 + 88_000)
    expect(k.subscribers).toBe(184_300 + 62_800 + 3_240)
    expect(k.trendViews).toBeGreaterThan(0)
  })

  it('derives the published count from the cadence', () => {
    const [enigmes, histoires] = [CHANNELS[0]!, CHANNELS[1]!]
    expect(publishedIn28d(enigmes, [])).toBe(12)
    expect(publishedIn28d(histoires, [])).toBe(84)
  })

  it('builds a deterministic sparkline', () => {
    expect(sparkSeries('a', 10)).toEqual(sparkSeries('a', 10))
    expect(sparkSeries('a', 10)).not.toEqual(sparkSeries('b', 10))
    expect(sparkPath(sparkSeries('a', 10))).toMatch(/^M0\.0 /)
  })
})

describe('home actions', () => {
  it('resolving an inbox item removes it from the dashboard and restarts its video', () => {
    const store = createProtoStore(initialState())
    let actions!: ReturnType<typeof useProtoActions>
    function Grab(): null {
      actions = useProtoActions()
      return null
    }
    renderToStaticMarkup(
      <ProtoProvider store={store}>
        <Grab />
      </ProtoProvider>
    )
    expect(store.get().videos.find((v) => v.id === 'v-dyatlov')?.status).toBe('waiting')
    actions.resolveInbox('in-1')
    expect(store.get().inbox.some((i) => i.id === 'in-1')).toBe(false)
    expect(store.get().videos.find((v) => v.id === 'v-dyatlov')?.status).toBe('running')
    const html = renderToStaticMarkup(
      <ProtoProvider store={store}>
        <HomeScreen route={{ section: 'accueil' }} onRoute={noop} now={NOW} />
      </ProtoProvider>
    )
    expect(count(html, 'data-testid="inbox-row"')).toBe(4)
  })
})

describe('home messages', () => {
  it('has no empty French message and an English one for each', () => {
    const keys = Object.keys(frPHome)
    expect(keys.length).toBeGreaterThan(80)
    for (const k of keys) {
      expect((frPHome as Record<string, string>)[k], k).not.toBe('')
      expect((fr as Record<string, string>)[k], k).toBeDefined()
      expect((enPHome as Record<string, string>)[k], `en ${k}`).toBeTruthy()
    }
    expect(Object.keys(enPHome).every((k) => k in frPHome)).toBe(true)
  })
})
