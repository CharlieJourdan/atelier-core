// A channel's clip library (clone-reddit-shorts, research note style-redditchroniques-2026-11 (old repository)): the folder of short vertical clips a
// background pipeline (`background.clips@1`, the « Histoire Reddit » base) cuts its pictures from, and the channel's round avatar its
// post card shows. Made ONCE per channel, never at production time: free stock videos found through Atelier Cloud (Pexels, about
// 0.002 $ a search, the licence and the credit line kept in `credits.json`) and/or the owner's own clips, each normalised here to
// 1080×1920, 30 fps, silent H.264 of at most `MAX_CLIP_S` seconds, so a video's run only cuts pieces (seconds, no network, 0 $).
// A run of the channel whose pipeline reads `gameplay`, `channelAvatar` or `channel` and was given none takes the folder, the avatar and
// the channel's name (`inputFor`). Files live under `<userData>/channel-media/<channelId>/`.
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { CLIP_EXTENSIONS } from '../../../engine/nodes/background-clips'
import { probe } from '../../../engine/media/probe'
import type { CloudService, MediaService } from '../../../engine/services'
import type { ChannelClipsView, ClipLibrarySource } from '../../../shared/channel-clips'
import type { Db } from '../../db'
import { COMMONS_USER_AGENT, searchCommonsVideos } from './commons'

/** The longest stretch kept of a clip: a story short shows ~2.3 s of each, the rest is spare for other places in other videos. */
export const MAX_CLIP_S = 14
/** The « satisfying » searches of a story channel's library (measured: factory, food and craft processes, close and steady). */
export const SATISFYING_QUERIES: readonly string[] = [
  'factory machine production',
  'manufacturing process close up',
  'cnc machine cutting',
  'hydraulic press',
  'metal lathe turning',
  'welding sparks',
  'food factory production line',
  'cake decorating',
  'chocolate making',
  'pottery wheel',
  'woodworking',
  'paint mixing',
  'pressure washing',
  'soap cutting',
  'glass blowing',
  'blacksmith forging',
  'conveyor belt factory',
  'textile factory sewing',
  'noodles making',
  'bakery dough'
]
/** Commons titles that are never a process to watch (interviews, talks, news, old films, maps). */
const OFF_TOPIC = /\b(interview|entrevista|entretien|speech|talk|conference|lecture|news|trailer|campaign|minister|president|map|animation|1[89]\d\d)\b/i
/** A clip whose frames change less than this (signalstats YDIF, mean) is a talking head or a still view. */
const MIN_MOTION = 2
/** A clip whose colour is weaker than this (SATAVG, mean) is a black-and-white film. */
const MIN_SATURATION = 5

/** Commons' search reads every word as required: one or two words each (« factory machine production » finds almost nothing). */
export const COMMONS_QUERIES: readonly string[] = [
  'cnc', 'pottery wheel', 'welding', 'conveyor', 'forging', 'glassblowing', 'lathe', 'sawmill', 'woodturning', 'blacksmith',
  'milling machine', 'assembly line', 'chocolate factory', 'bottling', 'laser cutting', 'injection molding', 'knitting machine', 'loom',
  '3D printer', 'robot welding', 'factory machine', 'bakery machine', 'printing press', 'cutting machine', 'packaging machine'
]
const AVATAR_NAMES = ['avatar.png', 'avatar.jpg', 'avatar.webp']
const MUSIC_NAMES = ['music.mp3', 'music.m4a', 'music.wav', 'music.flac', 'music.ogg']

interface Credit {
  id: string
  file: string
  source: string
  query: string
  creator: string
  pageUrl: string | null
  licence: string
  attribution: string
}

export interface ChannelClipsOptions {
  db: Db
  /** `<userData>/channel-media`. */
  dir: string
  media: MediaService | null
  /** Atelier Cloud while signed in (the stock searches), else null. */
  cloud: () => CloudService | null
  notify?: () => void
  fetchImpl?: typeof fetch
  /** The pause between two files read from Wikimedia (default 2.5 s; a 429 waits 24 times longer). */
  pauseMs?: number
}

export class ChannelClips {
  constructor(private readonly o: ChannelClipsOptions) {}

  private channel(channelId: unknown): { id: number; name: string } {
    const id = Number(channelId)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Chaîne invalide.')
    const row = this.o.db.prepare('SELECT id, name FROM channels WHERE id = ?').get(id) as { id: number; name: string } | undefined
    if (!row) throw new Error('Cette chaîne n’existe pas.')
    return row
  }

  /** The channel's clip folder (made when first asked). */
  folder(channelId: number): string {
    return path.join(this.o.dir, String(channelId), 'clips')
  }

  private avatarOf(channelId: number): string | null {
    const dir = path.join(this.o.dir, String(channelId))
    for (const n of AVATAR_NAMES) if (existsSync(path.join(dir, n))) return path.join(dir, n)
    return null
  }

  /** A short key of this installation's media folder: two computers of one team both have a « channel 2 », and the Cloud keys a job by its text. */
  private installKey(): string {
    return createHash('sha256').update(this.o.dir).digest('hex').slice(0, 8)
  }

  private musicOf(channelId: number): string | null {
    const dir = path.join(this.o.dir, String(channelId))
    for (const n of MUSIC_NAMES) if (existsSync(path.join(dir, n))) return path.join(dir, n)
    return null
  }

  private async credits(channelId: number): Promise<Credit[]> {
    try {
      return JSON.parse(await readFile(path.join(this.folder(channelId), 'credits.json'), 'utf8')) as Credit[]
    } catch {
      return []
    }
  }

  async view(channelId: unknown): Promise<ChannelClipsView> {
    const ch = this.channel(channelId)
    const folder = this.folder(ch.id)
    const names = existsSync(folder) ? (await readdir(folder)).filter((n) => (CLIP_EXTENSIONS as readonly string[]).includes(path.extname(n).toLowerCase())) : []
    const credits = await this.credits(ch.id)
    const stock = new Set(credits.map((c) => c.file))
    return {
      channelId: ch.id,
      folder,
      clips: names.length,
      fromStock: names.filter((n) => stock.has(n)).length,
      own: names.filter((n) => !stock.has(n)).length,
      avatar: this.avatarOf(ch.id),
      music: this.musicOf(ch.id)
    }
  }

  /** Normalises one clip into the library: cover-cropped 1080×1920, 30 fps, silent, at most MAX_CLIP_S seconds from `fromS`. */
  private async normalise(input: string, out: string, signal: AbortSignal, fromS = 0.5): Promise<void> {
    const media = this.o.media
    if (!media) throw new Error('ffmpeg est introuvable sur cet ordinateur : la bibliothèque de clips en a besoin.')
    const vf = 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,format=yuv420p,setsar=1'
    await media.run('ffmpeg', ['-v', 'error', '-y', ...(/^https?:/.test(input) ? ['-user_agent', COMMONS_USER_AGENT] : []), '-ss', fromS.toFixed(2), '-i', input, '-t', String(MAX_CLIP_S), '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-movflags', '+faststart', out], { signal })
    // ffmpeg may end « successfully » on a stream that closed early: a clip under 2 s (or none) is not kept
    const info = await probe(media, out, signal).catch(() => null)
    if (!info || info.durationS < 2) {
      await rm(out, { force: true })
      throw new Error(`clip illisible : ${path.basename(input)}`)
    }
  }

  /**
   * Fills the library from free stock videos (portrait, through Atelier Cloud): `count` per search (at most 10), the searches given or
   * the « satisfying » ones. A video already in the library is skipped. Returns what the library now holds.
   */
  async fromStock(channelId: unknown, req: { queries?: readonly string[]; count?: number; source?: 'cloud' | 'commons' } = {}): Promise<ChannelClipsView & { added: number; credits: number; failed?: string[] }> {
    if (req.source === 'commons') return { ...(await this.fromCommons(channelId, req)), credits: 0 }
    const ch = this.channel(channelId)
    const cloud = this.o.cloud()
    if (!cloud) throw new Error('Connecte-toi à Atelier Cloud pour chercher des clips libres de droits.')
    const queries = (req.queries?.length ? req.queries : SATISFYING_QUERIES).map((q) => String(q).trim()).filter(Boolean).slice(0, 40)
    const count = Math.max(1, Math.min(10, Math.round(req.count ?? 8)))
    const folder = this.folder(ch.id)
    await mkdir(folder, { recursive: true })
    const credits = await this.credits(ch.id)
    const known = new Set(credits.map((c) => c.id))
    const tmp = path.join(this.o.dir, String(ch.id), 'download')
    await mkdir(tmp, { recursive: true })
    const signal = new AbortController().signal
    let added = 0
    let spent = 0
    const failed: string[] = []
    for (const query of queries) {
      // a search the provider refuses (a rate limit: Pixabay's 429 after a dozen downloads) is waited out once, then left for the next
      // call; the library keeps what it has (every search is idempotent: the same words are never paid twice)
      let r: Awaited<ReturnType<CloudService['searchStock']>> | null = null
      for (let attempt = 0; attempt < 2 && r === null; attempt++) {
        try {
          r = await cloud.searchStock({ query, orientation: 'portrait', kind: 'video', count }, { idempotencyKey: `clips-real-${this.installKey()}-${ch.id}-${query}-${count}`, signal, dir: tmp })
        } catch (e) {
          if (/demo|démonstration/i.test(String(e instanceof Error ? e.message : e))) throw e
          if (attempt === 0) await new Promise((res) => setTimeout(res, this.o.pauseMs ? this.o.pauseMs * 12 : 30_000))
        }
      }
      if (r === null) {
        failed.push(query)
        continue
      }
      spent += r.credits ?? 0
      if (r.demo) throw new Error('Atelier Cloud répond en démonstration : aucun vrai clip n’a été trouvé.')
      for (const hit of r.results) {
        if (known.has(hit.id) || hit.height <= hit.width) continue
        const file = `${hit.id.replace(/[^\w-]/g, '_')}.mp4`
        try {
          await this.normalise(hit.file, path.join(folder, file), signal)
        } catch {
          continue // a file that will not play is skipped
        }
        known.add(hit.id)
        credits.push({ id: hit.id, file, source: hit.source, query, creator: hit.creator, pageUrl: hit.pageUrl, licence: hit.licence, attribution: hit.attribution })
        added++
      }
      await writeFile(path.join(folder, 'credits.json'), JSON.stringify(credits, null, 1), 'utf8')
    }
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    this.o.notify?.()
    return { ...(await this.view(ch.id)), added, credits: spent, ...(failed.length > 0 ? { failed } : {}) }
  }

  /**
   * Reads from Wikimedia's media servers gently: a pause between files, and on « 429 Too Many Requests » a longer wait then again
   * (three tries). Measured: about forty files read back to back are refused for a few minutes.
   */
  private async politely(read: () => Promise<void>): Promise<void> {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    for (let attempt = 0; ; attempt++) {
      await wait(this.o.pauseMs ?? 2500)
      try {
        return await read()
      } catch (e) {
        if (attempt >= 2 || !/429|Too Many Requests/i.test(String(e instanceof Error ? e.message : e))) throw e
        await wait((this.o.pauseMs ?? 2500) * 24 * (attempt + 1))
      }
    }
  }

  /**
   * How a clip looks over its length: its mean colour saturation and its mean change between frames (ffmpeg signalstats on a small
   * copy). A « satisfying » process moves; a talking head or a still view hardly does, an old film has no colour.
   */
  private async looks(file: string, signal: AbortSignal): Promise<{ saturation: number; motion: number }> {
    const media = this.o.media
    if (!media) return { saturation: 100, motion: 100 }
    const r = await media.run('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=270:480,signalstats,metadata=print:file=-', '-f', 'null', '-'], { signal })
    const mean = (key: string): number => {
      const v = [...r.stdout.toString('utf8').matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`, 'g'))].map((m) => Number(m[1]))
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
    }
    return { saturation: mean('SATAVG'), motion: mean('YDIF') }
  }

  /**
   * Fills the library from Wikimedia Commons' free videos (no key, no Cloud, 0 $): `count` per search, the centre of a landscape video
   * cropped to 9:16, a stretch read from a fifth of the way in (the openings are often titles). The licence and credit line go in
   * `credits.json`.
   */
  async fromCommons(channelId: unknown, req: { queries?: readonly string[]; count?: number } = {}): Promise<ChannelClipsView & { added: number }> {
    const ch = this.channel(channelId)
    const queries = (req.queries?.length ? req.queries : COMMONS_QUERIES).map((q) => String(q).trim()).filter(Boolean).slice(0, 40)
    const count = Math.max(1, Math.min(10, Math.round(req.count ?? 6)))
    const folder = this.folder(ch.id)
    await mkdir(folder, { recursive: true })
    const credits = await this.credits(ch.id)
    const known = new Set(credits.map((c) => c.id))
    const signal = new AbortController().signal
    let added = 0
    for (const query of queries) {
      // one search a second at most: the public API asks anonymous callers to stay gentle
      if (queries.indexOf(query) > 0) await new Promise((r) => setTimeout(r, 1000))
      const hits = await searchCommonsVideos(query, count, this.o.fetchImpl)
      for (const hit of hits) {
        if (known.has(hit.id) || OFF_TOPIC.test(hit.title)) continue
        const file = `${hit.id.replace(/[^\w-]/g, '_')}.mp4`
        const out = path.join(folder, file)
        const read = (): Promise<void> => this.normalise(hit.url, out, signal, Math.min(hit.durationS * 0.2, Math.max(0, hit.durationS - MAX_CLIP_S)))
        try {
          await this.politely(read)
        } catch {
          continue // a transcode that will not play is skipped
        }
        // measured on the first library: interviews and still views change by < 2 a frame, the processes by 2.3–15; old films are grey
        const look = await this.looks(out, signal)
        if (look.motion < MIN_MOTION || look.saturation < MIN_SATURATION) {
          await rm(out, { force: true })
          continue
        }
        known.add(hit.id)
        credits.push({ id: hit.id, file, source: 'wikimedia', query, creator: hit.creator, pageUrl: hit.pageUrl, licence: hit.licence, attribution: `« ${hit.title} », ${hit.creator}, ${hit.licence}, Wikimedia Commons` })
        added++
      }
      await writeFile(path.join(folder, 'credits.json'), JSON.stringify(credits, null, 1), 'utf8')
    }
    this.o.notify?.()
    return { ...(await this.view(ch.id)), added }
  }

  /** Adds the owner's own clips (full paths): each normalised into the library. */
  async addFiles(channelId: unknown, files: unknown): Promise<ChannelClipsView & { added: number }> {
    const ch = this.channel(channelId)
    if (!Array.isArray(files) || files.length === 0 || files.length > 500) throw new Error('Donne de 1 à 500 fichiers vidéo.')
    const folder = this.folder(ch.id)
    await mkdir(folder, { recursive: true })
    const signal = new AbortController().signal
    let added = 0
    for (const f of files) {
      if (typeof f !== 'string' || !path.isAbsolute(f) || !(CLIP_EXTENSIONS as readonly string[]).includes(path.extname(f).toLowerCase())) throw new Error(`Fichier vidéo invalide : ${String(f)}`)
      if (!(await stat(f)).isFile()) throw new Error(`Introuvable : ${f}`)
      await this.normalise(f, path.join(folder, `own-${String(Date.now())}-${added}.mp4`), signal)
      added++
    }
    this.o.notify?.()
    return { ...(await this.view(ch.id)), added }
  }

  /** The round picture beside the channel's name on the post card (png, jpg or webp). */
  async setAvatar(channelId: unknown, file: unknown): Promise<ChannelClipsView> {
    const ch = this.channel(channelId)
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Donne le chemin complet de l’image.')
    const ext = path.extname(file).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('L’image doit être un png, un jpg ou un webp.')
    const dir = path.join(this.o.dir, String(ch.id))
    await mkdir(dir, { recursive: true })
    for (const n of AVATAR_NAMES) await rm(path.join(dir, n), { force: true })
    await copyFile(file, path.join(dir, `avatar${ext === '.jpeg' ? '.jpg' : ext}`))
    this.o.notify?.()
    return this.view(ch.id)
  }

  /** The channel's own music under its story shorts (an mp3, m4a, wav, flac or ogg), looped and ducked under the voice. */
  async setMusic(channelId: unknown, file: unknown): Promise<ChannelClipsView> {
    const ch = this.channel(channelId)
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Donne le chemin complet du morceau.')
    const ext = path.extname(file).toLowerCase()
    if (!MUSIC_NAMES.some((n) => n.endsWith(ext))) throw new Error('Le morceau doit être un mp3, un m4a, un wav, un flac ou un ogg.')
    if (!(await stat(file)).isFile()) throw new Error(`Introuvable : ${file}`)
    const dir = path.join(this.o.dir, String(ch.id))
    await mkdir(dir, { recursive: true })
    for (const n of MUSIC_NAMES) await rm(path.join(dir, n), { force: true })
    await copyFile(file, path.join(dir, `music${ext}`))
    this.o.notify?.()
    return this.view(ch.id)
  }

  /** What a run of the channel takes when its pipeline reads one of these inputs and was given none. */
  inputFor(channelId: number, input: string): string | null {
    if (input === 'gameplay') {
      const folder = this.folder(channelId)
      return existsSync(folder) ? folder : null
    }
    if (input === 'channelAvatar') return this.avatarOf(channelId)
    if (input === 'channelMusic') return this.musicOf(channelId)
    if (input === 'channel') {
      const row = this.o.db.prepare('SELECT name FROM channels WHERE id = ?').get(channelId) as { name: string } | undefined
      return row?.name ?? null
    }
    return null
  }
}

export type { ClipLibrarySource }
