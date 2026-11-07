// The channel's own promo (promo-motion, research note promo-motion-2026-11 (old repository)): the short motion-design card a channel shows to
// send its viewers to its own site or offer, made by our motion bricks from a short spec (this file), or a clip the owner already
// made (`Sponsor.media`). It lives in the channel's sponsor asset (`type : promo`, formats/sponsor.ts) with two channel settings:
// how it is reused from one video to the next, and where it goes in the script. Pure: zod schemas and small rules.
import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const text = (max: number) => z.string().trim().min(1).max(max)

/** What the promo shows beside its text: a product picture (a book, a box), a screenshot of the site in a browser, or nothing. */
export const PROMO_VISUALS = ['product', 'screen', 'none'] as const

export const PromoColors = z.object({
  /** The background's edges and its warm centre (a soft light behind the text). */
  bg: hex.default('#20170E'),
  glow: hex.default('#4A341E'),
  /** The site's address, the big line. */
  site: hex.default('#DDAF79'),
  /** Headline, QR caption and the link line. */
  text: hex.default('#FBF7F4'),
  /** The serif line under the headline. */
  muted: hex.default('#AE9A89')
})
export type PromoColors = z.infer<typeof PromoColors>

export const PromoCard = z.object({
  /** The big condensed line (written in capitals on screen). */
  headline: text(70),
  /** The serif line under it: the offer, its author. */
  subline: text(140).optional(),
  /** The address as said and shown (« exemple-compagnon.fr »). */
  site: text(60),
  /** What the QR code opens; empty: `https://<site>`. */
  link: z.string().trim().max(300).default(''),
  qr: z.boolean().default(true),
  qrCaption: text(80).default('Sur la télé ? Scannez le code avec votre téléphone'),
  /** The line under the address, with its arrow. Empty: none. */
  linkLine: z.string().trim().max(60).default('Lien en haut de la description'),
  visual: z
    .object({
      kind: z.enum(PROMO_VISUALS).default('product'),
      /** A picture file on the machine that renders (PNG, JPEG or WebP). Empty: no visual. */
      image: z.string().trim().max(1000).default(''),
      /** A screenshot: the point the camera moves to and the cursor clicks, as shares of the picture (0–1). */
      focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.35 })
    })
    .prefault({}),
  /** The channel's logo (a picture file), revealed top right of the text. Empty: none. */
  logo: z.string().trim().max(1000).default(''),
  colors: PromoColors.prefault({}),
  /** The visual on the left (as in the reference) or on the right. */
  side: z.enum(['left', 'right']).default('left'),
  /** When the address, its link line and the QR card come in (seconds into the clip). Absent: the first reference's 1.28 s; the second one's: 5.7 s. */
  linkAtS: z.number().min(0).max(25).optional(),
  /** Seconds of the clip (the reference's card: 9.72 s). A longer slot holds its last frame; a shorter one cuts it. */
  seconds: z.number().min(4).max(30).default(9.72)
})
export type PromoCard = z.infer<typeof PromoCard>
export type PromoCardInput = z.input<typeof PromoCard>

/** How the promo goes from one video to the next: the same clip, the same card with its text adapted, or a card made for the video. */
export const PROMO_MODES = ['same', 'adapt', 'per_video'] as const
export type PromoMode = (typeof PROMO_MODES)[number]

/** Where the promo goes: right after the hook (about 1:25 in the reference), before the end, on the passage of the script that already speaks of the offer, or nowhere. */
export const PROMO_PLACES = ['after_hook', 'end', 'mention', 'none'] as const
export type PromoPlace = (typeof PROMO_PLACES)[number]

/** Where the reference channel puts it: 1:25 (its card starts at 84.6 s). */
export const PROMO_REFERENCE_AT_S = 85

/** The text a video's promo shows, written for that video (`script.sponsor` puts it in the outline; adapt and per-video modes). */
export const PromoText = z.object({ headline: text(70).optional(), subline: text(140).optional() })
export type PromoText = z.infer<typeof PromoText>

/** The link the QR code opens. */
export const promoLink = (c: PromoCard): string => c.link || `https://${c.site.replace(/^https?:\/\//, '')}`

/** The site's name without its ending (« exemplecompagnon » for « exemple-compagnon.fr »): what the script says when it names the site. */
export function siteStem(site: string): string {
  const host = site.replace(/^https?:\/\//, '').split('/')[0] ?? ''
  const parts = host.split('.')
  return fold(parts.length > 1 ? parts.slice(0, -1).join('') : host)
}

/** Lower case, no accents, no spaces or punctuation: « exemple-compagnon-tout-en-un-mot.fr » → « exemplecompagnontoutenunmotfr ». */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const cut = (s: string, max: number): string => {
  if (s.length <= max) return s
  const words = s.slice(0, max - 1).split(/\s+/)
  words.pop()
  return `${words.join(' ')}…`
}

/**
 * The card a video shows (pure). `same`: the channel's card as it is (one clip for every video). `adapt`: the same card, its text
 * replaced by the one written for this video (`said`), else a line naming the video's subject. `per_video`: a card made for this video:
 * the written text, else the video's title as the headline, and the side alternating with the title, so two videos differ.
 */
/** The card's two fixed lines in the video's language when the channel left them at their French defaults (equipe-3-chaines:
 *  a German channel's card said « Scannez le code »). A line the channel wrote itself is kept as it is. Pure. */
const LOCAL_LINES: Record<string, { qrCaption: string; linkLine: string }> = {
  en: { qrCaption: 'Watching on TV? Scan the code with your phone', linkLine: 'Link at the top of the description' },
  de: { qrCaption: 'Am Fernseher? Scannen Sie den Code mit dem Handy', linkLine: 'Link ganz oben in der Beschreibung' },
  es: { qrCaption: '¿En la tele? Escanea el código con tu móvil', linkLine: 'Enlace arriba en la descripción' },
  it: { qrCaption: 'In TV? Inquadra il codice con il telefono', linkLine: 'Link in alto nella descrizione' }
}
const FR_LINES = { qrCaption: PromoCard.shape.qrCaption.parse(undefined), linkLine: PromoCard.shape.linkLine.parse(undefined) }

export function localCard(card: PromoCard, language: string | null | undefined): PromoCard {
  const local = language ? LOCAL_LINES[language.slice(0, 2).toLowerCase()] : undefined
  if (!local) return card
  return {
    ...card,
    ...(card.qrCaption === FR_LINES.qrCaption ? { qrCaption: local.qrCaption } : {}),
    ...(card.linkLine === FR_LINES.linkLine ? { linkLine: local.linkLine } : {})
  }
}

export function cardFor(card: PromoCard, mode: PromoMode, video: { title: string; said?: PromoText | undefined }): PromoCard {
  if (mode === 'same') return card
  const title = video.title.trim()
  if (mode === 'adapt') {
    return {
      ...card,
      headline: video.said?.headline ?? card.headline,
      subline: video.said?.subline ?? cut(`Pour aller plus loin sur « ${title} »`, 140)
    }
  }
  // a small hash of the title (FNV-1a, a middle bit: the low one is only the parity of the letters): the same video always gets the
  // same side, two videos often differ
  const odd = ([...fold(title)].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 13) % 2 === 1
  return {
    ...card,
    headline: video.said?.headline ?? cut(`${title}, et tout le reste`, 70),
    subline: video.said?.subline ?? card.subline,
    side: odd ? (card.side === 'left' ? 'right' : 'left') : card.side
  }
}
