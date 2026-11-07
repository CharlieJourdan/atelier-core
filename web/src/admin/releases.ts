// The founder console's « Versions » page: the app releases pushed to the testers (Atelier Cloud, cloud/src/releases.ts; the
// contract is src/shared/cloud-releases.ts and a test parses real answers with it). The types are written out here so the
// site does not import the app's sources. In the mock-up console (no VITE_ATELIER_CLOUD) the page works on the invented
// releases below.

export type Channel = 'beta' | 'stable'
export type Platform = 'win' | 'mac'
export type ReleaseState = 'draft' | 'published' | 'withdrawn'

export interface ReleaseFile {
  name: string
  size: number
  sha512: string
}
export interface ReleaseRow {
  id: string
  version: string
  channel: Channel
  platform: Platform
  notes: string
  state: ReleaseState
  createdAt: string
  publishedAt: string | null
  withdrawnAt: string | null
  files: ReleaseFile[]
}
export interface LatestRow {
  channel: Channel
  platform: Platform
  releaseId: string
  version: string
}

export const CHANNEL_LABEL: Record<Channel, string> = { beta: 'Bêta', stable: 'Stable' }
export const PLATFORM_LABEL: Record<Platform, string> = { win: 'Windows', mac: 'macOS' }
export const STATE_LABEL: Record<ReleaseState, string> = { draft: 'Brouillon', published: 'Publiée', withdrawn: 'Retirée' }

export const feedFile = (platform: Platform): string => (platform === 'mac' ? 'latest-mac.yml' : 'latest.yml')
export const feedUrl = (cloud: string, channel: Channel, platform: Platform): string => `${cloud.replace(/\/+$/, '')}/v1/updates/${channel}/${platform}/${feedFile(platform)}`

/** « 124,3 Mo » */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko`
  return `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

export const releaseBytes = (r: ReleaseRow): number => r.files.reduce((n, f) => n + f.size, 0)

export function dateLabel(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

/** The newest version of each channel and platform that is published (what the testers get), the way the Cloud decides it. */
export function latestOf(releases: ReleaseRow[], channel: Channel, platform: Platform): ReleaseRow | null {
  const published = releases.filter((r) => r.channel === channel && r.platform === platform && r.state === 'published')
  return published.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null
}

/** SemVer precedence (a pre-release is older than its release); the same rule as the Cloud's. */
export function compareVersions(a: string, b: string): number {
  const re = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
  const pa = re.exec(a)
  const pb = re.exec(b)
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d < 0 ? -1 : 1
  }
  const [ra, rb] = [pa[4], pb[4]]
  if (ra === rb) return 0
  if (ra === undefined) return 1
  if (rb === undefined) return -1
  const [xa, xb] = [ra.split('.'), rb.split('.')]
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const [p, q] = [xa[i], xb[i]]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const [np, nq] = [/^\d+$/.test(p), /^\d+$/.test(q)]
    if (np && nq) {
      if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1
    } else if (np !== nq) return np ? -1 : 1
    else if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

/** Newest version first. */
export const sortReleases = (list: ReleaseRow[]): ReleaseRow[] => [...list].sort((a, b) => compareVersions(b.version, a.version) || (a.createdAt < b.createdAt ? 1 : -1))

const MB = 1024 * 1024
const file = (v: string, platform: Platform, mb: number): ReleaseFile[] => {
  const name = platform === 'win' ? `Atelier-Setup-${v}.exe` : `Atelier-${v}-arm64.zip`
  return [
    { name, size: Math.round(mb * MB), sha512: 'démo' },
    { name: `${name}.blockmap`, size: Math.round(mb * MB * 0.0012), sha512: 'démo' }
  ]
}

/** Invented releases for the mock-up console. */
export const DEMO_RELEASES: ReleaseRow[] = [
  { id: 'rel_demo3', version: '0.3.0', channel: 'beta', platform: 'win', notes: 'Le panneau Versions : tu pousses une mise à jour aux testeurs depuis la console.', state: 'draft', createdAt: '2026-10-25T09:12:00.000Z', publishedAt: null, withdrawnAt: null, files: file('0.3.0', 'win', 128.4) },
  { id: 'rel_demo2', version: '0.2.0', channel: 'beta', platform: 'win', notes: 'Mises à jour automatiques et canal bêta.\nCorrections dans la file de rendu.', state: 'published', createdAt: '2026-10-22T14:03:00.000Z', publishedAt: '2026-10-22T14:20:00.000Z', withdrawnAt: null, files: file('0.2.0', 'win', 126.9) },
  { id: 'rel_demo1', version: '0.1.0', channel: 'beta', platform: 'win', notes: 'Première version envoyée aux testeurs.', state: 'published', createdAt: '2026-10-12T08:00:00.000Z', publishedAt: '2026-10-12T08:15:00.000Z', withdrawnAt: null, files: file('0.1.0', 'win', 124.3) },
  { id: 'rel_demo0', version: '0.1.0', channel: 'stable', platform: 'win', notes: '', state: 'withdrawn', createdAt: '2026-10-13T08:00:00.000Z', publishedAt: '2026-10-13T08:10:00.000Z', withdrawnAt: '2026-10-14T07:00:00.000Z', files: file('0.1.0', 'win', 124.3) }
]
