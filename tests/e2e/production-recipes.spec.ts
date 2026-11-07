// Production rebuilt (production-2, decisions 0008, 0010, 0011), end to end in the built app, real mode, example
// workspace: Production shows no pre-made pipeline and no demo data; « Construire moi-même » opens the recipe editor by
// stage, a recipe of the registry's technologies saves as version 1; the technologies panel lists the registry by stage;
// a project made from the recipe for a channel starts a run. Screenshots: docs/screens/production/.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'production')
const skipReason = noDesktopReason()

test.describe('real mode: Production rebuilt on recipes and technologies', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    // building by hand and the bricks are the developer's (decision 0051): this test runs with the dev flag
    atelier = await launchAtelier({ name: 'prod-recipes', runner: false, example: true, pipelineDev: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('start screen, recipe editor, a project that runs', async () => {
    const { page } = atelier
    const shot = (name: string, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage })
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')

    // Start: the three ways, the base pipeline « Avatar » (production-3), no team pipeline yet, and none of the old pre-made pipelines.
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    const start = page.getByTestId('view-production-start')
    await expect(start).toBeVisible()
    await expect(page.getByTestId('create-pipeline')).toBeEnabled()
    await expect(page.getByTestId('base-avatar@1')).toBeVisible()
    await expect(page.getByTestId('use-avatar@1')).toBeEnabled()
    await expect(start).not.toContainText('Documentaire narré')
    await expect(page.getByTestId('demo-badge')).toHaveCount(0)
    await page.waitForTimeout(300)
    await shot('start')

    // « Construire à la main » (under « Avancé » since production-15): the editor opens on a new recipe with the stages a
    // video needs (under « Avancé » since pipeline-ui); it compiles; save → v1.
    await page.getByTestId('start-advanced').locator('summary').click()
    await page.getByTestId('build-self').click()
    await expect(page.getByTestId('view-production-recipes')).toBeVisible()
    await page.getByTestId('pipe-dev').locator('summary').click()
    await expect(page.getByTestId('stage-elements')).toBeVisible()
    await page.getByLabel('Nom').fill('Documentaire express')
    await expect(page.getByTestId('recipe-ok')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('add-elements').selectOption('motion.render@1')
    await page.getByTestId('brick-settings-voice.tts').click()
    await expect(page.getByTestId('settings-voice.tts')).toBeVisible()
    await expect(page.getByTestId('recipe-ok')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(300)
    await shot('recipe-editor')
    await page.getByTestId('recipe-save').click()
    await expect.poll(async () => ((await api(page, 'recipes.list')) as { name: string; version: number }[]).map((r) => `${r.name} v${r.version}`)).toEqual(['Documentaire express v1'])

    // A base pipeline (production-3): « Utiliser » on « Avatar » makes the team's copy and opens it, options first;
    // a « soon » choice cannot be picked; under « Avancé », the options a user may still change and the mix — no brick,
    // engine or style any more (pipeline-ui: we never show what makes the video).
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('use-avatar@1').click()
    await page.getByTestId('add-asis-avatar@1').click()
    await expect(page.getByTestId('pipe-options')).toBeVisible({ timeout: 10_000 })
    // (chapters are built since production-9: the « soon » choice is now the generated music)
    await expect(page.getByTestId('opt-music-generated')).toBeDisabled()
    await page.getByTestId('opt-captions-true').click()
    await expect(page.getByTestId('recipe-ok')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(300)
    await shot('pipeline-options')
    await page.getByTestId('pipe-advanced').locator('summary').click()
    await expect(page.getByTestId('pipe-mix')).toContainText('Présentateur 26 %')
    await expect(page.getByTestId('opt-quality.presenter-field')).toBeVisible()
    // engines, bricks and styles: only in the « Développeur » block, behind the dev flag this test runs with (decision 0051)
    await expect(page.getByTestId('pipe-advanced').getByTestId('pipe-engines')).toHaveCount(0)
    await page.getByTestId('pipe-dev').locator('summary').click()
    await expect(page.getByTestId('engines-avatar.speak')).toBeVisible()
    await page.waitForTimeout(300)
    await shot('pipeline-advanced', true)
    await page.getByTestId('recipe-save').click()
    await expect.poll(async () => ((await api(page, 'recipes.list')) as { name: string; version: number }[]).map((r) => `${r.name} v${r.version}`)).toEqual(['Avatar v2', 'Documentaire express v1'])
    await api(page, 'recipes.archive', ((await api(page, 'recipes.list')) as { id: number; name: string }[]).find((r) => r.name === 'Avatar')!.id, true)

    // Production holds pipelines only (production-15, Charlie 01/11): no « Technologies » tab any more.
    await expect(page.getByTestId('page-production-ressources')).toHaveCount(0)

    // A project for a channel, from the saved recipe, starts a run on the fakes (demo providers, nothing paid).
    const recipe = ((await api(page, 'recipes.list')) as { id: number; name: string }[]).find((r) => r.name === 'Documentaire express')!
    const channel = ((await api(page, 'channels.list')) as { id: number }[])[0]!
    await api(page, 'recipes.save', { id: recipe.id, doc: { ...((await api(page, 'recipes.get', recipe.id)) as { doc: Record<string, unknown> }).doc, checkpoints: [] } })
    const project = (await api(page, 'projects.create', { recipeId: recipe.id, channelId: channel.id, title: 'Le phare', idea: 'Le phare oublié de la côte sauvage' })) as { id: number }
    const launched = (await api(page, 'projects.run', project.id)) as { runId: number }
    await page.getByTestId('page-production-bibliotheque').click()
    await expect(page.getByTestId(`project-${project.id}`)).toBeVisible()
    // The run starts on the engine. Its end to end MP4 is proved in tests/unit/recipes-api.test.ts: launched from
    // out/main/index.js the app takes out/main for its app path, so its resources (fonts) are not found and the drawing
    // nodes fail here (pre-existing, the packaged app and `npm run dev` are not affected).
    const run = (await api(page, 'production.get', launched.runId)) as { pipelineLabel: string; demo: boolean }
    expect(run).toMatchObject({ pipelineLabel: 'Documentaire express', demo: true })
    await expect(page.getByTestId(`project-${project.id}`)).toContainText('Documentaire express · v2')
    await page.waitForTimeout(500)
    await shot('projects')
  })
})
