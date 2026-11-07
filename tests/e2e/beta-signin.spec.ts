// The beta, end to end in the built app: a local test Atelier Cloud (in-process createCloud + buildServer on a random
// loopback port, fakes, nothing paid) and a fresh user-data folder. First launch = the welcome screen; « Créer un compte »
// starts the device login (the test plays the browser on the Cloud's /device page, sign-up form); the app connects,
// the workspace has no channel so the REAL onboarding opens (a niche → a channel, an analysis, a pipeline, a test run, a
// team); then Accueil in real mode with no demo data and the Cloud account in the sidebar; then the channel is archived
// from its sheet (its agents paused, nothing deleted). A second fresh install takes « Plus tard » on the channel question:
// the onboarding ends with no channel, Accueil is empty with « Ajouter une chaîne », which opens the add-a-channel flow; the
// engine step shows the real Claude state and never a fake connection. Screenshots: docs/screens/proto/beta-*.png and
// firstrun-*.png.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'proto')
const skipReason = noDesktopReason()

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: loaded through a
// computed path and typed by hand (as tests/unit/cloud-app-helpers.ts does).
interface TestCloud {
  close(): Promise<void>
}
interface CloudServer {
  listen(o: { host: string; port: number }): Promise<string>
  server: { address(): unknown }
  close(): Promise<void>
}
async function startTestCloud(filesDir: string): Promise<{ cloud: TestCloud; server: CloudServer; baseUrl: string }> {
  const CLOUD = 'cloud'
  const SERVER = 'server'
  const { createCloud } = (await import(`../../cloud/src/${CLOUD}.ts`)) as {
    createCloud(o: { dbPath: string; filesDir: string; signingKey: Buffer; keySource: null; paidCalls: boolean; retryDelayMs?: number }): TestCloud
  }
  const { buildServer } = (await import(`../../cloud/src/http/${SERVER}.ts`)) as { buildServer(c: TestCloud): CloudServer }
  const cloud = createCloud({ dbPath: ':memory:', filesDir, signingKey: Buffer.alloc(32, 9), keySource: null, paidCalls: false, retryDelayMs: 0 })
  const server = buildServer(cloud)
  await server.listen({ host: '127.0.0.1', port: 0 })
  return { cloud, server, baseUrl: `http://127.0.0.1:${(server.server.address() as AddressInfo).port}` }
}

/** The demo workspace's own names: none may show in real mode. */
const DEMO = ['Les Grandes Énigmes', 'Histoires Vraies', 'Top Savoirs', 'Mystery Files', 'Studio Charlie', 'Margaux', 'Monteuse freelance', 'atelier-pc-01']

interface Channel {
  id: number
  name: string
  archived: boolean
}
interface Agent {
  id: number
  channelId: number | null
  paused: boolean
}

/** « Créer un compte » on the welcome screen; the test plays the browser on the Cloud's sign-up form. */
async function signUp(page: Page, baseUrl: string, name: string, email: string): Promise<void> {
  await page.getByTestId('welcome-signup').click()
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-state', 'pending', { timeout: 15_000 })
  const code = (await page.getByTestId('welcome-code').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  const form = await fetch(`${baseUrl}/device?code=${encodeURIComponent(code)}&new=1`)
  expect(form.status).toBe(200)
  const approved = await fetch(`${baseUrl}/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, name, email, password: 'mot de passe solide' }).toString()
  })
  expect(approved.status).toBe(200)
  expect(await approved.text()).toContain('Appareil autorisé')
}

test.describe('the beta: sign in, real onboarding, real Accueil, archive', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(6 * 60_000)
  let atelier: Atelier | undefined
  let fresh: Atelier | undefined
  let cloud: TestCloud
  let server: CloudServer
  let baseUrl = ''
  let filesDir = ''

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    filesDir = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-cloud-'))
    ;({ cloud, server, baseUrl } = await startTestCloud(filesDir))
  })
  test.afterAll(async () => {
    await atelier?.close()
    await fresh?.close()
    await server?.close()
    await cloud?.close()
    rmSync(filesDir, { recursive: true, force: true })
  })

  test('welcome → create an account → real onboarding → Accueil without demo data → archive the channel', async () => {
    // a fresh install: nothing marks the onboarding done, so it opens once signed in
    atelier = await launchAtelier({ name: 'beta-signin', runner: false, account: 'welcome', cloudUrl: baseUrl, firstRun: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    const { page } = atelier
    const shot = async (name: string) => {
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(OUT, `beta-${name}-dark.png`) })
    }

    // 1. First launch: the welcome screen, pointed at the test Cloud.
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('welcome-server')).toContainText(baseUrl)
    await expect(page.getByTestId('shell')).toHaveCount(0)
    await shot('welcome')

    // 2. « Créer un compte »: the code shows; the test plays the browser on the Cloud's sign-up form.
    await page.getByTestId('welcome-signup').click()
    await expect(page.getByTestId('welcome')).toHaveAttribute('data-state', 'pending', { timeout: 15_000 })
    const code = (await page.getByTestId('welcome-code').innerText()).trim()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    await shot('welcome-code')
    const form = await fetch(`${baseUrl}/device?code=${encodeURIComponent(code)}&new=1`)
    expect(form.status).toBe(200)
    expect(await form.text()).toContain('name="name"')
    const approved = await fetch(`${baseUrl}/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, name: 'Camille Testeuse', email: 'camille@example.com', password: 'mot de passe solide' }).toString()
    })
    expect(approved.status).toBe(200)
    expect(await approved.text()).toContain('Appareil autorisé')

    // 3. Signed in, no channel: the real onboarding (first run) opens.
    await expect(page.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
    expect(await api(page, 'cloud.status')).toMatchObject({ connected: true, account: { email: 'camille@example.com', name: 'Camille Testeuse' } })
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-mode', 'first-run')
    await page.getByTestId('onboarding-name').fill('Atlas')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '2')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '3')
    await page.getByTestId('channel-no').click()
    await page.getByTestId('creation-niche').click()
    await page.getByTestId('niche-niche-cold').click()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '4', { timeout: 15_000 })
    await expect.poll(async () => ((await api(page, 'channels.list')) as Channel[]).length, { timeout: 15_000 }).toBe(1)
    const created = ((await api(page, 'channels.list')) as Channel[])[0]!
    await expect(page.getByTestId('analysis')).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '5')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '6')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '7', { timeout: 15_000 })
    await expect(page.getByTestId('live-test-quote')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('live-test-launch').click()
    await expect(page.getByTestId('onboarding-next')).toBeEnabled({ timeout: 120_000 })
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '8')
    await expect(page.getByTestId('live-team')).toHaveAttribute('data-phase', 'done', { timeout: 30_000 })
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding')).toHaveCount(0)

    // 4. Accueil in real mode: the new channel, the Cloud account in the sidebar, nothing of the demo.
    await expect(page.getByTestId('shell')).toBeVisible()
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')
    await expect(page.getByTestId('presentation-banner')).toHaveCount(0)
    await page.getByTestId('rail-accueil').click()
    await expect(page.getByTestId('profile-identity')).toHaveAttribute('data-cloud', 'signed-in', { timeout: 15_000 })
    await expect(page.getByTestId('profile-identity')).toContainText('Camille Testeuse')
    await expect(page.getByTestId('profile-identity')).toContainText('Sans abonnement')
    await expect(page.getByTestId('home-channels')).toContainText(created.name, { timeout: 15_000 })
    const everything = `${await page.getByTestId('shell').innerText()}`
    for (const name of DEMO) expect(everything, name).not.toContain(name)
    await shot('accueil')

    // 5. Archive the channel from its sheet: confirmed, hidden, its agents paused, nothing deleted.
    const teamBefore = ((await api(page, 'orchestra.agents')) as Agent[]).filter((a) => a.channelId === created.id)
    expect(teamBefore.length).toBeGreaterThan(1)
    await page.getByTestId('rail-chaines').click()
    await page.getByTestId(`channel-open-db-${created.id}`).click()
    await page.getByTestId('channel-archive').click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await shot('archive')
    await page.getByTestId('confirm-ok').click()
    await expect.poll(async () => ((await api(page, 'channels.list')) as Channel[]).length, { timeout: 10_000 }).toBe(0)
    const all = (await api(page, 'channels.list', true)) as Channel[]
    expect(all.find((c) => c.id === created.id)?.archived).toBe(true)
    const teamAfter = ((await api(page, 'orchestra.agents')) as Agent[]).filter((a) => a.channelId === created.id)
    expect(teamAfter.length).toBe(teamBefore.length)
    expect(teamAfter.every((a) => a.paused)).toBe(true)
    await expect(page.getByTestId('archived-channels')).toContainText(created.name, { timeout: 10_000 })
    await expect(page.getByTestId('chaines-empty')).toBeVisible()
    // the videos stay readable
    expect(((await api(page, 'production.list', { channelId: created.id })) as unknown[]).length).toBe(1)
  })

  test('a fresh install: welcome → sign in → the onboarding with its three choices → « Plus tard » → an empty Accueil', async () => {
    fresh = await launchAtelier({ name: 'beta-firstrun', runner: false, account: 'welcome', cloudUrl: baseUrl, firstRun: true })
    const { page } = fresh
    await page.setViewportSize({ width: 1440, height: 900 })
    const shot = async (name: string) => {
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(OUT, `firstrun-${name}-dark.png`) })
    }

    // 1. Nothing of the example workspace in the database, the welcome first.
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 30_000 })
    expect(await api(page, 'channels.list')).toEqual([])
    expect(await api(page, 'example.status')).toMatchObject({ loaded: false })
    expect(await api(page, 'app.onboarding')).toEqual({ done: false })

    // 2. Signed in: the first-run onboarding opens.
    await signUp(page, baseUrl, 'Dominique Testeur', 'dominique@example.com')
    await expect(page.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-mode', 'first-run')
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '1')
    await page.getByTestId('onboarding-name').fill('Atlas')
    await page.getByTestId('onboarding-next').click()

    // 3. The engine step is the real one: the real state (never a fake « connecté »), and an honest warning.
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '2')
    const engine = page.getByTestId('engine-live')
    await expect(engine).toHaveAttribute('data-where', 'local', { timeout: 15_000 })
    await expect(engine).not.toHaveAttribute('data-phase', 'loading', { timeout: 30_000 })
    await expect(engine).not.toHaveAttribute('data-phase', 'ready')
    await expect(page.getByTestId('engine-cli')).toBeVisible()
    await expect(page.getByTestId('engine-warning')).toBeVisible()
    await expect(page.getByTestId('onboarding-step-2').getByTestId('sim-badge')).toHaveCount(0)
    await expect(page.getByTestId('onboarding-step-2')).not.toContainText('Claude Max')
    await shot('engine')
    await page.getByTestId('onboarding-next').click()

    // 4. The channel question: the three choices; « Plus tard » ends the onboarding there.
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '3')
    await expect(page.getByTestId('channel-yes')).toBeVisible()
    await expect(page.getByTestId('channel-no')).toBeVisible()
    await expect(page.getByTestId('channel-later')).toBeVisible()
    await page.getByTestId('channel-later').click()
    await expect(page.getByTestId('onboarding-later-note')).toBeVisible()
    await shot('channel')
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding')).toHaveCount(0)

    // 5. Accueil, empty, real mode: no channel, no demo name, a clear « Ajouter une chaîne »; the onboarding is stored.
    await expect(page.getByTestId('shell')).toBeVisible()
    await expect(page.getByTestId('view-accueil')).toBeVisible()
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')
    await expect(page.getByTestId('home-first-channel')).toBeVisible({ timeout: 15_000 })
    expect(await api(page, 'channels.list')).toEqual([])
    expect(await api(page, 'app.onboarding')).toEqual({ done: true })
    const everything = await page.getByTestId('shell').innerText()
    for (const name of DEMO) expect(everything, name).not.toContain(name)
    await shot('accueil')

    // 6. « Ajouter une chaîne » opens the add-a-channel flow (no « Plus tard » there: it has « Annuler »).
    await page.getByTestId('home-first-channel-add').click()
    await expect(page.getByTestId('add-channel-overlay')).toBeVisible()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-mode', 'add-channel')
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '3')
    await expect(page.getByTestId('channel-later')).toHaveCount(0)
    await page.getByTestId('onboarding-skip').click()
    await expect(page.getByTestId('add-channel-overlay')).toHaveCount(0)
    await expect(page.getByTestId('chaines-empty')).toBeVisible()
  })
})
