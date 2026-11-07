// Native window and menu-bar chrome per OS, as plain data (no Electron import) so it is unit-tested with a
// simulated darwin. electron/window.ts and electron/tray.ts turn it into a BrowserWindow and a Tray.

export const TITLE_BAR_HEIGHT = 40

export interface WindowChrome {
  titleBarStyle: 'hidden' | 'hiddenInset'
  trafficLightPosition?: { x: number; y: number }
  titleBarOverlay?: { color: string; symbolColor: string; height: number }
}

export type ChromeTheme = 'dark' | 'light'

/** The window background and caption-button symbol colours per theme: the `--bg` and `--fg` tokens of tokens.css. */
export function chromeColors(theme: ChromeTheme): { background: string; symbols: string } {
  return theme === 'light' ? { background: '#FAFAF9', symbols: '#0C0C0E' } : { background: '#0C0C0E', symbols: '#F4F4F5' }
}

/**
 * macOS: `hiddenInset`, the traffic lights drawn inset over our own title bar (the renderer leaves room on the left
 * and marks the bar as a drag region). Windows/Linux: a hidden title bar with the native controls as an overlay.
 * Dark by default (the app's default theme), so the first frame is never a white flash.
 */
export function windowChrome(platform: NodeJS.Platform, theme: ChromeTheme = 'dark'): WindowChrome {
  const { background, symbols } = chromeColors(theme)
  // The traffic lights centred vertically in our 40 px title bar.
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: background, symbolColor: symbols, height: TITLE_BAR_HEIGHT } }
}

export interface TrayBitmap {
  /** BGRA pixels, row by row. */
  buffer: Buffer
  size: number
}

/** True where the original "A" mark (two legs and a crossbar) covers pixel (x, y) of a `size`-pixel square. */
function inMark(x: number, y: number, size: number): boolean {
  const s = size / 16
  const top = 3 * s
  const bottom = 13 * s
  const cy = y + 0.5
  const cx = x + 0.5
  if (cy < top || cy > bottom) return false
  const t = (cy - top) / (bottom - top)
  const mid = size / 2
  const left = mid - t * 4 * s
  const right = mid + t * 4 * s
  const half = 0.9 * s
  const leg = Math.abs(cx - left) < half || Math.abs(cx - right) < half
  const barY = 9.5 * s
  const bar = Math.abs(cy - barY) < 0.75 * s && cx > left && cx < right
  return leg || bar
}

/**
 * The menu-bar / tray icon drawn in code (no asset file).
 * - macOS: a template image, black with alpha only; macOS tints it for the light or dark menu bar.
 * - elsewhere: the white mark on Atelier's indigo rounded square.
 */
export function trayBitmap(platform: NodeJS.Platform, size = 16): TrayBitmap {
  const buffer = Buffer.alloc(size * size * 4)
  const template = platform === 'darwin'
  const r = Math.max(2, Math.round(size / 8))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const mark = inMark(x, y, size)
      if (template) {
        // BGRA: black, opaque only on the mark.
        buffer[i + 3] = mark ? 255 : 0
        continue
      }
      const corner = (x < r || x >= size - r) && (y < r || y >= size - r)
      if (corner) continue
      buffer[i] = mark ? 255 : 0xd6
      buffer[i + 1] = mark ? 255 : 0x5c
      buffer[i + 2] = mark ? 255 : 0x4f
      buffer[i + 3] = 255
    }
  }
  return { buffer, size }
}

/** Whether the OS wants a template image (macOS menu bar). */
export const usesTemplateTrayIcon = (platform: NodeJS.Platform): boolean => platform === 'darwin'
