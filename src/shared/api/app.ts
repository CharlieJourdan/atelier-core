// IPC contract, module "app": App info.

export interface AppInfo {
  name: string
  version: string
  platform: string
  dbPath: string
  schemaVersion: number
  /**
   * Editing a pipeline by hand (bricks, engines, styles, internal options, building one from scratch): the founder's and the
   * developers' only, behind the dev flag `ATELIER_PIPELINE_DEV=1` (decision 0051). A user changes a pipeline through its
   * options and « Parler à l'agent ».
   */
  pipelineDev?: boolean
  /**
   * Pipeline codes (sharing a pipeline as a code, importing one, the file export / import): built but off in the beta
   * (production-lab, Charlie 01/11: « on ne doit pas pouvoir, pour le moment, exporter »); on with `ATELIER_PIPELINE_CODES=1`.
   */
  pipelineCodes?: boolean
}


export type WindowTheme = 'dark' | 'light'

/** Live figures of the machine the app runs on (the beta's stand-in for the rented team computer). */
export interface MachineStats {
  hostname: string
  os: string
  cpuModel: string
  cores: number
  /** Processor load since the previous call, 0–100. */
  cpu: number
  ramTotalGb: number
  /** Memory in use, 0–100. */
  ram: number
  diskTotalGb: number
  diskUsedGb: number
  uptimeHours: number
  /** Present when a headless brain answers (the team computer): its own uptime and its last backup. */
  brain?: BrainHealth
}

/** The team computer's brain (docs/BRAIN-HEADLESS.md §10): how long it runs, how often its keeper restarted it, its backups. */
export interface BrainHealth {
  startedAt: string
  uptimeS: number
  /** Restarts by the keeper after a crash, since the keeper started (0 without a keeper). */
  restarts: number
  /** The last backup, null before the first one. `cloud`: sent to Atelier Cloud, kept here only (`off`: not enrolled), or not sent. */
  backup: { at: string; ok: boolean; sizeBytes: number; cloud: 'sent' | 'off' | 'failed'; error: string | null } | null
  /** When the next backup runs, null when backups are off. */
  nextBackupAt: string | null
}

/**
 * The first-run onboarding (stored in the database settings, so a team computer reached through the relay answers for
 * its own workspace). `done` once it was finished (or « Plus tard »), or when the workspace already holds a channel of its
 * own (one made before the onboarding was stored; the example workspace's channels do not count).
 */
export interface OnboardingStatus {
  done: boolean
}

export interface AppContract {
  'app.info': { args: []; result: AppInfo }
  /** Tells the main process which theme the renderer shows, so the native window background and caption buttons follow. */
  'app.setTheme': { args: [theme: WindowTheme]; result: void }
  /** Processor, memory and disk of this machine (the disk holding the app's data). */
  'app.machine': { args: []; result: MachineStats }
  /** Has this workspace finished the first-run onboarding? */
  'app.onboarding': { args: []; result: OnboardingStatus }
  /** The first-run onboarding is over (finished, or « Plus tard » with no channel): it does not open again by itself. */
  'app.finishOnboarding': { args: []; result: OnboardingStatus }
}

export const APP_METHODS = [
  'app.info',
  'app.setTheme',
  'app.machine',
  'app.onboarding',
  'app.finishOnboarding'
] as const satisfies readonly (keyof AppContract)[]
