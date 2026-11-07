// Screenshots of the marketing site, account flow and founder console, dark and light, into docs/screens/site/.
//
//   npm run site:build
//   npx playwright test tests/e2e/site-shots.spec.ts
//
// The spec starts `vite preview` (dist-web/site) itself when nothing answers on SITE_URL (default http://127.0.0.1:4180).
// It uses the `chromium` of @playwright/test; when that browser build is not installed, point ATELIER_SITE_CHROMIUM at any
// Chromium / Chrome executable (for instance the one Playwright installed for an older version).
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.SITE_URL ?? 'http://127.0.0.1:4180'
const OUT = resolve(process.cwd(), 'docs/screens/site')
const THEMES = ['dark', 'light'] as const
const USER = JSON.stringify({ name: 'Alex', email: 'alex@example.com' })

let server: ChildProcess | null = null
let browser: Browser

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/tarifs`)
    return r.ok
  } catch {
    return false
  }
}

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  if (!(await reachable())) {
    server = spawn('npx', ['vite', 'preview', '-c', 'vite.site.config.ts'], { shell: true, stdio: 'ignore', cwd: process.cwd() })
    for (let i = 0; i < 60 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 500))
    expect(await reachable(), 'the site preview did not start: run `npm run site:build` first').toBe(true)
  }
  browser = await chromium.launch({ executablePath: process.env.ATELIER_SITE_CHROMIUM || undefined })
})

test.afterAll(async () => {
  await browser?.close()
  if (server?.pid) spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { shell: true, stdio: 'ignore' })
})

async function open(theme: 'dark' | 'light', init: { admin?: boolean; user?: string; width?: number; height?: number } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: init.width ?? 1440, height: init.height ?? 900 }, colorScheme: theme, reducedMotion: 'reduce' })
  await ctx.addInitScript(
    ({ admin, user }) => {
      try {
        if (admin) localStorage.setItem('atelier.site.admin', '1')
        if (user) localStorage.setItem('atelier.site.user', user)
      } catch {
        // storage blocked
      }
    },
    { admin: init.admin ?? false, user: init.user ?? '' }
  )
  return { ctx, page: await ctx.newPage() }
}

/** Loads every lazy image, waits for the fonts and makes the sticky header static so full-page shots have no ghost header. */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'header.sticky{position:static !important}' })
  await page.evaluate(async () => {
    document.querySelectorAll('img').forEach((i) => void (i.loading = 'eager'))
    await Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => void (i.onload = i.onerror = r)))))
    await document.fonts.ready
  })
  await page.waitForTimeout(250)
}

async function shot(page: Page, name: string, theme: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: resolve(OUT, `${name}-${theme}.png`), fullPage })
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

for (const theme of THEMES) {
  test.describe(theme, () => {
    for (const [name, path] of [
      ['landing', '/'],
      ['tarifs', '/tarifs'],
      ['connexion', '/connexion'],
      ['inscription', '/inscription']
    ] as const) {
      test(`${name}`, async () => {
        const { ctx, page } = await open(theme)
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        await settle(page)
        expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme)
        await shot(page, name, theme)
        await ctx.close()
      })
    }

    test('landing on a phone', async () => {
      const { ctx, page } = await open(theme, { width: 390, height: 844 })
      await page.goto(BASE + '/', { waitUntil: 'networkidle' })
      await settle(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await shot(page, 'landing-mobile', theme)
      await ctx.close()
    })

    test('welcome: plan, payment, provisioning, ready', async () => {
      const { ctx, page } = await open(theme, { user: USER })
      await page.goto(BASE + '/bienvenue', { waitUntil: 'networkidle' })
      await settle(page)
      await shot(page, 'bienvenue-plan', theme)
      await page.getByRole('radio', { name: /Studio/ }).click()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await expect(page.getByText('Paiement simulé')).toBeVisible()
      await shot(page, 'bienvenue-paiement', theme)
      await page.getByRole('button', { name: 'Confirmer (simulé)' }).click()
      await expect(page.getByText('On prépare ton ordinateur d’équipe')).toBeVisible()
      await page.waitForTimeout(3200)
      await shot(page, 'bienvenue-provisioning', theme)
      await expect(page.getByText('Ton équipe est prête')).toBeVisible({ timeout: 15_000 })
      await shot(page, 'bienvenue-pret', theme)
      await ctx.close()
    })

    test('admin: login then the seven pages', async () => {
      const { ctx, page } = await open(theme, { height: 1000 })
      await page.goto(BASE + '/admin', { waitUntil: 'networkidle' })
      await shot(page, 'admin-login', theme, false)
      await page.getByLabel('Mot de passe').fill('demo')
      await page.getByRole('button', { name: 'Entrer' }).click()
      await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible()
      for (const [name, path] of [
        ['admin-overview', '/admin'],
        ['admin-utilisateurs', '/admin/utilisateurs'],
        ['admin-machines', '/admin/machines'],
        ['admin-production', '/admin/production'],
        ['admin-couts', '/admin/couts'],
        ['admin-blueprints', '/admin/blueprints'],
        ['admin-fournisseurs', '/admin/fournisseurs']
      ] as const) {
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        await page.waitForTimeout(200)
        await shot(page, name, theme, false)
      }
      await ctx.close()
    })

    test('admin: user drawer, blueprint JSON, publish dialog', async () => {
      const { ctx, page } = await open(theme, { admin: true, height: 1000 })
      await page.goto(BASE + '/admin/utilisateurs', { waitUntil: 'networkidle' })
      await page.locator('tbody tr').nth(2).click()
      await expect(page.getByRole('button', { name: 'Fermer' })).toBeVisible()
      await shot(page, 'admin-utilisateur-fiche', theme, false)

      await page.goto(BASE + '/admin/blueprints', { waitUntil: 'networkidle' })
      await page.getByRole('tab', { name: 'JSON' }).click()
      await expect(page.getByText(/JSON valide :/)).toBeVisible()
      await shot(page, 'admin-blueprints-json', theme, false)
      await page.getByRole('tab', { name: 'Formulaire' }).click()
      await page.getByRole('tab', { name: /Pipelines/ }).click()
      await shot(page, 'admin-blueprints-pipelines', theme, false)
      await page.getByRole('button', { name: /Publier v4/ }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot(page, 'admin-blueprints-publier', theme, false)
      await page.getByRole('button', { name: /Publier pour/ }).click()
      await expect(page.getByText(/v4 publiée :/)).toBeVisible()
      await ctx.close()
    })
  })
}

test('the demo build of the app is served under /app/', async () => {
  const { ctx, page } = await open('dark')
  await page.goto(BASE + '/app/', { waitUntil: 'networkidle' })
  await expect(page.getByText('Bonsoir')).toBeVisible()
  await ctx.close()
})
