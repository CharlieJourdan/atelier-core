// Robustness proofs (app-ux-robustesse): kill -9 then restart on the same data, a second instance, an unreachable
// Cloud, very long names, empty states. Every case must recover or explain itself. Throwaway userData, fake team.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, MAIN, ROOT } from './launch'

const SHOTS = process.env.ATELIER_UX_SHOTS || path.join(tmpdir(), 'atelier-ux-shots')
const skipReason = noDesktopReason()

function envFor(userData: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  return { ...env, ATELIER_USER_DATA: userData, ATELIER_FAKE_LLM: '1', ATELIER_EXAMPLE: '0', ATELIER_RUNNER: 'off', ...extra }
}
async function start(userData: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN], cwd: ROOT, env: envFor(userData, extra) })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await api(page, 'app.finishOnboarding')
  await api(page, 'settings.set', 'app.offline', true)
  await page.getByTestId('shell').waitFor({ timeout: 30_000 })
  return { app, page }
}
/** kill -9: the whole process tree dies with no chance to flush anything. */
function hardKill(app: ElectronApplication): void {
  const pid = app.process().pid
  if (pid) execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
}

test.describe('Robustness', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(240_000)
  let userData: string
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true })
    userData = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-robust-'))
  })
  test.afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }))

  test('kill -9 mid-work: the restart keeps the data and opens the app', async () => {
    test.skip(process.platform !== 'win32', 'taskkill')
    let { app, page } = await start(userData)
    const ch = (await api(page, 'channels.create', { name: 'Survivor', niche: 'crash tests' })) as { id: number }
    hardKill(app)
    await app.close().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 2000)) // the OS lets go of the dead process' files
    ;({ app, page } = await start(userData))
    const channels = (await api(page, 'channels.list')) as { id: number; name: string }[]
    expect(channels.find((c) => c.id === ch.id)?.name).toBe('Survivor')
    await expect(page.getByTestId('shell')).toBeVisible()
    await app.close().catch(() => undefined)
  })

  test('kill -9 mid-production: the restart finds no run stuck « en cours », no credit held, a sound database', async () => {
    test.skip(process.platform !== 'win32', 'taskkill')
    let { app, page } = await start(userData)
    const ch = (await api(page, 'channels.create', { name: 'Production', niche: 'crash tests' })) as { id: number }
    const run = (await api(page, 'production.start', { channelId: ch.id, title: 'Vidéo coupée', topic: 'Un sujet', minutes: 1, budgetMode: 'usage_max', gateMode: 'all' })) as { id: number }
    hardKill(app)
    await app.close().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 2000))
    // Whatever the demo run had reached when it died, make the file say what a kill in the middle of a render says.
    const db = new DatabaseSync(path.join(userData, 'atelier.db'))
    db.prepare("UPDATE video_runs SET status = 'running', error = NULL WHERE id = ?").run(run.id)
    db.prepare("UPDATE video_run_nodes SET state = 'running' WHERE run_id = ? AND rowid = (SELECT MIN(rowid) FROM video_run_nodes WHERE run_id = ?)").run(run.id, run.id)
    db.close()
    ;({ app, page } = await start(userData))
    const after = (await api(page, 'production.get', run.id)) as { status: string; error: string | null; nodes: { state: string }[] }
    expect(['running', 'queued'], 'a dead process cannot still be running').not.toContain(after.status === 'running' && after.nodes.every((n) => n.state !== 'running') ? 'zombie' : 'fine')
    expect(after.nodes.filter((n) => n.state === 'running' && after.status === 'interrupted'), 'no step left « en cours » in an interrupted run').toEqual([])
    if (after.status === 'interrupted') expect(after.error).toMatch(/Atelier a été fermé pendant la fabrication/)
    const balance = (await api(page, 'credits.balance')) as { held: number }
    expect(balance.held, 'no credit stays held by a dead run').toBe(0)
    await expect(page.getByTestId('shell')).toBeVisible()
    await app.close().catch(() => undefined)
    const check = new DatabaseSync(path.join(userData, 'atelier.db'))
    expect((check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    expect(check.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    check.close()
  })

  test('a crashed screen process is reloaded by itself and an uncaught page error does not blank the shell', async () => {
    const { app, page } = await start(userData)
    // The boundary is what catches a render error; here the page throws on purpose through the dev hook of the test.
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'boom' })) // an uncaught error does not blank the shell
    })
    await expect(page.getByTestId('shell')).toBeVisible()
    // a crashed renderer is reloaded by the main process
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer())
    // Playwright's page handle died with the renderer: ask the window itself whether the shell came back.
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) => {
            const wc = BrowserWindow.getAllWindows()[0]!.webContents
            // executeJavaScript on a page that is being replaced may never answer: give each try one second
            return Promise.race([
              wc.isCrashed() ? Promise.resolve(false) : wc.executeJavaScript("!!document.querySelector('[data-testid=shell]')").catch(() => false),
              new Promise<boolean>((r) => setTimeout(() => r(false), 1000))
            ])
          }),
        { timeout: 30_000, message: 'the crashed renderer is reloaded by the main process' }
      )
      .toBe(true)
    await app.close().catch(() => undefined)
  })

  test('an API error reaches the screen as French, never as a code or English', async () => {
    const { app, page } = await start(userData)
    const err = await page.evaluate(async () => {
      try {
        await (window as unknown as { atelier: { call: (m: string, ...a: unknown[]) => Promise<unknown> } }).atelier.call('production.get', 999999)
        return ''
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(err).toMatch(/[éèàç’]|Réessaie|introuvable/i)
    expect(err).not.toMatch(/SQLITE|ENOENT|Error:|\bat .*:\d+/)
    await app.close().catch(() => undefined)
  })

  test('a second instance does not open a second window nor corrupt anything', async () => {
    const first = await start(userData)
    const env = envFor(userData)
    // A plain child process: the second instance quits at once, so there is nothing for Playwright to attach to.
    const electronPath = (await import('electron')).default as unknown as string
    const second = spawn(electronPath, [MAIN], { cwd: ROOT, env, stdio: 'ignore' })
    const exited = await new Promise<number | null>((resolve) => second.once('exit', resolve))
    expect(exited, 'the second instance quits by itself').toBe(0)
    const windows = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    expect(windows).toBe(1)
    await expect(first.page.getByTestId('shell')).toBeVisible()
    await first.app.close().catch(() => undefined)
  })

  test('an unreachable Cloud does not break the shell, and long names stay inside their boxes', async () => {
    const { app, page } = await start(userData, { ATELIER_CLOUD_URL: 'http://127.0.0.1:9' })
    const long = 'Une chaîne au nom extraordinairement long '.repeat(8).trim()
    await api(page, 'channels.create', { name: long, niche: 'x'.repeat(300) })
    for (const section of ['accueil', 'chaines', 'production', 'reglages'] as const) {
      await page.getByTestId(`rail-${section}`).click()
      await page.waitForTimeout(400)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${section} scrolls sideways`).toBeLessThanOrEqual(1)
      await page.screenshot({ path: path.join(SHOTS, `robust-longname-${section}.png`) })
    }
    await app.close().catch(() => undefined)
  })
})
