// The agent that prepares and edits pipelines (production-12), in the built app with the deterministic fake team
// (ATELIER_FAKE_LLM=1, never a real model) and the engines a Cloud publishes kept in settings: the start screen's
// « Faire préparer une pipeline par l'agent » opens the four ways in; a channel idea gives three variants with their price
// per minute and the open questions; choosing one opens the editor, where « moins cher » makes the agent propose a change
// shown as a diff with the cost before → after; accepting saves version 2. Screenshots: docs/screens/production/agent-*.png.
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
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-agent-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

test.describe('real mode: the agent prepares a pipeline and edits it by conversation', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(3 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'prod-agent', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('four ways in, three variants with price, a diff with Δ cost, accepted as a new version', async () => {
    const { page } = atelier
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('create-pipeline').click()
    // creation-conversationnelle: « Créer une pipeline » opens the conversation; the other ways are under « Autres façons »
    await page.getByTestId('creation-others').click()
    await page.getByTestId('agent-recipe').click()
    const view = page.getByTestId('view-production-agent')
    await expect(view).toBeVisible()
    for (const w of ['way-no-idea', 'way-concept', 'way-have', 'way-niche']) await expect(page.getByTestId(w)).toBeVisible()

    await page.getByTestId('concept-text').fill('Une grand-mère japonaise qui donne des astuces de rangement, avec beaucoup d’images IA')
    await page.getByTestId('prepare-concept').click()
    const proposal = page.getByTestId('agent-proposal')
    await expect(proposal).toBeVisible({ timeout: 20_000 })
    for (const v of ['faithful', 'cheap', 'premium']) await expect(page.getByTestId(`variant-${v}`)).toContainText('€ / min')
    await expect(page.getByTestId('agent-summary')).toContainText('présentateur')
    await expect(page.getByTestId('question-presenter')).toBeVisible()
    await page.getByTestId('answer-presenter-low').click()
    await expect(page.getByTestId('answer-presenter-low')).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, 'agent-proposal.png'), fullPage: true })

    await page.getByTestId('choose-variant').click()
    await expect(page.getByTestId('view-production-recipes')).toBeVisible({ timeout: 10_000 })
    const chat = page.getByTestId('pipeline-chat')
    await expect(chat).toContainText('Dis-moi ce que tu veux changer', { timeout: 10_000 })
    await page.getByTestId('chat-input').fill('moins cher')
    await page.getByTestId('chat-send').click()
    const pending = page.getByTestId('pending-change')
    await expect(pending).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('pending-diff')).toContainText('Qualité des images')
    await expect(page.getByTestId('pending-cost')).toContainText('→')
    await chat.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await chat.screenshot({ path: path.join(OUT, 'agent-diff.png') })

    await page.getByTestId('pending-accept').click()
    await expect(pending).toHaveCount(0, { timeout: 10_000 })
    await expect(chat).toContainText('version 2')
    await expect(page.getByTestId('recipe-list')).toContainText('v2')
  })
})
