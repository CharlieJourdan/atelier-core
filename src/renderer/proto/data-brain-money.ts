// Demo money data of the new Monétisation screen: how many videos each channel made in 28 days, the price of the AI
// subscriptions and of the team computer, the credit packs, the videos with their cost, and the revenue / expense rows
// the user entered by hand. Invented values only.
import type { ChannelId } from './types'

/** What one credit costs when it comes from the plan (Studio: 20 000 credits for 149 € a month). */
export const CREDIT_EUR = 0.0075

/** Videos published in the last 28 days, per channel. */
export const VIDEOS_28D: Record<ChannelId, number> = {
  'ch-enigmes': 12,
  'ch-histoires': 84,
  'ch-top': 8,
  'ch-mystery': 8
}

/** Monthly price of each engine account, in euros (the Atelier relay is paid in credits, not here). */
export const SUB_PRICE: Record<string, number> = {
  'acc-1': 200,
  'acc-2': 20,
  'acc-3': 20,
  'acc-4': 0
}

/** The team computer on Atelier Cloud, euros a month. */
export const COMPUTER_EUR = 59

export interface CreditPack {
  id: string
  credits: number
  euro: number
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pk-5', credits: 5_000, euro: 39 },
  { id: 'pk-20', credits: 20_000, euro: 129 },
  { id: 'pk-50', credits: 50_000, euro: 299 }
]

export interface LedgerVideo {
  id: string
  title: string
  channelId: ChannelId
  format: 'long' | 'short'
  views: number
  credits: number
  daysAgo: number
  thumbHue: number
}

/** The last ten published videos. */
export const LEDGER_VIDEOS: LedgerVideo[] = [
  { id: 'lv-1', title: 'Roswell, 1947 : le dossier complet', channelId: 'ch-enigmes', format: 'long', views: 214_000, credits: 452, daysAgo: 2, thumbHue: 120 },
  {
    id: 'lv-2',
    title: 'J’ai découvert que j’avais un jumeau à 30 ans',
    channelId: 'ch-histoires',
    format: 'short',
    views: 410_000,
    credits: 13,
    daysAgo: 1,
    thumbHue: 190
  },
  {
    id: 'lv-3',
    title: 'Le proprio voulait doubler le loyer',
    channelId: 'ch-histoires',
    format: 'short',
    views: 268_000,
    credits: 14,
    daysAgo: 1,
    thumbHue: 90
  },
  {
    id: 'lv-4',
    title: 'Les 10 plus grandes erreurs de l’Histoire',
    channelId: 'ch-top',
    format: 'long',
    views: 61_000,
    credits: 262,
    daysAgo: 3,
    thumbHue: 40
  },
  { id: 'lv-5', title: 'Roswell 1947: The Complete File', channelId: 'ch-mystery', format: 'long', views: 18_400, credits: 176, daysAgo: 4, thumbHue: 125 },
  {
    id: 'lv-6',
    title: 'Le manuscrit de Voynich : ce qu’on sait vraiment',
    channelId: 'ch-enigmes',
    format: 'long',
    views: 342_000,
    credits: 438,
    daysAgo: 5,
    thumbHue: 48
  },
  {
    id: 'lv-7',
    title: 'Elle a rendu la bague le jour du mariage',
    channelId: 'ch-histoires',
    format: 'short',
    views: 1_320_000,
    credits: 14,
    daysAgo: 3,
    thumbHue: 340
  },
  {
    id: 'lv-8',
    title: '10 villes qui vont disparaître d’ici 2100',
    channelId: 'ch-top',
    format: 'long',
    views: 74_000,
    credits: 258,
    daysAgo: 7,
    thumbHue: 200
  },
  { id: 'lv-9', title: 'La disparition du vol 19', channelId: 'ch-enigmes', format: 'long', views: 188_000, credits: 441, daysAgo: 8, thumbHue: 220 },
  { id: 'lv-10', title: 'Atlantis: What Plato Really Wrote', channelId: 'ch-mystery', format: 'long', views: 12_900, credits: 180, daysAgo: 9, thumbHue: 195 }
]

/** `adsense` and `affiliate` only come from real mode (the database's revenue types). */
export type EntryKind = 'sponsor' | 'collab' | 'product' | 'tool' | 'freelance' | 'hardware' | 'other' | 'adsense' | 'affiliate'

export interface MoneyEntry {
  id: string
  type: 'revenue' | 'expense'
  kind: EntryKind
  label: string
  /** null = not tied to one channel. */
  channelId: ChannelId | null
  amount: number
  daysAgo: number
}

export const REVENUE_KINDS: readonly EntryKind[] = ['sponsor', 'collab', 'product']
export const EXPENSE_KINDS: readonly EntryKind[] = ['freelance', 'tool', 'hardware', 'other']

export const SEED_ENTRIES: MoneyEntry[] = [
  { id: 'en-1', type: 'revenue', kind: 'sponsor', label: 'NordVPN · intégration de 60 secondes', channelId: 'ch-top', amount: 600, daysAgo: 12 },
  { id: 'en-2', type: 'revenue', kind: 'collab', label: 'Échange de placement avec Atlas Perdu', channelId: 'ch-enigmes', amount: 1200, daysAgo: 9 },
  { id: 'en-3', type: 'revenue', kind: 'product', label: 'Le Carnet des Énigmes (ventes du mois)', channelId: 'ch-enigmes', amount: 340, daysAgo: 5 },
  { id: 'en-4', type: 'expense', kind: 'freelance', label: 'Monteuse freelance · 3 vidéos', channelId: null, amount: 450, daysAgo: 14 },
  { id: 'en-5', type: 'expense', kind: 'tool', label: 'Bibliothèque musicale', channelId: null, amount: 15, daysAgo: 3 }
]
