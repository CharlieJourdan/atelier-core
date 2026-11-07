// « Contacter le support » (PLAN-V2-PRODUCTION §2.8): requests stored locally (the Cloud's `support_requests` arrives
// with lot P5), read by Réglages › Admin plateforme through `support.list` / `support.close`. No e-mail is sent
// (feature `support-email`, demo).
import type { Db } from '../db'
import { nowIso } from '../db'
import type { SupportInput, SupportRequestRow } from '../../shared/analysis'
import { cleanText, isId } from './library'

interface Row {
  id: number
  what: string
  links: string
  budget: string
  contact: string
  attach_analysis: number
  analysis_id: number | null
  status: 'open' | 'closed'
  example: number
  created_at: string
  closed_at: string | null
}

const toRow = (r: Row): SupportRequestRow => ({
  id: r.id,
  what: r.what,
  links: r.links,
  budget: r.budget,
  contact: r.contact,
  attachAnalysis: r.attach_analysis === 1,
  analysisId: r.analysis_id,
  status: r.status,
  example: r.example === 1,
  createdAt: r.created_at,
  closedAt: r.closed_at
})

export class SupportStore {
  constructor(private readonly db: Db) {}

  list(): SupportRequestRow[] {
    return (this.db.prepare("SELECT * FROM support_requests ORDER BY status = 'closed', id DESC").all() as unknown as Row[]).map(toRow)
  }

  get(id: number): SupportRequestRow {
    if (!isId(id)) throw new Error('Demande inconnue.')
    const r = this.db.prepare('SELECT * FROM support_requests WHERE id = ?').get(id) as unknown as Row | undefined
    if (!r) throw new Error('Demande inconnue.')
    return toRow(r)
  }

  create(input: SupportInput, example = false): SupportRequestRow {
    if (typeof input !== 'object' || input === null) throw new Error('Demande invalide.')
    const what = cleanText(input.what, 'Ce que tu veux faire', 4000)
    const links = cleanText(input.links ?? '', 'Liens d’exemple', 2000, false)
    const budget = cleanText(input.budget ?? '', 'Budget par vidéo', 120, false)
    const contact = cleanText(input.contact, 'Moyen de te joindre', 200)
    const attach = input.attachAnalysis === true
    let analysisId: number | null = null
    if (attach) {
      if (!isId(input.analysisId) || !this.db.prepare('SELECT id FROM analysis_runs WHERE id = ?').get(input.analysisId)) {
        throw new Error('Analyse à joindre introuvable.')
      }
      analysisId = input.analysisId
    }
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO support_requests (what, links, budget, contact, attach_analysis, analysis_id, example, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(what, links, budget, contact, attach ? 1 : 0, analysisId, example ? 1 : 0, nowIso()).lastInsertRowid
    )
    return this.get(id)
  }

  close(id: number): SupportRequestRow {
    const r = this.get(id)
    if (r.status === 'closed') throw new Error('Cette demande est déjà close.')
    this.db.prepare("UPDATE support_requests SET status = 'closed', closed_at = ? WHERE id = ?").run(nowIso(), id)
    return this.get(id)
  }
}
