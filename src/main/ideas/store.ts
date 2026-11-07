// Ideas of the Production section (lot Z1): typed by hand or proposed by the ideas agent through the user's Claude
// Code; « Créer la vidéo » turns one into a plain video row (status `idea`, no agent task, so nothing runs by itself).
import { z } from 'zod'
import { IDEA_STATUSES, type IdeaInput, type IdeaPatch, type IdeaRow, type IdeaStatus } from '../../shared/api/ideas'
import { nowIso, transaction, type Db } from '../db'

interface IdeaDbRow {
  id: number
  channel_id: number
  channel_name: string
  title: string
  angle: string
  source: 'manual' | 'agent'
  score: number | null
  status: IdeaStatus
  video_id: number | null
  example: number
  created_at: string
}

const SELECT = `SELECT i.*, c.name AS channel_name FROM ideas i JOIN channels c ON c.id = i.channel_id`

function toRow(r: IdeaDbRow): IdeaRow {
  return {
    id: r.id,
    channelId: r.channel_id,
    channelName: r.channel_name,
    title: r.title,
    angle: r.angle,
    source: r.source,
    score: r.score,
    status: r.status,
    videoId: r.video_id,
    example: r.example === 1,
    createdAt: r.created_at
  }
}

export function cleanTitle(v: unknown): string {
  if (typeof v !== 'string') throw new Error('Le titre de l’idée doit être un texte.')
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s) throw new Error('Le titre de l’idée est vide.')
  if (s.length > 200) throw new Error('Le titre de l’idée dépasse 200 caractères.')
  return s
}

function cleanAngle(v: unknown): string {
  if (v === undefined) return ''
  if (typeof v !== 'string') throw new Error('L’angle doit être un texte.')
  return v.trim().slice(0, 1000)
}

export function positiveId(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error(`Identifiant invalide (${what}).`)
  return v
}

/** What the ideas agent must answer: one fenced block ```atelier-ideas [{ "title", "angle", "score" }] ```. */
export const AgentIdeas = z
  .array(
    z.object({
      title: z.string().trim().min(1).max(200),
      angle: z.string().trim().max(1000).default(''),
      score: z.number().int().min(0).max(100).optional()
    })
  )
  .min(1)
  .max(20)

/** Reads the agent's ```atelier-ideas``` block; null when absent or invalid. */
export function parseAgentIdeas(text: string): z.infer<typeof AgentIdeas> | null {
  const m = /```atelier-ideas\s*\n([\s\S]*?)```/.exec(text)
  if (!m?.[1]) return null
  try {
    const parsed = AgentIdeas.safeParse(JSON.parse(m[1]))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export class IdeasStore {
  constructor(private readonly db: Db) {}

  list(channelId?: number): IdeaRow[] {
    const rows =
      channelId === undefined
        ? this.db.prepare(`${SELECT} ORDER BY i.status = 'used', i.created_at DESC, i.id DESC`).all()
        : this.db.prepare(`${SELECT} WHERE i.channel_id = ? ORDER BY i.status = 'used', i.created_at DESC, i.id DESC`).all(positiveId(channelId, 'chaîne'))
    return (rows as unknown as IdeaDbRow[]).map(toRow)
  }

  get(id: number): IdeaRow {
    const r = this.db.prepare(`${SELECT} WHERE i.id = ?`).get(positiveId(id, 'idée')) as IdeaDbRow | undefined
    if (!r) throw new Error('Idée introuvable.')
    return toRow(r)
  }

  private assertChannel(channelId: number): void {
    const c = this.db.prepare('SELECT id FROM channels WHERE id = ? AND archived_at IS NULL').get(positiveId(channelId, 'chaîne'))
    if (!c) throw new Error('Chaîne introuvable ou archivée.')
  }

  create(input: IdeaInput, source: 'manual' | 'agent' = 'manual', score: number | null = null): IdeaRow {
    if (!input || typeof input !== 'object') throw new Error('Idée invalide.')
    this.assertChannel(input.channelId)
    const r = this.db
      .prepare('INSERT INTO ideas (channel_id, title, angle, source, score) VALUES (?, ?, ?, ?, ?)')
      .run(input.channelId, cleanTitle(input.title), cleanAngle(input.angle), source, score)
    return this.get(Number(r.lastInsertRowid))
  }

  update(id: number, patch: IdeaPatch): IdeaRow {
    const current = this.get(id)
    if (!patch || typeof patch !== 'object') throw new Error('Modification invalide.')
    const title = patch.title === undefined ? current.title : cleanTitle(patch.title)
    const angle = patch.angle === undefined ? current.angle : cleanAngle(patch.angle)
    let status = current.status
    if (patch.status !== undefined) {
      if (!(IDEA_STATUSES as readonly string[]).includes(patch.status)) throw new Error('Statut d’idée inconnu.')
      if (patch.status === 'used' && current.videoId === null) throw new Error('Une idée devient « utilisée » en créant sa vidéo.')
      status = patch.status
    }
    this.db.prepare('UPDATE ideas SET title = ?, angle = ?, status = ?, updated_at = ? WHERE id = ?').run(title, angle, status, nowIso(), current.id)
    return this.get(current.id)
  }

  delete(id: number): void {
    const r = this.db.prepare('DELETE FROM ideas WHERE id = ?').run(positiveId(id, 'idée'))
    if (r.changes === 0) throw new Error('Idée introuvable.')
  }

  /** A plain video row from the idea (status `idea`, no deliverables or tasks); the idea is marked used. */
  toVideo(id: number): IdeaRow {
    const idea = this.get(id)
    if (idea.videoId !== null) throw new Error('Cette idée a déjà sa vidéo.')
    this.assertChannel(idea.channelId)
    transaction(this.db, () => {
      const v = this.db
        .prepare("INSERT INTO videos (channel_id, title, brief, status) VALUES (?, ?, ?, 'idea')")
        .run(idea.channelId, idea.title, idea.angle)
      this.db
        .prepare("UPDATE ideas SET status = 'used', video_id = ?, updated_at = ? WHERE id = ?")
        .run(Number(v.lastInsertRowid), nowIso(), idea.id)
    })
    return this.get(idea.id)
  }

  /** The topic an automation takes from a channel: its oldest kept idea, else its newest new one. */
  nextForAutomation(channelId: number): IdeaRow | null {
    const kept = this.db.prepare(`${SELECT} WHERE i.channel_id = ? AND i.status = 'kept' AND i.video_id IS NULL ORDER BY i.created_at, i.id LIMIT 1`).get(channelId) as IdeaDbRow | undefined
    if (kept) return toRow(kept)
    const fresh = this.db.prepare(`${SELECT} WHERE i.channel_id = ? AND i.status = 'new' AND i.video_id IS NULL ORDER BY i.created_at DESC, i.id DESC LIMIT 1`).get(channelId) as IdeaDbRow | undefined
    return fresh ? toRow(fresh) : null
  }
}
