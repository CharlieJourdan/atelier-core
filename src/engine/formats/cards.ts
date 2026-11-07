// The documentary cards (style-markets, research note style-markets-of-the-past-2026-11 (old repository)): full-frame motion graphics that ARE the
// shot (the base track), not an overlay. Four templates, each a spec the director writes and `motion.render` draws, opaque:
//   archive   — a found picture in a frame: full frame with a caption box, a print on a dark board, a document on graph paper, an old
//               television; optional word punch, lines of text, a typed excerpt with a red mark, a quote beside the print;
//   map       — a dark satellite Earth (NASA Blue Marble, public domain) with country borders (Natural Earth, public domain): regions shaded,
//               pins with callouts, routes drawn between places, a camera that pushes from one view to another;
//   bars      — a data card on a dark warped grid: rows whose bars grow and values count up on their words;
//   timeline  — a line of dated events drawn left to right, each on its word;
//   document  — a typed / printed document (or a scanned picture of one) whose phrases are highlighted, underlined, circled, boxed or struck
//               on their words, the camera following the marks;
//   chart     — animated data: a line or an area drawn left to right with a value riding its head, a donut whose slices sweep, or big
//               counters side by side.
// Times inside props (`atS`) are seconds from the START OF THE CARD. What a card needs beyond its spec (the picture's bytes, the map's
// background and borders) is prepared by `motion.render` as `CardAssets`, never written in the plan.
import { z } from 'zod'
import type { Map3dAssets } from './map3d'
import type { StudioAssets } from './studio'

const text = (max: number) => z.string().trim().min(1).max(max)
const at = z.number().min(0).max(120).optional()

export const ARCHIVE_FRAMES = ['full', 'board', 'paper', 'tv'] as const
export type ArchiveFrame = (typeof ARCHIVE_FRAMES)[number]

export const ArchiveCardProps = z.object({
  /** full: the picture fills the frame (caption box top left); board: a print on a dark board; paper: a document on graph paper; tv: an old television. */
  frame: z.enum(ARCHIVE_FRAMES).default('full'),
  /** The picture's caption (a name, a place, a title) and its second line (artist, date, source). */
  label: text(60).optional(),
  sub: text(80).optional(),
  /** A word punch: a red box with white serif capitals, from `punchAtS`. */
  punch: text(40).optional(),
  punchAtS: at,
  /** Up to three short white serif lines bottom left over the picture (« Own taxes. Own militias. »), one by one. */
  lines: z.array(text(40)).max(3).default([]),
  linesAtS: at,
  /** paper: a typed excerpt of the document beside it, with `mark` (a part of the excerpt) underlined in red from `markAtS`. */
  excerpt: text(200).optional(),
  mark: text(80).optional(),
  markAtS: at,
  /** paper / board: where the picture comes from, in small capitals (« NATIONAL ARCHIVES · 1776 »). */
  source: text(70).optional(),
  /** board: a quote beside the print (a portrait), serif, between red rules. */
  quote: text(200).optional(),
  /** The slow camera move over the card (the measured push is ≈ 3 % a second). */
  move: z.enum(['push', 'pull', 'left', 'right']).default('push')
})
export type ArchiveCardProps = z.infer<typeof ArchiveCardProps>

/** A box of the Earth in degrees (west < east, south < north; longitudes −180..180). */
export const GeoBox = z
  .object({ west: z.number().min(-180).max(180), south: z.number().min(-85).max(85), east: z.number().min(-180).max(180), north: z.number().min(-85).max(85) })
  .refine((b) => b.west < b.east && b.south < b.north, { message: 'west < east and south < north' })
export type GeoBox = z.infer<typeof GeoBox>
const LatLon = z.object({ lat: z.number().min(-85).max(85), lon: z.number().min(-180).max(180) })

export const MAP_TONES = ['red', 'gold', 'pale'] as const
export const MapCardProps = z.object({
  /** Small red capitals above the title (a date: « September 22, 1985 »). */
  kicker: text(40).optional(),
  title: text(60),
  /** The first view; missing: the regions, pins and routes, with a margin. */
  view: GeoBox.optional(),
  /** Where the camera ends (a slow push from `view`); missing: a slight push on the same view. */
  zoomTo: GeoBox.optional(),
  /** Countries shaded (ISO 3166 alpha-3 codes or English / French names, as Natural Earth writes them). */
  regions: z
    .array(z.object({ countries: z.array(text(60)).min(1).max(60), tone: z.enum(MAP_TONES).default('red'), label: text(40).optional(), atS: at }))
    .max(6)
    .default([]),
  /** Places pinned with a callout: a name and an optional note of one or two lines. */
  pins: z.array(LatLon.extend({ label: text(40), note: text(90).optional(), atS: at })).max(8).default([]),
  /**
   * Journeys drawn on the map (a message, an army, a trade route): a red path from `from` through the `via` waypoints (in order) to `to`,
   * smoothed into a curve (with no `via`, a gentle arc), that draws itself from its start with a small head riding its end; its label shows
   * when it arrives. `drawS`: how long it draws (default: from its length, ≈ 2.5–6 s).
   */
  routes: z
    .array(z.object({ from: LatLon, to: LatLon, via: z.array(LatLon).max(8).default([]), drawS: z.number().min(1).max(12).optional(), label: text(40).optional(), atS: at }))
    .max(6)
    .default([]),
  /** Spaced capitals written on the map (country, sea or language names), from the start or on their word. */
  names: z.array(LatLon.extend({ text: text(30), atS: at })).max(12).default([]),
  /**
   * motion-montage: a camera through keys instead of `view` → `zoomTo` (motion/map-move.ts: the world drawn once, the camera moved by
   * ffmpeg). Each key frames a `view`, centres a `place` at `zoom`, or `follow`s route i while it draws.
   */
  camera: z.array(z.lazy(() => MapCameraKey)).min(1).max(10).optional()
})

/** A camera key of a moving map, at `atS` (seconds of the card): exactly one of `view`, `place` (with `zoom`, 1 = the whole map) or `follow` (route index). */
export const MapCameraKey = z
  .object({ atS: z.number().min(0).max(120), view: GeoBox.optional(), place: LatLon.optional(), zoom: z.number().min(1).max(6).optional(), follow: z.number().int().min(0).max(5).optional() })
  .refine((k) => [k.view, k.place, k.follow].filter((x) => x !== undefined).length === 1, { message: 'one of view, place, follow' })
export type MapCameraKey = z.infer<typeof MapCameraKey>
export type MapCardProps = z.infer<typeof MapCardProps>

export const BarsCardProps = z.object({
  kicker: text(50).optional(),
  title: text(60),
  /** « SOURCE: … » top right. */
  source: text(60).optional(),
  rows: z
    .array(
      z.object({
        label: text(40),
        value: z.number().min(0),
        /** The value as written (« $1.7T », « 22.6 % »); missing: the number, counted up. */
        display: text(16).optional(),
        /** The row the story is about: red bar and value. */
        accent: z.boolean().default(false),
        atS: at
      })
    )
    .min(1)
    .max(6)
})
export type BarsCardProps = z.infer<typeof BarsCardProps>

export const TimelineCardProps = z.object({
  kicker: text(50).optional(),
  title: text(60),
  events: z.array(z.object({ when: text(20), label: text(60), accent: z.boolean().default(false), atS: at })).min(2).max(8)
})
export type TimelineCardProps = z.infer<typeof TimelineCardProps>

export const DOC_PAPERS = ['letter', 'newspaper', 'typed', 'parchment'] as const
/** `band` (a scanned page): the page goes pale, its key line stays bright and a red marker sweeps it (the reference's document zoom). */
export const DOC_MARK_STYLES = ['highlight', 'underline', 'circle', 'box', 'strike', 'band'] as const
/** A box on the scanned picture of a document card, as fractions of the picture (0..1). */
export const PictureRect = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.005).max(1), h: z.number().min(0.005).max(1) })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, { message: 'the rect must stay inside the picture' })
export type PictureRect = z.infer<typeof PictureRect>

export const DocumentCardProps = z
  .object({
    /** The paper the text is set on: a typed letter, a newspaper column, a typed report, a parchment. Ignored for a scanned picture. */
    paper: z.enum(DOC_PAPERS).default('typed'),
    heading: text(60).optional(),
    date: text(30).optional(),
    /** The document's body, set in the page. Missing: the card shows the shot's picture (a scan) and its marks are `rect`s. */
    text: text(700).optional(),
    /** Where the document comes from, small capitals under it. */
    source: text(70).optional(),
    marks: z
      .array(
        z.object({
          /** A part of `text` (case-insensitive; the first place it is found). */
          phrase: text(120).optional(),
          /** On a scanned picture: the box to mark, as fractions of the picture (`scan` cards: found by looking at the scan, `motion.render`). */
          rect: PictureRect.optional(),
          /** When the mark is made (seconds from the start of the card): the phrase's spoken time. */
          atS: z.number().min(0).max(120),
          style: z.enum(DOC_MARK_STYLES).default('highlight')
        })
      )
      .max(6)
      .default([]),
    /**
     * follow: the page is zoomed and the camera flies to each mark; push: a slow push in; still: nothing moves; read: the page is framed
     * on its first mark from the first frame, a slow even push (the reference: ≈ 0.7 % a second, a scan shown at reading size).
     */
    camera: z.enum(['follow', 'still', 'push', 'read']).default('follow'),
    /**
     * director-motion: the card's picture is a real scan to read: `motion.render` looks at it for the line that says `find` (the narration's
     * words) and draws it as a scan with that line marked. A scan with no such line keeps the typed `text` of this card.
     */
    scan: z.object({ find: text(320) }).optional()
  })
  .superRefine((p, ctx) => {
    p.marks.forEach((m, i) => {
      if (p.text !== undefined && m.phrase === undefined) ctx.addIssue({ code: 'custom', path: ['marks', i, 'phrase'], message: 'a mark on a typed text needs a phrase' })
      if (p.text === undefined && m.rect === undefined && p.scan === undefined) ctx.addIssue({ code: 'custom', path: ['marks', i, 'rect'], message: 'a mark on a scanned picture needs a rect' })
    })
  })
export type DocumentCardProps = z.infer<typeof DocumentCardProps>

/** The text of a document as the page sets it: spaces collapsed. */
export const docText = (s: string): string => s.replace(/\s+/g, ' ').trim()
/** Where `phrase` first appears in the document's text (case-insensitive, spaces collapsed), as [from, to) offsets of `docText(text)`; null when it does not. */
export function phraseSpan(text: string, phrase: string): [number, number] | null {
  const hay = docText(text)
  const needle = docText(phrase)
  const lo = hay.toLowerCase()
  const at = lo.length === hay.length ? lo.indexOf(needle.toLowerCase()) : hay.indexOf(needle)
  return at < 0 || needle === '' ? null : [at, at + needle.length]
}

export const CHART_KINDS = ['line', 'area', 'donut', 'counters'] as const
export const ChartCardProps = z
  .object({
    kicker: text(50).optional(),
    title: text(60),
    /** « SOURCE: … » top right. */
    source: text(60).optional(),
    kind: z.enum(CHART_KINDS),
    /** line / area: the points, left to right; `label` is the x axis tick (a year, a month). */
    points: z.array(z.object({ label: text(12), value: z.number().finite(), /** The value as written (« $1.7T »); missing: the number. */ display: text(16).optional() })).min(2).max(24).optional(),
    /** The unit of the values (« % », « $ »): before the number for a currency sign, else after it. */
    unit: text(8).optional(),
    /** line / area: the part of the line from this point on is drawn in the accent colour. */
    accentFrom: z.number().int().min(0).max(23).optional(),
    /** line / area: when the line starts to draw, and how long it takes. */
    atS: at,
    drawS: z.number().min(0.5).max(30).default(2.5),
    /** donut: the slices, each sweeping on its word. */
    slices: z.array(z.object({ label: text(30), value: z.number().positive(), accent: z.boolean().default(false), atS: at })).min(2).max(6).optional(),
    /** counters: one to four big numbers side by side, each counting up on its word. */
    counters: z.array(z.object({ label: text(40), value: z.number().finite(), unit: text(8).optional(), dec: z.number().int().min(0).max(3).optional(), atS: at })).min(1).max(4).optional()
  })
  .superRefine((p, ctx) => {
    const need = (ok: boolean, field: string, what: string): void => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [field], message: `is required for a ${what} chart` })
    }
    if (p.kind === 'line' || p.kind === 'area') need(p.points !== undefined, 'points', p.kind)
    if (p.kind === 'donut') need(p.slices !== undefined, 'slices', 'donut')
    if (p.kind === 'counters') need(p.counters !== undefined, 'counters', 'counters')
    if (p.accentFrom !== undefined && p.points && p.accentFrom >= p.points.length) ctx.addIssue({ code: 'custom', path: ['accentFrom'], message: 'is not a point of the line' })
  })
export type ChartCardProps = z.infer<typeof ChartCardProps>

/** How a print's label is drawn: typed letter by letter on black tape (things, places, verdicts), a torn white strip (a person's name
 * and role), a black box with a serif title and an italic line (an institution, a place and a date), or a red rubber stamp (the
 * « dossier » look). */
export const PRINT_TAGS = ['typed', 'torn', 'box', 'stamp'] as const

/**
 * prints — several prints dropped one by one on a dark slate (or a cream paper), each on its word, each with its label; red quote bars
 * wipe in over them (clone-markets-2: the reference's most used family, 39 % of its first three minutes, 2–7 prints a board, held
 * 3–11 s). The pictures come in `CardAssets.pictures`, in the order of `prints`.
 */
export const PrintsCardProps = z.object({
  /** slate: the dark board; paper: a cream sheet (the reference turns to it for a childhood, a past chapter); manila: a kraft file
   * folder whose bars are red stamps (the « dossier » look, a differentiator of the genre). */
  surface: z.enum(['slate', 'paper', 'manila']).default('slate'),
  prints: z
    .array(
      z.object({
        label: text(40).optional(),
        sub: text(60).optional(),
        tag: z.enum(PRINT_TAGS).default('typed'),
        /** When the print lands (its word); its label follows ≈ 0.5 s later unless `labelAtS` says. */
        atS: at,
        labelAtS: at,
        /** documentary-2: the picture keeps its colours (a colour document, a « today » photo); default black and white like every archive. */
        colour: z.boolean().default(false),
        /** director-motion: the print's item is a film, played inside the print from the moment it lands (the reference's hook boards). */
        film: z.boolean().default(false)
      })
    )
    .min(1)
    .max(8),
  /** A label with no print of its own (« REFUSED » for the third time): typed under the row, on its word. */
  extraTags: z.array(z.object({ label: text(40), atS: at })).max(3).default([]),
  /** Red bars with white serif capitals (a quote, a verdict) that wipe in; `over` puts one above that print, else across the board. */
  bars: z.array(z.object({ text: text(60), atS: at, over: z.number().int().min(0).max(7).optional() })).max(3).default([]),
  /**
   * The slow camera over the board; `still` keeps it fixed (most of the reference's boards: 81–96 % hold); `settle` is its soft zoom over
   * the whole shot (almost nothing, a rise, almost nothing), by `moveZoom`.
   */
  move: z.enum(['push', 'pull', 'left', 'right', 'still', 'settle']).default('push'),
  /** `settle`: how much the board grows over the shot (measured 5–11 %). */
  moveZoom: z.number().min(0).max(0.2).default(0.07),
  /** director-motion: the first print sits large alone, then glides to its place as the next one lands (the reference's boards of 2–4). */
  reflow: z.boolean().default(false),
  /**
   * documentary-2: where a lone print sits (measured on the reference): `centre` (≈ 42 % of the width), `large` (≈ 62 %), `side` (left third,
   * the right side free for its texts). `auto`: side when it has side texts or a bar, else centre. Two prints or more are laid out by count.
   */
  layout: z.enum(['auto', 'centre', 'large', 'side']).default('auto'),
  /** documentary-2: texts beside a lone print, each on its word: a big figure and what it counts, a typed date box, a box label, plain words. */
  side: z.array(z.object({ kind: z.enum(['number', 'date', 'box', 'words']), text: text(40), sub: text(60).optional(), atS: at })).max(3).default([]),
  /** documentary-2: a date typed in a black box at the top left corner of the first print (« 25 JULY 1940 »), on its word. */
  date: z.object({ text: text(30), atS: at }).optional()
})
export type PrintsCardProps = z.infer<typeof PrintsCardProps>

export const CARD_TEMPLATES = ['archive', 'map', 'bars', 'timeline', 'prints', 'document', 'chart', 'map3d', 'pov', 'studio'] as const
export type CardTemplate = (typeof CARD_TEMPLATES)[number]
export const isCardTemplate = (t: unknown): t is CardTemplate => typeof t === 'string' && (CARD_TEMPLATES as readonly string[]).includes(t)

/** Shortest and longest a card stays (the channel holds maps and data cards up to ~50 s while they build). */
export const CARD_SECONDS: Record<CardTemplate, { min: number; max: number }> = {
  archive: { min: 1.5, max: 20 },
  map: { min: 3, max: 60 },
  bars: { min: 3, max: 60 },
  timeline: { min: 3, max: 60 },
  prints: { min: 2.5, max: 30 },
  document: { min: 3, max: 40 },
  chart: { min: 3, max: 60 },
  map3d: { min: 3, max: 60 },
  // a POV shot (formats/pov.ts): the reference cuts every 1–6.5 s, a data card that builds in beats holds up to ≈ 27 s
  pov: { min: 0.8, max: 40 },
  // a motion studio scene (formats/studio.ts): one beat of motion design or one 3D move
  studio: { min: 1, max: 30 }
}

/** The documentary palette, measured on the reference frames. */
export const DOC_PALETTE = {
  slate: '#24211f',
  slateDeep: '#151311',
  paper: '#ecebe6',
  paperLine: '#c9c9c4',
  red: '#d5412f',
  gold: '#c9a24a',
  sea: '#0d2340',
  text: '#f2efe9',
  muted: '#a39d94'
} as const

/** A projected country or border path for a map card, in the card's pixels (prepared by `motion.render`). */
export interface MapAssets {
  /** The Blue Marble crop under the first view, as a data: URI, and the box it covers (degrees). */
  image: string
  imageBox: GeoBox
  /** The full view in pixels of the page: the camera's start and end as boxes of the page's own coordinates. */
  start: { x: number; y: number; w: number; h: number }
  end: { x: number; y: number; w: number; h: number }
  /** Every border in the view, one SVG path (thin white). */
  borders: string
  /** One SVG path per region of the spec (same order). */
  regions: string[]
  /** Pins, routes and names projected (same order as the spec). A route's `pts` is its smoothed curve (x, y, x, y…; missing: the straight line). */
  pins: { x: number; y: number }[]
  routes: { x1: number; y1: number; x2: number; y2: number; pts?: number[] }[]
  names: { x: number; y: number }[]
  /** The page size the map is drawn at (the card's own pixels). */
  width: number
  height: number
  /** Where `image` sits in the world (the pixels of the first view: `start` is {0, 0, width, height}). */
  imageRect?: { x: number; y: number; w: number; h: number }
  /** A sharper picture of the end of the camera's move (the `zoomTo` view), laid over `image` as the camera arrives. */
  detail?: { image: string; x: number; y: number; w: number; h: number }
  /** Where the label of each region sits (same order as the spec's regions), in world pixels. */
  labels?: { x: number; y: number }[]
  /** What the preparation could not do (the tiles were not reachable: the bundled picture was used). */
  warnings?: string[]
}

/** What a card needs beyond its spec: the picture of an archive card, the background and paths of a map. */
export interface CardAssets {
  picture?: string
  /** A prints board's pictures, in the order of its prints (a missing one is drawn as a neutral stand-in). */
  pictures?: readonly (string | undefined)[]
  /** A prints board's films, in the order of its prints: the frames of a film played inside its print, at `filmFps` a second. */
  films?: readonly (readonly string[] | undefined)[]
  filmFps?: number
  map?: MapAssets
  /** The 3D map card's tiles, shapes, camera and library (formats/map3d.ts, prepared by motion/map3d-data.ts). */
  map3d?: Map3dAssets
  /** A motion studio card's library and glyph outlines (motion/studio.ts). */
  studio?: StudioAssets
}
