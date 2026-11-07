// The publication kit on the platform, app side (src/shared/cloud-kit.ts; PLAN-COMPLEXITE §E.5). Three jobs:
//   - SEND a finished run's package folder to Atelier Cloud (start, one call per file, complete), with the person's Cloud
//     session in the app, or with the team computer's own credential on a headless brain (no person's token there);
//   - ASK the Cloud for a video's kit (the texts and a short-lived link per file), always with the person's session: a
//     remote brain holds none, so the app (or the web page) asks, never the brain;
//   - SAVE a kit's files in the Downloads folder and show them.
// Atelier never uploads to YouTube. Nothing here logs or returns a token; a presigned link only reaches the screens that
// asked for the kit, and expires in minutes.
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MAX_UPLOAD_BYTES } from '../../shared/cloud-api'
import { KIT_FILE_NAME, Kit, KitFile, KitStartResponse, KitTexts, MAX_KIT_FILES, VideoRef } from '../../shared/cloud-kit'
import type { CloudKitDownload, CloudKitPublished, CloudKitState } from '../../shared/api'
import { CloudRefusal, cloudCaller, toEngine, UNREACHABLE } from '../../engine/cloud-http'
import { EngineError } from '../../engine/errors'
import type { SettingsStore } from '../settings'
import type { CloudApi } from './client'
import type { CloudSession } from './session'
import { plainCloudError } from './session'

/** Where a package is sent: the person's session (`/v1/team/…`) or a team computer's credential (`/v1/relay/machine/…`). */
export interface KitEndpoint {
  baseUrl: string
  token: () => string | Promise<string>
  machine: boolean
}

export const KIT_UPLOAD_SETTING = 'cloud.kitUpload'
/** This database's own id on the platform, made once: a video's kit is `<it>-<the video's id>`. */
export const KIT_SOURCE_SETTING = 'cloud.kitSource'

/**
 * The reference of a video's kit on the platform. A video's id is only unique in ONE database (the team computer's « 3 »
 * is not this app's « 3 »), so the ref carries the database's own id, made once and kept in its settings: two brains of a
 * team never replace each other's kits. Kits sent before (ref = the bare id) stay readable (`CloudKits.kit`).
 */
export function kitRef(settings: SettingsStore, videoId: number): string {
  let source = settings.get<string>(KIT_SOURCE_SETTING, '')
  if (typeof source !== 'string' || !/^[a-f0-9]{16}$/.test(source)) {
    source = randomBytes(8).toString('hex')
    settings.set(KIT_SOURCE_SETTING, source)
  }
  return `${source}-${videoId}`
}

/** The order files are sent in when a package holds more than a kit can: the ones people publish first. */
const PRIORITY = [/^video\./, /^thumbnail\./, /^description\./, /^metadata\./, /^captions\./, /^checklist\./]
const rank = (name: string): number => {
  const i = PRIORITY.findIndex((r) => r.test(name))
  return i < 0 ? PRIORITY.length : i
}

const TIMEOUT_MS = 30_000

const MSG = {
  noVideo: 'Le paquet ne contient pas de vidéo à envoyer.',
  tooBig: 'La vidéo dépasse 512 Mo : elle reste sur l’ordinateur d’équipe (ouvre le dossier pour la prendre).',
  noEndpoint: 'Ni connexion à Atelier Cloud ni ordinateur d’équipe relié : le kit reste sur cet ordinateur.',
  noFolder: 'Le dossier du paquet n’existe plus sur ce disque.'
} as const

/** What `metadata.json` of the package says, as the kit's texts (every field optional in the file). */
export function textsFromMetadata(raw: unknown, fallbackTitle: string): KitTexts {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const strings = (v: unknown, max: number, n: number): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.slice(0, max)).slice(0, n) : []
  const chapters = Array.isArray(m.chapters)
    ? m.chapters
        .filter((c): c is { at: number; title: string } => !!c && typeof (c as { at?: unknown }).at === 'number' && typeof (c as { title?: unknown }).title === 'string' && (c as { title: string }).title.length > 0)
        .map((c) => ({ at: Math.max(0, c.at), title: c.title.slice(0, 120) }))
        .slice(0, 80)
    : []
  return KitTexts.parse({
    title: (typeof m.title === 'string' && m.title.trim() ? m.title : fallbackTitle).slice(0, 200),
    alternatives: strings(m.alternatives, 200, 6),
    description: typeof m.description === 'string' ? m.description.slice(0, 5000) : '',
    tags: strings(m.tags, 60, 40),
    chapters,
    language: typeof m.language === 'string' && m.language.length >= 2 ? m.language.slice(0, 12) : 'fr',
    demo: m.demo === true
  })
}

/** The files of a package folder that go in a kit: plain names, at most MAX_KIT_FILES, the publishable ones first. */
async function packageFiles(dir: string): Promise<{ name: string; path: string; size: number }[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    throw new Error(MSG.noFolder)
  }
  const out: { name: string; path: string; size: number }[] = []
  for (const name of entries) {
    if (!KIT_FILE_NAME.test(name)) continue
    const st = await stat(path.join(dir, name)).catch(() => null)
    if (st?.isFile()) out.push({ name, path: path.join(dir, name), size: st.size })
  }
  return out.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)).slice(0, MAX_KIT_FILES)
}

/** French message of a Cloud refusal or an unreachable Cloud (never a raw error object). */
function plain(e: unknown): Error {
  const p = plainCloudError(e)
  return p instanceof Error ? p : new Error(String(p))
}

/** Sends the package folder of a video to the platform. Throws a French message; nothing partial becomes the video's kit. */
export async function uploadPackage(
  endpoint: KitEndpoint,
  videoRef: string,
  dir: string,
  fallbackTitle: string,
  fetchImpl?: typeof fetch,
  /** The finished video's length (the founder console counts finished minutes with it). */
  durationS: number | null = null
): Promise<CloudKitPublished> {
  const files = await packageFiles(dir)
  if (!files.some((f) => /^video\./.test(f.name))) throw new Error(MSG.noVideo)
  const video = files.find((f) => /^video\./.test(f.name))
  if (video && video.size > MAX_UPLOAD_BYTES) throw new Error(MSG.tooBig)
  let metadata: unknown = null
  try {
    metadata = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf8'))
  } catch {
    // no readable metadata: the video's own title and an empty description
  }
  const texts = { ...textsFromMetadata(metadata, fallbackTitle), durationS }
  const caller = cloudCaller({ baseUrl: endpoint.baseUrl, token: endpoint.token, ...(fetchImpl ? { fetchImpl } : {}) })
  const prefix = endpoint.machine ? '/v1/relay/machine/videos' : '/v1/team/videos'
  const base = `${prefix}/${encodeURIComponent(videoRef)}/kit`
  const signal = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS)
  try {
    const started = await caller.raw('POST', base, KitStartResponse, signal(), texts)
    let bytes = 0
    let sent = 0
    for (const f of files) {
      if (f.size > MAX_UPLOAD_BYTES) continue // a file too big for one request stays on the machine
      const body = await readFile(f.path)
      const query = new URLSearchParams({ name: f.name, sha256: createHash('sha256').update(body).digest('hex') })
      const res = await caller.fetch(`${endpoint.baseUrl}${base}/${encodeURIComponent(started.kitId)}/files?${query.toString()}`, {
        method: 'POST',
        // a video takes longer than a JSON call: a minute per 50 MB at least, and never less than the default
        signal: AbortSignal.timeout(Math.max(TIMEOUT_MS, Math.ceil(body.byteLength / (50 * 1024 * 1024)) * 60_000)),
        headers: { authorization: `Bearer ${await endpoint.token()}`, 'content-type': 'application/octet-stream' },
        body
      })
      if (!res.ok) throw await refusal(res)
      KitFile.parse(await res.json())
      bytes += body.byteLength
      sent++
    }
    await caller.raw('POST', `${base}/${encodeURIComponent(started.kitId)}/complete`, Kit, signal(), undefined)
    return { files: sent, bytes }
  } catch (e) {
    throw plain(e instanceof CloudRefusal ? toEngine(e) : e)
  }
}

async function refusal(res: Response): Promise<CloudRefusal> {
  let code = `http_${res.status}`
  try {
    const err = ((await res.json()) as { error?: { code?: unknown } }).error
    if (typeof err?.code === 'string') code = err.code
  } catch {
    // the status says enough
  }
  return new CloudRefusal(res.status, code)
}

const safeFolder = (title: string): string => title.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'video'

export interface CloudKitsOptions {
  session: CloudSession
  api: CloudApi
  settings: SettingsStore
  /** A team computer's own link to the Cloud (headless brain): read each time, it may be enrolled after start-up. */
  machine?: () => { baseUrl: string; credential: string } | null
  fetchImpl?: typeof fetch
  /** The Downloads folder; none on a machine without a screen. */
  downloadsDir?: () => string | null
  /** Shows a folder (Electron's `shell.openPath`: '' when done, else an error text). */
  opener?: (dir: string) => Promise<string>
  /** The package of a run: which video, which folder, the video's title. Null when it has none (yet). */
  packageOf: (runId: number) => { videoId: number; packageDir: string; title: string; durationS?: number | null } | null
  log?: (line: string) => void
}

export class CloudKits {
  private readonly o: CloudKitsOptions
  /** Sending in progress, per video: a package is never sent twice at once. */
  private readonly sending = new Map<number, Promise<CloudKitPublished>>()
  constructor(o: CloudKitsOptions) {
    this.o = o
  }

  /** Where a package would go now: the person's session, else this team computer's credential, else nowhere. */
  endpoint(): KitEndpoint | null {
    if (this.o.session.connected()) return { baseUrl: this.o.session.baseUrl(), token: () => this.o.session.token(), machine: false }
    const link = this.o.machine?.()
    return link ? { baseUrl: link.baseUrl, token: () => link.credential, machine: true } : null
  }

  autoUpload(): boolean {
    return this.o.settings.get<boolean>(KIT_UPLOAD_SETTING, true) !== false
  }

  /** A run just finished its package (called by the production runs): sends it unless turned off or nowhere to send to. */
  onPackage(e: { runId: number; videoId: number; packageDir: string; title: string; durationS?: number | null }): void {
    if (!this.autoUpload() || !this.endpoint()) return
    void this.send(e.videoId, e.packageDir, e.title, e.durationS ?? null).catch((err: unknown) => this.o.log?.(`Kit non envoyé à Atelier Cloud : ${err instanceof Error ? err.message : String(err)}`))
  }

  /** Sends the package of a run now (the button « Envoyer sur la plateforme »). Throws a French message. */
  publishRun(runId: unknown): Promise<CloudKitPublished> {
    if (typeof runId !== 'number' || !Number.isInteger(runId)) return Promise.reject(new Error('runId must be an integer'))
    const pkg = this.o.packageOf(runId)
    if (!pkg) return Promise.reject(new Error('Cette fabrication n’a pas encore de paquet.'))
    return this.send(pkg.videoId, pkg.packageDir, pkg.title, pkg.durationS ?? null)
  }

  /** The platform reference of one of THIS database's videos (`cloud.kitRef`: asked of the brain that holds the video). */
  ref(videoId: unknown): string {
    if (typeof videoId !== 'number' || !Number.isInteger(videoId) || videoId < 0) throw new Error('videoId must be an integer')
    return kitRef(this.o.settings, videoId)
  }

  private send(videoId: number, dir: string, title: string, durationS: number | null): Promise<CloudKitPublished> {
    const running = this.sending.get(videoId)
    if (running) return running
    const endpoint = this.endpoint()
    if (!endpoint) return Promise.reject(new Error(MSG.noEndpoint))
    const p = uploadPackage(endpoint, this.ref(videoId), dir, title, this.o.fetchImpl, durationS).finally(() => this.sending.delete(videoId))
    this.sending.set(videoId, p)
    return p
  }

  /**
   * The video's kit with fresh links. Needs the person's session (a machine credential cannot read kits). `ref`: the
   * video's platform reference given by the brain that holds it (a team computer's); without it, this database's own.
   * A kit sent before the references carried a database id (ref = the bare video id) is read when there is no other.
   */
  async kit(videoId: unknown, ref?: unknown): Promise<CloudKitState> {
    if (typeof videoId !== 'number' || !Number.isInteger(videoId)) throw new Error('videoId must be an integer')
    if (!this.o.session.connected()) return { status: 'not-connected' }
    const wanted = typeof ref === 'string' && VideoRef.safeParse(ref).success ? ref : this.ref(videoId)
    try {
      const kit = (await this.o.api.kit(wanted)) ?? (await this.o.api.kit(String(videoId)))
      return kit ? { status: 'ok', kit } : { status: 'none' }
    } catch (e) {
      if (e instanceof EngineError && e.code === 'missing_tool') return { status: 'not-connected' }
      if (e instanceof EngineError && e.message.startsWith(UNREACHABLE)) return { status: 'unreachable' }
      if (e instanceof EngineError && e.code === 'transient') return { status: 'unreachable' }
      throw e
    }
  }

  /** Saves one file of the kit (all of them without a name) in `<Downloads>/Atelier/<title>/` and shows the folder. */
  async download(videoId: unknown, name?: unknown, ref?: unknown): Promise<CloudKitDownload> {
    const state = await this.kit(videoId, ref)
    if (state.status !== 'ok') throw new Error(state.status === 'none' ? 'Ce kit n’est plus sur la plateforme.' : 'Atelier Cloud est injoignable ou l’app n’y est pas connectée.')
    const downloads = this.o.downloadsDir?.()
    if (!downloads) throw new Error('Pas de dossier Téléchargements ici.')
    const wanted = typeof name === 'string' ? state.kit.files.filter((f) => f.name === name) : state.kit.files
    if (wanted.length === 0) throw new Error('Ce fichier n’est pas dans le kit.')
    const dir = path.join(downloads, 'Atelier', safeFolder(state.kit.title))
    await mkdir(dir, { recursive: true })
    const doFetch = this.o.fetchImpl ?? fetch
    for (const f of wanted) {
      const dest = path.join(dir, f.name)
      const part = `${dest}.part`
      try {
        // the link goes straight to the storage service: no Atelier token is sent with it
        const res = await doFetch(f.url, { signal: AbortSignal.timeout(30 * 60_000) })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part))
        await rename(part, dest)
      } catch (e) {
        await rm(part, { force: true })
        throw new Error(`Le fichier ${f.name} n’a pas pu être téléchargé (${e instanceof Error ? e.message : String(e)}).`, { cause: e })
      }
    }
    if (this.o.opener) await this.o.opener(dir).catch(() => undefined)
    return { saved: wanted.map((f) => f.name), dir }
  }
}
