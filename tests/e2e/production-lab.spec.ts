// production-lab (Charlie's notes of 2026-11-01), in the built app, real mode, with the Cloud's prices kept: the Lab (« Créer
// une pipeline » the big button, « Nouvelle vidéo » beside it and no longer in the top bar, « Mes pipelines » on the side,
// « Pipelines prêtes » with categories and orders, no Atlas), the full « Pipelines prêtes » page, « Créer une pipeline »'s
// choices (« Depuis un code » locked in the beta), « Ajouter à mes pipelines → Modifier » opening the pipeline on its agent
// with Atlas beside the page, and no provider name anywhere. Then, with pipeline codes on (`ATELIER_PIPELINE_CODES=1`), a
// pipeline shared as a code and pasted back. Screenshots, dark and light: docs/screens/production-lab/.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { providerNamesIn } from '../fixtures/provider-names'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'production-lab')
const skipReason = noDesktopReason()

/** The engines a fresh Cloud publishes on its default grid (fakes; the Cloud's sources load through computed paths). */
async function cloudEngines(): Promise<unknown[]> {
  const CLOUD = 'cloud'
  const ENGINES = 'engines'
  const { createCloud } = (await import(`../../cloud/src/${CLOUD}.ts`)) as {
    createCloud(o: { dbPath: string; filesDir: string; signingKey: Buffer; keySource: null; paidCalls: boolean }): { pricing: { current(): unknown } }
  }
  const { FAKE_ENGINES, publishEngines } = (await import(`../../cloud/src/providers/${ENGINES}.ts`)) as {
    FAKE_ENGINES: unknown[]
    publishEngines(d: unknown[], r: { resolve(): { status: 'demo' } }, grid: unknown): unknown[]
  }
  const cloud = createCloud({ dbPath: ':memory:', filesDir: mkdtempSync(path.join(tmpdir(), 'atelier-e2e-lab-')), signingKey: Buffer.alloc(32, 7), keySource: null, paidCalls: false })
  return publishEngines(FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
}

/** What a user can read on the page: the text, and the titles, labels and alternative texts. */
const readable = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const attrs = [...document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')].map((e) => ['title', 'aria-label', 'alt', 'placeholder'].map((a) => e.getAttribute(a) ?? '').join(' '))
    return `${document.body.innerText}\n${attrs.join('\n')}`
  })

const setTheme = (page: Page, th: 'dark' | 'light') =>
  page.evaluate((x) => {
    document.documentElement.dataset.theme = x
  }, th)

/** A screenshot of the page (or of one element) in both themes. */
async function both(page: Page, name: string, target?: ReturnType<Page['getByTestId']>): Promise<void> {
  for (const th of ['dark', 'light'] as const) {
    await setTheme(page, th)
    await page.waitForTimeout(350)
    const file = path.join(OUT, `${name}-${th}.png`)
    if (target) await target.screenshot({ path: file })
    else await page.screenshot({ path: file })
  }
  await setTheme(page, 'dark')
}

test.describe('production-lab: the Lab, « Pipelines prêtes », Atlas beside the pipeline (codes off, the beta)', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'production-lab', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
    await api(atelier.page, 'settings.set', 'engines.cache', { at: '2026-11-01T09:00:00.000Z', engines: await cloudEngines() })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('Lab, ready pipelines, create, add → modify, the pipeline with Atlas', async () => {
    const { page } = atelier
    const clean = async (where: string): Promise<void> => expect(providerNamesIn(await readable(page)), where).toEqual([])

    // two pipelines of mine, one used by two channels
    const channels = (await api(page, 'channels.list')) as { id: number }[]
    const a = (await api(page, 'recipes.fromBase', 'avatar@1', 'Histoires vraies — avatar')) as { id: number }
    await api(page, 'recipes.fromBase', 'voiceover@1', 'Faits divers — voix off')
    for (const c of channels.slice(0, 2)) await api(page, 'recipes.useForChannel', c.id, 'avatar-long', a.id)
    // one video in production on it (a demo run on the fakes, free): its card counts it and its graph moves
    const first = channels[0]
    if (first) {
      const project = (await api(page, 'projects.create', { recipeId: a.id, channelId: first.id, title: 'Le phare de Cordouan', idea: 'Le plus vieux phare de France encore en service.' })) as { id: number }
      await api(page, 'projects.run', project.id).catch(() => null)
    }

    // the Lab: its tab is « Lab »; « Nouvelle vidéo » left the top bar for the Lab; no Atlas here
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await expect(page.getByTestId('page-production-apercu')).toHaveText('Lab')
    const lab = page.getByTestId('view-production-start')
    await expect(lab).toBeVisible()
    await expect(page.getByTestId('new-video')).toHaveCount(1)
    await expect(lab.getByTestId('new-video')).toBeVisible()
    await expect(page.getByTestId('atlas-dock')).toHaveCount(0)
    await expect(page.getByTestId('atlas-square')).toHaveCount(0)
    await expect(page.getByTestId('start-advanced')).toHaveCount(0)
    await expect(page.getByTestId(`recipe-${a.id}`)).toContainText('Long format')
    await expect(page.getByTestId(`recipe-channels-${a.id}`)).toContainText(channels.length >= 2 ? '2 chaînes' : 'chaîne')
    await expect(page.getByTestId(`recipe-price-${a.id}`)).toContainText('cr. / vidéo', { timeout: 10_000 })
    await expect(page.getByTestId('base-est-avatar@1-cost')).toContainText('crédits', { timeout: 10_000 })
    await expect(page.getByTestId('ready-cat-avatar')).toHaveText('Avatar')
    await expect(page.getByTestId('ready-sort')).toHaveValue('used')
    await clean('Lab')
    await both(page, 'lab')
    await both(page, 'card-mine', page.getByTestId(`recipe-${a.id}`))
    await both(page, 'card-ready', page.getByTestId('base-avatar@1'))

    // the category « Avatar » keeps only its pipelines
    await page.getByTestId('ready-cat-avatar').click()
    await expect(page.getByTestId('base-voiceover@1')).toHaveCount(0)
    await page.getByTestId('ready-cat-all').click()

    // « Voir »: what it makes and what can be set
    await page.getByTestId('see-avatar@1').click()
    await expect(page.getByTestId('see-dialog-avatar@1')).toBeVisible()
    await clean('Voir')
    await both(page, 'see')
    await page.keyboard.press('Escape')

    // « Voir toutes les pipelines »: the full page
    await page.getByTestId('ready-all').click()
    await expect(page.getByTestId('view-production-ready')).toBeVisible()
    await expect(page.getByTestId('base-avatar@1')).toBeVisible()
    await clean('Pipelines prêtes')
    await both(page, 'ready')
    await page.getByTestId('ready-back').click()

    // « Créer une pipeline »: the seven ways of the style agent (parcours-utilisateur), one of my channels, and « Depuis un code »
    // locked in the beta; a way opens the style screen on its own form
    await page.getByTestId('create-pipeline').click()
    // creation-conversationnelle: « Créer une pipeline » opens the conversation; the other ways are under « Autres façons »
    await page.getByTestId('creation-others').click()
    await expect(page.getByTestId('create-dialog')).toBeVisible()
    await expect(page.getByTestId('create-from-code')).toBeDisabled()
    await expect(page.getByTestId('create-from-style')).toBeEnabled()
    for (const p of ['own', 'translate', 'different', 'mix', 'inspire', 'rework']) await expect(page.getByTestId(`create-path-${p}`)).toBeEnabled()
    await expect(page.getByTestId('agent-recipe')).toBeEnabled()
    await both(page, 'create')
    await page.getByTestId('create-path-inspire').click()
    await expect(page.getByTestId('style-form-inspire')).toBeVisible()
    for (const axis of ['content', 'editing', 'motion', 'script']) await expect(page.getByTestId(`style-axis-${axis}`)).toBeVisible()
    await page.getByTestId('page-production-apercu').click()

    // « Ajouter à mes pipelines »: as is, or « Modifier » (recommended) → the pipeline opens on its agent
    await page.getByTestId('use-avatar@1').click()
    await expect(page.getByTestId('add-dialog-avatar@1')).toBeVisible()
    await both(page, 'add')
    await page.getByTestId('add-modify-avatar@1').click()
    await expect(page.getByTestId('view-production-recipes')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeFocused({ timeout: 10_000 })
    // codes off: no code, no « Partager », no « Exporter »
    await expect(page.getByTestId('recipe-code')).toHaveCount(0)
    await expect(page.getByTestId('recipe-share')).toHaveCount(0)
    await expect(page.getByTestId('recipe-export')).toHaveCount(0)
    // Atlas: a square on a 1440 px window, a panel beside the page on a wide one
    await expect(page.getByTestId('atlas-square')).toBeVisible()
    await page.setViewportSize({ width: 1680, height: 1000 })
    await expect(page.getByTestId('atlas-dock')).toBeVisible()
    await expect(page.getByTestId('atlas-square')).toBeHidden()
    await page.getByTestId('view-production-recipes').locator('.overflow-auto').first().evaluate((e) => e.scrollTo(0, 0))
    await clean('pipeline page')
    await both(page, 'pipeline-atlas')

    // Projets: Atlas too; « Nouvelle vidéo » opens its form
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('new-video').click()
    await expect(page.getByTestId('view-production-projects')).toBeVisible()
    await expect(page.getByTestId('new-project')).toBeVisible()
    await expect(page.getByTestId('atlas-dock')).toBeVisible()
    await both(page, 'projects-atlas')
    await page.setViewportSize({ width: 1440, height: 900 })
    // stop the demo run so the app closes quickly
    for (const p of (await api(page, 'projects.list')) as { runId: number | null }[]) if (p.runId !== null) await api(page, 'production.cancel', p.runId).catch(() => null)
  })
})

test.describe('production-lab: pipeline codes on (`ATELIER_PIPELINE_CODES=1`)', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(3 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    atelier = await launchAtelier({ name: 'production-lab-codes', runner: false, example: true, pipelineCodes: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('a pipeline shared as a code comes back from « Créer une pipeline → Depuis un code »', async () => {
    const { page } = atelier
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('use-avatar@1').click()
    await page.getByTestId('add-asis-avatar@1').click()
    await expect(page.getByTestId('recipe-code')).toContainText(/[0-9A-Z]{4}-[0-9A-Z]{4}/, { timeout: 10_000 })
    await expect(page.getByTestId('recipe-export')).toBeVisible()
    const code = ((await page.getByTestId('recipe-code').textContent()) ?? '').replace('Code', '').trim()
    await page.getByTestId('recipe-share').click()
    const text = await page.getByTestId('share-text').inputValue()
    expect(text.startsWith(`ATL1.${code.replace('-', '')}.`)).toBe(true)
    await page.screenshot({ path: path.join(OUT, 'share-dark.png') })
    await page.keyboard.press('Escape')

    await page.getByTestId('page-production-apercu').click()
    await page.getByTestId('create-pipeline').click()
    // creation-conversationnelle: « Créer une pipeline » opens the conversation; the other ways are under « Autres façons »
    await page.getByTestId('creation-others').click()
    await page.getByTestId('create-from-code').click()
    await page.getByTestId('code-input').fill(text)
    await page.getByTestId('code-import').click()
    await expect(page.getByTestId('view-production-recipes')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeFocused({ timeout: 10_000 })
    const list = (await api(page, 'recipes.list')) as { code: string }[]
    expect(list.map((r) => r.code)).toEqual([code, code])
  })
})
