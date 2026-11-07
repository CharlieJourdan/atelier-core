// Electron entry: single instance, window, tray, the `atelier:call` bus and events.
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, shell, type Tray } from 'electron'
import { CALL_CHANNEL, type EventContract, type EventName } from '../shared/api'
import { createCore, type Core } from './core'
import { exampleAtStart } from './example'
import { appWorkerCommand, resourcesDirFor } from './production/local-worker'
import { safeStorageCipher } from './electron/cipher'
import { notifyApprovalRequest } from './electron/notifications'
import { createTray } from './electron/tray'
import { denyDefaultSessionPermissions, refuseWebviews } from './electron/permissions'
import { isTrustedSender } from './electron/ipc-guard'
import { applyWindowTheme, createMainWindow } from './electron/window'
import { guardWindow, installProcessGuards, onWake } from './electron/resilience'
import { routeCall } from './brain/route'
import { watchVideoReady } from './electron/video-ready'
import type { OrderView } from '../shared/api/orders'
import { fakeTeamReply } from './agents/fake-team'
import { FakeProvider } from './llm/fake'
import { e2eDiscord } from './discord'
import { applyLoginPath } from './platform/shell-path'
import { loadElectronUpdater } from './updater/electron-driver'

/** Set by electron.vite.config.ts at build time from ATELIER_CLOUD_URL or ATELIER_BETA_CLOUD ('' when neither was set). */
declare const __ATELIER_CLOUD_URL__: string

// Data: <appData>/Atelier (%APPDATA%Atelier on Windows, ~/Library/Application Support/Atelier on macOS).
// Tests and side-by-side runs can point Atelier at another data directory.
if (process.env.ATELIER_USER_DATA) app.setPath('userData', process.env.ATELIER_USER_DATA)
// Windows: notifications and the taskbar group under the app's id (macOS takes it from the bundle).
if (process.platform === 'win32') app.setAppUserModelId('fr.charlie.atelier')

installProcessGuards()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let core: Core | null = null
let quitting = false

function send<E extends EventName>(event: E, payload: EventContract[E]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload)
}

/** e2e only: one deterministic fake for the whole team (chat turns and task runs). */
const fakeTeam = new FakeProvider(fakeTeamReply)

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    openWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openWindow(): void {
  mainWindow = createMainWindow()
  refuseWebviews(mainWindow)
  guardWindow(mainWindow)
  // Closing the window hides it to the tray; "Quit" in the tray (or app.quit()) really quits.
  mainWindow.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  // Never block Windows logoff/shutdown by hiding instead of closing.
  mainWindow.on('query-session-end', () => (quitting = true))
  mainWindow.on('session-end', () => (quitting = true))
  mainWindow.on('closed', () => (mainWindow = null))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('before-quit', () => (quitting = true))

  // A Mac app started from the Finder/Dock does not see Homebrew or ~/.local/bin: take the login shell's PATH before
  // anything looks up `claude`, `uv` or `ffmpeg` (resolved while Electron gets ready; Windows is unchanged).
  const loginPath = applyLoginPath({ platform: process.platform, env: process.env, home: os.homedir() })
    .then((r) => {
      if (r.error) console.warn(`Atelier: login shell PATH not read (${r.error}); using the usual folders`)
    })
    .catch(() => undefined)

  void Promise.all([app.whenReady(), loginPath]).then(() => {
    core = createCore({
      paths: { userData: app.getPath('userData') },
      cipher: safeStorageCipher,
      appName: app.getName(),
      appVersion: app.getVersion(),
      notify: (topic) => send('atelier:changed', { topic }),
      emitStream: (payload) => send('atelier:stream', payload),
      setWindowTheme: (theme) => applyWindowTheme(mainWindow, theme),
      // A fresh install starts empty (then the first-run onboarding); the example workspace (lot Z1) only with ATELIER_EXAMPLE=1.
      loadExample: exampleAtStart(process.env),
      // Automations (Production): the due rules fire every minute. ATELIER_AUTOMATIONS=off or ATELIER_RUNNER=off keep them idle.
      automations: process.env.ATELIER_AUTOMATIONS !== 'off' && process.env.ATELIER_RUNNER !== 'off',
      // Our engine (lot Z1): production files under userData; our resources (fonts, music, skills) next to
      // the app in dev, in `Resources/resources` once packaged (extraResources, same folder as the P5 worker); "Ouvrir le dossier" via the shell.
      productionRuns: {
        dataDir: app.getPath('userData'),
        resourcesDir: app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources'),
        opener: (dir) => shell.openPath(dir)
      },
      // The app updates itself from Atelier Cloud's update feed (src/main/updater): only a packaged app, on Windows or macOS.
      // electron-updater is loaded lazily, the first time a check runs. ATELIER_UPDATES=off keeps a packaged app still (smoke tests).
      updates: {
        createDriver: loadElectronUpdater,
        unsupported: !app.isPackaged || process.env.ATELIER_UPDATES === 'off' ? 'dev' : process.platform === 'win32' || process.platform === 'darwin' ? null : 'platform'
      },
      // The owner's YouTube figures through Google (src/main/google): refreshed once a day. ATELIER_GOOGLE=off keeps it still.
      google: { autoRefresh: process.env.ATELIER_GOOGLE !== 'off' },
      // Publication kits from the platform are saved in the Downloads folder.
      kits: { downloadsDir: () => app.getPath('downloads') },
      // The Cloud a new install signs in to: ATELIER_CLOUD_URL at launch (tests, a beta tester pointed elsewhere), else the
      // build's default (ATELIER_CLOUD_URL or ATELIER_BETA_CLOUD at build time), else the local development Cloud. Réglages wins.
      cloudUrl: process.env.ATELIER_CLOUD_URL || __ATELIER_CLOUD_URL__ || undefined,
      // Atelier Cloud's device login opens its approval page in the browser: web addresses only.
      openExternal: (url) => {
        if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
      },
      // Claude Code agents reach Atelier's tools through out/main/mcp.js, run by Electron's own binary as Node.
      // Packaged: the file is unpacked next to app.asar (asarUnpack), a child process cannot read inside the archive.
      // Our engine's local worker: out/main/worker.js run by Electron as Node (unpacked next to app.asar when packaged),
      // with the login-shell PATH applied at start (ffmpeg from Homebrew on the Mac).
      productionHost: (() => {
        const resourcesDir = resourcesDirFor({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
        const worker = appWorkerCommand({
          electronPath: process.execPath,
          outMainDir: __dirname,
          dataDir: path.join(app.getPath('userData'), 'production'),
          resourcesDir
        })
        return { resourcesDir, worker }
      })(),
      agentMcp: { command: process.execPath, args: [path.join(__dirname, 'mcp.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')] },
      // e2e tests: chat replies and agent runs come from a deterministic fake, never from a real model.
      ...(process.env.ATELIER_FAKE_LLM === '1'
        ? { chatProvider: () => fakeTeam, retryDelayMs: 0, discord: { fetch: e2eDiscord().fetch }, openExternal: () => undefined }
        : {})
    })
    core.bridgeReady?.catch((err: unknown) => console.error('Atelier bridge did not start:', err))
    // ATELIER_RUNNER=off: e2e specs that submit versions by hand keep the agents idle. The runner starts once the
    // bridge listens (or failed to), so the first Claude Code agents already get their tools.
    const started = core
    if (process.env.ATELIER_RUNNER !== 'off') {
      void (core.bridgeReady ?? Promise.resolve()).catch(() => undefined).then(() => started.runner.start())
    }
    const api = core.api
    core.context.workflow.onAwaitingApproval((deliverable, video) => {
      // Already looking at the app: the views refresh on their own, no toast.
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) return
      notifyApprovalRequest(deliverable, video, () => {
        const fresh = !mainWindow || mainWindow.isDestroyed()
        showWindow()
        if (fresh) mainWindow?.webContents.once('did-finish-load', () => send('atelier:navigate', { view: 'approvals' }))
        else send('atelier:navigate', { view: 'approvals' })
      })
    })

    // equipe-3-chaines: an ordered video ready (or not delivered) is a desktop toast, local brain or linked team computer
    watchVideoReady({
      list: async () => {
        const r = await routeCall(api, started.brainLink, 'orders.list', [])
        return r.ok ? (r.value as OrderView[]) : []
      },
      onClick: () => showWindow()
    })

    ipcMain.handle(CALL_CHANNEL, (event, method: unknown, args: unknown) => {
      if (!isTrustedSender(event, mainWindow)) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Unknown sender' } }
      }
      // Réglages › Ordinateur d'équipe connected: the call is answered by the team computer's brain (src/main/brain).
      return routeCall(api, started.brainLink, method, args)
    })
    started.brainLink?.start()

    denyDefaultSessionPermissions()
    // Waking from sleep: every screen re-reads its data (settings first, the others follow their own topics).
    onWake(() => {
      for (const topic of ['settings', 'cloud', 'production', 'credits', 'channels', 'videos', 'brain'] as const) send('atelier:changed', { topic })
    })
    openWindow()
    // A first update check a little after start, then every 4 hours (a no-op for a development build).
    started.updates.start()
    // Windows: the tray. macOS: the menu-bar icon (template image) next to the Dock icon.
    tray = createTray({ show: showWindow, quit: () => app.quit() })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow()
      else showWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || !tray) app.quit()
  })

  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
    core?.close()
    core = null
  })
}
