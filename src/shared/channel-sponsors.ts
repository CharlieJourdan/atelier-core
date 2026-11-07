// The channel's sponsor as the app shows it (production-9, decision 0025): the text the owner typed, and what Atelier reads in it.
export interface ChannelSponsorView {
  channelId: number
  /** The asset as typed: `clé : valeur` lines (nom, pitch, lien, média, écran, qr, position du qr…) or a JSON object. */
  text: string
  /** What the videos use: the product, its link, the QR code, what the slot shows and where the first mention goes. */
  read: { name: string; link: string; qr: boolean; qrPosition: string; screen: 'card' | 'media' | 'motion'; media: string; where: string; reminder: boolean }
  /** The channel's own promo (promo-motion, `type : promo`): its reuse mode and placement, and what is not set yet (the agent asks). Null: a sponsor. */
  promo: { reuse: 'same' | 'adapt' | 'per_video' | null; place: 'after_hook' | 'end' | 'mention' | 'none' | null; atS: number | null; unknown: ('place' | 'mode')[] } | null
  updatedAt: string
}
