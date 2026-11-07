// IPC contract, module "update": the app updating itself from Atelier Cloud's update feed (src/shared/cloud-releases.ts).
// The main process checks at start and every 4 hours, downloads in the background, and installs when the app quits (or
// at once when the person asks). Réglages › À propos shows this status. Every method added here must also be listed in
// UPDATE_METHODS.

export type UpdateChannel = 'beta' | 'stable'

/**
 * idle: nothing happening (`available` is null when the last check found nothing newer);
 * checking / downloading (`percent`, `available`) / ready (downloaded: installs on quit or on request) / error;
 * unsupported: this app does not update itself (see `unsupported`).
 */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unsupported'

/** Why an app does not update itself: a development build, a system without an updater, or no window system (the headless brain). */
export type UpdateUnsupported = 'dev' | 'platform' | 'headless'

export interface UpdateStatus {
  phase: UpdatePhase
  unsupported: UpdateUnsupported | null
  /** The version installed now. */
  current: string
  channel: UpdateChannel
  /** The newer version found (downloading or ready), else null. */
  available: string | null
  /** The release notes the founder wrote for `available`, when there are some. */
  notes: string | null
  /** Download progress, 0 to 100, while downloading. */
  percent: number | null
  /** ISO time of the last finished check, else null. */
  checkedAt: string | null
  /** A French (or English) sentence when the last check or download failed. */
  error: string | null
  /** The OS family of this app, for the help text (an unsigned Windows installer shows a SmartScreen warning; macOS needs a signed app). */
  platform: 'win' | 'mac' | 'other'
  /** The feed this app reads (the Cloud's address, the channel and the platform). */
  feedUrl: string
}

export interface UpdateContract {
  /** The current status (no network). */
  'app.update.status': { args: []; result: UpdateStatus }
  /** Looks for an update now (does nothing while a check or a download is running); answers the status as it is then. */
  'app.update.check': { args: []; result: UpdateStatus }
  /** Quits the app and installs the downloaded update (only when the phase is `ready`). */
  'app.update.install': { args: []; result: void }
  /** Chooses the channel the app follows (beta or stable) and looks for an update on it. */
  'app.update.setChannel': { args: [channel: UpdateChannel]; result: UpdateStatus }
}

export const UPDATE_METHODS = [
  'app.update.status',
  'app.update.check',
  'app.update.install',
  'app.update.setChannel'
] as const satisfies readonly (keyof UpdateContract)[]
