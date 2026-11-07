// Proto refresh (2026-10-24): screenshots of the new screens, dark and light, for review. Runs only when asked
// (ATELIER_PROTO_SHOTS=1, after `npm run build`) and writes docs/screens/proto/<name>-<theme>.png.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'proto')
const ONLY = (process.env.ATELIER_PROTO_ONLY ?? '').split(',').filter(Boolean)

interface Shot {
  name: string
  section: string
  page?: string
  /** Extra clicks (data-testid) before the shot. */
  clicks?: string[]
  /** Clicks that leave the page (so they are not clicked again after the shot). */
  keep?: boolean
  /** Visit Accueil first, so a screen that kept local state (an open editor) starts fresh. */
  fresh?: boolean
  /** Close what the clicks opened with Escape instead of clicking the same elements again. */
  escape?: boolean
  /** Clicks (data-testid) after the shot, to leave the screen as it was found. */
  after?: string[]
  /** Clicks that put the screen back afterwards (default: the same clicks again, for toggles). */
  undo?: string[]
}

const ONBOARDING_SHOTS = ['onboarding-1', 'onboarding-2', 'onboarding-3', 'onboarding-3-google', 'onboarding-3-translate', 'onboarding-4', 'onboarding-4-done', 'onboarding-5', 'onboarding-6', 'onboarding-6b', 'onboarding-7-run', 'onboarding-7', 'onboarding-8']

const SHOTS: Shot[] = [
  { name: 'accueil', section: 'accueil' },
  { name: 'accueil-agent-panel', section: 'accueil', clicks: ['agent-panel-toggle'] },
  { name: 'planning', section: 'planning' },
  { name: 'planning-detail', section: 'planning', clicks: ['planning-event-first'] },
  { name: 'planning-month', section: 'planning', clicks: ['planning-view-month'] },
  { name: 'production-apercu', section: 'production', page: 'apercu' },
  { name: 'production-pipeline', section: 'production', page: 'pipeline' },
  { name: 'production-bibliotheque', section: 'production', page: 'bibliotheque' },
  { name: 'production-ressources', section: 'production', page: 'ressources' },
  { name: 'agents', section: 'agents' },
  { name: 'agents-sheet', section: 'agents', clicks: ['agent-card-ag-enigmes-edit'], escape: true },
  { name: 'agents-recruit', section: 'agents', clicks: ['agents-recruit'], escape: true },
  { name: 'agents-bychannel', section: 'agents', clicks: ['agents-view-bychannel'], after: ['agents-view-chart'] },
  { name: 'agents-load', section: 'agents', clicks: ['agents-view-load'], after: ['agents-view-chart'] },
  { name: 'conversations', section: 'conversations' },
  { name: 'conversations-group', section: 'conversations', clicks: ['conv-row-th-group-ch-enigmes'], after: ['conv-row-th-principal'] },
  { name: 'conversations-video', section: 'conversations', clicks: ['conv-row-th-video-templiers'], after: ['conv-row-th-principal'] },
  { name: 'cerveau', section: 'cerveau', clicks: ['competitor-node-cp-enigmes-5'], keep: true, fresh: true },
  { name: 'cerveau-niches', section: 'cerveau', clicks: ['brain-tab-niches', 'niche-circle-luxury'], keep: true, fresh: true },
  { name: 'cerveau-idees', section: 'cerveau', clicks: ['brain-tab-ideas'], keep: true, fresh: true },
  { name: 'chaines', section: 'chaines' },
  { name: 'chaines-add', section: 'chaines', clicks: ['add-channel'], undo: ['onboarding-skip'] },
  { name: 'chaines-detail', section: 'chaines', clicks: ['channel-open-ch-enigmes'], undo: ['channel-back'] },
  { name: 'chaines-detail-styles', section: 'chaines', clicks: ['channel-open-ch-enigmes', 'channel-tab-styles'], undo: ['channel-back'] },
  { name: 'chaines-detail-competitors', section: 'chaines', clicks: ['channel-open-ch-enigmes', 'channel-tab-competitors'], undo: ['channel-back'] },
  { name: 'chaines-detail-connections', section: 'chaines', clicks: ['channel-open-ch-top', 'channel-tab-connections'], undo: ['channel-back'] },
  { name: 'monetisation', section: 'monetisation' },
  { name: 'ordinateurs', section: 'ordinateurs' },
  { name: 'reglages', section: 'reglages' },
  { name: 'aide', section: 'accueil', clicks: ['help-button'], escape: true }
]

test.describe('proto screenshots', () => {
  test.skip(process.env.ATELIER_PROTO_SHOTS !== '1', 'set ATELIER_PROTO_SHOTS=1 to take the proto screenshots')
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    // the beta: the invented workspace is the « Mode présentation » (real mode is the default)
    atelier = await launchAtelier({ name: 'proto-shots', runner: false, example: true, presentation: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  for (const theme of ['dark', 'light'] as const) {
    test(`proto screens (${theme})`, async () => {
      const { page } = atelier
      await page.evaluate((th) => {
        document.documentElement.dataset.theme = th
      }, theme)
      for (const shot of SHOTS) {
        if (ONLY.length > 0 && !ONLY.includes(shot.name)) continue
        if (shot.fresh) await page.getByTestId('rail-accueil').click()
        await page.getByTestId(`rail-${shot.section}`).click()
        if (shot.page) {
          const tab = page.getByTestId(`page-${shot.section}-${shot.page}`)
          if (await tab.count()) await tab.first().click()
          else await page.evaluate(() => undefined)
        }
        for (const c of shot.clicks ?? []) await page.getByTestId(c).click()
        await page.waitForTimeout(450)
        await expect(page.getByTestId('shell')).toBeVisible()
        await page.screenshot({ path: path.join(OUT, `${shot.name}-${theme}.png`) })
        if (shot.escape) await page.keyboard.press('Escape')
        else if (!shot.keep) for (const c of shot.undo ?? shot.clicks ?? []) await page.getByTestId(c).click()
        for (const c of shot.after ?? []) await page.getByTestId(c).click()
      }
    })

    // The onboarding: replayed from Chaînes, one screenshot per step (and a few in between states), then back to the shell.
    test(`onboarding steps (${theme})`, async () => {
      test.setTimeout(150_000)
      const wanted = (name: string): boolean => ONLY.length === 0 || ONLY.includes(name) || ONLY.includes('onboarding')
      if (!ONBOARDING_SHOTS.some(wanted)) test.skip()
      const { page } = atelier
      const shot = async (name: string): Promise<void> => {
        if (wanted(name)) await page.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) })
      }
      const next = async (): Promise<void> => {
        await expect(page.getByTestId('onboarding-next')).toBeEnabled()
        await page.getByTestId('onboarding-next').click()
        await page.waitForTimeout(450)
      }
      await page.evaluate((th) => {
        document.documentElement.dataset.theme = th
      }, theme)
      await page.getByTestId('rail-chaines').click()
      await page.getByTestId('replay-onboarding').click()
      await expect(page.getByTestId('onboarding-step-1')).toBeVisible()

      await page.waitForTimeout(1800)
      await shot('onboarding-1')
      await next()

      await expect(page.getByTestId('onboarding-step-2')).toBeVisible()
      await page.getByTestId('engine-login').click()
      await page.waitForTimeout(1700)
      await shot('onboarding-2')
      await next()

      await expect(page.getByTestId('onboarding-step-3')).toBeVisible()
      await page.getByTestId('channel-yes').click()
      await page.getByTestId('onboarding-channel-link').fill('youtube.com/@grandesenigmes')
      await page.getByTestId('onboarding-google').click()
      await page.waitForTimeout(450)
      await shot('onboarding-3-google')
      await page.getByTestId('google-allow').click()
      await page.waitForTimeout(450)
      await shot('onboarding-3')
      await page.getByTestId('channel-no').click()
      await page.getByTestId('creation-translate').click()
      await page.getByTestId('onboarding-translate-link').fill('youtube.com/@grandesenigmes')
      await page.getByTestId('translate-lang-es').click()
      await page.waitForTimeout(300)
      await shot('onboarding-3-translate')
      await page.getByTestId('channel-yes').click()
      await next()

      await expect(page.getByTestId('onboarding-step-4')).toBeVisible()
      await page.waitForTimeout(4600)
      await shot('onboarding-4')
      await page.getByTestId('onboarding-skip-analysis').click()
      await page.waitForTimeout(500)
      await shot('onboarding-4-done')
      await next()

      await expect(page.getByTestId('onboarding-step-5')).toBeVisible()
      await shot('onboarding-5')
      await next()

      await expect(page.getByTestId('onboarding-step-6')).toBeVisible()
      await shot('onboarding-6')
      await page.getByTestId('onboarding-questions').evaluate((el) => {
        let n: Element | null = el
        while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement
        n?.scrollTo({ top: n.scrollHeight })
      })
      await page.waitForTimeout(300)
      await shot('onboarding-6b')
      await next()

      await expect(page.getByTestId('onboarding-step-7')).toBeVisible()
      await page.waitForTimeout(2500)
      await shot('onboarding-7-run')
      await page.getByTestId('onboarding-skip-test').click()
      await page.waitForTimeout(700)
      await shot('onboarding-7')
      await next()

      await expect(page.getByTestId('onboarding-step-8')).toBeVisible()
      await page.waitForTimeout(3800)
      await shot('onboarding-8')
      await page.getByTestId('onboarding-finish').click()
      await expect(page.getByTestId('shell')).toBeVisible()
    })
  }
})
