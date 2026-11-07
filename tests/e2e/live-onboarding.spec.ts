// Real mode, the onboarding, end to end in the built app (example workspace, deterministic fake team, nothing paid): adding a
// channel from a niche creates a real channel, a real analysis of a reference channel, a real library pipeline made from it,
// a real test run on that pipeline and the channel's team in the agent runtime. Screenshots:
// docs/screens/proto/onboarding-live-{analyse,rapport,test,equipe}-dark.png.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'proto')
const skipReason = noDesktopReason()

interface Channel {
  id: number
  name: string
  niche: string
}
interface Analysis {
  id: number
  channelName: string
  status: string
  score: number | null
}
interface Pipeline {
  id: number
  name: string
  origin: string
  channelId: number | null
}
interface Run {
  id: number
  channelId: number
  pipelineId: string
  status: string
}
interface Agent {
  id: number
  role: string
  channelId: number | null
  paused: boolean
}

test.describe('real mode: the onboarding does the real thing', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'live-onboarding', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('a niche becomes a channel, an analysis, a library pipeline, a test run and a team', async () => {
    const { page } = atelier
    const shot = async (name: string) => {
      await page.waitForTimeout(700) // the step's fade-in and bars settle
      await page.screenshot({ path: path.join(OUT, `onboarding-live-${name}-dark.png`) })
    }
    const channelsBefore = (await api(page, 'channels.list')) as Channel[]
    const analysesBefore = (await api(page, 'analysis.list')) as Analysis[]
    const pipelinesBefore = (await api(page, 'pipelines.list')) as Pipeline[]

    // the beta: real mode is the default (no switch)
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')

    // Chaînes › Ajouter une chaîne: the add-a-channel flow (steps 3 to 8) in real mode.
    await page.getByTestId('rail-chaines').click()
    await page.getByTestId('add-channel').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '3')
    await page.getByTestId('channel-no').click()
    await page.getByTestId('creation-niche').click()
    await page.getByTestId('niche-niche-cold').click()
    // the niches list is invented data: it says so
    await expect(page.getByTestId('onboarding-niches').getByTestId('sim-badge')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

    // Step 3 → 4: the channel exists in the database, the analysis runs on a reference channel and finishes.
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '4')
    await expect
      .poll(async () => ((await api(page, 'channels.list')) as Channel[]).length, { timeout: 15_000 })
      .toBe(channelsBefore.length + 1)
    const created = ((await api(page, 'channels.list')) as Channel[]).find((c) => !channelsBefore.some((b) => b.id === c.id))!
    expect(created.name).toBe('Affaires non résolues')
    await expect(page.getByTestId('analysis')).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
    await expect(page.getByTestId('analysis-examples')).toContainText('vues')
    await expect(page.getByTestId('analysis-competitors')).toBeVisible()
    await shot('analyse')
    const analyses = (await api(page, 'analysis.list')) as Analysis[]
    expect(analyses.length).toBe(analysesBefore.length + 1)
    const analysis = analyses.find((x) => !analysesBefore.some((b) => b.id === x.id))!
    expect(analysis.status).toBe('done')
    await page.getByTestId('onboarding-next').click()

    // Step 5: the report of the real analysis (note, engine estimate); the pipeline is not made yet.
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '5')
    await expect(page.getByTestId('report-score')).toContainText('%')
    await expect(page.getByTestId('report-strip')).toBeVisible()
    await expect(page.getByTestId('report-pipeline-note')).toBeVisible()
    await shot('rapport')
    expect(((await api(page, 'pipelines.list')) as Pipeline[]).length).toBe(pipelinesBefore.length)
    await page.getByTestId('onboarding-next').click()

    // Step 6 → 7: the answers go to the analysis, the library pipeline is made for the new channel.
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '6')
    await expect(page.getByTestId('live-questions-note')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '7')
    const pipelines = (await api(page, 'pipelines.list')) as Pipeline[]
    expect(pipelines.length).toBe(pipelinesBefore.length + 1)
    const pipeline = pipelines.find((p) => !pipelinesBefore.some((b) => b.id === p.id))!
    expect(pipeline).toMatchObject({ origin: 'analysis', channelId: created.id })
    expect(((await api(page, 'analysis.get', analysis.id)) as { createdPipelineId: number }).createdPipelineId).toBe(pipeline.id)

    // Step 7: the test video is a real run of that pipeline; it stops at its first gate.
    await expect(page.getByTestId('live-test-quote')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('live-test-launch').click()
    await expect(page.getByTestId('test-run')).toHaveAttribute('data-run-id', /\d+/, { timeout: 30_000 })
    const runs = (await api(page, 'production.list', { channelId: created.id })) as Run[]
    expect(runs.length).toBe(1)
    await expect(page.getByTestId('live-test-nodes')).toBeVisible()
    await shot('test')
    // it settles (a gate waits for the owner, or the run is over): the flow can go on
    await expect(page.getByTestId('onboarding-next')).toBeEnabled({ timeout: 120_000 })
    await page.getByTestId('onboarding-next').click()

    // Step 8: the channel's team exists in the agent runtime.
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '8')
    await expect(page.getByTestId('live-team')).toHaveAttribute('data-phase', 'done', { timeout: 30_000 })
    const team = ((await api(page, 'orchestra.agents')) as Agent[]).filter((x) => x.channelId === created.id)
    expect(team.map((x) => x.role)).toContain('channel_lead')
    expect(team.length).toBeGreaterThan(3)
    await shot('equipe')
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding')).toHaveCount(0)

    // Nothing was duplicated on the way, and the new channel shows in the list of Chaînes.
    expect(((await api(page, 'channels.list')) as Channel[]).length).toBe(channelsBefore.length + 1)
    expect(((await api(page, 'analysis.list')) as Analysis[]).length).toBe(analysesBefore.length + 1)
    await expect(page.getByTestId('chaines-grid')).toContainText('Affaires non résolues', { timeout: 15_000 })

  })
})
