// The pipeline library (Production › Pipelines): named pipelines with numbered versions, one optional channel and a
// "default for this channel" flag. Only a document that passes validation is ever stored.
import type { Db } from '../db'
import { nowIso, transaction } from '../db'
import { PIPELINE_ORIGINS, type DiffLine, type LibraryPipelineDetail, type LibraryPipelineRow, type PipelineOrigin, type PipelineProblem } from '../../shared/analysis'
import { lineDiff } from '../../shared/line-diff'
import { checkPipeline } from './catalog'

interface Row {
  id: number
  name: string
  description: string
  origin: PipelineOrigin
  channel_id: number | null
  channel_name: string | null
  default_for_channel: number
  latest: number | null
  example: number
  updated_at: string
}

const SELECT = `SELECT p.id, p.name, p.description, p.origin, p.channel_id, c.name AS channel_name, p.default_for_channel,
  (SELECT MAX(number) FROM library_pipeline_versions v WHERE v.pipeline_id = p.id) AS latest, p.example, p.updated_at
  FROM library_pipelines p LEFT JOIN channels c ON c.id = p.channel_id`

const toRow = (r: Row): LibraryPipelineRow => ({
  id: r.id,
  name: r.name,
  description: r.description,
  origin: r.origin,
  channelId: r.channel_id,
  channelName: r.channel_name,
  isDefault: r.default_for_channel === 1,
  latestVersion: r.latest ?? 0,
  example: r.example === 1,
  updatedAt: r.updated_at
})

/** Thrown when a document fails validation: carries the problems for the renderer. */
export class PipelineInvalidError extends Error {
  constructor(readonly problems: PipelineProblem[]) {
    super('Ce pipeline n’est pas valide : il n’a pas été enregistré.')
  }
}

/** A transaction, or the caller's one when already inside (the example seeder loads inside its own). */
export function tx<T>(db: Db, fn: () => T): T {
  return db.isTransaction ? fn() : transaction(db, fn)
}

export const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

export function cleanText(v: unknown, label: string, max: number, required = true): string {
  if (typeof v !== 'string') throw new Error(`${label} : texte attendu.`)
  const s = v.trim()
  if (required && s === '') throw new Error(`${label} : ce champ est obligatoire.`)
  if (s.length > max) throw new Error(`${label} : ${max} caractères au plus.`)
  return s
}

export class PipelineLibrary {
  constructor(private readonly db: Db) {}

  list(): LibraryPipelineRow[] {
    return (this.db.prepare(`${SELECT} ORDER BY p.updated_at DESC, p.id DESC`).all() as unknown as Row[]).map(toRow)
  }

  row(id: number): LibraryPipelineRow {
    if (!isId(id)) throw new Error('Pipeline inconnu.')
    const r = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as unknown as Row | undefined
    if (!r) throw new Error('Pipeline inconnu.')
    return toRow(r)
  }

  get(id: number): LibraryPipelineDetail {
    const row = this.row(id)
    const versions = this.db
      .prepare('SELECT number, note, created_at FROM library_pipeline_versions WHERE pipeline_id = ? ORDER BY number DESC')
      .all(id) as { number: number; note: string; created_at: string }[]
    return { ...row, versions: versions.map((v) => ({ number: v.number, note: v.note, createdAt: v.created_at })), json: this.versionJson(id, row.latestVersion) }
  }

  versionJson(id: number, number: number): string {
    if (!isId(id) || !isId(number)) throw new Error('Version inconnue.')
    const r = this.db.prepare('SELECT json FROM library_pipeline_versions WHERE pipeline_id = ? AND number = ?').get(id, number) as { json: string } | undefined
    if (!r) throw new Error('Version inconnue.')
    return r.json
  }

  diff(id: number, a: number, b: number): DiffLine[] {
    return lineDiff(this.versionJson(id, a), this.versionJson(id, b))
  }

  /** Creates a pipeline with its version 1. The document is validated first. */
  create(input: { name: string; description?: string; origin: PipelineOrigin; channelId?: number | null; json: string; note?: string; example?: boolean }): LibraryPipelineRow {
    const name = cleanText(input.name, 'Nom', 120)
    const description = cleanText(input.description ?? '', 'Description', 600, false)
    if (!PIPELINE_ORIGINS.includes(input.origin)) throw new Error('Origine inconnue.')
    const channelId = input.channelId ?? null
    if (channelId !== null) this.assertChannel(channelId)
    const check = checkPipeline(input.json)
    if (!check.ok) throw new PipelineInvalidError(check.problems)
    const at = nowIso()
    const id = tx(this.db, () => {
      const pid = Number(
        this.db
          .prepare('INSERT INTO library_pipelines (name, description, origin, channel_id, example, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(name, description, input.origin, channelId, input.example ? 1 : 0, at, at).lastInsertRowid
      )
      this.db
        .prepare('INSERT INTO library_pipeline_versions (pipeline_id, number, json, note, created_at) VALUES (?, 1, ?, ?, ?)')
        .run(pid, check.json, cleanText(input.note ?? '', 'Note', 300, false), at)
      return pid
    })
    return this.row(id)
  }

  /** Adds the next version. Refused when invalid or identical to the latest. */
  addVersion(id: number, json: string, note: string): LibraryPipelineRow {
    const row = this.row(id)
    const check = checkPipeline(json)
    if (!check.ok) throw new PipelineInvalidError(check.problems)
    if (row.latestVersion > 0 && this.versionJson(id, row.latestVersion) === check.json) throw new Error('Rien n’a changé depuis la dernière version.')
    const at = nowIso()
    tx(this.db, () => {
      this.db
        .prepare('INSERT INTO library_pipeline_versions (pipeline_id, number, json, note, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, row.latestVersion + 1, check.json, cleanText(note, 'Note', 300, false), at)
      this.db.prepare('UPDATE library_pipelines SET updated_at = ? WHERE id = ?').run(at, id)
    })
    return this.row(id)
  }

  /** Attaches the pipeline to a channel and makes it that channel's default (the previous default stays attached). */
  setDefault(id: number, channelId: number): LibraryPipelineRow {
    this.row(id)
    this.assertChannel(channelId)
    tx(this.db, () => {
      this.db.prepare('UPDATE library_pipelines SET default_for_channel = 0 WHERE channel_id = ?').run(channelId)
      this.db.prepare('UPDATE library_pipelines SET channel_id = ?, default_for_channel = 1, updated_at = ? WHERE id = ?').run(channelId, nowIso(), id)
    })
    return this.row(id)
  }

  defaultFor(channelId: number): number | null {
    const r = this.db.prepare('SELECT id FROM library_pipelines WHERE channel_id = ? AND default_for_channel = 1').get(channelId) as { id: number } | undefined
    return r?.id ?? null
  }

  rename(id: number, name: string, description: string): LibraryPipelineRow {
    this.row(id)
    this.db
      .prepare('UPDATE library_pipelines SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(cleanText(name, 'Nom', 120), cleanText(description, 'Description', 600, false), nowIso(), id)
    return this.row(id)
  }

  delete(id: number): void {
    this.row(id)
    this.db.prepare('DELETE FROM library_pipelines WHERE id = ?').run(id)
  }

  private assertChannel(channelId: number): void {
    if (!isId(channelId)) throw new Error('Chaîne inconnue.')
    const r = this.db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId)
    if (!r) throw new Error('Chaîne inconnue.')
  }
}
