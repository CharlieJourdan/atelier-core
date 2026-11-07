// Agent mascots (decision 0057), in the built app: every role in the gallery, the mascots in Équipe and Messages, and the
// colour and accessory editor on an agent's sheet. The assertions always run; the proof screenshots
// (docs/screens/mascots/<name>-<theme>.png) are written when ATELIER_MASCOT_SHOTS=1.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'mascots')
const SHOTS = process.env.ATELIER_MASCOT_SHOTS === '1'
const ROLES = ['principal', 'channel-manager', 'researcher', 'scriptwriter', 'director', 'packaging', 'production-supervisor', 'editor', 'competitor-analyst', 'voice', 'qc-eye', 'publisher', 'pipeline-architect', 'sponsor-manager', 'custom']

test.describe('agent mascots', () => {
  let atelier: Atelier

  test.beforeAll(async () => {
    if (SHOTS) mkdirSync(OUT, { recursive: true })
    // the invented workspace (Mode présentation) has the whole team
    atelier = await launchAtelier({ name: 'mascots', runner: false, example: true, presentation: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  const theme = async (th: 'dark' | 'light'): Promise<void> => {
    await atelier.page.evaluate((v) => {
      document.documentElement.dataset.theme = v
    }, th)
  }
  const shot = async (name: string, th: string): Promise<void> => {
    if (SHOTS) await atelier.page.screenshot({ path: path.join(OUT, `${name}-${th}.png`) })
  }

  for (const th of ['dark', 'light'] as const) {
    test(`the gallery draws every role (${th})`, async () => {
      const { page } = atelier
      await theme(th)
      await page.getByTestId('rail-reglages').click()
      await page.getByTestId('page-reglages-galerie').click()
      // tall enough that the whole gallery is in view for the proof picture
      await page.setViewportSize({ width: 1440, height: 1700 })
      const gallery = page.getByTestId('gallery-mascots')
      await gallery.scrollIntoViewIfNeeded()
      for (const role of ROLES) await expect(page.getByTestId(`mascot-role-${role}`).locator('svg[data-slot="mascot"]')).toHaveCount(3)
      await page.waitForTimeout(300)
      if (SHOTS) await gallery.screenshot({ path: path.join(OUT, `gallery-${th}.png`) })
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    test(`Équipe and Messages show the mascots (${th})`, async () => {
      const { page } = atelier
      await theme(th)
      await page.getByTestId('rail-agents').click()
      await expect(page.getByTestId('agent-card-ag-principal').locator('svg[data-slot="mascot"]')).toHaveCount(1)
      await expect(page.getByTestId('agent-card-ag-principal').locator('svg[data-accessory="compass"]')).toHaveCount(1)
      await page.waitForTimeout(400)
      await shot('equipe', th)

      await page.getByTestId('rail-conversations').click()
      await expect(page.getByTestId('msg-pane').locator('svg[data-slot="mascot"]').first()).toBeVisible()
      await page.waitForTimeout(400)
      await shot('messages', th)
    })
  }

  test('the editor on an agent’s sheet changes the mascot everywhere, and goes back to the role’s', async () => {
    const { page } = atelier
    await theme('dark')
    await page.getByTestId('rail-agents').click()
    const card = page.getByTestId('agent-card-ag-enigmes-edit')
    await expect(card.locator('svg[data-accessory="clapper"]')).toHaveCount(1) // the editor's clapperboard
    await card.click()
    const editor = page.getByTestId('mascot-editor')
    await expect(editor).toBeVisible()
    await page.getByTestId('mascot-accessory-magnifier').click()
    await page.getByTestId('mascot-color-5').click()
    await expect(card.locator('svg[data-accessory="magnifier"]')).toHaveCount(1)
    await expect(page.getByTestId('agent-sheet').locator('header svg[data-accessory="magnifier"]')).toHaveCount(1)
    await page.waitForTimeout(300)
    await shot('equipe-editor', 'dark')
    await page.getByTestId('mascot-reset').click()
    await expect(card.locator('svg[data-accessory="clapper"]')).toHaveCount(1)
    await expect(page.getByTestId('mascot-reset')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})
