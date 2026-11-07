// The pure geometry of the 3D map card (formats/map3d.ts): Web-Mercator, the measured camera ease, the camera of every frame (keys, or a
// route followed while it draws), great-circle routes, and which tiles the camera will ask for along its whole path (so the page can carry
// them inline: it has no network). The camera model is MapLibre GL JS's: a 512-pixel world at zoom 0, a vertical field of view of
// 36.87°, the centre of the frame on the ground at `center`, the eye `pitch` degrees from straight down.
import { FPS } from '../formats/timing'
import type { LatLon3d, Map3dCameraKey, Map3dProps } from '../formats/map3d'

const RAD = Math.PI / 180
/** MapLibre's default vertical field of view (degrees). */
export const FOV_DEG = 36.87

// ---- Web-Mercator (0..1 across the world) ------------------------------------------------------------------------------------------------
export const mercX = (lon: number): number => (lon + 180) / 360
export const mercY = (lat: number): number => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / Math.PI) / 2
export const lonOf = (x: number): number => x * 360 - 180
export const latOf = (y: number): number => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD

// ---- easing ------------------------------------------------------------------------------------------------------------------------------
/** A CSS-style cubic Bézier ease through (0,0), (x1,y1), (x2,y2), (1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number): number => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const by = (t: number): number => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2
      if (bx(m) < x) lo = m
      else hi = m
    }
    return by((lo + hi) / 2)
  }
}
/**
 * The eases of the camera. `push` was fitted on the reference's three map shots (36J1tL9ulGA 0:21.5, 1:57, 2:44; SIFT between frames 0.2–0.5 s
 * apart): the zoom speed peaks about a third into the move and settles slowly; cubic-bezier(0.30, 0, 0.30, 1).
 */
export const EASES = { push: cubicBezier(0.3, 0, 0.3, 1), inOut: cubicBezier(0.65, 0, 0.35, 1), linear: (x: number): number => Math.min(1, Math.max(0, x)) }
export const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

// ---- routes ------------------------------------------------------------------------------------------------------------------------------
/** The great circle from a to b as n + 1 points [lon, lat]. */
export function greatCircle(a: LatLon3d, b: LatLon3d, n = 48): [number, number][] {
  const p1 = [a.lat * RAD, a.lon * RAD] as const
  const p2 = [b.lat * RAD, b.lon * RAD] as const
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2[0] - p1[0]) / 2) ** 2 + Math.cos(p1[0]) * Math.cos(p2[0]) * Math.sin((p2[1] - p1[1]) / 2) ** 2))
  if (d < 1e-9) return [[a.lon, a.lat], [b.lon, b.lat]]
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1])
    const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1])
    const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0])
    out.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD])
  }
  return out
}
/** A route through its via points, as one polyline. */
export function routeLine(r: { from: LatLon3d; to: LatLon3d; via: LatLon3d[] }): [number, number][] {
  const stops = [r.from, ...r.via, r.to]
  const out: [number, number][] = []
  for (let i = 0; i + 1 < stops.length; i++) out.push(...greatCircle(stops[i] as LatLon3d, stops[i + 1] as LatLon3d, 32).slice(i === 0 ? 0 : 1))
  return out
}
/** Length of a polyline in km. */
export function lineKm(line: readonly (readonly [number, number])[]): number {
  let km = 0
  for (let i = 1; i < line.length; i++) {
    const [lo1, la1] = line[i - 1] as [number, number]
    const [lo2, la2] = line[i] as [number, number]
    const h = Math.sin(((la2 - la1) * RAD) / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(((lo2 - lo1) * RAD) / 2) ** 2
    km += 2 * 6371 * Math.asin(Math.sqrt(h))
  }
  return km
}
/** The point at fraction k (0..1) of a polyline's length (measured in degrees, enough for drawing), and the index of its segment. */
export function alongLine(line: readonly (readonly [number, number])[], k: number): { at: [number, number]; i: number } {
  const lens = [0]
  for (let i = 1; i < line.length; i++) {
    const p = line[i] as readonly [number, number]
    const q = line[i - 1] as readonly [number, number]
    lens.push((lens[i - 1] as number) + Math.hypot(p[0] - q[0], p[1] - q[1]))
  }
  const total = lens[lens.length - 1] as number
  const want = total * Math.min(1, Math.max(0, k))
  let i = 1
  while (i < line.length - 1 && (lens[i] as number) < want) i++
  const seg = (lens[i] as number) - (lens[i - 1] as number)
  const f = seg > 0 ? (want - (lens[i - 1] as number)) / seg : 1
  const a = line[i - 1] as readonly [number, number]
  const b = line[i] as readonly [number, number]
  return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i: i - 1 }
}
/** How long a route takes to draw: its own `drawS`, else 0.6 s + 1 s per 1500 km, between 0.8 and 4 s (the reference: 750 km in ≈ 1 s). */
export const drawSeconds = (r: { drawS?: number | undefined }, km: number): number => r.drawS ?? Math.min(4, Math.max(0.8, 0.6 + km / 1500))
/** The eased progress of a drawing route (the reference's head speeds up then slows: a sine in-out). */
export const drawProgress = (t: number, start: number, dur: number): number => {
  const x = Math.min(1, Math.max(0, (t - start) / dur))
  return 0.5 - 0.5 * Math.cos(Math.PI * x)
}

// ---- when things happen ------------------------------------------------------------------------------------------------------------------
/** When the parts of the card that carry no time of their own appear: regions, routes, pins in that order, from 0.8 s, over ~40 % of the card. */
export function timesOf(p: Map3dProps, durationS: number): { regions: number[]; routes: number[]; pins: number[]; names: number[]; facts: number[] } {
  const loose = [...p.regions.map((r) => r.atS), ...p.routes.map((r) => r.atS), ...p.pins.map((r) => r.atS)]
  const free = loose.filter((x) => x === undefined).length
  const span = Math.max(0.5 * free, durationS * 0.4 - 0.8)
  let n = 0
  const next = (own: number | undefined): number => own ?? 0.8 + (free > 1 ? (n++ * span) / free : n++ * 0)
  const regions = p.regions.map((r) => next(r.atS))
  const routes = p.routes.map((r) => next(r.atS))
  const pins = p.pins.map((r) => next(r.atS))
  return { regions, routes, pins, names: p.names.map((x, i) => x.atS ?? 0.6 + i * 0.15), facts: p.facts.map((x, i) => x.atS ?? Math.min(durationS - 0.5, 1.2 + i * 1.5)) }
}

// ---- the camera --------------------------------------------------------------------------------------------------------------------------
/** A camera: centre lon, lat, zoom, pitch, bearing. */
export type Cam = [number, number, number, number, number]

const keyCam = (k: Map3dCameraKey): Cam => [k.center.lon, k.center.lat, k.zoom, k.pitch, k.bearing]
function mix(a: Cam, b: Cam, k: number): Cam {
  const x = mercX(a[0]) + (mercX(b[0]) - mercX(a[0])) * k
  const y = mercY(a[1]) + (mercY(b[1]) - mercY(a[1])) * k
  let db = b[4] - a[4]
  if (db > 180) db -= 360
  if (db < -180) db += 360
  return [lonOf(x), latOf(y), a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + db * k]
}

/** The camera at `t` seconds of the card. */
export function cameraAt(p: Map3dProps, t: number, durationS: number, routes: readonly [number, number][][] = p.routes.map(routeLine)): Cam {
  const c = p.camera
  const ease = EASES[c.ease]
  let cam: Cam | null = null
  if (c.keys) {
    const keys = c.keys
    const first = keys[0] as Map3dCameraKey
    const last = keys[keys.length - 1] as Map3dCameraKey
    if (t <= first.atS) cam = keyCam(first)
    else if (t >= last.atS) {
      const k = keyCam(last)
      cam = [k[0], k[1], k[2] + c.drift * (t - last.atS), k[3], k[4]]
    } else {
      let i = 0
      while (i + 1 < keys.length && (keys[i + 1] as Map3dCameraKey).atS <= t) i++
      const a = keys[i] as Map3dCameraKey
      const b = keys[i + 1] as Map3dCameraKey
      cam = mix(keyCam(a), keyCam(b), ease((t - a.atS) / (b.atS - a.atS)))
    }
  }
  const f = c.follow
  const line = f ? routes[f.route] : undefined
  if (f && line) {
    const times = timesOf(p, durationS)
    const start = (times.routes[f.route] ?? 0) + 0.4
    const dur = drawSeconds(p.routes[f.route] ?? {}, lineKm(line))
    const head = alongLine(line, drawProgress(t, start, dur)).at
    const followCam: Cam = [head[0], head[1], f.zoom, f.pitch, f.bearing]
    if (!cam) return followCam
    // the follow takes over from the keys 0.6 s before the route draws and gives the camera back 0.6 s after it arrives
    const w = Math.min(smooth((t - (start - 0.6)) / 0.6), 1 - smooth((t - (start + dur)) / 0.6))
    return mix(cam, followCam, Math.max(0, w))
  }
  return cam as Cam
}

/** The camera of every frame, 0 .. durationS both included, rounded (the page interpolates between two frames for a time in between). */
export function cameraFrames(p: Map3dProps, durationS: number): number[][] {
  const routes = p.routes.map(routeLine)
  const n = Math.max(1, Math.ceil(durationS * FPS))
  const out: number[][] = []
  for (let i = 0; i <= n; i++) {
    const c = cameraAt(p, i / FPS, durationS, routes)
    out.push([+c[0].toFixed(6), +c[1].toFixed(6), +c[2].toFixed(5), +c[3].toFixed(4), +c[4].toFixed(4)])
  }
  return out
}

// ---- what the camera sees ----------------------------------------------------------------------------------------------------------------
/**
 * Where the screen point (sx, sy) of a `width` x `height` frame meets the ground for camera `cam`, in Mercator (0..1), and how far it is
 * from the eye relative to the centre's distance. Points above the horizon are clamped to `maxDist` times the centre's distance.
 */
export function groundAt(cam: Cam, width: number, height: number, sx: number, sy: number, maxDist = 6): { x: number; y: number; rel: number } {
  const [lon, lat, zoom, pitchDeg, bearingDeg] = cam
  const world = 512 * 2 ** zoom
  const D = (0.5 * height) / Math.tan((FOV_DEG * RAD) / 2)
  const pitch = pitchDeg * RAD
  const dx = sx - width / 2
  const dy = sy - height / 2
  // the ray's angle from the vertical, in the camera's vertical plane
  let theta = pitch + Math.atan2(-dy, D)
  const h = D * Math.cos(pitch)
  const maxTheta = Math.atan2(maxDist * D * Math.sin(pitch) + 1, h)
  theta = Math.min(theta, maxTheta, (89 * Math.PI) / 180)
  const forward = h * Math.tan(theta) - D * Math.sin(pitch)
  const rayLen = h / Math.cos(theta)
  const lateral = (dx * rayLen) / Math.hypot(D, dy)
  // ground offsets (pixels at this zoom), forward = up the screen, turned by the bearing
  const b = bearingDeg * RAD
  const ox = lateral * Math.cos(b) + forward * Math.sin(b)
  const oy = lateral * Math.sin(b) - forward * Math.cos(b)
  return { x: mercX(lon) + ox / world, y: mercY(lat) + oy / world, rel: Math.hypot(rayLen, lateral) / D }
}

export interface TileSet {
  /** Tiles as z/x/y keys. */
  keys: Set<string>
  /** The ground box seen by the camera along its path (degrees). */
  box: { west: number; south: number; east: number; north: number }
}

/**
 * The 256-pixel tiles (up to `maxzoom`) the camera asks for along its path, over-provisioned: at each sampled frame a grid of screen points is
 * sent to the ground; each point wants the zoom its distance gives (the centre: the camera's zoom + 1 for 256-pixel tiles, one level less
 * each time the distance doubles, `extra` levels more); its tile, the `ring` around it and every ancestor are kept. Checked against what
 * MapLibre really asks for (tests/unit/map3d-browser.test.ts): about twice as many tiles as it asks, and a tile it asks that is not here is
 * drawn from its parent.
 */
export function tilesFor(frames: readonly number[][], width: number, height: number, maxzoom: number, opts: { samples?: number; extra?: number; ring?: number; grid?: number } = {}): TileSet {
  const keys = new Set<string>()
  let west = 1
  let east = 0
  let north = 1
  let south = 0
  const step = Math.max(1, Math.floor(frames.length / (opts.samples ?? 12)))
  const pick = frames.filter((_, i) => i % step === 0 || i === frames.length - 1)
  const extra = opts.extra ?? 0
  const ring = opts.ring ?? 1
  const gw = opts.grid ?? 16
  const gh = Math.max(4, Math.round((gw * height) / width))
  for (const f of pick) {
    const cam = f as Cam
    for (let gy = 0; gy <= gh; gy++) {
      for (let gx = 0; gx <= gw; gx++) {
        const g = groundAt(cam, width, height, (gx / gw) * width * 1.1 - width * 0.05, (gy / gh) * height * 1.1 - height * 0.05)
        west = Math.min(west, g.x)
        east = Math.max(east, g.x)
        north = Math.min(north, g.y)
        south = Math.max(south, g.y)
        const z = Math.max(0, Math.min(maxzoom, Math.round(cam[2] + 1 - Math.log2(Math.max(0.25, g.rel))) + extra))
        const n = 2 ** z
        const tx = Math.floor(g.x * n)
        const ty = Math.floor(g.y * n)
        for (let ax = -ring; ax <= ring; ax++) {
          for (let ay = -ring; ay <= ring; ay++) {
            let x = (((tx + ax) % n) + n) % n
            let y = ty + ay
            if (y < 0 || y >= n) continue
            for (let zz = z; zz >= 0; zz--) {
              keys.add(`${zz}/${x}/${y}`)
              x >>= 1
              y >>= 1
            }
          }
        }
      }
    }
  }
  const clampY = (y: number): number => Math.min(0.999, Math.max(0.001, y))
  return { keys, box: { west: lonOf(Math.max(0, west)), east: lonOf(Math.min(1, east)), north: latOf(clampY(north)), south: latOf(clampY(south)) } }
}
