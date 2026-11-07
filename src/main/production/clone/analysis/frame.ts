// P2 frame measure (moteur-pov-2): the reference's own frame size, so the render follows its format (a vertical 9:16 Short was
// rendered 16:9 because nothing measured it). Read on the file by ffprobe (display size: a rotated phone video swaps its sides);
// with no file, a Shorts link says it is vertical (the platform only serves Shorts upright), and is marked as read from the link.
import type { RunFn } from '../../../../engine/sourcing/types'

export interface FrameMeasure {
  width: number
  height: number
  /** `file`: ffprobe on the downloaded video; `link`: a Shorts link, no file. */
  from: 'file' | 'link'
}

export const probeFrameArgs = (file: string): string[] => ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:stream_tags=rotate', '-of', 'json', file]

/** The display frame from ffprobe's JSON (a ±90° rotation swaps width and height); null when it carries no video size. */
export function frameOfProbe(json: string): FrameMeasure | null {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return null
  }
  const s = (doc as { streams?: { width?: number; height?: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[] }).streams?.[0]
  if (!s || !Number.isInteger(s.width) || !Number.isInteger(s.height) || (s.width ?? 0) <= 0 || (s.height ?? 0) <= 0) return null
  const rot = Number(s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? s.tags?.rotate ?? 0)
  const turned = Math.abs(Math.round(rot)) % 180 === 90
  return { width: turned ? s.height! : s.width!, height: turned ? s.width! : s.height!, from: 'file' }
}

/** A YouTube Shorts link: vertical by the platform's own rule (only when no file could be measured). */
export function frameOfLink(url: string): FrameMeasure | null {
  return /youtube\.com\/shorts\//i.test(url) ? { width: 1080, height: 1920, from: 'link' } : null
}

export const isPortrait = (f: Pick<FrameMeasure, 'width' | 'height'>): boolean => f.height > f.width

export async function measureFrame(run: RunFn, file: string, signal?: AbortSignal): Promise<FrameMeasure | null> {
  const r = await run('ffprobe', probeFrameArgs(file), { timeoutMs: 60_000, ...(signal ? { signal } : {}) })
  return frameOfProbe(r.stdout)
}
