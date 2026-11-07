// The channel's sponsor (production-9, decision 0025, docs/specs/pipeline-avatar.md §2.13): one asset per channel, the text the
// owner typed, checked with the engine's own reader (`parseSponsor`) before it is kept, so a run never meets a sponsor it cannot
// read. The channel's runs take it as the pipeline's `sponsor` input (`textFor`) when the run was not given one.
import { PROMO_MODES, PROMO_PLACES, type PromoMode, type PromoPlace } from '../../../engine/formats/promo'
import { parseSponsor, promoUnknowns } from '../../../engine/formats/sponsor'
import type { ChannelSponsorView } from '../../../shared/channel-sponsors'
import type { Db } from '../../db'

interface Row {
  channel_id: number
  text: string
  updated_at: string
}

export interface ChannelSponsorsOptions {
  db: Db
  now?: () => Date
  notify?: () => void
}

export class ChannelSponsors {
  private readonly o: ChannelSponsorsOptions

  constructor(o: ChannelSponsorsOptions) {
    this.o = o
  }

  private row(channelId: number): Row | undefined {
    return this.o.db.prepare('SELECT channel_id, text, updated_at FROM channel_sponsors WHERE channel_id = ?').get(channelId) as Row | undefined
  }

  private checkChannel(channelId: unknown): number {
    if (typeof channelId !== 'number' || !Number.isInteger(channelId) || channelId <= 0) throw new Error('Chaîne invalide.')
    if (!this.o.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) throw new Error('Cette chaîne n’existe pas.')
    return channelId
  }

  get(channelId: unknown): ChannelSponsorView | null {
    const r = this.row(this.checkChannel(channelId))
    return r ? view(r) : null
  }

  /** Keeps the sponsor (an empty text removes it). A text that names no product is refused with the lines it expects. */
  set(channelId: unknown, text: unknown): ChannelSponsorView | null {
    const id = this.checkChannel(channelId)
    if (typeof text !== 'string' || text.length > 4000) throw new Error('Le sponsor doit être un texte de 4 000 caractères au plus.')
    const t = text.trim()
    if (!t) {
      this.o.db.prepare('DELETE FROM channel_sponsors WHERE channel_id = ?').run(id)
      this.o.notify?.()
      return null
    }
    if (!parseSponsor(t)) throw new Error('Je ne lis pas ce sponsor : écris au moins « nom : … », puis « pitch : … » et « lien : … », une ligne par information.')
    const at = (this.o.now?.() ?? new Date()).toISOString()
    this.o.db
      .prepare('INSERT INTO channel_sponsors (channel_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at')
      .run(id, t, at)
    this.o.notify?.()
    return this.get(id)
  }

  /** What the channel's promo does not say yet (`place`, `mode`): the pipeline agent asks. Empty without a promo. */
  promoUnknowns(channelId: number): ('place' | 'mode')[] {
    const s = parseSponsor(this.row(channelId)?.text ?? '')
    return s ? promoUnknowns(s) : []
  }

  /** Keeps the owner's answer to the agent's question about the promo (a line of the asset, or a field of its JSON). */
  answerPromo(channelId: unknown, which: unknown, value: unknown): ChannelSponsorView | null {
    const id = this.checkChannel(channelId)
    const text = this.row(id)?.text ?? ''
    if (!parseSponsor(text) || parseSponsor(text)?.kind !== 'promo') throw new Error('Cette chaîne n’a pas de promo.')
    if (which === 'place' && PROMO_PLACES.includes(value as PromoPlace)) return this.set(id, withSetting(text, 'place', value as PromoPlace))
    if (which === 'mode' && PROMO_MODES.includes(value as PromoMode)) return this.set(id, withSetting(text, 'mode', value as PromoMode))
    throw new Error('Réponse inconnue pour la promo.')
  }

  /** The sponsor's text for the channel's runs, or null. */
  textFor(channelId: number): string | null {
    return this.row(channelId)?.text ?? null
  }
}

function view(r: Row): ChannelSponsorView {
  const s = parseSponsor(r.text)
  return {
    channelId: r.channel_id,
    text: r.text,
    read: {
      name: s?.name ?? '',
      link: s?.link ?? '',
      qr: Boolean(s?.qr.show && (s.qr.link || s.link)),
      qrPosition: s?.qr.position ?? 'bottom-right',
      screen: s?.screen ?? 'card',
      media: s?.media ?? '',
      where: s?.rule.where ?? 'after_hook',
      reminder: s?.rule.reminder ?? true
    },
    promo: s?.kind === 'promo' ? { reuse: s.reuse ?? null, place: s.place ?? null, atS: s.atS ?? null, unknown: promoUnknowns(s) } : null,
    updatedAt: r.updated_at
  }
}

const WORDS: Record<PromoPlace | PromoMode, string> = {
  after_hook: 'après l’accroche',
  end: 'fin',
  mention: 'mention',
  none: 'aucune',
  same: 'identique',
  adapt: 'adaptée',
  per_video: 'par vidéo'
}

/** The asset with one promo setting written in (pure): its JSON field, or its `place :` / `mode :` line replaced or added. */
export function withSetting(text: string, which: 'place' | 'mode', value: PromoPlace | PromoMode): string {
  const t = text.trim()
  if (t.startsWith('{')) return JSON.stringify({ ...(JSON.parse(t) as object), [which === 'place' ? 'place' : 'reuse']: value }, null, 2)
  const keys = which === 'place' ? ['place', 'emplacement'] : ['mode', 'réutilisation', 'reutilisation']
  const line = `${which} : ${WORDS[value]}`
  const lines = t.split(/\r?\n/)
  const at = lines.findIndex((l) => keys.includes((/^\s*([^:]+?)\s*:/u.exec(l)?.[1] ?? '').toLowerCase()))
  if (at >= 0) lines[at] = line
  else lines.push(line)
  return lines.join('\n')
}
