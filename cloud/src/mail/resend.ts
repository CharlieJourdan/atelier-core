// The real mailer: Resend's HTTPS API (POST https://api.resend.com/emails). The key comes from the vault (RESEND_API_KEY)
// and only ever goes into the Authorization header: it is not in any error text. No tracking, no attachments.
import { assertSingleLine, MailError, type MailMessage, type Mailer } from './types.ts'

export const RESEND_URL = 'https://api.resend.com/emails'

export interface ResendOptions {
  apiKey: string
  /** `Atelier <bonjour@example.com>`: a sender on a domain verified in Resend. */
  from: string
  fetchImpl?: typeof fetch
  url?: string
  timeoutMs?: number
}

export class ResendMailer implements Mailer {
  readonly kind = 'resend' as const
  private readonly o: ResendOptions
  constructor(o: ResendOptions) {
    assertSingleLine('sender', o.from)
    if (!o.apiKey) throw new MailError('the Resend key is empty')
    this.o = o
  }

  async send(m: MailMessage): Promise<{ id: string }> {
    assertSingleLine('recipient', m.to)
    assertSingleLine('subject', m.subject)
    const f = this.o.fetchImpl ?? fetch
    let res: Response
    try {
      res = await f(this.o.url ?? RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.o.apiKey}`,
          'content-type': 'application/json',
          ...(m.idempotencyKey ? { 'idempotency-key': m.idempotencyKey.slice(0, 256) } : {})
        },
        body: JSON.stringify({ from: this.o.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000)
      })
    } catch {
      throw new MailError('Resend could not be reached')
    }
    const body = (await res.json().catch(() => ({}))) as { id?: unknown; name?: unknown }
    if (!res.ok) {
      const name = typeof body.name === 'string' && /^[a-z_]{1,60}$/.test(body.name) ? ` (${body.name})` : ''
      throw new MailError(`Resend refused the message: HTTP ${res.status}${name}`)
    }
    if (typeof body.id !== 'string' || !body.id) throw new MailError('Resend answered without a message id')
    return { id: body.id }
  }
}
