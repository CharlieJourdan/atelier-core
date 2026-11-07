// The face-similarity check of the presenter's angles (pipeline-avatar §2.5 a, decision 0034): an angle made by an image-edit
// engine from the portrait is kept only if it still shows the same person. This is the LOCAL check, free and offline:
//   1. the picture is read at 192×108 with ffmpeg; skin pixels are marked (the classic RGB skin rule);
//   2. the face is the largest connected patch of skin; its box is squared and grown upwards a little (hair, forehead);
//   3. the face box, whatever its size in the frame (a close framing makes it big, a wide one small), is described by its luma
//      pattern resampled to 16×16 (normalised) and its colours (a hue × saturation histogram);
//   4. score = 0.6 · max(0, correlation of the two patterns) + 0.4 · histogram intersection, in [0, 1]; 0 when either picture
//      shows no face.
// It catches an angle that drifted to another person or a broken picture; it is not face recognition. The threshold comes
// from our test on the stand-in presenters (tests/unit/presenter-face.test.ts): production-10 re-picks it on the first real
// portraits and may add the eyes' identity check (docs/PROVIDERS.md §6).
import type { MediaService } from '../services'

/**
 * Kept when the score is at least this (decision 0034). Picked on the stand-ins to never keep another person: above the best
 * other-person score (0.91), at the cost of dropping a doubtful true angle, which is made again (an image edit costs ≈ 1 cent).
 */
export const ANGLE_SIMILARITY_MIN = 0.92

const W = 192
const H = 108
const PATCH = 16
const BINS_H = 12
const BINS_S = 3
/** A face smaller than this many skin pixels is no face (a hand, a reflection). */
const MIN_FACE_PX = 40

export interface FaceSignature {
  luma: Float64Array
  hist: Float64Array
}

const isSkin = (r: number, g: number, b: number): boolean => r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && r - g > 15

async function pixels(media: MediaService, file: string, signal: AbortSignal): Promise<Buffer> {
  const out = await media.run('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'], { signal })
  if (out.stdout.length < W * H * 3) throw new Error(`could not read the picture ${file}`)
  return out.stdout
}

/** The box of the largest connected patch of skin, or null. */
function faceBox(rgb: Buffer): { x0: number; y0: number; x1: number; y1: number } | null {
  const skin = new Uint8Array(W * H)
  for (let k = 0; k < W * H; k++) skin[k] = isSkin(rgb[k * 3] as number, rgb[k * 3 + 1] as number, rgb[k * 3 + 2] as number) ? 1 : 0
  const seen = new Uint8Array(W * H)
  let best: { n: number; x0: number; y0: number; x1: number; y1: number } | null = null
  const stack: number[] = []
  for (let start = 0; start < W * H; start++) {
    if (!skin[start] || seen[start]) continue
    let n = 0
    let [x0, y0, x1, y1] = [W, H, 0, 0]
    stack.push(start)
    seen[start] = 1
    while (stack.length > 0) {
      const k = stack.pop() as number
      const x = k % W
      const y = (k - x) / W
      n++
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) {
        if (j >= 0 && skin[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    // a face is not the whole frame (a skin-coloured wall or a wooden background is not a face)
    const fits = x1 - x0 + 1 <= W * 0.6 && y1 - y0 + 1 <= H * 0.9
    if (fits && (!best || n > best.n)) best = { n, x0, y0, x1, y1 }
  }
  if (!best || best.n < MIN_FACE_PX) return null
  // squared on its larger side, grown upwards by a fifth (hair, forehead), kept inside the frame
  const side = Math.max(best.x1 - best.x0 + 1, best.y1 - best.y0 + 1)
  const cx = (best.x0 + best.x1 + 1) / 2
  const y0 = Math.max(0, Math.round(best.y0 - side * 0.2))
  const x0 = Math.max(0, Math.round(cx - side / 2))
  return { x0, y0, x1: Math.min(W, x0 + side), y1: Math.min(H, y0 + Math.round(side * 1.2)) }
}

function describe(rgb: Buffer): FaceSignature | null {
  const box = faceBox(rgb)
  if (!box) return null
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  const luma = new Float64Array(PATCH * PATCH)
  for (let py = 0; py < PATCH; py++) {
    for (let px = 0; px < PATCH; px++) {
      const x = box.x0 + Math.min(bw - 1, Math.floor(((px + 0.5) * bw) / PATCH))
      const y = box.y0 + Math.min(bh - 1, Math.floor(((py + 0.5) * bh) / PATCH))
      const i = (y * W + x) * 3
      luma[py * PATCH + px] = 0.299 * (rgb[i] as number) + 0.587 * (rgb[i + 1] as number) + 0.114 * (rgb[i + 2] as number)
    }
  }
  const mean = luma.reduce((n, v) => n + v, 0) / luma.length
  let norm = 0
  for (let k = 0; k < luma.length; k++) {
    luma[k] = (luma[k] as number) - mean
    norm += (luma[k] as number) ** 2
  }
  norm = Math.sqrt(norm) || 1
  for (let k = 0; k < luma.length; k++) luma[k] = (luma[k] as number) / norm
  const hist = new Float64Array(BINS_H * BINS_S)
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * W + x) * 3
      const [r, g, b] = [(rgb[i] as number) / 255, (rgb[i + 1] as number) / 255, (rgb[i + 2] as number) / 255]
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const s = mx === 0 ? 0 : (mx - mn) / mx
      let h = 0
      if (mx !== mn) h = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4
      const bin = Math.min(BINS_H - 1, Math.floor((h / 6) * BINS_H)) * BINS_S + Math.min(BINS_S - 1, Math.floor(s * BINS_S))
      hist[bin] = (hist[bin] as number) + 1 / (bw * bh)
    }
  }
  return { luma, hist }
}

/** The face of a picture, described once (null: no face found). */
export async function faceSignature(media: MediaService, file: string, signal: AbortSignal): Promise<FaceSignature | null> {
  return describe(await pixels(media, file, signal))
}

/** How much two faces look alike (0..1; 0 when either is missing). */
export function signatureSimilarity(a: FaceSignature | null, b: FaceSignature | null): number {
  if (!a || !b) return 0
  let corr = 0
  for (let k = 0; k < a.luma.length; k++) corr += (a.luma[k] as number) * (b.luma[k] as number)
  let inter = 0
  for (let k = 0; k < a.hist.length; k++) inter += Math.min(a.hist[k] as number, b.hist[k] as number)
  return Math.round((0.6 * Math.max(0, corr) + 0.4 * inter) * 1000) / 1000
}

/** How much `angle` looks like `portrait` (0..1). */
export async function faceSimilarity(media: MediaService, portrait: string, angle: string, signal: AbortSignal): Promise<number> {
  return signatureSimilarity(await faceSignature(media, portrait, signal), await faceSignature(media, angle, signal))
}
