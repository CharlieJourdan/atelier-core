// The audit log (§4.11): logins, device revocations, price changes, credit grants and adjustments, vault writes and
// every vault read by an adapter, and the founder console's CRM actions (verify an address, disable / enable an account,
// revoke its sessions). Details never hold a secret value; `maskSecrets` is applied to every detail string.
import type { CloudDb } from './db/index.ts'
import { iso, type Clock } from './clock.ts'

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.refresh_reuse'
  | 'device.revoke'
  | 'account.create'
  | 'member.add'
  | 'member.caps'
  | 'price.grid'
  | 'spend.unusual'
  | 'wallet.grant'
  | 'wallet.adjust'
  | 'vault.set'
  | 'vault.delete'
  | 'vault.read'
  | 'provider.try'
  | 'machine.create'
  | 'machine.hibernate'
  | 'machine.resume'
  | 'machine.delete'
  | 'machine.enrol'
  | 'machine.enrol_token'
  | 'machine.credential_revoke'
  | 'billing.event'
  | 'billing.autorecharge'
  | 'billing.hook_failed'
  | 'blueprint.publish'
  | 'kit.publish'
  | 'kit.expire'
  | 'backup.add'
  | 'backup.expire'
  | 'auth.email_verified'
  | 'auth.verify_resend'
  | 'auth.reset_requested'
  | 'auth.password_reset'
  | 'mail.sent'
  | 'mail.failed'
  | 'release.create'
  | 'release.publish'
  | 'release.withdraw'
  | 'release.delete'
  | 'auth.cli_token'
  | 'auth.test_brain'
  | 'test_team.create'
  | 'test_team.key'
  | 'test_team.revoke'
  | 'invite.create'
  | 'invite.revoke'
  | 'invite.accept'
  | 'admin.verify_email'
  | 'admin.account_disable'
  | 'admin.account_enable'
  | 'admin.revoke_sessions'
  | 'finance.multiplier'
  | 'finance.fx'
  | 'finance.fixed_cost'
  | 'finance.fixed_cost_removed'

export interface AuditEntry {
  id: number
  at: string
  actor: string
  action: string
  target: string | null
  detail: Record<string, unknown> | null
}

export class Audit {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly mask: (s: string) => string
  constructor(db: CloudDb, clock: Clock, mask: (s: string) => string = (s) => s) {
    this.db = db
    this.clock = clock
    this.mask = mask
  }

  record(actor: string, action: AuditAction, target: string | null, detail?: Record<string, unknown>): void {
    const json = detail === undefined ? null : this.mask(JSON.stringify(detail))
    this.db
      .prepare('INSERT INTO audit_log (at, actor, action, target, detail_json) VALUES (?, ?, ?, ?, ?)')
      .run(iso(this.clock.now()), actor, action, target, json)
  }

  list(limit = 200): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT id, at, actor, action, target, detail_json FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; at: string; actor: string; action: string; target: string | null; detail_json: string | null }[]
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: r.detail_json === null ? null : (JSON.parse(r.detail_json) as Record<string, unknown>)
    }))
  }
}
