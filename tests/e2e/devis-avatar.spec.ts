// devis-avatar: a project on the base pipeline « Avatar » starts and runs to the end, in the built app on the fakes. Its
// quote no longer counts the support videos nobody listed (≈ 6 600 credits) and covers the presenter and the clips, and the
// base's cap follows the video's length. A 12-minute project made in the screens is accepted under its cap; a 30-second one
// with two support videos runs to its end (the owner approves its gates). Screenshots: docs/screens/production/devis-avatar-*.png.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'production')
const skipReason = noDesktopReason()

/** The engines a fresh Cloud publishes on its default grid (fakes; the Cloud's sources load through computed paths). */
async function cloudEngines(): Promise<unknown[]> {
  const CLOUD = 'cloud'
  const ENGINES = 'engines'
  const { createCloud } = (await import(`../../cloud/src/${CLOUD}.ts`)) as {
    createCloud(o: { dbPath: string; filesDir: string; signingKey: Buffer; keySource: null; paidCalls: boolean }): { pricing: { current(): unknown } }
  }
  const { FAKE_ENGINES, publishEngines } = (await import(`../../cloud/src/providers/${ENGINES}.ts`)) as {
    FAKE_ENGINES: unknown[]
    publishEngines(d: unknown[], r: { resolve(): { status: 'demo' } }, grid: unknown): unknown[]
  }
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-devis-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

interface RunView {
  status: string
  quoteCredits: number
  waitingNodes: string[]
  videoFileRef: string | null
  nodes: { nodeId: string; quoteCredits: number; state: string }[]
}
const runOf = (page: Page, id: number) => api(page, 'production.get', id) as Promise<RunView>

test.describe('real mode: a project on « Avatar » is accepted and runs to the end', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(12 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'devis-avatar', runner: false })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
  })
  test.afterAll(async () => {
    test.setTimeout(3 * 60_000)
    await atelier?.close()
  })

  test('12 min made in the screens: the quote is under the cap; 30 s with support videos: the run finishes', async () => {
    const { page } = atelier
    // « Avatar » as a pipeline of the team, saved from the base
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('use-avatar@1').click()
    await page.getByTestId('add-asis-avatar@1').click()
    await expect(page.getByTestId('graph-node-voice.tts')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('recipe-save').click()
    const avatarId = async () => ((await api(page, 'recipes.list')) as { id: number; name: string; version: number }[]).find((r) => r.name === 'Avatar' && r.version >= 2)?.id ?? null
    await expect.poll(avatarId, { timeout: 10_000 }).not.toBeNull()
    const recipe = (await avatarId()) as number
    const cap = ((await api(page, 'recipes.get', recipe)) as { doc: { capCredits: number } }).doc.capCredits
    const channel = (await api(page, 'channels.create', { name: 'Le Labo', niche: 'sciences' })) as { id: number }

    // 12 minutes (the base's own length), made and launched in the screens: no support video, nothing raised by hand
    // the shell reads its channels at start: reload so the form offers the new one
    await page.reload()
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-bibliotheque').click()
    await page.getByTestId('project-new').click()
    await page.locator('#project-channel').selectOption({ label: 'Le Labo' })
    await page.getByTestId('new-project').getByLabel('Titre').fill('Pourquoi le ciel est bleu')
    await page.getByTestId('new-project').getByLabel('Idée').fill('Pourquoi le ciel est bleu, expliqué simplement')
    await page.getByTestId('project-create').click()
    const projects = async () => (await api(page, 'projects.list')) as { id: number; title: string; runId: number | null }[]
    await expect.poll(async () => (await projects()).length, { timeout: 10_000 }).toBe(1)
    const long = (await projects())[0] as { id: number }
    await page.getByTestId(`project-run-${long.id}`).click()
    // production-16: « Lancer la fabrication » opens the launch panel (demo run, « Moteur réel » off); launch from it
    await page.getByTestId(`project-launch-${long.id}`).click()
    await expect.poll(async () => (await projects())[0]?.runId ?? null, { timeout: 30_000 }).not.toBeNull()
    const longRun = (await projects())[0]?.runId as number
    const long12 = await runOf(page, longRun)
    expect(long12.quoteCredits).toBeLessThanOrEqual(cap)
    const support = long12.nodes.find((n) => n.nodeId === 'support')
    expect(support?.quoteCredits).toBe(0)
    expect(long12.nodes.find((n) => n.nodeId === 'avatar')?.quoteCredits).toBeGreaterThan(0)
    await page.getByTestId(`project-${long.id}`).getByRole('button', { name: 'Suivre' }).click()
    await expect(page.getByTestId('run-pipeline-graph')).toBeVisible({ timeout: 20_000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, 'devis-avatar-12min-accepted.png') })
    await api(page, 'production.cancel', longRun).catch(() => null)
    await expect.poll(async () => (await runOf(page, longRun)).status, { timeout: 90_000 }).toMatch(/cancelled|failed|succeeded/)

    // 30 seconds with two support videos: accepted, then run to its end, the owner approving every gate
    const short = (await api(page, 'projects.create', {
      recipeId: recipe,
      channelId: channel.id,
      title: 'Le ciel en 30 secondes',
      idea: 'Pourquoi le ciel est bleu, en trente secondes',
      inputs: { supportVideos: 'sujet: https://youtu.be/AAAAAAAAAAA\nstructure: https://youtu.be/BBBBBBBBBBB' },
      adjustments: { minutes: 0.5 }
    })) as { id: number }
    const launched = (await api(page, 'projects.run', short.id)) as { runId: number }
    const started = await runOf(page, launched.runId)
    expect(started.quoteCredits).toBeLessThanOrEqual(150)
    expect(started.nodes.find((n) => n.nodeId === 'support')?.quoteCredits).toBeGreaterThan(0)
    await page.getByTestId('page-production-bibliotheque').click()
    await page.getByTestId(`project-${short.id}`).getByRole('button', { name: 'Suivre' }).click()
    await expect(page.getByTestId('run-pipeline-graph')).toBeVisible({ timeout: 20_000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, 'devis-avatar-30s-accepted.png') })

    const deadline = Date.now() + 9 * 60_000
    let last = started
    while (Date.now() < deadline) {
      last = await runOf(page, launched.runId)
      if (['succeeded', 'failed', 'cancelled'].includes(last.status)) break
      for (const node of last.waitingNodes) await api(page, 'production.approve', launched.runId, node).catch(() => null)
      await page.waitForTimeout(1_500)
    }
    expect(last.status).toBe('succeeded')
    expect(last.videoFileRef).not.toBeNull()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, 'devis-avatar-30s-finished.png') })
  })
})
