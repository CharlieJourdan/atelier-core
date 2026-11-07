// What the 3D map card's page needs (formats/map3d.ts `Map3dAssets`), prepared in Node because the page has no network: the library
// (MapLibre GL JS, BSD-3-Clause, read from node_modules), the map's type (Barlow, OFL), the tiles the camera will ask for along its path
// (NASA Blue Marble imagery from GIBS, public domain; AWS Open Data Terrain Tiles in Terrarium encoding, free with attribution), each kept
// once in a cache folder, Natural Earth borders and the regions' shapes (public domain, resources/maps/countries.json), the routes as great
// circles and the camera of every frame (motion/map3d-plan.ts).
import { tempTag } from './temp-name'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineError } from '../errors'
import type { Map3dAssets, Map3dProps } from '../formats/map3d'
import { findCountries, labelPoint, loadCountries, type Country } from './geo'
import { lightenDem } from './map3d-dem'
import { cameraFrames, routeLine, tilesFor } from './map3d-plan'

/** A terrain tile made light (sea at 0 m, heights to 5 m); a tile that cannot be read is kept as it came. */
const lightDem = (b: Uint8Array): Uint8Array => {
  try {
    return lightenDem(b, 5)
  } catch {
    return b
  }
}

const NO_SIGNAL = new AbortController().signal

/** NASA GIBS, Web-Mercator tiles (levels 0..8) of the Blue Marble with its shaded relief and the sea floor: the reference's own look. */
export const SAT_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'
/** AWS Open Data « Terrain Tiles » (Mapzen), elevation as Terrarium PNG. */
export const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const MAP3D_CREDITS = [
  'Imagery: NASA Earth Observatory / GIBS, Blue Marble shaded relief and bathymetry (public domain)',
  'Elevation: Terrain Tiles, AWS Open Data (Mapzen; SRTM, GMTED2010, ETOPO1 and others, see their attribution list)',
  'Borders: Natural Earth (public domain)',
  'Rendering: MapLibre GL JS (BSD-3-Clause)'
]

/** Gets the bytes of a URL (tests give a fake). */
export type FetchBytes = (url: string, signal: AbortSignal) => Promise<Uint8Array>
export const fetchBytes: FetchBytes = async (url, signal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// ---- the library and the type, from node_modules ----------------------------------------------------------------------------------------
/** The folder of an installed package: `node_modules/<name>` in the folder of this module or one above it, else in the process's folder or above. */
function packageDir(name: string): string {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()]
  for (const start of starts) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const at = path.join(dir, 'node_modules', ...name.split('/'))
      if (existsSync(path.join(at, 'package.json'))) return at
      if (path.dirname(dir) === dir) break
    }
  }
  throw new EngineError('missing_tool', `The package ${name} is not installed: the 3D map cannot be drawn.`)
}

let libCache: Promise<Map3dAssets['lib']> | null = null
/** MapLibre GL JS's main module and worker (ES modules), as text. */
export function mapLibrary(): Promise<Map3dAssets['lib']> {
  libCache ??= (async () => {
    const dir = packageDir('maplibre-gl')
    const [main, worker, pkg] = await Promise.all([
      readFile(path.join(dir, 'dist', 'maplibre-gl.mjs'), 'utf8'),
      readFile(path.join(dir, 'dist', 'maplibre-gl-worker.mjs'), 'utf8'),
      readFile(path.join(dir, 'package.json'), 'utf8')
    ])
    // the page has an opaque origin (about:blank), where a module worker from a blob: URL cannot start: the worker runs as a classic
    // script, so its one `export` (its default, unused by the page) is dropped, and so are the source-map comments
    const classic = worker.replace(/\/\/# sourceMappingURL=\S*\s*$/, '').replace(/export\s*\{[^}]*\}\s*;?\s*$/, '')
    if (/export\s*\{/.test(classic.slice(-200))) throw new EngineError('missing_tool', 'maplibre-gl: its worker module has a shape this page cannot run')
    return { main: main.replace(/\/\/# sourceMappingURL=\S*\s*$/, ''), worker: classic, version: (JSON.parse(pkg) as { version: string }).version }
  })()
  libCache.catch(() => (libCache = null))
  return libCache
}

let fontCache: Promise<string> | null = null
/** Barlow (OFL) 500 and 600, upright and italic, as embedded @font-face rules. */
export function mapFontCss(): Promise<string> {
  fontCache ??= (async () => {
    const dir = path.join(packageDir('@fontsource/barlow'), 'files')
    const faces: [number, 'normal' | 'italic'][] = [
      [500, 'normal'],
      [600, 'normal'],
      [500, 'italic'],
      [600, 'italic']
    ]
    const rules = await Promise.all(
      faces.map(async ([w, s]) => {
        const data = await readFile(path.join(dir, `barlow-latin-${w}-${s}.woff2`))
        return `@font-face{font-family:'Barlow';font-weight:${w};font-style:${s};src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}`
      })
    )
    return rules.join('\n')
  })()
  fontCache.catch(() => (fontCache = null))
  return fontCache
}

// ---- tiles -------------------------------------------------------------------------------------------------------------------------------
async function cachedTile(o: { cacheDir: string; layer: string; url: string; ext: string; signal: AbortSignal; fetch: FetchBytes; shape?: (b: Uint8Array) => Uint8Array }): Promise<Uint8Array | null> {
  const file = path.join(o.cacheDir, o.layer, `${createHash('sha1').update(o.url).digest('hex').slice(0, 24)}.${o.ext}`)
  const have = await readFile(file).catch(() => null)
  if (have) return have
  try {
    const got = await o.fetch(o.url, o.signal)
    const data = o.shape ? o.shape(got) : got
    await mkdir(path.dirname(file), { recursive: true })
    const part = `${file}.${tempTag()}.part`
    await writeFile(part, data)
    await rename(part, file).catch(async () => rm(part, { force: true }))
    return data
  } catch (e) {
    if (o.signal.aborted) throw e
    return null
  }
}

/** Runs `work` over `items`, `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (x: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++] as T)
    })
  )
}

// ---- shapes ------------------------------------------------------------------------------------------------------------------------------
const r2 = (v: number): number => Math.round(v * 100) / 100
const ringCoords = (pts: Float64Array): number[][] => {
  const out: number[][] = []
  for (let i = 0; i < pts.length; i += 2) out.push([r2(pts[i] as number), r2(pts[i + 1] as number)])
  return out
}
/** Every country ring that meets the box (grown by a margin). */
function ringsIn(all: Country[], box: { west: number; south: number; east: number; north: number }): number[][][] {
  const m = 3
  const out: number[][][] = []
  for (const c of all) for (const r of c.rings) if (r.east >= box.west - m && r.west <= box.east + m && r.north >= box.south - m && r.south <= box.north + m) out.push(ringCoords(r.pts))
  return out
}

export interface Map3dPrepareOptions {
  width: number
  height: number
  durationS: number
  /** The folder holding `maps/` (the repository's `resources`). */
  libraryRoot: string
  /** Where tiles are kept between runs (one file per tile). */
  cacheDir: string
  signal?: AbortSignal
  fetch?: FetchBytes
  /** Deepest tile zoom of the imagery (default and GIBS's limit: 8) and of the terrain (default 6). */
  maxSatZoom?: number
  maxDemZoom?: number
  /** Most bytes of tiles the page may carry (default 16 MB): the deepest zoom is lowered until the tiles fit. */
  maxTileBytes?: number
}

/** The assets of a 3D map card. A region naming an unknown country is a permanent error naming it. */
export async function prepareMap3d(p: Map3dProps, o: Map3dPrepareOptions): Promise<Map3dAssets> {
  const signal = o.signal ?? NO_SIGNAL
  const get = o.fetch ?? fetchBytes
  const all = await loadCountries(o.libraryRoot)
  const regions: number[][][][][] = []
  const labels: ([number, number] | null)[] = []
  for (const r of p.regions) {
    const found = findCountries(all, r.countries)
    if (found.unknown.length) throw new EngineError('bad_input', `map3d: unknown countries ${found.unknown.join(', ')}`)
    regions.push(found.countries.flatMap((c) => c.rings.map((ring) => [ringCoords(ring.pts)])))
    const lp = labelPoint(found.countries)
    labels.push(lp ? [r2(lp.lon), r2(lp.lat)] : null)
  }
  const routes = p.routes.map((r) => routeLine(r).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)] as [number, number]))
  const frames = cameraFrames(p, o.durationS)
  const warnings: string[] = []
  const budget = o.maxTileBytes ?? 16_000_000
  const tiles: Record<string, string> = {}
  let satZ = p.look === 'satellite' ? (o.maxSatZoom ?? 8) : -1
  // the terrain is smooth (and the imagery carries its own shaded relief): its tiles stop two levels above the picture's
  let demZ = p.exaggeration > 0 ? (o.maxDemZoom ?? 6) : -1
  let box = tilesFor(frames, o.width, o.height, 0).box
  for (let attempt = 0; attempt < 6; attempt++) {
    const want: { key: string; url: string; ext: string; layer: string }[] = []
    if (satZ >= 0) {
      const set = tilesFor(frames, o.width, o.height, satZ)
      box = set.box
      for (const k of set.keys) {
        const [z, x, y] = k.split('/')
        want.push({ key: `sat/${k}`, layer: 'sat', ext: 'jpg', url: SAT_URL.replace('{z}', z as string).replace('{x}', x as string).replace('{y}', y as string) })
      }
    }
    if (demZ >= 0) {
      const set = tilesFor(frames, o.width, o.height, demZ)
      box = set.box
      for (const k of set.keys) {
        const [z, x, y] = k.split('/')
        want.push({ key: `dem/${k}`, layer: 'dem-l5', ext: 'png', url: DEM_URL.replace('{z}', z as string).replace('{x}', x as string).replace('{y}', y as string) })
      }
    }
    let bytes = 0
    let missing = 0
    for (const k of Object.keys(tiles)) delete tiles[k]
    await eachLimited(want, 8, async (w) => {
      const data = await cachedTile({ cacheDir: o.cacheDir, layer: w.layer, url: w.url, ext: w.ext, signal, fetch: get, ...(w.layer.startsWith('dem') ? { shape: lightDem } : {}) })
      if (!data) {
        missing++
        return
      }
      bytes += data.length
      tiles[w.key] = Buffer.from(data).toString('base64')
    })
    if (missing > 0 && attempt === 0) warnings.push(`${missing} of ${want.length} map tiles could not be had (offline?): those parts of the map are drawn from coarser tiles or left plain`)
    if (bytes * (4 / 3) <= budget || (satZ <= 4 && demZ <= 4)) break
    // too heavy for one page: one level less of detail where it costs most
    if (satZ >= demZ) satZ--
    else demZ--
  }
  const [lib, fontCss] = await Promise.all([mapLibrary(), mapFontCss()])
  const rings = ringsIn(all, box)
  return {
    lib,
    tiles,
    maxzoom: { sat: satZ, dem: demZ },
    borders: rings,
    ...(p.look === 'parchment' ? { land: rings.map((r) => [r]) } : {}),
    regions,
    labels,
    routes,
    frames,
    box: { west: +box.west.toFixed(3), south: +box.south.toFixed(3), east: +box.east.toFixed(3), north: +box.north.toFixed(3) },
    fontCss,
    credits: MAP3D_CREDITS,
    ...(warnings.length ? { warnings } : {})
  }
}

/** True when the library is installed (the 3D map can be drawn on this machine). */
export function hasMapLibrary(): boolean {
  try {
    return existsSync(path.join(packageDir('maplibre-gl'), 'dist', 'maplibre-gl.mjs'))
  } catch {
    return false
  }
}
