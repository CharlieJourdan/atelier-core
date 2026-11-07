// Lot Z1 (prototype complet): walks every rail entry and every page of the shell, in dark then in light, on the
// example workspace, and saves one screenshot per screen under docs/screens/v2/prototype/. Every screen must be built
// (no "Page en préparation" placeholder), show its title, carry its DÉMO badge when the screen is mapped to a demo
// feature, and the strict CSP must never be violated.
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { t, type MessageKey } from '../../src/shared/fr'
import { COLUMN_SECTIONS, SCREEN_FEATURES, SECTION_IDS, SECTION_PAGES, SIDEBAR_GROUPS, tabsOf, type SectionId } from '../../src/shared/sections'
import { noDesktopReason } from './desktop'
import { launchAtelier, SCREENS_V2, type Atelier } from './launch'

const OUT = path.join(SCREENS_V2, 'prototype')
const skipReason = noDesktopReason()

interface Screen {
  section: SectionId
  page?: string
}

const SCREENS: Screen[] = SECTION_IDS.flatMap((section) => {
  const pages: readonly string[] = SECTION_PAGES[section]
  return pages.length ? pages.map((page) => ({ section, page })) : [{ section }]
})

const pageLabel = (section: SectionId, page: string): string => t(`page.${section}.${page}` as MessageKey)
/** Mes outils moved into Production (tab « Outils (bêta) », 774641e) but its screen keeps its own root, `view-outils`. */
const VIEW_ROOT: Readonly<Record<string, string>> = { 'production/outils': 'outils' }
const keyOf = (s: Screen): string => (s.page ? `${s.section}/${s.page}` : s.section)
const fileOf = (s: Screen, mode: string): string => path.join(OUT, `${s.page ? `${s.section}-${s.page}` : s.section}-${mode}.png`)

/** Sections without a sidebar entry since the proto refresh (commit 774641e): reachable by route and ⌘K only. */
const hasSidebarEntry = (section: SectionId): boolean => SIDEBAR_GROUPS.some((g) => g.includes(section)) || section === 'reglages'

/** Opens a route through the command palette (⌘K), the way to reach anything the sidebar and the page tabs do not list. */
async function openByPalette(page: Page, id: string, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.getByTestId('palette-input').fill(query)
  await page.getByTestId(`cmd-${id}`).click()
  await expect(page.getByTestId('palette')).toBeHidden()
}

async function open(page: Page, s: Screen): Promise<void> {
  if (hasSidebarEntry(s.section)) await page.getByTestId(`rail-${s.section}`).click()
  else await openByPalette(page, `go-${s.section}`, t(`section.${s.section}`))
  if (s.page) {
    // Since 774641e a page is a tab at the top (production's curated pages), a row of Réglages' column, or only
    // reachable from inside the screens and ⌘K (the other production pages): use what the UI offers, else the palette.
    const entry = page.getByTestId(`page-${s.section}-${s.page}`)
    if ((await entry.count()) > 0) await entry.click()
    else await openByPalette(page, `go-${s.section}-${s.page}`, `${t(`section.${s.section}`)} › ${pageLabel(s.section, s.page)}`)
    if ((await entry.count()) > 0) {
      await expect(entry).toHaveAttribute(tabsOf(s.section).includes(s.page) && !COLUMN_SECTIONS.includes(s.section) ? 'aria-selected' : 'aria-current', /true|page/)
    }
  }
  await expect(page.getByTestId('breadcrumb')).toHaveText(
    s.page ? `${t(`section.${s.section}`)} › ${pageLabel(s.section, s.page)}` : t(`section.${s.section}`)
  )
  if (hasSidebarEntry(s.section)) await expect(page.getByTestId(`rail-${s.section}`)).toHaveAttribute('aria-current', 'page')
  else await expect(page.locator('[data-testid^="rail-"][aria-current="page"]')).toHaveCount(0)
}

test.describe('Atelier prototype: every screen', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(10 * 60_000)

  let atelier: Atelier
  let page: Page
  const problems: string[] = []

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    // The example workspace makes every screen show something; the agents stay idle (no model is ever called).
    // the beta: the invented workspace is the « Mode présentation » (real mode is the default)
    atelier = await launchAtelier({ name: 'prototype', runner: false, example: true, presentation: true })
    page = atelier.page
    page.on('console', (m: ConsoleMessage) => {
      if (/content security policy|refused to/i.test(m.text())) problems.push(m.text())
    })
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    await expect(page.getByTestId('shell')).toBeVisible()
  })

  test.afterAll(async () => {
    await atelier?.close()
  })

  test('the example workspace is loaded on first launch', async () => {
    const status = (await page.evaluate(() =>
      (window as unknown as { atelier: { call: (m: string) => Promise<unknown> } }).atelier.call('example.status')
    )) as { loaded: boolean; channelIds: number[] }
    expect(status.loaded).toBe(true)
    expect(status.channelIds).toHaveLength(2)
  })

  for (const mode of ['dark', 'light'] as const) {
    test(`walks every screen in ${mode}`, async () => {
      const theme = await page.evaluate(() => document.documentElement.dataset.theme)
      if (theme !== mode) await page.getByTestId('theme-toggle').click()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(mode)
      for (const s of SCREENS) {
        await open(page, s)
        const main = page.locator('main')
        if (keyOf(s) !== 'reglages/legacy') {
          // Proto screens carry `view-<section>-<page>` since 774641e, the others `view-<section>`: exactly one root on show.
          const root = VIEW_ROOT[keyOf(s)] ?? s.section
          await expect(page.locator(`[data-testid="view-${root}"], [data-testid^="view-${root}-"]`), keyOf(s)).toBeVisible()
          await expect(main.getByRole('heading', { level: 1 }).first(), keyOf(s)).toBeVisible()
        }
        // Every screen is built: the placeholder of the shell never shows.
        await expect(main.getByText('Page en préparation'), keyOf(s)).toHaveCount(0)
        if (SCREEN_FEATURES[keyOf(s)]) await expect(main.getByTestId('demo-badge').first(), keyOf(s)).toBeVisible()
        // Let the screen load its data and finish its entry animations before the picture.
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(450)
        await expect(main.getByRole('alert').filter({ hasText: /Error|undefined|null/ }), keyOf(s)).toHaveCount(0)
        await page.screenshot({ path: fileOf(s, mode) })
      }
    })
  }

  test('no CSP violation and no page error during the walk', () => {
    expect(problems).toEqual([])
  })
})
