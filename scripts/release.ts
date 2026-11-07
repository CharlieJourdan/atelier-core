// `npm run release -- --channel beta --notes "…"`: pushes the current version of the app to the beta testers.
//   1. reads the version from package.json and refuses one the Cloud already has (published or withdrawn);
//   2. builds the installer (`npm run dist` on Windows; `--skip-build` reuses what is in dist/, to promote a build);
//   3. creates a draft release on Atelier Cloud, uploads the installer and its blockmap (streamed, with their hashes),
//   4. publishes it: the testers' apps find it in their update feed (docs/RELEASES.md).
// `--dry-run` prints what would be done and changes nothing (it only reads the Cloud, when a token is at hand).
//
// The Cloud is `--cloud URL` (else $ATELIER_CLOUD_URL, else the local one on 127.0.0.1:8787); https only, except on this
// computer. The credential is a platform admin's access token in $ATELIER_ADMIN_TOKEN (never on the command line):
// `npm run cloud -- admin token --email …` prints one for a Cloud on this computer; without it the command starts the
// device login (a code to approve in the browser, like the app's) and uses what it gets.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { pkceChallenge } from '../src/shared/cloud-api'
import {
  MAX_RELEASE_FILE_BYTES,
  RELEASE_CHANNELS,
  RELEASE_PLATFORMS,
  SEMVER,
  compareVersions,
  installerOf,
  updateFeedUrl,
  type Release,
  type ReleaseChannel,
  type ReleaseListResponse,
  type ReleasePlatform
} from '../src/shared/cloud-releases'

export interface ReleaseOptions {
  channel: ReleaseChannel
  platform: ReleasePlatform
  notes: string
  /** The Cloud's address, already checked by `checkCloudUrl`. */
  cloudUrl: string
  dryRun: boolean
  skipBuild: boolean
  /** The repository (package.json, dist/). */
  root: string
  /** A platform admin's access token; without it the device login runs (never in dry-run). */
  token?: string | undefined
}

export interface ReleaseEnv {
  log: (line: string) => void
  fetchImpl?: typeof fetch
  /** Builds the installer (default: npm run dist / dist:mac in the repository). */
  build?: (platform: ReleasePlatform, root: string) => Promise<void>
  /** Gets an access token by the device login (default: the real one; tests give their own). */
  login?: (cloudUrl: string) => Promise<string>
  sleep?: (ms: number) => Promise<void>
}

export interface ReleaseResult {
  version: string
  dryRun: boolean
  releaseId: string | null
  files: string[]
  feedUrl: string
}

export class ReleaseError extends Error {}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The origin of the Cloud's address: https, or http on this computer only (the token must not cross the network in clear). */
export function checkCloudUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ReleaseError(`Adresse du Cloud invalide : ${value}`)
  }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname.toLowerCase()))) return url.origin
  throw new ReleaseError('Adresse du Cloud refusée : https://… (ou http:// seulement sur cet ordinateur, 127.0.0.1 ou localhost).')
}

/** The files electron-builder leaves in dist/ for this version, installer first. */
export function expectedFiles(platform: ReleasePlatform, version: string): string[] {
  return platform === 'win' ? [`Atelier-Setup-${version}.exe`, `Atelier-Setup-${version}.exe.blockmap`] : [`Atelier-${version}-arm64.zip`, `Atelier-${version}-arm64.zip.blockmap`]
}
const distDir = (root: string, platform: ReleasePlatform): string => path.join(root, 'dist', platform)

function readVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof pkg.version !== 'string' || !SEMVER.test(pkg.version)) throw new ReleaseError(`La version de package.json est invalide : ${String(pkg.version)} (attendu 1.2.3).`)
  return pkg.version
}

/** Runs `npm run dist` (or dist:mac) in the repository, its output shown. */
export function npmBuild(platform: ReleasePlatform, root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', platform === 'win' ? 'dist' : 'dist:mac'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new ReleaseError(`La construction de l’installeur a échoué (code ${String(code)}).`))))
  })
}

interface Api {
  get<T>(p: string): Promise<T>
  post<T>(p: string, body?: unknown): Promise<T>
  upload<T>(p: string, file: string, size: number): Promise<T>
}

function api(cloudUrl: string, token: string, fetchImpl: typeof fetch): Api {
  const headers = { authorization: `Bearer ${token}` }
  const read = async <T>(res: Response): Promise<T> => {
    const text = await res.text()
    let json: { error?: { code?: string; message?: string } } = {}
    try {
      json = JSON.parse(text) as typeof json
    } catch {
      // not JSON
    }
    if (!res.ok) {
      const why = json.error?.message ?? `HTTP ${res.status}`
      if (res.status === 401) throw new ReleaseError(`Le Cloud refuse le jeton (${why}) : il a peut-être expiré (1 h), génère-en un autre.`)
      if (res.status === 403) throw new ReleaseError(`Ce compte n’est pas administrateur de la plateforme (${why}).`)
      throw new ReleaseError(`Le Cloud a refusé la demande : ${why}`)
    }
    return json as T
  }
  const call = async <T>(p: string, init: RequestInit): Promise<T> => {
    let res: Response
    try {
      res = await fetchImpl(`${cloudUrl}${p}`, init)
    } catch (err) {
      throw new ReleaseError(`Atelier Cloud ne répond pas (${cloudUrl}) : ${err instanceof Error ? err.message : String(err)}`)
    }
    return read<T>(res)
  }
  return {
    get: (p) => call(p, { headers }),
    post: (p, body) => call(p, { method: 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    // streamed from the disk, never read whole; the length is declared so the Cloud can refuse a file that is too big before reading it
    upload: (p, file, size) =>
      call(p, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(size) },
        body: Readable.toWeb(createReadStream(file)) as unknown as BodyInit,
        duplex: 'half'
      } as RequestInit)
  }
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .once('error', reject)
      .once('end', () => resolve(hash.digest('hex')))
  })
}

/** The device login: prints a code, waits for the approval in the browser, answers the access token. */
export async function deviceLogin(cloudUrl: string, log: (s: string) => void, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = pkceChallenge(verifier, (s) => createHash('sha256').update(s).digest())
  const post = async (p: string, body: object): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await fetchImpl(`${cloudUrl}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const start = await post('/v1/auth/device/start', { codeChallenge: challenge, codeChallengeMethod: 'S256', deviceName: 'Commande de publication (npm run release)' })
  if (start.status !== 200) throw new ReleaseError(`Connexion impossible (HTTP ${start.status}).`)
  const { deviceCode, userCode, verificationUri, expiresIn, interval } = start.json as { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }
  log(`Connexion à Atelier Cloud : ouvre ${verificationUri} et approuve le code ${userCode} avec ton compte administrateur.`)
  const until = Date.now() + expiresIn * 1000
  while (Date.now() < until) {
    await sleep(Math.max(1, interval) * 1000)
    const poll = await post('/v1/auth/device/poll', { deviceCode, codeVerifier: verifier })
    if (poll.status === 200) return String(poll.json.accessToken)
    const code = (poll.json.error as { code?: string } | undefined)?.code
    if (code !== 'authorization_pending') throw new ReleaseError('La connexion a été refusée ou a expiré : recommence.')
  }
  throw new ReleaseError('La connexion a expiré : recommence.')
}

/** The whole command. Throws ReleaseError with a plain French message. */
export async function runRelease(o: ReleaseOptions, env: ReleaseEnv): Promise<ReleaseResult> {
  const { log } = env
  const fetchImpl = env.fetchImpl ?? fetch
  const version = readVersion(o.root)
  const names = expectedFiles(o.platform, version)
  const dir = distDir(o.root, o.platform)
  const feedUrl = updateFeedUrl(o.cloudUrl, o.channel, o.platform)
  log(`Version ${version} → canal ${o.channel}, plateforme ${o.platform}, sur ${o.cloudUrl}`)
  log(o.notes ? `Notes : ${o.notes}` : 'Notes : (aucune : ajoute --notes "…" pour dire aux testeurs ce qui change)')
  if (o.platform === 'mac') {
    log('macOS : la mise à jour automatique demande une app signée et un fichier .zip (voir docs/RELEASES.md).')
    if (!existsSync(path.join(dir, names[0] as string))) throw new ReleaseError(`Le fichier ${names[0]} manque dans ${dir} : sans .zip, une app Mac ne peut pas se mettre à jour toute seule.`)
  }

  // 1. is the version free? (the Cloud is only read here)
  let token = o.token
  if (!token && !o.dryRun) token = await (env.login ?? ((url: string) => deviceLogin(url, log, fetchImpl, env.sleep)))(o.cloudUrl)
  if (token) {
    const existing = await api(o.cloudUrl, token, fetchImpl).get<ReleaseListResponse>('/v1/admin/releases')
    const same = existing.releases.find((r) => r.version === version && r.channel === o.channel && r.platform === o.platform)
    if (same && same.state !== 'draft') {
      throw new ReleaseError(
        `La version ${version} existe déjà sur ${o.channel}/${o.platform} (${same.state === 'published' ? 'publiée' : 'retirée'}). Monte la version (npm version patch) puis recommence.`
      )
    }
    const top = existing.latest.find((l) => l.channel === o.channel && l.platform === o.platform)
    if (top && compareVersions(version, top.version) < 0) {
      log(`Attention : la version ${top.version} est déjà publiée et plus haute : les testeurs ne recevront pas la ${version}.`)
    }
    log(`Version libre sur ${o.channel}/${o.platform}${top ? ` (dernière publiée : ${top.version})` : ' (rien de publié pour l’instant)'}.`)
  } else {
    log('Vérification de la version auprès du Cloud : non faite (--dry-run sans ATELIER_ADMIN_TOKEN).')
  }

  // 2. the installer
  const build = env.build ?? npmBuild
  if (o.dryRun) log(o.skipBuild ? 'Construction : ignorée (--skip-build).' : `Construction : lancerait « npm run ${o.platform === 'win' ? 'dist' : 'dist:mac'} ».`)
  else if (o.skipBuild) log('Construction ignorée (--skip-build) : les fichiers de dist/ sont utilisés tels quels.')
  else {
    log('Construction de l’installeur…')
    await build(o.platform, o.root)
  }
  const found = names.filter((n) => existsSync(path.join(dir, n)))
  if (o.dryRun) {
    for (const n of names) log(`  ${found.includes(n) ? '✓' : '·'} ${n}${found.includes(n) ? ` (${(statSync(path.join(dir, n)).size / 1e6).toFixed(1)} Mo)` : ' (pas encore construit)'}`)
    log(`Enverrait ces fichiers, créerait le brouillon puis publierait. Flux des testeurs : ${feedUrl}/${o.platform === 'mac' ? 'latest-mac.yml' : 'latest.yml'}`)
    log('Rien n’a été modifié (--dry-run).')
    return { version, dryRun: true, releaseId: null, files: names, feedUrl }
  }
  if (!installerOf(o.platform, found)) throw new ReleaseError(`L’installeur ${names[0]} est introuvable dans ${dir}. La version de package.json correspond-elle à celle qui a été construite ?`)
  for (const n of found) {
    const size = statSync(path.join(dir, n)).size
    if (size > MAX_RELEASE_FILE_BYTES) throw new ReleaseError(`${n} fait ${(size / 1e6).toFixed(0)} Mo : le Cloud n’accepte pas plus de ${MAX_RELEASE_FILE_BYTES / 1024 / 1024} Mo par fichier.`)
  }

  // 3. draft + files, 4. publish
  const cloud = api(o.cloudUrl, token as string, fetchImpl)
  const draft = await cloud.post<Release>('/v1/admin/releases', { version, channel: o.channel, platform: o.platform, notes: o.notes })
  for (const n of found) {
    const file = path.join(dir, n)
    const size = statSync(file).size
    log(`Envoi de ${n} (${(size / 1e6).toFixed(1)} Mo)…`)
    const sha256 = await sha256File(file)
    await cloud.upload(`/v1/admin/releases/${draft.id}/files?name=${encodeURIComponent(n)}&sha256=${sha256}`, file, size)
  }
  const published = await cloud.post<Release>(`/v1/admin/releases/${draft.id}/publish`)
  log(`Publié : ${published.version} sur ${published.channel}/${published.platform}.`)
  log(`Les testeurs la reçoivent à leur prochaine vérification (au démarrage de l’app, puis toutes les 4 h) : ${feedUrl}`)
  return { version, dryRun: false, releaseId: published.id, files: found, feedUrl }
}

/** Reads the command line: `--channel`, `--platform`, `--notes`, `--notes-file`, `--cloud`, `--dry-run`, `--skip-build`. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv, root: string): ReleaseOptions {
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (!a.startsWith('--')) throw new ReleaseError(`Argument inattendu : ${a}`)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(a.slice(2), next)
      i++
    } else flags.set(a.slice(2), true)
  }
  const known = new Set(['channel', 'platform', 'notes', 'notes-file', 'cloud', 'dry-run', 'skip-build'])
  for (const k of flags.keys()) if (!known.has(k)) throw new ReleaseError(`Option inconnue : --${k}`)
  const text = (k: string): string | undefined => {
    const v = flags.get(k)
    if (v === true) throw new ReleaseError(`--${k} attend une valeur.`)
    return v
  }
  const channel = text('channel') ?? 'beta'
  if (!(RELEASE_CHANNELS as readonly string[]).includes(channel)) throw new ReleaseError(`Canal inconnu : ${channel} (beta ou stable).`)
  const platform = text('platform') ?? 'win'
  if (!(RELEASE_PLATFORMS as readonly string[]).includes(platform)) throw new ReleaseError(`Plateforme inconnue : ${platform} (win ou mac).`)
  const notesFile = text('notes-file')
  const notes = notesFile ? readFileSync(path.resolve(root, notesFile), 'utf8').trim() : (text('notes') ?? '')
  return {
    channel: channel as ReleaseChannel,
    platform: platform as ReleasePlatform,
    notes,
    cloudUrl: checkCloudUrl(text('cloud') ?? env.ATELIER_CLOUD_URL ?? 'http://127.0.0.1:8787'),
    dryRun: flags.get('dry-run') === true,
    skipBuild: flags.get('skip-build') === true,
    root,
    token: env.ATELIER_ADMIN_TOKEN?.trim() || undefined
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const log = (s: string): void => void process.stdout.write(s + '\n')
  try {
    await runRelease(parseArgs(process.argv.slice(2), process.env, root), { log })
  } catch (err) {
    process.stderr.write(`release : ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  }
}
