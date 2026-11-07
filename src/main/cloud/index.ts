// Atelier Cloud in the app (lot P5): the session (device login, tokens), the API client and the spend mirror, built
// together by core.ts and handed to the IPC module and to the production host.
import type { Db } from '../db'
import type { SecretsStore } from '../secrets'
import type { SettingsStore } from '../settings'
import { BlueprintService } from '../blueprint/service'
import { CloudApi } from './client'
import { localRefiner } from '../eyes/refine'
import { CloudChannelIntel } from './intel'
import { CloudSpendMirror } from './mirror'
import { CloudVoicesService, type VoicesOptions } from './voices'
import { CloudSession } from './session'

export { CloudApi, catalogToFeatures } from './client'
export { CloudSpendMirror, CLOUD_PROVIDER_ID, type CloudJobEvent, type CloudSpendTags } from './mirror'
export { CloudSession, normaliseBaseUrl, DEFAULT_CLOUD_URL } from './session'
export { CloudVoicesService } from './voices'

export interface AppCloud {
  session: CloudSession
  api: CloudApi
  mirror: CloudSpendMirror
  voices: CloudVoicesService
  /** Channel data and video analysis through the Cloud (the eyes). */
  intel: CloudChannelIntel
  /** The published blueprint (fetched when connected, every 30 minutes and on demand; cached). */
  blueprint: BlueprintService
}

export interface AppCloudOptions {
  db: Db
  secrets: SecretsStore
  settings: SettingsStore
  /** Told when the connection changes ('cloud') or the mirror writes ('spend'). */
  notify: (topic: 'cloud' | 'spend') => void
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Overrides the device-login poll interval (tests). */
  pollMs?: number
  /** The Cloud address used until the person sets one (a build or launch default; else the local development Cloud). */
  defaultBaseUrl?: string
  /** Cloning a voice: where its jobs are remembered, how a recording is measured (tests inject both). */
  voices?: Pick<VoicesOptions, 'stateDir' | 'duration'>
  /** The eyes' jobs (channel reads, video analyses): where the quote of each is remembered across restarts. */
  eyes?: { stateDir?: string }
}

export function createAppCloud(o: AppCloudOptions): AppCloud {
  const now = o.now
  const session: CloudSession = new CloudSession({
    secrets: o.secrets,
    settings: o.settings,
    notify: () => {
      o.notify('cloud')
      blueprint.onConnectionChanged()
    },
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    ...(now ? { now: () => now().getTime() } : {}),
    ...(o.pollMs !== undefined ? { pollMs: o.pollMs } : {}),
    ...(o.defaultBaseUrl ? { defaultBaseUrl: o.defaultBaseUrl } : {})
  })
  const api = new CloudApi(session)
  const blueprint = new BlueprintService({
    settings: o.settings,
    fetch: () => api.blueprint(),
    connected: () => session.connected(),
    baseUrl: () => session.baseUrl(),
    notify: () => o.notify('cloud'),
    ...(now ? { now: () => now().getTime() } : {})
  })
  const mirror = new CloudSpendMirror(o.db, () => o.notify('spend'), now)
  return {
    session,
    api,
    mirror,
    blueprint,
    intel: new CloudChannelIntel(api, mirror, {
      // the real app (it has a data folder) counts cuts and words on the video itself; tests never start yt-dlp or ffmpeg
      ...(o.eyes?.stateDir ? { stateDir: o.eyes.stateDir, refine: localRefiner() } : {}),
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
      ...(o.pollMs !== undefined ? { pollMs: Math.min(o.pollMs, 250) } : {}),
      ...(now ? { now } : {})
    }),
    voices: new CloudVoicesService(api, mirror, {
      ...o.voices,
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
      ...(o.pollMs !== undefined ? { pollMs: Math.min(o.pollMs, 250) } : {})
    })
  }
}
