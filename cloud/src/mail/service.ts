// Sends the Cloud's e-mails. A message is rendered from a template in the recipient's language, claimed in `mail_sent`
// when it has a dedupe key (so one event reaches one recipient once, even if the event is replayed), then handed to the
// mailer in the background: the caller never waits for the mail provider and a mail failure never fails a request or a
// payment event. It is audited (without the address or the text) and, for a keyed message, the claim is released so a
// deliberate retry can send it. Mail is sent after a database transaction commits, never inside one.
import type { Audit } from '../audit.ts'
import { iso, type Clock } from '../clock.ts'
import type { CloudDb } from '../db/index.ts'
import { render, type MailLang, type Template } from './templates.ts'
import type { Mailer } from './types.ts'

export interface MailOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  mailer: Mailer
  /** The website's address (no trailing slash): the links of the e-mails point there. */
  siteUrl: string
}

export interface Delivery {
  to: string
  lang: MailLang
  template: Template
  /** One message per key: a second delivery with the same key does nothing. */
  dedupeKey?: string
  accountId?: string
}

export class MailService {
  private readonly o: MailOptions
  private readonly pending = new Set<Promise<void>>()
  readonly siteUrl: string
  constructor(o: MailOptions) {
    this.o = o
    this.siteUrl = o.siteUrl.replace(/\/+$/, '')
  }

  get kind(): Mailer['kind'] {
    return this.o.mailer.kind
  }

  /** A page of the website as a full address. */
  link(path: string, query?: Record<string, string>): string {
    const q = query ? `?${new URLSearchParams(query).toString()}` : ''
    return `${this.siteUrl}${path}${q}`
  }

  /** Queues one message. Returns false when its dedupe key was already used (nothing is sent). */
  deliver(d: Delivery): boolean {
    if (this.o.db.isTransaction) throw new Error('an e-mail is sent after the transaction commits, never inside it')
    if (d.dedupeKey) {
      const claim = this.o.db
        .prepare('INSERT OR IGNORE INTO mail_sent (dedupe_key, kind, account_id, created_at) VALUES (?, ?, ?, ?)')
        .run(d.dedupeKey, d.template.kind, d.accountId ?? null, iso(this.o.clock.now()))
      if (claim.changes === 0) return false
    }
    const p = this.send(d).finally(() => this.pending.delete(p))
    this.pending.add(p)
    return true
  }

  /** Resolves once every queued message has been handed to the mailer (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  private async send(d: Delivery): Promise<void> {
    try {
      const msg = render(d.template, d.lang)
      await this.o.mailer.send({ to: d.to, ...msg, ...(d.dedupeKey ? { idempotencyKey: d.dedupeKey } : {}) })
    } catch (err) {
      if (d.dedupeKey) this.o.db.prepare('DELETE FROM mail_sent WHERE dedupe_key = ?').run(d.dedupeKey)
      this.note('mail.failed', d, (err instanceof Error ? err.message : String(err)).slice(0, 200))
      return
    }
    this.note('mail.sent', d)
  }

  /** The audit log must not turn a mail failure (or a success) into an unhandled rejection. */
  private note(action: 'mail.sent' | 'mail.failed', d: Delivery, error?: string): void {
    try {
      this.o.audit.record('mail', action, d.accountId ?? 'unknown', { kind: d.template.kind, ...(error ? { error } : {}) })
    } catch {
      // nothing more to do
    }
  }
}
