// Example workspace rows of the "money" area (lot Z1): three months of revenues for both example channels, four sponsor
// deals at different stages and two offers. Every row is marked example = 1; `clear` deletes exactly those rows.
import type { Currency, RevenueType, SponsorStage } from '../../shared/money'
import type { Db } from '../db'
import type { ExampleArea, ExampleSeed } from './types'

const DAY = 86_400_000

const isoDay = (daysAgo: number, now: number): string => new Date(now - daysAgo * DAY).toISOString().slice(0, 10)

/**
 * [days ago, type, amount in cents, note] for each example channel: about three months, never in the future. Each
 * channel has a row dated today, so the current month is never empty (on the 1st of a month « 2 days ago » is last month).
 */
const REVENUES: Record<'documentary' | 'top10', readonly (readonly [number, RevenueType, number, string])[]> = {
  documentary: [
    [0, 'affiliate', 1290, 'Affiliation livres (exemple)'],
    [2, 'adsense', 18420, 'Relevé AdSense (exemple)'],
    [9, 'sponsor', 90000, 'Sponsor : Lumière & Cie (exemple)'],
    [17, 'affiliate', 4310, 'Affiliation livres (exemple)'],
    [31, 'adsense', 24150, 'Relevé AdSense (exemple)'],
    [38, 'product', 5960, 'Ventes du guide (exemple)'],
    [49, 'adsense', 19780, 'Relevé AdSense (exemple)'],
    [58, 'sponsor', 60000, 'Sponsor : Atlas Voyages (exemple)'],
    [66, 'product', 3280, 'Ventes du guide (exemple)'],
    [79, 'adsense', 16240, 'Relevé AdSense (exemple)']
  ],
  top10: [
    [0, 'affiliate', 640, 'Affiliation matériel (exemple)'],
    [4, 'adsense', 9640, 'Relevé AdSense (exemple)'],
    [14, 'affiliate', 2150, 'Affiliation matériel (exemple)'],
    [33, 'adsense', 11890, 'Relevé AdSense (exemple)'],
    [45, 'other', 2500, 'Don en direct (exemple)'],
    [62, 'adsense', 8310, 'Relevé AdSense (exemple)'],
    [77, 'affiliate', 1740, 'Affiliation matériel (exemple)']
  ]
}

interface DealSeed {
  brand: string
  contact: string
  cents: number
  currency: Currency
  stage: SponsorStage
  terms: string
  phrases: string
  placement: string
  /** Days from now until the due date. */
  dueIn: number | null
  channel: 'documentary' | 'top10'
  video?: 'atlantide' | 'templiers' | 'bermudes' | 'animaux'
}

const DEALS: readonly DealSeed[] = [
  { brand: 'Cartes du Monde (exemple)', contact: 'partenariats@cartes-exemple.fr', cents: 80000, currency: 'EUR', stage: 'prospect', terms: 'Une mention de 45 secondes, lien en description.', phrases: '', placement: 'Milieu de vidéo', dueIn: null, channel: 'documentary' },
  { brand: 'Lumière & Cie (exemple)', contact: 'Camille Roy', cents: 120000, currency: 'EUR', stage: 'negotiation', terms: 'Intégration de 60 secondes, droits d’usage 12 mois.', phrases: 'Découvrez la collection sur lumiere-exemple.fr', placement: 'Après l’introduction', dueIn: 21, channel: 'documentary', video: 'atlantide' },
  { brand: 'Atlas Voyages (exemple)', contact: 'Hugo Laurent', cents: 60000, currency: 'EUR', stage: 'to_deliver', terms: 'Une mention, deux liens, validation du script par la marque.', phrases: 'Réservez avec le code ATELIER', placement: 'Fin de vidéo', dueIn: 9, channel: 'documentary', video: 'templiers' },
  { brand: 'Gear Pro (exemple)', contact: 'sales@gearpro-exemple.com', cents: 45000, currency: 'USD', stage: 'paid', terms: 'Mention de 30 secondes.', phrases: '', placement: 'Début de vidéo', dueIn: null, channel: 'top10', video: 'animaux' }
]

export const moneyExample: ExampleArea = {
  name: 'money',
  seed: (db: Db, seed: ExampleSeed) => {
    const now = Date.now()
    const insertRevenue = db.prepare(
      "INSERT INTO revenues (date, channel_id, type, amount_cents, currency, source, note, example) VALUES (?,?,?,?, 'EUR', 'example', ?, 1)"
    )
    for (const key of ['documentary', 'top10'] as const) {
      for (const [ago, type, cents, note] of REVENUES[key]) insertRevenue.run(isoDay(ago, now), seed.channels[key], type, cents, note)
    }
    const insertDeal = db.prepare(
      `INSERT INTO sponsor_deals (brand, contact, amount_cents, currency, terms, required_phrases, placement, due_date, video_id, channel_id, stage, example)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`
    )
    for (const d of DEALS) {
      insertDeal.run(
        d.brand,
        d.contact,
        d.cents,
        d.currency,
        d.terms,
        d.phrases,
        d.placement,
        d.dueIn === null ? null : isoDay(-d.dueIn, now),
        d.video ? seed.videos[d.video] : null,
        seed.channels[d.channel],
        d.stage
      )
    }
    const insertOffer = db.prepare('INSERT INTO offers (channel_id, name, kind, price_cents, status, example) VALUES (?,?,?,?,?,1)')
    insertOffer.run(seed.channels.documentary, '50 énigmes de l’Histoire (guide PDF)', 'ebook', 1490, 'ready')
    insertOffer.run(seed.channels.documentary, 'Mini-cours : raconter un documentaire sans visage', 'course', 4900, 'idea')
  },
  clear: (db: Db) => {
    for (const table of ['revenues', 'sponsor_deals', 'offers']) db.prepare(`DELETE FROM ${table} WHERE example = 1`).run()
  }
}
