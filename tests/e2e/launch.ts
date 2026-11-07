// Launches the built app (out/) for one e2e spec, in a throwaway userData directory, with the deterministic fake
// team (ATELIER_FAKE_LLM=1, never a real model). Every spec goes through here. Since lot P1 the app starts no
// external engine at all, so there is nothing to keep a spec away from.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const ROOT = path.resolve(__dirname, '../..')
export const MAIN = path.join(ROOT, 'out', 'main', 'index.js')
// Screenshots: docs/screens, or ATELIER_E2E_SCREENS (mac-verify.sh keeps them out of the read-only clone).
export const SCREENS = process.env.ATELIER_E2E_SCREENS || path.join(ROOT, 'docs', 'screens')
export const SCREENS_V2 = path.join(SCREENS, 'v2')

type Bridge = { call: (method: string, ...args: unknown[]) => Promise<unknown> }

/** `window.atelier.call(method, ...args)` in the page. */
export const api = (page: Page, method: string, ...args: unknown[]): Promise<unknown> =>
  page.evaluate(([m, a]) => (window as unknown as { atelier: Bridge }).atelier.call(m as string, ...(a as unknown[])), [method, args] as const)

export interface LaunchOptions {
  /** Prefix of the temp directory (atelier-e2e-<name>-…). */
  name: string
  /** False: ATELIER_RUNNER=off (specs that submit versions by hand keep the agents idle). Default true. */
  runner?: boolean
  /** A packaged app's exe (tests/packaged): launched as is, instead of out/main/index.js through Electron. */
  executablePath?: string
  /** Load the example workspace on first launch (lot Z1). Default false: the older specs expect an empty database. */
  example?: boolean
  /**
   * The beta's first screen: 'offline' (default) chooses « Continuer sans compte » through the API, so the spec starts in
   * the app; 'welcome' leaves the welcome screen up (the sign-in specs).
   */
  account?: 'offline' | 'welcome'
  /** « Mode présentation » on (the demo workspace) for the specs that show the invented data. Default off: real mode. */
  presentation?: boolean
  /** Hand editing of pipelines on (`ATELIER_PIPELINE_DEV=1`, decision 0051). */
  pipelineDev?: boolean
  /** Pipeline codes on (`ATELIER_PIPELINE_CODES=1`, production-lab): sharing, importing, the file export. */
  pipelineCodes?: boolean
  /** ATELIER_CLOUD_URL for the app (a test Cloud on a loopback port). */
  cloudUrl?: string
  /**
   * Leave the first-run onboarding to open (a fresh workspace opens it once the welcome is passed). Default false: the
   * spec's workspace is marked onboarded through `app.finishOnboarding`, so it starts in the shell as the older specs expect.
   */
  firstRun?: boolean
}

export interface Atelier {
  app: ElectronApplication
  page: Page
  userData: string
  close(): Promise<void>
}

export async function launchAtelier(opts: LaunchOptions): Promise<Atelier> {
  if (opts.executablePath ? !existsSync(opts.executablePath) : !existsSync(MAIN)) {
    throw new Error(opts.executablePath ? `Install the app first (npm run dist): ${opts.executablePath} is missing` : `Build first (npm run build): ${MAIN} is missing`)
  }
  const userData = mkdtempSync(path.join(tmpdir(), `atelier-e2e-${opts.name}-`))
  let app: ElectronApplication | null = null
  try {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') env[k] = v
    }
    env.ATELIER_USER_DATA = userData
    // Never a real model: chat and agents answer with the deterministic fake.
    env.ATELIER_FAKE_LLM = '1'
    if (opts.runner === false) env.ATELIER_RUNNER = 'off'
    env.ATELIER_EXAMPLE = opts.example ? '1' : '0'
    // hand editing of pipelines (bricks, engines): the founder's dev flag (decision 0051)
    if (opts.pipelineDev) env.ATELIER_PIPELINE_DEV = '1'
    else delete env.ATELIER_PIPELINE_DEV
    if (opts.pipelineCodes) env.ATELIER_PIPELINE_CODES = '1'
    else delete env.ATELIER_PIPELINE_CODES

    if (opts.cloudUrl) env.ATELIER_CLOUD_URL = opts.cloudUrl
    else delete env.ATELIER_CLOUD_URL
    app = await electron.launch(opts.executablePath ? { executablePath: opts.executablePath, env } : { args: [MAIN], cwd: ROOT, env })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    if (opts.presentation) await setPresentation(page, true)
    if (!opts.firstRun) await api(page, 'app.finishOnboarding')
    if ((opts.account ?? 'offline') === 'offline') {
      await api(page, 'settings.set', 'app.offline', true)
      await page.getByTestId('shell').waitFor({ timeout: 30_000 })
      if (opts.presentation) await page.getByTestId('presentation-banner').waitFor({ timeout: 15_000 })
    }
    const launched = app
    return {
      app: launched,
      page,
      userData,
      close: async () => {
        await launched.evaluate(({ app: a }) => a.quit()).catch(() => undefined)
        await launched.close().catch(() => undefined)
        removeDir(userData)
      }
    }
  } catch (err) {
    await app?.close().catch(() => undefined)
    removeDir(userData)
    throw err
  }
}

/**
 * Deletes a throwaway directory. On a busy Windows machine Electron's helper processes can hold files in it for a few
 * seconds after the app closed (EPERM/EBUSY): retried for ~15 s, then reported, not failed (the spec itself passed).
 */
function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  } catch (err) {
    console.warn(`[e2e] could not delete ${dir}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** A local port that was free a moment ago (nothing of ours listens on it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port >= 1024 ? resolve(port) : reject(new Error(`unexpected free port ${port}`))))
    })
  })
}

/** Turns the « Mode présentation » (Réglages › Avancé) on or off through its setting; with the shell up, waits for its banner. */
export async function setPresentation(page: Page, on: boolean): Promise<void> {
  await api(page, 'settings.set', 'app.presentation', on)
  if ((await page.getByTestId('shell').count()) === 0) return
  if (on) await page.getByTestId('presentation-banner').waitFor({ timeout: 15_000 })
  else await page.getByTestId('presentation-banner').waitFor({ state: 'detached', timeout: 15_000 })
}
