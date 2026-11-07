// One sourcing interface for every media family (archives, stock, footage excerpts, sound effects, music): a query goes in,
// ranked candidates come out, each with its legal status, a preview URL and a cost (0 for every free source). The providers
// live in ./providers; ./search.ts runs them side by side. Runs in the engine (no electron) or in the Cloud (keys from the vault).
import type { HttpDeps } from '../archive/http.ts'

export type MediaKind = 'image' | 'video' | 'sfx' | 'music'
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'sfx', 'music']

/** What the credits and the publish check need to know. Everything but `forbidden` can be shown; only some are safe unreviewed. */
export type LegalStatus = 'public-domain' | 'cc0' | 'cc-by' | 'cc-by-sa' | 'free-licence' | 'fair-use-excerpt' | 'forbidden'

export interface MediaLicence {
  /** « Public domain », « CC BY 4.0 », « Pixabay Content License », « Fair-use excerpt (unlicensed) »… */
  short: string
  status: LegalStatus
  url?: string
  attributionRequired: boolean
}

/** `clear`: usable as is (with its credit if required). `human-review`: a person must look before it is published. */
export type ReviewStatus = 'clear' | 'human-review'

export interface MediaCandidate {
  provider: string
  /** Unique inside its provider. */
  id: string
  kind: MediaKind
  title: string
  description?: string
  creator?: string
  date?: string
  tags?: string[]
  /** The human page of the item. */
  pageUrl: string
  /** A small image (poster, thumbnail) or a short audio preview, to look at before fetching the file. */
  previewUrl: string
  /** The file itself (image, video, audio). For a web excerpt it is the video page and `excerpt` says which part to cut. */
  fileUrl: string
  mime?: string
  width?: number
  height?: number
  durationS?: number
  licence: MediaLicence
  /** The line printed in the video's credits. */
  credit: string
  review: ReviewStatus
  /** Why a human must look (set when review is `human-review`). */
  reviewReason?: string
  /** What fetching this candidate costs us, in dollars: 0 for every free source. */
  costUsd: number
  /** Ranking score, higher is better (set by `searchMedia`). */
  score: number
  /** Web excerpts only: the time range to cut. */
  excerpt?: { startS: number; endS: number }
  /** Web excerpts the shot log watched: the corner a channel logo or watermark sits in, so the crop can zoom away from it. */
  logo?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

export interface SourceQuery {
  query: string
  kind: MediaKind
  /** How many usable candidates the provider should try to return. */
  want: number
  era?: string
  orientation?: 'landscape' | 'portrait' | 'any'
  /** Pictures shorter than this on the long side are dropped. */
  minLongSide?: number
  /** Sounds and clips: duration window in seconds. */
  minDurationS?: number
  maxDurationS?: number
}

export type RunFn = (cmd: string, args: string[], opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<{ stdout: string; stderr: string }>

export interface ProviderCtx extends HttpDeps {
  /** The key this provider declared in `secret` (or its public demo key), undefined for a keyless one. */
  key?: string
  /** True when `key` is the shared public demo key (tests and proofs only). */
  demoKey?: boolean
  /** Runs an external program (yt-dlp, ffmpeg); injectable so the tests never start one. */
  run?: RunFn
}

export interface SourcingProvider {
  id: string
  label: string
  kinds: readonly MediaKind[]
  /** The vault name of the key the provider needs (`npm run cloud -- vault set NAME`); absent for a keyless source. */
  secret?: string
  /** A public demo key published by the provider for testing; used only when `allowDemoKeys` is on. */
  demoKey?: string
  /** Asked only when the caller names it in `providers` (web excerpts: always a human-review source). */
  optIn?: boolean
  /** True for a source that charges per use: skipped unless the caller allows paid sources. */
  paid?: boolean
  /** Estimated cost of one use, in dollars (paid sources). */
  estCostUsd?: number
  search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]>
}

export interface SkippedProvider {
  provider: string
  reason: 'no-key' | 'paid' | 'kind' | 'disabled'
  detail?: string
}

export interface ProviderError {
  provider: string
  message: string
}

export interface MediaSearchResult {
  candidates: MediaCandidate[]
  errors: ProviderError[]
  skipped: SkippedProvider[]
  /** Providers that answered (possibly with nothing). */
  asked: string[]
  /** Sum of the candidates' cost: 0 while only free sources are asked. */
  costUsd: number
  /** Candidates removed because their legal status is `forbidden`. */
  droppedForbidden: number
  /** Milliseconds each asked provider took (a cache hit counts 0). */
  timingsMs: Record<string, number>
}
