// Finding « the same item, or the closest available » when a clone targets a reference video whose pictures are already chosen: a free,
// local visual similarity between a reference frame and the candidates' previews. Two cheap signatures from ffmpeg's own scaler: a 64-bit
// difference hash (does the picture's structure match?) and an 8×8 colour grid (does its palette match, which separates a colour print from
// the black-and-white original of the same scene?). Close duplicates and crops score high; a different picture of the same subject scores
// low, so the ranking is a FILTER for « is this the item », never a judge of « is this a good picture ». A Claude look at the best few
// (`pickMedia` with the reference as the first picture) settles the doubtful ones. No model download, no network: ffmpeg only.
import { spawn } from 'node:child_process'

/** The raw 8-bit RGB pixels of an image scaled to w×h (`w*h*3` bytes). Injectable: tests pass synthetic pixels. */
export type PixelReader = (file: string, w: number, h: number) => Promise<Uint8Array>

export const ffmpegPixels: PixelReader = (file, w, h) =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      if (code === 0 && buf.length >= w * h * 3) resolve(new Uint8Array(buf.subarray(0, w * h * 3)))
      else reject(new Error(`ffmpeg could not read ${file}`))
    })
  })

export interface Signature {
  /** 64 bits as a BigInt: bit i is « pixel i is brighter than its right neighbour » on a 9×8 grey grid. */
  hash: bigint
  /** 8×8×3 colour grid, 0..255. */
  grid: Uint8Array
}

const luma = (p: Uint8Array, i: number): number => 0.299 * p[i * 3]! + 0.587 * p[i * 3 + 1]! + 0.114 * p[i * 3 + 2]!

export async function signatureOf(file: string, read: PixelReader = ffmpegPixels): Promise<Signature> {
  const [nine, eight] = await Promise.all([read(file, 9, 8), read(file, 8, 8)])
  let hash = 0n
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (luma(nine, y * 9 + x) > luma(nine, y * 9 + x + 1)) hash |= 1n << BigInt(y * 8 + x)
  return { hash, grid: eight }
}

const popcount = (n: bigint): number => {
  let c = 0
  while (n) {
    c += Number(n & 1n)
    n >>= 1n
  }
  return c
}

/** 0..1: how alike two pictures are (structure 65 %, colour 35 %). */
export function similarity(a: Signature, b: Signature): number {
  const structure = 1 - popcount(a.hash ^ b.hash) / 64
  let diff = 0
  for (let i = 0; i < a.grid.length; i++) diff += Math.abs(a.grid[i]! - b.grid[i]!)
  const colour = 1 - diff / (a.grid.length * 255)
  return Math.round((0.65 * structure + 0.35 * colour) * 1000) / 1000
}

export interface Lookalike {
  id: string
  score: number
}

/** The candidates ranked by likeness to the reference frame. A candidate whose preview cannot be read is left out, not scored 0. */
export async function rankBySimilarity(reference: string, candidates: ReadonlyArray<{ id: string; file: string }>, read: PixelReader = ffmpegPixels): Promise<Lookalike[]> {
  const ref = await signatureOf(reference, read)
  const out: Lookalike[] = []
  for (const c of candidates) {
    try {
      out.push({ id: c.id, score: similarity(ref, await signatureOf(c.file, read)) })
    } catch {
      // unreadable preview: skipped
    }
  }
  return out.sort((x, y) => y.score - x.score)
}
