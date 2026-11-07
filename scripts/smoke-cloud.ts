// End-to-end smoke of Atelier Cloud over real HTTP (PLAN-V2-PRODUCTION §7, proof of P3): start the server the way
// `npm run cloud:dev` does, create an account with the admin tool (password on stdin), grant 1 000 credits, sign in by
// device login + PKCE (the browser step is the /device form), get a quote, run a fake voice, follow its event
// stream, then download the file through its signed link and compare it with the sample voice byte for byte.
// Free: fake providers only, paidCalls off, a throwaway data folder. Run with `npm run smoke:cloud`.
//   ATELIER_CLOUD_SMOKE_PORT  the port (default 0 = any free port, so the smoke never collides with a running
//                             `cloud:dev` or another local app on 8787; set 8787 to smoke on the cloud:dev port)
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { pkceChallenge } from '../src/shared/cloud-api'
import { FAKE_VOICE_FILE } from '../cloud/src/providers/fakes'

const ROOT = path.join(__dirname, '..')
const NODE_ARGS = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']
const PASSWORD = `smoke-${randomBytes(12).toString('hex')}`
const out = (line: string): void => void writeSync(1, line + '\n')
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => void checks.push({ name, ok, detail })

const data = mkdtempSync(path.join(os.tmpdir(), 'atelier-cloud-smoke-'))
const env = { ...process.env, ATELIER_CLOUD_DATA: data, ATELIER_CLOUD_PORT: process.env.ATELIER_CLOUD_SMOKE_PORT ?? '0', ATELIER_CLOUD_LOG: 'warn' }
delete (env as Record<string, string | undefined>).ATELIER_CLOUD_MASTER_KEY_FILE
let server: ChildProcess | null = null

afterAll(async () => {
  // Wait for the server to exit: on Windows its database stays locked until then and the folder cannot be removed.
  const s = server
  if (s && s.exitCode === null && s.signalCode === null) {
    const exited = new Promise((resolve) => s.once('exit', resolve))
    s.kill()
    await exited
  }
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function cli(args: string[], stdin = ''): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [...NODE_ARGS, path.join(ROOT, 'cloud', 'src', 'cli.ts'), ...args], { env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += String(d)))
    p.stderr.on('data', (d) => (stderr += String(d)))
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    p.stdin.end(stdin)
  })
}

function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [...NODE_ARGS, path.join(ROOT, 'cloud', 'src', 'main.ts')], { env, windowsHide: true })
    let log = ''
    const timer = setTimeout(() => reject(new Error(`the Cloud did not start: ${log}`)), 120_000)
    server.stdout?.on('data', (d) => {
      log += String(d)
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(log)
      if (m) {
        clearTimeout(timer)
        resolve(m[1] as string)
      }
    })
    server.stderr?.on('data', (d) => (log += String(d)))
    server.on('exit', (code) => reject(new Error(`the Cloud exited (${code}): ${log}`)))
  })
}

it('cloud:dev → account → 1 000 credits → quote → fake voice → file', async () => {
  const base = await startServer()
  check('the Cloud listens on the loopback only', base.startsWith('http://127.0.0.1:'), base)
  const json = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  const add = await cli(['admin', 'user', 'add', '--from-stdin', '--email', 'smoke@example.com', '--name', 'Smoke'], PASSWORD + '\n')
  const teamId = /team (team_\S+)/.exec(add.stdout)?.[1] ?? ''
  check('admin user add creates an account and its team (password read from stdin)', add.code === 0 && teamId !== '', add.stdout.trim() || add.stderr)
  const grant = await cli(['admin', 'grant', '--team', teamId, '--credits', '1000', '--key', 'smoke-grant'])
  check('admin grant adds 1 000 credits', grant.code === 0 && grant.stdout.includes('balance 1000'), grant.stdout.trim() || grant.stderr)

  const verifier = randomBytes(32).toString('base64url')
  const challenge = pkceChallenge(verifier, (s) => createHash('sha256').update(s).digest())
  const start = await json('POST', '/v1/auth/device/start', { codeChallenge: challenge, codeChallengeMethod: 'S256', deviceName: 'smoke' })
  const pending = await json('POST', '/v1/auth/device/poll', { deviceCode: start.body.deviceCode, codeVerifier: verifier })
  check('device login is pending before the browser step', pending.status === 428, String(pending.status))
  const page = await fetch(start.body.verificationUri as string)
  check('the verification page opens', page.status === 200 && (await page.text()).includes('Autoriser cet appareil'))
  const approve = await fetch(`${base}/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: start.body.userCode as string, email: 'smoke@example.com', password: PASSWORD }).toString()
  })
  check('the browser step approves the device', approve.status === 200)
  const tokens = await json('POST', '/v1/auth/device/poll', { deviceCode: start.body.deviceCode, codeVerifier: verifier })
  const token = tokens.body.accessToken as string
  check('device/poll with the PKCE verifier gives the tokens', tokens.status === 200 && typeof token === 'string')

  const me = await json('GET', '/v1/me', undefined, token)
  check('GET /v1/me shows 1 000 credits', (me.body.wallet as { balance: number }).balance === 1000, JSON.stringify(me.body.wallet))
  const catalog = await json('GET', '/v1/catalog', undefined, token)
  check('every provider is a demo', (catalog.body.providers as { status: string }[]).every((p) => p.status === 'demo'))

  const quote = await json('POST', '/v1/quotes', { usage: 'synthesize', input: { text: 'Bienvenue dans Atelier, ceci est une voix de démonstration.', voiceId: 'demo-claire' } }, token)
  const credits = quote.body.totalCredits as number
  check('a quote for a fake voice', quote.status === 200 && credits >= 1, `${credits} credits, reference €${String(quote.body.referenceEur)}`)
  const job = await json('POST', '/v1/jobs', { quoteId: quote.body.id, idempotencyKey: 'smoke-voice-1' }, token)
  check('the job is accepted', job.status === 200, String(job.body.state))

  const stream = await fetch(`${base}/v1/jobs/${String(job.body.id)}/events`, { headers: { authorization: `Bearer ${token}` } })
  const events = (await stream.text()).split('\n').filter((l) => l.startsWith('event: ')).map((l) => l.slice(7))
  check('the event stream ends with succeeded', events.at(-1) === 'succeeded', events.join(' → '))
  const done = await json('GET', `/v1/jobs/${String(job.body.id)}`, undefined, token)
  const artefact = (done.body.artefacts as { id: string }[])[0]
  const link = await json('GET', `/v1/artefacts/${artefact?.id ?? ''}`, undefined, token)
  const file = Buffer.from(await (await fetch(link.body.url as string)).arrayBuffer())
  const voice = readFileSync(FAKE_VOICE_FILE)
  check('the file from the signed link is the fake voice, byte for byte', file.equals(voice), `${file.length} bytes, link valid until ${String(link.body.expiresAt)}`)
  const wallet = await json('GET', '/v1/wallet', undefined, token)
  check('the wallet is 1 000 minus the quote, nothing held', wallet.body.balance === 1000 - credits && wallet.body.held === 0, JSON.stringify(wallet.body))
  // the publication kit: refused to a team without a plan, then (plan bought with the simulated payment) a three-step
  // upload read back with a signed link, byte for byte (local files, no bucket)
  const freeKit = await json('POST', '/v1/team/videos/7/kit', { title: 'Kit de démonstration', description: 'Une description.', demo: true }, token)
  check('a team without a plan stores no kit (403)', freeKit.status === 403, String(freeKit.status))
  const site = 'http://localhost:5190'
  const checkout = await json('POST', '/v1/billing/checkout', { item: { kind: 'subscription', plan: 'starter', period: 'month' }, successUrl: `${site}/ok`, cancelUrl: `${site}/ko` }, token)
  const paid = await json('POST', '/v1/billing/demo-complete', { sessionId: checkout.body.sessionId }, token)
  check('the simulated payment gives the team the Starter plan', checkout.status === 200 && paid.status === 200, `${checkout.status} ${paid.status}`)
  const kitBytes = randomBytes(300_000)
  const kitStart = await json('POST', '/v1/team/videos/7/kit', { title: 'Kit de démonstration', description: 'Une description.', tags: ['démo'], demo: true }, token)
  const kitId = String(kitStart.body.kitId)
  const kitUpload = await fetch(`${base}/v1/team/videos/7/kit/${kitId}/files?name=video.mp4&sha256=${createHash('sha256').update(kitBytes).digest('hex')}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: kitBytes
  })
  const kitDone = await json('POST', `/v1/team/videos/7/kit/${kitId}/complete`, undefined, token)
  const kit = await json('GET', '/v1/team/videos/7/kit', undefined, token)
  const kitFile = (kit.body.files as { name: string; url: string }[])[0]
  const kitDownload = Buffer.from(await (await fetch(kitFile?.url ?? base)).arrayBuffer())
  check('a publication kit uploads in three steps and downloads byte for byte', kitStart.status === 200 && kitUpload.status === 200 && kitDone.status === 200 && kitDownload.equals(kitBytes), `${kitDownload.length} bytes`)
  const noKit = await json('GET', '/v1/team/videos/8/kit', undefined, token)
  check('another video has no kit (404)', noKit.status === 404)
  const list = await cli(['vault', 'list'])
  check('the vault holds nothing (no key needed for demos)', list.stdout.includes('(the vault is empty)') || list.stderr.includes('no master key'), list.stdout.trim())

  const failed = checks.filter((c) => !c.ok)
  out(`===== SMOKE CLOUD: ${failed.length === 0 ? 'PASS' : 'FAIL'} =====`)
  for (const c of checks) out(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' - ' + c.detail : ''}`)
  expect(failed).toEqual([])
})
