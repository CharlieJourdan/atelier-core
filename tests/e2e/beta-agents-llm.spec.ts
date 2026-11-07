// beta-agents-llm, end to end in the built app (example workspace, the deterministic fake team: never a real model):
// in Messages, Atlas answers « regarde si j'ai des vidéos en cours de production » with the runs of the workspace (it
// reads them with its `production.list` tool); then, with no working subscription account, the agents and script
// writing are locked (the card and its button to Réglages › Claude) and a message to Atlas is answered at once with
// what to click. Screenshots go to docs/screens/v2/beta-agents-llm-*.png.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS_V2, type Atelier } from './launch'

const skipReason = noDesktopReason()
const QUESTION = "regarde si j'ai des vidéos en cours de production"

test.describe('beta: Atlas answers, the beta rule locks without a subscription', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(SCREENS_V2, { recursive: true })
    atelier = await launchAtelier({ name: 'beta-agents-llm', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('Atlas lists the videos in production, then everything says what to click when no account works', async () => {
    const { page } = atelier
    const shot = (name: string) => page.screenshot({ path: path.join(SCREENS_V2, `beta-agents-llm-${name}.png`) })
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')
    await api(page, 'orchestra.seed')
    const runs = (await api(page, 'production.list')) as { videoTitle: string; status: string }[]
    const active = runs.filter((r) => ['queued', 'running', 'waiting'].includes(r.status))

    // 1. Messages › Atlas: the question, one pass of the runtime, the answer with the runs in progress
    await page.getByTestId('rail-conversations').click()
    await expect(page.getByTestId('subscription-lock')).toHaveCount(0)
    await page.getByTestId('composer-input').fill(QUESTION)
    await page.getByTestId('composer-send').click()
    await expect(page.getByTestId('msg-pane')).toContainText(QUESTION, { timeout: 15_000 })
    await expect
      .poll(
        async () => {
          await api(page, 'orchestra.tick', { wait: true })
          return (await page.getByTestId('msg-pane').innerText()).includes('Voici ce qui est en production')
        },
        { timeout: 30_000 }
      )
      .toBe(true)
    if (active[0]) await expect(page.getByTestId('msg-pane')).toContainText(active[0].videoTitle)
    await page.waitForTimeout(300)
    await shot('atlas-production')

    // 2. No working subscription (the only account switched off): the agents and the script are locked
    const accounts = (await api(page, 'orchestra.accounts')) as { id: number; kind: string; label: string }[]
    for (const a of accounts.filter((x) => x.kind === 'claude-code' || x.kind === 'codex')) {
      await api(page, 'orchestra.saveAccount', { id: a.id, kind: a.kind, label: a.label, enabled: false })
    }
    expect(((await api(page, 'llm.access')) as { subscription: boolean }).subscription).toBe(false)
    await page.getByTestId('rail-agents').click()
    await expect(page.getByTestId('subscription-lock')).toBeVisible({ timeout: 15_000 })
    await shot('team-locked')
    await page.getByTestId('rail-conversations').click()
    await expect(page.getByTestId('subscription-lock')).toBeVisible({ timeout: 15_000 })
    // a message is answered at once, with the action, and kept
    await page.getByTestId('composer-input').fill('tu es là ?')
    await page.getByTestId('composer-send').click()
    await expect(page.getByTestId('msg-pane')).toContainText('Réglages › Claude', { timeout: 15_000 })
    await expect(page.getByTestId('msg-pane')).toContainText('Ton message est gardé')
    await page.waitForTimeout(300)
    await shot('messages-locked')
    // the card's button opens Réglages › Claude, where the director's choice lives
    await page.getByTestId('subscription-lock-connect').first().click()
    await expect(page.getByTestId('cli-accounts')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('director-backend')).toBeVisible()
    await page.getByTestId('director-backend').scrollIntoViewIfNeeded()
    await shot('settings-claude')
  })
})
