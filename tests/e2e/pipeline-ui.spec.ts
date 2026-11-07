// pipeline-ui (Charlie 01/11), in the built app, real mode, with the Cloud's prices kept (so every estimate line runs on a
// named engine underneath): the base « Avatar » card says what it makes, its price and render time; the editor shows the
// cost, the average render time per length, the main options with their « Avant / après » (the loops rendered by the engine
// on the fakes, resources/option-previews) and « Avancé »; « Créer une pipeline » too. On every one of these views no
// provider or model name and no provider plan is in the DOM (text and title / aria-label / alt), and Production has no beta
// tools tab. Screenshots, dark and light: docs/screens/pipeline-ui/.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { providerNamesIn } from '../fixtures/provider-names'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'pipeline-ui')
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
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-pui-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

/** What a user can read on the page: the text, and the titles, labels and alternative texts. */
const readable = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const attrs = [...document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')].map((e) => ['title', 'aria-label', 'alt', 'placeholder'].map((a) => e.getAttribute(a) ?? '').join(' '))
    return `${document.body.innerText}\n${attrs.join('\n')}`
  })

const setTheme = (page: Page, th: 'dark' | 'light') =>
  page.evaluate((x) => {
    document.documentElement.dataset.theme = x
  }, th)

test.describe('pipeline-ui: what we do not sell is never shown; render time; before / after', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'pipeline-ui', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('base card, editor, option preview and « Créer une pipeline », dark and light, with no provider name', async () => {
    const { page } = atelier
    const clean = async (where: string): Promise<void> => expect(providerNamesIn(await readable(page)), where).toEqual([])

    // Production: no beta tools tab; the base « Avatar » card: name, what it makes, price and render time
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await expect(page.getByTestId('page-production-outils')).toHaveCount(0)
    // decision 0051: no building by hand without the dev flag; production-lab: no file import / export, no code while codes are off
    await expect(page.getByTestId('start-advanced')).toHaveCount(0)
    await expect(page.getByTestId('build-self')).toHaveCount(0)
    await expect(page.getByTestId('base-est-avatar@1')).toContainText('crédits', { timeout: 10_000 })
    await expect(page.getByTestId('base-est-avatar@1-time')).toContainText(/min|h/)
    await clean('Production start')
    for (const th of ['dark', 'light'] as const) {
      await setTheme(page, th)
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(OUT, `base-avatar-${th}.png`) })
    }
    await setTheme(page, 'dark')

    // the editor: cost and render time, the main options, « Avancé » open
    await page.getByTestId('use-avatar@1').click()
    await page.getByTestId('add-asis-avatar@1').click()
    await expect(page.getByTestId('recipe-export')).toHaveCount(0)
    await expect(page.getByTestId('recipe-share')).toHaveCount(0)
    await expect(page.getByTestId('est-avg')).toContainText('€ / min', { timeout: 10_000 })
    await expect(page.getByTestId('est-time-avg')).toContainText('min')
    await expect(page.getByTestId('est-time-lengths')).toContainText('20 min →')
    await expect(page.getByTestId('pipe-options')).toBeVisible()
    for (const id of ['presenterGeneration', 'clipPairs', 'shortClips', 'motionShots']) await expect(page.getByTestId(`opt-${id}-field`)).toHaveCount(0)
    await page.getByTestId('pipe-advanced').locator('summary').click()
    await expect(page.getByTestId('opt-quality.presenter-field')).toBeVisible()
    await expect(page.getByTestId('pipe-engines')).toHaveCount(0)
    await expect(page.getByTestId('pipe-dev')).toHaveCount(0)
    await expect(page.locator('[data-testid^="stage-"]')).toHaveCount(0)
    await expect(page.getByTestId('pipeline-chat')).toBeVisible()
    await expect(page.getByTestId('graph-node-avatar.speak')).toContainText('Présentateur Atelier', { timeout: 10_000 })
    await clean('pipeline editor')
    for (const th of ['dark', 'light'] as const) {
      await setTheme(page, th)
      await page.getByTestId('pipe-estimate').scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(OUT, `editor-${th}.png`) })
    }
    await setTheme(page, 'dark')

    // « Avant / après » of « Chapitres à l'écran »: two loops rendered by the engine on the fakes
    await page.getByTestId('opt-preview-toggle-chapters').click()
    for (const side of ['before', 'after']) {
      const video = page.getByTestId(`opt-preview-chapters-${side}`).locator('video')
      await expect(video).toHaveAttribute('src', /^blob:/, { timeout: 15_000 })
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    }
    await page.getByTestId('opt-preview-toggle-music').click()
    await expect(page.getByTestId('opt-preview-music-after').locator('video')).toHaveAttribute('controls', '')
    await clean('option previews')
    const options = page.getByTestId('pipe-options')
    for (const th of ['dark', 'light'] as const) {
      await setTheme(page, th)
      await options.scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      await options.screenshot({ path: path.join(OUT, `option-preview-${th}.png`) })
    }
    await setTheme(page, 'dark')

    // « Créer une pipeline »
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('create-pipeline').click()
    // creation-conversationnelle: « Créer une pipeline » opens the conversation; the other ways are under « Autres façons »
    await page.getByTestId('creation-others').click()
    await expect(page.getByTestId('create-from-code')).toBeDisabled()
    await page.getByTestId('create-from-style').click()
    await expect(page.getByTestId('view-production-style')).toBeVisible({ timeout: 10_000 })
    await clean('Créer une pipeline')
  })
})
