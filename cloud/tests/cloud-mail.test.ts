// E-mails: the mailers (fake outbox, Resend against a fake fetch), the templates (escaping), single-use hashed tokens,
// address verification and the gates it puts on paying and paid work, password reset (same answer for unknown addresses,
// rate limits, sessions revoked), and the billing / team-computer e-mails (once per event, after the commit).
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FakePayments, type PaymentEvent } from '../src/billing/payments.ts'
import { Audit } from '../src/audit.ts'
import { chooseMailer, createCloud, type CloudOptions } from '../src/cloud.ts'
import { Vault } from '../src/vault.ts'
import { DAY_MS, HOUR_MS, ManualClock } from '../src/clock.ts'
import { CLOUD_MIGRATIONS } from '../src/db/migrations/index.ts'
import { migrateCloud, openCloudDb, tx } from '../src/db/index.ts'
import { sha256Hex } from '../src/ids.ts'
import { staticKeySource } from '../src/keysource.ts'
import { TeamNotices } from '../src/mail/notices.ts'
import { RESEND_URL, ResendMailer } from '../src/mail/resend.ts'
import { RESEND_LIMIT, RESET_LIMIT } from '../src/mail/flows.ts'
import { escapeHtml, MAIL_LANGS, oneLine, render, type Template } from '../src/mail/templates.ts'
import { MailError, type MailMessage, type Mailer } from '../src/mail/types.ts'
import { mailCli } from '../src/mail/cli.ts'
import { runCli } from '../src/cli.ts'
import { mailOptions, CloudConfigFile } from '../src/config.ts'
import { PassThrough } from 'node:stream'
import { fakeFetch, json } from './fake-fetch.ts'
import { confirmEmail, mailedToken, makeCloud, newVerifier, signIn, signUpAndIn, TEST_MASTER_KEY, type TestCloud } from './helpers.ts'

const PW = 'correct horse battery'
const NEW_PW = 'a brand new passphrase'
const flat = (s: string): string => s.replace(/\s/g, ' ')

async function signup(t: TestCloud, email: string, extra: Record<string, unknown> = {}) {
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, name: 'Léa', password: PW, ...extra } })
  const tokens = res.json() as { accessToken: string; refreshToken: string }
  return { status: res.statusCode, tokens, auth: { authorization: `Bearer ${tokens.accessToken}` } }
}

const post = (t: TestCloud, url: string, payload: unknown, headers: Record<string, string> = {}, remoteAddress?: string) =>
  t.app.inject({ method: 'POST', url, payload: payload as object, headers, ...(remoteAddress ? { remoteAddress } : {}) })

const mailsTo = (t: TestCloud, to: string, subjectStart = '') => (t.cloud.outbox?.list({ to, limit: 200 }) ?? []).filter((m) => m.subject.startsWith(subjectStart))

describe('the mailers', () => {
  it('the fake mailer keeps each message in the database, newest first, and refuses a line break in a header', async () => {
    const t = makeCloud()
    await t.cloud.outbox!.send({ to: 'a@example.com', subject: 'Un', text: 't1', html: '<p>1</p>' })
    await t.cloud.outbox!.send({ to: 'b@example.com', subject: 'Deux', text: 't2', html: '<p>2</p>' })
    expect(t.cloud.outbox!.list().map((m) => m.subject)).toEqual(['Deux', 'Un'])
    expect(t.cloud.outbox!.list({ to: 'A@example.com' }).map((m) => m.subject)).toEqual(['Un'])
    await expect(t.cloud.outbox!.send({ to: 'a@example.com', subject: 'x\r\nBcc: evil@example.com', text: '', html: '' })).rejects.toThrow(MailError)
    await expect(t.cloud.outbox!.send({ to: 'a@example.com\nBcc: evil@example.com', subject: 'x', text: '', html: '' })).rejects.toThrow(MailError)
  })

  it('Resend: one HTTPS call with the key in the Authorization header, the message as JSON and an idempotency key', async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: 're_123' }))
    const mailer = new ResendMailer({ apiKey: 're_secret_key_value', from: 'Atelier <bonjour@atelier.example>', fetchImpl: fetch })
    expect(await mailer.send({ to: 'lea@example.com', subject: 'Salut', text: 'texte', html: '<p>html</p>', idempotencyKey: 'receipt:evt_1:acc_1' })).toEqual({ id: 're_123' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: RESEND_URL, method: 'POST' })
    expect(calls[0]!.headers.authorization).toBe('Bearer re_secret_key_value')
    expect(calls[0]!.headers['idempotency-key']).toBe('receipt:evt_1:acc_1')
    expect(JSON.parse(calls[0]!.body)).toEqual({ from: 'Atelier <bonjour@atelier.example>', to: ['lea@example.com'], subject: 'Salut', text: 'texte', html: '<p>html</p>' })
  })

  it('Resend: a refusal, a bad answer and a network error become a MailError that never holds the key or the message', async () => {
    const key = 're_secret_key_value'
    const refuse = fakeFetch(() => json({ name: 'validation_error', message: `the key ${key} is wrong for lea@example.com` }, 422))
    const a = new ResendMailer({ apiKey: key, from: 'bonjour@atelier.example', fetchImpl: refuse.fetch })
    const err = await a.send({ to: 'lea@example.com', subject: 's', text: 'le texte secret', html: '' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MailError)
    expect((err as Error).message).toBe('Resend refused the message: HTTP 422 (validation_error)')
    expect((err as Error).message).not.toContain(key)
    const noId = new ResendMailer({ apiKey: key, from: 'bonjour@atelier.example', fetchImpl: fakeFetch(() => json({})).fetch })
    await expect(noId.send({ to: 'lea@example.com', subject: 's', text: '', html: '' })).rejects.toThrow(/without a message id/)
    const down = new ResendMailer({
      apiKey: key,
      from: 'bonjour@atelier.example',
      fetchImpl: (() => Promise.reject(new Error(`connect ECONNREFUSED with ${key}`))) as unknown as typeof fetch
    })
    const net = await down.send({ to: 'lea@example.com', subject: 's', text: '', html: '' }).catch((e: unknown) => e)
    expect((net as Error).message).toBe('Resend could not be reached')
    expect(() => new ResendMailer({ apiKey: '', from: 'bonjour@atelier.example' })).toThrow(/key is empty/)
    expect(() => new ResendMailer({ apiKey: key, from: 'Atelier <a@b.c>\nBcc: x@y.z' })).toThrow(MailError)
    await expect(a.send({ to: 'x@example.com', subject: 'a\nb', text: '', html: '' })).rejects.toThrow(MailError)
    expect(refuse.calls).toHaveLength(1)
  })

  it('the Cloud refuses to start with "resend" and no key, no sender or no site address, and never falls back to the fake', () => {
    const base = { dbPath: ':memory:', filesDir: '.', signingKey: Buffer.alloc(32, 1), keySource: staticKeySource(TEST_MASTER_KEY), paidCalls: false }
    const resend = { kind: 'resend' as const, from: 'Atelier <bonjour@atelier.example>', siteUrl: 'https://atelier.example' }
    expect(() => createCloud({ ...base, mail: resend })).toThrow(/RESEND_API_KEY/)
    const db = openCloudDb(':memory:')
    const clock = new ManualClock()
    const vault = new Vault(db, clock, new Audit(db, clock), staticKeySource(TEST_MASTER_KEY))
    const choose = (mail: CloudOptions['mail']) => chooseMailer({ ...base, ...(mail ? { mail } : {}) }, db, clock, vault)
    expect(() => choose(resend)).toThrow(/RESEND_API_KEY/)
    vault.set('RESEND_API_KEY', 're_test_key_1234', 'test')
    expect(() => choose({ kind: 'resend', siteUrl: resend.siteUrl })).toThrow(/mail.from/)
    expect(() => choose({ kind: 'resend', from: resend.from })).toThrow(/website address/)
    expect(choose(resend).kind).toBe('resend')
    expect(choose({ kind: 'fake' }).kind).toBe('fake')
    expect(choose(undefined).kind).toBe('fake')
    db.close()
  })

  it('the configuration: kind, sender and site address are checked; the site address defaults to the first site origin', () => {
    const cfg = CloudConfigFile.parse({ mail: { kind: 'resend', from: 'Atelier <bonjour@atelier.example>' }, siteOrigins: ['https://atelier.example'] })
    expect(mailOptions({ ...cfg, dataDir: '.' })).toEqual({ kind: 'resend', from: 'Atelier <bonjour@atelier.example>', siteUrl: 'https://atelier.example' })
    expect(() => CloudConfigFile.parse({ mail: { kind: 'sendgrid' } })).toThrow()
    expect(() => CloudConfigFile.parse({ mail: { kind: 'resend', from: 'a@b.c\nBcc: x@y.z' } })).toThrow()
    expect(() => CloudConfigFile.parse({ mail: { siteUrl: 'https://atelier.example/path' } })).toThrow()
    expect(CloudConfigFile.parse({}).mail).toEqual({ kind: 'fake' })
  })
})

describe('the templates', () => {
  const link = 'https://atelier.example/verifier?token=ver_abc'
  const all = (name: string): Template[] => [
    { kind: 'verify', name, link },
    { kind: 'reset', name, link },
    { kind: 'receipt', name, item: 'plan', plan: name, period: 'year', credits: 18_000, cents: 4799 },
    { kind: 'receipt', name, item: 'renewal', plan: name, period: 'month', credits: 1500, cents: 4999 },
    { kind: 'receipt', name, item: 'pack', credits: 2000, cents: 2000 },
    { kind: 'receipt', name, item: 'topup', credits: 2000, cents: 2000 },
    { kind: 'payment_failed', name, plan: name, link },
    { kind: 'topup_failed', name, credits: 2000, cents: 2000, link },
    { kind: 'plan_canceled', name, plan: name, link },
    { kind: 'machine_ready', name, plan: name, count: 1, link },
    { kind: 'machine_ready', name, plan: name, count: 2, link },
    { kind: 'invite', name: '', inviter: name, team: name, role: 'member', link }
  ]

  it('every e-mail exists in French and in English, with a one-line subject, a text part and an HTML part', () => {
    expect([...MAIL_LANGS]).toEqual(['fr', 'en'])
    for (const lang of MAIL_LANGS) {
      for (const tpl of all('Léa')) {
        const m = render(tpl, lang)
        expect(m.subject, `${tpl.kind} ${lang}`).toMatch(/^[^\r\n]{4,200}$/)
        expect(m.text.length).toBeGreaterThan(40)
        expect(m.html).toContain(`<html lang="${lang}">`)
        expect(m.text).toContain('Léa')
      }
    }
    expect(render(all('Léa')[0]!, 'fr').subject).toBe('Confirme ton adresse e-mail')
    expect(render(all('Léa')[0]!, 'en').subject).toBe('Confirm your e-mail address')
    expect(flat(render(all('Léa')[2]!, 'fr').text)).toMatch(/Montant : 47,99 € HT/)
    expect(flat(render(all('Léa')[2]!, 'en').text)).toMatch(/Amount: €47\.99 excl\. VAT/)
  })

  it('escapes user data in the HTML, strips control characters from the text, and carries no tracking', () => {
    const evil = `<img src=x onerror=alert(1)>"&' \u0007\r\nBcc: x@y.z`
    for (const lang of MAIL_LANGS) {
      for (const tpl of all(evil)) {
        const m = render(tpl, lang)
        expect(m.html, `${tpl.kind} ${lang}`).not.toContain('<img')
        expect(m.html).not.toContain('onerror=alert(1)>')
        expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        expect(m.html).toContain('&quot;&amp;&#39;')
        expect(m.subject).not.toMatch(/\s{2}|[\r\n]/)
        expect(m.subject.includes(String.fromCharCode(7))).toBe(false)
        expect(m.text.includes(String.fromCharCode(7))).toBe(false)
        expect(m.text).not.toMatch(/Bcc: x@y\.z\r/)
        expect(m.html).not.toMatch(/<script|<iframe|<link|<style|url\(/i)
        // the only address in the message is our own link
        for (const href of m.html.match(/https?:\/\/[^"<\s]+/g) ?? []) expect(href).toBe(link)
      }
    }
    // a link that is not plain http(s) is never made clickable
    const bad = render({ kind: 'verify', name: 'A', link: 'javascript:alert(1)' }, 'fr')
    expect(bad.html).toContain('href="#"')
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
    expect(oneLine(' a\u0000b\n\tc ')).toBe('a b c')
  })
})

describe('single-use tokens', () => {
  it('only the hash is stored; a token works once, and a newer one retires the older', async () => {
    const t = makeCloud()
    const { account } = t.cloud.accounts.createAccount({ email: 'tok@example.com', name: 'T', password: PW, verified: false, actor: 'test' })
    t.cloud.emailFlows.sendVerification(account.id)
    const first = (await mailedToken(t, 'tok@example.com', '/verifier'))!
    expect(first).toMatch(/^ver_[A-Za-z0-9_-]{43}$/)
    const rows = t.cloud.db.prepare('SELECT hash, kind, account_id FROM email_tokens').all() as { hash: string; kind: string; account_id: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.hash).toBe(sha256Hex(first))
    expect(JSON.stringify(rows)).not.toContain(first)
    t.clock.advance(1000)
    t.cloud.emailFlows.sendVerification(account.id)
    const second = (await mailedToken(t, 'tok@example.com', '/verifier'))!
    expect(second).not.toBe(first)
    expect((await post(t, '/v1/auth/verify-email', { token: first })).statusCode).toBe(410)
    expect((await post(t, '/v1/auth/verify-email', { token: second })).statusCode).toBe(200)
    expect((await post(t, '/v1/auth/verify-email', { token: second })).statusCode).toBe(410)
    expect(t.cloud.accounts.account(account.id).emailVerified).toBe(true)
  })

  it('a verification link lasts 24 hours, a reset link 1 hour, and a token of one kind never opens the other', async () => {
    const t = makeCloud()
    const { account } = t.cloud.accounts.createAccount({ email: 'exp@example.com', name: 'E', password: PW, verified: false, actor: 'test' })
    t.cloud.emailFlows.sendVerification(account.id)
    const verify = (await mailedToken(t, 'exp@example.com', '/verifier'))!
    await post(t, '/v1/auth/forgot-password', { email: 'exp@example.com' })
    const reset = (await mailedToken(t, 'exp@example.com', '/nouveau-mot-de-passe'))!
    expect((await post(t, '/v1/auth/reset-password', { token: verify, password: NEW_PW })).statusCode).toBe(410)
    expect((await post(t, '/v1/auth/verify-email', { token: reset })).statusCode).toBe(410)
    t.clock.advance(HOUR_MS + 1)
    expect((await post(t, '/v1/auth/reset-password', { token: reset, password: NEW_PW })).statusCode).toBe(410)
    expect(t.cloud.accounts.account(account.id).emailVerified).toBe(false)
    t.clock.advance(DAY_MS - HOUR_MS - 2)
    expect((await post(t, '/v1/auth/verify-email', { token: verify })).statusCode).toBe(200)
    // the day after: a second account's token is dead
    const other = t.cloud.accounts.createAccount({ email: 'exp2@example.com', name: 'E', password: PW, verified: false, actor: 'test' }).account
    t.cloud.emailFlows.sendVerification(other.id)
    const late = (await mailedToken(t, 'exp2@example.com', '/verifier'))!
    t.clock.advance(DAY_MS)
    expect((await post(t, '/v1/auth/verify-email', { token: late })).statusCode).toBe(410)
    expect((await post(t, '/v1/auth/verify-email', { token: 'not-a-token-at-all' })).statusCode).toBe(410)
    expect((await post(t, '/v1/auth/verify-email', { token: 'x' })).statusCode).toBe(400)
  })

  it('two requests with the same token at once: exactly one wins', async () => {
    const t = makeCloud()
    const { account } = t.cloud.accounts.createAccount({ email: 'race@example.com', name: 'R', password: PW, verified: false, actor: 'test' })
    t.cloud.emailFlows.sendVerification(account.id)
    const token = (await mailedToken(t, 'race@example.com', '/verifier'))!
    const answers = await Promise.all([post(t, '/v1/auth/verify-email', { token }), post(t, '/v1/auth/verify-email', { token })])
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 410])
  })
})

describe('address verification', () => {
  it('a website sign-up is unverified and mailed a link in the language of the site; the admin tool and the tests verify at once', async () => {
    const t = makeCloud()
    const en = await signup(t, 'en@example.com', { lang: 'en' })
    const fr = await signup(t, 'fr@example.com')
    expect(en.status).toBe(200)
    expect((await t.app.inject({ url: '/v1/me', headers: en.auth })).json()).toMatchObject({ account: { emailVerified: false } })
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'en@example.com').map((m) => m.subject)).toEqual(['Confirm your e-mail address'])
    expect(mailsTo(t, 'fr@example.com').map((m) => m.subject)).toEqual(['Confirme ton adresse e-mail'])
    expect(fr.status).toBe(200)
    const admin = await signUpAndIn(t)
    expect((await t.app.inject({ url: '/v1/me', headers: admin.auth })).json()).toMatchObject({ account: { emailVerified: true } })
    expect(mailsTo(t, admin.email)).toEqual([])
  })

  it('an unverified account signs in and browses, but checkout, the simulated payment and jobs are refused in French until it verifies', async () => {
    const t = makeCloud()
    const u = await signup(t, 'gate@example.com')
    const me = (await t.app.inject({ url: '/v1/me', headers: u.auth })).json() as { team: { id: string } }
    // browsing works
    for (const url of ['/v1/me', '/v1/wallet', '/v1/catalog', '/v1/billing', '/v1/team/machines', '/v1/devices']) expect((await t.app.inject({ url, headers: u.auth })).statusCode, url).toBe(200)
    t.cloud.wallet.grant({ teamId: me.team.id, credits: 5000, idemKey: 'seed-gate', actor: 'test' })
    const quote = await post(t, '/v1/quotes', { usage: 'synthesize', input: { text: 'Bonjour', voiceId: 'demo-claire' } }, u.auth)
    expect(quote.statusCode).toBe(200)
    const urls = { successUrl: 'http://localhost:5190/ok', cancelUrl: 'http://localhost:5190/no' }
    const refused = [
      await post(t, '/v1/billing/checkout', { item: { kind: 'pack', pack: 'pack2k' }, ...urls }, u.auth),
      await post(t, '/v1/billing/demo-complete', { sessionId: 'cs_fake_x' }, u.auth),
      await post(t, '/v1/billing/auto-recharge', { enabled: false }, u.auth),
      await post(t, '/v1/jobs', { quoteId: (quote.json() as { id: string }).id, idempotencyKey: 'gate-job' }, u.auth)
    ]
    for (const r of refused) {
      expect(r.statusCode).toBe(403)
      expect((r.json() as { error: { code: string; message: string } }).error).toMatchObject({ code: 'forbidden', message: expect.stringContaining('Vérifie ton adresse e-mail') })
    }
    expect(t.cloud.wallet.state(me.team.id).held).toBe(0)
    await confirmEmail(t, 'gate@example.com')
    expect((await post(t, '/v1/billing/checkout', { item: { kind: 'pack', pack: 'pack2k' }, ...urls }, u.auth)).statusCode).toBe(200)
    expect((await post(t, '/v1/jobs', { quoteId: (quote.json() as { id: string }).id, idempotencyKey: 'gate-job' }, u.auth)).statusCode).toBe(200)
  })

  it('paid work refused to a member of a team whose own address is unverified, even in a verified owner’s team', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t, { credits: 5000 })
    const { account } = t.cloud.accounts.createAccount({ email: 'newbie@example.com', name: 'N', password: PW, teamId: owner.teamId, role: 'admin', verified: false, actor: 'test' })
    expect(account.emailVerified).toBe(false)
    const tokens = await signIn(t, 'newbie@example.com')
    const auth = { authorization: `Bearer ${tokens.accessToken}` }
    const co = await post(t, '/v1/billing/checkout', { item: { kind: 'pack', pack: 'pack2k' }, successUrl: 'http://localhost:5190/ok', cancelUrl: 'http://localhost:5190/no' }, auth)
    expect(co.statusCode).toBe(403)
  })

  it('resend: a new e-mail and link, 3 per 15 minutes per account, then a pause; a verified account is told so and gets nothing', async () => {
    const t = makeCloud()
    const u = await signup(t, 'again@example.com')
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'again@example.com')).toHaveLength(1)
    const first = (await mailedToken(t, 'again@example.com', '/verifier'))!
    for (let i = 0; i < RESEND_LIMIT.perAccount; i++) {
      const r = await post(t, '/v1/auth/resend-verification', {}, u.auth)
      expect(r.json()).toEqual({ ok: true, alreadyVerified: false })
    }
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'again@example.com')).toHaveLength(1 + RESEND_LIMIT.perAccount)
    const limited = await post(t, '/v1/auth/resend-verification', {}, u.auth)
    expect(limited.statusCode).toBe(429)
    expect(mailsTo(t, 'again@example.com')).toHaveLength(1 + RESEND_LIMIT.perAccount)
    // only the last link works
    expect((await post(t, '/v1/auth/verify-email', { token: first })).statusCode).toBe(410)
    t.clock.advance(RESEND_LIMIT.accountMs + 1)
    expect((await post(t, '/v1/auth/resend-verification', {}, u.auth)).statusCode).toBe(200)
    await confirmEmail(t, 'again@example.com')
    const done = await post(t, '/v1/auth/resend-verification', {}, u.auth)
    expect(done.json()).toEqual({ ok: true, alreadyVerified: true })
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'again@example.com')).toHaveLength(2 + RESEND_LIMIT.perAccount)
    expect((await post(t, '/v1/auth/resend-verification', {})).statusCode).toBe(401)
  })

  it('accounts that existed before the migration count as verified; new ones do not', () => {
    const db = openCloudDb(':memory:', CLOUD_MIGRATIONS.slice(0, 9))
    db.prepare("INSERT INTO accounts (id, email, name, password_hash, platform_admin, created_at) VALUES ('acc_old', 'old@example.com', 'Old', 'x', 0, '2026-01-01T00:00:00.000Z')").run()
    // 014 (account status) came later: the old account is not disabled by it either; 015 (team backups) touches no account
    // production-10 added 016 (provider alerts), console-depenses 017 (finance: funding of credits, finished videos, settings)
    // cloud-3 added 018 (the fraction of a credit a team has carried), test-team 019 (test teams and their brains' keys)
    expect(migrateCloud(db)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    expect(db.prepare("SELECT email_verified_at AS v, lang, disabled_at AS off FROM accounts WHERE id = 'acc_old'").get()).toEqual({ v: '2026-01-01T00:00:00.000Z', lang: 'fr', off: null })
    db.close()
  })
})

describe('password reset', () => {
  it('answers the same for an address with an account and one without, and mails only the first', async () => {
    const t = makeCloud()
    await signUpAndIn(t, { email: 'known@example.com' })
    const known = await post(t, '/v1/auth/forgot-password', { email: 'known@example.com' })
    const unknown = await post(t, '/v1/auth/forgot-password', { email: 'nobody@example.com' })
    expect(unknown.statusCode).toBe(known.statusCode)
    expect(unknown.body).toBe(known.body)
    expect(known.json()).toEqual({ ok: true })
    expect(unknown.headers['content-type']).toBe(known.headers['content-type'])
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'known@example.com').map((m) => m.subject)).toEqual(['Réinitialise ton mot de passe Atelier'])
    expect(mailsTo(t, 'nobody@example.com')).toEqual([])
    // case and spaces in the address change nothing
    expect((await post(t, '/v1/auth/forgot-password', { email: 'KNOWN@example.com' })).json()).toEqual({ ok: true })
    expect((await post(t, '/v1/auth/forgot-password', { email: 'not an address' })).statusCode).toBe(400)
  })

  it('is rate-limited per address and per IP, counting unknown addresses the same way, and recovers after an hour', async () => {
    const t = makeCloud()
    await signUpAndIn(t, { email: 'limit@example.com' })
    const ask = (email: string, ip = '10.0.0.1') => post(t, '/v1/auth/forgot-password', { email }, {}, ip)
    for (let i = 0; i < RESET_LIMIT.perAddress; i++) expect((await ask('limit@example.com')).statusCode).toBe(200)
    const known = await ask('limit@example.com')
    expect(known.statusCode).toBe(429)
    for (let i = 0; i < RESET_LIMIT.perAddress; i++) expect((await ask('ghost@example.com', '10.0.0.2')).statusCode).toBe(200)
    const unknown = await ask('ghost@example.com', '10.0.0.2')
    expect(unknown.statusCode).toBe(429)
    // nothing tells the two refusals apart but the address typed
    expect((known.json() as { error: { message: string } }).error.message).toBe((unknown.json() as { error: { message: string } }).error.message)
    // the IP: many different addresses from one place
    for (let i = 0; i < RESET_LIMIT.perIp; i++) expect((await ask(`user${i}@example.com`, '10.0.0.3')).statusCode).toBe(200)
    expect((await ask('another@example.com', '10.0.0.3')).statusCode).toBe(429)
    expect((await ask('another@example.com', '10.0.0.4')).statusCode).toBe(200)
    t.clock.advance(RESET_LIMIT.addressMs + 1)
    expect((await ask('limit@example.com')).statusCode).toBe(200)
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'limit@example.com')).toHaveLength(RESET_LIMIT.perAddress + 1)
  })

  it('sets the new password, signs every device out, confirms the address and clears the lockout; the link works once', async () => {
    const t = makeCloud()
    const u = await signup(t, 'reset@example.com')
    expect((await post(t, '/v1/auth/login', { email: 'reset@example.com', password: PW })).statusCode).toBe(200)
    const second = (await post(t, '/v1/auth/login', { email: 'reset@example.com', password: PW })).json() as { accessToken: string; refreshToken: string }
    for (let i = 0; i < 5; i++) await post(t, '/v1/auth/login', { email: 'reset@example.com', password: 'wrong password!' })
    expect((await post(t, '/v1/auth/login', { email: 'reset@example.com', password: PW })).statusCode).toBe(429)
    await post(t, '/v1/auth/forgot-password', { email: 'reset@example.com', lang: 'en' })
    const token = (await mailedToken(t, 'reset@example.com', '/nouveau-mot-de-passe'))!
    expect(mailsTo(t, 'reset@example.com', 'Reset your Atelier password')).toHaveLength(1)
    expect((await post(t, '/v1/auth/reset-password', { token, password: 'short' })).statusCode).toBe(400)
    const done = await post(t, '/v1/auth/reset-password', { token, password: NEW_PW })
    expect(done.json()).toEqual({ ok: true })
    // every session is gone: access and refresh tokens of both devices
    expect((await t.app.inject({ url: '/v1/me', headers: u.auth })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${second.accessToken}` } })).statusCode).toBe(401)
    expect((await post(t, '/v1/auth/refresh', { refreshToken: u.tokens.refreshToken })).statusCode).toBe(401)
    expect((await post(t, '/v1/auth/refresh', { refreshToken: second.refreshToken })).statusCode).toBe(401)
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL').get()).toEqual({ n: 0 })
    // the old password is dead, the new one works at once (the lockout was cleared), and the address is now verified
    expect((await post(t, '/v1/auth/login', { email: 'reset@example.com', password: PW })).statusCode).toBe(401)
    const fresh = await post(t, '/v1/auth/login', { email: 'reset@example.com', password: NEW_PW })
    expect(fresh.statusCode).toBe(200)
    const me = await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${(fresh.json() as { accessToken: string }).accessToken}` } })
    expect(me.json()).toMatchObject({ account: { emailVerified: true } })
    // the link is spent
    expect((await post(t, '/v1/auth/reset-password', { token, password: 'yet another passphrase' })).statusCode).toBe(410)
    expect((await post(t, '/v1/auth/login', { email: 'reset@example.com', password: NEW_PW })).statusCode).toBe(200)
    expect(t.cloud.audit.list(50).some((e) => e.action === 'auth.password_reset')).toBe(true)
  })

  it('a device login approved before the reset cannot turn into a session afterwards', async () => {
    const t = makeCloud()
    await signUpAndIn(t, { email: 'dl@example.com' })
    const { verifier, challenge } = newVerifier()
    const start = (await post(t, '/v1/auth/device/start', { codeChallenge: challenge, codeChallengeMethod: 'S256', deviceName: 'Mac' })).json() as { deviceCode: string; userCode: string }
    const form = await t.app.inject({ method: 'POST', url: '/device', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ code: start.userCode, email: 'dl@example.com', password: PW }).toString() })
    expect(form.statusCode).toBe(200)
    await post(t, '/v1/auth/forgot-password', { email: 'dl@example.com' })
    const token = (await mailedToken(t, 'dl@example.com', '/nouveau-mot-de-passe'))!
    await post(t, '/v1/auth/reset-password', { token, password: NEW_PW })
    expect((await post(t, '/v1/auth/device/poll', { deviceCode: start.deviceCode, codeVerifier: verifier })).statusCode).toBe(410)
  })
})

describe('billing and team-computer e-mails', () => {
  function setup() {
    const payments = new FakePayments()
    const t = makeCloud({ paymentProvider: payments })
    const owner = t.cloud.accounts.createAccount({ email: 'owner@example.com', name: 'Olivia', password: PW, actor: 'test' })
    const admin = t.cloud.accounts.createAccount({ email: 'admin@example.com', name: 'Adam', password: PW, teamId: owner.team.id, role: 'admin', lang: 'en', actor: 'test' })
    t.cloud.accounts.createAccount({ email: 'member@example.com', name: 'Max', password: PW, teamId: owner.team.id, role: 'member', actor: 'test' })
    const team = owner.team.id
    const pay = async (item: Parameters<typeof t.cloud.billing.checkout>[2]) => {
      const c = await t.cloud.billing.checkout(team, 'owner@example.com', item, { successUrl: 'https://atelier.test/ok', cancelUrl: 'https://atelier.test/no' })
      const signed = payments.complete(c.sessionId)
      await t.cloud.billing.webhook(signed.body, signed.signature)
      await t.cloud.billing.idle()
      await t.cloud.mail.idle()
      return signed
    }
    const event = async (e: PaymentEvent) => {
      const signed = payments.sign(e)
      const r = await t.cloud.billing.webhook(signed.body, signed.signature)
      await t.cloud.billing.idle()
      await t.cloud.mail.idle()
      return r
    }
    return { t, payments, team, owner: owner.account, admin: admin.account, pay, event }
  }

  it('a pack: one receipt to the owner and the admin (each in their language), none to a plain member; a replayed event mails nothing', async () => {
    const { t, pay, team } = setup()
    const signed = await pay({ kind: 'pack', pack: 'pack5k' })
    const fr = mailsTo(t, 'owner@example.com', 'Reçu')
    expect(fr).toHaveLength(1)
    expect(fr[0]!.subject).toBe('Reçu : Pack de 5 000 crédits')
    const body = flat(fr[0]!.text)
    expect(body).toContain('Montant : 47,50 € HT')
    expect(body).toContain('Crédits ajoutés : 5 000')
    expect(body).toContain('Bonjour Olivia,')
    const en = mailsTo(t, 'admin@example.com', 'Receipt')
    expect(en).toHaveLength(1)
    expect(flat(en[0]!.text)).toContain('Amount: €47.50 excl. VAT')
    expect(mailsTo(t, 'member@example.com')).toEqual([])
    // the same signed event again (the provider retries): nothing applied, nothing mailed
    const again = await t.cloud.billing.webhook(signed.body, signed.signature)
    expect(again.applied).toBe(false)
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'owner@example.com', 'Reçu')).toHaveLength(1)
    expect(mailsTo(t, 'admin@example.com', 'Receipt')).toHaveLength(1)
    expect(t.cloud.wallet.state(team).balance).toBe(5000)
  })

  it('a plan: a receipt, then one "ordinateur prêt" e-mail once the computers run; renewal, failed payment and cancellation each mail once', async () => {
    const { t, pay, event, team } = setup()
    await pay({ kind: 'subscription', plan: 'agency', period: 'month' })
    const receipt = mailsTo(t, 'owner@example.com', 'Reçu')
    expect(receipt).toHaveLength(1)
    expect(flat(receipt[0]!.text)).toContain('Plan Agency (mensuel)')
    expect(flat(receipt[0]!.text)).toContain('Montant : 399,99 € HT')
    expect(flat(receipt[0]!.text)).toContain('Crédits ajoutés : 14 000')
    const ready = mailsTo(t, 'owner@example.com', 'Tes ordinateurs')
    expect(ready).toHaveLength(1)
    expect(flat(ready[0]!.text)).toContain('2 ordinateurs d’équipe tournent')
    expect(mailsTo(t, 'admin@example.com', 'Your team computers are ready')).toHaveLength(1)
    // telling the team about the same machines again (a second provisioning pass) does not mail again
    const ids = t.cloud.machines().list(team).map((m) => m.id)
    new TeamNotices(t.cloud.accounts, t.cloud.mail).machinesReady(team, 'agency', ids)
    await t.cloud.mail.idle()
    expect(mailsTo(t, 'owner@example.com', 'Tes ordinateurs')).toHaveLength(1)

    await event({ id: 'evt_renew', type: 'subscription.renewed', subscriptionRef: `sub_fake_${team}` })
    expect(mailsTo(t, 'owner@example.com', 'Reçu : Renouvellement du plan Agency')).toHaveLength(1)
    await event({ id: 'evt_failed', type: 'payment.failed', subscriptionRef: `sub_fake_${team}` })
    expect(mailsTo(t, 'owner@example.com', 'Le paiement de ton plan Agency a échoué')).toHaveLength(1)
    await event({ id: 'evt_failed', type: 'payment.failed', subscriptionRef: `sub_fake_${team}` })
    expect(mailsTo(t, 'owner@example.com', 'Le paiement de ton plan Agency a échoué')).toHaveLength(1)
    await event({ id: 'evt_failed_2', type: 'payment.failed', subscriptionRef: `sub_fake_${team}` })
    expect(mailsTo(t, 'owner@example.com', 'Le paiement de ton plan Agency a échoué')).toHaveLength(2)
    await event({ id: 'evt_cancel', type: 'subscription.canceled', subscriptionRef: `sub_fake_${team}` })
    await event({ id: 'evt_cancel', type: 'subscription.canceled', subscriptionRef: `sub_fake_${team}` })
    expect(mailsTo(t, 'owner@example.com', 'Ton plan Agency est résilié')).toHaveLength(1)
    expect(mailsTo(t, 'admin@example.com', 'Your Agency plan has ended')).toHaveLength(1)
    // an event for a subscription nobody has says nothing
    const before = t.cloud.outbox!.list({ limit: 500 }).length
    await event({ id: 'evt_stranger', type: 'payment.failed', subscriptionRef: 'sub_unknown' })
    expect(t.cloud.outbox!.list({ limit: 500 }).length).toBe(before)
  })

  it('the automatic top-up: a receipt per charge; a declined card is told once, not at every spend, and again after a success', async () => {
    const { t, pay, payments, team } = setup()
    await pay({ kind: 'pack', pack: 'pack2k' })
    t.cloud.billing.setAutoRecharge(team, { enabled: true, thresholdCredits: 100_000, pack: 'pack2k', monthlyCapCents: 100_000 })
    const settle = async () => {
      await t.cloud.mail.idle()
    }
    payments.declined.add(`cus_fake_${team}`)
    for (let i = 0; i < 3; i++) expect((await t.cloud.billing.autoRecharge(team)).reason).toBe('card_declined')
    await settle()
    expect(mailsTo(t, 'owner@example.com', 'La recharge automatique a échoué')).toHaveLength(1)
    expect(flat(mailsTo(t, 'owner@example.com', 'La recharge automatique a échoué')[0]!.text)).toContain('20,00 € HT')
    expect(mailsTo(t, 'admin@example.com', 'Automatic top-up failed')).toHaveLength(1)
    payments.declined.delete(`cus_fake_${team}`)
    expect((await t.cloud.billing.autoRecharge(team)).charged).toBe(true)
    await settle()
    expect(mailsTo(t, 'owner@example.com', 'Reçu : Recharge automatique de 2 000 crédits')).toHaveLength(1)
    payments.declined.add(`cus_fake_${team}`)
    await t.cloud.billing.autoRecharge(team)
    await settle()
    expect(mailsTo(t, 'owner@example.com', 'La recharge automatique a échoué')).toHaveLength(2)
  })

  it('a dedupe key sends once; a failed send releases it; an e-mail is never sent inside a transaction', async () => {
    const t = makeCloud()
    const acc = t.cloud.accounts.createAccount({ email: 'once@example.com', name: 'O', password: PW, actor: 'test' }).account
    const tpl: Template = { kind: 'machine_ready', name: 'O', plan: 'Starter', count: 1, link: 'https://atelier.example/bienvenue' }
    const d = { to: acc.email, lang: 'fr' as const, template: tpl, dedupeKey: 'k1', accountId: acc.id }
    expect(t.cloud.mail.deliver(d)).toBe(true)
    expect(t.cloud.mail.deliver(d)).toBe(false)
    await t.cloud.mail.idle()
    expect(mailsTo(t, acc.email)).toHaveLength(1)
    expect(() => tx(t.cloud.db, () => t.cloud.mail.deliver({ ...d, dedupeKey: 'k2' }))).toThrow(/after the transaction commits/)
    expect(t.cloud.db.prepare("SELECT COUNT(*) AS n FROM mail_sent WHERE dedupe_key = 'k2'").get()).toEqual({ n: 0 })
  })

  it('a mail failure never fails the request or the payment event: it is audited, and the key is released for a retry', async () => {
    let failing = true
    const sent: MailMessage[] = []
    const mailer: Mailer = {
      kind: 'resend',
      async send(m) {
        if (failing) throw new MailError('Resend refused the message: HTTP 500')
        sent.push(m)
        return { id: 'm1' }
      }
    }
    const payments = new FakePayments()
    const t = makeCloud({ mailer, paymentProvider: payments })
    const up = await signup(t, 'fail@example.com')
    expect(up.status).toBe(200)
    await t.cloud.mail.idle()
    const team = ((await t.app.inject({ url: '/v1/me', headers: up.auth })).json() as { team: { id: string } }).team.id
    const c = await t.cloud.billing.checkout(team, 'fail@example.com', { kind: 'pack', pack: 'pack2k' }, { successUrl: 'https://a.test/ok', cancelUrl: 'https://a.test/no' })
    const signed = payments.complete(c.sessionId)
    expect(await t.cloud.billing.webhook(signed.body, signed.signature)).toEqual({ applied: true, type: 'checkout.completed' })
    await t.cloud.mail.idle()
    expect(t.cloud.wallet.state(team).balance).toBe(2000)
    const failures = t.cloud.audit.list(50).filter((e) => e.action === 'mail.failed')
    expect(failures.map((e) => (e.detail as { kind: string }).kind).sort()).toEqual(['receipt', 'verify'])
    expect(JSON.stringify(failures)).not.toContain('fail@example.com')
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM mail_sent').get()).toEqual({ n: 0 })
    // the provider is back: the same notice goes out
    failing = false
    t.cloud.mail.deliver({ to: 'fail@example.com', lang: 'fr', template: { kind: 'receipt', name: 'Léa', item: 'pack', credits: 2000, cents: 2000 }, dedupeKey: `receipt:evt_${c.sessionId}:x` })
    await t.cloud.mail.idle()
    expect(sent).toHaveLength(1)
  })

  it('computers are created only when someone who pays for the team has a verified address; verifying later creates them and mails the team', async () => {
    const payments = new FakePayments()
    const t = makeCloud({ paymentProvider: payments })
    const up = await signup(t, 'late@example.com')
    const team = ((await t.app.inject({ url: '/v1/me', headers: up.auth })).json() as { team: { id: string } }).team.id
    // the payment arrives (the provider's webhook is not gated), the credits are granted, the computers wait
    const signed = payments.sign({ id: 'evt_late', type: 'checkout.completed', teamId: team, item: { kind: 'subscription', plan: 'starter', period: 'month', cents: 4999 }, customerRef: 'cus_late', subscriptionRef: 'sub_late' })
    await t.cloud.billing.webhook(signed.body, signed.signature)
    await t.cloud.billing.idle()
    await t.cloud.mail.idle()
    expect(t.cloud.wallet.state(team).balance).toBe(1500)
    expect(t.cloud.machines().list(team)).toHaveLength(0)
    expect(t.cloud.audit.list(50).some((e) => e.action === 'billing.hook_failed' && e.target === team)).toBe(true)
    expect(mailsTo(t, 'late@example.com', 'Tes ordinateurs')).toHaveLength(0)
    await confirmEmail(t, 'late@example.com')
    await t.cloud.billing.idle()
    await t.cloud.mail.idle()
    expect(t.cloud.machines().list(team)).toHaveLength(1)
    expect(t.cloud.machines().list(team)[0]).toMatchObject({ status: 'running' })
    expect(mailsTo(t, 'late@example.com', 'Ton ordinateur d’équipe est prêt')).toHaveLength(1)
  })
})

describe('the admin tool', () => {
  const io = () => {
    const out: string[] = []
    const stdout = new PassThrough()
    stdout.on('data', (d) => out.push(String(d)))
    const stderr = new PassThrough()
    const stdin = Object.assign(new PassThrough(), { isTTY: false })
    return { stdin, stdout, stderr, text: () => out.join('') }
  }

  it('mail list and mail show print what the fake mailer kept; admin user verify confirms an address', async () => {
    const t = makeCloud()
    await signup(t, 'cli@example.com')
    await t.cloud.mail.idle()
    const a = io()
    expect(await runCli(['mail', 'list', '--to', 'cli@example.com'], { ...a, env: {}, cloud: t.cloud })).toBe(0)
    expect(a.text()).toContain('cli@example.com\tConfirme ton adresse e-mail')
    const id = /^(mail_\S+)\t/m.exec(a.text())![1]!
    const b = io()
    expect(await runCli(['mail', 'show', id], { ...b, env: {}, cloud: t.cloud })).toBe(0)
    expect(b.text()).toContain('/verifier?token=ver_')
    const c = io()
    expect(await runCli(['mail', 'show', 'mail_none'], { ...c, env: {}, cloud: t.cloud })).toBe(1)
    const d = io()
    expect(await runCli(['admin', 'user', 'verify', '--email', 'cli@example.com'], { ...d, env: {}, cloud: t.cloud })).toBe(0)
    expect(d.text()).toContain('marked verified')
    expect(t.cloud.accounts.accountByEmail('cli@example.com')!.emailVerified).toBe(true)
    // with the real mailer nothing is kept
    const quiet: string[] = []
    mailCli('list', [], new Map(), { outbox: null } as never, (s) => quiet.push(s))
    expect(quiet[0]).toContain('Resend')
  })

  it('no token, key or password reaches the logs of a full sign-up, reset and verification', async () => {
    const lines: string[] = []
    const sink = new Writable({ write: (c, _e, done) => (lines.push(String(c)), done()) })
    const t = makeCloud({ server: { logger: { level: 'trace', stream: sink } } })
    await signup(t, 'logs@example.com')
    await post(t, '/v1/auth/forgot-password', { email: 'logs@example.com' })
    const reset = (await mailedToken(t, 'logs@example.com', '/nouveau-mot-de-passe'))!
    const verify = (await mailedToken(t, 'logs@example.com', '/verifier'))!
    await post(t, '/v1/auth/verify-email', { token: verify })
    await post(t, '/v1/auth/reset-password', { token: reset, password: NEW_PW })
    const log = lines.join('\n')
    expect(lines.length).toBeGreaterThan(5)
    for (const secret of [reset, verify, NEW_PW, PW]) expect(log).not.toContain(secret)
  })
})
