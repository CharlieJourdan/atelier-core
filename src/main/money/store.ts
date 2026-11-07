// Monétisation store: revenues, sponsor deals and offers in SQLite. Every argument is validated here (the renderer is
// untrusted) and user errors are French messages.
import type { CsvImportResult, CsvPreview, RevenueFilter } from '../../shared/api/money'
import {
  CURRENCIES,
  OFFER_KINDS,
  OFFER_STATUSES,
  REVENUE_TYPES,
  SPONSOR_STAGES,
  parseDate,
  parseRevenueCsv,
  type Currency,
  type OfferInput,
  type OfferKind,
  type OfferPack,
  type OfferRow,
  type OfferStatus,
  type RevenueInput,
  type RevenueRow,
  type RevenueSource,
  type RevenueType,
  type SponsorDealInput,
  type SponsorDealRow,
  type SponsorStage
} from '../../shared/money'
import { transaction, type Db } from '../db'

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new Error(`${what} : valeur inconnue.`)
  return v as T
}

function cents(v: unknown, what: string, allowNegative = false): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || (!allowNegative && v < 0) || Math.abs(v) > 100_000_000_00) {
    throw new Error(`${what} : montant invalide.`)
  }
  return v
}

function text(v: unknown, what: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw new Error(`${what} : champ obligatoire.`)
    return ''
  }
  if (typeof v !== 'string') throw new Error(`${what} : texte attendu.`)
  const s = v.trim()
  if (required && !s) throw new Error(`${what} : champ obligatoire.`)
  if (s.length > max) throw new Error(`${what} : ${max} caractères au plus.`)
  return s
}

function id(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error(`${what} : identifiant invalide.`)
  return v
}

interface RevenueDb {
  id: number
  date: string
  channel_id: number | null
  channel_name: string | null
  video_id: number | null
  type: RevenueType
  amount_cents: number
  currency: Currency
  source: RevenueSource
  note: string
  example: number
}
interface SponsorDb {
  id: number
  brand: string
  contact: string
  amount_cents: number
  currency: Currency
  terms: string
  required_phrases: string
  link: string
  placement: string
  due_date: string | null
  video_id: number | null
  channel_id: number | null
  channel_name: string | null
  stage: SponsorStage
  draft_message: string
  example: number
}
interface OfferDb {
  id: number
  channel_id: number | null
  channel_name: string | null
  name: string
  kind: OfferKind
  price_cents: number
  status: OfferStatus
  pack_json: string
  example: number
}

const toRevenue = (r: RevenueDb): RevenueRow => ({
  id: r.id,
  date: r.date,
  channelId: r.channel_id,
  channelName: r.channel_name,
  videoId: r.video_id,
  type: r.type,
  amountCents: r.amount_cents,
  currency: r.currency,
  source: r.source,
  note: r.note,
  example: r.example === 1
})
const toSponsor = (r: SponsorDb): SponsorDealRow => ({
  id: r.id,
  brand: r.brand,
  contact: r.contact,
  amountCents: r.amount_cents,
  currency: r.currency,
  terms: r.terms,
  requiredPhrases: r.required_phrases,
  link: r.link,
  placement: r.placement,
  dueDate: r.due_date,
  videoId: r.video_id,
  channelId: r.channel_id,
  channelName: r.channel_name,
  stage: r.stage,
  draftMessage: r.draft_message,
  example: r.example === 1
})
const toOffer = (r: OfferDb): OfferRow => ({
  id: r.id,
  channelId: r.channel_id,
  channelName: r.channel_name,
  name: r.name,
  kind: r.kind,
  priceCents: r.price_cents,
  status: r.status,
  pack: JSON.parse(r.pack_json) as OfferPack | null,
  example: r.example === 1
})

const REVENUE_SELECT = 'SELECT r.*, c.name AS channel_name FROM revenues r LEFT JOIN channels c ON c.id = r.channel_id'
const SPONSOR_SELECT = 'SELECT s.*, c.name AS channel_name FROM sponsor_deals s LEFT JOIN channels c ON c.id = s.channel_id'
const OFFER_SELECT = 'SELECT o.*, c.name AS channel_name FROM offers o LEFT JOIN channels c ON c.id = o.channel_id'
const TOUCH = "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"

export class MoneyStore {
  constructor(private readonly db: Db) {}

  private requireChannel(channelId: unknown): number | null {
    if (channelId === null || channelId === undefined) return null
    const cid = id(channelId, 'Chaîne')
    if (!this.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(cid)) throw new Error('Chaîne introuvable.')
    return cid
  }

  private requireVideo(videoId: unknown): number | null {
    if (videoId === null || videoId === undefined) return null
    const vid = id(videoId, 'Vidéo')
    if (!this.db.prepare('SELECT 1 FROM videos WHERE id = ?').get(vid)) throw new Error('Vidéo introuvable.')
    return vid
  }

  // --- revenues -----------------------------------------------------------------------------------------------

  listRevenues(filter: RevenueFilter = {}): RevenueRow[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (filter.channelId !== undefined && filter.channelId !== null) {
      where.push('r.channel_id = ?')
      args.push(id(filter.channelId, 'Chaîne'))
    }
    if (filter.month !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(filter.month)) throw new Error('Mois invalide (AAAA-MM).')
      where.push('substr(r.date, 1, 7) = ?')
      args.push(filter.month)
    }
    const sql = `${REVENUE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY r.date DESC, r.id DESC LIMIT 2000`
    return (this.db.prepare(sql).all(...args) as unknown as RevenueDb[]).map(toRevenue)
  }

  getRevenue(rid: number): RevenueRow {
    const row = this.db.prepare(`${REVENUE_SELECT} WHERE r.id = ?`).get(rid) as RevenueDb | undefined
    if (!row) throw new Error('Revenu introuvable.')
    return toRevenue(row)
  }

  saveRevenue(input: RevenueInput, source: RevenueSource = 'manual'): RevenueRow {
    const date = typeof input.date === 'string' ? parseDate(input.date) : null
    if (!date) throw new Error('Date invalide (AAAA-MM-JJ).')
    const channelId = this.requireChannel(input.channelId)
    const videoId = this.requireVideo(input.videoId)
    const type = oneOf(REVENUE_TYPES, input.type, 'Type')
    const amount = cents(input.amountCents, 'Montant', true)
    const currency = oneOf(CURRENCIES, input.currency, 'Devise')
    const note = text(input.note, 'Note', 500)
    if (input.id !== undefined) {
      const rid = id(input.id, 'Revenu')
      this.getRevenue(rid)
      this.db
        .prepare('UPDATE revenues SET date=?, channel_id=?, video_id=?, type=?, amount_cents=?, currency=?, note=? WHERE id=?')
        .run(date, channelId, videoId, type, amount, currency, note, rid)
      return this.getRevenue(rid)
    }
    const info = this.db
      .prepare('INSERT INTO revenues (date, channel_id, video_id, type, amount_cents, currency, source, note) VALUES (?,?,?,?,?,?,?,?)')
      .run(date, channelId, videoId, type, amount, currency, source, note)
    return this.getRevenue(Number(info.lastInsertRowid))
  }

  deleteRevenue(rid: number): void {
    const r = this.db.prepare('DELETE FROM revenues WHERE id = ?').run(id(rid, 'Revenu'))
    if (r.changes === 0) throw new Error('Revenu introuvable.')
  }

  private channelsForCsv(): { id: number; name: string }[] {
    return this.db.prepare('SELECT id, name FROM channels WHERE archived_at IS NULL ORDER BY id').all() as { id: number; name: string }[]
  }

  previewCsv(csv: string): CsvPreview {
    if (typeof csv !== 'string') throw new Error('Texte attendu.')
    if (csv.length > 2_000_000) throw new Error('Fichier trop gros (2 Mo au plus).')
    const lines = parseRevenueCsv(csv, this.channelsForCsv())
    const valid = lines.filter((l) => l.ok).length
    return { lines, valid, invalid: lines.length - valid }
  }

  /** Imports the valid lines in one transaction; invalid lines are reported as skipped. */
  importCsv(csv: string): CsvImportResult {
    const preview = this.previewCsv(csv)
    if (preview.valid === 0) throw new Error(preview.lines.length === 0 ? 'Le fichier est vide.' : 'Aucune ligne valide à importer.')
    transaction(this.db, () => {
      for (const l of preview.lines) {
        if (!l.ok || !l.value) continue
        this.saveRevenue({ ...l.value }, 'csv')
      }
    })
    return { imported: preview.valid, skipped: preview.invalid }
  }

  // --- sponsors -----------------------------------------------------------------------------------------------

  listSponsors(): SponsorDealRow[] {
    return (this.db.prepare(`${SPONSOR_SELECT} ORDER BY s.updated_at DESC, s.id DESC`).all() as unknown as SponsorDb[]).map(toSponsor)
  }

  getSponsor(sid: number): SponsorDealRow {
    const row = this.db.prepare(`${SPONSOR_SELECT} WHERE s.id = ?`).get(id(sid, 'Deal')) as SponsorDb | undefined
    if (!row) throw new Error('Deal introuvable.')
    return toSponsor(row)
  }

  saveSponsor(input: SponsorDealInput): SponsorDealRow {
    const brand = text(input.brand, 'Marque', 120, true)
    const link = text(input.link, 'Lien', 500)
    if (link && !/^https?:\/\//i.test(link)) throw new Error('Lien : une adresse http(s):// est attendue.')
    let due: string | null = null
    if (input.dueDate) {
      due = parseDate(input.dueDate)
      if (!due) throw new Error('Échéance invalide (AAAA-MM-JJ).')
    }
    const contact = text(input.contact, 'Contact', 200)
    const amount = cents(input.amountCents ?? 0, 'Montant')
    const currency = oneOf(CURRENCIES, input.currency ?? 'EUR', 'Devise')
    const terms = text(input.terms, 'Conditions', 4000)
    const phrases = text(input.requiredPhrases, 'Phrases imposées', 4000)
    const placement = text(input.placement, 'Placement', 200)
    const videoId = this.requireVideo(input.videoId)
    const channelId = this.requireChannel(input.channelId)
    if (input.id !== undefined) {
      const sid = id(input.id, 'Deal')
      const current = this.getSponsor(sid)
      const stage = input.stage === undefined ? current.stage : oneOf(SPONSOR_STAGES, input.stage, 'Étape')
      this.db
        .prepare(
          `UPDATE sponsor_deals SET brand=?, contact=?, amount_cents=?, currency=?, terms=?, required_phrases=?, link=?, placement=?,
           due_date=?, video_id=?, channel_id=?, stage=?, ${TOUCH} WHERE id=?`
        )
        .run(brand, contact, amount, currency, terms, phrases, link, placement, due, videoId, channelId, stage, sid)
      return this.getSponsor(sid)
    }
    const stage = input.stage === undefined ? 'prospect' : oneOf(SPONSOR_STAGES, input.stage, 'Étape')
    const info = this.db
      .prepare(
        `INSERT INTO sponsor_deals (brand, contact, amount_cents, currency, terms, required_phrases, link, placement, due_date, video_id, channel_id, stage)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(brand, contact, amount, currency, terms, phrases, link, placement, due, videoId, channelId, stage)
    return this.getSponsor(Number(info.lastInsertRowid))
  }

  moveSponsor(sid: number, stage: SponsorStage): SponsorDealRow {
    const s = oneOf(SPONSOR_STAGES, stage, 'Étape')
    this.getSponsor(sid)
    this.db.prepare(`UPDATE sponsor_deals SET stage=?, ${TOUCH} WHERE id=?`).run(s, sid)
    return this.getSponsor(sid)
  }

  setDraft(sid: number, message: string): SponsorDealRow {
    this.getSponsor(sid)
    this.db.prepare(`UPDATE sponsor_deals SET draft_message=?, ${TOUCH} WHERE id=?`).run(message, sid)
    return this.getSponsor(sid)
  }

  deleteSponsor(sid: number): void {
    const r = this.db.prepare('DELETE FROM sponsor_deals WHERE id = ?').run(id(sid, 'Deal'))
    if (r.changes === 0) throw new Error('Deal introuvable.')
  }

  // --- offers -------------------------------------------------------------------------------------------------

  listOffers(): OfferRow[] {
    return (this.db.prepare(`${OFFER_SELECT} ORDER BY o.updated_at DESC, o.id DESC`).all() as unknown as OfferDb[]).map(toOffer)
  }

  getOffer(oid: number): OfferRow {
    const row = this.db.prepare(`${OFFER_SELECT} WHERE o.id = ?`).get(id(oid, 'Offre')) as OfferDb | undefined
    if (!row) throw new Error('Offre introuvable.')
    return toOffer(row)
  }

  saveOffer(input: OfferInput): OfferRow {
    const name = text(input.name, 'Nom', 160, true)
    const channelId = this.requireChannel(input.channelId)
    const kind = oneOf(OFFER_KINDS, input.kind ?? 'ebook', 'Type')
    const price = cents(input.priceCents ?? 0, 'Prix')
    if (input.id !== undefined) {
      const oid = id(input.id, 'Offre')
      const current = this.getOffer(oid)
      const status = input.status === undefined ? current.status : oneOf(OFFER_STATUSES, input.status, 'Statut')
      this.db.prepare(`UPDATE offers SET channel_id=?, name=?, kind=?, price_cents=?, status=?, ${TOUCH} WHERE id=?`).run(channelId, name, kind, price, status, oid)
      return this.getOffer(oid)
    }
    const status = input.status === undefined ? 'idea' : oneOf(OFFER_STATUSES, input.status, 'Statut')
    const info = this.db.prepare('INSERT INTO offers (channel_id, name, kind, price_cents, status) VALUES (?,?,?,?,?)').run(channelId, name, kind, price, status)
    return this.getOffer(Number(info.lastInsertRowid))
  }

  setPack(oid: number, pack: OfferPack): OfferRow {
    this.getOffer(oid)
    this.db.prepare(`UPDATE offers SET pack_json=?, ${TOUCH} WHERE id=?`).run(JSON.stringify(pack), oid)
    return this.getOffer(oid)
  }

  deleteOffer(oid: number): void {
    const r = this.db.prepare('DELETE FROM offers WHERE id = ?').run(id(oid, 'Offre'))
    if (r.changes === 0) throw new Error('Offre introuvable.')
  }
}
