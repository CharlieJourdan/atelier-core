// Decides whether an Electron window can be shown here. Returns a skip reason, or null when it can.
//
// Environment:
//   ATELIER_E2E_SKIP=1        skip every e2e spec on purpose (checked first; the specs report it as skipped).
//   ATELIER_E2E_FORCE=1       run anyway, without asking Windows (e.g. Electron can often render on the hidden
//                             desktop of session 0). Wins over the detection below, not over ATELIER_E2E_SKIP.
//   ATELIER_E2E_ALLOW_SKIP=1  when no desktop is detected, or the detection itself fails, skip quietly instead of
//                             failing. Without it, that case is an error: a green e2e run must mean the specs ran.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

let cached: { reason: string | null } | null = null

export function noDesktopReason(): string | null {
  cached ??= { reason: decide() }
  return cached.reason
}

function decide(): string | null {
  if (process.env.ATELIER_E2E_SKIP) return 'ATELIER_E2E_SKIP is set'
  if (process.env.ATELIER_E2E_FORCE) return null
  const reason = detect()
  if (reason === null) return null
  if (process.env.ATELIER_E2E_ALLOW_SKIP === '1') return `${reason} (ATELIER_E2E_ALLOW_SKIP=1)`
  throw new Error(
    `e2e cannot run here: ${reason}. Run from an interactive desktop, or set ATELIER_E2E_FORCE=1 to try anyway, ` +
      'ATELIER_E2E_ALLOW_SKIP=1 to skip the e2e specs instead of failing, or ATELIER_E2E_SKIP=1 to skip on purpose.'
  )
}

function detect(): string | null {
  if (process.platform === 'win32') {
    try {
      // Session 0 is the services session: no interactive desktop there.
      const out = execFileSync(
        // Full path under %SystemRoot%, not the search path (same rule as taskkill).
        path.win32.join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', '"$((Get-Process -Id $PID).SessionId) $([Environment]::UserInteractive)"'],
        { encoding: 'utf8', windowsHide: true, timeout: 20_000 }
      ).trim()
      const [session, interactive] = out.split(/\s+/)
      if (session === '0') return 'running in Windows session 0 (service session, no desktop)'
      if (interactive === 'False') return 'Windows reports a non-interactive user session'
      if (!session || !/^\d+$/.test(session)) return `could not read the Windows session (got "${out.slice(0, 80)}")`
      return null
    } catch (err) {
      return `could not query the Windows session (${err instanceof Error ? err.message : String(err)})`
    }
  }
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return 'no DISPLAY or WAYLAND_DISPLAY (headless Linux)'
  }
  return null
}
