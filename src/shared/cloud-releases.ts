// App releases on Atelier Cloud: the founder edits the dev version, builds an installer and pushes it to the beta testers.
// The Cloud keeps each release (version, channel, platform, notes, files with their size and SHA-512) and serves the
// update feed in the format of electron-updater's "generic" provider: `<cloud>/v1/updates/<channel>/<platform>/latest.yml`
// (`latest-mac.yml` on macOS) with the files next to it. The routes that create, upload, publish and withdraw are for the
// platform admin only; the feed and the downloads are public (the installers are not secret, and an updater has no login).
//
// Imports only zod, like cloud-kit.ts: the Cloud (type stripping) and the app and console (bundlers) read it as it is.
import { z } from 'zod'

export const RELEASE_CHANNELS = ['beta', 'stable'] as const
export const ReleaseChannel = z.enum(RELEASE_CHANNELS)
export type ReleaseChannel = z.infer<typeof ReleaseChannel>

export const RELEASE_PLATFORMS = ['win', 'mac'] as const
export const ReleasePlatform = z.enum(RELEASE_PLATFORMS)
export type ReleasePlatform = z.infer<typeof ReleasePlatform>

export const ReleaseState = z.enum(['draft', 'published', 'withdrawn'])
export type ReleaseState = z.infer<typeof ReleaseState>

/** MAJOR.MINOR.PATCH with an optional pre-release tag (`0.2.0-beta.1`); no build metadata. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
export const Semver = z.string().max(40).regex(SEMVER, 'a version like 1.2.3')

/** A plain file name (same rule as the kits'): `Atelier-Setup-0.2.0.exe`, `Atelier-Setup-0.2.0.exe.blockmap`. */
export const RELEASE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
/** One installer file at most this big (the Windows installer is about 100 to 150 MB). */
export const MAX_RELEASE_FILE_BYTES = 400 * 1024 * 1024
export const MAX_RELEASE_FILES = 8
export const MAX_RELEASE_NOTES = 5000

/** Orders two versions by SemVer precedence: negative when `a` is older than `b`. A pre-release is older than its release. */
export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d < 0 ? -1 : 1
  }
  const ra = pa[4]
  const rb = pb[4]
  if (ra === rb) return 0
  if (ra === undefined) return 1
  if (rb === undefined) return -1
  const xa = ra.split('.')
  const xb = rb.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const p = xa[i]
    const q = xb[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const np = /^\d+$/.test(p)
    const nq = /^\d+$/.test(q)
    if (np && nq) {
      if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1
    } else if (np !== nq) return np ? -1 : 1
    else if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

/** A file is a blockmap (the updater's differential download map): served, but not listed as an installer in the feed. */
export const isBlockmap = (name: string): boolean => name.endsWith('.blockmap')

/** The file the updater installs from: the `.exe` on Windows; the `.zip` (else the `.dmg`) on macOS. */
export function installerOf(platform: ReleasePlatform, names: readonly string[]): string | null {
  const wanted = platform === 'win' ? ['.exe'] : ['.zip', '.dmg']
  for (const ext of wanted) {
    const found = names.find((n) => n.toLowerCase().endsWith(ext))
    if (found) return found
  }
  return null
}

/** The feed file the updater of this platform asks for. */
export const feedFileName = (platform: ReleasePlatform): string => (platform === 'mac' ? 'latest-mac.yml' : 'latest.yml')

export const ReleaseFile = z.object({
  name: z.string().regex(RELEASE_FILE_NAME, 'a plain file name'),
  size: z.number().int().min(0),
  /** Base64 SHA-512, as electron-updater's feed wants it (computed by the Cloud from the bytes it stored). */
  sha512: z.string().min(1).max(200)
})
export type ReleaseFile = z.infer<typeof ReleaseFile>

export const Release = z.object({
  id: z.string(),
  version: Semver,
  channel: ReleaseChannel,
  platform: ReleasePlatform,
  notes: z.string(),
  state: ReleaseState,
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  files: z.array(ReleaseFile)
})
export type Release = z.infer<typeof Release>

export const ReleaseCreateRequest = z.object({
  version: Semver,
  channel: ReleaseChannel,
  platform: ReleasePlatform,
  notes: z.string().max(MAX_RELEASE_NOTES).default('')
})
export type ReleaseCreateRequest = z.infer<typeof ReleaseCreateRequest>

/** `POST …/files?name=…&sha256=…`, body = the raw bytes (`application/octet-stream`); the hash is checked. */
export const ReleaseFileQuery = z.object({
  name: z.string().regex(RELEASE_FILE_NAME, 'a plain file name'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex SHA-256')
})

export const ReleaseListResponse = z.object({
  releases: z.array(Release),
  /** The release each feed serves now (the highest published version of its channel and platform). */
  latest: z.array(z.object({ channel: ReleaseChannel, platform: ReleasePlatform, releaseId: z.string(), version: z.string() }))
})
export type ReleaseListResponse = z.infer<typeof ReleaseListResponse>

export const ReleaseOk = z.object({ ok: z.literal(true) })

export interface ReleaseRoute {
  method: 'GET' | 'POST'
  path: string
  auth: 'platformAdmin'
  body?: z.ZodType
  query?: z.ZodType
  response: z.ZodType | null
}

export const RELEASE_ROUTES = {
  releaseCreate: { method: 'POST', path: '/v1/admin/releases', auth: 'platformAdmin', body: ReleaseCreateRequest, response: Release },
  releaseList: { method: 'GET', path: '/v1/admin/releases', auth: 'platformAdmin', response: ReleaseListResponse },
  releaseFile: { method: 'POST', path: '/v1/admin/releases/:id/files', auth: 'platformAdmin', query: ReleaseFileQuery, response: ReleaseFile },
  releasePublish: { method: 'POST', path: '/v1/admin/releases/:id/publish', auth: 'platformAdmin', response: Release },
  releaseWithdraw: { method: 'POST', path: '/v1/admin/releases/:id/withdraw', auth: 'platformAdmin', response: Release },
  releaseDelete: { method: 'POST', path: '/v1/admin/releases/:id/delete', auth: 'platformAdmin', response: ReleaseOk }
} as const satisfies Record<string, ReleaseRoute>

/** The public feed: `latest.yml` / `latest-mac.yml`, and the files of the latest published release (and of the older ones). */
export const UPDATE_FEED_PATH = '/v1/updates/:channel/:platform/:name'
export const updateFeedUrl = (cloud: string, channel: ReleaseChannel, platform: ReleasePlatform): string => `${cloud.replace(/\/+$/, '')}/v1/updates/${channel}/${platform}`
