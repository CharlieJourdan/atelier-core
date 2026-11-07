// The channel presenters in SQLite (migration 032). Plain reads and writes; the rules (consent, statuses, the default
// presenter, the similarity check) live in service.ts. Paths stay here (main): the renderer's view is built by the service.
import type { PresenterConsent } from '../../../shared/channel-presenters'
import type { Framing } from '../../../shared/presenter-engines'
import type { Db } from '../../db'

export type PresenterStatus = 'proposed' | 'active' | 'retired'

/** An angle that passed the check: its framing, its file and the score that let it in. */
export interface StoredAngle {
  framing: Framing
  path: string
  score: number
}

export interface PresenterRecord {
  id: number
  channelId: number
  name: string
  method: 'portrait' | 'clone'
  description: string
  portraitPath: string | null
  angles: StoredAngle[]
  registrations: Record<string, string>
  voiceId: number | null
  consent: PresenterConsent | null
  status: PresenterStatus
  isDefault: boolean
}

interface Row {
  id: number
  channel_id: number
  name: string
  method: PresenterRecord['method']
  description: string
  portrait_path: string | null
  angles_json: string
  registrations_json: string
  voice_id: number | null
  consent_json: string | null
  status: PresenterStatus
  is_default: number
}

export interface NewPresenter {
  channelId: number
  name: string
  method: PresenterRecord['method']
  description: string
  consent: PresenterConsent | null
  status: 'proposed' | 'active'
}

export class ChannelPresenterStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date
  ) {}

  private iso(): string {
    return this.now().toISOString()
  }

  insert(p: NewPresenter): number {
    const at = this.iso()
    const r = this.db
      .prepare(
        `INSERT INTO channel_presenters (channel_id, name, method, description, consent_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(p.channelId, p.name, p.method, p.description, p.consent ? JSON.stringify(p.consent) : null, p.status, at, at)
    return Number(r.lastInsertRowid)
  }

  /** A presenter whose making failed leaves no row behind. */
  remove(id: number): void {
    this.db.prepare('DELETE FROM channel_presenters WHERE id = ?').run(id)
  }

  setPortrait(id: number, file: string): void {
    this.db.prepare('UPDATE channel_presenters SET portrait_path = ?, updated_at = ? WHERE id = ?').run(file, this.iso(), id)
  }

  setAngles(id: number, angles: StoredAngle[]): void {
    this.db.prepare('UPDATE channel_presenters SET angles_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(angles), this.iso(), id)
  }

  setRegistrations(id: number, registrations: Record<string, string>): void {
    this.db.prepare('UPDATE channel_presenters SET registrations_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(registrations), this.iso(), id)
  }

  setVoice(id: number, voiceId: number | null): void {
    this.db.prepare('UPDATE channel_presenters SET voice_id = ?, updated_at = ? WHERE id = ?').run(voiceId, this.iso(), id)
  }

  setStatus(id: number, status: PresenterStatus): void {
    this.db
      .prepare("UPDATE channel_presenters SET status = ?, is_default = CASE WHEN ? = 'retired' THEN 0 ELSE is_default END, updated_at = ? WHERE id = ?")
      .run(status, status, this.iso(), id)
  }

  /** The channel's default presenter becomes `id` (and only it). */
  setDefault(channelId: number, id: number): void {
    this.db.prepare('UPDATE channel_presenters SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ? WHERE channel_id = ?').run(id, this.iso(), channelId)
  }

  /** Whether `voiceId` is a voice of this channel. */
  voiceBelongsTo(channelId: number, voiceId: number): boolean {
    return this.db.prepare('SELECT 1 FROM channel_voices WHERE id = ? AND channel_id = ?').get(voiceId, channelId) !== undefined
  }

  get(id: number): PresenterRecord | null {
    const row = this.db.prepare('SELECT * FROM channel_presenters WHERE id = ?').get(id) as Row | undefined
    return row ? record(row) : null
  }

  list(channelId: number): PresenterRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM channel_presenters WHERE channel_id = ?
         ORDER BY is_default DESC, CASE status WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, id`
      )
      .all(channelId) as unknown as Row[]
    return rows.map(record)
  }
}

function record(r: Row): PresenterRecord {
  return {
    id: r.id,
    channelId: r.channel_id,
    name: r.name,
    method: r.method,
    description: r.description,
    portraitPath: r.portrait_path,
    angles: JSON.parse(r.angles_json) as StoredAngle[],
    registrations: JSON.parse(r.registrations_json) as Record<string, string>,
    voiceId: r.voice_id,
    consent: r.consent_json ? (JSON.parse(r.consent_json) as PresenterConsent) : null,
    status: r.status,
    isDefault: r.is_default === 1
  }
}
