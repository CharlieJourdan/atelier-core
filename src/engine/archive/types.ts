// Public-archive picture search (free, no key, runs locally in the engine): the shapes shared by every source.
// A documentary pipeline illustrates history with public-domain or openly licensed archives; every item carries its
// licence and a ready-to-print credit line. See ./search.ts for the entry point.

export type ArchiveSource = 'wikimedia' | 'internet-archive' | 'nasa' | 'met'
export const ARCHIVE_SOURCES: readonly ArchiveSource[] = ['wikimedia', 'internet-archive', 'nasa', 'met']

export type ArchiveKind = 'painting' | 'photo' | 'document' | 'map' | 'other'
/** The kinds a caller can ask for (« other » is only ever a guess on a result). */
export type ArchiveKindHint = Exclude<ArchiveKind, 'other'>

export interface ArchiveHit {
  source: ArchiveSource
  /** Unique inside its source (Commons file name, Internet Archive identifier, NASA id, Met object id). */
  id: string
  title: string
  creator?: string
  date?: string
  /** The human page of the item at the archive. */
  pageUrl: string
  /** A direct image URL: ~1600 to 2000 px on the long side when the archive has it, never above 4096 px. */
  fileUrl: string
  width: number
  height: number
  mime: string
  /** Short licence name: « Public domain », « CC0 », « CC BY 4.0 », « CC BY-SA 3.0 »… Never NC / ND / unknown. */
  licence: string
  licenceUrl?: string
  /** One line: « <title> — <creator>, <licence>, via <source> ». */
  attribution: string
  /** CC BY and CC BY-SA require the credit; public domain does not (it is still shown). */
  attributionRequired: boolean
  kind?: ArchiveKind
  /** Category / subject words the archive gave (used to rank). */
  tags?: string[]
  /** Ranking score, higher is better (set by `searchArchives`). */
  score: number
}

export interface ArchiveHints {
  /** Extra search words for the period, « 1929 », « 19th century »… */
  era?: string
  kind?: ArchiveKindHint
}

export interface ArchiveSearchOptions extends ArchiveHints {
  /** How many hits to return, default 6. */
  count?: number
  /** Preferred orientation of the picture: the others are ranked lower, not dropped. Default « any ». */
  orientation?: 'landscape' | 'portrait' | 'any'
  /** Default: every source. */
  sources?: ArchiveSource[]
  /** Pictures whose long side is shorter than this are dropped. Default 1200. */
  minLongSide?: number
}

/** Injectable I/O: the tests pass a fake `fetch`. */
export interface ArchiveDeps {
  fetch?: typeof fetch
  signal?: AbortSignal
  /** Per request, default 8000 ms (a whole source gets twice that). */
  timeoutMs?: number
  /** Retries after a throttled answer (default 3); the tests pass 0. */
  retries?: number
  /** The pause between two attempts (default: a real timer); the tests pass an instant one. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface ArchiveSourceError {
  source: ArchiveSource
  message: string
}

export interface ArchiveSearchResult {
  hits: ArchiveHit[]
  /** Sources that failed (timeout, HTTP error, odd answer); the others still answered. */
  errors: ArchiveSourceError[]
}

export const DEFAULT_MIN_LONG_SIDE = 1200
/** The long side we ask the archives for (Commons renders a thumbnail of this width), and the ceiling we accept. */
export const WANTED_LONG_SIDE = 2000
export const MAX_LONG_SIDE = 4096
/** A file bigger than this is neither listed (when the size is known) nor downloaded. */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024

/** What one source is asked for. `want` is how many usable hits it should try to return (it may return fewer). */
export interface SourceQuery {
  query: string
  hints: ArchiveHints
  want: number
  minLongSide: number
}
