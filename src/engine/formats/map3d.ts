// The 3D map card « map3d » (research note maps-reference-2026-11 (old repository)): a full-frame, opaque map drawn by MapLibre GL JS in the motion page
// (motion/map3d.ts) on a tilted, lit terrain: NASA Blue Marble imagery (or a parchment), Natural Earth borders, regions shaded or raised
// (extruded), pins with callouts, routes drawn on the ground, spaced names, and a camera that flies through keys {atS, center, zoom, pitch,
// bearing} or follows a route while it draws. Times (`atS`) are seconds from the START OF THE CARD. What the page needs beyond the spec
// (tiles, borders, the library itself) is prepared in Node by motion/map3d-data.ts as `Map3dAssets`, never written in the plan.
import { z } from 'zod'

const text = (max: number) => z.string().trim().min(1).max(max)
const at = z.number().min(0).max(120).optional()
export const LatLon3d = z.object({ lat: z.number().min(-80).max(80), lon: z.number().min(-180).max(180) })
export type LatLon3d = z.infer<typeof LatLon3d>

/** One key of the camera: where it looks (the point at the centre of the frame), how close (web-map zoom), how tilted and turned. */
export const Map3dCameraKey = z.object({
  atS: z.number().min(0).max(120),
  center: LatLon3d,
  /** Web-map zoom: 3 ≈ a continent, 5 ≈ a large country, 7 ≈ a region. */
  zoom: z.number().min(1).max(9),
  /** Tilt from straight down, degrees (0 = flat, 60 = low over the land). */
  pitch: z.number().min(0).max(70).default(45),
  /** Where the camera faces, degrees clockwise from north (0 = north up, 180 = looking south). */
  bearing: z.number().min(-360).max(360).default(0)
})
export type Map3dCameraKey = z.infer<typeof Map3dCameraKey>

/** How the camera moves between two keys: `push` = the measured documentary push (fast start, long settle), `inOut` = symmetric, `linear`. */
export const MAP3D_EASES = ['push', 'inOut', 'linear'] as const
export const Map3dCamera = z
  .object({
    keys: z.array(Map3dCameraKey).min(1).max(8).optional(),
    /** Follow route `route` while it draws (the camera centred on its head), at this zoom / pitch; the keys, if any, frame the rest. */
    follow: z.object({ route: z.number().int().min(0).max(5), zoom: z.number().min(1).max(9), pitch: z.number().min(0).max(70).default(50), bearing: z.number().min(-360).max(360).default(0) }).optional(),
    ease: z.enum(MAP3D_EASES).default('push'),
    /** After the last key, the slow push that never quite stops (zoom levels a second; the reference keeps ≈ 0.007). */
    drift: z.number().min(0).max(0.1).default(0.007)
  })
  .refine((c) => c.keys !== undefined || c.follow !== undefined, { message: 'needs keys or follow' })
  .refine((c) => !c.keys || c.keys.every((k, i, a) => i === 0 || k.atS > (a[i - 1] as Map3dCameraKey).atS), { message: 'keys must be in time order' })
export type Map3dCamera = z.infer<typeof Map3dCamera>

export const MAP3D_TONES = ['red', 'gold', 'pale'] as const
export const MAP3D_LOOKS = ['satellite', 'parchment'] as const

export const Map3dProps = z.object({
  /** Small red capitals above the title (a date: « 1940 »). */
  kicker: text(40).optional(),
  title: text(60),
  /** satellite: the dark Blue Marble of the reference; parchment: an old paper map with the same relief. */
  look: z.enum(MAP3D_LOOKS).default('satellite'),
  camera: Map3dCamera,
  /** How much the relief is raised (1 = true height). */
  exaggeration: z.number().min(0).max(6).default(1.8),
  /** Countries shaded (ISO alpha-3 codes or English / French names); `raise` lifts them (km) as they appear; outline first, fill after. */
  regions: z
    .array(
      z.object({
        countries: z.array(text(60)).min(1).max(60),
        tone: z.enum(MAP3D_TONES).default('red'),
        label: text(40).optional(),
        /** Height of the raised country (km, 0 = flat). */
        raise: z.number().min(0).max(80).default(0),
        atS: at
      })
    )
    .max(6)
    .default([]),
  /** Places with a red dot and a tag (« BERLIN »), an optional note under it. */
  pins: z.array(LatLon3d.extend({ label: text(40), note: text(90).optional(), atS: at })).max(8).default([]),
  /** Red lines drawn on the ground from one place to another (through `via`), with a head that travels; `drawS` = how long it takes. */
  routes: z
    .array(z.object({ from: LatLon3d, to: LatLon3d, via: z.array(LatLon3d).max(8).default([]), label: text(40).optional(), atS: at, drawS: z.number().min(0.3).max(20).optional() }))
    .max(6)
    .default([]),
  /** Spaced italic capitals written on the land (country, region or sea names). */
  names: z.array(LatLon3d.extend({ text: text(30), atS: at })).max(12).default([]),
  /** Short facts in boxes at the lower right (« 26 CANTONS »), each on its word. */
  facts: z.array(z.object({ text: text(30), atS: at })).max(4).default([])
})
export type Map3dProps = z.infer<typeof Map3dProps>
export type Map3dPropsInput = z.input<typeof Map3dProps>

/** What the page needs beyond the spec, prepared in Node (motion/map3d-data.ts). */
export interface Map3dAssets {
  /** The library (MapLibre GL JS, BSD-3-Clause) main module and worker, as text. */
  lib: { main: string; worker: string; version: string }
  /** Tiles by key `<layer>/<z>/<x>/<y>` as base64 (imagery JPEG, terrain PNG in Terrarium encoding). */
  tiles: Record<string, string>
  /** The deepest zoom of each tile layer that was prepared. */
  maxzoom: { sat: number; dem: number }
  /** Country borders in the area (GeoJSON MultiLineString coordinates), and each region's polygons (GeoJSON MultiPolygon coordinates). */
  borders: number[][][]
  regions: number[][][][][]
  /** The parchment look only: every country's land in the area (GeoJSON MultiPolygon coordinates). */
  land?: number[][][][]
  /** Where each region's label sits [lon, lat]. */
  labels: ([number, number] | null)[]
  /** Each route as a polyline [lon, lat][] (great circles through the via points). */
  routes: [number, number][][]
  /** The camera of every frame [lon, lat, zoom, pitch, bearing] (FPS a second, from 0 to the end of the card, both included). */
  frames: number[][]
  /** The ground the camera sees along its whole path (degrees): where the page lays its clouds. */
  box: { west: number; south: number; east: number; north: number }
  /** The faces of the map's own type (Barlow, OFL) as @font-face rules. */
  fontCss: string
  /**
   * Raise the relief even when WebGL runs in software (SwiftShader: a CPU-only server). Off by default: there a raised terrain costs about
   * 4 s a frame at 1080p, so the map is drawn on a flat tilted Earth (the imagery keeps its own shading, the hillshade stays).
   */
  terrainOnSoftware?: boolean
  /** Credits of the data drawn. */
  credits: string[]
  warnings?: string[]
}
