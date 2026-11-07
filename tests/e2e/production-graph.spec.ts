// The read-only graph of a pipeline (production-13, decision 0023), in the built app, real mode, on the fakes: the editor
// of « Avatar » shows « Le parcours de la vidéo » (stages as columns, bricks with engine / style / cost / gate, the fact
// check greyed because its option is off), clicking a brick opens its settings, switching the music off greys its brick;
// then a project of that pipeline runs on the demo providers and its run shows the same graph lit with the live state.
// Screenshots, dark and light: docs/screens/production/graph-*.png.
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
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-graph-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

/** Screenshots of a whole card: the window grows tall enough for it (the app scrolls inside, not the page). */
async function shoot(page: Page, testId: string, name: string, width = 1440): Promise<void> {
  const el = page.getByTestId(testId)
  if (width !== 1440) await page.setViewportSize({ width, height: 900 })
  await page.waitForTimeout(200)
  const box = await el.boundingBox()
  await page.setViewportSize({ width, height: Math.max(900, Math.ceil((box?.height ?? 0) + 260)) })
  await el.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(350)
  await el.screenshot({ path: path.join(OUT, `${name}.png`) })
  await page.setViewportSize({ width: 1440, height: 900 })
}

const theme = (page: Page, th: 'dark' | 'light') =>
  page.evaluate((x) => {
    document.documentElement.dataset.theme = x
  }, th)

test.describe('real mode: the graph of a pipeline', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'prod-graph', runner: false })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
  })
  test.afterAll(async () => {
    // closing waits for the demo run's engine to stop
    test.setTimeout(3 * 60_000)
    await atelier?.close()
  })

  test('the editor draws « Avatar » from its compiled pipeline; a run lights it', async () => {
    const { page } = atelier
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('use-avatar@1').click()
    await page.getByTestId('add-asis-avatar@1').click()
    const card = page.getByTestId('pipe-graph')
    await expect(page.getByTestId('graph-node-voice.tts')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('graph-node-idea.brief')).toHaveAttribute('data-gate', 'owner')
    await expect(page.getByTestId('graph-node-script.factcheck')).toHaveAttribute('data-state', 'off')
    await expect(page.getByTestId('graph-node-avatar.speak')).toContainText('€/min', { timeout: 10_000 })
    await expect(page.getByTestId('graph-end')).toBeVisible()
    for (const th of ['dark', 'light'] as const) {
      await theme(page, th)
      await shoot(page, 'pipe-graph', `graph-avatar-${th}`)
    }
    await theme(page, 'dark')
    await expect(page.getByTestId('pipeline-graph')).toHaveAttribute('data-orientation', 'vertical')
    // a canvas wide enough keeps the stages as columns, left to right (the editor's column is never that wide: the card is
    // widened by hand for this one picture)
    const widen = (w: string) =>
      page.getByTestId('pipe-graph').evaluate((el, width) => {
        ;(el as HTMLElement).style.width = width
        ;(el as HTMLElement).style.maxWidth = 'none'
      }, w)
    await page.setViewportSize({ width: 3800, height: 900 })
    // production-8's clip brick adds a column after the stills
    await widen('3240px')
    await expect(page.getByTestId('pipeline-graph')).toHaveAttribute('data-orientation', 'horizontal')
    await shoot(page, 'pipe-graph', 'graph-avatar-columns-dark', 3800)
    await widen('')
    await expect(page.getByTestId('pipeline-graph')).toHaveAttribute('data-orientation', 'vertical')

    // hovering a brick names what its lines carry
    const tall = await card.boundingBox()
    await page.setViewportSize({ width: 1440, height: Math.ceil((tall?.height ?? 0) + 260) })
    await card.scrollIntoViewIfNeeded()
    await page.getByTestId('graph-node-director.plan').hover()
    await page.waitForTimeout(300)
    await card.screenshot({ path: path.join(OUT, 'graph-avatar-hover.png') })
    await page.setViewportSize({ width: 1440, height: 900 })

    // clicking a brick opens « Avancé » (pipeline-ui: a base pipeline shows its options there, never its bricks' settings)
    await page.getByTestId('graph-node-voice.tts').click()
    await expect(page.getByTestId('pipe-advanced-options')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('settings-voice.tts')).toHaveCount(0)

    // switching the music off greys its brick and dashes its line
    await page.getByTestId('opt-music-none').click()
    await expect(page.getByTestId('graph-node-sound.music')).toHaveAttribute('data-state', 'off', { timeout: 10_000 })
    await expect(page.getByTestId('graph-edge-sound.music>render.assemble')).toHaveAttribute('data-off', 'true')
    await shoot(page, 'pipe-graph', 'graph-avatar-music-off')
    await page.getByTestId('opt-music-library').click()
    await expect(page.getByTestId('graph-node-sound.music')).toHaveAttribute('data-state', 'idle', { timeout: 10_000 })
    await page.getByTestId('recipe-save').click()

    // a project of it, for a channel, runs on the demo providers: it stops at the topic for the owner
    const avatarId = async () => ((await api(page, 'recipes.list')) as { id: number; name: string; version: number }[]).find((r) => r.name === 'Avatar' && r.version >= 2)?.id ?? null
    await expect.poll(avatarId, { timeout: 10_000 }).not.toBeNull()
    const recipe = (await avatarId()) as number
    // the run's quote of a 30 s avatar@1 (presenter at the demo grid) is over the base's 1 500-credit cap: raised here
    const saved = (await api(page, 'recipes.get', recipe)) as { doc: Record<string, unknown> }
    await api(page, 'recipes.save', { id: recipe, doc: { ...saved.doc, capCredits: 100_000 } })
    const channel = (await api(page, 'channels.create', { name: 'Le Labo', niche: 'sciences' })) as { id: number }
    const project = (await api(page, 'projects.create', {
      recipeId: recipe,
      channelId: channel.id,
      title: 'Pourquoi le ciel est bleu',
      idea: 'Pourquoi le ciel est bleu, expliqué simplement',
      adjustments: { minutes: 0.5 }
    })) as { id: number }
    const launched = (await api(page, 'projects.run', project.id)) as { runId: number }
    await page.getByTestId('page-production-bibliotheque').click()
    await page.getByTestId(`project-${project.id}`).getByRole('button', { name: 'Suivre' }).click()
    const runCard = page.getByTestId('run-pipeline-graph')
    await expect(runCard).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('graph-node-idea.brief')).toHaveAttribute('data-state', 'waiting_gate', { timeout: 60_000 })
    for (const th of ['dark', 'light'] as const) {
      await theme(page, th)
      await shoot(page, 'run-graph', `graph-run-gate-${th}`)
    }
    await theme(page, 'dark')

    // approved, the run goes on: the bricks light up one after the other
    await api(page, 'production.approve', launched.runId, 'idea')
    await expect(page.getByTestId('graph-node-idea.brief')).toHaveAttribute('data-state', /done|cached/, { timeout: 60_000 })
    await expect(page.getByTestId('graph-node-voice.tts')).not.toHaveAttribute('data-state', 'pending', { timeout: 90_000 })
    for (const th of ['dark', 'light'] as const) {
      await theme(page, th)
      await shoot(page, 'run-graph', `graph-run-live-${th}`)
    }
    await theme(page, 'dark')
    await api(page, 'production.cancel', launched.runId).catch(() => null)
    await expect
      .poll(async () => ((await api(page, 'production.get', launched.runId)) as { status: string }).status, { timeout: 60_000 })
      .toMatch(/cancelled|failed|succeeded/)
  })
})
