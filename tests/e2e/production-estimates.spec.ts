// The cost per minute and the fit of pipelines (production-11, decision 0023), in the built app, real mode: with the
// engines a Cloud on its default grid publishes kept in settings (as `engines.list` keeps them), the base pipeline's card
// shows its price per finished minute; the editor shows « Coût par minute » with « Où va l'argent », the writing's line
// on Claude Code, and the Δ cost beside each option choice. Screenshots: docs/screens/production/.
import { expect, test } from '@playwright/test'
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
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-est-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

test.describe('real mode: cost per minute and fit of pipelines', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(3 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'prod-estimates', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('the ready card shows its price per video in credits (production-lab); the editor its cost, where the money goes and the Δ of the options', async () => {
    const { page } = atelier
    const shot = (name: string, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage })

    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    const card = page.getByTestId('base-est-avatar@1')
    await expect(card).toContainText('crédits', { timeout: 10_000 })
    await page.waitForTimeout(300)
    await page.getByTestId('prebuilt-recipes').screenshot({ path: path.join(OUT, 'estimate-card.png') })
    await shot('estimate-start')

    await page.getByTestId('use-avatar@1').click()
    await page.getByTestId('add-asis-avatar@1').click()
    const panel = page.getByTestId('pipe-estimate')
    await expect(page.getByTestId('est-avg')).toContainText('€ / min', { timeout: 10_000 })
    for (const line of ['presenter', 'clips', 'images', 'voice', 'thumbnails', 'llm']) await expect(page.getByTestId(`est-line-${line}`)).toBeVisible()
    await expect(page.getByTestId('est-llm')).toContainText('abonnement Claude')
    // pipeline-ui: the quality choices are under « Avancé »
    await page.getByTestId('pipe-advanced').locator('summary').click()
    await expect(page.getByTestId('delta-quality.presenter-standard')).toContainText('€/min')
    await page.waitForTimeout(300)
    await panel.screenshot({ path: path.join(OUT, 'estimate-breakdown.png') })
    await page.getByTestId('pipe-options').screenshot({ path: path.join(OUT, 'estimate-options.png') })

    // a dearer presenter moves the price at once
    const before = await page.getByTestId('est-avg').textContent()
    await page.getByTestId('opt-quality.presenter-standard').click()
    await expect(page.getByTestId('est-avg')).not.toHaveText(before ?? '', { timeout: 10_000 })
    await page.waitForTimeout(300)
    await panel.screenshot({ path: path.join(OUT, 'estimate-breakdown-heygen.png') })
  })
})
