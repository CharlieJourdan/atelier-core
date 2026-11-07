// Archive FILM for a `stock.video` item of an archive pipeline (documentary-2): the film and the moment `planFilms` chose for it
// (visuals-film-plan.ts: archive search, Claude's pick, Claude's look at the reel), and only the needed seconds cut from it (ffmpeg reads
// the file over HTTP from that moment). A black stretch or a fade is skipped for the next seconds. No plan for the item: null (the caller
// flags a gap, never generates).
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { GENERATED_CLIP_MAX_SECONDS } from '../../shared/cloud-api'
import type { GenItem } from '../formats/editplan'
import type { Aspect } from '../formats/timing'
import { drawClip } from '../media/draw-video'
import type { RunCtx } from '../registry'
import { need } from '../services'
import type { MediaCandidate } from '../sourcing/types.ts'
import { probe } from '../media/probe'
import { ARCHIVE_USER_AGENT } from '../archive/http'
import type { FilmCut } from './visuals-film-plan'
import { downloadPlanned, type StockCredit } from './visuals-stock'
import type { ArchiveHit } from '../archive/types'

/** A clip darker than this (mean luma 0..255) is a black or a fade, brighter than that a burnt-out frame or a white leader: the next seconds are tried. */
const DARK_LUMA = 32
/** The version of how an archive film is cut (part of a film item's cache key: a fix re-cuts every film, never reuses an old cut). */
export const FILM_CUT_VERSION = 2
const BRIGHT_LUMA = 205

export interface FilmFound {
  file: string
  durationS: number
  credit: StockCredit
  /** A photograph standing in for the film (no film fits): shown as a still with a slow push. */
  still?: boolean
}

const creditOfFilm = (c: MediaCandidate): StockCredit => ({
  id: c.id,
  source: c.provider === 'internet-archive-video' ? 'internet-archive' : 'wikimedia',
  kind: 'video',
  title: c.title.slice(0, 200),
  creator: c.creator ?? '',
  creatorUrl: null,
  pageUrl: c.pageUrl,
  licence: c.licence.short,
  attribution: c.credit,
  attributionRequired: c.licence.attributionRequired
})

/**
 * The picture of a planned film item, in this order: a cut of its own film at its moment (or a little later when that moment is black);
 * its own photograph Claude chose (a full-frame still with a slow push, `still`); the film of the nearest item that has one, a dozen
 * seconds further (the reference's montages cut several moments of one reel). Null only when none of the three exists (a gap).
 */
export function filmFinder(
  ctx: RunCtx,
  o: { dir: string; plan: ReadonlyMap<string, readonly FilmCut[]>; photos?: ReadonlyMap<string, readonly ArchiveHit[]>; items?: readonly GenItem[] }
): ((item: GenItem) => Promise<FilmFound | null>) & { frame: (item: GenItem) => Promise<FilmFound | null> } {
  const media = need(ctx, 'media')
  const cutOf = async (item: GenItem, cuts: readonly FilmCut[]): Promise<FilmFound | null> => {
    const seconds = item.constraints.durationS + 0.6
    await mkdir(o.dir, { recursive: true })
    for (const cut of cuts) {
      for (const shift of [0, 7, -7, 15]) {
        const start = Math.max(0, Math.min(cut.lengthS - seconds - 0.3, cut.startS + shift))
        const out = path.join(o.dir, `${item.id}-${Math.round(start * 10)}.mp4`)
        try {
          await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', start.toFixed(2), '-user_agent', ARCHIVE_USER_AGENT, '-i', cut.film.fileUrl, '-t', seconds.toFixed(2), '-an', '-vf', "scale=-2:'min(1080,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out], { signal: ctx.signal })
          // a black stretch or a fade between reels is not a picture
          const stats = await media.run('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'select=not(mod(n\\,20)),signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { signal: ctx.signal }).catch(() => ({ stdout: Buffer.from(''), stderr: '' }))
          const lumas = [...`${stats.stdout.toString()}${stats.stderr}`.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
          const luma = lumas.length > 0 ? lumas.reduce((x, y) => x + y, 0) / lumas.length : 100
          if (luma < DARK_LUMA || luma > BRIGHT_LUMA) continue
          const info = await probe(media, out, ctx.signal)
          if (info.durationS < item.constraints.durationS * 0.6) continue
          return { file: out, durationS: info.durationS, credit: creditOfFilm(cut.film) }
        } catch (e) {
          if (ctx.signal.aborted) throw e
          ctx.emit({ kind: 'log', level: 'warn', text: `film « ${cut.film.title.slice(0, 60)} »: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` })
          break
        }
      }
    }
    return null
  }
  // the nearest film item that has a film: the same reel, a dozen seconds further on
  const nearCuts = (item: GenItem): FilmCut[] => {
    // (each item its own seconds: two items of one board never take the same frame)
    const at = (item.context.atS ?? 0) + [...item.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) / 37
    const near = (o.items ?? [])
      .filter((x) => x.id !== item.id && (o.plan.get(x.id) ?? []).length > 0)
      .sort((x, y) => Math.abs((x.context.atS ?? 0) - at) - Math.abs((y.context.atS ?? 0) - at))[0]
    return near ? (o.plan.get(near.id) ?? []).map((c) => ({ ...c, startS: Math.min(c.lengthS - 10, c.startS + 12 + (Math.abs(at - (near.context.atS ?? 0)) % 9)) })) : []
  }
  const find = async (item: GenItem): Promise<FilmFound | null> => {
    const own = await cutOf(item, o.plan.get(item.id) ?? [])
    if (own) return own
    const photo = await downloadPlanned(ctx, o.photos?.get(item.id) ?? [], o.dir)
    if (photo) return { file: photo.src, durationS: 0, credit: photo.credit, still: true }
    const cuts = nearCuts(item)
    return cuts.length > 0 ? cutOf(item, cuts) : null
  }
  // a photograph no archive gives: one frame of the nearest film (found media, of its time), never a picture repeated
  const frame = async (item: GenItem): Promise<FilmFound | null> => {
    const cuts = nearCuts(item)
    const clip = cuts.length > 0 ? await cutOf({ ...item, constraints: { ...item.constraints, durationS: 1 } }, cuts) : null
    if (!clip) return null
    const still = `${clip.file}.jpg`
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', '0.5', '-i', clip.file, '-frames:v', '1', '-q:v', '2', still], { signal: ctx.signal })
    return { file: still, durationS: 0, credit: clip.credit, still: true }
  }
  return Object.assign(find, { frame })
}

/** The seconds of a generated-video item, cut at the longest clip the provider makes. */
export const clipSeconds = (item: GenItem): number => Math.max(1, Math.min(GENERATED_CLIP_MAX_SECONDS, Math.ceil(item.constraints.durationS)))

/** What the director's picture prompt becomes for a moving shot. */
const videoPrompt = (prompt: string): string => `${prompt}. Slow, smooth camera movement, subtle natural motion, cinematic, no text on screen.`

/**
 * The clip of a video item: drawn from the item's picture (demo), found in the archives (an archive film, `film`: null when nothing fits),
 * or generated by the Cloud (run).
 */
export async function makeClip(
  ctx: RunCtx,
  item: GenItem,
  o: { prompt: string; key: string; still: string | null; tmpClip: string; jobDir: string; aspect: Aspect; drawn: boolean; film?: () => Promise<FilmFound | null> }
): Promise<{ file: string; demo: boolean; credit?: StockCredit; still?: boolean } | null> {
  const seconds = clipSeconds(item)
  if (o.drawn) {
    if (!o.still) throw new Error('a drawn clip starts from the drawn picture')
    await drawClip(need(ctx, 'media'), { still: o.still, out: o.tmpClip, seconds, aspect: o.aspect, signal: ctx.signal })
    return { file: o.tmpClip, demo: true }
  }
  if (o.film) {
    const f = await o.film()
    return f ? { file: f.file, demo: false, credit: f.credit, ...(f.still ? { still: true } : {}) } : null
  }
  const res = await need(ctx, 'cloud').generateVideo({ prompt: videoPrompt(o.prompt), seconds, aspect: o.aspect }, { idempotencyKey: `video-${o.key}`, signal: ctx.signal, dir: o.jobDir })
  const src = res.files[0]
  if (!src) throw new Error(`the Cloud returned no video for ${item.id}`)
  return { file: src, demo: res.demo }
}
