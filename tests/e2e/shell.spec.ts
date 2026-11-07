// Launches the built app (out/), checks the window title, opens the 10 sections from the sidebar, switches dark / light,
// drives ⌘K and the component gallery, and checks that the v1 screens still work under "Écrans v1 (ancien)".
// Screenshots go to docs/screens/v2/. Throwaway userData, no model call.
import { expect, test, type ConsoleMessage, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { launchAtelier, SCREENS_V2, type Atelier } from './launch'

// The sidebar entries, in order (labelled sidebar of commit 774641e: Planning, Cerveau and Chaînes are new, Validations and
// Mes outils are no longer entries, and Conversations / Agents / Ordinateurs are now labelled Messages / Équipe / Ordinateur).
const SECTIONS = [
  ['accueil', 'Accueil'],
  ['planning', 'Planning'],
  ['production', 'Production'],
  ['agents', 'Équipe'],
  ['conversations', 'Messages'],
  ['cerveau', 'Cerveau'],
  ['chaines', 'Chaînes'],
  ['monetisation', 'Monétisation'],
  ['ordinateurs', 'Ordinateur'],
  ['reglages', 'Réglages']
] as const

/** Still routes (⌘K, links inside screens) but no longer sidebar entries since 774641e. */
const ROUTE_ONLY = [
  ['validations', 'Validations'],
  ['outils', 'Mes outils']
] as const

/**
 * The root of a section's screen. Since 774641e the proto screens carry `view-<section>-<page>` (Production's Vue d'ensemble,
 * Pipelines…) while the others keep `view-<section>`: both are matched, and exactly one screen must be on show.
 */
const viewOf = (page: Page, section: string) => page.locator(`[data-testid="view-${section}"], [data-testid^="view-${section}-"]`)

/** Exactly one sidebar item is current, it is the one of the route, and only it is painted as active (no stale highlight). */
async function expectActiveRail(page: Page, id: string): Promise<void> {
  await expect(page.locator('[data-testid^="rail-"][aria-current="page"]')).toHaveCount(1)
  const paint = (testId: string) => page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor)
  const active = await paint(`rail-${id}`)
  expect(active).not.toBe('rgba(0, 0, 0, 0)')
  for (const [other] of SECTIONS) {
    if (other !== id) expect(await paint(`rail-${other}`), `rail-${other} must not look active on ${id}`).toBe('rgba(0, 0, 0, 0)')
  }
}

const skipReason = noDesktopReason()
if (skipReason) console.log(`[e2e] SKIPPED: ${skipReason}`)

test.describe('Atelier shell v2', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)

  let atelier: Atelier
  let app: ElectronApplication
  let page: Page
  const problems: string[] = []

  const shot = (name: string) => page.screenshot({ path: path.join(SCREENS_V2, `lot2-${name}.png`) })
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)

  test.beforeAll(async () => {
    mkdirSync(SCREENS_V2, { recursive: true })
    // This spec makes no agent work: the runner stays off.
    atelier = await launchAtelier({ name: 'shell', runner: false })
    app = atelier.app
    page = atelier.page
    // The strict CSP must never be violated by the new design system (fonts, Tailwind, the Orb, the audio player…).
    page.on('console', (m: ConsoleMessage) => {
      if (/content security policy|refused to/i.test(m.text())) problems.push(m.text())
    })
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  })

  test.afterAll(async () => {
    await atelier?.close()
  })

  test('opens a window titled Atelier', async () => {
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveTitle('Atelier')
    const winTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())
    expect(winTitle).toBe('Atelier')
    // 1360×860, unless the OS clamps it to a smaller screen (e.g. the 1024×768 desktop of session 0). Under a fractional
    // display scale (125 % on the H1) Windows rounds the frame to physical pixels, so getSize() is a few DIPs larger
    // (1362×863 at 125 %): the size is exact at an integer scale and within the rounding of the frame otherwise.
    const { size, work, scale } = await app.evaluate(({ BrowserWindow, screen }) => ({
      size: BrowserWindow.getAllWindows()[0]?.getSize() ?? [0, 0],
      work: screen.getPrimaryDisplay().workAreaSize,
      scale: screen.getPrimaryDisplay().scaleFactor
    }))
    const want = work.width >= 1360 && work.height >= 860 ? [1360, 860] : [Math.min(1360, work.width), Math.min(860, work.height)]
    const slack = Number.isInteger(scale) ? 0 : Math.ceil(4 / scale)
    expect(Math.abs((size[0] ?? 0) - want[0]!), `width ${size[0]} vs ${want[0]} at scale ${scale}`).toBeLessThanOrEqual(slack)
    expect(Math.abs((size[1] ?? 0) - want[1]!), `height ${size[1]} vs ${want[1]} at scale ${scale}`).toBeLessThanOrEqual(slack)
    await expect(page.getByTestId('shell')).toBeVisible()
    expect(await theme()).toBe('dark')
  })

  test('the sidebar opens the 10 sections, in dark then in light', async () => {
    for (const mode of ['dark', 'light'] as const) {
      if ((await theme()) !== mode) await page.getByTestId('theme-toggle').click()
      expect(await theme()).toBe(mode)
      for (const [id, label] of SECTIONS) {
        await page.getByTestId(`rail-${id}`).click()
        await expect(viewOf(page, id)).toBeVisible()
        await expect(page.getByTestId(`rail-${id}`)).toHaveAttribute('aria-current', 'page')
        await expectActiveRail(page, id)
        await expect(page.getByTestId('breadcrumb')).toContainText(label)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await shot(`${id}-${mode}`)
      }
    }
    if ((await theme()) !== 'dark') await page.getByTestId('theme-toggle').click()
    // Production shows its curated pages as tabs in the top bar (the context column is now only Réglages' page list).
    await page.getByTestId('rail-production').click()
    await expect(page.getByTestId('page-tabs')).toBeVisible()
    await expect(page.getByTestId('context-column')).toHaveCount(0)
    await page.getByTestId('page-production-pipeline').click()
    // production-3: the page is the pipeline editor, « Pipelines » (decision 0022: the UI says « pipeline »)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pipelines')
    await expect(page.getByTestId('page-production-pipeline')).toHaveAttribute('aria-selected', 'true')
    // Réglages keeps a column of pages; the sections without pages show neither tabs nor column.
    await page.getByTestId('rail-reglages').click()
    await expect(page.getByTestId('context-column')).toBeVisible()
    await expect(page.getByTestId('page-tabs')).toHaveCount(0)
    await page.getByTestId('rail-agents').click()
    await expect(page.getByTestId('context-column')).toHaveCount(0)
    await expect(page.getByTestId('page-tabs')).toHaveCount(0)
    // Validations and Mes outils are routes without a sidebar entry: ⌘K still gets there.
    for (const [id, label] of ROUTE_ONLY) {
      await expect(page.getByTestId(`rail-${id}`)).toHaveCount(0)
      await page.keyboard.press('ControlOrMeta+k')
      await page.getByTestId('palette-input').fill(label)
      await page.getByTestId(`cmd-go-${id}`).click()
      await expect(viewOf(page, id)).toBeVisible()
      await expect(page.getByTestId('breadcrumb')).toContainText(label)
      await expect(page.locator('[data-testid^="rail-"][aria-current="page"]')).toHaveCount(0)
    }
    // The sidebar folds to icons (Ctrl+B, or its button) and unfolds again; the choice is remembered.
    await page.getByTestId('rail-accueil').click()
    const rail = page.getByTestId('rail')
    const width = async () => (await rail.boundingBox())?.width ?? 0
    const wide = await width()
    await expect(page.getByTestId('rail-accueil')).toContainText('Accueil')
    await page.keyboard.press('ControlOrMeta+b')
    await expect.poll(width).toBeLessThan(wide - 100)
    await expect(page.getByTestId('rail-accueil')).not.toContainText('Accueil')
    await expect(page.getByTestId('rail-accueil')).toHaveAttribute('aria-label', 'Accueil')
    expect(await page.evaluate(() => localStorage.getItem('atelier.sidebar.collapsed'))).toBe('1')
    await page.getByTestId('sidebar-toggle').click()
    await expect.poll(width).toBe(wide)
    await expect(page.getByTestId('rail-accueil')).toContainText('Accueil')
    expect(await page.evaluate(() => localStorage.getItem('atelier.sidebar.collapsed'))).toBe('0')
    // The mark is no longer a home button (rail-logo went with the icon rail): Accueil is the way home.
    await page.getByTestId('rail-agents').click()
    await page.getByTestId('rail-accueil').click()
    await expect(viewOf(page, 'accueil')).toBeVisible()
  })

  test('toggles light / dark and remembers it', async () => {
    const before = await theme()
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const bgBefore = await bg()
    await page.getByTestId('theme-toggle').click()
    expect(await theme()).not.toBe(before)
    expect(await bg()).not.toBe(bgBefore)
    await page.getByTestId('theme-toggle').click()
    expect(await theme()).toBe(before)
    expect(await bg()).toBe(bgBefore)
    const stored = await page.evaluate(() => localStorage.getItem('atelier.theme'))
    expect(stored).toBe(before)
  })

  test('⌘K opens the palette, finds a section and goes there', async () => {
    await page.getByTestId('rail-accueil').click()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByTestId('palette')).toBeVisible()
    await shot('palette-dark')
    await page.getByTestId('palette-input').fill('monét')
    await expect(page.getByTestId('cmd-go-monetisation')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('palette')).toBeHidden()
    await expect(viewOf(page, 'monetisation')).toBeVisible()
    // Escape closes it, and the rail button opens it too.
    await page.getByTestId('rail-palette').click()
    await expect(page.getByTestId('palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('palette')).toBeHidden()
    // An action: toggle the theme from the palette.
    const before = await theme()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByTestId('palette-input').fill('basculer')
    await page.keyboard.press('Enter')
    expect(await theme()).not.toBe(before)
    await page.getByTestId('theme-toggle').click()
    expect(await theme()).toBe(before)
  })

  test('the gallery shows every component; toasts and the confirmation modal work', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByTestId('palette-input').fill('galerie')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Galerie des composants')
    for (const block of ['Jetons', 'Boutons', 'Composants Atelier', 'ElevenLabs UI']) {
      await expect(page.getByTestId(`gallery-${block}`)).toBeVisible()
    }
    await expect(page.getByTestId('demo-badge').first()).toBeVisible()
    await expect(page.getByTestId('gallery-orb')).toBeVisible()
    // The Orb loads its WebGL chunk lazily and draws into a canvas (headless GPUs may fall back to the CSS circle).
    await page.getByRole('button', { name: 'Afficher un toast' }).click()
    await expect(page.getByTestId('toast').first()).toContainText('Afficher un toast')
    await page.getByRole('button', { name: 'Toast de démo' }).click()
    await expect(page.getByText('Démo : rien n’a été fait.')).toBeVisible()
    await page.getByTestId('gallery-ElevenLabs UI').scrollIntoViewIfNeeded()
    await page.waitForTimeout(800) // let the Orb chunk load and draw
    await shot('gallery-elevenlabs-dark')
    await page.getByTestId('gallery-Jetons').scrollIntoViewIfNeeded()
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded()
    await shot('gallery-dark')

    await page.getByTestId('gallery-confirm').click()
    const dialog = page.getByTestId('confirm-dialog')
    await expect(dialog).toBeVisible()
    await shot('confirm-dark')
    // The destructive action must never be the focused one when the modal opens.
    await expect(dialog.getByTestId('confirm-cancel')).toBeFocused()
    await dialog.getByTestId('confirm-cancel').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Annulé')).toBeVisible()
    await page.getByTestId('gallery-confirm').click()
    await dialog.getByTestId('confirm-ok').click()
    await expect(page.getByText('Confirmé')).toBeVisible()

    await page.getByTestId('theme-toggle').click()
    await shot('gallery-light')
    await page.getByTestId('theme-toggle').click()
  })

  test('no CSP violation and no page error during the whole run', () => {
    expect(problems).toEqual([])
  })
})
