// P7/P9 — the side-by-side FILM of a compared passage (decision 0113): the reference passage on the left, our render on the
// right, each 640 px wide (height 360 for a landscape film, 720 for a vertical one), padded to the same size, 1280 px wide
// at most, H.264 CRF 30 with a capped bitrate (< 30 MB for 60-180 s). The sound is OURS (not the reference's). No labels
// are drawn: ffmpeg's drawtext needs a font file the packaged app cannot rely on.
import path from 'node:path'
import type { RunFn } from '../../../../engine/sourcing/types'
import { isPortrait, measureFrame } from '../analysis/frame'

export const SIDE_BY_SIDE_FILE = 'side-by-side.mp4'
export const FILM_HALF_W = 640

/** ffmpeg arguments of the film (pure). `ref` is the cut passage, `ours` our render; both scaled into a 640 x `height` cell. */
export function sideBySideFilmArgs(ref: string, ours: string, out: string, height: 360 | 720 = 360, cut?: { fromS: number; lengthS: number }): string[] {
  const cell = `scale=${FILM_HALF_W}:${height}:force_original_aspect_ratio=decrease,pad=${FILM_HALF_W}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25`
  return [
    // a whole reference file is cut to the reproduced passage (input seek), so both halves show the same moments
    '-y', '-v', 'error', ...(cut ? ['-ss', String(Math.max(0, cut.fromS)), '-t', String(Math.max(1, cut.lengthS))] : []), '-i', ref, '-i', ours,
    '-filter_complex', `[0:v]${cell}[a];[1:v]${cell}[b];[a][b]hstack=inputs=2:shortest=1[v]`,
    '-map', '[v]', '-map', '1:a?', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-maxrate', '1.5M', '-bufsize', '3M', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out
  ]
}

/** Writes `<dir>/side-by-side.mp4`; returns its path under `dir.rel`, or null when ffmpeg could not make it (the film is a
 *  proof aid: a round never fails for it). */
export async function writeSideBySideFilm(o: { referenceFile: string; oursFile: string; dir: { abs: string; rel: string }; run: RunFn; cut?: { fromS: number; lengthS: number } }): Promise<string | null> {
  try {
    const frame = await measureFrame(o.run, o.oursFile).catch(() => null)
    await o.run('ffmpeg', sideBySideFilmArgs(o.referenceFile, o.oursFile, path.join(o.dir.abs, SIDE_BY_SIDE_FILE), frame && isPortrait(frame) ? 720 : 360, o.cut), { timeoutMs: 900_000 })
    return `${o.dir.rel}/${SIDE_BY_SIDE_FILE}`
  } catch {
    return null
  }
}
