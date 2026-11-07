// The geography behind the map card (docs/ENGINE-SPEC.md §25, formats/cards.ts): countries (Natural Earth, public domain) found by code or
// name, views fitted to the page's aspect, a projection, SVG paths clipped to the view, and `prepareMapAssets`, which turns a card's spec into
// everything its page needs (the Earth picture cropped, borders, regions, pins, routes, names, the camera's two boxes) in the page's pixels.
// The projection is equirectangular with the longitude scaled by the cosine of the first view's middle latitude, so shapes are not stretched.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CardAssets, GeoBox, MapAssets, MapCardProps } from '../formats/cards'
import type { MediaService } from '../services'
import { bundledEarth, cropEarth, gibsCrop, type Cropped, type FetchFile } from './earth'

const RAD = Math.PI / 180
const NO_SIGNAL = new AbortController().signal

// ---- countries ------------------------------------------------------------------------------------------------------------------------

/** One ring of a country: lon, lat, lon, lat… and its box. */
export interface Ring {
  pts: Float64Array
  west: number
  south: number
  east: number
  north: number
}
export interface Country {
  iso: string
  name: string
  fr: string
  alt: string[]
  /** The whole country, and its mainland only (far-away territories left out), as boxes in degrees. */
  box: GeoBox
  main: GeoBox
  rings: Ring[]
}
interface RawCountry {
  iso: string
  name: string
  fr: string
  alt: string[]
  bbox: number[]
  main: number[]
  rings: number[][]
}
const toBox = (b: number[]): GeoBox => ({ west: b[0] as number, south: b[1] as number, east: b[2] as number, north: b[3] as number })

function decodeRing(flat: number[]): Ring {
  const n = flat.length / 2
  const pts = new Float64Array(n * 2)
  let x = 0
  let y = 0
  let west = 1e9
  let south = 1e9
  let east = -1e9
  let north = -1e9
  for (let i = 0; i < n; i++) {
    x += flat[i * 2] as number
    y += flat[i * 2 + 1] as number
    const lon = x / 100
    const lat = y / 100
    pts[i * 2] = lon
    pts[i * 2 + 1] = lat
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return { pts, west, south, east, north }
}

const loaded = new Map<string, Promise<Country[]>>()
/** Every country of `<library>/maps/countries.json`, read once per library folder. */
export function loadCountries(libraryRoot: string): Promise<Country[]> {
  let p = loaded.get(libraryRoot)
  if (!p) {
    p = readFile(path.join(libraryRoot, 'maps', 'countries.json'), 'utf8').then((text) => {
      const doc = JSON.parse(text) as { countries: RawCountry[] }
      return doc.countries.map((c) => ({ iso: c.iso, name: c.name, fr: c.fr, alt: c.alt, box: toBox(c.bbox), main: toBox(c.main), rings: c.rings.map(decodeRing) }))
    })
    loaded.set(libraryRoot, p)
    p.catch(() => loaded.delete(libraryRoot))
  }
  return p
}

/** A name as compared: no accents, lower case, words separated by one space (« Côte d’Ivoire » = « cote d ivoire »). */
export const normName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Names a director is likely to write that Natural Earth spells otherwise. */
const ALIASES: Record<string, string> = {
  usa: 'USA', us: 'USA', america: 'USA', 'united states': 'USA', 'etats unis': 'USA',
  uk: 'GBR', britain: 'GBR', 'great britain': 'GBR', 'royaume uni': 'GBR',
  'czech republic': 'CZE', tchequie: 'CZE', holland: 'NLD', 'the netherlands': 'NLD', burma: 'MMR', 'ivory coast': 'CIV', 'cote d ivoire': 'CIV',
  'south korea': 'KOR', 'north korea': 'PRK', russia: 'RUS', 'russian federation': 'RUS', turkey: 'TUR', turkiye: 'TUR', swaziland: 'SWZ', macedonia: 'MKD',
  drc: 'COD', 'congo kinshasa': 'COD', 'uae': 'ARE', vietnam: 'VNM', 'viet nam': 'VNM', 'timor leste': 'TLS', 'east timor': 'TLS'
}

export interface CountryIndex {
  find(name: string): Country | undefined
}
const indexes = new WeakMap<Country[], CountryIndex>()
function indexOf(all: Country[]): CountryIndex {
  let idx = indexes.get(all)
  if (idx) return idx
  const byKey = new Map<string, Country>()
  const add = (key: string, c: Country): void => {
    const k = normName(key)
    if (k && !byKey.has(k)) byKey.set(k, c)
  }
  for (const c of all) add(c.iso, c)
  for (const c of all) {
    add(c.name, c)
    add(c.fr, c)
  }
  for (const c of all) c.alt.forEach((a) => add(a, c))
  const byIso = new Map(all.map((c) => [c.iso, c] as const))
  for (const [alias, iso] of Object.entries(ALIASES)) {
    const c = byIso.get(iso)
    if (c) add(alias, c)
  }
  idx = { find: (name) => byKey.get(normName(name)) }
  indexes.set(all, idx)
  return idx
}

/** The countries of `names` (ISO 3166 alpha-3 code, English or French name, any case or accent), in order and without repeats; the names it does not know. */
export function findCountries(all: Country[], names: readonly string[]): { countries: Country[]; unknown: string[] } {
  const idx = indexOf(all)
  const countries: Country[] = []
  const unknown: string[] = []
  for (const n of names) {
    const c = idx.find(n)
    if (!c) unknown.push(n)
    else if (!countries.includes(c)) countries.push(c)
  }
  return { countries, unknown }
}

// ---- boxes and the projection ---------------------------------------------------------------------------------------------------------

type Pt = { lat: number; lon: number }
/** The smallest box holding boxes and points; null for nothing. */
export function boxOf(items: readonly (GeoBox | Pt)[]): GeoBox | null {
  let b: GeoBox | null = null
  for (const it of items) {
    const w = 'lon' in it ? it.lon : it.west
    const e = 'lon' in it ? it.lon : it.east
    const s = 'lat' in it ? it.lat : it.south
    const n = 'lat' in it ? it.lat : it.north
    b = b ? { west: Math.min(b.west, w), south: Math.min(b.south, s), east: Math.max(b.east, e), north: Math.max(b.north, n) } : { west: w, south: s, east: e, north: n }
  }
  return b
}
const union = (a: GeoBox, b: GeoBox): GeoBox => boxOf([a, b]) as GeoBox
const grow = (b: GeoBox, f: number): GeoBox => {
  const dx = (b.east - b.west) * f
  const dy = (b.north - b.south) * f
  return { west: Math.max(-180, b.west - dx), east: Math.min(180, b.east + dx), south: Math.max(-90, b.south - dy), north: Math.min(90, b.north + dy) }
}
export const midCos = (b: GeoBox): number => Math.max(0.05, Math.cos(((b.south + b.north) / 2) * RAD))

/**
 * `box` made to the page's aspect (width / height of the picture): grown by `margin` (a fraction of each side), then widened or heightened
 * about its centre. A width in degrees counts for `cosLat` of itself (the cosine of the middle latitude, or the one given: the camera's end
 * uses the first view's, so both boxes are the same shape in pixels). A box that would leave the Earth is moved back inside it, or shrunk.
 */
export function fitView(box: GeoBox, aspect: number, margin = 0, opts: { cosLat?: number; minHeight?: number } = {}): GeoBox {
  const cos = opts.cosLat ?? midCos(box)
  let dh = Math.max((box.north - box.south) * (1 + 2 * margin), opts.minHeight ?? 0)
  let dw = (box.east - box.west) * cos * (1 + 2 * margin)
  if (dw / dh < aspect) dw = dh * aspect
  else dh = dw / aspect
  if (dh > 180) {
    dh = 180
    dw = dh * aspect
  }
  if (dw / cos > 360) {
    dw = 360 * cos
    dh = dw / aspect
  }
  const width = dw / cos
  const place = (c: number, size: number, lo: number, hi: number): number => Math.min(Math.max(c - size / 2, lo), hi - size)
  const west = place((box.west + box.east) / 2, width, -180, 180)
  const south = place((box.south + box.north) / 2, dh, -90, 90)
  return { west, east: west + width, south, north: south + dh }
}

/** A place on the Earth in the pixels of a picture of `size` showing `view` (the view has the picture's aspect: the mapping is linear). */
export function project(lon: number, lat: number, view: GeoBox, size: { width: number; height: number }): { x: number; y: number } {
  return { x: ((lon - view.west) / (view.east - view.west)) * size.width, y: ((view.north - lat) / (view.north - view.south)) * size.height }
}

// ---- paths ----------------------------------------------------------------------------------------------------------------------------

/** Sutherland–Hodgman against a box (flat lon, lat…). A ring wholly inside is returned as it is. */
function clipRing(pts: Float64Array, b: GeoBox): number[] {
  let cur = Array.from(pts)
  const edges: [(x: number, y: number) => boolean, (ax: number, ay: number, bx: number, by: number) => [number, number]][] = [
    [(x) => x >= b.west, (ax, ay, bx, by) => [b.west, ay + ((by - ay) * (b.west - ax)) / (bx - ax)]],
    [(x) => x <= b.east, (ax, ay, bx, by) => [b.east, ay + ((by - ay) * (b.east - ax)) / (bx - ax)]],
    [(_x, y) => y >= b.south, (ax, ay, bx, by) => [ax + ((bx - ax) * (b.south - ay)) / (by - ay), b.south]],
    [(_x, y) => y <= b.north, (ax, ay, bx, by) => [ax + ((bx - ax) * (b.north - ay)) / (by - ay), b.north]]
  ]
  for (const [inside, cut] of edges) {
    const next: number[] = []
    const n = cur.length / 2
    for (let i = 0; i < n; i++) {
      const ax = cur[((i + n - 1) % n) * 2] as number
      const ay = cur[((i + n - 1) % n) * 2 + 1] as number
      const bx = cur[i * 2] as number
      const by = cur[i * 2 + 1] as number
      const ain = inside(ax, ay)
      const bin = inside(bx, by)
      if (bin) {
        if (!ain) next.push(...cut(ax, ay, bx, by))
        next.push(bx, by)
      } else if (ain) next.push(...cut(ax, ay, bx, by))
    }
    cur = next
    if (cur.length < 6) return []
  }
  return cur
}

const inside = (r: Ring, b: GeoBox): boolean => r.west >= b.west && r.east <= b.east && r.south >= b.south && r.north <= b.north
const meets = (r: Ring, b: GeoBox): boolean => r.east >= b.west && r.west <= b.east && r.north >= b.south && r.south <= b.north

/** The rings of `countries` that are in `clip`, as one SVG path (closed subpaths, one decimal), clipped to it, mapped by `at`. */
export function pathOf(countries: readonly Country[], clip: GeoBox, at: (lon: number, lat: number) => { x: number; y: number }): string {
  const parts: string[] = []
  for (const c of countries) {
    for (const r of c.rings) {
      if (!meets(r, clip)) continue
      const flat = inside(r, clip) ? r.pts : clipRing(r.pts, clip)
      if (flat.length < 6) continue
      let d = ''
      for (let i = 0; i < flat.length; i += 2) {
        const p = at(flat[i] as number, flat[i + 1] as number)
        d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      }
      parts.push(d + 'Z')
    }
  }
  return parts.join('')
}

/** The centre of mass of the biggest ring of the biggest of `countries` (where a label of the region sits). */
export function labelPoint(countries: readonly Country[]): Pt | null {
  let best: { ring: Ring; area: number } | null = null
  for (const c of countries) {
    for (const r of c.rings) {
      const area = (r.east - r.west) * (r.north - r.south) * Math.cos(((r.north + r.south) / 2) * RAD)
      if (!best || area > best.area) best = { ring: r, area }
    }
  }
  if (!best) return null
  const p = best.ring.pts
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < p.length - 2; i += 2) {
    const cross = (p[i] as number) * (p[i + 3] as number) - (p[i + 2] as number) * (p[i + 1] as number)
    a += cross
    cx += ((p[i] as number) + (p[i + 2] as number)) * cross
    cy += ((p[i + 1] as number) + (p[i + 3] as number)) * cross
  }
  if (Math.abs(a) < 1e-9) return { lon: (best.ring.west + best.ring.east) / 2, lat: (best.ring.south + best.ring.north) / 2 }
  return { lon: cx / (3 * a), lat: cy / (3 * a) }
}

// ---- routes: a smooth curve through the way, and the place of its head ---------------------------------------------------------------

type XY = { x: number; y: number }
/** Points sampled per piece of a route's curve: a fixed count, so the curve of the same places has the same shape at any scale. */
const PER_PIECE = 32
/** How far a route with no waypoint bows out of its straight line, as a share of its length (at its middle). */
const ARC_BOW = 0.11

/**
 * A route's path through its points (in pixels: from, the waypoints, to), densely sampled: a centripetal Catmull-Rom spline through
 * them (no loops, no overshoot at close points); two points only make a gentle arc (a quadratic curve bowing northwards, like a long
 * journey on a flat map), never a ruler line.
 */
export function routeCurve(points: readonly XY[]): XY[] {
  const p = points.filter((q, i) => i === 0 || Math.hypot(q.x - (points[i - 1] as XY).x, q.y - (points[i - 1] as XY).y) > 1e-6)
  const a = p[0] as XY
  if (p.length < 2) return [a, a]
  if (p.length === 2) {
    const b = p[1] as XY
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    // the normal that points up the page (north); a route going straight north or south bows east
    let nx = dy / len
    let ny = -dx / len
    if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) {
      nx = -nx
      ny = -ny
    }
    const c = { x: (a.x + b.x) / 2 + nx * len * 2 * ARC_BOW, y: (a.y + b.y) / 2 + ny * len * 2 * ARC_BOW }
    const n = PER_PIECE * 2
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n
      const u = 1 - t
      return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
    })
  }
  const last = p[p.length - 1] as XY
  const ext = [{ x: 2 * a.x - (p[1] as XY).x, y: 2 * a.y - (p[1] as XY).y }, ...p, { x: 2 * last.x - (p[p.length - 2] as XY).x, y: 2 * last.y - (p[p.length - 2] as XY).y }]
  const out: XY[] = []
  const mix = (u: XY, v: XY, t0: number, t1: number, t: number): XY => {
    const w = t1 - t0 > 1e-12 ? (t - t0) / (t1 - t0) : 0
    return { x: u.x + (v.x - u.x) * w, y: u.y + (v.y - u.y) * w }
  }
  for (let s = 0; s + 3 < ext.length; s++) {
    const [p0, p1, p2, p3] = ext.slice(s, s + 4) as [XY, XY, XY, XY]
    const t1 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y))
    const t2 = t1 + Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y))
    const t3 = t2 + Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y))
    for (let j = 0; j < PER_PIECE; j++) {
      const t = t1 + ((t2 - t1) * j) / PER_PIECE
      const a1 = mix(p0, p1, 0, t1, t)
      const a2 = mix(p1, p2, t1, t2, t)
      const a3 = mix(p2, p3, t2, t3, t)
      out.push(mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t))
    }
  }
  out.push(last)
  return out
}

/** The length of a polyline (flat x, y, x, y…). */
export function curveLength(flat: readonly number[]): number {
  let total = 0
  for (let i = 2; i + 1 < flat.length; i += 2) total += Math.hypot((flat[i] as number) - (flat[i - 2] as number), (flat[i + 1] as number) - (flat[i - 1] as number))
  return total
}

/** Where the head of a route is at `k` (0..1 of its length) along the polyline (flat x, y…): the runtime's `tracePoint`, the same arithmetic. */
export function pointAlong(flat: readonly number[], k: number): XY {
  const n = Math.floor(flat.length / 2)
  if (n < 2) return { x: flat[0] ?? 0, y: flat[1] ?? 0 }
  const len = [0]
  for (let i = 1; i < n; i++) len.push((len[i - 1] as number) + Math.hypot((flat[2 * i] as number) - (flat[2 * i - 2] as number), (flat[2 * i + 1] as number) - (flat[2 * i - 1] as number)))
  const at = (len[n - 1] as number) * Math.min(1, Math.max(0, k))
  let i = 1
  while (i < n - 1 && (len[i] as number) < at) i++
  const seg = (len[i] as number) - (len[i - 1] as number)
  const f = seg > 0 ? Math.min(1, Math.max(0, (at - (len[i - 1] as number)) / seg)) : 1
  return { x: (flat[2 * i - 2] as number) + ((flat[2 * i] as number) - (flat[2 * i - 2] as number)) * f, y: (flat[2 * i - 1] as number) + ((flat[2 * i + 1] as number) - (flat[2 * i - 1] as number)) * f }
}

/** The ease a route draws with, line and head alike (the runtime's `sine`: it sets off and arrives gently). */
export const routeEase = (x: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)))

// ---- the assets of a card -------------------------------------------------------------------------------------------------------------

export type MapGeometry = Omit<MapAssets, 'image' | 'imageBox'> & {
  /** The first view, the camera's end, and the box of the Earth the camera ever shows (degrees). */
  startView: GeoBox
  endView: GeoBox
  imageBox: GeoBox
  /** World pixels of a degree of longitude and of latitude. */
  kx: number
  ky: number
}

/** Everything of a map card except the Earth picture: pure, from the countries. Throws, naming them, on countries it does not know. */
export function mapGeometry(p: MapCardProps, o: { width: number; height: number; countries: Country[] }): MapGeometry {
  const { width, height } = o
  const aspect = width / height
  const regionCountries = p.regions.map((r) => findCountries(o.countries, r.countries))
  const unknown = regionCountries.flatMap((r) => r.unknown)
  if (unknown.length) throw new Error(`map: unknown countries: ${unknown.join(', ')}`)
  const around = boxOf([
    ...regionCountries.flatMap((r) => r.countries.map((c) => c.main)),
    ...p.pins,
    ...p.routes.flatMap((r) => [r.from, ...(r.via ?? []), r.to])
  ])
  const first = p.view ?? around ?? boxOf(p.names) ?? { west: -25, south: 30, east: 50, north: 72 }
  const startView = p.view ? fitView(first, aspect, 0) : fitView(first, aspect, 0.22, { minHeight: 5 })
  const cos = midCos(startView)
  const endView = p.zoomTo
    ? fitView(p.zoomTo, aspect, 0, { cosLat: cos })
    : fitView({ west: (startView.west + startView.east) / 2 - ((startView.east - startView.west) * 0.95) / 2, east: (startView.west + startView.east) / 2 + ((startView.east - startView.west) * 0.95) / 2, south: (startView.south + startView.north) / 2 - ((startView.north - startView.south) * 0.95) / 2, north: (startView.south + startView.north) / 2 + ((startView.north - startView.south) * 0.95) / 2 }, aspect, 0, { cosLat: cos })
  const kx = width / (startView.east - startView.west)
  const ky = height / (startView.north - startView.south)
  const at = (lon: number, lat: number): { x: number; y: number } => ({ x: (lon - startView.west) * kx, y: (startView.north - lat) * ky })
  const reach = union(startView, endView)
  const imageBox = grow(reach, 0.02)
  const clip = grow(reach, 0.12)
  const place = (b: GeoBox): { x: number; y: number; w: number; h: number } => {
    const tl = at(b.west, b.north)
    return { x: tl.x, y: tl.y, w: (b.east - b.west) * kx, h: (b.north - b.south) * ky }
  }
  const labels = p.regions.map((r, i) => {
    const pt = r.label ? labelPoint((regionCountries[i] as { countries: Country[] }).countries) : null
    return pt ? at(pt.lon, pt.lat) : { x: -1e4, y: -1e4 }
  })
  return {
    startView,
    endView,
    imageBox,
    kx,
    ky,
    start: { x: 0, y: 0, w: width, h: height },
    end: place(endView),
    borders: pathOf(o.countries, clip, at),
    regions: regionCountries.map((r) => pathOf(r.countries, clip, at)),
    pins: p.pins.map((pin) => at(pin.lon, pin.lat)),
    routes: p.routes.map((r) => {
      const a = at(r.from.lon, r.from.lat)
      const b = at(r.to.lon, r.to.lat)
      const curve = routeCurve([a, ...(r.via ?? []).map((v) => at(v.lon, v.lat)), b])
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, pts: curve.flatMap((q) => [+q.x.toFixed(1), +q.y.toFixed(1)]) }
    }),
    names: p.names.map((n) => at(n.lon, n.lat)),
    width,
    height,
    imageRect: place(imageBox),
    labels
  }
}

export interface PrepareOptions {
  width: number
  height: number
  /** The folder holding `maps/` (the repository's `resources`). */
  libraryRoot: string
  /** Where the sharp pictures (NASA GIBS, one JPEG per box) are kept; without it the bundled picture alone is used. */
  cacheDir?: string
  /** Cuts the pictures (ffmpeg). */
  media: MediaService
  signal?: AbortSignal
  /** How a picture is downloaded (tests); default: HTTPS. */
  fetchFile?: FetchFile
  /** The picture's largest size as a data: URI, in bytes (default 1.5 MB). */
  maxImageBytes?: number
}

/** The map card's assets (formats/cards.ts `MapAssets`) for a spec at the page's size. */
export async function prepareMapAssets(p: MapCardProps, o: PrepareOptions): Promise<NonNullable<CardAssets['map']>> {
  const signal = o.signal ?? NO_SIGNAL
  const geo = mapGeometry(p, { width: o.width, height: o.height, countries: await loadCountries(o.libraryRoot) })
  const maxBytes = o.maxImageBytes ?? 1_500_000
  const warnings: string[] = []
  const bundled = [bundledEarth(o.libraryRoot)]
  // the sharp picture of GIBS when the host keeps a cache folder, else (or when it cannot be had) a crop of the bundled one
  const earthOf = async (box: GeoBox, w: number, h: number): Promise<Cropped | null> => {
    if (!o.cacheDir) return null
    const c = await gibsCrop({ cacheDir: o.cacheDir, box, w, h, maxBytes, signal, ...(o.fetchFile ? { fetchFile: o.fetchFile } : {}) })
    if (!c) warnings.push('the sharp Earth picture (NASA GIBS) is not available (offline?): the bundled picture is used')
    return c
  }
  const endW = geo.end.w
  // the wide picture: as sharp as the end of the move needs (up to twice the page's pixels), within the size a page can carry
  const density = Math.min(2, Math.max(1, o.width / endW))
  const rect = geo.imageRect as { x: number; y: number; w: number; h: number }
  const shrink = Math.min(1, 3200 / (rect.w * density))
  const wideW = Math.round(rect.w * density * shrink)
  const wideH = Math.round(rect.h * density * shrink)
  const wide = (await earthOf(geo.imageBox, wideW, wideH)) ?? (await cropEarth({ media: o.media, signal, sources: bundled, box: geo.imageBox, outW: wideW, outH: wideH, maxBytes }))
  // the sharper picture of where the camera arrives, when the move goes in far enough to need one
  let detail: MapAssets['detail']
  const endDeg = geo.endView.east - geo.endView.west
  if (o.cacheDir && endDeg < (geo.startView.east - geo.startView.west) * 0.7) {
    const box = grow(geo.endView, 0.12)
    const outW = Math.min(2800, Math.round(o.width * 1.25 * ((box.east - box.west) / endDeg)))
    const c = await earthOf(box, outW, Math.round((outW * (box.north - box.south)) / (box.east - box.west)))
    if (c) {
      const tl = { x: (c.box.west - geo.startView.west) * geo.kx, y: (geo.startView.north - c.box.north) * geo.ky }
      detail = { image: c.image, x: tl.x, y: tl.y, w: (c.box.east - c.box.west) * geo.kx, h: (c.box.north - c.box.south) * geo.ky }
    }
  }
  const { startView: _s, endView: _e, kx: _kx, ky: _ky, ...assets } = geo
  const rectOf = (b: GeoBox): { x: number; y: number; w: number; h: number } => ({ x: (b.west - geo.startView.west) * geo.kx, y: (geo.startView.north - b.north) * geo.ky, w: (b.east - b.west) * geo.kx, h: (b.north - b.south) * geo.ky })
  return { ...assets, image: wide.image, imageBox: wide.box, imageRect: rectOf(wide.box), ...(detail ? { detail } : {}), ...(warnings.length ? { warnings } : {}) }
}
