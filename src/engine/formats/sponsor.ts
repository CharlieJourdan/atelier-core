// The channel's sponsor (docs/specs/pipeline-avatar.md §2.13): the product, and the placement rule that says where and how
// long the script speaks of it. The default rule (until the channel's references are measured) is the one of §2.13: one
// mention right after the hook (70 to 150 s in), 20 to 30 s long, and one reminder of at most 15 s before the closing; no
// spoken price. The rule stays a channel setting.
// promo-motion: the same asset can be the channel's OWN promo (`type : promo`): its card made by our motion bricks (formats/promo.ts) or
// a clip the owner made, how it is reused from one video to the next, and where it goes (after the hook, at the end, on the passage
// that already speaks of the offer, or nowhere).
import { z } from 'zod'
import { PROMO_MODES, PROMO_PLACES, PROMO_REFERENCE_AT_S, PromoCard, type PromoMode, type PromoPlace } from './promo'

export const SponsorRule = z.object({
  /** Where the first mention goes: right after the hook, in the middle, or before the closing. */
  where: z.enum(['after_hook', 'middle', 'before_end']).default('after_hook'),
  /** Earliest and latest start of the first mention after the hook (seconds of narration). */
  windowS: z.tuple([z.number().min(0).max(1800), z.number().min(0).max(1800)]).default([70, 150]),
  /** Length of the first mention (seconds of narration). */
  seconds: z.number().min(5).max(120).default(25),
  /** A short reminder before the closing. */
  reminder: z.boolean().default(true),
  reminderSeconds: z.number().min(3).max(30).default(12),
  /** A price is spoken only when the channel's references say it aloud (research §1). */
  spokenPrice: z.boolean().default(false)
})
export type SponsorRule = z.infer<typeof SponsorRule>

/** Where the QR code sits on screen during the slot (production-9). */
export const QR_POSITIONS = ['bottom-right', 'top-right', 'bottom-left', 'top-left', 'center-right'] as const

export const SponsorQr = z.object({
  /** Shown when there is a link to point at. */
  show: z.boolean().default(true),
  /** What the code opens; empty: the sponsor's link. */
  link: z.string().trim().max(500).default(''),
  position: z.enum(QR_POSITIONS).default('bottom-right'),
  /** Its side, as a share of the frame's height (0.28 of 1080 = about 300 px). */
  size: z.number().min(0.12).max(0.5).default(0.28)
})
export type SponsorQr = z.infer<typeof SponsorQr>

export const Sponsor = z.object({
  name: z.string().trim().min(1).max(120),
  pitch: z.string().trim().max(400).default(''),
  link: z.string().trim().max(500).default(''),
  /** A price the mention may say only when the rule allows it. */
  price: z.string().trim().max(60).default(''),
  rule: SponsorRule.prefault({}),
  /** The sponsor's own media: a clip (≤ 90 s) or a picture, a file on the machine that renders (production-9). */
  media: z.string().trim().max(1000).default(''),
  /** What the slot shows: our card (product, pitch, link), the sponsor's media (the card when there is none), or the promo drawn by our motion bricks. */
  screen: z.enum(['card', 'media', 'motion']).default('card'),
  qr: SponsorQr.prefault({}),
  /** A sponsor's product, or the channel's own promo (its site, its offer). */
  kind: z.enum(['sponsor', 'promo']).default('sponsor'),
  /** The promo's card (`kind: promo`, screen `motion`). */
  promo: PromoCard.optional(),
  /** How the promo goes from one video to the next; absent: not set yet (the pipeline agent asks). */
  reuse: z.enum(PROMO_MODES).optional(),
  /** Where the promo goes; absent: not set yet (the pipeline agent asks; meanwhile after the hook, as the reference). */
  place: z.enum(PROMO_PLACES).optional(),
  /** Seconds of narration the promo aims at when it goes after the hook (the reference: 1:25). */
  atS: z.number().min(0).max(1800).optional()
})
export type Sponsor = z.infer<typeof Sponsor>

type CardKey = 'headline' | 'subline' | 'site' | 'image' | 'visualKind' | 'logo' | 'qrCaption' | 'linkLine' | 'siteColor' | 'bgColor' | 'glowColor' | 'side' | 'clipSeconds' | 'linkAtS'
const KEYS: Record<string, keyof Sponsor | 'where' | 'reminder' | 'seconds' | 'spokenPrice' | 'qrPosition' | 'qrSize' | 'qrLink' | CardKey> = {
  nom: 'name',
  name: 'name',
  produit: 'name',
  product: 'name',
  pitch: 'pitch',
  accroche: 'pitch',
  lien: 'link',
  link: 'link',
  url: 'link',
  prix: 'price',
  price: 'price',
  placement: 'where',
  where: 'where',
  rappel: 'reminder',
  reminder: 'reminder',
  durée: 'seconds',
  duree: 'seconds',
  seconds: 'seconds',
  'prix dit': 'spokenPrice',
  spokenprice: 'spokenPrice',
  média: 'media',
  media: 'media',
  vidéo: 'media',
  video: 'media',
  écran: 'screen',
  ecran: 'screen',
  screen: 'screen',
  qr: 'qr',
  'qr position': 'qrPosition',
  'position du qr': 'qrPosition',
  'qr taille': 'qrSize',
  'taille du qr': 'qrSize',
  'qr lien': 'qrLink',
  'lien du qr': 'qrLink',
  type: 'kind',
  genre: 'kind',
  mode: 'reuse',
  réutilisation: 'reuse',
  reutilisation: 'reuse',
  place: 'place',
  emplacement: 'place',
  moment: 'atS',
  titre: 'headline',
  'sous-titre': 'subline',
  site: 'site',
  image: 'image',
  visuel: 'visualKind',
  logo: 'logo',
  'légende du qr': 'qrCaption',
  'legende du qr': 'qrCaption',
  'ligne du lien': 'linkLine',
  'couleur du site': 'siteColor',
  fond: 'bgColor',
  lumière: 'glowColor',
  lumiere: 'glowColor',
  côté: 'side',
  cote: 'side',
  'durée du clip': 'clipSeconds',
  'duree du clip': 'clipSeconds',
  'arrivée du site': 'linkAtS',
  'arrivee du site': 'linkAtS'
}

const MODES: Record<string, PromoMode> = {
  same: 'same',
  identique: 'same',
  'la même': 'same',
  même: 'same',
  adapt: 'adapt',
  adaptée: 'adapt',
  adaptee: 'adapt',
  adapter: 'adapt',
  per_video: 'per_video',
  'par vidéo': 'per_video',
  'par video': 'per_video',
  nouvelle: 'per_video',
  générée: 'per_video'
}

const PLACES: Record<string, PromoPlace> = {
  after_hook: 'after_hook',
  'après l’accroche': 'after_hook',
  "après l'accroche": 'after_hook',
  début: 'after_hook',
  debut: 'after_hook',
  end: 'end',
  fin: 'end',
  'à la fin': 'end',
  mention: 'mention',
  'sur la mention': 'mention',
  'dans le script': 'mention',
  none: 'none',
  aucune: 'none',
  non: 'none',
  jamais: 'none'
}

/** « 1:25 », « 1 min 25 », « 85 s », « 85 » → seconds. */
function secondsOf(v: string): number | undefined {
  const m = /^(\d+)\s*(?::|min|m)\s*(\d{1,2})?/iu.exec(v.trim())
  if (m?.[1]) return Number(m[1]) * 60 + Number(m[2] ?? 0)
  const n = Number(v.replace(',', '.').replace(/[^\d.]/g, ''))
  return n > 0 ? n : undefined
}

/** A promo's defaults (pure): no reminder, a mention of about 14 s (the reference's), our motion card unless a clip is given. */
function promoDefaults(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.kind !== 'promo') return raw
  const rule = (typeof raw.rule === 'object' && raw.rule !== null ? raw.rule : {}) as Record<string, unknown>
  const card = (typeof raw.promo === 'object' && raw.promo !== null ? raw.promo : {}) as Record<string, unknown>
  const link = typeof raw.link === 'string' ? raw.link : ''
  const host = link.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? ''
  const site = card.site ?? (host || undefined)
  const headline = card.headline ?? raw.name
  return {
    ...raw,
    name: raw.name ?? site ?? headline,
    screen: raw.screen ?? (raw.media ? 'media' : 'motion'),
    rule: { reminder: false, seconds: 14, ...rule },
    ...(site && headline ? { promo: { ...card, site, headline, ...(link && !card.link ? { link } : {}) } } : {})
  }
}

const QR_WHERE: Record<string, SponsorQr['position']> = {
  'bas droite': 'bottom-right',
  'en bas à droite': 'bottom-right',
  'haut droite': 'top-right',
  'en haut à droite': 'top-right',
  'bas gauche': 'bottom-left',
  'en bas à gauche': 'bottom-left',
  'haut gauche': 'top-left',
  'en haut à gauche': 'top-left',
  'centre droite': 'center-right',
  'à droite': 'center-right'
}

const WHERE: Record<string, SponsorRule['where']> = {
  after_hook: 'after_hook',
  'après l’accroche': 'after_hook',
  "après l'accroche": 'after_hook',
  debut: 'after_hook',
  début: 'after_hook',
  middle: 'middle',
  milieu: 'middle',
  before_end: 'before_end',
  fin: 'before_end',
  'avant la fin': 'before_end'
}

const yes = (v: string): boolean => /^(?:oui|yes|true|1)$/iu.test(v.trim())

/**
 * The sponsor from the channel's asset: a JSON object (`Sponsor`), or `clé : valeur` lines (nom, pitch, lien, prix, placement,
 * rappel, durée, prix dit, média, écran, qr, position du qr, taille du qr, lien du qr). Null when the text names no product (the
 * script then has no mention).
 */
export function parseSponsor(text: string): Sponsor | null {
  const t = text.trim()
  if (!t) return null
  if (t.startsWith('{')) {
    try {
      const j: unknown = JSON.parse(t)
      const r = Sponsor.safeParse(typeof j === 'object' && j !== null ? promoDefaults(j as Record<string, unknown>) : j)
      return r.success ? r.data : null
    } catch {
      return null
    }
  }
  const raw: Record<string, unknown> = {}
  const rule: Record<string, unknown> = {}
  const qr: Record<string, unknown> = {}
  const card: Record<string, unknown> = {}
  const visual: Record<string, unknown> = {}
  const colors: Record<string, unknown> = {}
  for (const line of t.split(/\r?\n/)) {
    // the key stops at the first « : », so a link's « https: » stays in the value
    const m = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/u.exec(line)
    if (!m?.[1] || !m[2]) continue
    const key = KEYS[m[1].toLowerCase()]
    const value = m[2]
    if (key === 'where') rule.where = WHERE[value.toLowerCase()] ?? 'after_hook'
    else if (key === 'reminder') rule.reminder = yes(value)
    else if (key === 'spokenPrice') rule.spokenPrice = yes(value)
    else if (key === 'seconds') {
      const n = Number(value.replace(/[^\d.]/g, ''))
      if (n > 0) rule.seconds = n
    } else if (key === 'screen') raw.screen = /^(?:m[ée]dia|vid[ée]o|clip|image)$/iu.test(value) ? 'media' : /^(?:motion|anim[ée]e?|motion design)$/iu.test(value) ? 'motion' : 'card'
    else if (key === 'qr') qr.show = yes(value)
    else if (key === 'qrPosition') qr.position = QR_WHERE[value.toLowerCase()] ?? 'bottom-right'
    else if (key === 'qrLink') qr.link = value
    else if (key === 'qrSize') {
      const n = Number(value.replace(/[^\d.]/g, ''))
      if (n > 0) qr.size = Math.min(0.5, Math.max(0.12, n > 1 ? n / 100 : n))
    } else if (key === 'kind') raw.kind = /promo/iu.test(value) ? 'promo' : 'sponsor'
    else if (key === 'reuse') raw.reuse = MODES[value.toLowerCase()]
    else if (key === 'place') raw.place = PLACES[value.toLowerCase()]
    else if (key === 'atS') raw.atS = secondsOf(value)
    else if (key === 'headline' || key === 'subline' || key === 'site' || key === 'logo' || key === 'qrCaption' || key === 'linkLine') card[key] = value
    else if (key === 'image') visual.image = value
    else if (key === 'visualKind') visual.kind = /[ée]cran|site|capture/iu.test(value) ? 'screen' : /aucun|non|rien/iu.test(value) ? 'none' : 'product'
    else if (key === 'siteColor') colors.site = value
    else if (key === 'bgColor') colors.bg = value
    else if (key === 'glowColor') colors.glow = value
    else if (key === 'side') card.side = /droite|right/iu.test(value) ? 'right' : 'left'
    else if (key === 'clipSeconds') card.seconds = secondsOf(value)
    else if (key === 'linkAtS') card.linkAtS = secondsOf(value)
    else if (key) raw[key] = value
  }
  if (Object.keys(visual).length > 0) card.visual = visual
  if (Object.keys(colors).length > 0) card.colors = colors
  const r = Sponsor.safeParse(promoDefaults({ ...raw, rule, qr, ...(Object.keys(card).length > 0 ? { promo: card } : {}) }))
  return r.success ? r.data : null
}

/** What is not set yet for a channel's promo: the pipeline agent asks one short question for each (empty for a sponsor). */
export function promoUnknowns(s: Sponsor): ('place' | 'mode')[] {
  if (s.kind !== 'promo') return []
  return [...(s.place ? [] : (['place'] as const)), ...(s.reuse ? [] : (['mode'] as const))]
}

/**
 * The placement rule a promo's mention is written with (pure): after the hook, the paragraph break nearest to its moment (1:25 by
 * default, as the reference); at the end, before the closing. A sponsor keeps its own rule. `mention` and `none` write nothing.
 */
export function effectiveRule(s: Sponsor): SponsorRule {
  if (s.kind !== 'promo') return s.rule
  if (s.place === 'end') return { ...s.rule, where: 'before_end', reminder: false }
  const at = s.atS ?? PROMO_REFERENCE_AT_S
  return { ...s.rule, where: 'after_hook', windowS: [at, at], reminder: false }
}
