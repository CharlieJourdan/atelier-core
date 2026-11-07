// Real mode, Cerveau and Monétisation: the database's ideas as the idea board, the measured P&L / spend ledger / revenues
// as the Monétisation ledger, the store's actions through a (fake) live driver, and both screens rendered in live mode
// (real data shown, what has no source labelled « Données de démonstration »).
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IdeaRow } from '../../src/shared/api/ideas'
import type { MoneyOverview } from '../../src/shared/api/money'
import type { SpendOverview } from '../../src/shared/api/spend'
import { emptyByType, type PnlRow, type RevenueRow } from '../../src/shared/money'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { BrainScreen } from '../../src/renderer/screens/brain/BrainScreen'
import { MoneyProtoScreen } from '../../src/renderer/screens/money/proto/MoneyProtoScreen'
import { liveLedger, liveVideoReturns, subscriptionsMonthly } from '../../src/renderer/screens/money/proto/money-live'
import { channelIdOf, columnOfStatus, ideaIdOf, ideaKey, mapIdea, mapIdeas, statusOfColumn } from '../../src/renderer/proto/live/mapping-brain'
import {
  entriesOfRevenues,
  entryOfRevenue,
  LIVE_REVENUE_KINDS,
  mapSubscriptions,
  mapVideoCosts,
  revenueIdOf,
  revenueInputOf,
  subscriptionsSetting,
  videoCostEur,
  type LiveMoney
} from '../../src/renderer/proto/live/mapping-money'
import { setLiveDriver, type LiveBrainDriver, type LiveDriver, type LiveMoneyDriver, type LiveSnapshot } from '../../src/renderer/proto/live/registry'
import { applySnapshot, createProtoStore, initialState, ProtoProvider, storeActions, type ProtoState } from '../../src/renderer/proto/store'
import type { EngineAccount, ProtoChannel } from '../../src/renderer/proto/types'
import { CHANNELS } from '../../src/renderer/proto/data-core'

const NOW = new Date(2026, 9, 24, 15, 0)

/* ---------- fixtures ---------- */

function idea(p: Partial<IdeaRow> & Pick<IdeaRow, 'id' | 'title'>): IdeaRow {
  return { channelId: 7, channelName: 'Histoire', angle: '', source: 'manual', score: null, status: 'new', videoId: null, example: false, createdAt: '2026-10-20T10:00:00Z', ...p }
}

const channel = (id: number, name: string): ProtoChannel => ({
  ...CHANNELS[0]!,
  id: `db-${id}`,
  name,
  handle: '',
  connected: false,
  subscribers: 0,
  views28d: 0,
  revenue28d: 0,
  trend: 0,
  pipelineIds: [],
  products: []
})

const account = (n: number, label: string): EngineAccount => ({ id: `acc-live-${n}`, provider: 'claude-code', label, owner: 'Charlie', plan: 'Abonnement', usage5h: 0, usageWeek: 10, status: 'ok' })

function pnl(p: Partial<PnlRow> & Pick<PnlRow, 'channelId'>): PnlRow {
  return {
    month: '2026-10',
    revenueByType: emptyByType(),
    revenueCents: 0,
    aiCents: 0,
    engineCents: 0,
    toolsCents: 0,
    costCents: 0,
    marginCents: 0,
    rpmCents: null,
    views: null,
    publishedVideos: 0,
    costPerVideoCents: null,
    breakEvenVideos: null,
    sources: { revenue: 'entered', ai: 'measured', engine: 'measured', tools: 'estimated', margin: 'estimated', rpm: 'estimated' },
    ...p
  }
}

const OVERVIEW: MoneyOverview = {
  month: '2026-10',
  months: ['2026-10'],
  channels: [
    { id: 7, name: 'Histoire', example: false },
    { id: 8, name: 'Science', example: false },
    { id: 9, name: 'Exemple', example: true }
  ],
  rows: [
    pnl({
      channelId: 7,
      revenueByType: { adsense: 10_000, sponsor: 60_000, product: 5_000, affiliate: 2_000, other: 1_000 },
      revenueCents: 78_000,
      aiCents: 1_200,
      engineCents: 3_000,
      toolsCents: 500,
      costCents: 4_700,
      publishedVideos: 3
    }),
    pnl({ channelId: 8, aiCents: 800, costCents: 800, publishedVideos: 1 }),
    pnl({ channelId: 9, revenueByType: { ...emptyByType(), sponsor: 99_900 }, revenueCents: 99_900, aiCents: 5_000, costCents: 5_000, publishedVideos: 9, sources: { revenue: 'example', ai: 'example', engine: 'example', tools: 'estimated', margin: 'example', rpm: 'estimated' } }),
    pnl({ channelId: 7, month: '2026-09', revenueCents: 40_000, revenueByType: { ...emptyByType(), sponsor: 40_000 } }),
    pnl({ channelId: null, aiCents: 300, costCents: 300 })
  ],
  totals: { revenueCents: 78_000, costCents: 6_800, marginCents: 71_200, views: null, rpmCents: null, example: null },
  weekly: [
    { week: '2026-09-07', revenueCents: 1_000, costCents: 100 },
    { week: '2026-09-14', revenueCents: 1_000, costCents: 100 },
    { week: '2026-09-21', revenueCents: 1_000, costCents: 100 },
    { week: '2026-09-28', revenueCents: 1_000, costCents: 100 },
    { week: '2026-10-05', revenueCents: 2_000, costCents: 200 },
    { week: '2026-10-12', revenueCents: 2_000, costCents: 200 },
    { week: '2026-10-19', revenueCents: 2_000, costCents: 200 },
    { week: '2026-10-26', revenueCents: 2_000, costCents: 200 }
  ],
  usdToEur: 0.9,
  viewsKnown: false
}

const SPEND: SpendOverview = { month: '2026-10', spentUsd: 12.34, reservedUsd: 0.5, calls: 17, globalCapUsd: 50, channels: [] }

function revenue(p: Partial<RevenueRow> & Pick<RevenueRow, 'id'>): RevenueRow {
  return { date: '2026-10-20', channelId: 7, channelName: 'Histoire', videoId: null, type: 'sponsor', amountCents: 60_000, currency: 'EUR', source: 'manual', note: 'NordVPN', example: false, ...p }
}

function money(p: Partial<LiveMoney> = {}): LiveMoney {
  return {
    overview: OVERVIEW,
    spend: SPEND,
    videoCosts: [
      { videoId: 5, title: 'Les Templiers', channelId: 'db-7', usd: 1, credits: 200 },
      { videoId: 6, title: 'Voynich', channelId: 'db-8', usd: 0.5, credits: 0 }
    ],
    revenues: [revenue({ id: 1 }), revenue({ id: 2, source: 'example', example: true, note: 'Exemple' })],
    subscriptions: { 'acc-live-1': 20 },
    ...p
  }
}

/* ---------- ideas ---------- */

describe('real mode: the ideas board', () => {
  it('statuses are columns: new → proposées, kept → validées, used → en production, rejected are gone', () => {
    expect(columnOfStatus('new')).toBe('proposed')
    expect(columnOfStatus('kept')).toBe('validated')
    expect(columnOfStatus('used')).toBe('production')
    expect(columnOfStatus('rejected')).toBeNull()
    expect(statusOfColumn('proposed')).toBe('new')
    expect(statusOfColumn('validated')).toBe('kept')
    expect(statusOfColumn('production')).toBe('used')
  })

  it('an idea keeps its agent score or none: a manual idea is unscored, with no views estimate', () => {
    const typed = mapIdea(idea({ id: 3, title: 'À la main', angle: 'un angle' }))!
    expect(typed).toMatchObject({ id: 'idea-3', channelId: 'db-7', title: 'À la main', angle: 'un angle', source: 'manual', potential: 0, unscored: true, estViews: 0, column: 'proposed', liveId: 3 })
    const found = mapIdea(idea({ id: 4, title: 'De l’agent', source: 'agent', score: 82.4, status: 'kept' }))!
    expect(found).toMatchObject({ source: 'atlas', potential: 82, column: 'validated' })
    expect(found.unscored).toBeUndefined()
    expect(mapIdea(idea({ id: 5, title: 'x', source: 'agent', score: 250 }))!.potential).toBe(100)
    expect(mapIdea(idea({ id: 6, title: 'x', status: 'rejected' }))).toBeNull()
  })

  it('the board is newest first and leaves rejected ideas out', () => {
    const board = mapIdeas([idea({ id: 1, title: 'a' }), idea({ id: 3, title: 'c' }), idea({ id: 2, title: 'b', status: 'rejected' })])
    expect(board.map((i) => i.id)).toEqual(['idea-3', 'idea-1'])
  })

  it('ids go both ways', () => {
    expect(ideaKey(7)).toBe('idea-7')
    expect(ideaIdOf('idea-7')).toBe(7)
    expect(ideaIdOf('id-e1')).toBeNull()
    expect(channelIdOf('db-12')).toBe(12)
    expect(channelIdOf('ch-enigmes')).toBeNull()
  })
})

/* ---------- money mapping ---------- */

describe('real mode: money mapping', () => {
  it('a video costs its model calls (at the typed rate) plus its real credits; demo and example runs debit nothing', () => {
    const costs = mapVideoCosts(
      [
        { key: '5', label: 'Les Templiers', spentUsd: 2, calls: 3, inputTokens: 0, outputTokens: 0 },
        { key: '', label: '(no video)', spentUsd: 9, calls: 1, inputTokens: 0, outputTokens: 0 },
        { key: '6', label: 'Voynich', spentUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 }
      ],
      [
        { videoId: 5, spentCredits: 150, demo: false, example: false },
        { videoId: 5, spentCredits: 50, demo: false, example: false },
        { videoId: 6, spentCredits: 400, demo: true, example: false },
        { videoId: 6, spentCredits: 400, demo: false, example: true },
        { videoId: 8, spentCredits: 100, demo: false, example: false }
      ],
      [
        { id: 5, title: 'Les Templiers', channelId: 7 },
        { id: 6, title: 'Voynich', channelId: 8 }
      ]
    )
    // video 6 cost nothing, video 8 is gone, the « no video » spend is not a video
    expect(costs).toEqual([{ videoId: 5, title: 'Les Templiers', channelId: 'db-7', usd: 2, credits: 200 }])
    expect(videoCostEur(costs[0]!, 0.9)).toBeCloseTo(2 * 0.9 + 2, 6)
  })

  it('typed subscription prices round-trip through the setting; anything that is not a price is ignored', () => {
    expect(mapSubscriptions({ '3': 20, '4': 0, x: 5, '5': -1, '6': 'dix' })).toEqual({ 'acc-live-3': 20, 'acc-live-4': 0 })
    expect(mapSubscriptions(null)).toEqual({})
    expect(mapSubscriptions([1, 2])).toEqual({})
    expect(subscriptionsSetting({ 'acc-live-3': 20, 'acc-demo': 5, 'acc-live-4': -2 })).toEqual({ '3': 20 })
  })

  it('a revenue row is an entry in euros (USD at the typed rate); example rows are left out', () => {
    expect(entryOfRevenue(revenue({ id: 4 }), 0.9, NOW)).toEqual({ id: 'rev-4', type: 'revenue', kind: 'sponsor', label: 'NordVPN', channelId: 'db-7', amount: 600, daysAgo: 4 })
    const usd = entryOfRevenue(revenue({ id: 5, currency: 'USD', amountCents: 10_000, channelId: null, note: ' ', type: 'adsense' }), 0.9, NOW)
    expect(usd).toMatchObject({ kind: 'adsense', channelId: null, amount: 90, label: 'AdSense' })
    const list = entriesOfRevenues([revenue({ id: 1, date: '2026-10-10' }), revenue({ id: 2, source: 'example' }), revenue({ id: 3, date: '2026-10-23' })], 0.9, NOW)
    expect(list.map((e) => e.id)).toEqual(['rev-3', 'rev-1'])
    expect(revenueIdOf('rev-3')).toBe(3)
    expect(revenueIdOf('en-1')).toBeNull()
  })

  it('« Ajouter un revenu » becomes a revenue input: euros in cents, on the chosen day, the kind as a revenue type', () => {
    const input = revenueInputOf({ type: 'revenue', kind: 'collab', label: 'Échange de placement', channelId: 'db-7', amount: 12.5, daysAgo: 3 }, NOW)
    expect(input).toEqual({ date: '2026-10-21', channelId: 7, type: 'sponsor', amountCents: 1250, currency: 'EUR', note: 'Échange de placement' })
    expect(revenueInputOf({ type: 'revenue', kind: 'affiliate', label: 'x', channelId: null, amount: 1, daysAgo: 0 }, NOW)).toMatchObject({ date: '2026-10-24', channelId: null, type: 'affiliate' })
    expect(LIVE_REVENUE_KINDS.every((k) => revenueInputOf({ type: 'revenue', kind: k, label: 'x', channelId: null, amount: 1, daysAgo: 0 }, NOW).type !== undefined)).toBe(true)
  })
})

/* ---------- the ledger ---------- */

describe('real mode: the P&L ledger', () => {
  const channels = [channel(7, 'Histoire'), channel(8, 'Science')]
  const accounts = [account(1, 'Claude Code'), account(2, 'Codex')]

  it('is the month’s measured P&L: example channels out, subscriptions as typed and shared by published videos', () => {
    const l = liveLedger({ money: money(), channels, accounts, scope: 'all' })
    expect(l.subsMonthly).toBe(20)
    expect(subscriptionsMonthly(accounts, { 'acc-live-1': 20, 'acc-live-2': 5 })).toBe(25)
    // 3 + 1 published videos (the example channel's 9 do not count): 15 € and 5 € of the 20 €
    const h = l.rows.find((r) => r.channel?.id === 'db-7')!
    expect(h).toMatchObject({ videos: 3, adsense: 100, sponsors: 600, products: 50, others: 30, revenue: 780, credits: 30, pc: 5, estimated: false })
    expect(h.claude).toBeCloseTo(12 + 15, 6)
    expect(h.cost).toBeCloseTo(12 + 15 + 30 + 5, 6)
    expect(h.margin).toBeCloseTo(780 - 62, 6)
    const s = l.rows.find((r) => r.channel?.id === 'db-8')!
    expect(s.claude).toBeCloseTo(8 + 5, 6)
    // « Général » last: only the AI cost nobody owns
    expect(l.rows.map((r) => r.channel?.id ?? 'general')).toEqual(['db-7', 'db-8', 'general'])
    expect(l.rows[2]).toMatchObject({ claude: 3, revenue: 0 })
    expect(l.rows.some((r) => r.channel?.name === 'Exemple')).toBe(false)
    expect(l.total.revenue).toBe(780)
    expect(l.total.cost).toBeCloseTo(12 + 8 + 3 + 20 + 30 + 5, 6)
    expect(l.kpis).toMatchObject({ revenue: 780, videos: 4 })
    expect(l.kpis.costPerVideo).toBeCloseTo(l.total.cost / 4, 6)
    expect(l.showOthers).toBe(true)
    expect(l.anyEstimated).toBe(false)
  })

  it('the weeks are the workspace’s, in euros, and the trend compares the last four with the four before', () => {
    const l = liveLedger({ money: money(), channels, accounts, scope: 'all' })
    expect(l.weeks.revenue).toEqual([10, 10, 10, 10, 20, 20, 20, 20])
    expect(l.weeks.cost).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
    expect(l.kpis.trendRevenue).toBe(100)
  })

  it('a channel scope keeps that channel’s row; with no published video the subscriptions stay on « Général »', () => {
    const one = liveLedger({ money: money(), channels, accounts, scope: 'db-8' })
    expect(one.rows.map((r) => r.channel?.id)).toEqual(['db-8'])
    expect(one.total.revenue).toBe(0)
    const idle = money({ overview: { ...OVERVIEW, rows: [pnl({ channelId: 7, aiCents: 100, costCents: 100 })] } })
    const l = liveLedger({ money: idle, channels, accounts, scope: 'all' })
    expect(l.rows.map((r) => [r.channel?.id ?? 'general', r.claude])).toEqual([
      ['db-7', 1],
      ['general', 20]
    ])
    expect(l.showOthers).toBe(false)
    expect(l.kpis.costPerVideo).toBe(0)
  })

  it('an empty month is an empty ledger, not a made-up one', () => {
    const l = liveLedger({ money: money({ overview: { ...OVERVIEW, rows: [], weekly: [] }, subscriptions: {} }), channels, accounts, scope: 'all' })
    expect(l.rows).toEqual([])
    expect(l.kpis).toMatchObject({ revenue: 0, cost: 0, margin: 0, trendRevenue: 0 })
  })

  it('per video: what it cost; the views are unknown, so no revenue and no return', () => {
    const videos = [{ id: 'vid-5', format: 'short', thumbHue: 12 }] as never
    const all = liveVideoReturns(money(), channels, videos, 'all')
    expect(all.map((r) => r.video.title)).toEqual(['Les Templiers', 'Voynich'])
    expect(all[0]).toMatchObject({ known: false, costCredits: 200, revenue: 0, roi: 0, estimated: false })
    expect(all[0]!.costEuro).toBeCloseTo(0.9 + 2, 6)
    expect(all[0]!.video.format).toBe('short')
    expect(all[1]!.video.format).toBe('long')
    expect(liveVideoReturns(money(), channels, videos, 'db-8').map((r) => r.video.title)).toEqual(['Voynich'])
  })
})

/* ---------- store actions with a fake driver ---------- */

function snap(extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    status: { enabled: false, running: 0, maxConcurrent: 3, tasks: {}, agents: 0, accountsReady: 1, accountsLimited: 0, resumesAt: null, openInbox: 0 },
    channels: [channel(7, 'Histoire')],
    agents: [],
    videos: [],
    pipelines: [],
    inbox: [],
    accounts: [account(1, 'Claude Code')],
    threads: [],
    messages: [],
    ...extra
  }
}

function drivers() {
  let next = 100
  const brain = {
    createIdea: vi.fn(async (input: { channelId: number; title: string; angle?: string }) => idea({ id: next++, channelId: input.channelId, title: input.title, angle: input.angle ?? '' })),
    updateIdea: vi.fn(async (id: number, patch: { title?: string; angle?: string; status?: IdeaRow['status'] }) => idea({ id, title: patch.title ?? 'T', angle: patch.angle ?? '', ...(patch.status ? { status: patch.status } : {}) })),
    deleteIdea: vi.fn(async (_id: number) => undefined),
    generateIdeas: vi.fn(async (channelId: number, count: number) =>
      Array.from({ length: count }, (_, i) => idea({ id: next++, channelId, title: `Idée ${i}`, source: 'agent', score: 70 + i }))
    ),
    ideaToVideo: vi.fn(async (id: number) => idea({ id, title: 'T', status: 'used', videoId: 55 }))
  } satisfies LiveBrainDriver
  const moneyDrv = {
    saveRevenue: vi.fn(async (input: { date: string; channelId: number | null; type: RevenueRow['type']; amountCents: number; note?: string }) =>
      revenue({ id: 40, date: input.date, channelId: input.channelId, type: input.type, amountCents: input.amountCents, note: input.note ?? '' })
    ),
    deleteRevenue: vi.fn(async (_id: number) => undefined),
    setSubscriptions: vi.fn(async (_prices: Record<string, number>) => undefined)
  } satisfies LiveMoneyDriver
  const driver = { brain, money: moneyDrv } as unknown as LiveDriver
  return { brain, money: moneyDrv, driver }
}

function liveStore(extra: Partial<LiveSnapshot> = {}) {
  const store = createProtoStore(initialState({ mode: 'live' }))
  store.set((s) => applySnapshot(s, snap({ ideas: mapIdeas([idea({ id: 1, title: 'Première' }), idea({ id: 2, title: 'Deuxième', status: 'kept' })]), money: money(), ...extra })))
  return { store, act: storeActions(store) }
}

describe('real mode: Cerveau and Monétisation actions', () => {
  afterEach(() => setLiveDriver(null))

  it('a snapshot fills the board and the money; switching back to demo empties them; a snapshot without them keeps the last', () => {
    const { store, act } = liveStore()
    expect(store.get().liveIdeas?.map((i) => i.id)).toEqual(['idea-2', 'idea-1'])
    expect(store.get().liveMoney?.spend.spentUsd).toBe(12.34)
    store.set((s) => applySnapshot(s, snap()))
    expect(store.get().liveIdeas).toHaveLength(2)
    act.setMode('demo')
    expect(store.get()).toMatchObject({ liveIdeas: null, liveMoney: null })
    // demo mode ignores snapshots
    store.set((s) => applySnapshot(s, snap({ money: money() })))
    expect(store.get().liveMoney).toBeNull()
  })

  it('creates an idea in a channel: it reaches the driver and the board', async () => {
    const d = drivers()
    setLiveDriver(d.driver)
    const { store, act } = liveStore()
    await act.createIdea({ channelId: 'db-7', title: '  Le Carnet  ', angle: ' un angle ' })
    expect(d.brain.createIdea).toHaveBeenCalledWith({ channelId: 7, title: 'Le Carnet', angle: 'un angle' })
    expect(store.get().liveIdeas![0]).toMatchObject({ id: 'idea-100', title: 'Le Carnet', channelId: 'db-7', column: 'proposed' })
    await act.createIdea({ channelId: 'ch-enigmes', title: 'Demo', angle: '' }) // a demo channel is no database channel
    expect(d.brain.createIdea).toHaveBeenCalledTimes(1)
  })

  it('edits, validates, launches and deletes; a refused write puts the card back and reports the error', async () => {
    const d = drivers()
    setLiveDriver(d.driver)
    const { store, act } = liveStore()
    const col = (id: string) => store.get().liveIdeas!.find((i) => i.id === id)?.column

    await act.updateIdea('idea-1', { title: 'Nouveau titre', angle: 'Nouvel angle' })
    expect(d.brain.updateIdea).toHaveBeenCalledWith(1, { title: 'Nouveau titre', angle: 'Nouvel angle' })
    expect(store.get().liveIdeas!.find((i) => i.id === 'idea-1')!.title).toBe('Nouveau titre')

    await act.moveIdea('idea-1', 'validated')
    expect(d.brain.updateIdea).toHaveBeenLastCalledWith(1, { status: 'kept' })
    expect(col('idea-1')).toBe('validated')

    await act.moveIdea('idea-1', 'production')
    expect(d.brain.ideaToVideo).toHaveBeenCalledWith(1)
    expect(col('idea-1')).toBe('production')

    await act.deleteIdea('idea-2')
    expect(d.brain.deleteIdea).toHaveBeenCalledWith(2)
    expect(col('idea-2')).toBeUndefined()

    d.brain.deleteIdea.mockRejectedValueOnce(new Error('Base verrouillée'))
    await act.deleteIdea('idea-1')
    expect(col('idea-1')).toBe('production')
    expect(store.get().live.error).toBe('Base verrouillée')

    d.brain.updateIdea.mockRejectedValueOnce(new Error('Refusé'))
    await act.moveIdea('idea-1', 'validated')
    expect(col('idea-1')).toBe('production')
  })

  it('asks the ideas agent for ideas in one channel and adds what comes back; a demo idea is never sent', async () => {
    const d = drivers()
    setLiveDriver(d.driver)
    const { store, act } = liveStore()
    expect(await act.generateIdeas('db-7', 3)).toBe(3)
    expect(d.brain.generateIdeas).toHaveBeenCalledWith(7, 3)
    expect(store.get().liveIdeas).toHaveLength(5)
    expect(store.get().liveIdeas![0]).toMatchObject({ source: 'atlas' })
    expect(store.get().liveIdeas![0]).not.toHaveProperty('unscored')
    d.brain.generateIdeas.mockRejectedValueOnce(new Error('Réponse illisible'))
    expect(await act.generateIdeas('db-7')).toBe(0)
    expect(store.get().live.error).toBe('Réponse illisible')
    await act.updateIdea('id-e1', { title: 'x', angle: '' })
    expect(d.brain.updateIdea).not.toHaveBeenCalled()
  })

  it('does nothing in demo mode', async () => {
    const d = drivers()
    setLiveDriver(d.driver)
    const store = createProtoStore(initialState())
    const act = storeActions(store)
    await act.createIdea({ channelId: 'db-7', title: 'x', angle: '' })
    await act.addRevenue({ type: 'revenue', kind: 'sponsor', label: 'x', channelId: null, amount: 1, daysAgo: 0 })
    expect(d.brain.createIdea).not.toHaveBeenCalled()
    expect(d.money.saveRevenue).not.toHaveBeenCalled()
  })

  it('enters and deletes a revenue through the API, and types a subscription price', async () => {
    const d = drivers()
    setLiveDriver(d.driver)
    const { store, act } = liveStore()
    await act.addRevenue({ type: 'revenue', kind: 'product', label: 'Carnet', channelId: 'db-7', amount: 34, daysAgo: 0 })
    const sent = d.money.saveRevenue.mock.calls[0]![0]
    expect(sent).toMatchObject({ channelId: 7, type: 'product', amountCents: 3400, currency: 'EUR', note: 'Carnet' })
    expect(store.get().liveMoney!.revenues[0]).toMatchObject({ id: 40, amountCents: 3400 })

    await act.deleteRevenue('rev-1')
    expect(d.money.deleteRevenue).toHaveBeenCalledWith(1)
    expect(store.get().liveMoney!.revenues.some((r) => r.id === 1)).toBe(false)
    d.money.deleteRevenue.mockRejectedValueOnce(new Error('Non'))
    await act.deleteRevenue('rev-40')
    expect(store.get().liveMoney!.revenues.some((r) => r.id === 40)).toBe(true)

    await act.setSubscriptionPrice('acc-live-2', 19.9)
    expect(d.money.setSubscriptions).toHaveBeenLastCalledWith({ 'acc-live-1': 20, 'acc-live-2': 19.9 })
    expect(store.get().liveMoney!.subscriptions['acc-live-2']).toBe(19.9)
    await act.setSubscriptionPrice('acc-live-1', null)
    expect(d.money.setSubscriptions).toHaveBeenLastCalledWith({ 'acc-live-2': 19.9 })
    d.money.setSubscriptions.mockRejectedValueOnce(new Error('Non'))
    await act.setSubscriptionPrice('acc-live-2', 5)
    expect(store.get().liveMoney!.subscriptions['acc-live-2']).toBe(19.9)
  })
})

/* ---------- the screens in live mode ---------- */

function render(el: ReactElement, state: Partial<ProtoState>): string {
  const store = createProtoStore(initialState(state))
  return renderToStaticMarkup(createElement(ProtoProvider, { store, children: createElement(TooltipProvider, { children: el }) }))
}
const brain = (initialTab: 'competitors' | 'niches' | 'ideas'): ReactElement => createElement(BrainScreen, { route: { section: 'cerveau' }, onRoute: noop, initialTab })
const moneyScreen = (): ReactElement => createElement(MoneyProtoScreen, { route: { section: 'monetisation' }, onRoute: noop })
const noop = (): void => undefined

function liveState(): Partial<ProtoState> {
  const s = applySnapshot(
    initialState({ mode: 'live' }),
    snap({ agents: initialState().agents, channels: [channel(7, 'Histoire'), channel(8, 'Science')], ideas: mapIdeas([idea({ id: 1, title: 'Le manuscrit réel' }), idea({ id: 2, title: 'Idée de l’agent', source: 'agent', score: 77, status: 'kept' })]), money: money() })
  )
  return s
}

describe('real mode: the screens', () => {
  it('Cerveau › Idées shows the database’s ideas (not the demo board), with edit and delete, and no demo badge', () => {
    const html = render(brain('ideas'), liveState())
    expect(html).toContain('Le manuscrit réel')
    expect(html).toContain('Idée de l’agent')
    expect(html).not.toContain('3 énigmes de l’Antiquité')
    expect(html).toContain('data-testid="idea-add"')
    expect(html).toContain('data-testid="idea-edit"')
    expect(html).toContain('data-testid="idea-delete"')
    expect(html).toContain('Saisie à la main')
    expect(html).not.toContain('data-testid="live-demo-badge"')
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('Cerveau › Concurrents shows the real channels’ competitors (the eyes), Carte des niches keeps demo data under its label', () => {
    // the beta: the competitors come from « the eyes » of the real channels; none of the demo's channels or competitors show
    const comp = render(brain('competitors'), liveState())
    expect(comp).toContain('data-testid="competitors-live"')
    expect(comp).toContain('Histoire')
    expect(comp).not.toContain('data-block="competitors"')
    for (const demo of ['Les Grandes Énigmes', 'Chroniques Obscures', 'Mystery Files']) expect(comp).not.toContain(demo)
    expect(comp).not.toContain('data-testid="outperformer-add"')
    // no real channel yet: the next action, not an invented map
    const none = render(brain('competitors'), { ...liveState(), channels: [] })
    expect(none).toContain('data-testid="competitors-empty"')
    const niches = render(brain('niches'), liveState())
    expect(niches).toContain('data-block="niches"')
    // the demo itself is not labelled (everything is a demo there)
    const demo = render(brain('niches'), {})
    expect(demo).not.toContain('live-demo-badge')
  })

  it('Monétisation shows the real ledger total, this month’s revenue, the typed subscriptions and the revenues entered', () => {
    const html = render(moneyScreen(), { ...liveState(), accounts: [account(1, 'Claude Code')] })
    expect(html).toContain('data-testid="money-ledger-total"')
    expect(html).toContain('data-usd="12.34"')
    expect(html).toContain('Appels au modèle : 17')
    expect(html).toContain('12,34')
    expect(html).toContain('Revenus du mois')
    expect(html).toContain('Autres revenus')
    expect(html).toContain('Histoire')
    expect(html).toContain('NordVPN') // the revenue entered
    expect(html).not.toContain('>Exemple<') // the example revenue is left out
    expect(html).not.toContain('data-testid="money-add-expense"') // no backend for expenses
    expect(html).toContain('data-testid="money-sub-price"')
    // the beta: the credits are the Atelier Cloud account's (offline here: it says so), nothing simulated to buy
    expect(html).not.toContain('data-block="credits"')
    expect(html).toContain('data-testid="money-balance-offline"')
    expect(html).not.toContain('data-testid="money-buy"')
    const signedIn = render(moneyScreen(), { ...liveState(), workspace: { ...liveState().workspace!, cloud: 'signed-in', credits: 4321, plan: 'Creator' } })
    expect(signedIn).toMatch(/data-testid="money-balance">4[\s\u202f\u00a0]321</)
    expect(signedIn).toContain('Creator')
    // the demo's invented sponsors are not there
    expect(html).not.toContain('NordVPN · intégration de 60 secondes')
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('Monétisation in demo mode is unchanged: no live blocks', () => {
    const html = render(moneyScreen(), {})
    expect(html).toContain('data-testid="money-add-expense"')
    expect(html).not.toContain('money-ledger')
    expect(html).not.toContain('live-demo-badge')
  })

  it('Monétisation in live mode before the first snapshot says it is loading, with no figure', () => {
    const html = render(moneyScreen(), { mode: 'live' })
    expect(html).toContain('data-testid="money-loading"')
    expect(html).not.toContain('data-testid="money-kpis"')
  })
})
