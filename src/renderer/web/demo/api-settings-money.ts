// Demo handlers: Monétisation › Avancé (revenues, sponsors, offers and the P&L per channel). The P&L is computed by the
// same pure functions as the desktop (src/shared/money.ts) over invented revenues and costs. Sponsor drafts and offer
// packs are canned texts: no model is called, nothing is ever sent to a brand.
import type { MoneyOverview } from '../../../shared/api'
import {
  computePnl,
  lastMonths,
  lastWeeks,
  parseRevenueCsv,
  totalsFor,
  type OfferPack,
  type OfferRow,
  type RevenueRow,
  type SponsorDealRow
} from '../../../shared/money'
import { changed, wait, type DemoHandlers } from './bridge'
import { S } from './api-settings-state'
import { nextId } from './world'

const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const nameOf = (id: number | null): string | null => (id === null ? null : (S.channels.find((c) => c.id === id)?.name ?? null))

const rev = (daysAgo: number, channelId: number, type: RevenueRow['type'], euros: number, note: string): RevenueRow => ({
  id: nextId(),
  date: day(daysAgo),
  channelId,
  channelName: nameOf(channelId),
  videoId: null,
  type,
  amountCents: Math.round(euros * 100),
  currency: 'EUR',
  source: 'manual',
  note,
  example: false
})

let revenues: RevenueRow[] = [0, 30, 60, 90, 120, 150].flatMap((d, i) => [
  rev(d + 3, 1, 'adsense', 1_900 + i * 140, 'AdSense (montant inventé)'),
  rev(d + 4, 2, 'adsense', 380 + i * 60, 'AdSense (montant inventé)'),
  rev(d + 6, 3, 'adsense', 520 + i * 40, 'AdSense (montant inventé)'),
  ...(i % 2 === 0 ? [rev(d + 10, 1, 'sponsor', 1_200, 'Partenariat fictif')] : []),
  ...(i < 3 ? [rev(d + 12, 1, 'product', 240 + i * 30, 'Ventes de l’e-book (démo)')] : [])
])

let sponsors: SponsorDealRow[] = [
  ['Lampes Lumen (fictif)', 'negotiation', 1, 1_500],
  ['Carnets Papeterie Nova (fictif)', 'signed', 1, 900],
  ['Appli Recettes Express (fictif)', 'prospect', 3, 600],
  ['Jeu Mobile Pixel (fictif)', 'paid', 2, 450]
].map(([brand, stage, channelId, euros]) => ({
  id: nextId(),
  brand: brand as string,
  contact: 'partenariats@example.com',
  amountCents: (euros as number) * 100,
  currency: 'EUR',
  terms: 'Une mention de 60 s en début de vidéo.',
  requiredPhrases: '',
  link: 'https://example.com/partenaire',
  placement: 'Début de vidéo',
  dueDate: day(-14),
  videoId: null,
  channelId: channelId as number,
  channelName: nameOf(channelId as number),
  stage: stage as SponsorDealRow['stage'],
  draftMessage: '',
  example: false
}))

const PACK: OfferPack = {
  ideas: [
    { title: 'Le carnet d’enquête', pitch: 'Les dossiers des vidéos, avec les sources et les cartes.' },
    { title: 'Le mini-cours', pitch: 'Cinq leçons pour raconter une énigme historique.' },
    { title: 'L’abonnement', pitch: 'Un dossier inédit chaque mois.' }
  ],
  names: ['Dossiers Secrets', 'Le Carnet Noir', 'Archives Ouvertes', 'Pistes', 'L’Enquête du Mois'],
  prices: [
    { label: 'Lancement', amountEur: 9 },
    { label: 'Prix normal', amountEur: 14 },
    { label: 'Édition complète', amountEur: 29 }
  ],
  funnel: [
    { step: 'Vidéo', detail: 'Une mention en fin de vidéo et en description.' },
    { step: 'Page', detail: 'Une page simple avec trois extraits.' },
    { step: 'Relance', detail: 'Un e-mail une semaine après.' }
  ]
}

let offers: OfferRow[] = [
  { id: nextId(), channelId: 1, channelName: nameOf(1), name: 'Le Carnet des Énigmes (e-book)', kind: 'ebook', priceCents: 1_400, status: 'live', pack: PACK, example: false },
  { id: nextId(), channelId: 3, channelName: nameOf(3), name: 'Recettes de la semaine (idée)', kind: 'course', priceCents: 2_900, status: 'idea', pack: null, example: false }
]

/** Monthly AI and engine costs per channel (invented, small). */
const COST_USD = [22, 8, 12, 2]
const CREDITS = [2_400, 900, 1_300, 150]

function overview(): MoneyOverview {
  const now = new Date()
  const months = lastMonths(now, 6)
  const channels = S.channels.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, example: false }))
  const perMonth = <T>(f: (channelId: number, i: number, month: string) => T): T[] => channels.flatMap((c, i) => months.map((m) => f(c.id, i, m)))
  const rows = computePnl({
    months,
    channels,
    revenues,
    aiUsd: perMonth((channelId, i, month) => ({ channelId, month, usd: COST_USD[i] ?? 1 })),
    credits: perMonth((channelId, i, month) => ({ channelId, month, credits: CREDITS[i] ?? 100 })),
    published: perMonth((channelId, i, month) => ({ channelId, month, count: [12, 60, 8, 2][i] ?? 1 })),
    views: null,
    usdToEur: S.usdToEur
  })
  const current = months[months.length - 1]!
  const weekly = lastWeeks(now, 8).map((week, i) => ({ week, revenueCents: 70_000 + ((i * 37) % 9) * 6_000, costCents: 9_000 + (i % 3) * 1_500 }))
  return { month: current, months, channels, rows, totals: totalsFor(rows, current), weekly, usdToEur: S.usdToEur, viewsKnown: false }
}

const csvChannels = () => S.channels.map((c) => ({ id: c.id, name: c.name }))

export const moneySettingsHandlers: DemoHandlers = {
  'money.overview': () => overview(),
  'money.setRate': (rate) => {
    S.usdToEur = rate
    changed('money')
  },
  'money.revenues.list': (filter) =>
    revenues
      .filter((r) => filter?.channelId == null || r.channelId === filter.channelId)
      .filter((r) => !filter?.month || r.date.startsWith(filter.month))
      .sort((a, b) => b.date.localeCompare(a.date)),
  'money.revenues.save': (input) => {
    const row: RevenueRow = { ...input, id: input.id ?? nextId(), channelName: nameOf(input.channelId), videoId: input.videoId ?? null, note: input.note ?? '', source: 'manual', example: false }
    revenues = [row, ...revenues.filter((r) => r.id !== row.id)]
    changed('money')
    return row
  },
  'money.revenues.delete': (id) => {
    revenues = revenues.filter((r) => r.id !== id)
    changed('money')
  },
  'money.revenues.previewCsv': (text) => {
    const lines = parseRevenueCsv(text, csvChannels())
    return { lines, valid: lines.filter((l) => l.ok).length, invalid: lines.filter((l) => !l.ok).length }
  },
  'money.revenues.importCsv': (text) => {
    const lines = parseRevenueCsv(text, csvChannels())
    for (const l of lines) {
      if (!l.ok || !l.value) continue
      revenues = [{ ...l.value, id: nextId(), channelName: nameOf(l.value.channelId), videoId: null, source: 'csv', example: false }, ...revenues]
    }
    changed('money')
    const imported = lines.filter((l) => l.ok).length
    return { imported, skipped: lines.length - imported }
  },

  'money.sponsors.list': () => sponsors,
  'money.sponsors.save': (input) => {
    const old = sponsors.find((s) => s.id === input.id)
    const row: SponsorDealRow = {
      id: input.id ?? nextId(),
      brand: input.brand,
      contact: input.contact ?? old?.contact ?? '',
      amountCents: input.amountCents ?? old?.amountCents ?? 0,
      currency: input.currency ?? old?.currency ?? 'EUR',
      terms: input.terms ?? old?.terms ?? '',
      requiredPhrases: input.requiredPhrases ?? old?.requiredPhrases ?? '',
      link: input.link ?? old?.link ?? '',
      placement: input.placement ?? old?.placement ?? '',
      dueDate: input.dueDate ?? old?.dueDate ?? null,
      videoId: input.videoId ?? old?.videoId ?? null,
      channelId: input.channelId ?? old?.channelId ?? null,
      channelName: nameOf(input.channelId ?? old?.channelId ?? null),
      stage: input.stage ?? old?.stage ?? 'prospect',
      draftMessage: old?.draftMessage ?? '',
      example: false
    }
    sponsors = old ? sponsors.map((s) => (s.id === row.id ? row : s)) : [...sponsors, row]
    changed('money')
    return row
  },
  'money.sponsors.move': (id, stage) => {
    sponsors = sponsors.map((s) => (s.id === id ? { ...s, stage } : s))
    changed('money')
    return sponsors.find((s) => s.id === id)!
  },
  'money.sponsors.delete': (id) => {
    sponsors = sponsors.filter((s) => s.id !== id)
    changed('money')
  },
  'money.sponsors.draft': async (id) => {
    await wait(800)
    sponsors = sponsors.map((s) =>
      s.id === id
        ? {
            ...s,
            draftMessage: `Bonjour,\n\nMerci pour votre intérêt pour ${s.channelName ?? 'notre chaîne'}. Nous vous proposons ${s.placement.toLowerCase() || 'une mention'} pour ${(s.amountCents / 100).toLocaleString('fr-FR')} €.\n\nBrouillon de démonstration : rien n’est envoyé.`
          }
        : s
    )
    changed('money')
    return sponsors.find((s) => s.id === id)!
  },

  'money.offers.list': () => offers,
  'money.offers.save': (input) => {
    const old = offers.find((o) => o.id === input.id)
    const channelId = input.channelId ?? old?.channelId ?? null
    const row: OfferRow = {
      id: input.id ?? nextId(),
      channelId,
      channelName: nameOf(channelId),
      name: input.name,
      kind: input.kind ?? old?.kind ?? 'other',
      priceCents: input.priceCents ?? old?.priceCents ?? 0,
      status: input.status ?? old?.status ?? 'idea',
      pack: old?.pack ?? null,
      example: false
    }
    offers = old ? offers.map((o) => (o.id === row.id ? row : o)) : [...offers, row]
    changed('money')
    return row
  },
  'money.offers.delete': (id) => {
    offers = offers.filter((o) => o.id !== id)
    changed('money')
  },
  'money.offers.pack': async (id) => {
    await wait(900)
    offers = offers.map((o) => (o.id === id ? { ...o, pack: PACK } : o))
    changed('money')
    return offers.find((o) => o.id === id)!
  }
}
