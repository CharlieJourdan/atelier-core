// The main window's remembered size and place (pure, no Electron import: unit-tested). A saved state that no longer
// fits the screens (unplugged monitor, lower resolution, hand-edited file) is repaired, never trusted blindly.

export const MIN_WIDTH = 1024
export const MIN_HEIGHT = 640
export const DEFAULT_WIDTH = 1360
export const DEFAULT_HEIGHT = 860

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface WindowState extends Partial<Rect> {
  width: number
  height: number
  maximized?: boolean
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Parses the saved JSON; anything unusable gives null. */
export function parseWindowState(raw: string | null | undefined): WindowState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (!finite(v.width) || !finite(v.height)) return null
    const s: WindowState = { width: Math.round(v.width), height: Math.round(v.height), maximized: v.maximized === true }
    if (finite(v.x) && finite(v.y)) {
      s.x = Math.round(v.x)
      s.y = Math.round(v.y)
    }
    return s
  } catch {
    return null
  }
}

/**
 * The bounds to open with: the saved size (never below the minimum, never larger than the biggest work area), at the
 * saved place only while at least a good part of it is still on a screen; else centred by the OS (no x/y).
 */
export function resolveBounds(saved: WindowState | null, workAreas: readonly Rect[]): { width: number; height: number; x?: number; y?: number } {
  const biggest = workAreas.reduce((a, r) => (r.width * r.height > a.width * a.height ? r : a), workAreas[0] ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const fit = (want: number, min: number, max: number): number => Math.max(Math.min(min, max), Math.min(want, max))
  const width = fit(saved?.width ?? DEFAULT_WIDTH, MIN_WIDTH, biggest.width)
  const height = fit(saved?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT, biggest.height)
  if (saved?.x !== undefined && saved.y !== undefined) {
    const { x, y } = saved
    const visible = workAreas.some((r) => {
      const w = Math.min(x + width, r.x + r.width) - Math.max(x, r.x)
      const h = Math.min(y + height, r.y + r.height) - Math.max(y, r.y)
      return w >= Math.min(width, 200) && h >= Math.min(height, 120) && y >= r.y - 1
    })
    if (visible) return { width, height, x, y }
  }
  return { width, height }
}
