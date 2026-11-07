// Billing: a checkout for a plan or a pack, the verified payment event that grants the credits once, the subscription
// that creates the team's computers (and hibernates them when it ends), renewals, the automatic top-up (threshold,
// monthly cap, declined card), Stripe's signature check and request shape against a fake API, and the HTTP routes
// with the simulated payment.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FakePayments, StripePayments, verifyStripeSignature, type PaymentEvent } from '../src/billing/payments.ts'
import { fakeFetch, json } from './fake-fetch.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

function setup() {
  const payments = new FakePayments()
  const t = makeCloud({ paymentProvider: payments })
  const team = t.cloud.accounts.createAccount({ email: `b${Math.random()}@example.com`, name: 'B', password: 'correct horse battery', actor: 'test' }).team.id
  const pay = async (item: Parameters<typeof t.cloud.billing.checkout>[2]) => {
    const c = await t.cloud.billing.checkout(team, 'b@example.com', item, { successUrl: 'https://atelier.test/ok', cancelUrl: 'https://atelier.test/no' })
    const signed = payments.complete(c.sessionId)
    return { c, signed, result: await t.cloud.billing.webhook(signed.body, signed.signature) }
  }
  return { ...t, payments, team, pay }
}

describe('billing', () => {
  it('a pack grants its credits once, even when the event comes twice', async () => {
    const { cloud, team, pay } = setup()
    const { c, signed, result } = await pay({ kind: 'pack', pack: 'pack5k' })
    expect(c.url).toContain('demo_session=')
    expect(result).toEqual({ applied: true, type: 'checkout.completed' })
    expect(cloud.wallet.state(team).balance).toBe(5000)
    expect(await cloud.billing.webhook(signed.body, signed.signature)).toEqual({ applied: false, type: 'checkout.completed' })
    expect(cloud.wallet.state(team).balance).toBe(5000)
    expect(cloud.billing.status(team).cardOnFile).toBe(true)
    await expect(cloud.billing.webhook(signed.body, 'deadbeef')).rejects.toThrow(/signature/)
    await expect(cloud.billing.checkout(team, 'b@example.com', { kind: 'pack', pack: 'pack1m' }, { successUrl: 'https://a', cancelUrl: 'https://b' })).rejects.toThrow(/checkout/)
  })

  it('a plan grants its credits, creates the team computer, renews, and hibernates it when cancelled', async () => {
    const { cloud, team, pay, payments } = setup()
    await pay({ kind: 'subscription', plan: 'studio', period: 'month' })
    // the team computer is created after the payment event's answer (the provider does not wait for it)
    await cloud.billing.idle()
    expect(cloud.billing.status(team).subscription).toMatchObject({ plan: 'studio', period: 'month', status: 'active' })
    expect(cloud.wallet.state(team).balance).toBe(6500)
    const machines = cloud.machines().list(team)
    expect(machines).toHaveLength(1)
    expect(machines[0]).toMatchObject({ serverType: 'cx53', status: 'running' })
    const renew = payments.sign({ id: 'evt_renew_1', type: 'subscription.renewed', subscriptionRef: `sub_fake_${team}` } satisfies PaymentEvent)
    await cloud.billing.webhook(renew.body, renew.signature)
    expect(cloud.wallet.state(team).balance).toBe(13_000)
    const cancel = payments.sign({ id: 'evt_cancel_1', type: 'subscription.canceled', subscriptionRef: `sub_fake_${team}` } satisfies PaymentEvent)
    await cloud.billing.webhook(cancel.body, cancel.signature)
    await cloud.billing.idle()
    expect(cloud.billing.status(team).subscription?.status).toBe('canceled')
    expect(cloud.machines().list(team)[0]!.status).toBe('hibernated')
    expect(cloud.billing.revenueCents('2000-01-01', '2100-01-01')).toEqual({ subscription: 39998, pack: 0, topup: 0 })
  })

  it('a yearly plan grants twelve months of credits at once', async () => {
    const { cloud, team, pay } = setup()
    await pay({ kind: 'subscription', plan: 'starter', period: 'year' })
    expect(cloud.wallet.state(team).balance).toBe(18_000)
  })

  it('the automatic top-up: only when on, with a card, under the threshold, within the monthly cap; a declined card buys nothing', async () => {
    const { cloud, team, pay, payments } = setup()
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: false, reason: 'off' })
    cloud.billing.setAutoRecharge(team, { enabled: true, thresholdCredits: 1000, pack: 'pack2k', monthlyCapCents: 4000 })
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: false, reason: 'no_card' })
    await pay({ kind: 'pack', pack: 'pack2k' })
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: false, reason: 'enough_credits' })
    cloud.wallet.adjust({ teamId: team, credits: -1500, idemKey: 'spend-1', actor: 'test' })
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: true, reason: 'ok' })
    expect(cloud.wallet.state(team).balance).toBe(2500)
    cloud.wallet.adjust({ teamId: team, credits: -2000, idemKey: 'spend-2', actor: 'test' })
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: true, reason: 'ok' })
    cloud.wallet.adjust({ teamId: team, credits: -2000, idemKey: 'spend-3', actor: 'test' })
    // 2 × 20 € this month: a third would pass the 40 € cap
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: false, reason: 'monthly_cap' })
    expect(cloud.billing.status(team).autoRecharge).toMatchObject({ enabled: true, spentThisMonthCents: 4000 })
    expect(payments.charges).toHaveLength(2)
    cloud.billing.setAutoRecharge(team, { enabled: true, monthlyCapCents: 100_000 })
    payments.declined.add(`cus_fake_${team}`)
    expect(await cloud.billing.autoRecharge(team)).toEqual({ charged: false, reason: 'card_declined' })
    expect(() => cloud.billing.setAutoRecharge(team, { enabled: 'yes' })).toThrow(/enabled/)
    expect(() => cloud.billing.setAutoRecharge(team, { enabled: true, pack: 'huge' })).toThrow(/pack/)
  })
})

describe('Stripe', () => {
  const secret = 'whsec_test_not_real'
  const signed = (body: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`

  it('checks the webhook signature and its age', () => {
    const body = '{"id":"evt_1"}'
    expect(verifyStripeSignature(body, signed(body, 1000), secret, 1100)).toBe(true)
    expect(verifyStripeSignature(body + ' ', signed(body, 1000), secret, 1100)).toBe(false)
    expect(verifyStripeSignature(body, signed(body, 1000), secret, 2000)).toBe(false)
    expect(verifyStripeSignature(body, undefined, secret, 1000)).toBe(false)
  })

  it('maps Stripe events to ours and sends form-encoded requests with the key, never echoing it', async () => {
    const key = 'sk_test_not_real'
    const f = fakeFetch((req) => {
      if (req.url.endsWith('/checkout/sessions')) return json({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
      if (req.url.includes('/payment_methods?customer=cus_1')) return json({ data: [{ id: 'pm_1' }] })
      if (req.url.includes('/payment_methods?customer=')) return json({ data: [] })
      return json({ error: { code: 'card_declined', decline_code: 'insufficient_funds' } }, 402)
    })
    const s = new StripePayments({ secretKey: key, webhookSecret: secret, fetchImpl: f.fetch, nowS: () => 5000 })
    const out = await s.createCheckout({ teamId: 'team_1', email: 'a@b.c', item: { kind: 'subscription', plan: 'studio', period: 'month', cents: 19999 }, successUrl: 'https://a/ok', cancelUrl: 'https://a/no' })
    expect(out).toEqual({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${key}`)
    const form = new URLSearchParams(f.calls[0]!.body)
    expect(form.get('mode')).toBe('subscription')
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('19999')
    expect(form.get('line_items[0][price_data][recurring][interval]')).toBe('month')
    expect(form.get('client_reference_id')).toBe('team_1')
    const charge = await s.chargeSaved('cus_1', 2000, 'topup:1', 'recharge')
    expect(charge).toEqual({ ok: false, reason: 'insufficient_funds' })
    // the saved card is looked up, then charged off session with it
    expect(f.calls[2]!.headers['idempotency-key']).toBe('topup:1')
    expect(new URLSearchParams(f.calls[2]!.body).get('payment_method')).toBe('pm_1')
    expect(await s.chargeSaved('cus_none', 2000, 'topup:2', 'recharge')).toEqual({ ok: false, reason: 'no_saved_card' })
    const event = JSON.stringify({ id: 'evt_9', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1', client_reference_id: 'team_1', metadata: { team_id: 'team_1', item: JSON.stringify({ kind: 'pack', pack: 'pack2k', cents: 2000 }) } } } })
    expect(s.parseWebhook(event, signed(event, 5000))).toMatchObject({ type: 'checkout.completed', teamId: 'team_1', customerRef: 'cus_1', item: { kind: 'pack', pack: 'pack2k' } })
    const renewal = JSON.stringify({ id: 'evt_10', type: 'invoice.paid', data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_1' } } })
    expect(s.parseWebhook(renewal, signed(renewal, 5000))).toEqual({ id: 'evt_10', type: 'subscription.renewed', subscriptionRef: 'sub_1' })
    const first = JSON.stringify({ id: 'evt_11', type: 'invoice.paid', data: { object: { billing_reason: 'subscription_create', subscription: 'sub_1' } } })
    expect(s.parseWebhook(first, signed(first, 5000)).type).toBe('ignored')
    expect(() => s.parseWebhook(event, 't=5000,v1=00')).toThrow(/signature/)
    // a session paid later (SEPA) counts only when its payment arrives, never while unpaid
    const unpaid = event.replace('"payment_status":"paid"', '"payment_status":"unpaid"')
    expect(s.parseWebhook(unpaid, signed(unpaid, 5000)).type).toBe('ignored')
    const later = unpaid.replace('checkout.session.completed', 'checkout.session.async_payment_succeeded').replace('evt_9', 'evt_12')
    expect(s.parseWebhook(later, signed(later, 5000))).toMatchObject({ id: 'evt_12', type: 'checkout.completed', teamId: 'team_1' })
    const failed = unpaid.replace('checkout.session.completed', 'checkout.session.async_payment_failed')
    expect(s.parseWebhook(failed, signed(failed, 5000)).type).toBe('ignored')
  })
})

describe('billing over HTTP', () => {
  it('status, checkout, the simulated payment, the top-up settings; a forged webhook is refused', async () => {
    const t = makeCloud()
    const me = await signUpAndIn(t)
    const status = await t.app.inject({ method: 'GET', url: '/v1/billing', headers: me.auth })
    expect(status.json()).toMatchObject({ provider: 'fake', subscription: null, cardOnFile: false })
    const checkout = await t.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: me.auth, payload: { item: { kind: 'subscription', plan: 'creator', period: 'month' }, successUrl: 'http://localhost:5190/bienvenue', cancelUrl: 'http://localhost:5190/tarifs' } })
    expect(checkout.statusCode).toBe(200)
    const { sessionId } = checkout.json() as { sessionId: string }
    const done = await t.app.inject({ method: 'POST', url: '/v1/billing/demo-complete', headers: me.auth, payload: { sessionId } })
    expect(done.json()).toEqual({ ok: true })
    expect(t.cloud.wallet.state(me.teamId).balance).toBe(3000)
    expect((await t.app.inject({ method: 'GET', url: '/v1/billing', headers: me.auth })).json()).toMatchObject({ subscription: { plan: 'creator', status: 'active' }, cardOnFile: true })
    const auto = await t.app.inject({ method: 'POST', url: '/v1/billing/auto-recharge', headers: me.auth, payload: { enabled: true, thresholdCredits: 200 } })
    expect(auto.json()).toMatchObject({ enabled: true, thresholdCredits: 200, pack: 'pack2k' })
    const bad = await t.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: me.auth, payload: { item: { kind: 'pack', pack: 'pack2k' }, successUrl: 'http://evil.example/x', cancelUrl: 'https://a.b' } })
    expect(bad.statusCode).toBe(400)
    const forged = await t.app.inject({ method: 'POST', url: '/v1/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' }, payload: '{"id":"evt_x","type":"checkout.completed"}' })
    expect(forged.statusCode).toBe(403)
    const other = await signUpAndIn(t)
    expect((await t.app.inject({ method: 'POST', url: '/v1/billing/demo-complete', headers: other.auth, payload: { sessionId } })).statusCode).toBe(404)
  })
})
