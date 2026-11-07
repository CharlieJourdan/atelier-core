// Real mode with Google: the YouTube figures matched to the channels (by the YouTube id or @handle typed in each), the
// channel cards « connectées » with the real numbers, the AdSense line of Monétisation taken from YouTube's estimated
// revenue (never added to a typed one), the « Connecte Google » call to action without Google, and the Réglages block.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GoogleChannelStat, GoogleChannelStats, GoogleStatus } from '../../src/shared/api/google'
import type { MoneyOverview } from '../../src/shared/api/money'
import type { SpendOverview } from '../../src/shared/api/spend'
import { emptyByType, type PnlRow } from '../../src/shared/money'
import type { ChannelRow } from '../../src/shared/workflow'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { CHANNELS } from '../../src/renderer/proto/data-core'
import { mapGoogle, withGoogle, type LiveGoogle } from '../../src/renderer/proto/live/mapping-google'
import type { LiveMoney } from '../../src/renderer/proto/live/mapping-money'
import { applySnapshot, createProtoStore, initialState, ProtoProvider, type ProtoState } from '../../src/renderer/proto/store'
import type { ProtoChannel } from '../../src/renderer/proto/types'
import { ChannelsScreen } from '../../src/renderer/screens/channels/ChannelsScreen'
import { GoogleMoneyBlock } from '../../src/renderer/screens/money/proto/GoogleMoneyBlock'
import { liveLedger } from '../../src/renderer/screens/money/proto/money-live'
import { MoneyProtoScreen } from '../../src/renderer/screens/money/proto/MoneyProtoScreen'
import { GoogleBody, type GoogleBodyProps } from '../../src/renderer/screens/settings/prefs/GoogleBlock'

const noop = (): void => undefined
const BAD = ['undefined', 'NaN', '[object Object]']

function stat(p: Partial<GoogleChannelStat> & Pick<GoogleChannelStat, 'youtubeChannelId'>): GoogleChannelStat {
  return {
    title: 'Chaîne',
    handle: null,
    atelierChannelId: null,
    subscribers: 12_400,
    views28d: 42_000,
    watchMinutes28d: 90_000,
    subscribersNet28d: 120,
    revenue28dEur: 56,
    viewsPrev28d: 28_000,
    trendPct: 50,
    month: '2026-10',
    monthViews: 37_500,
    monthWatchMinutes: 81_000,
    monthRevenueEur: 50,
    fetchedAt: '2026-10-25T12:00:00.000Z',
    ...p
  }
}

const STATS: GoogleChannelStats = {
  connected: true,
  needsReconnect: false,
  lastRefreshAt: '2026-10-25T12:00:00.000Z',
  channels: [
    stat({ youtubeChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Histoires vraies', handle: '@histoiresvraies' }),
    stat({ youtubeChannelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', title: 'Mystères', handle: '@mysteres', monthRevenueEur: null, revenue28dEur: null, subscribers: null }),
    stat({ youtubeChannelId: 'UCcccccccccccccccccccccc', title: 'Pas à moi dans Atelier', monthViews: 10 })
  ]
}

const rows: Pick<ChannelRow, 'id' | 'youtubeChannelId'>[] = [
  { id: 7, youtubeChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' },
  { id: 8, youtubeChannelId: 'https://www.youtube.com/@Mysteres' },
  { id: 9, youtubeChannelId: null }
]

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
    publishedVideos: 1,
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
    { id: 8, name: 'Science', example: false }
  ],
  rows: [
    // 100 € of AdSense typed by hand on Histoire, 30 € on Science, plus a sponsor
    pnl({ channelId: 7, revenueByType: { ...emptyByType(), adsense: 10_000, sponsor: 20_000 }, revenueCents: 30_000 }),
    pnl({ channelId: 8, revenueByType: { ...emptyByType(), adsense: 3_000 }, revenueCents: 3_000 })
  ],
  totals: { revenueCents: 33_000, costCents: 0, marginCents: 33_000, views: null, rpmCents: null, example: null },
  weekly: [],
  usdToEur: 0.9,
  viewsKnown: false
}
const SPEND: SpendOverview = { month: '2026-10', spentUsd: 0, reservedUsd: 0, calls: 0, globalCapUsd: 50, channels: [] }
const money = (google?: LiveGoogle): LiveMoney => ({ overview: OVERVIEW, spend: SPEND, videoCosts: [], revenues: [], subscriptions: {}, ...(google ? { google } : {}) })

describe('the Google figures matched to the channels', () => {
  it('each YouTube channel feeds the Atelier channel with its id or its @handle; the others stay unlinked', () => {
    const g = mapGoogle(STATS, rows)
    expect(g.rows.map((r) => [r.stat.youtubeChannelId, r.channelId])).toEqual([
      ['UCaaaaaaaaaaaaaaaaaaaaaa', 7],
      ['UCbbbbbbbbbbbbbbbbbbbbbb', 8],
      ['UCcccccccccccccccccccccc', null]
    ])
  })

  it('the cards of the linked channels become « connectées » with the real figures; the others do not change', () => {
    const cards = withGoogle([channel(7, 'Histoire'), channel(8, 'Science'), channel(9, 'Seule')], mapGoogle(STATS, rows))
    expect(cards[0]).toMatchObject({ connected: true, subscribers: 12_400, views28d: 42_000, revenue28d: 56, trend: 50, handle: '@histoiresvraies' })
    expect(cards[1]).toMatchObject({ connected: true, subscribers: 0, revenue28d: 0 })
    expect(cards[2]).toMatchObject({ connected: false, subscribers: 0, views28d: 0 })
    // without Google nothing changes
    const before = [channel(7, 'Histoire')]
    expect(withGoogle(before, undefined)).toBe(before)
  })
})

describe('Monétisation with Google', () => {
  const channels = [channel(7, 'Histoire'), channel(8, 'Science')]

  it('the AdSense line of a linked channel is YouTube’s estimated revenue of the month, replacing the typed one', () => {
    const g = mapGoogle(STATS, rows)
    const l = liveLedger({ money: money(g), channels, accounts: [], scope: 'all' })
    const h = l.rows.find((r) => r.channel?.id === 'db-7')!
    expect(h).toMatchObject({ adsense: 50, sponsors: 200, revenue: 250 })
    // Google gives no revenue for Science (not monetised): the typed 30 € stays
    expect(l.rows.find((r) => r.channel?.id === 'db-8')).toMatchObject({ adsense: 30 })
    expect(l.total.adsense).toBe(80)
    // another month's figures are never used for this month
    const old = mapGoogle({ ...STATS, channels: STATS.channels.map((c) => ({ ...c, month: '2026-09' })) }, rows)
    expect(liveLedger({ money: money(old), channels, accounts: [], scope: 'all' }).total.adsense).toBe(130)
  })

  it('without Google the ledger is the typed one', () => {
    expect(liveLedger({ money: money(), channels, accounts: [], scope: 'all' }).total.adsense).toBe(130)
  })

  it('the block lists this month’s views, hours, subscribers and revenue per channel, scoped like the screen', () => {
    const html = renderToStaticMarkup(createElement(GoogleMoneyBlock, { google: mapGoogle(STATS, rows), channels, scope: 'all', onRoute: noop }))
    expect(html).toContain('data-testid="money-google"')
    expect(html).toContain('YouTube ce mois-ci')
    expect(html).toContain('Histoire')
    expect(html).toContain('Science')
    expect(html).toContain('Pas à moi dans Atelier')
    expect(html).toContain('non reliée')
    expect(html).toMatch(/>1\s350</) // 81 000 minutes = 1 350 hours
    expect(html).toContain('50 €')
    expect((html.match(/data-testid="money-google-row"/g) ?? []).length).toBe(3)
    const one = renderToStaticMarkup(createElement(GoogleMoneyBlock, { google: mapGoogle(STATS, rows), channels, scope: 'db-8', onRoute: noop }))
    expect((one.match(/data-testid="money-google-row"/g) ?? []).length).toBe(1)
    for (const bad of BAD) expect(html).not.toContain(bad)
  })

  it('without Google: « Connecte Google », which opens Réglages › Chaînes; a revoked token asks to reconnect', () => {
    const cta = renderToStaticMarkup(createElement(GoogleMoneyBlock, { google: undefined, channels, scope: 'all', onRoute: noop }))
    expect(cta).toContain('data-testid="google-cta"')
    expect(cta).toContain('Connecte Google')
    const notYet = renderToStaticMarkup(createElement(GoogleMoneyBlock, { google: { connected: false, needsReconnect: false, lastRefreshAt: null, rows: [] }, channels, scope: 'all', onRoute: noop }))
    expect(notYet).toContain('data-testid="google-cta"')
    const revoked = renderToStaticMarkup(createElement(GoogleMoneyBlock, { google: { ...mapGoogle(STATS, rows), connected: false, needsReconnect: true }, channels, scope: 'all', onRoute: noop }))
    expect(revoked).toContain('data-testid="money-google-reconnect"')
    expect(revoked).toContain('Reconnecter Google')
  })
})

/* ---------- the screens in real mode ---------- */

function render(el: ReactElement, state: Partial<ProtoState>): string {
  const store = createProtoStore(initialState(state))
  return renderToStaticMarkup(createElement(ProtoProvider, { store, children: createElement(TooltipProvider, { children: el }) }))
}

function live(google?: LiveGoogle): Partial<ProtoState> {
  const channels = withGoogle([channel(7, 'Histoire'), channel(8, 'Science')], google)
  return applySnapshot(initialState({ mode: 'live' }), {
    status: { enabled: false, running: 0, maxConcurrent: 3, tasks: {}, agents: 0, accountsReady: 1, accountsLimited: 0, resumesAt: null, openInbox: 0 },
    channels,
    agents: initialState().agents,
    videos: [],
    pipelines: [],
    inbox: [],
    accounts: [],
    threads: [],
    messages: [],
    money: money(google)
  })
}

describe('real mode screens', () => {
  it('Chaînes without Google: the cards say « non connectées » and the page offers « Connecte Google »', () => {
    const html = render(createElement(ChannelsScreen, { route: { section: 'chaines' }, onRoute: noop }), live())
    expect(html).toContain('data-testid="google-cta"')
    expect(html).toContain('data-testid="channel-not-connected"')
    for (const bad of BAD) expect(html).not.toContain(bad)
  })

  it('Chaînes with Google: the linked channels show their real figures', () => {
    const html = render(createElement(ChannelsScreen, { route: { section: 'chaines' }, onRoute: noop }), live(mapGoogle(STATS, rows)))
    expect(html).not.toContain('data-testid="google-cta"')
    expect(html).toContain('data-testid="channel-figures"')
    expect(html).toContain('12,4 k')
    expect(html).toContain('42 k')
  })

  it('Monétisation in real mode shows the Google block (or its call to action); the demo shows neither', () => {
    const on = render(createElement(MoneyProtoScreen, { route: { section: 'monetisation' }, onRoute: noop }), live(mapGoogle(STATS, rows)))
    expect(on).toContain('data-testid="money-google"')
    const off = render(createElement(MoneyProtoScreen, { route: { section: 'monetisation' }, onRoute: noop }), live())
    expect(off).toContain('data-testid="google-cta"')
    const demo = render(createElement(MoneyProtoScreen, { route: { section: 'monetisation' }, onRoute: noop }), {})
    expect(demo).not.toContain('money-google')
    expect(demo).not.toContain('google-cta')
  })
})

/* ---------- Réglages › Chaînes › Google ---------- */

function status(p: Partial<GoogleStatus> = {}): GoogleStatus {
  return {
    clientIdSet: false,
    clientId: null,
    clientSecretSet: false,
    clientSource: null,
    connected: false,
    needsReconnect: false,
    connecting: false,
    scopes: [],
    lastRefreshAt: null,
    lastError: null,
    channels: [],
    ...p
  }
}

const body = (s: GoogleStatus, extra: Partial<GoogleBodyProps> = {}): string =>
  renderToStaticMarkup(
    createElement(GoogleBody, {
      status: s,
      channels: [
        { id: 7, name: 'Histoire', archived: false },
        { id: 8, name: 'Archivée', archived: true }
      ],
      busy: null,
      onSaveClient: noop,
      onClearClient: noop,
      onConnect: noop,
      onDisconnect: noop,
      onRefresh: noop,
      onLink: noop,
      ...extra
    })
  )

describe('Réglages › Chaînes › Google', () => {
  it('without a client: the fields to paste it, the connect button disabled, read-only said plainly', () => {
    const html = body(status())
    expect(html).toContain('data-state="off"')
    expect(html).toContain('data-testid="google-client-id"')
    expect(html).toContain('type="password"')
    expect(html).toContain('Aucun client OAuth')
    expect(html).toContain('lecture seule')
    expect(html).toMatch(/data-testid="google-connect"[^>]*disabled|disabled[^>]*data-testid="google-connect"/)
    for (const bad of BAD) expect(html).not.toContain(bad)
  })

  it('with a client from the environment: « set » for the secret, never its value; connect enabled', () => {
    const html = body(status({ clientIdSet: true, clientId: 'abc.apps.googleusercontent.com', clientSecretSet: true, clientSource: 'env' }))
    expect(html).toContain('ATELIER_GOOGLE_CLIENT_ID')
    expect(html).toContain('data-set="true"')
    expect(html).toContain('Secret enregistré (chiffré)')
    expect(html).not.toMatch(/data-testid="google-connect"[^>]*disabled/)
    expect(html).not.toContain('google-client-clear') // nothing pasted to forget
  })

  it('connected: refresh, disconnect, the last read, and each channel with what it feeds or « Relier à »', () => {
    const html = body(
      status({
        clientIdSet: true,
        clientId: 'abc.apps.googleusercontent.com',
        clientSource: 'settings',
        connected: true,
        lastRefreshAt: '2026-10-25T12:00:00.000Z',
        channels: [
          { youtubeChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Histoires vraies', handle: '@histoiresvraies', atelierChannelId: 7, atelierChannelName: 'Histoire', revenueAvailable: true },
          { youtubeChannelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', title: 'Mystères', handle: null, atelierChannelId: null, atelierChannelName: null, revenueAvailable: false }
        ]
      })
    )
    expect(html).toContain('data-state="connected"')
    expect(html).toContain('data-testid="google-refresh"')
    expect(html).toContain('data-testid="google-disconnect"')
    expect(html).toContain('data-testid="google-client-clear"')
    expect(html).toContain('Alimente « Histoire »')
    expect(html).toContain('pas de revenus')
    expect((html.match(/data-testid="google-link"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('>Archivée<') // archived channels are not offered
    expect(html).toContain('une fois par jour')
  })

  it('a revoked token: « À reconnecter », the reason, and the reconnect button', () => {
    const html = body(status({ clientIdSet: true, clientId: 'abc.apps.googleusercontent.com', needsReconnect: true, lastError: { code: 'reconnect', message: 'Google ne reconnaît plus l’autorisation' } }))
    expect(html).toContain('data-state="reconnect"')
    expect(html).toContain('Reconnecter Google')
    expect(html).toContain('data-code="reconnect"')
  })
})
