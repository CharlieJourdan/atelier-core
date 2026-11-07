// Real mode of the new screens, end to end in the built app (example workspace, the deterministic fake team: never a
// real model): real mode from the start (the beta; the demo is the « Mode présentation »), the runtime is seeded and its agents fill Équipe; a message to the main agent
// from the dashboard reaches the runtime and its answer comes back; a production gate waiting in the database shows in
// « À valider » and approving it really approves the run; Messages shows the real conversations. Screenshots of the
// three screens in real mode go to docs/screens/proto/*-live-*.png.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, SCREENS, setPresentation, type Atelier } from './launch'

const OUT = path.join(SCREENS, 'proto')
const skipReason = noDesktopReason()

test.describe('real mode: the new screens on the agent runtime', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(4 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'live', runner: false, example: true })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('switch to real, talk to the main agent, approve a real gate, see the real team and chats', async () => {
    const { page } = atelier
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}-live-dark.png`) })

    // 1. Démo → Réel: the runtime is seeded from the database's channels and its agents replace the demo team.
    // the beta: real mode is the default (no switch)
    await expect(page.getByTestId('data-mode')).toHaveAttribute('data-mode', 'live')
    await page.getByTestId('rail-agents').click()
    // the runtime's main agent takes the name chosen in the app (Atlas by default)
    await expect(page.getByTestId('org-chart')).toContainText('Atlas', { timeout: 15_000 })
    await expect(page.getByTestId('org-chart')).toContainText('Responsable de chaîne')
    await expect(page.getByTestId('org-chart')).not.toContainText('Hugo') // a demo lead
    const agents = (await api(page, 'orchestra.agents')) as { id: number; role: string }[]
    expect(agents.length).toBeGreaterThan(5)
    await page.waitForTimeout(400)
    await shot('agents')

    // 2. Accueil: write to the main agent; the message lands in the Supervisor chat with an @mention and wakes it.
    await page.getByTestId('rail-accueil').click()
    const composer = page.getByTestId('view-accueil').getByTestId('agent-composer')
    await composer.fill('Fais le point sur la semaine')
    await page.getByTestId('view-accueil').getByTestId('agent-send').click()
    await expect(page.getByTestId('view-accueil').getByTestId('agent-chat')).toContainText('Fais le point sur la semaine')
    const principal = agents.find((a) => a.role === 'principal')!
    await expect
      .poll(async () => ((await api(page, 'orchestra.tasks', { assigneeId: principal.id })) as { kind: string }[]).some((t) => t.kind === 'mention'), { timeout: 10_000 })
      .toBe(true)
    // one supervisor pass runs the turn (the fake team answers); the answer shows in the chat
    await api(page, 'orchestra.tick', { wait: true })
    const conversations = (await api(page, 'chat.conversations')) as { id: number; kind: string }[]
    const supervisor = conversations.find((c) => c.kind === 'supervisor')!
    await expect
      .poll(async () => ((await api(page, 'chat.messages', supervisor.id)) as { authorType: string; authorId: string | null }[]).some((m) => m.authorType === 'agent' && m.authorId?.startsWith('orch:')), {
        timeout: 20_000
      })
      .toBe(true)
    await expect
      .poll(async () => (await page.getByTestId('view-accueil').getByTestId('agent-chat').locator('p').count()) > 2, { timeout: 20_000 })
      .toBe(true)

    // 3. « À valider »: the example's production gate is a real item; approving it approves the run.
    const inbox = page.getByTestId('home-inbox')
    const gates = ((await api(page, 'home.inbox')) as { gates: { runId: number; nodeId: string }[] }).gates
    if (gates.length > 0) {
      const g = gates[0]!
      const row = page.getByTestId(`inbox-action-gate-${g.runId}-${g.nodeId}`)
      await expect(row).toBeVisible({ timeout: 15_000 })
      await shot('accueil')
      await row.click()
      await expect(page.getByTestId('live-inbox-dialog')).toBeVisible()
      await page.getByTestId('live-inbox-approve').click()
      await expect
        .poll(async () => ((await api(page, 'home.inbox')) as { gates: { runId: number; nodeId: string }[] }).gates.some((x) => x.runId === g.runId && x.nodeId === g.nodeId), { timeout: 15_000 })
        .toBe(false)
    } else {
      await expect(inbox).toBeVisible()
      await shot('accueil')
    }

    // 4. Messages: the real Supervisor conversation, with Charlie's message (without the « @Name » prefix).
    await page.getByTestId('rail-conversations').click()
    await expect(page.getByTestId('msg-pane')).toContainText('Fais le point sur la semaine', { timeout: 15_000 })
    await expect(page.getByTestId('msg-pane')).not.toContainText('@Atlas')
    await page.waitForTimeout(300)
    await shot('conversations')

    // 5. The « Mode présentation » (Réglages › Avancé): the invented workspace returns, under its banner; then off again.
    await setPresentation(page, true)
    await page.getByTestId('rail-agents').click()
    await expect(page.getByTestId('org-chart')).toContainText('Hugo')
    await setPresentation(page, false)
    await expect(page.getByTestId('org-chart')).not.toContainText('Hugo', { timeout: 15_000 })
  })
})
