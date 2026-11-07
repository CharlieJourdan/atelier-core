// The frame format as a real error (moteur-pov-2, decision 0102's family): the final film's measured frame must have the
// reference's measured format (`render.assemble` `aspect`, from the Style Definition's `editing.aspect`). A vertical Short
// reference rendered 16:9 is not « less similar », it is the wrong product. Measured by ffprobe on the delivered file, never judged.
// Repair: the film is fitted inside the format's frame (black bars, nothing cropped: captions, texts and legends the blocking checks
// passed stay whole) and measured again; still wrong → refused. The repair is said in the film's meta.
import type { MediaService } from '../services'
import type { Defect } from './types'

export type FilmAspect = '16:9' | '9:16'
export const FRAME_OF: Record<FilmAspect, readonly [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920] }

/** The format of a frame size: vertical when taller than wide. */
export const aspectOfDims = (w: number, h: number): FilmAspect => (h > w ? '9:16' : '16:9')

/** The display size from ffprobe's csv (`width,height` of the first video stream); null when unreadable. */
export function parseSize(stdout: string): { w: number; h: number } | null {
  const m = /(\d+)\s*[,x]\s*(\d+)/.exec(stdout.trim())
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? { w, h } : null
}

export async function measureSize(media: MediaService, film: string, signal: AbortSignal): Promise<{ w: number; h: number } | null> {
  const r = await media.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', film], { signal })
  return parseSize(r.stdout.toString('utf8'))
}

/** The blocking defect when the film's frame is not the expected format (an unreadable film is wrong too); null when right. */
export function aspectDefect(expected: FilmAspect, size: { w: number; h: number } | null, durationS: number): Defect | null {
  if (size && aspectOfDims(size.w, size.h) === expected) return null
  return {
    kind: 'wrong_aspect',
    severity: 'fail',
    atS: 0,
    endS: Math.max(0, durationS),
    detail: size
      ? `Le film est en ${size.w}×${size.h} (${aspectOfDims(size.w, size.h)}) alors que la référence est en ${expected}.`
      : `Le format du film n’a pas pu être lu (la référence est en ${expected}).`
  }
}

/** ffmpeg arguments that fit a film inside the format's frame: scaled to fit, centred on black bars, the sound copied. */
export const reframeArgs = (film: string, out: string, to: FilmAspect, crf = 18): string[] => {
  const [w, h] = FRAME_OF[to]
  return ['-hide_banner', '-v', 'error', '-i', film, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`, '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-y', out]
}
