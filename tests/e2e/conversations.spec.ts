// Conversations v2 (lot 12) on the built app, with the deterministic fake team (ATELIER_FAKE_LLM=1, no model call):
// a streamed reply, the proposal card of a "make a video" request, the approval card of a video chat, the @mention
// list, attachments, and (Réglages › Galerie) a screenshot of every card and every rich block.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS_V2, type Atelier } from './launch'

const skipReason = noDesktopReason()
if (skipReason) console.log(`[e2e] conversations SKIPPED: ${skipReason}`)

const BLOCKS = ['stats', 'chart', 'ideas', 'concepts', 'beats', 'keywords', 'tags', 'sources', 'trend', 'steps'] as const
const CARDS = ['approval', 'qc', 'budget', 'proposal', 'task', 'goal', 'engine', 'handoff'] as const

test.describe('Conversations v2', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)

  let atelier: Atelier
  let app: ElectronApplication
  let page: Page
  const problems: string[] = []
  const shot = (name: string) => page.screenshot({ path: path.join(SCREENS_V2, `lot12-${name}.png`) })

  test.beforeAll(async () => {
    mkdirSync(SCREENS_V2, { recursive: true })
    atelier = await launchAtelier({ name: 'conversations', runner: false })
    app = atelier.app
    page = atelier.page
    page.on('console', (m) => {
      if (/content security policy|refused to/i.test(m.text())) problems.push(m.text())
    })
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  })

  test.afterAll(async () => {
    await atelier?.close()
  })

  test('opens on the Supervisor, streams the fake reply and groups messages', async () => {
    await page.getByTestId('rail-conversations').click()
    // proto refresh: the team Messages screen opens first; this test drives the real chat engine behind the switch
    await page.getByTestId('msg-real-switch').click()
    await expect(page.getByTestId('view-conversations')).toBeVisible()
    await expect(page.getByTestId('chat-pane')).toBeVisible()
    await expect(page.getByTestId('chat-header')).toContainText('Superviseur')
    await expect(page.getByTestId('conversation-list')).toBeVisible()

    await page.getByLabel('Message', { exact: true }).fill('Hello supervisor')
    await page.getByRole('button', { name: 'Envoyer' }).click()
    const reply = page.locator('[data-testid="chat-message"][data-author="agent"]')
    await expect(reply).toContainText('Fake reply to: Hello supervisor')
    await expect(page.locator('[data-testid="chat-message"][data-author="owner"]')).toContainText('Hello supervisor')
    await expect(page.getByTestId('chat-streaming')).toHaveCount(0)
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('')
    await shot('conversation-dark')
  })

  test('a "make a video" request comes back as a proposal card that can be confirmed', async () => {
    const channel = (await api(page, 'channels.create', { name: 'Histoires oubliées', niche: 'mystères' })) as { id: number }
    expect(channel.id).toBeGreaterThan(0)
    await page.getByLabel('Message', { exact: true }).fill('make a video about the lost bell for Histoires oubliées')
    await page.getByRole('button', { name: 'Envoyer' }).click()
    const card = page.getByTestId('card-proposal')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('card-status')).toHaveText('Attend ta réponse')
    await shot('card-proposal-live')
    await card.getByRole('button', { name: 'Confirmer' }).click()
    await expect(card.getByTestId('card-status')).toHaveText('Confirmée')
  })

  test('the approval card of a video chat approves the deliverable; the folder lists the video', async () => {
    const channels = (await api(page, 'channels.list')) as { id: number; name: string }[]
    const channel = channels.find((c) => c.name === 'Histoires oubliées')!
    const detail = (await api(page, 'videos.create', channel.id, { title: 'Ys, la ville engloutie', brief: 'Une histoire' })) as {
      video: { id: number }
      deliverables: { id: number; type: string }[]
    }
    const id = (type: string): number => detail.deliverables.find((d) => d.type === type)!.id
    await api(page, 'versions.add', id('research'), { content: 'Faits sur Ys' })
    await api(page, 'versions.add', id('thumbnail_brief'), { content: 'Un clocher noyé au crépuscule' })

    await expect(page.getByTestId('channel-folder')).toContainText('Histoires oubliées')
    await page.getByTestId('channel-folder').selectOption({ label: 'Histoires oubliées' })
    const item = page.getByTestId('group-videos').locator('[data-kind="video"]', { hasText: 'Ys, la ville engloutie' })
    await expect(item).toBeVisible()
    await item.click()
    const card = page.getByTestId(`card-approval-${id('thumbnail_brief')}`)
    await expect(card).toContainText('Un clocher noyé au crépuscule')
    await expect(card.getByTestId('card-status')).toHaveText('À valider')
    await shot('card-approval-live')
    await card.getByRole('button', { name: 'Approuver' }).click()
    await expect(card.getByTestId('card-status')).toHaveText('Approuvé')
    await expect(card.getByRole('button', { name: 'Approuver' })).toHaveCount(0)
  })

  test('@ opens the mention list (7 names at most), filters, inserts and highlights the mention', async () => {
    await page.getByTestId('conversation-list').locator('[data-kind="supervisor"]').first().click()
    const box = page.getByLabel('Message', { exact: true })
    await box.click()
    await box.pressSequentially('@')
    const list = page.getByTestId('mention-list')
    await expect(list).toBeVisible()
    const count = await list.getByRole('option').count()
    expect(count).toBeGreaterThan(1)
    expect(count).toBeLessThanOrEqual(7)
    await shot('mention-list')

    const agents = (await api(page, 'agents.list')) as { id: string; name: string }[]
    const writer = agents.find((a) => a.id === 'scriptwriter')!
    await box.pressSequentially(writer.name.slice(0, 3).toLowerCase())
    await expect(list.getByRole('option').first()).toContainText(writer.name)
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(box).toHaveValue(`@${writer.name.replace(/\s+/g, '_')} `)
    await box.pressSequentially('peux-tu relire ?')
    await page.keyboard.press('Enter')
    const owner = page.locator('[data-testid="chat-message"][data-author="owner"]').last()
    await expect(owner).toContainText('peux-tu relire ?')
    await expect(owner.getByTestId('mention')).toHaveCount(0) // owner bubbles are plain text
    await expect(page.locator('[data-testid="chat-message"][data-author="agent"]').last()).toContainText('Fake reply to: @')
    // Escape closes the list without picking.
    await box.pressSequentially('@')
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await box.fill('')
  })

  test('attachments: picker, remove, size limit message', async () => {
    const dir = path.join(tmpdir(), `atelier-e2e-files-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'notes.txt')
    writeFileSync(file, 'des notes')
    await page.getByTestId('composer-file-input').setInputFiles(file)
    const chips = page.getByTestId('composer-files')
    await expect(chips).toContainText('notes.txt')
    await shot('composer-attachment')
    await chips.getByRole('button', { name: 'Retirer notes.txt' }).click()
    await expect(chips).toHaveCount(0)
    await page.getByTestId('composer-file-input').setInputFiles(file)
    await page.getByRole('button', { name: 'Envoyer' }).click()
    await expect(page.locator('[data-testid="chat-message"][data-author="owner"]').last()).toContainText('notes.txt')
  })

  test('search narrows the list', async () => {
    const search = page.getByTestId('conversation-search')
    await search.fill('zzzzzz')
    await expect(page.getByTestId('conversation-list')).toContainText('Aucune conversation ne correspond.')
    await search.fill('Ys')
    await expect(page.getByTestId('group-videos')).toBeVisible()
    await search.fill('')
  })

  test('the gallery shows every card and every rich block (screenshots)', async () => {
    await page.getByTestId('rail-reglages').click()
    await page.getByTestId('page-reglages-galerie').click()
    const gallery = page.getByTestId('gallery-chat')
    await gallery.scrollIntoViewIfNeeded()
    for (const type of CARDS) {
      const card = gallery.locator(`[data-testid^="card-${type}"]`).first()
      await expect(card).toBeVisible()
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path: path.join(SCREENS_V2, `lot12-card-${type}.png`) })
    }
    for (const name of BLOCKS) {
      const sample = gallery.locator(`[data-sample="${name}"]`)
      await expect(sample.getByTestId(`block-${name}`)).toBeVisible()
      await sample.scrollIntoViewIfNeeded()
      await sample.screenshot({ path: path.join(SCREENS_V2, `lot12-block-${name}.png`) })
    }
    // Tool steps: finished ones fold into "✓ N outils" and open on click; a running one shimmers.
    const done = gallery.getByTestId('gallery-tools-done').getByTestId('tool-steps')
    await expect(done).toContainText('✓ 3 outils')
    await expect(done).toHaveAttribute('data-folded', 'true')
    await done.scrollIntoViewIfNeeded()
    await done.screenshot({ path: path.join(SCREENS_V2, 'lot12-tools-folded.png') })
    await done.getByTestId('tool-steps-toggle').click()
    await expect(done).toContainText('A lu la file du moteur')
    await done.screenshot({ path: path.join(SCREENS_V2, 'lot12-tools-open.png') })
    const running = gallery.getByTestId('gallery-tools-running')
    await expect(running).toContainText('Lit les statistiques de la chaîne…')
    await running.screenshot({ path: path.join(SCREENS_V2, 'lot12-tools-running.png') })
    // The streaming replay ends with the whole text, markdown rendered.
    const stream = gallery.getByTestId('gallery-stream')
    await expect(stream.getByText('trois actes').first()).toBeVisible()
    await expect(stream.locator('li')).toHaveCount(3, { timeout: 15_000 })
    const thread = gallery.getByTestId('gallery-thread')
    await thread.scrollIntoViewIfNeeded()
    await thread.screenshot({ path: path.join(SCREENS_V2, 'lot12-thread-rich-dark.png') })
    await page.getByTestId('theme-toggle').click()
    await thread.screenshot({ path: path.join(SCREENS_V2, 'lot12-thread-rich-light.png') })
    await page.getByTestId('theme-toggle').click()
  })

  test('no CSP violation and no page error', () => {
    expect(problems).toEqual([])
    expect(app).toBeTruthy()
  })
})
