// Test rig of the app's Atelier Cloud client (lot P5): an in-process Cloud (fakes, loopback only, nothing paid) listening
// on 127.0.0.1:0, and an app core pointed at it with a movable clock and a fetch that can play an unreachable Cloud.
import type { AddressInfo } from 'node:net'
import { vi } from 'vitest'
import { createCore, type CoreOptions } from '../../src/main/core'
import { ACCESS_SECRET, EXPIRES_KEY, REFRESH_SECRET } from '../../src/main/cloud/session'
import { okTester, testCipher } from './helpers'

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: they are loaded
// through a computed path (typed here by hand) so the typecheck of the app never walks into cloud/.
export interface TestCloud {
  app: {
    listen(o: { host: string; port: number }): Promise<string>
    server: { address(): unknown }
    inject(o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<{ statusCode: number; body: string; json(): unknown }>
  }
  clock: { advance(ms: number): void }
  cloud: {
    accounts: { createAccount(p: { email: string; name: string; password: string; teamName?: string; actor: string }): { account: { id: string }; team: { id: string } } }
    wallet: { grant(p: { teamId: string; credits: number; idemKey: string; actor: string }): unknown; state(teamId: string): { balance: number; held: number; available: number } }
    auth: { revokeDevice(deviceId: string, by: { accountId: string; platformAdmin: boolean }): void }
    jobs: { whenIdle(): Promise<void> }
    finance: { setMultiplier(value: number | null, actor: string): void }
  }
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
const HELPERS = 'helpers'
export const cloudHelpers = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  PASSWORD: string
  makeCloud(o?: Record<string, unknown>): TestCloud
  signUpAndIn(t: TestCloud, p: { credits?: number; email?: string }): Promise<Person>
  quoteAndRun(t: TestCloud, who: Person, usage: string, input: Record<string, unknown>): Promise<{ quote: { id: string; totalCredits: number }; job: Record<string, unknown> & { id: string; state: string } }>
}

export interface CloudRig {
  t: TestCloud
  baseUrl: string
  accountId: string
  teamId: string
  email: string
}

/** An in-process Cloud on a loopback port with one account (and its team holding `credits`); `options` go to createCloud. */
export async function startCloud(credits = 1000, options?: Record<string, unknown>): Promise<CloudRig> {
  const t = cloudHelpers.makeCloud(options)
  const email = `charlie-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { account, team } = t.cloud.accounts.createAccount({ email, name: 'Charlie', password: cloudHelpers.PASSWORD, teamName: 'Studio Charlie', actor: 'test' })
  if (credits > 0) t.cloud.wallet.grant({ teamId: team.id, credits, idemKey: `seed:${account.id}`, actor: 'test' })
  await t.app.listen({ host: '127.0.0.1', port: 0 })
  const baseUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`
  return { t, baseUrl, accountId: account.id, teamId: team.id, email }
}

/** Plays the person in the browser: signs in on the Cloud's /device page and approves the code shown by the app. */
export async function approveInBrowser(rig: CloudRig, userCode: string): Promise<void> {
  const res = await rig.t.app.inject({
    method: 'POST',
    url: '/device',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ code: userCode, email: rig.email, password: cloudHelpers.PASSWORD }).toString()
  })
  if (res.statusCode !== 200) throw new Error(`/device answered ${res.statusCode}`)
}

export interface AppRig {
  core: ReturnType<typeof createCore>
  clock: { now: number }
  /** true = every Cloud request fails as if the Cloud were down. */
  net: { down: boolean; gate: ((url: string) => Promise<void>) | null }
  opened: string[]
}

/** An app core with a movable clock, a fetch that can be cut, and the opened browser pages recorded. */
export function appCore(extra: Partial<CoreOptions> = {}): AppRig {
  const clock = { now: Date.now() }
  const net: AppRig['net'] = { down: false, gate: null }
  const opened: string[] = []
  const cloudFetch: typeof fetch = async (input, init) => {
    if (net.down) throw new TypeError('fetch failed')
    // a test may hold a request on its way (`gate`), then let it through
    const answer = await fetch(input, init)
    await net.gate?.(String(input))
    return answer
  }
  const core = createCore({
    paths: { dbPath: ':memory:' },
    cipher: testCipher(),
    tester: okTester,
    now: () => new Date(clock.now),
    cloudFetch,
    cloudPollMs: 50,
    openExternal: (url) => void opened.push(url),
    ...extra
  })
  return { core, clock, net, opened }
}

/** Device login through the IPC methods, the test playing the browser. */
export async function connect(app: AppRig, rig: CloudRig): Promise<void> {
  const api = app.core.api
  await api['cloud.setBaseUrl'](rig.baseUrl)
  const state = await api['cloud.connect']()
  if (typeof state !== 'object' || !('pending' in state)) throw new Error(`no pending login: ${JSON.stringify(state)}`)
  await approveInBrowser(rig, state.userCode)
  await vi.waitFor(() => {
    if (api['cloud.loginState']() !== 'connected') throw new Error('still pending')
  }, { timeout: 10_000, interval: 10 })
}

/** Puts a person's tokens straight into the app (for tests about what happens after a login). */
export function adopt(app: AppRig, baseUrl: string, p: Person): void {
  const { settings, secrets } = app.core.context
  settings.set('cloud.baseUrl', baseUrl)
  secrets.set(ACCESS_SECRET, p.accessToken)
  secrets.set(REFRESH_SECRET, p.refreshToken)
  settings.set(EXPIRES_KEY, app.clock.now + 3600_000)
}
