// True in the desktop app: the preload bridge exists and is not the web demo's stub (the web demo and unit renders have none).
export function isDesktopApp(): boolean {
  const w = globalThis as { atelier?: { web?: boolean; call?: unknown } }
  return typeof w.atelier?.call === 'function' && w.atelier.web !== true
}
