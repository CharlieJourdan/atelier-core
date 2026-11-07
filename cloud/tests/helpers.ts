// Test helpers: an in-memory Cloud with a manual clock and an injected master key, its Fastify app (inject only, no
// socket), and the full device sign-in done the way the app and the browser will do it.
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach } from 'vitest'
import { pkceChallenge } from '../../src/shared/cloud-api.ts'
import { ManualClock } from '../src/clock.ts'
import { createCloud, type Cloud, type CloudOptions } from '../src/cloud.ts'
import { buildServer, type ServerOptions } from '../src/http/server.ts'
import { trackTemp } from '../../tests/setup/track-temp'
import { staticKeySource } from '../src/keysource.ts'

export const TEST_MASTER_KEY = Buffer.alloc(32, 7)
export const PASSWORD = 'correct horse battery'

// Warm-up at import time: Fastify loads its inject machinery and the first scrypt allocates lazily, which on a loaded
// machine can take longer than a whole test. Paying it here keeps that cost out of the first test of each file.
{
  const warm = createCloud({ dbPath: ':memory:', filesDir: tmpdir(), signingKey: Buffer.alloc(32, 1), keySource: null, paidCalls: false })
  const app = buildServer(warm)
  await app.inject({ url: '/v1/me' })
  warm.accounts.createAccount({ email: 'warm@example.com', name: 'Warm', password: PASSWORD, actor: 'warm-up' })
  await app.close()
  await warm.close()
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

/** Runs `fn` after the current test; cleanups run last-in first-out, so register before makeCloud to run after the cloud is closed. */
export function onCleanup(fn: () => Promise<void> | void): void {
  cleanups.push(fn)
}

export interface TestCloud {
  cloud: Cloud
  app: FastifyInstance
  clock: ManualClock
  dir: string
}

/**
 * `gridMargins`: price with each grid line's own margin (decision 0015) instead of the global multiplier, which a fresh
 * database sets to 1.0 (sold at cost, the beta rule of decision 0040). For the tests written about the grid's margins.
 */
export function makeCloud({ gridMargins, ...o }: Partial<CloudOptions> & { server?: ServerOptions; gridMargins?: boolean } = {}): TestCloud {
  const dir = trackTemp(mkdtempSync(join(tmpdir(), 'atelier-cloud-test-')))
  const clock = (o.clock as ManualClock | undefined) ?? new ManualClock()
  const cloud = createCloud({
    dbPath: ':memory:',
    filesDir: dir,
    signingKey: Buffer.alloc(32, 3),
    keySource: staticKeySource(TEST_MASTER_KEY),
    paidCalls: false,
    retryDelayMs: 0,
    ...o,
    clock
  })
  if (gridMargins) cloud.finance.setMultiplier(null, 'test')
  const app = buildServer(cloud, { uploadsDir: join(dir, 'incoming'), ...o.server })
  cleanups.push(async () => {
    await app.close()
    await cloud.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { cloud, app, clock, dir }
}

/** A silent PCM WAV of `seconds` (8 kHz, mono, 8-bit): the voice a talking-avatar quote reads the length of (decision 0076). */
export function wavBytes(seconds: number, rate = 8000): Buffer {
  const data = Math.round(seconds * rate)
  const b = Buffer.alloc(44 + data, 128)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(data, 40)
  return b
}

export const sha256 = (s: string): Uint8Array => createHash('sha256').update(s).digest()

export function newVerifier(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: pkceChallenge(verifier, sha256) }
}

export interface Person {
  accountId: string
  teamId: string
  email: string
  accessToken: string
  refreshToken: string
  deviceId: string
  auth: { authorization: string }
}

/** Creates an account (own team unless `teamId`) and signs it in through device/start → /device form → device/poll. */
export async function signUpAndIn(
  t: TestCloud,
  p: { email?: string; platformAdmin?: boolean; internal?: boolean; teamId?: string; role?: 'admin' | 'member'; credits?: number } = {}
): Promise<Person> {
  const email = p.email ?? `person-${randomBytes(4).toString('hex')}@example.com`
  const { account, team } = t.cloud.accounts.createAccount({
    email,
    name: 'Test',
    password: PASSWORD,
    platformAdmin: p.platformAdmin,
    internal: p.internal,
    teamId: p.teamId,
    role: p.role,
    actor: 'test'
  })
  if (p.credits) t.cloud.wallet.grant({ teamId: team.id, credits: p.credits, idemKey: `seed:${account.id}`, actor: 'test' })
  const tokens = await signIn(t, email)
  return { accountId: account.id, teamId: team.id, email, ...tokens, auth: { authorization: `Bearer ${tokens.accessToken}` } }
}

/** Gives a team a running plan, as a paid checkout does (the kit routes need one, or an enrolled team computer). */
export function givePlan(t: TestCloud, teamId: string, plan = 'starter', status: 'active' | 'past_due' | 'canceled' = 'active'): void {
  t.cloud.db
    .prepare(
      `INSERT INTO billing_subscriptions (team_id, plan, period, status, since, updated_at) VALUES (?, ?, 'month', ?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET plan = excluded.plan, status = excluded.status`
    )
    .run(teamId, plan, status, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
}

export async function signIn(t: TestCloud, email: string, password = PASSWORD) {
  const { verifier, challenge } = newVerifier()
  const start = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/device/start',
    payload: { codeChallenge: challenge, codeChallengeMethod: 'S256', deviceName: 'Mac de test' }
  })
  if (start.statusCode !== 200) throw new Error(`device/start ${start.statusCode} ${start.body}`)
  const { deviceCode, userCode } = start.json() as { deviceCode: string; userCode: string }
  const approve = await t.app.inject({
    method: 'POST',
    url: '/device',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ code: userCode, email, password }).toString()
  })
  if (approve.statusCode !== 200) throw new Error(`/device ${approve.statusCode}`)
  const poll = await t.app.inject({ method: 'POST', url: '/v1/auth/device/poll', payload: { deviceCode, codeVerifier: verifier } })
  if (poll.statusCode !== 200) throw new Error(`device/poll ${poll.statusCode} ${poll.body}`)
  return poll.json() as { accessToken: string; refreshToken: string; deviceId: string }
}

/** Parses a text/event-stream body into its JSON `data:` payloads. */
export function parseSse(body: string): { id: number; event: string; data: Record<string, unknown> }[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith(':'))
    .map((block) => {
      const lines = Object.fromEntries(
        block.split('\n').map((l) => {
          const i = l.indexOf(': ')
          return [l.slice(0, i), l.slice(i + 2)]
        })
      ) as Record<string, string>
      return { id: Number(lines.id), event: lines.event as string, data: JSON.parse(lines.data as string) as Record<string, unknown> }
    })
}

/** A quote then a job for `usage`; waits for the job to end and returns its final state. */
export async function quoteAndRun(t: TestCloud, who: Person, usage: string, input: Record<string, unknown>, key = randomBytes(8).toString('hex')) {
  const q = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: who.auth, payload: { usage, input } })
  if (q.statusCode !== 200) throw new Error(`quote ${q.statusCode} ${q.body}`)
  const quote = q.json() as { id: string; totalCredits: number }
  const j = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: who.auth, payload: { quoteId: quote.id, idempotencyKey: `job-${key}` } })
  if (j.statusCode !== 200) throw new Error(`job ${j.statusCode} ${j.body}`)
  await t.cloud.jobs.whenIdle()
  const done = await t.app.inject({ method: 'GET', url: `/v1/jobs/${(j.json() as { id: string }).id}`, headers: who.auth })
  return { quote, job: done.json() as Record<string, unknown> & { id: string; state: string; artefacts: { id: string; sha256: string; size: number }[] } }
}

/** The newest token the Cloud mailed to an address for a link on `path` (/verifier, /nouveau-mot-de-passe), read from the
 *  fake mailer's outbox once the queue is empty. Null when no such e-mail was sent. */
export async function mailedToken(t: TestCloud, email: string, path: string): Promise<string | null> {
  await t.cloud.mail.idle()
  for (const m of t.cloud.outbox?.list({ to: email, limit: 100 }) ?? []) {
    const at = m.text.indexOf(`${path}?token=`)
    if (at >= 0) return /^[A-Za-z0-9_-]+/.exec(m.text.slice(at + path.length + '?token='.length))?.[0] ?? null
  }
  return null
}

/** Uses the verification link mailed at sign-up, like a person clicking it. */
export async function confirmEmail(t: TestCloud, email: string): Promise<void> {
  const token = await mailedToken(t, email, '/verifier')
  if (!token) throw new Error(`no verification e-mail for ${email}`)
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/verify-email', payload: { token } })
  if (res.statusCode !== 200) throw new Error(`verify-email ${res.statusCode} ${res.body}`)
}
