// Réglages › Discord in the built app (Atlas on the phone): the page opens in its « not set » state, the token field is
// masked and never echoes back (not in the page, not in any IPC result), and the walk token → server → channels works
// against the in-memory Discord of the e2e build (ATELIER_FAKE_LLM=1: no network, ever).
import { expect, test } from '@playwright/test'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, type Atelier } from './launch'

const skipReason = noDesktopReason()
const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ' + '.GabcDE.abcdefghijklmnopqrstuvwxyz0123456789'

test.describe('Réglages › Discord', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(2 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    atelier = await launchAtelier({ name: 'live-discord', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('starts not set, never echoes the token, then creates the channels', async () => {
    const { page } = atelier
    await page.getByTestId('rail-reglages').click()
    await page.getByTestId('page-reglages-discord').click()
    await expect(page.getByTestId('prefs-discord')).toBeVisible()

    // Not set, off.
    await expect(page.getByTestId('discord-token-state')).toHaveAttribute('data-set', 'false')
    const input = page.getByTestId('discord-token-input')
    await expect(input).toHaveAttribute('type', 'password')
    await expect(input).toHaveValue('')
    await expect(page.getByTestId('discord-bridge-switch')).toBeDisabled()
    expect(await api(atelier.page, 'discord.status')).toMatchObject({ tokenSet: false, enabled: false, running: false })

    // Typed: masked, and nothing in the page text shows it.
    await input.fill(TOKEN)
    await expect(input).toHaveAttribute('type', 'password')
    expect(await page.getByTestId('prefs-discord').innerText()).not.toContain(TOKEN)

    // Saved: the field empties, the badge says « set », and no IPC result carries the token.
    await page.getByTestId('discord-token-save').click()
    await expect(page.getByTestId('discord-token-state')).toHaveAttribute('data-set', 'true', { timeout: 10_000 })
    await expect(input).toHaveValue('')
    expect(await page.content()).not.toContain(TOKEN)
    const results = JSON.stringify([await api(page, 'discord.status'), await api(page, 'discord.inviteUrl'), await api(page, 'discord.guilds'), await api(page, 'settings.list')])
    expect(results).not.toContain(TOKEN)

    // Invitation, server, « Tout créer ».
    await expect(page.getByTestId('discord-invite')).toHaveAttribute('href', /client_id=\d+&scope=bot&permissions=\d+/)
    await expect(page.getByTestId('discord-guild-select')).toContainText('Serveur de test')
    await page.getByTestId('discord-create').click()
    await expect(page.getByTestId('discord-channels')).toContainText('#atlas', { timeout: 15_000 })
    await expect(page.getByTestId('discord-channels')).toContainText('#à-valider')
    await expect(page.getByTestId('discord-channels')).toContainText('#production')

    // Still off until the explicit switch.
    expect(await api(page, 'discord.status')).toMatchObject({ tokenSet: true, enabled: false, running: false })
    await page.getByTestId('discord-bridge-switch').click()
    await expect(page.getByTestId('discord-bridge-state')).not.toHaveText(/éteint/, { timeout: 10_000 })
    await page.getByTestId('discord-bridge-switch').click()
    await expect(page.getByTestId('discord-bridge-switch')).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 })
  })
})
