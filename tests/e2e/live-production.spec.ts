// Real mode, production side, end to end in the built app (example workspace, deterministic fake team): Planning shows the
// real videos at their deadline, and scheduling a video from « À programmer » writes its deadline in the database.
// Screenshot: docs/screens/proto/planning-live-dark.png. Production's own screens (rebuilt in production-2, the overview
// lanes and video sheet removed with decision 0008) are covered by production-recipes.spec.ts.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'proto')
const skipReason = noDesktopReason()

interface Run {
  id: number
  videoId: number
  pipelineId: string
  pipelineLabel: string
  status: string
}
interface Video {
  id: number
  title: string
  deadline: string | null
  status: string
}

test.describe('real mode: Planning on the production engine', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'live-prod', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('planning slots and scheduling', async () => {
    const { page } = atelier
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}-live-dark.png`) })
    const runs = (await api(page, 'production.list')) as Run[]
    expect(runs.length).toBeGreaterThan(0)

    // the beta: real mode is the default (no switch)
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')

    // Planning: real videos; one without a deadline is scheduled from the tray → its deadline is in the database.
    await page.getByTestId('rail-planning').click()
    const videos = (await api(page, 'videos.list')) as Video[]
    const free = videos.find((v) => v.deadline === null && v.status !== 'cancelled' && v.status !== 'published')
    if (free) {
      await expect(page.getByTestId('planning-unscheduled')).toBeVisible({ timeout: 15_000 })
      await page.getByTestId(`unscheduled-open-vid-${free.id}`).click()
      await page.getByTestId('unscheduled-time').fill('19:30')
      await page.getByTestId('unscheduled-apply').click()
      await expect
        .poll(async () => ((await api(page, 'videos.get', free.id)) as { video: Video }).video.deadline, { timeout: 10_000 })
        .not.toBeNull()
      const deadline = new Date(((await api(page, 'videos.get', free.id)) as { video: Video }).video.deadline!)
      expect(`${String(deadline.getHours()).padStart(2, '0')}:${String(deadline.getMinutes()).padStart(2, '0')}`).toBe('19:30')
      await expect(page.getByTestId(`unscheduled-vid-${free.id}`)).toHaveCount(0, { timeout: 15_000 })
    }
    await page.waitForTimeout(300)
    await shot('planning')

  })
})
