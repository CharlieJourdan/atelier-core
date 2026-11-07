// The real updater: electron-updater's `autoUpdater` with the "generic" provider pointed at Atelier Cloud's update feed
// (`<cloud>/v1/updates/<channel>/<platform>`, cloud/src/http/routes-releases.ts). Loaded lazily and only by the packaged app
// (index.ts), so a development run, the unit tests and the headless brain never need the module. Windows: the NSIS
// installer works unsigned (SmartScreen may warn the first time). macOS: auto-update needs a signed app (docs/RELEASES.md).
import type { DriverEvent, UpdaterDriver } from './service'

/** The part of electron-updater's `AppUpdater` this file uses. */
interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  logger: unknown
  setFeedURL(options: { provider: 'generic'; url: string; channel?: string }): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

/** electron-updater's release notes are a string, or a list of { version, note } entries. */
export function notesOf(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null
  if (Array.isArray(raw)) {
    const text = raw
      .map((n) => (n && typeof n === 'object' && typeof (n as { note?: unknown }).note === 'string' ? (n as { note: string }).note : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim()
    return text || null
  }
  return null
}

const infoOf = (a: unknown): { version: string; notes: string | null } => {
  const info = (a && typeof a === 'object' ? a : {}) as { version?: unknown; releaseNotes?: unknown }
  return { version: typeof info.version === 'string' ? info.version : '', notes: notesOf(info.releaseNotes) }
}

/** Wraps an `autoUpdater` (the real one, or an object of the same shape) as an UpdaterDriver. */
export function driverFor(updater: AutoUpdaterLike): UpdaterDriver {
  // We choose when to look and the feed is ours: download by itself, install when the app quits, never go back a version.
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowDowngrade = false
  updater.logger = null
  return {
    setFeed: (url) => {
      // one feed per channel: the file is always `latest.yml` / `latest-mac.yml` under the channel's URL. The updater's own
      // `channel` property is left alone: setting it also switches downgrades on.
      updater.setFeedURL({ provider: 'generic', url, channel: 'latest' })
    },
    check: async () => {
      await updater.checkForUpdates()
    },
    quitAndInstall: () => updater.quitAndInstall(true, true),
    subscribe: (listener) => {
      const handlers: [string, (...args: unknown[]) => void][] = [
        ['update-available', (info) => listener({ type: 'available', ...infoOf(info) } satisfies DriverEvent)],
        ['update-not-available', () => listener({ type: 'none' })],
        ['download-progress', (p) => listener({ type: 'progress', percent: Number((p as { percent?: unknown } | null)?.percent ?? 0) })],
        ['update-downloaded', (info) => listener({ type: 'downloaded', ...infoOf(info) })],
        ['error', (err) => listener({ type: 'error', message: err instanceof Error ? err.message : String(err) })]
      ]
      for (const [name, fn] of handlers) updater.on(name, fn)
      return () => {
        for (const [name, fn] of handlers) updater.removeListener(name, fn)
      }
    }
  }
}

/** Loads electron-updater (the packaged app only) and wraps its `autoUpdater`. */
export async function loadElectronUpdater(): Promise<UpdaterDriver> {
  // a computed name keeps the bundler from resolving it at build time: it is a dependency of the packaged app, loaded here at run time
  const name = 'electron-updater'
  const mod = (await import(/* @vite-ignore */ name)) as { autoUpdater?: AutoUpdaterLike; default?: { autoUpdater?: AutoUpdaterLike } }
  // the module is CommonJS: its `autoUpdater` is a named export or sits under `default` depending on the loader
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!autoUpdater) throw new Error('electron-updater: no autoUpdater')
  return driverFor(autoUpdater)
}
