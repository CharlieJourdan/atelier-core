// Smoke test of the INSTALLED app. Windows: `npm run dist`, install with `/S` (archived doc INSTALL (old repository)), then
// `npm run test:packaged`. macOS: `npm run dist:mac`, copy Atelier.app to ~/Applications (archived doc INSTALL-MAC (old repository),
// scripts/mac-verify.sh does both), then `npm run test:packaged`. The installed app is launched with Playwright
// `_electron` in a throwaway userData folder with the deterministic fake team (never a real model, never the real
// engine: its folder is a stub without Python).
// Where the app is: %LOCALAPPDATA%\Programs\atelier\Atelier.exe, ~/Applications/Atelier.app, or ATELIER_PACKAGED_EXE
// (the executable itself; on macOS the binary inside the bundle).
// Skip-or-fail rules are the e2e suite's (tests/e2e/desktop.ts): no desktop → fail, unless ATELIER_E2E_ALLOW_SKIP=1 /
// ATELIER_E2E_SKIP=1; ATELIER_E2E_FORCE=1 runs anyway. A missing installed app is a failure, not a skip.
import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { noDesktopReason } from '../e2e/desktop'
import { api, launchAtelier } from '../e2e/launch'

// The sidebar entries since 774641e (the same list as tests/e2e/shell.spec.ts; Validations and Mes outils are routes only)
const SECTIONS = ['accueil', 'planning', 'production', 'agents', 'conversations', 'cerveau', 'chaines', 'monetisation', 'ordinateurs', 'reglages'] as const
// The v1 screens, under Réglages › Écrans v1 (ancien).

/** The installed executable for this OS. */
function installedExe(): string {
  if (process.env.ATELIER_PACKAGED_EXE) return process.env.ATELIER_PACKAGED_EXE
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Applications', 'Atelier.app', 'Contents', 'MacOS', 'Atelier')
  return path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'atelier', 'Atelier.exe')
}

/** app.asar.unpacked next to the executable: resources\ on Windows, Contents/Resources/ in a macOS bundle. */
function unpackedMcp(exe: string): string {
  const resources = process.platform === 'darwin' ? path.join(path.dirname(exe), '..', 'Resources') : path.join(path.dirname(exe), 'resources')
  return path.join(resources, 'app.asar.unpacked', 'out', 'main', 'mcp.js')
}

const skipReason = noDesktopReason()
if (skipReason) console.log(`[packaged] SKIPPED: ${skipReason}`)

test.describe('packaged Atelier', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)

  test('opens, switches the views, opens Settings, has no Studio, and its MCP entry runs', async () => {
    const exe = installedExe()
    expect(existsSync(exe), `${exe} is not installed`).toBe(true)
    const atelier = await launchAtelier({ name: 'packaged', runner: false, executablePath: exe })
    try {
      const { page } = atelier
      await expect(page).toHaveTitle('Atelier')
      expect(await atelier.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe('Atelier')
      const info = (await api(page, 'app.info')) as { platform: string }
      expect(info.platform).toBe(process.platform)
      // node:sqlite works in the packaged Electron: the database answers (seeded settings and prices).
      const prices = (await api(page, 'prices.list')) as unknown[]
      expect(prices.length).toBeGreaterThan(0)

      // since 774641e the proto screens carry `view-<section>-<page>` (Production's Vue d'ensemble…), the others `view-<section>`
      for (const id of SECTIONS) {
        await page.getByTestId(`rail-${id}`).click()
        await expect(page.locator(`[data-testid="view-${id}"], [data-testid^="view-${id}-"]`)).toHaveCount(1)
        await expect(page.getByTestId(`rail-${id}`)).toHaveAttribute('aria-current', 'page')
      }

      // No Studio screen any more (lot P1).
      await expect(page.getByTestId('rail-studio')).toHaveCount(0)

      // The MCP server entry is a real file next to app.asar, and Electron's binary runs it as Node (what Claude
      // Code does for agent runs). No bridge is configured here, so it must say so and exit: proof that the file
      // and the chunk it requires load.
      const mcp = unpackedMcp(exe)
      expect(existsSync(mcp), `${mcp} missing`).toBe(true)
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string>
      delete env.ATELIER_BRIDGE
      const run = spawnSync(exe, [mcp], { env, input: '', encoding: 'utf8', timeout: 30_000 })
      expect(run.stderr).toContain('atelier mcp: No Atelier bridge configured')
    } finally {
      await atelier.close()
    }
  })
})
