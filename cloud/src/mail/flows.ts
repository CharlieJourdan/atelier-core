// The account e-mails: confirming an address (sent at sign-up, resent on demand) and forgetting a password.
//  - verification: a single-use link (24 h); until it is used the account can sign in and browse but not pay or start paid
//    work (Accounts.requireVerified, checked by the billing and job routes);
//  - password reset: always answers the same whether the address has an account or not; a link (1 h, single use) sets a new
//    password, confirms the address (the person just proved they read that mailbox) and signs every device out.
// Both are rate-limited in memory: per account / address and per IP.
import type { Accounts } from '../accounts.ts'
import type { Audit } from '../audit.ts'
import type { Auth } from '../auth.ts'
import { HOUR_MS, type Clock } from '../clock.ts'
import { tx, type CloudDb } from '../db/index.ts'
import { CloudError } from '../errors.ts'
import { HitLimiter } from './limits.ts'
import type { MailService } from './service.ts'
import type { MailLang } from './templates.ts'
import type { EmailTokens } from './tokens.ts'

/** The pages of the website the links of the e-mails open (web/src/App.tsx routes them). */
export const VERIFY_PATH = '/verifier'
export const RESET_PATH = '/nouveau-mot-de-passe'

/** Resending the confirmation: 3 per account every 15 minutes, 20 per IP an hour. */
export const RESEND_LIMIT = { accountMs: 15 * 60_000, perAccount: 3, ipMs: HOUR_MS, perIp: 20 }
/** « Mot de passe oublié »: 3 per address and 10 per IP an hour. */
export const RESET_LIMIT = { addressMs: HOUR_MS, perAddress: 3, ipMs: HOUR_MS, perIp: 10 }

export interface FlowsOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  accounts: Accounts
  auth: Auth
  tokens: EmailTokens
  mail: MailService
  /** An address was just confirmed (by the link, or by a password reset): e.g. create the computers of a plan paid before. */
  onVerified?: (accountId: string) => void
}

const BAD_LINK = 'this link is invalid, expired or already used'

export class EmailFlows {
  private readonly o: FlowsOptions
  private readonly resendByAccount: HitLimiter
  private readonly resendByIp: HitLimiter
  private readonly forgotByAddress: HitLimiter
  private readonly forgotByIp: HitLimiter
  constructor(o: FlowsOptions) {
    this.o = o
    this.resendByAccount = new HitLimiter(o.clock, RESEND_LIMIT.accountMs, RESEND_LIMIT.perAccount)
    this.resendByIp = new HitLimiter(o.clock, RESEND_LIMIT.ipMs, RESEND_LIMIT.perIp)
    this.forgotByAddress = new HitLimiter(o.clock, RESET_LIMIT.addressMs, RESET_LIMIT.perAddress)
    this.forgotByIp = new HitLimiter(o.clock, RESET_LIMIT.ipMs, RESET_LIMIT.perIp)
  }

  /** Issues a link and queues the verification e-mail (nothing for an account that is already verified). */
  sendVerification(accountId: string): void {
    const account = this.o.accounts.account(accountId)
    if (account.emailVerified) return
    const token = this.o.tokens.issue(account.id, 'verify')
    this.o.mail.deliver({
      to: account.email,
      lang: this.o.accounts.langOf(account.id),
      template: { kind: 'verify', name: account.name, link: this.o.mail.link(VERIFY_PATH, { token }) },
      accountId: account.id
    })
  }

  /** « Renvoyer l'e-mail » on the site's banner. */
  resend(accountId: string, ip: string): { ok: true; alreadyVerified: boolean } {
    this.resendByIp.hit(`ip:${ip}`, 'too many requests: try again in an hour')
    // a confirmed address has nothing to resend and is not counted against the per-account pause
    if (this.o.accounts.account(accountId).emailVerified) return { ok: true, alreadyVerified: true }
    this.resendByAccount.hit(`acc:${accountId}`, 'a confirmation e-mail was just sent: try again in a few minutes')
    this.sendVerification(accountId)
    this.o.audit.record(accountId, 'auth.verify_resend', accountId)
    return { ok: true, alreadyVerified: false }
  }

  /** The verification link: spends the token and confirms the address, together or not at all. */
  verify(token: string): void {
    const accountId = tx(this.o.db, () => {
      const id = this.o.tokens.consume(token, 'verify')
      if (!id) return null
      this.o.accounts.markVerified(id)
      return id
    })
    if (!accountId) throw new CloudError('gone', BAD_LINK)
    this.o.audit.record(accountId, 'auth.email_verified', accountId)
    this.afterVerified(accountId)
  }

  /**
   * « Mot de passe oublié »: the same answer (nothing) for an address with an account and one without. Both counters
   * count the address as typed, existing or not, so a refusal for rate reveals nothing either. The e-mail is queued,
   * not awaited, so the answer does not come faster or slower for an unknown address.
   */
  forgotPassword(p: { email: string; lang?: MailLang | undefined; ip: string }): void {
    this.forgotByIp.hit(`ip:${p.ip}`, 'too many requests: try again in an hour')
    this.forgotByAddress.hit(`addr:${p.email.trim().toLowerCase()}`, 'too many requests for this address: try again in an hour')
    const account = this.o.accounts.accountByEmail(p.email)
    if (!account) return
    const token = this.o.tokens.issue(account.id, 'reset')
    this.o.mail.deliver({
      to: account.email,
      lang: p.lang ?? this.o.accounts.langOf(account.id),
      template: { kind: 'reset', name: account.name, link: this.o.mail.link(RESET_PATH, { token }) },
      accountId: account.id
    })
    this.o.audit.record(account.id, 'auth.reset_requested', account.id)
  }

  /** The reset link and the new password: spends the token, sets the password, confirms the address and signs every device out. */
  resetPassword(token: string, password: string): void {
    const done = tx(this.o.db, () => {
      const id = this.o.tokens.consume(token, 'reset')
      if (!id) return null
      this.o.accounts.setPassword(id, password)
      const newlyVerified = this.o.accounts.markVerified(id)
      const devices = this.o.auth.revokeAllDevices(id)
      return { id, newlyVerified, devices }
    })
    if (!done) throw new CloudError('gone', BAD_LINK)
    this.o.auth.clearFailures(this.o.accounts.account(done.id).email)
    this.o.audit.record(done.id, 'auth.password_reset', done.id, { devicesRevoked: done.devices })
    if (done.newlyVerified) this.afterVerified(done.id)
  }

  private afterVerified(accountId: string): void {
    try {
      this.o.onVerified?.(accountId)
    } catch {
      // a follow-up of the verification (creating computers) must not fail the verification itself
    }
  }
}
