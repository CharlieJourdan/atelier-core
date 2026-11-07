// One interface for sending an e-mail. The fake keeps messages in the Cloud's own database (dev, tests, `mail list`);
// the real one is Resend over HTTPS (resend.ts), built only when the configuration asks for it and its key is in the vault.

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
  /** Sent as the provider's idempotency header when it has one, so a retry of the same message is not delivered twice. */
  idempotencyKey?: string
}

export interface Mailer {
  readonly kind: 'fake' | 'resend'
  send(message: MailMessage): Promise<{ id: string }>
}

/** A refusal or failure of a mailer. The text never holds a key or a message body. */
export class MailError extends Error {}

/** A header value or address must not hold a line break (header injection). */
export function assertSingleLine(label: string, value: string): void {
  if (/[\r\n\0]/.test(value)) throw new MailError(`${label} holds a line break`)
}
