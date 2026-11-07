// The app updating itself (docs/RELEASES.md): checks Atelier Cloud's update feed at start and every 4 hours, downloads a newer
// version in the background and installs it when the app quits (or at once when the person asks). The state machine lives
// here with no Electron import: the real updater (electron-updater, electron-driver.ts) sits behind `UpdaterDriver`, a fake
// one drives the tests. A development build, an unsupported system and the headless brain never update themselves.
import type { UpdateChannel, UpdatePhase, UpdateStatus, UpdateUnsupported } from '../../shared/api/update'
import { updateFeedUrl } from '../../shared/cloud-releases'
import { t } from '../../shared/fr'
import type { SettingsStore } from '../settings'

/** What the real updater tells us, in our own words. */
export type DriverEvent =
  | { type: 'available'; version: string; notes: string | null }
  | { type: 'none' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; notes?: string | null }
  | { type: 'error'; message: string }

export interface UpdaterDriver {
  /** Points the updater at a feed (called before each check: the Cloud's address and the channel can change). */
  setFeed(url: string): void
  /** Asks the feed; the download of a newer version starts by itself. Rejects when the feed cannot be read. */
  check(): Promise<void>
  /** Quits the app and runs the downloaded installer. */
  quitAndInstall(): void
  /** Listens to the updater's events; answers the way to stop. */
  subscribe(listener: (e: DriverEvent) => void): () => void
}

export const CHANNEL_KEY = 'update.channel'
/** The first check, a little after start (the window and the first screens come first). */
export const FIRST_CHECK_DELAY_MS = 20_000
/** Then every 4 hours. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export interface UpdateServiceOptions {
  settings: SettingsStore
  /** The version installed now (package.json's). */
  currentVersion: string
  /** The Cloud's address (the app's Cloud connection). */
  cloudUrl: () => string
  /** Why this app cannot update itself, else null. */
  unsupported: UpdateUnsupported | null
  /** Creates the real updater (loaded lazily: only the packaged app has it). */
  createDriver: () => Promise<UpdaterDriver>
  /** `process.platform`. */
  osPlatform?: string
  /** Told when the status changes (the 'update' change topic). */
  notify: () => void
  now?: () => number
  /** Schedules `fn` after `ms`; answers the way to cancel (tests drive time by hand). */
  schedule?: (fn: () => void, ms: number) => () => void
  /** Delay of the first check (default 20 s). */
  firstCheckDelayMs?: number
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms)
  id.unref?.()
  return () => clearTimeout(id)
}

const platformOf = (os: string): 'win' | 'mac' | 'other' => (os === 'win32' ? 'win' : os === 'darwin' ? 'mac' : 'other')

export class UpdateService {
  private readonly o: UpdateServiceOptions
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => () => void
  private driver: UpdaterDriver | null = null
  private driverLoading: Promise<UpdaterDriver> | null = null
  private unsubscribe: (() => void) | null = null
  private cancelTimer: (() => void) | null = null
  private closed = false
  private started = false
  private phase: UpdatePhase
  private available: string | null = null
  private notes: string | null = null
  private percent: number | null = null
  private checkedAt: string | null = null
  private error: string | null = null

  constructor(o: UpdateServiceOptions) {
    this.o = o
    this.now = o.now ?? Date.now
    this.schedule = o.schedule ?? defaultSchedule
    this.phase = o.unsupported ? 'unsupported' : 'idle'
  }

  private get platform(): 'win' | 'mac' | 'other' {
    return platformOf(this.o.osPlatform ?? process.platform)
  }

  channel(): UpdateChannel {
    const v = this.o.settings.get<string | null>(CHANNEL_KEY, null)
    return v === 'stable' ? 'stable' : 'beta'
  }

  status(): UpdateStatus {
    const platform = this.platform
    return {
      phase: this.phase,
      unsupported: this.o.unsupported,
      current: this.o.currentVersion,
      channel: this.channel(),
      available: this.available,
      notes: this.notes,
      percent: this.percent,
      checkedAt: this.checkedAt,
      error: this.error,
      platform,
      feedUrl: updateFeedUrl(this.o.cloudUrl(), this.channel(), platform === 'mac' ? 'mac' : 'win')
    }
  }

  private changed(): void {
    if (!this.closed) this.o.notify()
  }

  /** Starts the schedule: a first check shortly after start, then every 4 hours. Does nothing for an unsupported app. */
  start(): void {
    if (this.started || this.closed || this.o.unsupported) return
    this.started = true
    this.cancelTimer = this.schedule(() => void this.tick(), this.o.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS)
  }

  private async tick(): Promise<void> {
    if (this.closed) return
    await this.check().catch(() => undefined)
    if (!this.closed) this.cancelTimer = this.schedule(() => void this.tick(), CHECK_EVERY_MS)
  }

  close(): void {
    this.closed = true
    this.cancelTimer?.()
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private async load(): Promise<UpdaterDriver> {
    if (this.driver) return this.driver
    this.driverLoading ??= this.o.createDriver().then((d) => {
      this.driver = d
      this.unsubscribe = d.subscribe((e) => this.onEvent(e))
      return d
    })
    try {
      return await this.driverLoading
    } catch (err) {
      this.driverLoading = null
      throw err
    }
  }

  private onEvent(e: DriverEvent): void {
    switch (e.type) {
      case 'available':
        this.phase = 'downloading'
        this.available = e.version
        this.notes = e.notes
        this.percent = 0
        this.error = null
        break
      case 'none':
        this.phase = 'idle'
        this.available = null
        this.notes = null
        this.percent = null
        break
      case 'progress':
        if (this.phase === 'downloading' || this.phase === 'checking') this.phase = 'downloading'
        this.percent = Math.max(0, Math.min(100, Math.round(e.percent)))
        break
      case 'downloaded':
        this.phase = 'ready'
        this.available = e.version
        if (e.notes !== undefined) this.notes = e.notes
        this.percent = 100
        this.error = null
        break
      case 'error':
        this.fail(e.message)
        return
    }
    this.changed()
  }

  private fail(message: string): void {
    // an update already downloaded stays installable even if a later check fails
    if (this.phase !== 'ready') this.phase = 'error'
    this.error = t('update.err.check', { reason: message.split('\n')[0]?.slice(0, 300) ?? '' })
    this.checkedAt = new Date(this.now()).toISOString()
    this.changed()
  }

  /** Looks for an update now. A check or a download already running, an update already downloaded, or an unsupported app: nothing is asked. */
  async check(): Promise<UpdateStatus> {
    if (this.closed || this.o.unsupported || this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'ready') return this.status()
    this.phase = 'checking'
    this.error = null
    this.changed()
    try {
      const driver = await this.load()
      driver.setFeed(this.status().feedUrl)
      await driver.check()
      // an 'available' event moved us to downloading; if nothing was said, there is nothing newer
      if (this.phase === 'checking') {
        this.phase = 'idle'
        this.available = null
        this.notes = null
        this.percent = null
      }
      this.checkedAt = new Date(this.now()).toISOString()
      this.changed()
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
    }
    return this.status()
  }

  /** Chooses the channel and looks for an update on it. Not while a download runs. */
  async setChannel(channel: unknown): Promise<UpdateStatus> {
    if (channel !== 'beta' && channel !== 'stable') throw new Error(t('update.err.channel'))
    if (this.phase === 'downloading' || this.phase === 'checking') throw new Error(t('update.err.busy'))
    if (channel !== this.channel()) {
      this.o.settings.set(CHANNEL_KEY, channel)
      if (this.phase !== 'ready') {
        this.available = null
        this.notes = null
        this.percent = null
        this.error = null
      }
      this.changed()
    }
    return this.check()
  }

  /** Quits and installs the downloaded update. */
  install(): void {
    if (this.phase !== 'ready' || !this.driver) throw new Error(t('update.err.notReady'))
    this.driver.quitAndInstall()
  }
}
