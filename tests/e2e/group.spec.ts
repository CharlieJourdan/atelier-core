// Lot 13 proof on the built app with the deterministic fake team (ATELIER_FAKE_LLM=1, no model call): in a department
// room, "@Scénariste puis @Voix_off" gets two answers in that order and none from the lead; the Supervisor hands a
// question to the Scénariste (handoff card, answer, conclusion); the rooms and the Manager are in the list.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS_V2, type Atelier } from './launch'

const skipReason = noDesktopReason()
if (skipReason) console.log(`[e2e] group SKIPPED: ${skipReason}`)

test.describe('Group conversations (lot 13)', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)

  let atelier: Atelier
  let page: Page
  const problems: string[] = []
  const shot = (name: string) => page.screenshot({ path: path.join(SCREENS_V2, `lot13-${name}.png`) })

  test.beforeAll(async () => {
    mkdirSync(SCREENS_V2, { recursive: true })
    atelier = await launchAtelier({ name: 'group', runner: false })
    page = atelier.page
    page.on('console', (m) => {
      if (/content security policy|refused to/i.test(m.text())) problems.push(m.text())
    })
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  })

  test.afterAll(async () => {
    await atelier?.close()
  })

  test('@Scénariste then @Voix off in a room: both answer, in that order, and the lead stays silent', async () => {
    const channel = (await api(page, 'channels.create', { name: 'Histoires oubliées', niche: 'mystères' })) as { id: number }
    await page.getByTestId('rail-conversations').click()
    // proto refresh: the team Messages screen opens first; this test drives the real chat engine behind the switch
    await page.getByTestId('msg-real-switch').click()
    await expect(page.getByTestId('conversation-list')).toBeVisible()
    await expect(page.getByTestId(`conversation-manager:${channel.id}`)).toBeVisible()
    const roomEntry = page.getByTestId(`conversation-room:${channel.id}:production`)
    await expect(roomEntry).toBeVisible()
    await roomEntry.click()
    await expect(page.getByTestId('chat-header')).toContainText('Salon Production · Histoires oubliées')
    await expect(page.getByTestId('chat-header')).toContainText('Chef d’équipe')

    const box = page.getByLabel('Message', { exact: true })
    await box.pressSequentially('@Scé')
    await expect(page.getByTestId('mention-list')).toBeVisible()
    await page.keyboard.press('Enter')
    await box.pressSequentially('puis @Voix')
    await page.keyboard.press('Enter')
    await box.pressSequentially(': où en est la vidéo sur Ys ?')
    await expect(box).toHaveValue('@Scénariste puis @Voix_off : où en est la vidéo sur Ys ?')
    await page.keyboard.press('Enter')

    const replies = page.locator('[data-testid="chat-message"][data-author="agent"]')
    await expect(replies).toHaveCount(2)
    await expect(page.getByTestId('chat-streaming')).toHaveCount(0)
    const authors = await page.getByTestId('chat-author').allTextContents()
    expect(authors).toEqual(['Scénariste', 'Voix off'])
    await expect(replies.nth(0)).toContainText('Fake reply to: @Scénariste puis @Voix_off')
    // The lead (Chef d'équipe) did not answer as well.
    await expect(page.getByTestId('chat-author').filter({ hasText: 'Chef d’équipe' })).toHaveCount(0)
    // The header shows the faces of the agents who spoke.
    await expect(page.getByTestId('chat-faces').locator('li')).toHaveCount(2)
    await shot('room-mentions')

    // Without a mention, the team lead answers.
    await box.fill('Et le planning ?')
    await page.keyboard.press('Enter')
    await expect(replies).toHaveCount(3)
    await expect(page.getByTestId('chat-author').last()).toHaveText('Chef d’équipe')
  })

  test('the Supervisor hands a question to the Scénariste: handoff card, answer, conclusion', async () => {
    await page.getByTestId('rail-conversations').click()
    // proto refresh: the team Messages screen opens first; this test drives the real chat engine behind the switch
    await page.getByTestId('msg-real-switch').click()
    // The Supervisor's row key is its conversation id.
    const sup = ((await api(page, 'chat.conversations')) as { id: number; kind: string }[]).find((c) => c.kind === 'supervisor')!
    await page.getByTestId(`conversation-c${sup.id}`).click()
    await expect(page.getByTestId('chat-header')).toContainText('Superviseur')
    await page.getByLabel('Message', { exact: true }).fill('demande au Scénariste : le script de Ys est-il prêt ?')
    await page.keyboard.press('Enter')
    const card = page.getByTestId('card-handoff')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Superviseur passe la main à Scénariste')
    await expect(card.getByTestId('card-status')).toHaveText('Réponse reçue')
    await expect(page.locator('[data-testid="chat-message"][data-author="agent"]').last()).toContainText('J’ai demandé à Scénariste')
    // The specialist's answer is its own message, and its excerpt is on the card.
    const answer = 'Scénariste : réponse à « le script de Ys est-il prêt ? ».'
    await expect(page.locator('[data-testid="chat-message"][data-author="agent"]').filter({ hasText: answer }).first()).toBeVisible()
    await expect(card).toContainText(answer)
    await expect(page.getByTestId('tool-steps').last()).toContainText('✓ 1 outil')
    await shot('handoff')
    expect(problems).toEqual([])
  })
})
