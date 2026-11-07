// Channel style sheets (`atelier.style/1`, PLAN-V2-PRODUCTION §3), versioned per channel like pipelines.
import type { Db } from '../db'
import { nowIso } from '../db'
import { StyleSheetSchema, type ChannelStyleDetail, type DiffLine, type StyleSheet } from '../../shared/analysis'
import { lineDiff } from '../../shared/line-diff'
import { cleanText, isId } from './library'

export class StyleStore {
  constructor(private readonly db: Db) {}

  detail(channelId: number, defaultPipelineId: number | null): ChannelStyleDetail {
    this.assertChannel(channelId)
    const rows = this.db
      .prepare('SELECT version, note, example, created_at FROM channel_style_sheets WHERE channel_id = ? ORDER BY version DESC')
      .all(channelId) as { version: number; note: string; example: number; created_at: string }[]
    const latest = rows[0]?.version ?? null
    return {
      channelId,
      versions: rows.map((r) => ({ version: r.version, note: r.note, createdAt: r.created_at, example: r.example === 1 })),
      current: latest === null ? null : this.version(channelId, latest),
      currentVersion: latest,
      defaultPipelineId
    }
  }

  version(channelId: number, version: number): StyleSheet {
    if (!isId(channelId) || !isId(version)) throw new Error('Version de style inconnue.')
    const r = this.db.prepare('SELECT json FROM channel_style_sheets WHERE channel_id = ? AND version = ?').get(channelId, version) as { json: string } | undefined
    if (!r) throw new Error('Version de style inconnue.')
    return JSON.parse(r.json) as StyleSheet
  }

  /** Validates and stores the next version; returns its number. Refused when nothing changed. */
  save(channelId: number, sheet: unknown, note: string, example = false): number {
    this.assertChannel(channelId)
    const parsed = StyleSheetSchema.safeParse(sheet)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      throw new Error(`Style invalide (${first ? first.path.join('.') : '?'}) : vérifie les valeurs du formulaire.`)
    }
    const json = JSON.stringify(parsed.data, null, 2)
    const last = this.db.prepare('SELECT version, json FROM channel_style_sheets WHERE channel_id = ? ORDER BY version DESC LIMIT 1').get(channelId) as
      | { version: number; json: string }
      | undefined
    if (last && last.json === json) throw new Error('Rien n’a changé depuis la dernière version du style.')
    const version = (last?.version ?? 0) + 1
    this.db
      .prepare('INSERT INTO channel_style_sheets (channel_id, version, json, note, example, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(channelId, version, json, cleanText(note, 'Note', 300, false), example ? 1 : 0, nowIso())
    return version
  }

  diff(channelId: number, a: number, b: number): DiffLine[] {
    return lineDiff(JSON.stringify(this.version(channelId, a), null, 2), JSON.stringify(this.version(channelId, b), null, 2))
  }

  private assertChannel(channelId: number): void {
    if (!isId(channelId) || !this.db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId)) throw new Error('Chaîne inconnue.')
  }
}
