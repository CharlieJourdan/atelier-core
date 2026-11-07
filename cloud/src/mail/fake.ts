// The fake mailer: nothing leaves the machine; each message is a row of `mail_outbox` so the dev Cloud (another process
// than the admin tool) can show it: `npm run cloud -- mail list`.
import type { Clock } from '../clock.ts'
import { iso } from '../clock.ts'
import type { CloudDb } from '../db/index.ts'
import { newId } from '../ids.ts'
import { assertSingleLine, type MailMessage, type Mailer } from './types.ts'

export interface OutboxRow {
  id: string
  to: string
  subject: string
  text: string
  html: string
  createdAt: string
}

interface Row {
  id: string
  to_addr: string
  subject: string
  text_body: string
  html_body: string
  created_at: string
}

const toRow = (r: Row): OutboxRow => ({ id: r.id, to: r.to_addr, subject: r.subject, text: r.text_body, html: r.html_body, createdAt: r.created_at })

export class FakeMailer implements Mailer {
  readonly kind = 'fake' as const
  private readonly db: CloudDb
  private readonly clock: Clock
  constructor(db: CloudDb, clock: Clock) {
    this.db = db
    this.clock = clock
  }

  async send(m: MailMessage): Promise<{ id: string }> {
    assertSingleLine('recipient', m.to)
    assertSingleLine('subject', m.subject)
    const id = newId('mail')
    this.db
      .prepare('INSERT INTO mail_outbox (id, to_addr, subject, text_body, html_body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, m.to, m.subject, m.text, m.html, iso(this.clock.now()))
    return { id }
  }

  /** Newest first. */
  list(o: { to?: string; limit?: number } = {}): OutboxRow[] {
    const limit = Math.min(Math.max(o.limit ?? 20, 1), 500)
    const rows = (
      o.to
        ? this.db.prepare('SELECT * FROM mail_outbox WHERE to_addr = ? COLLATE NOCASE ORDER BY created_at DESC, rowid DESC LIMIT ?').all(o.to, limit)
        : this.db.prepare('SELECT * FROM mail_outbox ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit)
    ) as unknown as Row[]
    return rows.map(toRow)
  }

  get(id: string): OutboxRow | null {
    const r = this.db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id) as Row | undefined
    return r ? toRow(r) : null
  }
}
