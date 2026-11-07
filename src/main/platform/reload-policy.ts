// Pure policy for the window that goes blank (renderer crash, failed load): reload it, but not in a loop.
// Used by src/main/electron/resilience.ts; unit-tested without Electron.

/** At most this many reloads inside the window below; after that the user sees the calm error page instead. */
export const MAX_RELOADS = 3
export const RELOAD_WINDOW_MS = 60_000

export interface ReloadPolicy {
  /** True when a reload is allowed now (and records it). */
  allow(now: number): boolean
}

export function createReloadPolicy(max = MAX_RELOADS, windowMs = RELOAD_WINDOW_MS): ReloadPolicy {
  let times: number[] = []
  return {
    allow(now) {
      times = times.filter((t) => now - t < windowMs)
      if (times.length >= max) return false
      times.push(now)
      return true
    }
  }
}

/** Shown when the screen cannot load at all and reloading did not help (French, no code, a next step). */
export const FALLBACK_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Atelier</title><body style="font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="max-width:420px;text-align:center"><h1 style="font-size:20px">Atelier n’arrive pas à afficher son écran</h1><p style="color:#aaa;line-height:1.5">Tes données sont gardées. Ferme Atelier puis rouvre-le. Si ça recommence, réinstalle la dernière version.</p></div></body>'
