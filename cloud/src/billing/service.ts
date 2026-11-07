// Billing (PLAN-COMPLEXITE §E.2–E.3): a team subscribes to a plan or buys a credit pack through a checkout; the
// verified payment event grants the credits (once: events are idempotent), records the subscription and tells the
// rest of the Cloud (its team computers are created; a cancelled plan hibernates them). The automatic top-up charges
// the saved card for a pack when the available credits fall under the team's threshold, never past its monthly cap.
import type { Audit } from '../audit.ts'
import type { Clock } from '../clock.ts'
import { tx, type CloudDb } from '../db/index.ts'
import { CloudError } from '../errors.ts'
import { isPlanId, type PlanId } from '../machines/plans.ts'
import type { Wallet } from '../wallet.ts'
import { PACKS, PLANS, isPackId, isPeriod, periodCredits, planPrice, type BillingPeriod, type PackId } from './catalog.ts'
import type { CheckoutKind, PaymentEvent, PaymentProvider } from './payments.ts'

export type CheckoutRequest = { kind: 'subscription'; plan: PlanId; period: BillingPeriod } | { kind: 'pack'; pack: PackId }

export interface Subscription {
  plan: PlanId
  period: BillingPeriod
  status: 'active' | 'past_due' | 'canceled'
  since: string
}

export interface AutoRecharge {
  enabled: boolean
  /** Top up when the available credits fall under this. */
  thresholdCredits: number
  pack: PackId
  /** At most this much charged by top-ups in a calendar month (euro cents). */
  monthlyCapCents: number
  /** Charged by top-ups this month. */
  spentThisMonthCents: number
}

export interface BillingStatus {
  provider: 'stripe' | 'fake'
  subscription: Subscription | null
  autoRecharge: AutoRecharge
  /** A saved card exists (a pack or a plan was paid once), so the top-up can charge it. */
  cardOnFile: boolean
}

export interface BillingOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  wallet: Wallet
  payments: PaymentProvider
  /** A plan was paid: create the team's computers. Errors are recorded, never thrown back at the payment. */
  onSubscribed?: (teamId: string, plan: PlanId) => Promise<void>
  /** A plan ended: hibernate them. */
  onCanceled?: (teamId: string) => Promise<void>
  /** Something the team should be told by e-mail. Called after the event's transaction committed, never inside it, and
   *  at most once per event (a replayed event is dropped before it gets here). Errors are swallowed. */
  notify?: (notice: BillingNotice) => void
}

/** What a payment event or a top-up means for the people who pay; `key` is unique per event (the mailer sends it once). */
export type BillingNotice =
  | { type: 'receipt'; key: string; teamId: string; item: 'plan' | 'renewal' | 'pack' | 'topup'; plan?: PlanId; period?: BillingPeriod; credits: number; cents: number }
  | { type: 'payment_failed'; key: string; teamId: string; plan: PlanId }
  | { type: 'plan_canceled'; key: string; teamId: string; plan: PlanId }
  | { type: 'topup_failed'; key: string; teamId: string; credits: number; cents: number }

interface AccountRow {
  team_id: string
  customer_ref: string | null
  auto_enabled: number
  auto_threshold: number
  auto_pack: string
  auto_cap_cents: number
  auto_month: string
  auto_spent_cents: number
}

/** The highest monthly cap a team can set on its automatic top-up (2 000 €): more goes through support. */
export const MAX_TOPUP_CAP_CENTS = 200_000

const DEFAULT_AUTO: Omit<AutoRecharge, 'spentThisMonthCents'> = { enabled: false, thresholdCredits: 500, pack: 'pack2k', monthlyCapCents: 10_000 }

export class Billing {
  private readonly o: BillingOptions
  /** Hooks still running (team computers being created or hibernated after a payment event). */
  private readonly pending = new Set<Promise<void>>()
  /** Teams whose automatic top-up is being charged right now (two spends at once must not charge twice). */
  private readonly topping = new Set<string>()
  constructor(o: BillingOptions) {
    this.o = o
  }

  /** Resolves once every hook started by payment events has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  private iso(): string {
    return new Date(this.o.clock.now()).toISOString()
  }
  private month(): string {
    return this.iso().slice(0, 7)
  }

  private account(teamId: string): AccountRow {
    const row = this.o.db.prepare('SELECT * FROM billing_accounts WHERE team_id = ?').get(teamId) as AccountRow | undefined
    if (row) return row
    this.o.db
      .prepare('INSERT INTO billing_accounts (team_id, auto_enabled, auto_threshold, auto_pack, auto_cap_cents, auto_month, auto_spent_cents, updated_at) VALUES (?, 0, ?, ?, ?, ?, 0, ?)')
      .run(teamId, DEFAULT_AUTO.thresholdCredits, DEFAULT_AUTO.pack, DEFAULT_AUTO.monthlyCapCents, this.month(), this.iso())
    return this.account(teamId)
  }

  private team(teamId: string): void {
    if (!this.o.db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) throw new CloudError('not_found', `no team ${teamId}`)
  }

  status(teamId: string): BillingStatus {
    this.team(teamId)
    const a = this.account(teamId)
    const sub = this.o.db.prepare('SELECT plan, period, status, since FROM billing_subscriptions WHERE team_id = ?').get(teamId) as
      | { plan: PlanId; period: BillingPeriod; status: Subscription['status']; since: string }
      | undefined
    return {
      provider: this.o.payments.kind,
      subscription: sub ? { plan: sub.plan, period: sub.period, status: sub.status, since: sub.since } : null,
      autoRecharge: {
        enabled: a.auto_enabled === 1,
        thresholdCredits: a.auto_threshold,
        pack: a.auto_pack as PackId,
        monthlyCapCents: a.auto_cap_cents,
        spentThisMonthCents: a.auto_month === this.month() ? a.auto_spent_cents : 0
      },
      cardOnFile: a.customer_ref !== null
    }
  }

  /** The checkout page of a plan or a pack (Stripe Checkout, or the demo's simulated payment). */
  async checkout(teamId: string, email: string, req: unknown, urls: { successUrl: string; cancelUrl: string }): Promise<{ url: string; sessionId: string }> {
    this.team(teamId)
    const r = req as Partial<CheckoutRequest> | null
    let item: CheckoutKind
    if (r?.kind === 'subscription' && isPlanId(r.plan) && isPeriod(r.period)) {
      item = { kind: 'subscription', plan: r.plan, period: r.period, cents: planPrice(PLANS[r.plan], r.period) }
    } else if (r?.kind === 'pack' && isPackId(r.pack)) {
      item = { kind: 'pack', pack: r.pack, cents: PACKS[r.pack].cents }
    } else throw new CloudError('bad_request', 'checkout: a plan and a period, or a pack')
    if (item.kind === 'subscription') {
      const sub = this.o.db.prepare('SELECT status FROM billing_subscriptions WHERE team_id = ?').get(teamId) as { status: string } | undefined
      // a plan change goes through the running subscription, never a second one (the old one would keep charging)
      if (sub && sub.status !== 'canceled') throw new CloudError('conflict', 'this team already has a plan: change it from the subscription')
    }
    return this.o.payments.createCheckout({ teamId, email, item, ...urls })
  }

  /** A payment provider's webhook: verified, then applied once. */
  async webhook(rawBody: string, signature: string | undefined): Promise<{ applied: boolean; type: PaymentEvent['type'] }> {
    let event: PaymentEvent
    try {
      event = this.o.payments.parseWebhook(rawBody, signature)
    } catch {
      throw new CloudError('forbidden', 'invalid payment signature')
    }
    if (event.type === 'ignored') return { applied: false, type: 'ignored' }
    const e = event
    // the event row and its effects commit together: a failure leaves no trace, so the provider's retry applies it
    const notices: BillingNotice[] = []
    const after = tx(this.o.db, () => {
      const fresh = this.o.db.prepare('INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?, ?, ?)').run(e.id, e.type, this.iso())
      if (fresh.changes === 0) return null
      return { hook: this.apply(e, notices) }
    })
    if (after === null) return { applied: false, type: event.type }
    this.o.audit.record('billing', 'billing.event', event.id, { type: event.type })
    // the team is told once the event is committed (a replayed event never gets here)
    for (const n of notices) this.notify(n)
    // the team computers are created (or hibernated) after the answer: the provider does not wait for them
    if (after.hook) this.later(after.hook.teamId, after.hook.run)
    return { applied: true, type: event.type }
  }

  /** Applies an event's effects (synchronously, inside the transaction); answers the hook to run once committed. */
  private apply(e: Exclude<PaymentEvent, { type: 'ignored' }>, notices: BillingNotice[]): { teamId: string; run: () => Promise<void> | undefined } | undefined {
    const now = this.iso()
    if (e.type === 'checkout.completed') {
      this.team(e.teamId)
      this.account(e.teamId)
      if (e.customerRef) this.o.db.prepare('UPDATE billing_accounts SET customer_ref = ?, updated_at = ? WHERE team_id = ?').run(e.customerRef, now, e.teamId)
      if (e.item.kind === 'pack') {
        const pack = PACKS[e.item.pack as PackId]
        if (!pack) throw new CloudError('bad_request', `unknown pack ${e.item.pack}`)
        this.o.wallet.grant({ teamId: e.teamId, credits: pack.credits, idemKey: `billing:${e.id}`, note: `pack ${pack.id}`, actor: 'billing', funding: 'paid' })
        this.charge(e.teamId, 'pack', pack.cents, e.id)
        notices.push({ type: 'receipt', key: `receipt:${e.id}`, teamId: e.teamId, item: 'pack', credits: pack.credits, cents: pack.cents })
        return undefined
      }
      const plan = e.item.plan
      if (!isPlanId(plan)) throw new CloudError('bad_request', `unknown plan ${plan}`)
      const period = e.item.period
      this.o.db
        .prepare(
          `INSERT INTO billing_subscriptions (team_id, plan, period, status, subscription_ref, since, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET plan = excluded.plan, period = excluded.period, status = 'active', subscription_ref = excluded.subscription_ref, updated_at = excluded.updated_at`
        )
        .run(e.teamId, plan, period, e.subscriptionRef, now, now)
      this.o.wallet.grant({ teamId: e.teamId, credits: periodCredits(PLANS[plan], period), idemKey: `billing:${e.id}`, note: `plan ${plan} (${period})`, actor: 'billing', funding: 'paid' })
      this.charge(e.teamId, 'subscription', e.item.cents, e.id)
      notices.push({ type: 'receipt', key: `receipt:${e.id}`, teamId: e.teamId, item: 'plan', plan, period, credits: periodCredits(PLANS[plan], period), cents: e.item.cents })
      return { teamId: e.teamId, run: () => this.o.onSubscribed?.(e.teamId, plan) }
    }
    const sub = e.subscriptionRef
      ? (this.o.db.prepare('SELECT team_id, plan, period FROM billing_subscriptions WHERE subscription_ref = ?').get(e.subscriptionRef) as { team_id: string; plan: PlanId; period: BillingPeriod } | undefined)
      : undefined
    if (!sub) return undefined
    if (e.type === 'subscription.renewed') {
      this.o.db.prepare("UPDATE billing_subscriptions SET status = 'active', updated_at = ? WHERE team_id = ?").run(now, sub.team_id)
      this.o.wallet.grant({ teamId: sub.team_id, credits: periodCredits(PLANS[sub.plan], sub.period), idemKey: `billing:${e.id}`, note: `plan ${sub.plan} renewed`, actor: 'billing', funding: 'paid' })
      this.charge(sub.team_id, 'subscription', planPrice(PLANS[sub.plan], sub.period), e.id)
      notices.push({ type: 'receipt', key: `receipt:${e.id}`, teamId: sub.team_id, item: 'renewal', plan: sub.plan, period: sub.period, credits: periodCredits(PLANS[sub.plan], sub.period), cents: planPrice(PLANS[sub.plan], sub.period) })
    } else if (e.type === 'payment.failed') {
      this.o.db.prepare("UPDATE billing_subscriptions SET status = 'past_due', updated_at = ? WHERE team_id = ?").run(now, sub.team_id)
      notices.push({ type: 'payment_failed', key: `payment-failed:${e.id}`, teamId: sub.team_id, plan: sub.plan })
    } else if (e.type === 'subscription.canceled') {
      this.o.db.prepare("UPDATE billing_subscriptions SET status = 'canceled', updated_at = ? WHERE team_id = ?").run(now, sub.team_id)
      notices.push({ type: 'plan_canceled', key: `plan-canceled:${e.id}`, teamId: sub.team_id, plan: sub.plan })
      return { teamId: sub.team_id, run: () => this.o.onCanceled?.(sub.team_id) }
    }
    return undefined
  }

  private charge(teamId: string, kind: 'subscription' | 'pack' | 'topup', cents: number, ref: string): void {
    this.o.db.prepare('INSERT INTO billing_charges (team_id, kind, cents, ref, created_at) VALUES (?, ?, ?, ?, ?)').run(teamId, kind, cents, ref, this.iso())
  }

  /** Runs a follow-up in the background (errors audited, never thrown); `idle()` waits for it. */
  later(teamId: string, run: () => Promise<void> | undefined): void {
    const p = this.hook(run, teamId).finally(() => this.pending.delete(p))
    this.pending.add(p)
  }

  private notify(n: BillingNotice): void {
    try {
      this.o.notify?.(n)
    } catch (err) {
      this.o.audit.record('billing', 'billing.hook_failed', n.teamId, { notice: n.type, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) })
    }
  }

  private async hook(fn: () => Promise<void> | undefined, teamId: string): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.o.audit.record('billing', 'billing.hook_failed', teamId, { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) })
    }
  }

  setAutoRecharge(teamId: string, v: unknown): AutoRecharge {
    this.team(teamId)
    const r = (v ?? {}) as Partial<AutoRecharge>
    if (typeof r.enabled !== 'boolean') throw new CloudError('bad_request', 'enabled must be true or false')
    // what is not given keeps its current value
    const current = this.account(teamId)
    const threshold = r.thresholdCredits ?? current.auto_threshold
    const cap = r.monthlyCapCents ?? current.auto_cap_cents
    const pack = r.pack ?? current.auto_pack
    if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 1_000_000) throw new CloudError('bad_request', 'thresholdCredits: 0..1 000 000')
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > MAX_TOPUP_CAP_CENTS) throw new CloudError('bad_request', `monthlyCapCents: 0..${MAX_TOPUP_CAP_CENTS}`)
    if (!isPackId(pack)) throw new CloudError('bad_request', `unknown pack ${String(pack)}`)
    this.o.db
      .prepare('UPDATE billing_accounts SET auto_enabled = ?, auto_threshold = ?, auto_pack = ?, auto_cap_cents = ?, updated_at = ? WHERE team_id = ?')
      .run(r.enabled ? 1 : 0, threshold, pack, cap, this.iso(), teamId)
    return this.status(teamId).autoRecharge
  }

  /** After a spend: top up once if the team is under its threshold, has a card on file and stays under its cap. */
  async autoRecharge(teamId: string): Promise<{ charged: boolean; reason: string }> {
    if (this.topping.has(teamId)) return { charged: false, reason: 'in_progress' }
    this.topping.add(teamId)
    try {
      return await this.topUp(teamId)
    } finally {
      this.topping.delete(teamId)
    }
  }

  private async topUp(teamId: string): Promise<{ charged: boolean; reason: string }> {
    const a = this.account(teamId)
    if (a.auto_enabled !== 1) return { charged: false, reason: 'off' }
    if (!a.customer_ref) return { charged: false, reason: 'no_card' }
    if (this.o.wallet.state(teamId).available >= a.auto_threshold) return { charged: false, reason: 'enough_credits' }
    const pack = PACKS[a.auto_pack as PackId]
    const month = this.month()
    const spent = a.auto_month === month ? a.auto_spent_cents : 0
    if (spent + pack.cents > a.auto_cap_cents) return { charged: false, reason: 'monthly_cap' }
    const n = (this.o.db.prepare("SELECT COUNT(*) AS n FROM billing_charges WHERE team_id = ? AND kind = 'topup' AND created_at >= ?").get(teamId, `${month}-01`) as { n: number }).n
    const idemKey = `topup:${teamId}:${month}:${n + 1}`
    const res = await this.o.payments.chargeSaved(a.customer_ref, pack.cents, idemKey, `Atelier: recharge automatique ${pack.credits} crédits`)
    if (!res.ok) {
      this.o.audit.record('billing', 'billing.autorecharge', teamId, { ok: false, reason: res.reason })
      // the same key until a top-up succeeds or the month turns: a declined card is told once, not at every spend
      this.notify({ type: 'topup_failed', key: `topup-failed:${idemKey}`, teamId, credits: pack.credits, cents: pack.cents })
      return { charged: false, reason: res.reason }
    }
    this.o.wallet.grant({ teamId, credits: pack.credits, idemKey, note: `recharge automatique ${pack.id}`, actor: 'billing', funding: 'paid' })
    this.charge(teamId, 'topup', pack.cents, res.paymentRef)
    this.o.db.prepare('UPDATE billing_accounts SET auto_month = ?, auto_spent_cents = ?, updated_at = ? WHERE team_id = ?').run(month, spent + pack.cents, this.iso(), teamId)
    this.o.audit.record('billing', 'billing.autorecharge', teamId, { ok: true, credits: pack.credits, cents: pack.cents })
    this.notify({ type: 'receipt', key: `receipt:${idemKey}`, teamId, item: 'topup', credits: pack.credits, cents: pack.cents })
    return { charged: true, reason: 'ok' }
  }

  /** What was charged (euro cents) in a period: the admin's revenue line. */
  revenueCents(fromIso: string, toIso: string): { subscription: number; pack: number; topup: number } {
    const rows = this.o.db.prepare('SELECT kind, SUM(cents) AS c FROM billing_charges WHERE created_at >= ? AND created_at < ? GROUP BY kind').all(fromIso, toIso) as { kind: string; c: number }[]
    const out = { subscription: 0, pack: 0, topup: 0 }
    for (const r of rows) if (r.kind in out) out[r.kind as keyof typeof out] = r.c
    return out
  }
}
