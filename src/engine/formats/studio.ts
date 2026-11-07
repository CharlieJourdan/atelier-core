// The motion studio card « studio » (decision 0111, research note motion-studio-2026-11 (old repository)): a full-frame, opaque scene drawn by three.js
// (MIT) in our motion page (motion/studio.ts, motion/studio-runtime.ts), a pure function of time like every template (seek(t), closed-form
// springs, a seeded random). One schema covers the two kinds of « premium » motion the analysis meets:
//   - 2D motion design in a channel's look (glowing numbers that count, bars that grow, glossy blocks that drop onto a stack, branching
//     curves, dot grids, pills): a perspective camera facing the plane z = 0, where one world unit is one sixteenth of the frame's width;
//   - Blender-like 3D: extruded type, hero objects (a glass vault, coins, ingots), a lit terrain with a river, a city that grows house by
//     house, camera moves through keys, soft shadows, fog.
// The look (`look`) is the MEASURED motion style of a channel (motion/studio-style.ts turns the analysis' palette, fonts, texture and
// easing into it). Times (`atS`, `outS`) are seconds from the START OF THE CARD.
import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const text = (max: number) => z.string().trim().min(1).max(max)
const t = z.number().min(0).max(60)
export const Vec3 = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500), z.number().min(-500).max(500)])
export type Vec3 = z.infer<typeof Vec3>
const Vec2 = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)])

/** Colours by role: items name a role, the look gives its colour (so one scene changes channel by changing its look). */
export const STUDIO_ROLES = ['fg', 'muted', 'accent', 'accent2', 'cool', 'panel', 'dark', 'gold', 'ground', 'grass', 'water', 'roof', 'wall', 'tree'] as const
export const StudioRole = z.enum(STUDIO_ROLES)
export type StudioRole = z.infer<typeof StudioRole>

/** A closed-form damped spring (stiffness k, damping d, unit mass): k 170 / d 26 is the default, lower d overshoots. */
export const Spring = z.object({ k: z.number().min(10).max(2000), d: z.number().min(1).max(200) })

export const StudioFaceId = z.enum(['wide', 'sans', 'semi', 'condensed', 'serif'])

export const StudioLook = z.object({
  background: z
    .object({
      /** `vignette` = a lit spot fading to the edges (the dark data scenes), `gradient` = top to bottom, `flat`, `sky` (3D: a sky with fog). */
      kind: z.enum(['vignette', 'gradient', 'flat', 'sky']).default('vignette'),
      top: hex.default('#141c33'),
      bottom: hex.default('#05070d'),
      /** The spot's colour (vignette). */
      spot: hex.optional(),
      /** Where the spot sits, in fractions of the frame (0.5, 0.4 = a little above the centre). */
      spotAt: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.42])
    })
    .default({ kind: 'vignette', top: '#141c33', bottom: '#05070d', spotAt: [0.5, 0.42] }),
  palette: z
    .object({
      fg: hex.default('#f2f3f7'),
      muted: hex.default('#8d93a8'),
      accent: hex.default('#f6a465'),
      accent2: hex.default('#ffe1bd'),
      cool: hex.default('#3b5bd6'),
      panel: hex.default('#1a2140'),
      dark: hex.default('#0b0f1c'),
      gold: hex.default('#d8a74a'),
      ground: hex.default('#8a6f55'),
      grass: hex.default('#4f8a35'),
      water: hex.default('#8c9a8a'),
      roof: hex.default('#c8502e'),
      wall: hex.default('#e8dcc2'),
      tree: hex.default('#2f5a24')
    })
    .prefault({}),
  /** The display face (OFL fonts of resources/fonts): `wide` Montserrat ExtraBold, `sans` Inter Bold, `semi` Inter SemiBold, `condensed` Oswald, `serif`. */
  face: StudioFaceId.default('wide'),
  /** The small labels' face. */
  labelFace: StudioFaceId.default('semi'),
  /** Soft glow around emissive things (numbers, bars, curves), 0 = none. */
  glow: z.number().min(0).max(1).default(0.5),
  /** Film grain over the frame, 0 = none. */
  grain: z.number().min(0).max(0.2).default(0.035),
  /** Darkening of the frame's corners. */
  vignette: z.number().min(0).max(1).default(0.45),
  springs: z
    .object({ ui: Spring.default({ k: 320, d: 30 }), type: Spring.default({ k: 170, d: 26 }), heavy: Spring.default({ k: 90, d: 19 }) })
    .default({ ui: { k: 320, d: 30 }, type: { k: 170, d: 26 }, heavy: { k: 90, d: 19 } }),
  /** Seconds between the parts of one item (letters of a count, blocks of a stack, branches of a tree). */
  stagger: z.number().min(0).max(0.6).default(0.12),
  /** `studio` = soft reflections from a lit room (glossy data scenes), `rim` = coloured lights behind (a hero object), `sun` = daylight with shadows (terrain, city). */
  light: z.enum(['studio', 'rim', 'sun']).default('studio'),
  exposure: z.number().min(0.2).max(3).default(1),
  shadows: z.boolean().default(false),
  /** Haze towards the horizon (3D). */
  fog: z.object({ color: hex, near: z.number().min(0).max(2000), far: z.number().min(1).max(4000) }).optional()
})
export type StudioLook = z.infer<typeof StudioLook>

export const StudioCameraKey = z.object({ atS: t, pos: Vec3, target: Vec3.default([0, 0, 0]) })
export const StudioCamera = z
  .object({
    /** Vertical field of view, degrees. */
    fov: z.number().min(8).max(90).default(30),
    /** Default: facing the plane z = 0 from where it spans 16 units across. */
    keys: z.array(StudioCameraKey).min(1).max(12).optional(),
    /** `glide` = eased in and out over each move, `spring` = a heavy spring towards each key, `linear` = even speed (a timelapse drift). */
    ease: z.enum(['glide', 'spring', 'linear']).default('glide'),
    /** A slow handheld float (world units), 0 = locked off. */
    drift: z.number().min(0).max(2).default(0)
  })
  .default({ fov: 30, ease: 'glide', drift: 0 })
export type StudioCamera = z.infer<typeof StudioCamera>

/** How an item arrives: `rise` (up and in), `pop` (a spring from small), `zoom` (from large and soft, onto its place), `fade`, `drop` (falls
 * from `from` onto its place), `grow` (bars, blocks: up from their base), `draw` (curves), `none`. */
export const StudioEnter = z.enum(['rise', 'pop', 'zoom', 'fade', 'drop', 'grow', 'draw', 'none'])
/** A later place the item glides to (a spring), seconds from the card's start. */
export const StudioMove = z.object({ atS: t, at: Vec3 })
const base = {
  atS: t.default(0),
  /** When it leaves (fades out), seconds from the card's start; missing = stays. */
  outS: t.optional(),
  at: Vec3.default([0, 0, 0]),
  /** Attached to the screen, not the world (titles over a 3D flight): x −8…8, y −4.5…4.5. */
  screen: z.boolean().default(false),
  moves: z.array(StudioMove).max(8).default([])
}
const align = z.enum(['left', 'center', 'right']).default('center')

export const StudioText = z.object({
  kind: z.literal('text'),
  ...base,
  text: text(80),
  /** Font size in world units (16 = the frame's width in a 2D scene). */
  size: z.number().min(0.05).max(40).default(1),
  face: StudioFaceId.optional(),
  role: StudioRole.default('fg'),
  /** The top's colour (a gradient over the capitals). */
  role2: StudioRole.optional(),
  /** Extrusion depth (world units): 0 = flat type. */
  depth: z.number().min(0).max(20).default(0),
  align,
  glow: z.boolean().default(false),
  /** Letter spacing, in em. */
  tracking: z.number().min(-0.1).max(0.6).default(0),
  enter: StudioEnter.default('rise'),
  opacity: z.number().min(0).max(1).default(1),
  /** A soft dark shadow under the type (titles over a bright 3D picture). */
  shadow: z.boolean().default(false),
  /** Words written first in another colour (a caption's « Late Roman era »). */
  lead: text(40).optional(),
  leadRole: StudioRole.default('gold')
})
export const StudioCounter = z.object({
  kind: z.literal('counter'),
  ...base,
  from: z.number().finite().default(0),
  to: z.number().finite(),
  decimals: z.number().int().min(0).max(3).default(0),
  prefix: z.string().max(12).default(''),
  /** Written after the number, smaller (« Mds $ », « % »). */
  suffix: z.string().max(16).default(''),
  suffixScale: z.number().min(0.2).max(1).default(0.5),
  /** Thousands separator (French: a narrow no-break space); '' = none (a year). */
  group: z.string().max(2).default(' '),
  countS: z.number().min(0).max(30).default(1.2),
  /** A count through several values at even speed between them ([atS, value], a timelapse's year), instead of from → to. */
  keys: z.array(z.tuple([t, z.number().finite()])).min(2).max(20).optional(),
  size: z.number().min(0.05).max(40).default(1.6),
  face: StudioFaceId.optional(),
  role: StudioRole.default('accent'),
  /** The top's colour (a gradient over the digits; default: accent2 on an accent number). */
  role2: StudioRole.optional(),
  /** The suffix's colour (default: the number's). */
  suffixRole: StudioRole.optional(),
  depth: z.number().min(0).max(20).default(0),
  align,
  glow: z.boolean().default(true),
  enter: StudioEnter.default('fade'),
  shadow: z.boolean().default(false)
})
export const StudioBar = z.object({
  kind: z.literal('bar'),
  ...base,
  /** Width, full height, depth (world units); `at` is the middle of its base. */
  size: Vec3,
  /** The share of the full height it grows to. */
  fill: z.number().min(0).max(1).default(1),
  /** `y` grows up, `x` grows right (`at` is then the middle of its left end). */
  axis: z.enum(['y', 'x']).default('y'),
  growS: z.number().min(0).max(20).default(0.9),
  role: StudioRole.default('accent'),
  /** The far end's colour (a gradient along the bar). */
  role2: StudioRole.optional(),
  /** A dim track the bar fills (a progress bar). */
  track: z.boolean().default(false),
  radius: z.number().min(0).max(5).default(0.08),
  glow: z.boolean().default(true),
  enter: StudioEnter.default('grow')
})
export const StudioBlock = z.object({
  kind: z.literal('block'),
  ...base,
  size: Vec3,
  role: StudioRole.default('cool'),
  role2: StudioRole.optional(),
  radius: z.number().min(0).max(5).default(0.1),
  label: text(40).optional(),
  labelRole: StudioRole.default('fg'),
  labelSize: z.number().min(0.05).max(10).default(0.28),
  labelFace: StudioFaceId.optional(),
  /** A small icon on its face. */
  icon: z.enum(['none', 'case', 'lock']).default('none'),
  material: z.enum(['glossy', 'glass', 'matte', 'metal']).default('glossy'),
  /** A thin light outline (a glass card, a pill). */
  edge: z.boolean().default(false),
  /** A soft halo behind it in its top colour. */
  glow: z.boolean().default(false),
  /** Where a `drop` or `rise` starts, relative to `at`. */
  from: Vec3.default([0, 2.5, 0]),
  enter: StudioEnter.default('pop')
})
export const StudioCurve = z.object({
  kind: z.literal('curve'),
  ...base,
  /** Branches from `at` to each end, drawn one after the other (look.stagger). */
  to: z.array(Vec3).min(1).max(10),
  drawS: z.number().min(0.05).max(10).default(0.7),
  /** How far the branch bends (0 = straight). */
  bend: z.number().min(0).max(1).default(0.6),
  width: z.number().min(0.005).max(1).default(0.035),
  role: StudioRole.default('accent2'),
  /** The colour at the branches' ends (a gradient along each). */
  role2: StudioRole.optional(),
  glow: z.boolean().default(true),
  enter: StudioEnter.default('draw')
})
export const StudioObject = z.object({
  kind: z.literal('object'),
  ...base,
  shape: z.enum(['vault', 'cube', 'coin', 'ingot', 'sphere', 'cylinder', 'tower']),
  size: z.number().min(0.05).max(100).default(2),
  role: StudioRole.default('cool'),
  /** `frost` = frosted glass that lets the light through (transmission: slower, a hero object). */
  material: z.enum(['glass', 'frost', 'metal', 'gold', 'glossy', 'matte']).default('glass'),
  /** Start rotation, degrees. */
  rot: Vec3.default([0, 0, 0]),
  /** Turn, degrees a second. */
  spin: Vec3.default([0, 0, 0]),
  enter: StudioEnter.default('pop')
})
export const StudioDots = z.object({
  kind: z.literal('dots'),
  ...base,
  cols: z.number().int().min(1).max(40),
  rows: z.number().int().min(1).max(40),
  gap: z.number().min(0.05).max(10).default(0.42),
  size: z.number().min(0.02).max(5).default(0.28),
  icon: z.enum(['dot', 'drop', 'cube', 'coin']).default('dot'),
  /** The share lit (from the bottom row up, left to right). */
  share: z.number().min(0).max(1),
  fillS: z.number().min(0).max(20).default(1.6),
  role: StudioRole.default('accent'),
  offRole: StudioRole.default('panel'),
  glow: z.boolean().default(true),
  enter: StudioEnter.default('fade')
})
/** Ground, hills, a river and an island: the floor of a 3D place (x/z plane, y up). */
export const StudioTerrain = z.object({
  kind: z.literal('terrain'),
  ...base,
  size: z.number().min(10).max(2000).default(200),
  seed: z.number().int().min(0).max(1e6).default(1),
  /** Height of the gentle hills (world units). */
  hills: z.number().min(0).max(50).default(2),
  /** The river's middle line, points (x, z); its width. */
  river: z.array(Vec2).min(2).max(40).optional(),
  riverWidth: z.number().min(0.5).max(200).default(12),
  /** Bare ground inside the river (an island, the city's plot), points (x, z). */
  island: z.array(Vec2).min(3).max(60).optional(),
  /** Bare earth (a town's plot), points (x, z); default: the whole island. */
  bare: z.array(Vec2).min(3).max(60).optional(),
  trees: z.number().int().min(0).max(12000).default(400),
  enter: StudioEnter.default('none')
})
/** A town that grows house by house on a plot, then a wall that rings it. */
export const StudioCity = z.object({
  kind: z.literal('city'),
  ...base,
  seed: z.number().int().min(0).max(1e6).default(7),
  /** Where the houses go, points (x, z). */
  area: z.array(Vec2).min(3).max(60),
  /** Houses at the end; they arrive one by one over `growS`. */
  count: z.number().int().min(1).max(3000).default(120),
  /** Houses already standing at `atS`. */
  startCount: z.number().int().min(0).max(3000).default(0),
  growS: z.number().min(0).max(60).default(8),
  /** `villa` = four wings around a green courtyard (a Roman town), `house` = one block under a hip roof. */
  style: z.enum(['house', 'villa']).default('house'),
  /** Room between two houses (world units). */
  gap: z.number().min(0).max(30).default(0.9),
  /** Size of a house (world units): footprint and wall height, ranges. */
  house: z.object({ w: Vec2.default([1.6, 3]), d: Vec2.default([1.4, 2.4]), h: Vec2.default([0.9, 1.6]) }).default({ w: [1.6, 3], d: [1.4, 2.4], h: [0.9, 1.6] }),
  /** A ring wall along the plot's edge, built from `wallAtS` over `wallS`. */
  wallAtS: t.optional(),
  wallS: z.number().min(0.1).max(30).default(3),
  wallHeight: z.number().min(0.2).max(30).default(1.4),
  /** A tower at least every so many units of wall. */
  towerEvery: z.number().min(1).max(200).default(8),
  enter: StudioEnter.default('pop')
})

export const StudioItem = z.discriminatedUnion('kind', [StudioText, StudioCounter, StudioBar, StudioBlock, StudioCurve, StudioObject, StudioDots, StudioTerrain, StudioCity])
export type StudioItem = z.infer<typeof StudioItem>
export type StudioItemInput = z.input<typeof StudioItem>

export const StudioProps = z.object({
  look: StudioLook.prefault({}),
  camera: StudioCamera,
  items: z.array(StudioItem).min(1).max(80)
})
export type StudioProps = z.infer<typeof StudioProps>
export type StudioPropsInput = z.input<typeof StudioProps>

/** The characters an item writes (the page needs their outlines). */
export function studioChars(p: StudioProps): { face: z.infer<typeof StudioFaceId>; chars: string }[] {
  const out: { face: z.infer<typeof StudioFaceId>; chars: string }[] = []
  for (const it of p.items) {
    if (it.kind === 'text') out.push({ face: it.face ?? p.look.face, chars: it.text + (it.lead ?? '') })
    if (it.kind === 'counter') out.push({ face: it.face ?? p.look.face, chars: `0123456789-,.${it.group}${it.prefix}${it.suffix}` })
    if (it.kind === 'text' && it.shadow) out.push({ face: it.face ?? p.look.face, chars: it.text })
    if (it.kind === 'block' && it.label) out.push({ face: it.labelFace ?? p.look.labelFace, chars: it.label })
  }
  return out
}

/** Problems of a studio card `seconds` long (times that land after its end, a camera key out of order). */
export function studioProblems(p: StudioProps, seconds: number): string[] {
  const out: string[] = []
  p.items.forEach((it, i) => {
    if (it.atS > seconds - 0.2) out.push(`motion studio: item ${i + 1} (${it.kind}) starts at ${it.atS.toFixed(1)} s, too late for a ${seconds.toFixed(1)} s card`)
    if (it.outS !== undefined && it.outS <= it.atS) out.push(`motion studio: item ${i + 1} leaves before it arrives`)
  })
  const keys = p.camera.keys ?? []
  for (let i = 1; i < keys.length; i++) if ((keys[i]?.atS ?? 0) < (keys[i - 1]?.atS ?? 0)) out.push(`motion studio: camera key ${i + 1} is earlier than key ${i}`)
  return out
}

/** A glyph's advance (em) and outline path in em units, y up (motion/studio-font.ts). */
export interface StudioGlyph {
  adv: number
  d: string
}
export interface StudioGlyphSet {
  face: string
  ascent: number
  glyphs: Record<string, StudioGlyph>
}
/** What the page of a studio card needs beyond its spec (prepared in Node by motion/studio.ts, never written in the plan). */
export interface StudioAssets {
  lib: { core: string; main: string; version: string }
  fonts: Record<string, StudioGlyphSet>
}
