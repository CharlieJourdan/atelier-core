// The agents settings on the built app with the deterministic fake team (ATELIER_FAKE_LLM=1). Uses a throwaway
// userData directory; no real model is called.
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const skipReason = noDesktopReason()
if (skipReason) console.log(`[e2e] agents SKIPPED: ${skipReason}`)

test.describe('Atelier agents', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)

  let atelier: Atelier
  let app: ElectronApplication

  test.beforeAll(async () => {
    mkdirSync(SCREENS, { recursive: true })
    atelier = await launchAtelier({ name: 'agents' })
    app = atelier.app
  })

  test.afterAll(async () => {
    await atelier?.close()
  })

  test('Settings > Agents lists the team and saves edited instructions', async () => {
    const page = await app.firstWindow()
    const agents = (await api(page, 'agents.list')) as { id: string }[]
    expect(agents).toHaveLength(27) // 22 v1 roles + 5 v2 roles (lot 13)
    const updated = (await api(page, 'agents.update', 'scriptwriter', { instructions: 'Write short punchy scripts.' })) as {
      instructions: string
      customized: boolean
    }
    expect(updated).toMatchObject({ instructions: 'Write short punchy scripts.', customized: true })
    await page.getByRole('button', { name: /settings/i }).first().click()
    await page.getByRole('tab', { name: 'Agents' }).click()
    await expect(page.getByTestId('agents-panel')).toBeVisible()
    await expect(page.getByTestId('agent-row-scriptwriter')).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
