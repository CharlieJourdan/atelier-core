// production-16, « Moteur réel » in the built app on a dev Atelier Cloud (in-process createCloud + buildServer on a random
// loopback port, fake providers, nothing paid): the app signs in (the test plays the browser on the Cloud's /device page), a
// project on « Avatar » (imported script) is launched from Production › Bibliothèque with the switch on — one line says what
// it does, the quote and the Cloud balance show before anything is spent —, runs to « Terminée » through the Cloud's jobs
// (each job's hold captured), and the run view shows each brick's engine (the Cloud's demo here) and its cost.
// Screenshots: docs/screens/production/real-*.png.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'production')
const skipReason = noDesktopReason()
const PASSWORD = 'mot de passe solide'
const CREDITS = 20_000

const SCRIPT = [
  'Le ciel est bleu à cause de la lumière du soleil.',
  'Cette lumière blanche mélange toutes les couleurs, du rouge au violet.',
  'En traversant l’air, elle rencontre des milliards de minuscules molécules.',
  'Ces molécules dispersent le bleu bien plus que le rouge.',
  'Le bleu rebondit alors dans tout le ciel, et nos yeux le voient partout.',
  'Au coucher du soleil, la lumière traverse beaucoup plus d’air.',
  'Le bleu se perd en route, et il ne reste que l’orange et le rouge.',
  'Sur la Lune, sans air, le ciel reste noir même en plein jour.',
  'La prochaine fois que tu lèves les yeux, pense à ces molécules.'
].join(' ')

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: loaded through
// computed paths and typed by hand (as beta-signin.spec.ts does).
interface CloudDb {
  prepare(sql: string): { all(...a: unknown[]): unknown[] }
}
interface TestCloud {
  db: CloudDb
  accounts: { createAccount(p: { email: string; name: string; password: string; teamName?: string; actor: string }): { account: { id: string }; team: { id: string } } }
  wallet: { grant(p: { teamId: string; credits: number; idemKey: string; actor: string }): unknown; state(teamId: string): { balance: number; held: number; available: number } }
  pricing: { current(): unknown }
  close(): Promise<void>
}
interface CloudServer {
  listen(o: { host: string; port: number }): Promise<string>
  server: { address(): unknown }
  close(): Promise<void>
}

async function startTestCloud(filesDir: string): Promise<{ cloud: TestCloud; server: CloudServer; baseUrl: string; engines: unknown[] }> {
  const CLOUD = 'cloud'
  const SERVER = 'server'
  const ENGINES = 'engines'
  const { createCloud } = (await import(`../../cloud/src/${CLOUD}.ts`)) as {
    createCloud(o: { dbPath: string; filesDir: string; signingKey: Buffer; keySource: null; paidCalls: boolean; retryDelayMs?: number }): TestCloud
  }
  const { buildServer } = (await import(`../../cloud/src/http/${SERVER}.ts`)) as { buildServer(c: TestCloud): CloudServer }
  const { FAKE_ENGINES, publishEngines } = (await import(`../../cloud/src/providers/${ENGINES}.ts`)) as {
    FAKE_ENGINES: unknown[]
    publishEngines(d: unknown[], r: { resolve(): { status: 'demo' } }, grid: unknown): unknown[]
  }
  const cloud = createCloud({ dbPath: ':memory:', filesDir, signingKey: Buffer.alloc(32, 11), keySource: null, paidCalls: false, retryDelayMs: 0 })
  const server = buildServer(cloud)
  await server.listen({ host: '127.0.0.1', port: 0 })
  const engines = publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
  return { cloud, server, baseUrl: `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`, engines }
}

interface RunView {
  status: string
  cloud: boolean
  demo: boolean
  quoteCredits: number
  spentCredits: number
  waitingNodes: string[]
  videoFileRef: string | null
  nodes: { nodeId: string; credits: number; engines: { id: string; real: boolean; credits: number }[] }[]
}

/** Device login through the app's API; the test approves the code on the Cloud's /device page like a browser. */
async function signIn(page: Page, baseUrl: string, email: string): Promise<void> {
  await api(page, 'cloud.setBaseUrl', baseUrl)
  const state = (await api(page, 'cloud.connect')) as { pending?: boolean; userCode?: string }
  expect(state.userCode).toBeTruthy()
  const approved = await fetch(`${baseUrl}/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: state.userCode as string, email, password: PASSWORD }).toString()
  })
  expect(approved.status).toBe(200)
  await expect.poll(() => api(page, 'cloud.loginState'), { timeout: 20_000 }).toBe('connected')
}

test.describe('« Moteur réel »: a project on « Avatar » runs for real on a dev Cloud with fakes', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(12 * 60_000)
  let atelier: Atelier | undefined
  let cloud: TestCloud
  let server: CloudServer
  let baseUrl = ''
  let engines: unknown[] = []
  let filesDir = ''
  let teamId = ''
  const email = `charlie-${Date.now().toString(36)}@example.com`

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    filesDir = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-real-cloud-'))
    ;({ cloud, server, baseUrl, engines } = await startTestCloud(filesDir))
    const made = cloud.accounts.createAccount({ email, name: 'Charlie', password: PASSWORD, teamName: 'Studio Charlie', actor: 'e2e' })
    teamId = made.team.id
    cloud.wallet.grant({ teamId, credits: CREDITS, idemKey: `e2e:${made.account.id}`, actor: 'e2e' })
  })
  test.afterAll(async () => {
    test.setTimeout(3 * 60_000)
    await atelier?.close()
    await server?.close()
    await cloud?.close()
    rmSync(filesDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  test('switch on, quote first, run to « Terminée », each brick’s engine and cost', async () => {
    atelier = await launchAtelier({ name: 'real-runs', runner: false, cloudUrl: baseUrl })
    const { page } = atelier
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, baseUrl, email)
    await api(page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines })

    // « Avatar » with an imported script, a channel, a one-minute project
    const channel = (await api(page, 'channels.create', { name: 'Le Labo', niche: 'sciences' })) as { id: number }
    const base = (await api(page, 'recipes.fromBase', 'avatar@1')) as { id: number }
    const recipe = (await api(page, 'recipes.edit', base.id, [{ op: 'setOption', option: 'script', value: 'import' }])) as { id: number }
    const project = (await api(page, 'projects.create', {
      recipeId: recipe.id,
      channelId: channel.id,
      title: 'Le ciel en une minute',
      idea: 'Pourquoi le ciel est bleu',
      inputs: { script: SCRIPT },
      adjustments: { minutes: 1 }
    })) as { id: number }

    // the shell reads its channels at start: reload so the list names the new one
    await page.reload()
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-bibliotheque').click()
    await page.getByTestId(`project-run-${project.id}`).click()
    const panel = page.getByTestId(`launch-${project.id}`)
    await expect(panel).toBeVisible()
    // off by default: a demo, explained in one line
    await expect(panel.getByTestId('real-switch')).not.toBeChecked()
    await expect(panel.getByTestId('real-line')).toContainText('rien n’est débité')
    await expect(panel.getByTestId('launch-quote')).toBeVisible({ timeout: 15_000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT, 'real-launch-off.png') })
    // on: the Cloud's quote and balance before anything is spent
    await panel.getByTestId('real-switch').click()
    await expect(panel.getByTestId('real-switch')).toBeChecked()
    await expect(panel.getByTestId('launch-quote')).toContainText(`Solde Atelier Cloud : ${CREDITS}`, { timeout: 15_000 })
    await expect(panel.getByTestId('real-line')).toContainText('Atelier Cloud')
    expect(cloud.db.prepare('SELECT id FROM jobs').all()).toEqual([])
    await page.mouse.move(0, 0)
    await page.waitForTimeout(600) // the switch's own transition
    await page.screenshot({ path: path.join(OUT, 'real-launch-quote.png') })
    await panel.getByTestId(`project-launch-${project.id}`).click()

    const runIdOf = async () => ((await api(page, 'projects.get', project.id)) as { runId: number | null }).runId
    await expect.poll(runIdOf, { timeout: 30_000 }).not.toBeNull()
    const runId = (await runIdOf()) as number
    const deadline = Date.now() + 9 * 60_000
    let run = (await api(page, 'production.get', runId)) as RunView
    while (Date.now() < deadline) {
      run = (await api(page, 'production.get', runId)) as RunView
      if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break
      for (const node of run.waitingNodes) await api(page, 'production.approve', runId, node).catch(() => null)
      await page.waitForTimeout(1_000)
    }
    expect(run.status).toBe('succeeded')
    expect(run.cloud).toBe(true)
    expect(run.videoFileRef).not.toBeNull()

    // the Cloud's own books: every paid brick was a job, each hold captured
    const jobs = cloud.db.prepare('SELECT usage, state, credits FROM jobs WHERE team_id = ?').all(teamId) as { usage: string; state: string; credits: number }[]
    expect(new Set(jobs.map((j) => j.usage))).toEqual(new Set(['synthesize', 'generateImage', 'generateVideo', 'talkingAvatar']))
    expect(jobs.every((j) => j.state === 'succeeded')).toBe(true)
    const kinds = (cloud.db.prepare('SELECT kind FROM wallet_entries WHERE team_id = ?').all(teamId) as { kind: string }[]).map((k) => k.kind)
    expect(kinds.filter((k) => k === 'capture').length).toBe(jobs.length)
    const spent = jobs.reduce((s, j) => s + j.credits, 0)
    expect(cloud.wallet.state(teamId)).toMatchObject({ balance: CREDITS - spent, held: 0 })
    expect(run.spentCredits).toBe(spent)

    // the run view: « Moteur réel », each brick that bought something with its engine and cost
    await page.getByTestId('page-production-bibliotheque').click()
    await page.getByTestId(`project-${project.id}`).getByRole('button', { name: 'Suivre' }).click()
    await expect(page.getByTestId('run-real-badge')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('node-engines').first()).toBeVisible()
    expect(await page.getByTestId('node-engines').count()).toBe(run.nodes.filter((n) => n.engines.length > 0).length)
    await expect(page.getByTestId('node-engines').filter({ hasText: 'fake-avatar' })).toContainText('démo du Cloud')
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, 'real-run-finished.png') })
    await page.getByTestId('node-engines').first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, 'real-run-engines.png') })
  })
})
