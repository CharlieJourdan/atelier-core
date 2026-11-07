// Real mode, Ordinateur, in the built app: this PC stands for the team computer, so the machine card shows its real
// name, processor and memory (no demo badge), as the main process reads them (`app.machine`). Since the beta real mode is
// the default; the demo machine only shows with the « Mode présentation » of Réglages › Avancé, under its banner.
import { expect, test } from '@playwright/test'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, setPresentation, type Atelier } from './launch'

const skipReason = noDesktopReason()

test.describe('real mode: the team computer is this PC', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(2 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    atelier = await launchAtelier({ name: 'live-computer', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('Ordinateur shows the real machine in real mode, the demo one in the presentation mode', async () => {
    const { page } = atelier
    const machine = (await api(page, 'app.machine')) as { hostname: string; cores: number; ramTotalGb: number; cpu: number; diskTotalGb: number }
    expect(machine.cores).toBeGreaterThan(0)
    expect(machine.ramTotalGb).toBeGreaterThan(0)
    expect(machine.diskTotalGb).toBeGreaterThan(0)
    expect(machine.cpu).toBeGreaterThanOrEqual(0)

    await page.getByTestId('rail-ordinateurs').click()
    await expect(page.getByTestId('pc-machine')).toHaveAttribute('data-live', 'true', { timeout: 10_000 })
    await expect(page.getByTestId('pc-machine')).toContainText(machine.hostname)
    await expect(page.getByTestId('pc-machine')).toContainText(`${machine.ramTotalGb}`)
    await expect(page.getByTestId('presentation-banner')).toHaveCount(0)
    // Réglages › Avancé › Mode présentation: the demo machine, with the banner; « Revenir à mes données » goes back
    await page.getByTestId('rail-reglages').click()
    await page.getByTestId('page-reglages-avance').click()
    await page.getByTestId('presentation-switch').click()
    await expect(page.getByTestId('presentation-banner')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('rail-ordinateurs').click()
    await expect(page.getByTestId('pc-machine')).not.toHaveAttribute('data-live', 'true')
    await page.getByTestId('presentation-leave').click()
    await expect(page.getByTestId('presentation-banner')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByTestId('pc-machine')).toHaveAttribute('data-live', 'true', { timeout: 10_000 })
    // the choice is kept by the main process: on, then read back
    await setPresentation(page, true)
    expect(await api(page, 'settings.get', 'app.presentation')).toBe(true)
    await setPresentation(page, false)
  })
})
