// The channel voices in SQLite (migration 030): the voice rows and their clones per engine. Plain reads and writes; the
// rules (consent, statuses, the default voice) live in service.ts.
import type { ChannelVoiceView, Consent } from '../../../shared/channel-voices'
import type { Db } from '../../db'

interface VoiceRow {
  id: number
  channel_id: number
  name: string
  method: ChannelVoiceView['method']
  source: ChannelVoiceView['source']
  description: string
  language: string
  sample_path: string | null
  consent_json: string | null
  status: ChannelVoiceView['status']
  is_default: number
}

export interface NewVoice {
  channelId: number
  name: string
  method: ChannelVoiceView['method']
  source: ChannelVoiceView['source']
  description?: string
  language: string
  consent: Consent | null
  status: 'proposed' | 'active'
}

export class ChannelVoiceStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date
  ) {}

  private iso(): string {
    return this.now().toISOString()
  }

  insert(v: NewVoice): number {
    const at = this.iso()
    const r = this.db
      .prepare(
        `INSERT INTO channel_voices (channel_id, name, method, source, description, language, consent_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.channelId, v.name, v.method, v.source, v.description ?? '', v.language, v.consent ? JSON.stringify(v.consent) : null, v.status, at, at)
    return Number(r.lastInsertRowid)
  }

  setSample(id: number, file: string): void {
    this.db.prepare('UPDATE channel_voices SET sample_path = ?, updated_at = ? WHERE id = ?').run(file, this.iso(), id)
  }

  setStatus(id: number, status: ChannelVoiceView['status']): void {
    this.db.prepare('UPDATE channel_voices SET status = ?, is_default = CASE WHEN ? = \'retired\' THEN 0 ELSE is_default END, updated_at = ? WHERE id = ?').run(status, status, this.iso(), id)
  }

  /** The channel's default voice becomes `id` (and only it). */
  setDefault(channelId: number, id: number): void {
    this.db.prepare('UPDATE channel_voices SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ? WHERE channel_id = ?').run(id, this.iso(), channelId)
  }

  addClone(id: number, engine: string, voiceId: string, demo: boolean): void {
    this.db
      .prepare(
        `INSERT INTO channel_voice_clones (voice_id, engine, provider_voice_id, demo, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (voice_id, engine) DO UPDATE SET provider_voice_id = excluded.provider_voice_id, demo = excluded.demo`
      )
      .run(id, engine, voiceId, demo ? 1 : 0, this.iso())
  }

  /** The stored sample's path, if any. */
  sampleOf(id: number): string | null {
    return (this.db.prepare('SELECT sample_path FROM channel_voices WHERE id = ?').get(id) as { sample_path: string | null } | undefined)?.sample_path ?? null
  }

  get(id: number): ChannelVoiceView | null {
    const row = this.db.prepare('SELECT * FROM channel_voices WHERE id = ?').get(id) as VoiceRow | undefined
    return row ? this.view(row) : null
  }

  list(channelId: number): ChannelVoiceView[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM channel_voices WHERE channel_id = ?
         ORDER BY is_default DESC, CASE status WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, id`
      )
      .all(channelId) as unknown as VoiceRow[]
    return rows.map((r) => this.view(r))
  }

  private view(r: VoiceRow): ChannelVoiceView {
    const clones = this.db.prepare('SELECT engine, provider_voice_id, demo FROM channel_voice_clones WHERE voice_id = ? ORDER BY created_at, engine').all(r.id) as {
      engine: string
      provider_voice_id: string
      demo: number
    }[]
    return {
      id: r.id,
      channelId: r.channel_id,
      name: r.name,
      method: r.method,
      source: r.source,
      description: r.description,
      language: r.language,
      status: r.status,
      isDefault: r.is_default === 1,
      hasSample: r.sample_path !== null,
      consent: r.consent_json ? (JSON.parse(r.consent_json) as Consent) : null,
      clones: clones.map((c) => ({ engine: c.engine, voiceId: c.provider_voice_id, demo: c.demo === 1 }))
    }
  }
}
