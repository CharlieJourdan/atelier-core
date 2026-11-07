// « Créer une pipeline » (production-15), in the built app with the deterministic fake team (ATELIER_FAKE_LLM=1, never a real
// model), the eyes' demonstration (Atelier Cloud not connected) and the demo providers: Production shows its three parts (create,
// base pipelines, mine) and no « Technologies »; a few words and two example channels give the closest pipelines with their
// price per minute, a free estimate and the free saved previews; « Voir un exemple » shows its quote before anything runs;
// « Lancer l'exemple » makes a short sample as a normal run, measured and scored with its three biggest gaps; « Corriger »
// applies one (the sample is then « à refaire »); « Avancé » keeps engines and styles; words alone (« voix off ») give the base
// without a presenter. Screenshots: docs/screens/production/style-*.png.
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
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
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-style-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

/** The demonstration eyes pick a style by the link (src/main/production/style-agent/references.ts): 0 avatar, 1 voice-over. */
const demoStyle = (url: string): number => parseInt(createHash('sha256').update(url).digest('hex').slice(0, 6), 16) % 3
/** A channel link whose two most viewed demo videos both have this demo style. */
function channelLink(style: number): string {
  for (let i = 0; i < 2000; i++) {
    const url = `https://www.youtube.com/@reference${i}`
    const n = parseInt(createHash('sha256').update(url).digest('hex').slice(0, 6), 16)
    const ids = [0, 1].map((k) => `https://www.youtube.com/watch?v=demo${(n + k).toString(36)}`)
    if (ids.every((u) => demoStyle(u) === style)) return url
  }
  throw new Error('no demo link')
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}

test.describe('real mode: the agent reproduces a style', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(5 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'prod-style', runner: false })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
    await api(atelier.page, 'channels.create', { name: 'Mamie range', niche: 'rangement' })
  })
  test.afterAll(async () => {
    test.setTimeout(3 * 60_000)
    await atelier?.close()
  })

  test('links → proposals → quote → sample with its score and gaps → a gap corrected', async () => {
    const { page } = atelier
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await expect(page.getByTestId('view-production-start')).toBeVisible()
    await expect(page.getByTestId('create-pipeline')).toBeVisible()
    await expect(page.getByTestId('base-voiceover@1')).toContainText('Ajouter à mes pipelines')
    await expect(page.getByTestId('page-production-ressources')).toHaveCount(0)
    await shoot(page, 'style-production')
    await page.getByTestId('create-pipeline').click()
    // creation-conversationnelle: « Créer une pipeline » opens the conversation; the other ways are under « Autres façons »
    await page.getByTestId('creation-others').click()
    await page.getByTestId('create-from-style').click()
    const view = page.getByTestId('view-production-style')
    await expect(view).toBeVisible()
    await expect(page.getByTestId('style-consent')).toContainText('jamais une personne')

    await page.getByTestId('create-text').fill('Un grand-père bricoleur qui explique ses astuces, des images réalistes')
    await page.getByTestId('style-links-text').fill(`${channelLink(0)}\n${channelLink(0).replace('@', '@x')}`)
    await shoot(page, 'style-links')
    await page.getByTestId('style-analyse').click()
    await expect(page.getByTestId('style-proposals')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('style-reason')).toContainText('Avatar')
    await expect(page.getByTestId('style-summary')).toContainText('présentateur')
    await expect(page.getByTestId('style-variant-faithful')).toContainText('€ / min')
    await expect(page.getByTestId('style-estimate-faithful')).toBeVisible()
    await expect(page.getByTestId('style-previews-faithful').locator('img, video').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('style-proposals').scrollIntoViewIfNeeded()
    await shoot(page, 'style-proposals')
    // pipeline-ui: a proposal no longer lists its bricks, engines and the agent's raw operations
    await expect(page.getByTestId('advanced-faithful')).toHaveCount(0)

    // the sample of « économique » (half the AI clips): its mix is a gap the pipeline can close
    await page.getByTestId('style-see-cheap').click()
    const quote = page.getByTestId('style-quote')
    await expect(quote).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('style-quote-body')).toContainText('crédits')
    await quote.scrollIntoViewIfNeeded()
    await shoot(page, 'style-quote')

    await page.getByTestId('style-run').click()
    const sample = page.getByTestId('style-sample')
    await expect(sample).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sample-score')).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId('sample-gaps')).toBeVisible()
    await expect(page.getByTestId('video-player')).toBeVisible({ timeout: 20_000 })
    await sample.scrollIntoViewIfNeeded()
    await shoot(page, 'style-sample')

    const apply = page.locator('[data-testid^="gap-apply-"]').first()
    await expect(apply).toBeVisible()
    await apply.click()
    await expect(page.getByTestId('sample-stale')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sample-redo')).toBeVisible()
    await page.getByTestId('sample-stale').scrollIntoViewIfNeeded()
    await shoot(page, 'style-gap')
  })

  test('a channel without a presenter gives the « sans présentateur » base; words alone are enough', async () => {
    const { page } = atelier
    // the toast of the gap fixed above goes away first (the screenshots below)
    await page.waitForTimeout(6000)
    await page.getByTestId('create-text').fill('')
    await page.getByTestId('style-links-text').fill(channelLink(1))
    await page.getByTestId('style-analyse').click()
    await expect(page.getByTestId('style-reason')).toContainText('sans présentateur', { timeout: 30_000 })
    await page.getByTestId('style-study').scrollIntoViewIfNeeded()
    await shoot(page, 'style-voiceover')

    // words alone: « Créer de zéro avec des inspirations » (parcours-utilisateur: cloning needs a link, a new idea needs none)
    await page.getByTestId('view-production-style').locator('h1').scrollIntoViewIfNeeded()
    await page.getByTestId('style-path-inspire').click()
    await page.getByTestId('create-text').fill('Une voix off calme sur des images de nature, sans présentateur')
    await page.getByTestId('style-analyse').click()
    await expect(page.getByTestId('style-variant-faithful')).toContainText('Ajoute des vidéos d’exemple', { timeout: 30_000 })
    await expect(page.getByTestId('style-reason')).toContainText('d’après tes mots : pipeline Voix off')
    await expect(page.getByTestId('style-previews-faithful')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('style-previews-faithful')).not.toContainText('Présentateur')
    await page.getByTestId('view-production-style').locator('h1').scrollIntoViewIfNeeded()
    await shoot(page, 'style-words')
  })
})
