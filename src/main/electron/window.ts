import { app, BrowserWindow, screen, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromeColors, TITLE_BAR_HEIGHT, windowChrome, type ChromeTheme } from '../platform/chrome'
import { isExternalHttpsUrl } from './ipc-guard'
import { MIN_HEIGHT, MIN_WIDTH, parseWindowState, resolveBounds } from '../platform/window-state'

const stateFile = (): string => path.join(app.getPath('userData'), 'window-state.json')

export const WINDOW_TITLE = 'Atelier'

/** Follows the renderer's theme: window background everywhere, caption-button overlay where there is one (not macOS). */
export function applyWindowTheme(win: BrowserWindow | null, theme: ChromeTheme): void {
  if (!win || win.isDestroyed()) return
  const { background, symbols } = chromeColors(theme)
  win.setBackgroundColor(background)
  if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: background, symbolColor: symbols, height: TITLE_BAR_HEIGHT })
}

export function createMainWindow(): BrowserWindow {
  let saved = null as ReturnType<typeof parseWindowState>
  try {
    saved = parseWindowState(readFileSync(stateFile(), 'utf8'))
  } catch {
    /* first launch: default size */
  }
  const bounds = resolveBounds(saved, screen.getAllDisplays().map((d) => d.workArea))
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: WINDOW_TITLE,
    show: false,
    backgroundColor: chromeColors('dark').background,
    // Our own title bar: macOS draws the traffic lights inset over it, Windows draws its controls as an overlay.
    ...windowChrome(process.platform),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize()
    win.show()
  })
  // Remember size, place and maximised state (a crash keeps the last save: written on every settled move/resize).
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const b = win.getNormalBounds()
    try {
      writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
    } catch {
      /* not remembered */
    }
  }
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', later)
  win.on('unmaximize', later)
  win.on('close', save)
  // Keep the title "Atelier" even if the page sets another one.
  win.on('page-title-updated', (e) => e.preventDefault())

  // No in-app navigation away from the renderer; https links open in the default browser (http is ignored).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpsUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}
