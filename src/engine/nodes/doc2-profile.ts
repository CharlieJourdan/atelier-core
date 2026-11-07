// The measured profile of `documentary@2` (chantier documentary-2, research note documentary-2-2026-11 (old repository)): how the current format of a
// history archive channel shows its pictures, measured shot by shot on five whole videos (≈ 150 minutes, 1 808 shots, every shot classed
// on contact sheets). The defaults are the cloned reference's own numbers (« The Real Reason Hitler Never Invaded Switzerland »); the
// comments give the range over the five videos. These are the pipeline's settings (adaptive, overridable), never engine limits.

/** The ways a picture is presented (the catalogue). A `film` unit is cut into clips of about `filmClipS`. */
export const DOC2_PATTERNS = ['film', 'print-centre', 'print-large', 'print-side', 'prints-2', 'prints-3', 'prints-4', 'still', 'map', 'chart', 'document'] as const
export type Doc2Pattern = (typeof DOC2_PATTERNS)[number]

/** The families the shares are measured on. */
export type Doc2Family = 'film' | 'prints' | 'still' | 'map' | 'chart' | 'document'
export const familyOf = (p: Doc2Pattern): Doc2Family => (p.startsWith('print') ? 'prints' : (p as Doc2Family))

export interface Doc2Profile {
  /** Share of screen time per family, in the hook (its first `hookS`) and in the body (range over the five videos in comments). */
  hookS: number
  hookShares: Record<Doc2Family, number>
  bodyShares: Record<Doc2Family, number>
  /** Seconds a shot of each family lasts (mean; a film unit is cut into clips of `filmClipS`). */
  lengthS: Record<Doc2Family, number>
  filmClipS: number
  /** The shortest stretch a board can hold (shorter: a film or a still). */
  boardMinS: number
  /** The longest run of film clips before another family comes in (the reference's p90 is 6; its longest 8). */
  filmRunMax: number
  /** Least seconds between two maps, two charts, two documents (the reference: a map every ≈ 51 s, a chart every ≈ 110 s). */
  gapS: Record<'map' | 'chart' | 'document', number>
  /** How the prints boards are laid out (shares of the boards). */
  printLayouts: Record<'print-centre' | 'print-large' | 'print-side' | 'prints-2' | 'prints-3' | 'prints-4', number>
  /** Share of the boards on cream paper instead of the dark slate; they come in runs (a past chapter, a childhood). */
  creamShare: number
  creamRun: number
  /** Share of the films that fill the frame instead of sitting 4:3 in the old-TV frame. */
  filmFullShare: number
  /** Texts on screen per minute (each only when the narration says it): date boxes, big numbers, name strips, red bars, typed tags. */
  textsPerMin: { date: number; number: number; name: number; bar: number; tag: number }
  /** Seconds after its word a print, a label or a map part lands (the reference: 0.1–0.5 s). */
  landLeadS: number
  /** The chart kinds the reference uses (`bars` = rows that count up; `line`, `counters` only when a reference has them). */
  chartKinds: readonly ('bars' | 'line' | 'counters')[]
  /** The first map comes after the opening films and by then when the words give one (the reference's first maps: 20–80 s). */
  firstMapAfterS: number
  firstMapByS: number
  /** Share of the boards that play a film inside their print, in the hook and in the body (36J1: three of its first boards, then almost none). */
  printFilm: { hook: number; body: number }
  /** Share of the boards of two to four whose first print sits alone, then glides to its place as the next lands. */
  reflowShare: number
  /** How each kind of shot moves (tracked points on three whole videos, 1 050 shots; settings of this style, doc2-map.ts). */
  camera: {
    /** A full-frame still: one even zoom of this much over the shot, whatever its length (8–9.3 % on 13 of 15 shots); some pull out. */
    stillZoom: number
    stillOutShare: number
    /** An archive film: a slow even push from the first frame (0.7–1.0 % a second on 87 % of the films; the full frame up to 1.6). */
    filmPerS: number
    /** Share of the boards with the soft zoom: a large print 46 %, two to four 29–50 %, others 3–6 % (the newer videos: 0–5 %). The rest HOLD. */
    settleShare: { large: number; several: number; small: number }
    /** The soft zoom: about this much a second, kept between these (5.9–11.4 % on the shots measured). */
    settlePerS: number
    settleMin: number
    settleMax: number
    /** A map's move in zoom levels: when it arrives (the reference's first map ×1.9), later ones (×1.3); share that pull back (16–28 %). */
    mapArrival: number
    mapBody: number
    mapOutShare: number
    /** Tilt at the start and end of the move, the share of the shot it takes (it settles at ≈ 55 %, then creeps), a region's spread, a route's drawing. */
    mapPitch: readonly [number, number]
    mapSettleAt: number
    mapSpreadS: number
    routeDrawS: number
    /** qualite-montage: the longest a board may hold without moving (Charlie: nothing held ~5 s with nothing happening); longer ones settle. */
    holdMaxS: number
  }
}

export const DOC2_PROFILE: Doc2Profile = {
  // the hook: the first 90–106 s, film-led (36J1 53 %, NXIJ 48 %, Biw9 71 %, pvzp 48 %)
  hookS: 100,
  hookShares: { film: 0.52, prints: 0.4, still: 0, map: 0.06, chart: 0, document: 0.02 },
  // the body: prints 30–58 %, film 28–46 %, maps 4–16 %, charts 0–8 %, documents 1.5–8 %, full-frame stills 0–15 % (older eras)
  bodyShares: { film: 0.33, prints: 0.42, still: 0.03, map: 0.14, chart: 0.05, document: 0.03 },
  // film 3.8 s (3.8–4.7), prints 6.3 s (5.0–6.3), maps 10 s (6.7–10), charts 12 s (11–20), documents 3–4.6 s, stills 5.5 s
  lengthS: { film: 3.8, prints: 6.3, still: 5.5, map: 10, chart: 12, document: 4.5 },
  filmClipS: 3.7,
  boardMinS: 2.5,
  filmRunMax: 6,
  gapS: { map: 40, chart: 90, document: 60 },
  // the reference: centred 29 %, two 23 %, large 22 %, side 16 %, three 5 %, four 4 % (side 14–61 % across the channel)
  printLayouts: { 'print-centre': 0.27, 'print-large': 0.2, 'print-side': 0.2, 'prints-2': 0.22, 'prints-3': 0.06, 'prints-4': 0.05 },
  // 16 % of the boards (11–32 %), in runs of two to four
  creamShare: 0.16,
  creamRun: 3,
  // 17 of 168 films fill the frame
  filmFullShare: 0.1,
  // the reference: date 0.68, number 0.42, name 0.36, bar 0.32, tags 0.13 a minute (the newer videos: bars up to 4.7, tags up to 3.9)
  textsPerMin: { date: 0.7, number: 0.5, name: 0.4, bar: 0.4, tag: 0.2 },
  landLeadS: 0.15,
  // the reference's seven chart cards are rows or columns whose numbers count up; no line, no donut
  chartKinds: ['bars'],
  firstMapAfterS: 15,
  firstMapByS: 60,
  printFilm: { hook: 0.25, body: 0.02 },
  reflowShare: 0.3,
  camera: {
    stillZoom: 0.09,
    stillOutShare: 0.1,
    filmPerS: 0.009,
    settleShare: { large: 0.46, several: 0.3, small: 0.04 },
    settlePerS: 0.013,
    settleMin: 0.05,
    settleMax: 0.115,
    mapArrival: 0.93,
    mapBody: 0.38,
    mapOutShare: 0.2,
    mapPitch: [42, 50],
    mapSettleAt: 0.55,
    mapSpreadS: 1.5,
    routeDrawS: 3.5,
    holdMaxS: 4.5
  }
}

/** The families' shares at a time of the film. */
export const sharesAt = (p: Doc2Profile, t: number): Record<Doc2Family, number> => (t < p.hookS ? p.hookShares : p.bodyShares)
