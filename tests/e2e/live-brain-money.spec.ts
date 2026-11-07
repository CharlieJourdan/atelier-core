// Real mode, Cerveau and Monétisation, end to end in the built app (example workspace, the deterministic fake team: never a
// real model, and « Demander 5 idées » is not clicked because it would ask the user's Claude Code). Cerveau shows an
// idea created through the API, an idea created from the screen lands in `ideas.list` (validate, launch as a video,
// edit, delete too), the competitor map and the niche map are labelled as demo data. Monétisation shows the real spend
// ledger and the real month's figures, and a revenue entered from the screen lands in `money.revenues.list`.
// Screenshots: docs/screens/proto/{cerveau,monetisation}-live-dark.png.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'proto')
const skipReason = noDesktopReason()

interface Idea {
  id: number
  channelId: number
  title: string
  angle: string
  status: string
  videoId: number | null
  source: string
}
interface Revenue {
  id: number
  channelId: number | null
  type: string
  amountCents: number
  note: string
  currency: string
}
interface Spend {
  spentUsd: number
  calls: number
}
interface Overview {
  totals: { revenueCents: number; costCents: number }
}

test.describe('real mode: Cerveau and Monétisation on the database', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'live-brain-money', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('ideas: read from the API, created / validated / launched / edited / deleted from the screen', async () => {
    const { page } = atelier
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}-live-dark.png`) })
    const ideas = async (): Promise<Idea[]> => (await api(page, 'ideas.list')) as Idea[]
    const channel = (await api(page, 'channels.create', { name: 'Chaîne réelle', niche: 'histoire' })) as { id: number }
    const made = (await api(page, 'ideas.create', { channelId: channel.id, title: 'Idée créée par l’API', angle: 'Un angle venu de la base' })) as Idea

    // the beta: real mode is the default (no switch)
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')
    await page.getByTestId('rail-cerveau').click()
    await page.getByTestId('brain-tab-ideas').click()

    // 1. The board is the database's: the idea made through the API is there, the demo board is not.
    const board = page.getByTestId('ideas-board')
    await expect(board).toContainText('Idée créée par l’API', { timeout: 15_000 })
    await expect(board).not.toContainText('3 énigmes de l’Antiquité')
    const card = page.locator(`[data-testid="idea-card"][data-idea="idea-${made.id}"]`)
    await expect(card).toHaveAttribute('data-column', 'proposed')
    await expect(card).toContainText('Saisie à la main')
    await expect(page.getByTestId('live-demo-badge')).toHaveCount(0) // the ideas are real: no demo label on this tab

    // 2. Creating an idea from the screen writes it to the database.
    await page.getByTestId('idea-add').click()
    const dialog = page.getByTestId('idea-dialog')
    await dialog.locator('#idea-channel').selectOption({ label: 'Chaîne réelle' })
    await dialog.locator('#idea-title').fill('Le manuscrit de Voynich')
    await dialog.locator('#idea-angle').fill('Ce que les experts savent vraiment')
    await dialog.getByTestId('idea-save').click()
    await expect.poll(async () => (await ideas()).find((i) => i.title === 'Le manuscrit de Voynich')?.angle, { timeout: 10_000 }).toBe('Ce que les experts savent vraiment')
    const typed = (await ideas()).find((i) => i.title === 'Le manuscrit de Voynich')!
    expect(typed).toMatchObject({ channelId: channel.id, source: 'manual', status: 'new' })
    const typedCard = page.locator(`[data-testid="idea-card"][data-idea="idea-${typed.id}"]`)
    await expect(typedCard).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(300)
    await shot('cerveau')

    // 3. Valider → kept; Lancer → a video is created from the idea (`ideas.toVideo`) and the idea is used.
    await typedCard.getByTestId('idea-validate').click()
    await expect.poll(async () => (await ideas()).find((i) => i.id === typed.id)?.status, { timeout: 10_000 }).toBe('kept')
    await expect(typedCard).toHaveAttribute('data-column', 'validated')
    await typedCard.getByTestId('idea-launch').click()
    await expect.poll(async () => (await ideas()).find((i) => i.id === typed.id)?.status, { timeout: 10_000 }).toBe('used')
    expect((await ideas()).find((i) => i.id === typed.id)?.videoId).not.toBeNull()
    await expect(typedCard).toHaveAttribute('data-column', 'production')

    // 4. Edit the API idea, then delete it.
    await card.getByTestId('idea-edit').click()
    await page.getByTestId('idea-dialog').locator('#idea-title').fill('Titre revu à la main')
    await page.getByTestId('idea-save').click()
    await expect.poll(async () => (await ideas()).find((i) => i.id === made.id)?.title, { timeout: 10_000 }).toBe('Titre revu à la main')
    await card.getByTestId('idea-delete').click()
    await expect.poll(async () => (await ideas()).some((i) => i.id === made.id), { timeout: 10_000 }).toBe(false)
    await expect(card).toHaveCount(0)

    // 5. The competitors are the real channels' (the eyes): no demo map any more (the beta); the niche map keeps its label.
    await page.getByTestId('brain-tab-competitors').click()
    await expect(page.getByTestId('competitors-live')).toBeVisible()
    await expect(page.locator('[data-testid="live-demo-badge"][data-block="competitors"]')).toHaveCount(0)
    await expect(page.getByTestId('outperformer-add')).toHaveCount(0) // example videos do not become real ideas
    await page.waitForTimeout(300)
    await shot('cerveau-concurrents')
    await page.getByTestId('brain-tab-niches').click()
    await expect(page.locator('[data-testid="live-demo-badge"][data-block="niches"]')).toBeVisible()
  })

  test('money: the real ledger, this month’s figures and a revenue entered from the screen', async () => {
    const { page } = atelier
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}-live-dark.png`) })
    const channels = (await api(page, 'channels.list')) as { id: number; name: string; example?: boolean }[]
    const real = channels.find((c) => c.name === 'Chaîne réelle')!

    // some real spend: a turn of the main agent (the deterministic fake team) is settled in the ledger like any model call
    const agents = (await api(page, 'orchestra.agents')) as { id: number; role: string }[]
    await api(page, 'orchestra.say', { agentId: agents.find((a) => a.role === 'principal')!.id, text: 'Fais le point sur les coûts' })
    await api(page, 'orchestra.tick', { wait: true })
    await expect.poll(async () => ((await api(page, 'spend.overview')) as Spend).calls, { timeout: 20_000 }).toBeGreaterThan(0)
    const before = (await api(page, 'spend.overview')) as Spend
    expect(before.spentUsd).toBeGreaterThan(0)

    // the beta: real mode is the default (no switch)
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')
    await page.getByTestId('rail-monetisation').click()
    await expect(page.getByTestId('money-ledger')).toBeVisible({ timeout: 15_000 })

    // 1. The ledger line is the spend ledger's total, to the cent, and the cost KPI is built on the month's P&L.
    const ledger = (await api(page, 'spend.overview')) as Spend
    expect(ledger.spentUsd).toBeGreaterThanOrEqual(before.spentUsd)
    expect(ledger.spentUsd).toBeGreaterThan(0)
    await expect(page.getByTestId('money-ledger-total')).toHaveAttribute('data-usd', String(ledger.spentUsd))
    await expect(page.getByTestId('money-ledger-calls')).toContainText(`Appels au modèle : ${ledger.calls}`)
    const overview = (await api(page, 'money.overview')) as Overview
    const kpi = (id: string) => page.locator(`[data-kpi="${id}"]`)
    await expect(kpi('revenue')).toContainText('Revenus du mois')
    await expect(kpi('cost')).toContainText('Coûts du mois')
    expect(overview.totals.revenueCents).toBe(0) // the example workspace's figures are not the real ones

    // 2. Nothing demo is invented here: the demo's sponsors are not in the list, and expenses cannot be typed.
    await expect(page.getByTestId('money-entries')).not.toContainText('NordVPN')
    await expect(page.getByTestId('money-add-expense')).toHaveCount(0)
    // the beta: the credits are the Atelier Cloud account's; offline here, the block says there is no account
    await expect(page.getByTestId('money-balance-offline')).toBeVisible()
    await expect(page.locator('[data-testid="live-demo-badge"][data-block="credits"]')).toHaveCount(0)

    // 3. A revenue entered from the screen is written through `money.revenues.save`.
    await page.getByTestId('money-add-revenue').click()
    const dialog = page.getByTestId('entry-dialog-revenue')
    await dialog.locator('#entry-kind').selectOption('sponsor')
    await dialog.locator('#entry-channel').selectOption({ label: 'Chaîne réelle' })
    await dialog.locator('#entry-label').fill('Sponsor réel')
    await dialog.locator('#entry-amount').fill('250')
    await dialog.getByTestId('entry-confirm').click()
    await expect
      .poll(async () => ((await api(page, 'money.revenues.list')) as Revenue[]).find((r) => r.note === 'Sponsor réel')?.amountCents, { timeout: 10_000 })
      .toBe(25_000)
    const saved = ((await api(page, 'money.revenues.list')) as Revenue[]).find((r) => r.note === 'Sponsor réel')!
    expect(saved).toMatchObject({ channelId: real.id, type: 'sponsor', currency: 'EUR' })
    await expect(page.getByTestId('money-entries')).toContainText('Sponsor réel', { timeout: 10_000 })
    // the month's revenue is now the measured one, in the KPI and in the channel's row
    await expect.poll(async () => ((await api(page, 'money.overview')) as Overview).totals.revenueCents, { timeout: 10_000 }).toBe(25_000)
    await expect(kpi('revenue')).toContainText('250', { timeout: 15_000 })
    await expect(page.locator('[data-testid="pnl-row"]').filter({ hasText: 'Chaîne réelle' })).toContainText('250', { timeout: 10_000 })

    // 4. A subscription price typed on an AI account is counted in the costs.
    const price = page.getByTestId('money-sub-price').first()
    await price.fill('20')
    await price.press('Enter')
    await expect.poll(async () => JSON.stringify(await api(page, 'settings.get', 'money.subscriptions')), { timeout: 10_000 }).toMatch(/20/)
    await expect(page.getByTestId('money-subs-total')).toContainText('20', { timeout: 10_000 })
    await page.setViewportSize({ width: 1440, height: 1700 }) // the whole screen in one picture
    await page.waitForTimeout(400)
    await shot('monetisation')
    await page.setViewportSize({ width: 1440, height: 900 })

    // 5. Deleting the revenue removes it from the database and from the totals.
    await page.getByTestId('money-entry').filter({ hasText: 'Sponsor réel' }).getByTestId('money-entry-delete').click()
    await expect
      .poll(async () => ((await api(page, 'money.revenues.list')) as Revenue[]).some((r) => r.note === 'Sponsor réel'), { timeout: 10_000 })
      .toBe(false)
    await expect.poll(async () => ((await api(page, 'money.overview')) as Overview).totals.revenueCents, { timeout: 10_000 }).toBe(0)
  })
})
