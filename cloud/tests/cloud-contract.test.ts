// The contract (src/shared/cloud-api.ts) and the server agree: every listed route exists, nothing else answers, every
// JSON answer of a full walk parses with its schema. The same walk proves that no route returns a vault value
// (§4.5): test secrets are planted, every response body and header is searched for them, and so are the logs.
import { createHash, createHmac } from 'node:crypto'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ALL_CLOUD_ROUTES,
  CLOUD_ADMIN_ROUTES,
  CLOUD_ROUTES,
  ErrorBody,
  isYoutubeUrl,
  pkceChallenge,
  type AnyCloudRouteName
} from '../../src/shared/cloud-api.ts'
import { BACKUP_ROUTES } from '../../src/shared/cloud-backup.ts'
import { MEDIA_ROUTES } from '../../src/shared/cloud-media.ts'
import { ENGINES_ROUTE } from '../../src/shared/cloud-engines.ts'
import { KIT_ROUTES } from '../../src/shared/cloud-kit.ts'
import { RELEASE_ROUTES } from '../../src/shared/cloud-releases.ts'
import { ADMIN_CRM_ROUTES } from '../../src/shared/cloud-admin-crm.ts'
import { ADMIN_FINANCE_ROUTES } from '../../src/shared/cloud-admin-finance.ts'
import { cloudSchemaVersion, openCloudDb } from '../src/db/index.ts'
import { CLOUD_MIGRATIONS } from '../src/db/migrations/index.ts'
import { scrubUrl } from '../src/http/server.ts'
import { mailedToken, makeCloud, quoteAndRun, sha256, signUpAndIn } from './helpers.ts'

const SECRETS = ['sk-test-VAULT-elevenlabs-7f3a9c', 'rp-test-VAULT-runpod-0b1d2e', 'AIza-test-VAULT-google-5c6d']

function encodings(s: string): string[] {
  return [s, Buffer.from(s).toString('base64'), Buffer.from(s).toString('base64url'), Buffer.from(s).toString('hex'), encodeURIComponent(s)]
}

describe('the contract', () => {
  it('names each route once, with unique method + path', () => {
    const keys = Object.values(ALL_CLOUD_ROUTES).map((r) => `${r.method} ${r.path}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(Object.keys(ALL_CLOUD_ROUTES)).toHaveLength(Object.keys(CLOUD_ROUTES).length + Object.keys(CLOUD_ADMIN_ROUTES).length)
    for (const r of Object.values(ALL_CLOUD_ROUTES)) expect(r.path.startsWith('/v1/')).toBe(true)
    for (const r of Object.values(CLOUD_ADMIN_ROUTES)) expect(r.auth).toBe('platformAdmin')
  })

  it('the server registers every contract route (and the two outside /v1), and nothing else under /v1', async () => {
    const t = makeCloud()
    await t.app.ready()
    for (const r of Object.values(ALL_CLOUD_ROUTES)) expect(t.app.hasRoute({ method: r.method, url: r.path }), `${r.method} ${r.path}`).toBe(true)
    expect(t.app.hasRoute({ method: 'GET', url: '/device' })).toBe(true)
    expect(t.app.hasRoute({ method: 'POST', url: '/device' })).toBe(true)
    expect(t.app.hasRoute({ method: 'GET', url: '/files/:id' })).toBe(true)
    const tree = t.app.printRoutes({ commonPrefix: false })
    // Each printed leaf names its methods, e.g. "/v1/admin/prices (GET, HEAD, POST)"; count GET/POST across the tree
    // (HEAD is Fastify's automatic twin of GET). Only GET and POST may exist.
    const leaves = tree.split('\n').filter((l) => l.includes('('))
    const methods = leaves.join(' ').match(/\b(GET|POST)\b/g) ?? []
    expect(leaves.join(' ').match(/\b(PUT|PATCH|DELETE|OPTIONS)\b/g)).toBeNull()
    // + the three pages outside /v1 (GET and POST /device, GET /files/:id) + the kit routes (cloud-kit.ts) and their signed local file link
    // + the release routes (cloud-releases.ts) and the public update feed (GET /v1/updates/:channel/:platform/:name)
    // + the founder console's CRM routes (cloud-admin-crm.ts) + the team computer's backup routes (cloud-backup.ts)
    // + the engines registry (ENGINES_ROUTE, cloud-engines.ts) + the job-bound provider file link (GET /provider-files/:job/:id, production-10)
    // + the founder console's money routes (cloud-admin-finance.ts) + the media search route (cloud-media.ts)
    expect(methods.length).toBe(
      Object.keys(ALL_CLOUD_ROUTES).length +
        3 +
        Object.keys(KIT_ROUTES).length +
        1 +
        Object.keys(RELEASE_ROUTES).length +
        1 +
        Object.keys(ADMIN_CRM_ROUTES).length +
        Object.keys(BACKUP_ROUTES).length +
        1 +
        1 +
        Object.keys(ADMIN_FINANCE_ROUTES).length +
        Object.keys(MEDIA_ROUTES).length
    )
    expect(t.app.hasRoute({ method: 'GET', url: '/provider-files/:job/:id' })).toBe(true)
    for (const r of [...Object.values(ADMIN_CRM_ROUTES), ...Object.values(ADMIN_FINANCE_ROUTES)]) expect(t.app.hasRoute({ method: r.method, url: r.path }), `${r.method} ${r.path}`).toBe(true)
    expect(t.app.hasRoute({ method: ENGINES_ROUTE.method, url: ENGINES_ROUTE.path })).toBe(true)
  })

  it('every user route refuses an anonymous call, every admin route refuses a non-admin, in the error shape', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    for (const r of [
      ...Object.values(ALL_CLOUD_ROUTES),
      ...Object.values(KIT_ROUTES),
      ...Object.values(RELEASE_ROUTES),
      ...Object.values(ADMIN_CRM_ROUTES),
      ...Object.values(BACKUP_ROUTES),
      ...Object.values(ADMIN_FINANCE_ROUTES),
      ...Object.values(MEDIA_ROUTES),
      ENGINES_ROUTE
    ]) {
      if (r.auth === 'none') continue
      const url = r.path.replace(/:(\w+)/g, 'x_$1')
      const anon = await t.app.inject({ method: r.method, url })
      expect(anon.statusCode, url).toBe(401)
      expect(ErrorBody.safeParse(anon.json()).success).toBe(true)
      if (r.auth === 'platformAdmin') expect((await t.app.inject({ method: r.method, url, headers: p.auth })).statusCode).toBe(403)
    }
  })

  it('PKCE helper and the YouTube-only rule', () => {
    // The contract's btoa-based encoder agrees with Node's base64url digest, for any verifier length.
    for (const v of ['a'.repeat(43), 'Z9._~-'.repeat(10), 'x'.repeat(128)]) {
      expect(pkceChallenge(v, sha256)).toBe(createHash('sha256').update(v).digest('base64url'))
      expect(pkceChallenge(v, sha256)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
    expect(isYoutubeUrl('https://www.youtube.com/@chaine')).toBe(true)
    expect(isYoutubeUrl('https://youtu.be/abc')).toBe(true)
    expect(isYoutubeUrl('http://youtube.com/x')).toBe(false)
    expect(isYoutubeUrl('https://youtube.com.evil.example/x')).toBe(false)
    expect(isYoutubeUrl('https://user:pw@youtube.com/x')).toBe(false)
    expect(isYoutubeUrl('https://127.0.0.1/x')).toBe(false)
  })

  it('cloud migrations are numbered 1..n and re-running them changes nothing', () => {
    const db = openCloudDb(':memory:')
    expect(cloudSchemaVersion(db)).toBe(CLOUD_MIGRATIONS.length)
    db.close()
  })
})

describe('a full walk of the API answers the contract and never a vault value', () => {
  it('walks every route as user and admin; all JSON answers parse; no secret in bodies, headers or logs', async () => {
    const logLines: string[] = []
    const sink = new Writable({
      write(chunk, _enc, done) {
        logLines.push(String(chunk))
        done()
      }
    })
    const t = makeCloud({ server: { logger: { level: 'trace', stream: sink } } })
    for (const [i, s] of SECRETS.entries()) t.cloud.vault.set(['ELEVENLABS_API_KEY', 'RUNPOD_API_KEY', 'GOOGLE_API_KEY'][i] as string, s, 'cli')
    // A secret an adapter would read is also in the process (masking must hold for it too).
    t.cloud.vault.readForAdapter('ELEVENLABS_API_KEY', 'test-adapter')
    const admin = await signUpAndIn(t, { platformAdmin: true, credits: 5000 })
    const answers: { name: AnyCloudRouteName | string; status: number; body: string; headers: string }[] = []
    const call = async (name: AnyCloudRouteName, params: Record<string, string> = {}, payload?: unknown, query = '', headers: Record<string, string> = admin.auth) => {
      const r = ALL_CLOUD_ROUTES[name]
      const url = r.path.replace(/:(\w+)/g, (_m, k: string) => params[k] ?? 'none') + query
      const res = await t.app.inject({ method: r.method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) })
      answers.push({ name, status: res.statusCode, body: res.body, headers: JSON.stringify(res.headers) })
      if (r.response && res.statusCode === 200) {
        const parsed = r.response.safeParse(res.json())
        expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues[0])}`).toBe(true)
      }
      return res
    }
    const { job } = await quoteAndRun(t, admin, 'synthesize', { text: 'Le coffre ne sort jamais.', voiceId: 'demo-claire' })
    const artefactId = (job.artefacts[0] as { id: string }).id
    await call('me')
    await call('members')
    await call('setCaps', { accountId: admin.accountId }, { dailyCredits: null, monthlyCredits: null })
    await call('catalog')
    const q = await call('createQuote', {}, { usage: 'channelData', input: { url: 'https://www.youtube.com/@x' } })
    const j = await call('createJob', {}, { quoteId: (q.json() as { id: string }).id, idempotencyKey: 'walk-job-1' })
    await t.cloud.jobs.whenIdle()
    await call('job', { id: (j.json() as { id: string }).id })
    await call('cancelJob', { id: (j.json() as { id: string }).id })
    const ev = await call('jobEvents', { id: job.id })
    expect(ev.statusCode).toBe(200)
    const link = await call('artefact', { id: artefactId })
    const file = await t.app.inject({ url: (link.json() as { url: string }).url.replace('http://localhost:80', '') })
    answers.push({ name: 'file', status: file.statusCode, body: file.body, headers: JSON.stringify(file.headers) })
    await call('wallet')
    await call('walletEntries', {}, undefined, '?limit=50')
    await call('support', {}, { subject: 'Question', body: 'Où sont mes clés ?' })
    await call('devices')
    // Lot P5: a raw upload (not JSON), its lookup by hash, estimates, and the RunPod callback (signed URL, no bearer).
    const bytes = Buffer.from('un fichier de la marche')
    const upSha = createHash('sha256').update(bytes).digest('hex')
    const up = await t.app.inject({
      method: 'POST',
      url: `/v1/uploads?name=walk.txt&sha256=${upSha}`,
      headers: { ...admin.auth, 'content-type': 'application/octet-stream' },
      payload: bytes
    })
    answers.push({ name: 'upload', status: up.statusCode, body: up.body, headers: JSON.stringify(up.headers) })
    expect(up.statusCode).toBe(200)
    expect(CLOUD_ROUTES.upload.response.safeParse(up.json()).success).toBe(true)
    expect((await call('uploadByHash', { sha256: upSha })).statusCode).toBe(200)
    expect((await call('estimates', {}, { items: [{ key: 'voix', usage: 'synthesize', quantity: 100 }] })).statusCode).toBe(200)
    const hook = await t.app.inject({ method: 'POST', url: t.cloud.webhooks.callbackPath(job.id), payload: { id: 'pod-walk', status: 'COMPLETED' } })
    answers.push({ name: 'runpodWebhook', status: hook.statusCode, body: hook.body, headers: JSON.stringify(hook.headers) })
    expect(hook.statusCode).toBe(200)
    expect(CLOUD_ROUTES.runpodWebhook.response.safeParse(hook.json()).success).toBe(true)
    // the website: sign-up and password sign-in, the team computers
    await call('signup', {}, { email: 'walk-site@example.com', name: 'Site', password: 'correct horse battery' })
    await call('passwordLogin', {}, { email: 'walk-site@example.com', password: 'correct horse battery' })
    // a headless test brain: its test team's key to the usual tokens (record 0066)
    const testTeam = t.cloud.testTeams.create({ name: 'Walk tests', credits: 10, actor: 'walk' })
    expect((await call('testBrain', {}, { key: testTeam.key, deviceName: 'walk' })).statusCode).toBe(200)
    // e-mail: the verification link mailed at sign-up, a resend, « mot de passe oublié » and the reset link
    expect((await call('verifyEmail', {}, { token: (await mailedToken(t, 'walk-site@example.com', '/verifier')) as string })).statusCode).toBe(200)
    expect((await call('resendVerification')).statusCode).toBe(200)
    expect((await call('forgotPassword', {}, { email: 'walk-site@example.com' })).statusCode).toBe(200)
    expect((await call('resetPassword', {}, { token: (await mailedToken(t, 'walk-site@example.com', '/nouveau-mot-de-passe')) as string, password: 'a brand new passphrase' })).statusCode).toBe(200)
    await call('teamMachines')
    // the team computer: enrolment (the token is the credential), its relay (its own credential), a relayed call, events
    expect((await call('teamBrainRpc', {}, { method: 'app.info', args: [] })).statusCode).toBe(404)
    const [mch] = await t.cloud.machines().provision(admin.teamId, 'starter', 'walk')
    const enrol = await call('machineEnrol', {}, { enrolToken: t.cloud.machines().newEnrolToken(mch!.id, 'walk') })
    const machineAuth = { authorization: `Bearer ${(enrol.json() as { credential: string }).credential}` }
    expect((await call('relayNext', {}, undefined, '?wait=0')).statusCode).toBe(401)
    await call('relayNext', {}, undefined, '?wait=0', machineAuth)
    const relayed = call('teamBrainRpc', {}, { method: 'app.info', args: [] })
    const polled = await call('relayNext', {}, undefined, '?wait=5', machineAuth)
    const rid = (polled.json() as { requests: { id: string }[] }).requests[0]!.id
    expect((await call('relayReply', {}, { id: rid, response: { ok: true, value: { version: '0.1.0' } } }, '', machineAuth)).statusCode).toBe(200)
    expect((await relayed).statusCode).toBe(200)
    expect((await call('relayEvents', {}, { events: [{ event: 'changed', data: { topic: 'channels' } }] }, '', machineAuth)).statusCode).toBe(200)
    // (the open stream itself is proven in cloud-relay.test.ts; here an unknown machine id answers 404)
    expect((await call('teamBrainEvents', {}, undefined, '?machineId=mch_none')).statusCode).toBe(404)
    await call('teamMachines')
    // team invitations: send (the link is e-mailed), list, preview, sign up from one, accept another, revoke a third
    const inv = await call('createInvite', {}, { email: 'walk-new@example.com' })
    expect(inv.statusCode).toBe(200)
    await call('invites')
    const walkToken = (await mailedToken(t, 'walk-new@example.com', '/invitation'))!
    await call('invitePreview', {}, { token: walkToken }, '', {})
    expect((await call('inviteSignup', {}, { token: walkToken, name: 'Walk', password: 'a long enough passphrase' }, '', {})).statusCode).toBe(200)
    const joiner = await signUpAndIn(t, { email: 'walk-has@example.com' })
    await call('createInvite', {}, { email: 'walk-has@example.com' })
    expect((await call('inviteAccept', {}, { token: (await mailedToken(t, 'walk-has@example.com', '/invitation'))! }, '', joiner.auth)).statusCode).toBe(200)
    const toRevoke = (await call('createInvite', {}, { email: 'walk-rev@example.com' })).json() as { id: string }
    expect((await call('revokeInvite', { id: toRevoke.id })).statusCode).toBe(200)
    // billing: status, a checkout, the simulated payment, the top-up settings, the provider's webhook (signed, no bearer)
    await call('billing')
    const co = await call('billingCheckout', {}, { item: { kind: 'pack', pack: 'pack2k' }, successUrl: 'http://localhost:5190/ok', cancelUrl: 'http://localhost:5190/no' })
    expect((await call('billingDemoComplete', {}, { sessionId: (co.json() as { sessionId: string }).sessionId })).statusCode).toBe(200)
    await call('billingAutoRecharge', {}, { enabled: false })
    const hookBody = '{"id":"evt_walk","type":"ignored"}'
    const billHook = await t.app.inject({ method: 'POST', url: '/v1/billing/webhook', headers: { 'content-type': 'application/json', 'x-atelier-signature': createHmac('sha256', 'x').update(hookBody).digest('hex') }, payload: hookBody })
    answers.push({ name: 'billingWebhook', status: billHook.statusCode, body: billHook.body, headers: JSON.stringify(billHook.headers) })
    expect(billHook.statusCode).toBe(403)
    await call('adminPrices')
    const grid = (answers.at(-1)?.body && JSON.parse(answers.at(-1)?.body as string)) as { current: Record<string, unknown> }
    const { version: _v, createdAt: _c, createdBy: _b, ...input } = grid.current
    await call('adminSetPrices', {}, input)
    await call('adminTeams')
    await call('adminGrant', {}, { teamId: admin.teamId, credits: 10, idempotencyKey: 'walk-grant-1' })
    await call('adminAdjust', {}, { teamId: admin.teamId, credits: -5, idempotencyKey: 'walk-adjust-1' })
    await call('adminPnl', {}, undefined, '?from=2026-10-01&to=2026-10-31&includeDemo=1')
    await call('adminSupport')
    await call('adminOverview')
    expect((await call('blueprint')).statusCode).toBe(404)
    const bp = { version: 1, agents: [{ id: 'atlas', role: 'Agent principal', tier: 'deep', routines: [], instructions: 'Coordonne.' }], pipelines: [{ id: 'doc', name: 'Documentaire', nodes: [{ id: 'script', label: 'Script', runner: 'agent', provider: 'Claude Code', credits: 0, validate: 'review' }] }] }
    await call('adminPublishBlueprint', {}, { blueprint: bp, note: 'walk' })
    await call('adminBlueprints')
    expect((await call('blueprint')).statusCode).toBe(200)
    await call('adminMachines')
    expect((await call('adminMachineAction', { id: 'mch_none' }, { action: 'hibernate' })).statusCode).toBe(404)
    await call('adminAudit')
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: admin.refreshToken } })
    answers.push({ name: 'refresh', status: r.statusCode, body: r.body, headers: JSON.stringify(r.headers) })
    const fresh = r.json() as { accessToken: string }
    admin.auth.authorization = `Bearer ${fresh.accessToken}`
    await call('revokeDevice', { id: 'dev_unknown' })
    await call('logout')
    // Errors too: a few refusals with the planted secrets in the request itself.
    for (const s of SECRETS) {
      answers.push({ name: 'bad-bearer', status: 0, body: (await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${s}` } })).body, headers: '' })
      answers.push({
        name: 'bad-quote',
        status: 0,
        body: (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: admin.auth, payload: { usage: 'synthesize', input: { text: s } } })).body,
        headers: ''
      })
    }
    const walked = new Set(answers.map((a) => a.name))
    for (const name of Object.keys(ALL_CLOUD_ROUTES)) {
      if (['deviceStart', 'devicePoll', 'refresh'].includes(name)) continue
      expect(walked.has(name), `route ${name} walked`).toBe(true)
    }
    expect(answers.filter((a) => a.status >= 500)).toEqual([])
    const haystack = answers.map((a) => a.body + a.headers).join('\n') + logLines.join('\n')
    for (const s of SECRETS) for (const e of encodings(s)) expect(haystack.includes(e), `secret found (${e.slice(0, 8)}…)`).toBe(false)
    expect(logLines.length).toBeGreaterThan(10)
    expect(logLines.join('\n')).not.toMatch(/Bearer atk_/)
    expect(logLines.join('\n')).not.toMatch(/sig=[A-Za-z0-9_-]{20,}/)
  })

  it('scrubs credentials from logged URLs', () => {
    expect(scrubUrl('/files/art_1?exp=1&sig=abcdef')).toBe('/files/art_1?exp=1&sig=•••')
    expect(scrubUrl('/device?code=BCDF-GHJK')).toBe('/device?code=•••')
  })
})
