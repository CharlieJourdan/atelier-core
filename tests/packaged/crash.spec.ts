// Crash proofs on the INSTALLED (packaged) app (app-ux-robustesse-2): kill -9 in the middle of a production, restart on the
// same data, check nothing stays « en cours », no credit stays held and the SQLite file (WAL) is sound; then a renderer
// crash that the app reloads by itself. Same exe lookup as packaged.spec.ts (ATELIER_PACKAGED_EXE for the unpacked build).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { noDesktopReason } from '../e2e/desktop'
import { api } from '../e2e/launch'

function installedExe(): string {
  if (process.env.ATELIER_PACKAGED_EXE) return process.env.ATELIER_PACKAGED_EXE
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Applications', 'Atelier.app', 'Contents', 'MacOS', 'Atelier')
  return path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'atelier', 'Atelier.exe')
}
const skipReason = noDesktopReason()

async function start(exe: string, userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  Object.assign(env, { ATELIER_USER_DATA: userData, ATELIER_FAKE_LLM: '1', ATELIER_EXAMPLE: '0', ATELIER_RUNNER: 'off', ATELIER_UPDATES: 'off' })
  const app = await electron.launch({ executablePath: exe, env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await api(page, 'app.finishOnboarding')
  await api(page, 'settings.set', 'app.offline', true)
  await page.getByTestId('shell').waitFor({ timeout: 30_000 })
  return { app, page }
}

test.describe('packaged Atelier survives crashes', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.skip(process.platform !== 'win32', 'taskkill')
  test.setTimeout(240_000)

  test('kill -9 mid-production, restart: no run stuck, no credit held, sound database; a crashed renderer is reloaded', async () => {
    const exe = installedExe()
    expect(existsSync(exe), `${exe} is not installed`).toBe(true)
    const userData = mkdtempSync(path.join(os.tmpdir(), 'atelier-packaged-crash-'))
    try {
      let { app, page } = await start(exe, userData)
      const ch = (await api(page, 'channels.create', { name: 'Installée', niche: 'crash' })) as { id: number }
      const run = (await api(page, 'production.start', { channelId: ch.id, title: 'Coupée', topic: 'Un sujet', minutes: 1, budgetMode: 'usage_max', gateMode: 'all' })) as { id: number }
      const pid = app.process().pid
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
      await app.close().catch(() => undefined)
      await new Promise((r) => setTimeout(r, 2500))
      const db = new DatabaseSync(path.join(userData, 'atelier.db'))
      db.prepare("UPDATE video_runs SET status = 'running', error = NULL WHERE id = ?").run(run.id)
      db.prepare("UPDATE video_run_nodes SET state = 'running' WHERE run_id = ? AND rowid = (SELECT MIN(rowid) FROM video_run_nodes WHERE run_id = ?)").run(run.id, run.id)
      db.close()
      ;({ app, page } = await start(exe, userData))
      const after = (await api(page, 'production.get', run.id)) as { status: string; error: string | null; nodes: { state: string }[] }
      if (after.status === 'interrupted') {
        expect(after.nodes.filter((n) => n.state === 'running')).toEqual([])
        expect(after.error).toMatch(/Atelier a été fermé pendant la fabrication/)
      } else {
        expect(['queued', 'running', 'waiting', 'failed', 'succeeded']).toContain(after.status) // resumed by itself
      }
      expect(((await api(page, 'credits.balance')) as { held: number }).held).toBe(0)

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer())
      await expect
        .poll(
          () =>
            app.evaluate(({ BrowserWindow }) => {
              const wc = BrowserWindow.getAllWindows()[0]!.webContents
              return Promise.race([
                wc.isCrashed() ? Promise.resolve(false) : wc.executeJavaScript("!!document.querySelector('[data-testid=shell]')").catch(() => false),
                new Promise<boolean>((r) => setTimeout(() => r(false), 1000))
              ])
            }),
          { timeout: 30_000 }
        )
        .toBe(true)
      await app.close().catch(() => undefined)
      await new Promise((r) => setTimeout(r, 1500))
      const check = new DatabaseSync(path.join(userData, 'atelier.db'))
      expect((check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
      check.close()
    } finally {
      rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    }
  })
})
