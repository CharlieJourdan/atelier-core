// The blocking checks on the rendered picture (controles-bloquants, decision 0102): black stretches (`blackdetect`), and the same
// picture shown twice, measured on the FILM itself — one 32×18 grey thumbnail from the middle of every picture or film shot, compared
// with the shots of the minute before. The plan's own duplicate check compares the files the shots come from; this one sees what the
// viewer sees (two different files of the same print, a film whose frames look alike, the Japanese example's hand on a handle twice).
// Drawn cards and the presenter are left out: cards of one template share their background, a presenter is meant to come back; so are
// the shots the render did not compare (a demo drawing has no thumbnail in `seen`) and two shots of one continuing clip side by side.
// The detectors are pure; the measures are one ffmpeg run each.
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { EditPlan, Shot } from '../formats/editplan'
import { FPS } from '../formats/timing'
import type { MediaService } from '../services'
import { likeness } from '../nodes/visuals-checks'
import type { SeenShot } from './checks'
import { fmtS, type Defect, type Patch } from './types'

export interface FilmLimits {
  /** A black stretch at least this long (seconds) is an error. */
  blackMinS: number
  /** Two shots within this many seconds are compared. */
  duplicateWindowS: number
  /** Thumbnails at least this alike are the same picture (stricter than the plan's 0.9: these are the film's own frames). */
  duplicateLikeness: number
}

export const FILM_LIMITS: FilmLimits = { blackMinS: 0.4, duplicateWindowS: 60, duplicateLikeness: 0.97 }

const r2 = (x: number): number => Math.round(x * 100) / 100

/** Black stretches from `blackdetect` lines. */
export function parseBlackStretches(stderr: string): { start: number; end: number }[] {
  return [...stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }))
}

/** Each black stretch of at least `minS` as a defect (a fade of a few frames is not one). */
export function blackDefects(stretches: readonly { start: number; end: number }[], minS = FILM_LIMITS.blackMinS): Defect[] {
  return stretches
    .filter((b) => b.end - b.start >= minS)
    .map((b) => ({ kind: 'black' as const, severity: 'fail' as const, atS: r2(b.start), endS: r2(b.end), detail: `Image noire de ${fmtS(b.start)} à ${fmtS(b.end)} (${(b.end - b.start).toFixed(1)} s).` }))
}

export async function measureBlack(media: MediaService, film: string, minS: number, signal: AbortSignal): Promise<{ start: number; end: number }[]> {
  const r = await media.run('ffmpeg', ['-v', 'info', '-i', film, '-an', '-vf', `scale=320:-2,blackdetect=d=${minS}:pic_th=0.98:pix_th=0.06`, '-f', 'null', '-'], { signal })
  return parseBlackStretches(r.stderr)
}

/** The base shots whose picture can repeat by mistake: pictures and films (not drawn cards, not the presenter). */
export const comparable = (s: Shot): boolean => s.kind !== 'motion' && s.kind !== 'avatar'

export interface FilmThumb {
  shotId: string
  grey: readonly number[]
}

/**
 * The same picture again within a minute, on the film's thumbnails. `dropFor` gives the fix the plan allows for a shot (a neighbour
 * takes its time), so a repeat is repaired like the plan's own duplicates; shots the plan already found are skipped (`known`).
 */
export function frameDuplicates(plan: EditPlan, thumbs: readonly FilmThumb[], o: { known?: ReadonlySet<string>; dropFor?: (shotId: string) => Patch | undefined; limits?: Partial<FilmLimits>; seen?: readonly SeenShot[] } = {}): Defect[] {
  const L = { ...FILM_LIMITS, ...o.limits }
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const seen = o.seen ? new Map(o.seen.map((x) => [x.id, x])) : null
  // only the real pictures the render compares itself (its `seen` thumbnails), when it says which
  const grey = new Map(thumbs.filter((t) => !seen || seen.get(t.shotId)?.grey !== undefined).map((t) => [t.shotId, t.grey]))
  const base = plan.tracks.base.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined && comparable(s))
  const out: Defect[] = []
  const gone = new Set<string>()
  for (const [i, s] of base.entries()) {
    const me = grey.get(s.id)
    if (!me || o.known?.has(s.id)) continue
    for (let j = i - 1; j >= 0; j--) {
      const other = base[j] as Shot
      if (s.startFrame / FPS - other.endFrame / FPS > L.duplicateWindowS) break
      const them = grey.get(other.id)
      if (!them || gone.has(other.id)) continue
      // two shots of one clip side by side continue one action
      const g1 = seen?.get(s.id)?.group
      if (other.endFrame === s.startFrame && ((other.genItem !== undefined && other.genItem === s.genItem) || (g1 !== undefined && g1 === seen?.get(other.id)?.group))) continue
      if (likeness(me, them) < L.duplicateLikeness) continue
      const fix = o.dropFor?.(s.id)
      if (fix) gone.add(s.id)
      out.push({
        kind: 'duplicate',
        severity: 'fail',
        atS: r2(s.startFrame / FPS),
        endS: r2(s.endFrame / FPS),
        shotId: s.id,
        detail: `La vidéo remontre à ${fmtS(s.startFrame / FPS)} la même image qu’à ${fmtS(other.startFrame / FPS)}.`,
        ...(fix ? { fix } : {})
      })
      break
    }
  }
  return out
}

/** One 32×18 grey thumbnail from the middle of each comparable base shot of the film. */
export async function filmThumbs(media: MediaService, film: string, plan: EditPlan, dir: string, signal: AbortSignal): Promise<FilmThumb[]> {
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const out: FilmThumb[] = []
  for (const id of plan.tracks.base) {
    const s = byId.get(id)
    if (!s || !comparable(s)) continue
    const mid = (s.startFrame + s.endFrame) / 2 / FPS
    const file = path.join(dir, `thumb-${id}.gray`)
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', mid.toFixed(3), '-i', film, '-frames:v', '1', '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', file], { signal })
    const bytes = await readFile(file).catch(() => null)
    await rm(file, { force: true })
    if (bytes && bytes.length === 32 * 18) out.push({ shotId: id, grey: Array.from(bytes) })
  }
  return out
}
