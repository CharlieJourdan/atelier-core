// Things that must never end in a blank window or a native English crash box: a crashed or failed renderer is reloaded
// (a few times, then a calm page), a stray error in the main process is logged and does not kill the app, and waking from
// sleep tells the screens to refresh everything (timers jumped, the network may have changed).
import { powerMonitor, type BrowserWindow } from 'electron'
import { createReloadPolicy, FALLBACK_PAGE } from '../platform/reload-policy'

export function installProcessGuards(): void {
  process.on('uncaughtException', (err) => console.error('Atelier: uncaught error in the main process:', err))
  process.on('unhandledRejection', (reason) => console.error('Atelier: unhandled rejection in the main process:', reason))
}

export function guardWindow(win: BrowserWindow): void {
  const policy = createReloadPolicy()
  const recover = (why: string): void => {
    if (win.isDestroyed()) return
    console.error(`Atelier: window recovery (${why})`)
    if (policy.allow(Date.now())) win.webContents.reload()
    else void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(FALLBACK_PAGE)}`)
  }
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') recover(`renderer gone: ${details.reason}`)
  })
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    // -3 = aborted by a navigation we asked for
    if (isMainFrame && code !== -3) setTimeout(() => recover(`load failed: ${code}`), 500)
  })
}

/** After a sleep the screens refresh everything. `refresh` is called once per wake-up. */
export function onWake(refresh: () => void): void {
  powerMonitor.on('resume', refresh)
  powerMonitor.on('unlock-screen', refresh)
}
