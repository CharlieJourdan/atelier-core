// Payments behind one interface: Stripe for real (Checkout for subscriptions and packs, off-session charges for the
// automatic top-up, signed webhooks), a fake for the demo and the tests ("paiement simulé": no card is ever asked).
// The real one is only built when the Cloud's config says `payments: "stripe"` and STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are in the vault. Keys never appear in errors.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type CheckoutKind = { kind: 'subscription'; plan: string; period: 'month' | 'year'; cents: number } | { kind: 'pack'; pack: string; cents: number }

export interface CheckoutInput {
  teamId: string
  email: string
  item: CheckoutKind
  successUrl: string
  cancelUrl: string
}

/** A payment event, already verified, in our own words. */
export type PaymentEvent =
  | { id: string; type: 'checkout.completed'; teamId: string; item: CheckoutKind; customerRef: string | null; subscriptionRef: string | null }
  | { id: string; type: 'subscription.renewed'; subscriptionRef: string }
  | { id: string; type: 'subscription.canceled'; subscriptionRef: string }
  | { id: string; type: 'payment.failed'; subscriptionRef: string | null }
  | { id: string; type: 'ignored' }

export interface PaymentProvider {
  readonly kind: 'stripe' | 'fake'
  createCheckout(i: CheckoutInput): Promise<{ sessionId: string; url: string }>
  /** Charges the saved card of a customer, off session (the automatic top-up). */
  chargeSaved(customerRef: string, cents: number, idemKey: string, description: string): Promise<{ ok: true; paymentRef: string } | { ok: false; reason: string }>
  /** Checks the signature and translates the provider's event. Throws on a bad signature. */
  parseWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent
}

export class PaymentError extends Error {}

// ---- the fake ---------------------------------------------------------------------------------------------------------

export class FakePayments implements PaymentProvider {
  readonly kind = 'fake' as const
  readonly sessions = new Map<string, CheckoutInput>()
  readonly charges: { customerRef: string; cents: number; idemKey: string }[] = []
  /** Customers whose saved card is declined (tests of the top-up). */
  declined = new Set<string>()
  private readonly secret = randomBytes(16).toString('hex')

  async createCheckout(i: CheckoutInput): Promise<{ sessionId: string; url: string }> {
    const sessionId = `cs_fake_${randomBytes(8).toString('hex')}`
    this.sessions.set(sessionId, i)
    return { sessionId, url: `${i.successUrl}${i.successUrl.includes('?') ? '&' : '?'}demo_session=${sessionId}` }
  }

  async chargeSaved(customerRef: string, cents: number, idemKey: string): Promise<{ ok: true; paymentRef: string } | { ok: false; reason: string }> {
    if (this.declined.has(customerRef)) return { ok: false, reason: 'card_declined' }
    const seen = this.charges.find((c) => c.idemKey === idemKey)
    if (!seen) this.charges.push({ customerRef, cents, idemKey })
    return { ok: true, paymentRef: `pi_fake_${idemKey.slice(0, 16)}` }
  }

  /** The demo "pays": the event Stripe would send once the checkout is completed, signed with the fake's secret. */
  complete(sessionId: string): { body: string; signature: string } {
    const s = this.sessions.get(sessionId)
    if (!s) throw new PaymentError('unknown checkout session')
    const event: PaymentEvent = {
      id: `evt_${sessionId}`,
      type: 'checkout.completed',
      teamId: s.teamId,
      item: s.item,
      customerRef: `cus_fake_${s.teamId}`,
      subscriptionRef: s.item.kind === 'subscription' ? `sub_fake_${s.teamId}` : null
    }
    return this.sign(event)
  }

  sign(event: PaymentEvent): { body: string; signature: string } {
    const body = JSON.stringify(event)
    return { body, signature: createHmac('sha256', this.secret).update(body).digest('hex') }
  }

  parseWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent {
    const want = createHmac('sha256', this.secret).update(rawBody).digest()
    const got = Buffer.from(signatureHeader ?? '', 'hex')
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new PaymentError('invalid signature')
    return JSON.parse(rawBody) as PaymentEvent
  }
}

// ---- Stripe -----------------------------------------------------------------------------------------------------------

const STRIPE = 'https://api.stripe.com/v1'
/** Stripe's signed timestamp may be at most this old (its own default tolerance). */
const TOLERANCE_S = 300

/** Stripe's `Stripe-Signature: t=…,v1=…` check: HMAC-SHA256 of `${t}.${body}` with the endpoint secret. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowS: number): boolean {
  if (!header) return false
  const parts = new Map<string, string[]>()
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=', 2)
    if (!k || !v) continue
    parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()])
  }
  const t = Number(parts.get('t')?.[0])
  if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S) return false
  const want = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest()
  return (parts.get('v1') ?? []).some((sig) => {
    const got = Buffer.from(sig, 'hex')
    return got.length === want.length && timingSafeEqual(got, want)
  })
}

const form = (o: Record<string, string | number>): string =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')

export interface StripeOptions {
  secretKey: string
  webhookSecret: string
  fetchImpl?: typeof fetch
  nowS?: () => number
}

export class StripePayments implements PaymentProvider {
  readonly kind = 'stripe' as const
  private readonly o: StripeOptions
  private readonly fetchImpl: typeof fetch
  constructor(o: StripeOptions) {
    this.o = o
    this.fetchImpl = o.fetchImpl ?? fetch
  }

  private async post<T>(path: string, body: Record<string, string | number>, idemKey?: string): Promise<{ status: number; json: T }> {
    const res = await this.fetchImpl(`${STRIPE}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.o.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idemKey ? { 'idempotency-key': idemKey } : {})
      },
      body: form(body)
    })
    const json = (await res.json().catch(() => ({}))) as T
    return { status: res.status, json }
  }

  async createCheckout(i: CheckoutInput): Promise<{ sessionId: string; url: string }> {
    const item = i.item
    const common: Record<string, string | number> = {
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      customer_email: i.email,
      client_reference_id: i.teamId,
      'metadata[team_id]': i.teamId,
      'metadata[item]': JSON.stringify(item),
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': item.cents,
      'line_items[0][price_data][tax_behavior]': 'exclusive',
      'automatic_tax[enabled]': 'true'
    }
    const body =
      item.kind === 'subscription'
        ? { ...common, mode: 'subscription', 'line_items[0][price_data][product_data][name]': `Atelier ${item.plan}`, 'line_items[0][price_data][recurring][interval]': item.period, 'subscription_data[metadata][team_id]': i.teamId }
        : { ...common, mode: 'payment', 'line_items[0][price_data][product_data][name]': `Atelier credits ${item.pack}`, 'payment_intent_data[setup_future_usage]': 'off_session' }
    const r = await this.post<{ id?: string; url?: string; error?: { code?: string } }>('/checkout/sessions', body)
    if (r.status >= 400 || !r.json.id || !r.json.url) throw new PaymentError(`Stripe checkout refused (${r.json.error?.code ?? r.status})`)
    return { sessionId: r.json.id, url: r.json.url }
  }

  async chargeSaved(customerRef: string, cents: number, idemKey: string, description: string): Promise<{ ok: true; paymentRef: string } | { ok: false; reason: string }> {
    // Stripe does not pick a customer's card by itself: the card saved at checkout is the customer's first card
    const res = await this.fetchImpl(`${STRIPE}/payment_methods?customer=${encodeURIComponent(customerRef)}&type=card&limit=1`, { headers: { authorization: `Bearer ${this.o.secretKey}` } })
    const pms = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] }
    const paymentMethod = pms.data?.[0]?.id
    if (!res.ok || !paymentMethod) return { ok: false, reason: 'no_saved_card' }
    const r = await this.post<{ id?: string; status?: string; error?: { code?: string; decline_code?: string } }>(
      '/payment_intents',
      { amount: cents, currency: 'eur', customer: customerRef, payment_method: paymentMethod, confirm: 'true', off_session: 'true', description: description.slice(0, 200) },
      idemKey
    )
    if (r.status < 400 && r.json.id && r.json.status === 'succeeded') return { ok: true, paymentRef: r.json.id }
    return { ok: false, reason: r.json.error?.decline_code ?? r.json.error?.code ?? `status_${r.json.status ?? r.status}` }
  }

  parseWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent {
    const nowS = this.o.nowS?.() ?? Math.floor(Date.now() / 1000)
    if (!verifyStripeSignature(rawBody, signatureHeader, this.o.webhookSecret, nowS)) throw new PaymentError('invalid signature')
    const e = JSON.parse(rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } }
    const o = e.data?.object ?? {}
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
    // a session paid later (SEPA…) completes as unpaid: it counts only when its payment arrives
    const paid = o.payment_status === 'paid' || o.payment_status === 'no_payment_required'
    if (e.type === 'checkout.session.async_payment_failed') return { id: e.id, type: 'ignored' }
    if ((e.type === 'checkout.session.completed' && paid) || e.type === 'checkout.session.async_payment_succeeded') {
      const meta = (o.metadata ?? {}) as Record<string, string>
      return {
        id: e.id,
        type: 'checkout.completed',
        teamId: meta.team_id ?? str(o.client_reference_id) ?? '',
        item: JSON.parse(meta.item ?? '{}') as CheckoutKind,
        customerRef: str(o.customer),
        subscriptionRef: str(o.subscription)
      }
    }
    // a renewal: an invoice paid for a subscription period after the first (the first is the checkout)
    if (e.type === 'invoice.paid' && o.billing_reason === 'subscription_cycle' && str(o.subscription)) return { id: e.id, type: 'subscription.renewed', subscriptionRef: str(o.subscription) as string }
    if (e.type === 'customer.subscription.deleted' && str(o.id)) return { id: e.id, type: 'subscription.canceled', subscriptionRef: str(o.id) as string }
    if (e.type === 'invoice.payment_failed') return { id: e.id, type: 'payment.failed', subscriptionRef: str(o.subscription) }
    return { id: e.id, type: 'ignored' }
  }
}
