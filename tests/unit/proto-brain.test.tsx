// Proto Cerveau and Monétisation: both render from the proto store in plain Node, follow the channel scope, and their
// pure maths (map layout, niche filters, idea board, P&L) is pinned.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { enPBrain } from '../../src/shared/en-p-brain'
import { frPBrain } from '../../src/shared/fr-p-brain'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { BRAIN_SCREENS } from '../../src/renderer/screens/brain'
import { BrainScreen } from '../../src/renderer/screens/brain/BrainScreen'
import { IdeasBoard } from '../../src/renderer/screens/brain/IdeasBoard'
import { NichesTab } from '../../src/renderer/screens/brain/NichesTab'
import { CompetitorMap } from '../../src/renderer/screens/brain/CompetitorMap'
import { generateIdeas, IDEAL_ZONE, inIdealZone, layoutMap, moveIdea, nicheView, placeLabels, researchAgent, risingNiches, styleClusters, visibleNiches, brainReply } from '../../src/renderer/screens/brain/brain-model'
import { MONEY_SCREENS } from '../../src/renderer/screens/money'
import { MoneyScreen } from '../../src/renderer/screens/money/MoneyScreen'
import { MoneyProtoScreen } from '../../src/renderer/screens/money/proto/MoneyProtoScreen'
import { computeLedger, fmtRoi, videoReturns, weeklyShape, WEEKS } from '../../src/renderer/screens/money/proto/money-model'
import { daysAgoOf } from '../../src/renderer/screens/money/proto/EntryDialog'
import { SectionScreen, SCREENS } from '../../src/renderer/screens/SectionScreen'
import { COMPETITORS, competitorsOf, IDEA_BOARD, IDEA_POOL, NICHES, OUTPERFORMERS } from '../../src/renderer/proto/data-brain'
import { LEDGER_VIDEOS, SEED_ENTRIES } from '../../src/renderer/proto/data-brain-money'
import { CHANNELS } from '../../src/renderer/proto/data-core'
import { createProtoStore, initialState, ProtoProvider, type ProtoState } from '../../src/renderer/proto/store'

const noop = (): void => undefined

function render(el: ReactElement, overrides: Partial<ProtoState> = {}): string {
  const store = createProtoStore(initialState(overrides))
  return renderToStaticMarkup(
    <ProtoProvider store={store}>
      <TooltipProvider>{el}</TooltipProvider>
    </ProtoProvider>
  )
}
const clean = (html: string): void => {
  for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
}
const count = (html: string, needle: string): number => html.split(needle).length - 1

describe('Cerveau screen', () => {
  it('is registered under cerveau, renders one h1, the three views and the research agent chat', () => {
    expect(BRAIN_SCREENS.cerveau).toBe(BrainScreen)
    expect(SCREENS.cerveau).toBe(BrainScreen)
    const html = render(<BrainScreen route={{ section: 'cerveau' }} onRoute={noop} />)
    expect(html).toContain('data-testid="view-cerveau"')
    expect(count(html, '<h1')).toBe(1)
    for (const label of ['Mes concurrents', 'Carte des niches', 'Idées']) expect(html).toContain(label)
    expect(html).toContain('data-testid="brain-chat"')
    expect(html).toContain('J’ai passé 62 chaînes en revue')
    clean(html)
  })

  it('opens on the competitor map of the first channel with a picker when the scope is all', () => {
    const html = render(<BrainScreen route={{ section: 'cerveau' }} onRoute={noop} />)
    expect(html).toContain('data-testid="competitor-map"')
    expect(count(html, 'data-rising=')).toBe(competitorsOf('ch-enigmes').length)
    for (const c of CHANNELS) expect(html).toContain(c.name)
    expect(html).toContain('Vidéos qui surperforment chez tes concurrents')
    expect(count(html, 'data-testid="outperformer"')).toBe(OUTPERFORMERS['ch-enigmes']?.length)
    expect(html).toContain('En faire une idée')
    clean(html)
  })

  it('follows the channel scope: the map, the outperformers and the chat agent change', () => {
    const html = render(<BrainScreen route={{ section: 'cerveau' }} onRoute={noop} />, { scope: 'ch-histoires' })
    expect(html).toContain('data-channel="ch-histoires"')
    expect(count(html, 'data-rising=')).toBe(competitorsOf('ch-histoires').length)
    expect(html).toContain('Autour de Histoires Vraies')
    // the researcher of Histoires Vraies talks, not the main agent
    expect(html).toContain('Noé')
    expect(html).toContain('Recherche de sujets')
    expect(html).toContain('Confessions FR et Voisins Terribles')
    // no channel picker when one channel is in scope
    expect(html).not.toContain('role="radio" aria-checked="true">Les Grandes Énigmes')
    clean(html)
  })

  it('a channel without a researcher is answered by its competitor analyst', () => {
    const state = initialState({ scope: 'ch-mystery' })
    expect(researchAgent(state.agents, 'ch-mystery')?.role).toBe('competitor-analyst')
    expect(researchAgent(state.agents, 'ch-enigmes')?.role).toBe('researcher')
    expect(researchAgent(state.agents, 'all')?.role).toBe('principal')
  })

  it('a channel with no competitors shows an empty state, not a broken map', () => {
    const html = render(<BrainScreen route={{ section: 'cerveau' }} onRoute={noop} />, { scope: 'ch-unknown' })
    expect(html).toContain('data-testid="competitors-empty"')
    clean(html)
  })

  it('the niche tab renders the scatter, the ideal zone, filters and the rising list', () => {
    const html = render(<NichesTab onCreate={noop} onTranslate={noop} />)
    expect(html).toContain('data-testid="niche-map"')
    expect(html).toContain('data-testid="ideal-zone"')
    expect(html).toContain('Zone idéale')
    for (const l of ['Français', 'Anglais', 'Espagnol', 'Vidéos longues', 'Shorts', 'Faceless seulement']) expect(html).toContain(l)
    expect(count(html, 'data-testid="niche-bubble"')).toBe(NICHES.filter((n) => n.formats.includes('long')).length)
    expect(count(html, 'data-testid="rising-row"')).toBe(5)
    expect(html).toContain('Ça monte en ce moment')
    clean(html)
  })

  it('the idea board has three columns, the cards of the scope, and the launch button only on approved ideas', () => {
    const html = render(<IdeasBoard ideas={IDEA_BOARD} generating={false} onMove={noop} />)
    for (const c of ['Proposées', 'Validées', 'En production']) expect(html).toContain(c)
    expect(count(html, 'data-testid="idea-card"')).toBe(IDEA_BOARD.length)
    expect(count(html, 'data-testid="idea-validate"')).toBe(IDEA_BOARD.filter((i) => i.column === 'proposed').length)
    expect(count(html, 'data-testid="idea-launch"')).toBe(IDEA_BOARD.filter((i) => i.column === 'validated').length)
    const busy = render(<IdeasBoard ideas={[]} generating onMove={noop} />)
    expect(count(busy, 'data-testid="idea-skeleton"')).toBe(5)
    clean(html)
  })

  it('shows the competitor card when one is selected', () => {
    const c = competitorsOf('ch-enigmes')[4]!
    const html = render(
      <CompetitorMap channel={CHANNELS[0]!} list={competitorsOf('ch-enigmes')} selectedId={c.id} onSelect={noop} watched={new Set()} onWatch={noop} onAsk={noop} />
    )
    expect(html).toContain('data-testid="competitor-card"')
    for (const l of [c.name, 'Surveiller', 'Analyser son style', 'Traduire cette chaîne', 'Ce qu’ils font mieux', 'Score outlier', 'RPM estimé']) expect(html).toContain(l)
    const watched = render(
      <CompetitorMap channel={CHANNELS[0]!} list={competitorsOf('ch-enigmes')} selectedId={c.id} onSelect={noop} watched={new Set([c.id])} onWatch={noop} onAsk={noop} />
    )
    expect(watched).toContain('Sous surveillance')
    clean(html)
  })
})

describe('Cerveau maths', () => {
  it('lays the competitors out without overlaps, nearer when more similar, inside the canvas', () => {
    for (const ch of CHANNELS) {
      for (const [w, h] of [
        [480, 514],
        [760, 514]
      ] as const) {
        const list = competitorsOf(ch.id)
        const placed = layoutMap(list, w, h)
        expect(placed).toHaveLength(list.length)
        for (let i = 0; i < placed.length; i++) {
          const a = placed[i]!
          expect(a.x - a.r).toBeGreaterThanOrEqual(0)
          expect(a.x + a.r).toBeLessThanOrEqual(w)
          expect(a.y - a.r).toBeGreaterThanOrEqual(0)
          expect(a.y + a.r).toBeLessThanOrEqual(h)
          // clear of our own channel, drawn at the centre
          expect(Math.hypot(a.x - w / 2, a.y - h / 2)).toBeGreaterThan(a.r + 32)
          for (let j = i + 1; j < placed.length; j++) {
            const b = placed[j]!
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.c.name} / ${b.c.name} at ${w}`).toBeGreaterThanOrEqual(a.r + b.r)
          }
        }
        const closest = [...placed].sort((p, q) => b2(p, w, h) - b2(q, w, h))[0]!
        const furthest = [...placed].sort((p, q) => b2(q, w, h) - b2(p, w, h))[0]!
        expect(closest.c.similarity).toBeGreaterThan(furthest.c.similarity)
      }
    }
  })

  it('bigger channels get bigger circles, at most four style colours', () => {
    const placed = layoutMap(competitorsOf('ch-enigmes'), 760, 514)
    const big = placed.find((p) => p.c.subscribers === Math.max(...COMPETITORS.filter((c) => c.channelId === 'ch-enigmes').map((c) => c.subscribers)))!
    const small = placed.find((p) => p.c.subscribers === Math.min(...COMPETITORS.filter((c) => c.channelId === 'ch-enigmes').map((c) => c.subscribers)))!
    expect(big.r).toBeGreaterThan(small.r)
    for (const ch of CHANNELS) expect(styleClusters(competitorsOf(ch.id)).length).toBeLessThanOrEqual(4)
  })

  it('filters the niches by language, format and faceless, and keeps the ideal zone meaningful', () => {
    const all = visibleNiches({ lang: 'fr', format: 'long', facelessOnly: false })
    const faceless = visibleNiches({ lang: 'fr', format: 'long', facelessOnly: true })
    expect(faceless.length).toBeLessThan(all.length)
    expect(faceless.every((v) => v.niche.faceless)).toBe(true)
    const shorts = visibleNiches({ lang: 'fr', format: 'short', facelessOnly: false })
    expect(shorts.every((v) => v.niche.formats.includes('short'))).toBe(true)
    expect(shorts.length).toBeLessThan(all.length)
    const sports = NICHES.find((n) => n.id === 'sports')!
    expect(nicheView(sports, 'en', 'long').rpm).toBeGreaterThan(nicheView(sports, 'fr', 'long').rpm)
    expect(nicheView(sports, 'es', 'long').x).toBeLessThan(nicheView(sports, 'en', 'long').x)
    expect(nicheView(sports, 'fr', 'short').rpm).toBeLessThan(nicheView(sports, 'fr', 'long').rpm)
    const inZone = all.filter(inIdealZone)
    expect(inZone.length).toBeGreaterThanOrEqual(2)
    expect(inZone.every((v) => v.x <= IDEAL_ZONE.xMax && v.y >= IDEAL_ZONE.yMin)).toBe(true)
    expect(risingNiches(all, 5)).toHaveLength(5)
    expect(risingNiches(all, 5)[0]!.growth30).toBeGreaterThanOrEqual(risingNiches(all, 5)[4]!.growth30)
  })

  it('places niche labels without letting two overlap', () => {
    const items = visibleNiches({ lang: 'fr', format: 'long', facelessOnly: false }).map((v, i) => ({ id: v.niche.id, label: `Niche ${v.niche.id}`, x: 60 + v.x * 6, y: 400 - v.y * 3.5, r: 12 + (i % 4) * 3 }))
    const spots = placeLabels(items, { x: 0, y: 0, w: 700, h: 420 })
    expect(spots.length).toBeGreaterThan(8)
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length)
  })

  it('moves ideas between columns and asks for five new ones without repeating a title', () => {
    const moved = moveIdea(IDEA_BOARD, 'id-e1', 'validated')
    expect(moved.find((i) => i.id === 'id-e1')?.column).toBe('validated')
    expect(IDEA_BOARD.find((i) => i.id === 'id-e1')?.column).toBe('proposed')
    const five = generateIdeas(IDEA_BOARD, 'ch-enigmes', CHANNELS.map((c) => c.id), 5, 1)
    expect(five).toHaveLength(5)
    expect(five.every((i) => i.channelId === 'ch-enigmes' && i.column === 'proposed')).toBe(true)
    expect(new Set(five.map((i) => i.title)).size).toBe(5)
    const again = generateIdeas([...IDEA_BOARD, ...five], 'ch-enigmes', CHANNELS.map((c) => c.id), 5, 2)
    expect(again.every((i) => !five.some((f) => f.title === i.title))).toBe(true)
    const mixed = generateIdeas(IDEA_BOARD, 'all', CHANNELS.map((c) => c.id), 5, 3)
    expect(new Set(mixed.map((i) => i.channelId)).size).toBeGreaterThan(1)
    for (const id of Object.keys(IDEA_POOL)) expect((IDEA_POOL[id] ?? []).length).toBeGreaterThanOrEqual(5)
  })

  it('answers about niches, competitors, faceless and translation with real figures', () => {
    const ctx = { scope: 'all' as const, nicheName: (id: string) => id }
    expect(brainReply('Quelles niches montent ?', ctx)).toContain('+33 %')
    expect(brainReply('Trouve-moi une niche faceless', ctx)).toContain('sans visage')
    expect(brainReply('Qui décolle autour de ma chaîne ?', ctx)).toContain('score')
    expect(brainReply('on traduit en anglais ?', ctx)).toContain('1,45')
    expect(brainReply('blabla', ctx).length).toBeGreaterThan(20)
  })
})

// Normalised distance from the centre, to compare similarity with position.
function b2(p: { x: number; y: number }, w: number, h: number): number {
  const rx = Math.max(80, w / 2 - 44)
  const ry = Math.max(80, h / 2 - 36)
  return Math.hypot((p.x - w / 2) / rx, (p.y - h / 2) / ry)
}

describe('Monétisation screen', () => {
  const route = { section: 'monetisation' as const }

  it('is registered under monetisation and keeps the six-tab screen reachable', () => {
    expect(MONEY_SCREENS.monetisation).toBe(MoneyProtoScreen)
    expect(SCREENS.monetisation).toBe(MoneyProtoScreen)
    const advanced = render(<MoneyProtoScreen route={route} onRoute={noop} initialView="advanced" />)
    expect(advanced).toContain('data-testid="money-advanced"')
    expect(advanced).toContain('data-testid="view-monetisation"')
    expect(count(advanced, 'data-testid="view-monetisation"')).toBe(1)
    expect(advanced).toContain('Vue d’ensemble')
    expect(advanced).toContain('Vue claire')
    expect(advanced).toBeTruthy()
    expect(typeof MoneyScreen).toBe('function')
  })

  it('renders the KPIs, the chart, the per-channel table, the per-video list, subscriptions and credits', () => {
    const html = render(<SectionScreen route={route} onRoute={noop} />)
    expect(html).toContain('data-testid="view-monetisation"')
    expect(count(html, '<h1')).toBe(1)
    for (const k of ['Revenus sur 28 jours', 'Coûts sur 28 jours', 'Marge', 'Coût moyen par vidéo', 'Revenu moyen par vidéo']) expect(html).toContain(k)
    expect(html).toContain('data-testid="money-chart"')
    expect(html).toContain('data-testid="pnl-table"')
    expect(count(html, 'data-testid="pnl-row"')).toBe(CHANNELS.length + 1)
    expect(count(html, 'data-testid="money-video"')).toBe(LEDGER_VIDEOS.length)
    expect(count(html, 'data-testid="money-sub"')).toBe(4)
    expect(html).toContain('Abonnements IA')
    expect(html).toContain('Recharge automatique')
    expect(html).toContain('Ajouter un revenu')
    expect(html).toContain('Ajouter une dépense')
    expect(html).toContain('Avancé')
    clean(html)
  })

  it('marks channels without YouTube Analytics as estimated', () => {
    const html = render(<MoneyProtoScreen route={route} onRoute={noop} />)
    expect(count(html, 'data-testid="pnl-estimated"')).toBe(CHANNELS.filter((c) => !c.connected).length)
    expect(html).toContain('Revenus estimés')
    expect(html).toContain('connecte YouTube Analytics pour les vrais chiffres')
  })

  it('follows the channel scope', () => {
    const html = render(<MoneyProtoScreen route={route} onRoute={noop} />, { scope: 'ch-histoires' })
    expect(count(html, 'data-testid="pnl-row"')).toBe(1)
    expect(html).toContain('data-channel="ch-histoires"')
    expect(count(html, 'data-testid="money-video"')).toBe(LEDGER_VIDEOS.filter((v) => v.channelId === 'ch-histoires').length)
    expect(html).not.toContain('data-estimated="true"')
    clean(html)
  })

  it('has French and English text for every key of the area', () => {
    for (const k of Object.keys(frPBrain)) {
      expect(fr[k as keyof typeof fr].trim(), k).not.toBe('')
      expect(enPBrain[k as keyof typeof enPBrain], k).toBeTruthy()
    }
    for (const k of Object.keys(enPBrain)) expect(k in frPBrain, k).toBe(true)
  })
})

describe('Monétisation maths', () => {
  const state = initialState()
  const input = { channels: state.channels, pipelines: state.pipelines, accounts: state.accounts, entries: SEED_ENTRIES, scope: 'all' as const }

  it('adds up revenue, costs and margin consistently', () => {
    const l = computeLedger(input)
    const rev = l.rows.reduce((a, r) => a + r.revenue, 0)
    const cost = l.rows.reduce((a, r) => a + r.cost, 0)
    expect(l.total.revenue).toBeCloseTo(rev, 6)
    expect(l.total.cost).toBeCloseTo(cost, 6)
    expect(l.kpis.margin).toBeCloseTo(l.kpis.revenue - l.kpis.cost, 6)
    // AdSense of every channel is the dashboard figure, sponsors come from the entries
    expect(l.total.adsense).toBe(CHANNELS.reduce((a, c) => a + c.revenue28d, 0))
    expect(l.total.sponsors).toBe(600 + 1200)
    expect(l.total.products).toBe(340)
    // the subscriptions are fully shared out between the channels, the computer too
    expect(l.total.claude).toBeCloseTo(l.subsMonthly, 6)
    expect(l.kpis.costPerVideo).toBeCloseTo(l.kpis.cost / l.kpis.videos, 6)
    expect(l.anyEstimated).toBe(true)
  })

  it('a revenue added by hand raises revenue and margin, an expense raises costs', () => {
    const base = computeLedger(input)
    const more = computeLedger({ ...input, entries: [{ id: 'x', type: 'revenue', kind: 'sponsor', label: 'Test', channelId: 'ch-enigmes', amount: 500, daysAgo: 1 }, ...SEED_ENTRIES] })
    expect(more.kpis.revenue - base.kpis.revenue).toBeCloseTo(500, 6)
    expect(more.rows.find((r) => r.channel?.id === 'ch-enigmes')!.sponsors - base.rows.find((r) => r.channel?.id === 'ch-enigmes')!.sponsors).toBe(500)
    const spent = computeLedger({ ...input, entries: [{ id: 'y', type: 'expense', kind: 'tool', label: 'Test', channelId: null, amount: 80, daysAgo: 2 }, ...SEED_ENTRIES] })
    expect(spent.kpis.cost - base.kpis.cost).toBeCloseTo(80, 6)
    expect(spent.kpis.margin - base.kpis.margin).toBeCloseTo(-80, 6)
    // rows older than 28 days are not counted
    const old = computeLedger({ ...input, entries: [{ id: 'z', type: 'revenue', kind: 'sponsor', label: 'Old', channelId: 'ch-top', amount: 999, daysAgo: 40 }, ...SEED_ENTRIES] })
    expect(old.kpis.revenue).toBeCloseTo(base.kpis.revenue, 6)
  })

  it('scopes to one channel', () => {
    const l = computeLedger({ ...input, scope: 'ch-top' })
    expect(l.rows).toHaveLength(1)
    expect(l.rows[0]!.channel?.id).toBe('ch-top')
    expect(l.rows[0]!.sponsors).toBe(600)
    expect(l.rows[0]!.estimated).toBe(true)
  })

  it('draws twelve weeks whose last four weeks add up to the 28-day AdSense', () => {
    const s = weeklyShape('ch-enigmes', 12, 6870)
    expect(s).toHaveLength(WEEKS)
    expect(s.slice(-4).reduce((a, b) => a + b, 0)).toBeCloseTo(6870, 6)
    expect(s.every((v) => v > 0)).toBe(true)
    const l = computeLedger(input)
    expect(l.weeks.revenue).toHaveLength(WEEKS)
    expect(l.weeks.cost).toHaveLength(WEEKS)
    expect(Math.max(...l.weeks.revenue)).toBeGreaterThan(Math.max(...l.weeks.cost))
  })

  it('prices each video from its credits and the revenue per view of its channel', () => {
    const rows = videoReturns(state.channels, 'all')
    expect(rows).toHaveLength(10)
    const roswell = rows.find((r) => r.video.id === 'lv-1')!
    expect(roswell.costEuro).toBeCloseTo(452 * 0.0075, 6)
    expect(roswell.estimated).toBe(false)
    expect(rows.find((r) => r.video.channelId === 'ch-top')!.estimated).toBe(true)
    expect(rows.every((r) => r.roi > 1)).toBe(true)
    expect(videoReturns(state.channels, 'ch-top').every((r) => r.video.channelId === 'ch-top')).toBe(true)
    expect(fmtRoi(5.25)).toBe('×5,3')
    expect(fmtRoi(1431.4)).toMatch(/^×1\s?431$/)
  })

  it('reads a date as days ago, never negative', () => {
    const today = new Date(2026, 9, 24)
    expect(daysAgoOf('2026-10-24', today)).toBe(0)
    expect(daysAgoOf('2026-10-14', today)).toBe(10)
    expect(daysAgoOf('2026-11-02', today)).toBe(0)
    expect(daysAgoOf('', today)).toBe(0)
  })
})
