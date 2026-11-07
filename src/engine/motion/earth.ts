// The picture of the Earth under a map card (docs/ENGINE-SPEC.md §25, formats/cards.ts): NASA's Blue Marble (public domain, credit NASA Earth
// Observatory) as a JPEG data: URI. Offline it is a crop of the bundled `resources/maps/earth.jpg` (15 pixels a degree), cut by ffmpeg. When the host
// gives a cache folder, the sharp picture (about 220 pixels a degree) comes from NASA's GIBS web map service, one small JPEG per box, kept in that
// folder. (The 21600 x 21600 tiles of the same picture cannot be used: ffmpeg refuses a picture of that size.)
import { tempTag } from './temp-name'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GeoBox } from '../formats/cards'
import type { MediaService } from '../services'

/** The Blue Marble with its bathymetry, as NASA's GIBS serves it (EPSG:4326, any box and size on demand). */
export const GIBS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
export const GIBS_LAYER = 'BlueMarble_ShadedRelief_Bathymetry'
/** The bundled picture, in pixels a degree. */
export const EARTH_PPD = 15

/** One picture of the Earth: its file, its north-west corner (degrees) and its size (degrees), `ppd` pixels to the degree. */
export interface EarthSource {
  file: string
  west: number
  north: number
  widthDeg: number
  heightDeg: number
  ppd: number
}

export const bundledEarth = (libraryRoot: string): EarthSource => ({ file: path.join(libraryRoot, 'maps', 'earth.jpg'), west: -180, north: 90, widthDeg: 360, heightDeg: 180, ppd: EARTH_PPD })

export const gibsUrl = (box: GeoBox, w: number, h: number): string =>
  `${GIBS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${GIBS_LAYER}&STYLES=&SRS=EPSG:4326&BBOX=${[box.west, box.south, box.east, box.north].map((v) => v.toFixed(5)).join(',')}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/jpeg`

export type FetchFile = (url: string, dest: string, signal: AbortSignal) => Promise<void>
/** Downloads `url` to `dest` through a `.part` file, so a stopped download never leaves half a picture in the cache. */
export const downloadFile: FetchFile = async (url, dest, signal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/jpeg')) throw new Error(`${url}: not a JPEG (${type})`)
  const part = `${dest}.${tempTag()}.part`
  try {
    await writeFile(part, Buffer.from(await res.arrayBuffer()))
    await rename(part, dest)
  } catch (e) {
    await rm(part, { force: true })
    throw e
  }
}

export interface Cropped {
  /** `data:image/jpeg;base64,…` */
  image: string
  /** The box the picture covers (degrees). */
  box: GeoBox
  /** Pixels of the picture, and of the source it was cut from per degree. */
  width: number
  height: number
  sourcePpd: number
}

/**
 * The sharp picture of `box` from GIBS, `w` x `h` pixels (or smaller until it fits `maxBytes` as a data: URI), downloaded once into `cacheDir`.
 * Null when it cannot be had (offline, refused): the caller then uses the bundled picture.
 */
export async function gibsCrop(o: { cacheDir: string; box: GeoBox; w: number; h: number; maxBytes: number; signal: AbortSignal; fetchFile?: FetchFile }): Promise<Cropped | null> {
  const get = o.fetchFile ?? downloadFile
  try {
    await mkdir(o.cacheDir, { recursive: true })
    let w = o.w
    let h = o.h
    for (let attempt = 0; attempt < 5; attempt++) {
      const url = gibsUrl(o.box, w, h)
      const file = path.join(o.cacheDir, `gibs-${createHash('sha1').update(url).digest('hex').slice(0, 20)}.jpg`)
      let data = await readFile(file).catch(() => null)
      if (!data) {
        await get(url, file, o.signal)
        data = await readFile(file)
      }
      if (data.length * (4 / 3) <= o.maxBytes) return { image: `data:image/jpeg;base64,${data.toString('base64')}`, box: o.box, width: w, height: h, sourcePpd: w / (o.box.east - o.box.west) }
      w = Math.round(w * 0.8)
      h = Math.round(h * 0.8)
    }
    return null
  } catch (e) {
    if (o.signal.aborted) throw e
    return null
  }
}

export interface CropPlan {
  /** The box really covered, aligned on whole pixels of the sources (degrees). */
  box: GeoBox
  ppd: number
  /** The canvas in source pixels. */
  width: number
  height: number
  /** Per source: the part to cut (source pixels) and where it lands on the canvas. */
  pieces: { source: number; x: number; y: number; w: number; h: number; dx: number; dy: number }[]
}

/** What to cut from `sources` (all at the same ppd) to cover `box`: the whole-pixel box and the piece of each source in it. */
export function cropPlan(box: GeoBox, sources: readonly EarthSource[]): CropPlan {
  const ppd = (sources[0] as EarthSource).ppd
  const X0 = Math.max(0, Math.floor((box.west + 180) * ppd + 1e-6))
  const X1 = Math.min(360 * ppd, Math.ceil((box.east + 180) * ppd - 1e-6))
  const Y0 = Math.max(0, Math.floor((90 - box.north) * ppd + 1e-6))
  const Y1 = Math.min(180 * ppd, Math.ceil((90 - box.south) * ppd - 1e-6))
  const pieces: CropPlan['pieces'] = []
  sources.forEach((s, source) => {
    const ox = Math.round((s.west + 180) * ppd)
    const oy = Math.round((90 - s.north) * ppd)
    const x = Math.max(X0, ox)
    const y = Math.max(Y0, oy)
    const w = Math.min(X1, ox + Math.round(s.widthDeg * ppd)) - x
    const h = Math.min(Y1, oy + Math.round(s.heightDeg * ppd)) - y
    if (w > 0 && h > 0) pieces.push({ source, x: x - ox, y: y - oy, w, h, dx: x - X0, dy: y - Y0 })
  })
  return { box: { west: X0 / ppd - 180, east: X1 / ppd - 180, north: 90 - Y0 / ppd, south: 90 - Y1 / ppd }, ppd, width: X1 - X0, height: Y1 - Y0, pieces }
}

/** The ffmpeg arguments that cut the plan from the sources and scale it to `outW` x `outH` as a JPEG on stdout at quality `q` (2 best .. 31). */
export function cropArgs(plan: CropPlan, sources: readonly EarthSource[], outW: number, outH: number, q: number): string[] {
  const args = ['-v', 'error', '-y']
  const used = plan.pieces.map((p) => sources[p.source] as EarthSource)
  for (const s of used) args.push('-i', s.file)
  const parts = plan.pieces.map((p, i) => `[${i}:v]crop=${p.w}:${p.h}:${p.x}:${p.y}[p${i}]`)
  let last = '[p0]'
  if (plan.pieces.length > 1) {
    parts.push(`color=c=black:s=${plan.width}x${plan.height}:d=1[c0]`)
    plan.pieces.forEach((p, i) => {
      parts.push(`[${i === 0 ? 'c0' : `c${i}`}][p${i}]overlay=${p.dx}:${p.dy}[c${i + 1}]`)
    })
    last = `[c${plan.pieces.length}]`
  }
  parts.push(`${last}scale=${outW}:${outH}:flags=lanczos,format=yuvj420p[out]`)
  return [...args, '-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', String(q), '-f', 'image2pipe', '-']
}

/**
 * The picture of `box`, `outW` x `outH` pixels (a size of the page: the box's own aspect), as a JPEG data: URI of at most `maxBytes`: the
 * quality goes down by steps, then the size, until it fits.
 */
export async function cropEarth(o: { media: MediaService; signal: AbortSignal; sources: readonly EarthSource[]; box: GeoBox; outW: number; outH: number; maxBytes: number }): Promise<Cropped> {
  const plan = cropPlan(o.box, o.sources)
  if (plan.pieces.length === 0) throw new Error(`earth: nothing of the Earth picture covers the box ${JSON.stringify(o.box)}`)
  let w = o.outW
  let h = o.outH
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const q of [4, 7, 11, 17]) {
      const r = await o.media.run('ffmpeg', cropArgs(plan, o.sources, w, h, q), { signal: o.signal })
      if (r.stdout.length > 0 && r.stdout.length * (4 / 3) <= o.maxBytes) return { image: `data:image/jpeg;base64,${r.stdout.toString('base64')}`, box: plan.box, width: w, height: h, sourcePpd: plan.ppd }
    }
    w = Math.round(w * 0.82)
    h = Math.round(h * 0.82)
  }
  throw new Error(`earth: the crop of ${JSON.stringify(o.box)} does not fit in ${o.maxBytes} bytes`)
}
