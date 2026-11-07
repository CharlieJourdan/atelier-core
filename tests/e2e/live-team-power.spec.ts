// agents-1 and agents-2 in the built app (fake team, ATELIER_FAKE_LLM=1: never a real model). Équipe: the switch refuses
// to start before Claude is checked, then switches on, pauses, and « Tout arrêter » switches off; the « Activité » tab shows
// the live sections. Chaînes: a channel created through the app shows its proposed goals in its sheet, and « Confirmer »
// confirms them. Screenshots in docs/screens/v2 (team-power, team-activity, channel-goals).
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { noDesktopReason } from './desktop'
import { SCREENS_V2, api, launchAtelier, type Atelier } from './launch'

const skipReason = noDesktopReason()

test.describe('the team switch, « Activité » and channel goals', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(3 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    atelier = await launchAtelier({ name: 'live-team-power', runner: false })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('switch: blocked before Claude, on after « Vérifier », pause, red stop; Activité', async () => {
    const { page } = atelier
    await page.getByTestId('rail-agents').click()
    const bar = page.getByTestId('team-power')
    await expect(bar).toHaveAttribute('data-state', 'off', { timeout: 15_000 })
    await expect(page.getByTestId('team-power-on')).toBeDisabled()
    // « Vérifier » the default account (the fake model answers): the switch may now turn on
    const accounts = (await api(page, 'orchestra.accounts')) as { id: number }[]
    await api(page, 'orchestra.checkAccount', accounts[0]!.id)
    await expect(page.getByTestId('team-power-on')).toBeEnabled({ timeout: 10_000 })
    await page.getByTestId('team-power-on').click()
    await expect(bar).toHaveAttribute('data-state', 'on', { timeout: 10_000 })
    await page.getByTestId('team-power-pause').click()
    await expect(bar).toHaveAttribute('data-state', 'paused', { timeout: 10_000 })
    await page.screenshot({ path: path.join(SCREENS_V2, 'team-power.png') })
    await page.getByTestId('team-power-stop').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Tout arrêter' }).click()
    await expect(bar).toHaveAttribute('data-state', 'off', { timeout: 10_000 })
    expect(await api(page, 'autopilot.power')).toMatchObject({ state: 'off', loopRunning: false })

    await page.getByTestId('agents-view-activity').click()
    const activity = page.getByTestId('team-activity')
    await expect(activity).toBeVisible({ timeout: 10_000 })
    for (const id of ['activity-running', 'activity-waiting', 'activity-queued', 'activity-routines', 'activity-accounts', 'activity-events']) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
    await expect(page.getByTestId('activity-events')).toContainText('Tout a été arrêté')
    await page.screenshot({ path: path.join(SCREENS_V2, 'team-activity.png'), fullPage: true })
  })

  test('a new channel shows its proposed goals in its sheet; « Confirmer » confirms them', async () => {
    const { page } = atelier
    const row = (await api(page, 'channels.create', { name: 'Énigmes e2e', niche: 'énigmes historiques' })) as { id: number }
    expect(await api(page, 'autopilot.goals', row.id)).toMatchObject({ status: 'proposed', trigger: 'create' })
    await page.getByTestId('rail-chaines').click()
    await page.getByTestId(`channel-open-db-${row.id}`).click()
    await page.getByTestId('channel-tab-automation').click()
    const status = page.getByTestId('channel-goals-status')
    await expect(status).toHaveAttribute('data-status', 'proposed', { timeout: 15_000 })
    await page.screenshot({ path: path.join(SCREENS_V2, 'channel-goals.png'), fullPage: true })
    await page.getByTestId('channel-goals-confirm').click()
    await expect(status).toHaveAttribute('data-status', 'confirmed', { timeout: 10_000 })
    expect(await api(page, 'autopilot.goals', row.id)).toMatchObject({ status: 'confirmed', level: 'recommended' })
  })
})
