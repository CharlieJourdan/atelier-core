// The moving map (motion-montage, docs/ENGINE-SPEC.md §25.4): a documentary map card whose camera goes through keys — frame a region,
// centre a place, follow a route's head along its curve while it draws — and whose static world is drawn ONCE. The card is split in two pages of the same
// template (map-card.ts): the WORLD (the Earth, borders, regions, routes, names, pins) drawn large at a fixed camera, photographed only on
// the frames where something in it changes (motion/fast.ts), and the HUD (title, vignette) drawn at the frame's size with alpha. ffmpeg then
// moves the camera over the world (render/camera.ts: the same eased pan as a still's) and lays the HUD on top. The browser draws a few
// hundred frames of a 20 s map instead of 600, the camera is CPU work anyone can do (a server, no GPU), and the camera can have any number
// of keys.
import { rm } from 'node:fs/promises'
import { z } from 'zod'
import { DOC_PALETTE, MapCameraKey, MapCardProps, type CardAssets, type GeoBox } from '../formats/cards'
import type { CameraKey } from '../formats/editplan'
import { FPS } from '../formats/timing'
import type { BrowserService, MediaService } from '../services'
import { cameraFilter } from '../render/camera'
import { runFfmpeg } from '../render/segments'
import { pageHtml, themeOf, type MotionCtx } from './base'
import { docStyleOf } from './doc-parchment'
import { renderFast } from './fast'
import { curveLength, fitView, midCos, pointAlong, prepareMapAssets, routeCurve, routeEase, type PrepareOptions } from './geo'
import { mapCard, routePoints, routeSeconds, routeTimes } from './map-card'
import { CARD_ENCODER, MOTION_ENCODER } from './render'

/** The moving map's drawing version (part of its cache key). */
export const MAP_MOVE_VERSION = 2

/** A map card with a camera of keys (formats/cards.ts `MapCameraKey`; a followed route: the camera rides its head along the curve while it draws, at `zoom`, default 1.8). */
export const MapMoveProps = MapCardProps.extend({ camera: z.array(MapCameraKey).min(1).max(10) })
export type MapMoveProps = z.infer<typeof MapMoveProps>

/** Camera keys laid along a followed route's head (it glides through them at an even speed between them). */
const FOLLOW_SAMPLES = 10

/** The world box of the whole move: every key's view, place, followed route (and the card's own parts when nothing else is given). */
export function worldBox(p: MapMoveProps): GeoBox {
  const pts: { lon: number; lat: number }[] = []
  for (const k of p.camera) {
    if (k.view) pts.push({ lon: k.view.west, lat: k.view.south }, { lon: k.view.east, lat: k.view.north })
    if (k.place) pts.push(k.place)
    const r = k.follow !== undefined ? p.routes[k.follow] : undefined
    if (r) pts.push(r.from, ...(r.via ?? []), r.to)
  }
  for (const pin of p.pins) pts.push(pin)
  if (p.view) pts.push({ lon: p.view.west, lat: p.view.south }, { lon: p.view.east, lat: p.view.north })
  const lons = pts.map((x) => x.lon)
  const lats = pts.map((x) => x.lat)
  if (pts.length === 0) return { west: -25, south: 30, east: 50, north: 72 }
  const pad = (a: number, b: number): number => Math.max(1, (b - a) * 0.15)
  const w = Math.min(...lons)
  const e = Math.max(...lons)
  const s = Math.min(...lats)
  const n = Math.max(...lats)
  return { west: Math.max(-180, w - pad(w, e)), east: Math.min(180, e + pad(w, e)), south: Math.max(-85, s - pad(s, n)), north: Math.min(85, n + pad(s, n)) }
}

/**
 * The camera keys on the world picture (0..1 of it, zoom 1 = all of it), from the card's keys; `sv` is the world's view (its aspect is the
 * frame's), `aspect` the frame's. A followed route's camera rides its head: the head's place (the page's curve, `path` in 0..1 of the
 * world, or the same curve made here from the props; the page's ease) sampled from when it starts drawing until it arrives (or until a
 * second before the next key): keys the camera glides through at an even speed.
 */
export function cameraKeys(p: MapMoveProps, sv: GeoBox, aspect: number, routeTimes: { start: number; end: number; path?: number[] }[]): CameraKey[] {
  const cos = midCos(sv)
  const W = sv.east - sv.west
  const H = sv.north - sv.south
  const at = (lon: number, lat: number): { x: number; y: number } => ({ x: (lon - sv.west) / W, y: (sv.north - lat) / H })
  const keys: CameraKey[] = []
  const order = [...p.camera].sort((a, b) => a.atS - b.atS)
  for (const k of p.camera) {
    if (k.view) {
      const v = fitView(k.view, aspect, 0, { cosLat: cos })
      const c = at((v.west + v.east) / 2, (v.south + v.north) / 2)
      keys.push({ atS: k.atS, ...c, zoom: Math.min(6, Math.max(1, W / (v.east - v.west))) })
    } else if (k.place) keys.push({ atS: k.atS, ...at(k.place.lon, k.place.lat), zoom: k.zoom ?? 2 })
    else if (k.follow !== undefined) {
      const r = p.routes[k.follow]
      const t = routeTimes[k.follow]
      if (!r || !t) continue
      const path = t.path ?? followPath([r.from, ...(r.via ?? []), r.to].map((q) => at(q.lon, q.lat)), aspect)
      const head = (s: number): { x: number; y: number } => pointAlong(path, routeEase((s - t.start) / Math.max(1e-6, t.end - t.start)))
      const zoom = k.zoom ?? 1.8
      const from = Math.max(k.atS, t.start)
      const next = order.find((o) => o.atS > k.atS)
      const until = Math.min(t.end, next ? next.atS - 1 : Infinity)
      keys.push({ atS: from, ...head(from), zoom })
      if (until > from + 0.2) {
        for (let j = 1; j <= FOLLOW_SAMPLES; j++) {
          const s = from + ((until - from) * j) / FOLLOW_SAMPLES
          keys.push({ atS: s, ...head(s), zoom, ease: 'linear' })
        }
      }
    }
  }
  keys.sort((a, b) => a.atS - b.atS)
  // the camera is at the first key from the start, and holds the last one to the end
  if (keys.length === 1) keys.push({ ...(keys[0] as CameraKey), atS: (keys[0] as CameraKey).atS + 0.1 })
  return keys.map((k) => ({ ...k, x: Math.min(1, Math.max(0, k.x)), y: Math.min(1, Math.max(0, k.y)) }))
}

/** A route's curve in 0..1 of the world from its points in 0..1 (made in pixel proportions, as the page makes it: the same shape). */
function followPath(pts: { x: number; y: number }[], aspect: number): number[] {
  return routeCurve(pts.map((q) => ({ x: q.x * aspect, y: q.y }))).flatMap((q) => [q.x / aspect, q.y])
}

/** The size of the world page of a moving map drawn at `scale` × the frame. */
const worldSize = (c: { width: number; height: number }, scale: number): { width: number; height: number } => ({ width: Math.round(c.width * scale), height: Math.round(c.height * scale) })

/** The two pages of a moving map: the world (opaque, at `scale` × the frame) and the HUD (the frame's size, transparent). */
export function mapMovePages(p: MapMoveProps, c: MotionCtx, worldAssets: CardAssets, accent: string, theme: 'dark' | 'light', scale: number): { world: string; hud: string } {
  const look = docStyleOf(theme, accent)
  const t = themeOf(accent, theme)
  const card = MapCardProps.parse({ ...p, view: undefined, zoomTo: undefined, camera: undefined })
  const wc: MotionCtx = { ...c, ...worldSize(c, scale) }
  const world = mapCard(card, wc, worldAssets, look)
  const hud = mapCard(card, c, {}, look)
  // the world without its title block and its frame shading; the HUD with nothing but them (over a clear page)
  const worldCss = `${world.css}\n.hd,.corner,.vig{display:none!important}`
  const hudCss = `${hud.css}\nbody{background:transparent!important}.mbg{display:none!important}`
  return { world: pageHtml(wc, t, accent, worldCss, world.body), hud: pageHtml(c, t, accent, hudCss, hud.body) }
}

export interface MapMoveResult {
  /** Frames the browser photographed (world + HUD) out of the frames of the card × 2. */
  shot: number
  frames: number
  keys: CameraKey[]
  warnings: string[]
}

/** Draws a moving map card to `out` (H.264, opaque, like the other cards). */
export async function renderMapMove(o: {
  browser: BrowserService
  media: MediaService
  props: MapMoveProps
  accent?: string
  theme?: 'dark' | 'light'
  width: number
  height: number
  frames: number
  fontCss: string
  out: string
  signal: AbortSignal
  prepare: Omit<PrepareOptions, 'width' | 'height' | 'media' | 'signal'>
}): Promise<MapMoveResult> {
  const p = MapMoveProps.parse(o.props)
  const accent = o.accent ?? DOC_PALETTE.red
  const theme = o.theme ?? 'dark'
  const aspect = o.width / o.height
  const box = worldBox(p)
  const sv = fitView(box, aspect, 0)
  // the zooms of the keys (the routes' times do not change them)
  const most = Math.max(...cameraKeys(p, sv, aspect, p.routes.map(() => ({ start: 0, end: 1 }))).map((k) => k.zoom))
  // the world is drawn as large as the camera's deepest zoom needs, up to twice the frame
  const scale = Math.min(2, Math.max(1, most / 1.25))
  const ww = 2 * Math.round((o.width * scale) / 2)
  const wh = 2 * Math.round((o.height * scale) / 2)
  const map = await prepareMapAssets(MapCardProps.parse({ ...p, view: sv, zoomTo: undefined, camera: undefined }), { ...o.prepare, width: ww, height: wh, media: o.media, signal: o.signal })
  // a still world: the card's own camera does not move (ffmpeg's does)
  const still = { ...map, end: { ...map.start } }
  const ctx = { width: o.width, height: o.height, durationS: o.frames / FPS, fontCss: o.fontCss }
  const ws = worldSize(ctx, scale)
  // a followed route is paced by its length on screen (the camera's zoom makes it longer than on the world): calm under the camera
  const k1080 = Math.min(ws.width, ws.height) / 1080
  const paced: MapMoveProps = {
    ...p,
    routes: p.routes.map((r, i) => {
      const zoom = Math.max(0, ...p.camera.filter((k) => k.follow === i).map((k) => k.zoom ?? 1.8))
      const g = still.routes[i]
      return r.drawS !== undefined || zoom === 0 || !g ? r : { ...r, drawS: routeSeconds((curveLength(routePoints(g)) / k1080) * zoom) }
    })
  }
  // the routes' times and curves exactly as the world page draws them, so the camera rides the head
  const card = MapCardProps.parse({ ...paced, view: undefined, zoomTo: undefined, camera: undefined })
  const times = routeTimes(card, still, { ...ws, durationS: ctx.durationS })
  const keys = cameraKeys(
    paced,
    sv,
    aspect,
    times.map((t, i) => ({ start: t.start, end: t.start + t.dur, path: routePoints(still.routes[i] as (typeof still.routes)[number]).map((v, j) => v / (j % 2 ? still.height : still.width)) }))
  )
  const pages = mapMovePages(paced, ctx, { map: still }, accent, theme, scale)
  const worldFile = `${o.out}.world.mp4`
  const hudFile = `${o.out}.hud.mov`
  try {
    const lossless = ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv444p']
    const w = await renderFast({ browser: o.browser, media: o.media, html: pages.world, width: ww, height: wh, frames: o.frames, out: worldFile, signal: o.signal, encoder: lossless, opaque: true, quality: 94 })
    const h = await renderFast({ browser: o.browser, media: o.media, html: pages.hud, width: o.width, height: o.height, frames: o.frames, out: hudFile, signal: o.signal, encoder: MOTION_ENCODER })
    const cam = cameraFilter({ kind: 'pan', from: 1, to: 1, keys }, o.frames)
    const graph = `[0:v]format=yuv444p,${cam},scale=${o.width}:${o.height}:flags=lanczos[w];[w][1:v]overlay=0:0:format=auto,format=yuv420p[v]`
    await runFfmpeg(o.media, ['-v', 'error', '-y', '-i', worldFile, '-i', hudFile, '-filter_complex', graph, '-map', '[v]', '-frames:v', String(o.frames), '-r', String(FPS), ...CARD_ENCODER, o.out], o.out, o.signal)
    return { shot: w.shot + h.shot, frames: o.frames, keys, warnings: map.warnings ?? [] }
  } finally {
    await rm(worldFile, { force: true })
    await rm(hudFile, { force: true })
  }
}
