// A test helper that makes a temporary folder calls trackTemp(dir): the folder is removed when the test FILE ends
// (tests/setup/temp-root.ts), so a helper used by many tests never leaves it behind even if a test forgets to clean up.
const KEY = '__atelierTrackedTemp'
type G = { [KEY]?: string[] }

export function trackTemp(dir: string): string {
  const g = globalThis as G
  ;(g[KEY] ??= []).push(dir)
  return dir
}

export function drainTracked(): string[] {
  const g = globalThis as G
  const list = g[KEY] ?? []
  g[KEY] = []
  return list
}
