// The checks a generated picture or clip goes through before it is kept (ENGINE-SPEC §23 step 4, pipeline-avatar §2.6–§2.7,
// decision 0035). Deterministic and free: not blank (a near-uniform frame), not a near-duplicate of another picture of this
// video (a difference hash on 9×8 grey). With the eyes (`vision` service, optional): no text drawn in the picture, no extra
// fingers, nobody when the brief said nobody, and for a clip no object that changes between its frames. A failed check gets
// ONE regeneration; a second failure keeps the picture and lists it (never a silent swap).
import type { RunCtx } from '../registry'
import { need, type VisionVerdict } from '../services'

/** Grey thumbnail size the stats read (16:9, small enough to be instant). */
const W = 32
const H = 18

export interface PictureStats {
  /** Standard deviation of the grey levels, 0–255: under `BLANK_STDDEV` the frame is near uniform. */
  stddev: number
  /** 64-bit difference hash as 16 hex digits. */
  dhash: string
}

/** A frame whose grey levels barely vary is blank (a black, white or flat-colour frame, a failed decode). */
export const BLANK_STDDEV = 6
/** Two pictures whose hashes differ in fewer bits than this are the same picture. */
export const DUPLICATE_BITS = 5

/** dHash of a grey image (row-major, `w`×`h` bytes) resampled to 9×8 by area averages. */
export function dhashOf(grey: Uint8Array, w: number, h: number): string {
  const cell = (cx: number, cy: number): number => {
    const x0 = Math.floor((cx * w) / 9)
    const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / 9))
    const y0 = Math.floor((cy * h) / 8)
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / 8))
    let sum = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += grey[y * w + x] ?? 0
    return sum / ((x1 - x0) * (y1 - y0))
  }
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += cell(x, y) < cell(x + 1, y) ? '1' : '0'
  let hex = ''
  for (let k = 0; k < 64; k += 4) hex += parseInt(bits.slice(k, k + 4), 2).toString(16)
  return hex
}

export function stddevOf(grey: Uint8Array): number {
  if (grey.length === 0) return 0
  let sum = 0
  for (const v of grey) sum += v
  const mean = sum / grey.length
  let sq = 0
  for (const v of grey) sq += (v - mean) ** 2
  return Math.sqrt(sq / grey.length)
}

/** Hamming distance of two hashes of `dhashOf`. */
export function hashDistance(a: string, b: string): number {
  let d = 0
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    let x = parseInt(a[k] as string, 16) ^ parseInt(b[k] as string, 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/** The grey stats of a picture (or of a clip's frame at `atS`). */
export async function statsOf(ctx: RunCtx, file: string, atS?: number): Promise<PictureStats> {
  const res = await need(ctx, 'media').run(
    'ffmpeg',
    ['-v', 'error', ...(atS !== undefined ? ['-ss', atS.toFixed(3)] : []), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'],
    { signal: ctx.signal }
  )
  const grey = new Uint8Array(res.stdout.buffer, res.stdout.byteOffset, Math.min(res.stdout.byteLength, W * H))
  return { stddev: stddevOf(grey), dhash: dhashOf(grey, W, H) }
}

/**
 * Two pictures look alike from this likeness up (avatar-qualite part 3). Measured on the real hooks: the same wall corner made
 * twice 0.95–0.97; every two different pictures 0.54 at most, run 6's wide bedroom against its close mould corner 0.31 (a 9×8
 * difference hash had taken those two for the same picture and stopped the render).
 */
export const NEAR_LIKENESS = 0.85

/** A picture's 32×18 grey thumbnail (576 values), what `likeness` compares. */
export async function greyThumbOf(ctx: RunCtx, file: string): Promise<number[]> {
  const res = await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { signal: ctx.signal })
  return [...new Uint8Array(res.stdout.buffer, res.stdout.byteOffset, Math.min(res.stdout.byteLength, W * H))]
}

/** How alike two grey thumbnails are: the correlation of their pixels, -1–1 (a flat picture against anything: 0). */
export function likeness(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i] as number
    mb += b[i] as number
  }
  ma /= n
  mb /= n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma
    const y = (b[i] as number) - mb
    ab += x * y
    aa += x * x
    bb += y * y
  }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb)
}

export type CheckFailure = 'blank' | 'duplicate' | 'text' | 'anatomy' | 'person' | 'drift'

/** What the French list of the record says for each failure. */
export const FAILURE_FR: Record<CheckFailure, string> = {
  blank: 'image vide',
  duplicate: 'presque identique à une autre image de la vidéo',
  text: 'texte écrit dans l’image',
  anatomy: 'doigts ou membres en trop',
  person: 'une personne alors que personne ne devait apparaître',
  drift: 'un objet change d’aspect pendant le clip'
}

/** The deterministic checks of a picture against the pictures already kept in this video (their hashes). */
export function judgeStats(s: PictureStats, kept: readonly string[]): CheckFailure[] {
  const out: CheckFailure[] = []
  if (s.stddev < BLANK_STDDEV) out.push('blank')
  if (kept.some((h) => hashDistance(h, s.dhash) < DUPLICATE_BITS)) out.push('duplicate')
  return out
}

/** The eyes' failures, in the order of the checks. */
export function judgeVision(v: VisionVerdict, people: 'anyone' | 'not-presenter' | 'presenter-as-actor' | 'nobody'): CheckFailure[] {
  const out: CheckFailure[] = []
  if (v.text) out.push('text')
  if (v.anatomy) out.push('anatomy')
  if (v.person && people === 'nobody') out.push('person')
  if (v.drift) out.push('drift')
  return out
}
