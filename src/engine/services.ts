// What the host injects into the engine (docs/ENGINE-SPEC.md §15.7). The engine never imports src/main (R13.1): the
// app, the local worker, Atelier Cloud and the RunPod images each hand nodes the services they have. Every service has
// a fake for tests; a node that needs a service the host did not give fails with a clear, permanent error.
import { EngineError } from './errors'
import type { RunCtx } from './registry'
import type { Json } from './types'
import type { z } from 'zod'
import type { MediaSearchRequest, MediaSearchResponse } from '../shared/cloud-media'

/**
 * The model tier of one call (decision 0013, models per use): `balanced` (Sonnet) writes scripts and plans, `fast` (Haiku)
 * runs the small passes (fitting a length, tagging, word swaps), `best` (Opus) the hard reviews. The host maps a tier to the
 * model of the team's backend; a model the owner set on the role wins. Absent: the role's own tier.
 */
export type ModelTier = 'best' | 'balanced' | 'fast'

/** Claude Code on the user's machine (R1.4), playing one agent role. 0 credits. */
export interface ClaudeService {
  ask(req: {
    role: string
    tier?: ModelTier
    /** Stable rules (cache-friendly), the output language first (R32.5). */
    system: string
    prompt: string
    /** The answer must be one JSON value (the node validates it with its zod schema, R32.1). */
    json: boolean
    /** Claude Code tools the call may use: `web` = web search and fetch only (research, §16). Default: none. */
    tools?: 'web'[]
    /** Pictures to look at (absolute JPEG or PNG paths): the illustration check (avatar-qualite). */
    images?: string[]
    signal: AbortSignal
  }): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>
}

/** What the eyes read of one public video (the Cloud's video analysis): never the transcript itself. */
export interface VideoReading {
  title: string
  /** A short summary of what the video says. */
  summary: string
  /** The opening, as said, and how it works. */
  hook: { text: string; endsAtS: number; technique: string }
  /** The video's parts in order (hook, intro, body, transition, cta, outro), each with a one-line summary. */
  parts: { kind: string; fromS: number; toS: number; summary: string }[]
  durationS: number
  /** The reading came from a fake (a demo run, or the Cloud's demo mode). */
  demo: boolean
}

/** The eyes (Cloud `analyseVideo`) or a read-only YouTube reader: reads a support video (idea.support, pipeline-avatar §2.1). */
export interface VideoReaderService {
  /** Only the first `minutes` are watched (the Cloud bills per minute watched). */
  read(req: { url: string; minutes: number; language: string }, signal: AbortSignal): Promise<VideoReading>
}

/** A word with its time in the audio, as a provider or a recogniser gives it (seconds). */
export interface TimedWord {
  word: string
  start: number
  end: number
}

/** Options of one paid item sent to Atelier Cloud (R15.3: one quote line, one reservation, one idempotency key). */
export interface CloudJobOptions {
  idempotencyKey: string
  signal: AbortSignal
  /** Where the downloaded files go. */
  dir: string
  onProgress?: (frac: number) => void
}

/** Atelier Cloud as the nodes see it: it quotes, reserves, runs the provider and hands back the files. */
export interface CloudService {
  /** True in a real run (the app's « Moteur réel »): a demo answer an earlier run cached is asked again, never reused. */
  readonly realRun?: boolean
  /** `engine`: the voice engine of the pipeline (`voice:elevenlabs-v2`…); absent, the Cloud's default voice provider. */
  synthesize(
    req: { text: string; voiceId: string; wordTimings: boolean; engine?: string },
    opts: CloudJobOptions
  ): Promise<{ audioFile: string; words: TimedWord[]; durationS?: number; demo: boolean; credits?: number }>
  /** A still. `engine`: the image engine of the pipeline (`image:gpt-image-25-low`…); absent, the Cloud's default provider.
   *  `references`: local image files uploaded first (the presenter's portrait, the room, a recurring object's first picture),
   *  sent only to an engine that takes them (src/shared/visual-engines.ts). `negative`: what must never appear. */
  generateImage(
    req: { prompt: string; width: number; height: number; engine?: string; negative?: string; references?: string[] },
    opts: CloudJobOptions
  ): Promise<{ files: string[]; demo: boolean; credits?: number }>
  /** A generated video clip (a clip engine through the Cloud, or the demo clip). `seconds` is billed; the clip is at most the
   *  engine's longest (`clipMaxSeconds`, src/shared/visual-engines.ts). `image`: the local still it starts from (uploaded
   *  first; image to video), absent = text to video. `files[0]` is the clip. */
  generateVideo(
    req: { prompt: string; seconds: number; aspect: '16:9' | '9:16'; engine?: string; negative?: string; image?: string },
    opts: CloudJobOptions
  ): Promise<{ files: string[]; demo: boolean; credits?: number }>
  /** A talking head driven by a voice audio (a presenter engine through the Cloud, or the demo clip): the file at `audioFile`
   *  (and the presenter's picture at `portraitFile`, when given) is uploaded to the Cloud first. `seconds` (the audio's length)
   *  is billed. `files[0]` is the clip (with the provider's own sound: the film's voice stays the master). `engine` names the
   *  presenter engine (production-7; absent: the Cloud's default provider); `registration` is the face's id on an engine that
   *  registers it (to keep on the presenter). */
  talkingAvatar(
    req: {
      avatarId: string
      audioFile: string
      seconds: number
      aspect: '16:9' | '9:16'
      engine?: string
      portraitFile?: string
      resolution?: string
      prompt?: string
    },
    opts: CloudJobOptions
  ): Promise<{ files: string[]; demo: boolean; credits?: number; registration?: string }>
  /** Stock photos / videos and public archives (Pexels, Wikimedia Commons, or the demo files). `results[i]` is the picture in
   *  `files[i]` (its `file` is the artefact's name); it may be empty when nothing matched. */
  searchStock(
    req: { query: string; orientation: StockOrientation; kind: 'photo' | 'video'; count: number },
    opts: CloudJobOptions
  ): Promise<{ results: StockHit[]; files: string[]; demo: boolean; credits?: number }>
  /** documentary-2: the Cloud's free media search (`POST /v1/media/search`, keys from its vault: Europeana, NARA…); absent on fakes. */
  searchMedia?(req: z.input<typeof MediaSearchRequest>, signal: AbortSignal): Promise<MediaSearchResponse>
}

export type StockOrientation = 'landscape' | 'portrait' | 'square'

/** One stock result: where it came from, its licence and the credit line to keep (the video's credits list it). */
export interface StockHit {
  id: string
  source: 'pexels' | 'wikimedia' | 'pixabay' | 'archive' | 'demo'
  kind: 'photo' | 'video'
  title: string
  creator: string
  creatorUrl: string | null
  pageUrl: string | null
  licence: string
  attribution: string
  attributionRequired: boolean
  width: number
  height: number
  orientation: StockOrientation
  durationS: number | null
  /** The local file of this result. */
  file: string
}

/** Result of one ffmpeg / ffprobe execution. */
export interface ToolResult {
  stdout: Buffer
  stderr: string
}

/** ffmpeg and ffprobe, run without a shell, stopped with the run's signal (R2.3, R36.3). */
export interface MediaService {
  run(
    tool: 'ffmpeg' | 'ffprobe',
    args: string[],
    opts: { signal: AbortSignal; stdin?: AsyncIterable<Uint8Array> | Uint8Array; onStderrLine?: (line: string) => void }
  ): Promise<ToolResult>
  /** Streams a tool's stdout (decoding PCM, frames) without holding it all in memory. */
  stream(tool: 'ffmpeg', args: string[], opts: { signal: AbortSignal }): { stdout: AsyncIterable<Uint8Array>; done: Promise<ToolResult> }
}

/** The operating system's own voice (macOS `say`, Windows SAPI): the demo voice of `voice.tts` (§19 Fake). */
export interface SpeechService {
  /** Installed voices with their language (BCP 47 prefix, e.g. `fr`). */
  voices(signal: AbortSignal): Promise<{ id: string; name: string; language: string }[]>
  /**
   * Speaks `text` into a WAV file. `marks`, when the OS reports them, are the time of each word by its character
   * offset in `text` (Windows does; macOS does not, the node aligns instead).
   */
  speak(
    req: { text: string; voiceId: string; rate: number; out: string },
    signal: AbortSignal
  ): Promise<{ marks: { offset: number; length: number; start: number }[] | null }>
}

/** A speech recogniser with word times (Whisper-family, §19.3). Optional: without it the deterministic aligner runs. */
export interface AsrService {
  transcribe(req: { audio: string; language: string }, signal: AbortSignal): Promise<{ words: TimedWord[]; engine?: string }>
}

/** One page of a headless browser, loaded with a document and ready to be photographed at any moment of its animation. */
export interface BrowserPage {
  /**
   * Moves the page's clock to `t` seconds (the document's `window.atelierRenderAt(t)` when it defines one, and every CSS or Web
   * animation paused at `t`), then returns the frame as a PNG whose background is transparent. The same `t` gives the same picture.
   */
  frame(t: number): Promise<Uint8Array>
  /**
   * The fast capture (motion-montage, `motion/fast.ts`): moves the clock to `t` and returns a key of what the page shows (a hash of every
   * inline style and counted text the runtime wrote). When the key equals `lastKey` nothing changed since that frame and no picture is
   * taken (`image` null). `jpeg` is for an opaque page (an order of magnitude faster than a PNG on a photographic card); `png` keeps the
   * alpha. Ordinary pages only (a sandboxed page has none).
   */
  capture?(t: number, o: { format: 'png' | 'jpeg'; quality?: number; lastKey?: string }): Promise<{ key: string; image: Uint8Array | null }>
  close(): Promise<void>
  /** A sandboxed page only: what it reported so far (console errors, uncaught errors, the requests that were blocked). */
  problems?(): { console: string[]; blocked: string[] }
  /** A sandboxed page only: the text it shows at the time of the last frame, laid out (the lint of a custom brick, §25.2). */
  inspect?(): Promise<PageInspection>
}

/** One run of text on a page, as laid out by the browser (pixels of the frame). */
export interface TextBox {
  text: string
  x: number
  y: number
  w: number
  h: number
  fontPx: number
  /** CSS colour of the text (`rgb(…)` / `rgba(…)`). */
  color: string
  /** The colour behind it (the nearest ancestor with a background), `image` for a gradient or a picture, null for none (over footage). */
  backing: string | null
  /** A text shadow or an outline keeps it readable without a backing. */
  shadow: boolean
  /** It overflows its box or leaves a box that clips it. */
  clipped: boolean
  /** Its opacity with its ancestors' (0 = not visible at this time). */
  opacity: number
}
export interface PageInspection {
  texts: TextBox[]
}

/**
 * A page of untrusted content (a custom brick written by an agent): no network (every request is blocked and reported), no Node, its own
 * CSP (the page carries it), a time budget to load and to draw each frame. A page that overruns or throws fails with a permanent error.
 */
export interface BrowserSandbox {
  /** Longest the page may take to load and set `window.atelierReady = true` (ms). */
  loadMs: number
  /** Longest one frame may take: setting the time and photographing it (ms). */
  frameMs: number
}

/**
 * A headless Chromium (docs/ENGINE-SPEC.md §25): the motion templates are HTML pages photographed frame by frame. The host starts it
 * (Playwright's Chromium, or the Chrome / Edge / Chromium installed on the machine); the engine only opens pages. Tests give a fake.
 */
export interface BrowserService {
  open(req: { html: string; width: number; height: number; signal: AbortSignal; sandbox?: BrowserSandbox }): Promise<BrowserPage>
  /** Closes the browser (called by the host when it is done). */
  close?(): Promise<void>
  /** Its ordinary pages have the fast `capture` (motion/fast.ts draws through it; without it, the classic path). */
  fastCapture?: boolean
}

/** Working folders. `scratch` is thrown away after the run; `cache` survives runs (inner caches, R7.6). */
export interface WorkspaceService {
  scratch(label: string): Promise<string>
  cache(kind: string): Promise<string>
}

/** Our own resources (fonts, music, skills), each with its licence (`resources/`, plan §1.12). */
export interface LibraryService {
  root: string
}

/** What a vision check says of one generated picture or clip (ENGINE-SPEC §23 step 4, pipeline-avatar §3 « clip quality »). */
export interface VisionVerdict {
  /** Letters, words or numbers drawn in the picture. */
  text: boolean
  /** Extra, missing or fused fingers or limbs. */
  anatomy: boolean
  /** A clip whose object changes look, or where something new appears, between its frames. */
  drift: boolean
  /** Shows a person when the brief said nobody. */
  person: boolean
  /** One short English line, for the logs. */
  note?: string
}

/**
 * The eyes on generated pictures (optional): one look per file, against what it was asked to show. A clip is judged on a few
 * of its frames (`frames`, in order). Absent: only the deterministic checks run (blank, near-duplicate), with a diagnostic.
 */
export interface VisionService {
  inspect(req: { files: string[]; prompt: string; kind: 'still' | 'clip'; people: 'anyone' | 'not-presenter' | 'presenter-as-actor' | 'nobody' }, signal: AbortSignal): Promise<VisionVerdict>
}

export interface EngineServices {
  claude?: ClaudeService
  cloud?: CloudService
  media?: MediaService
  speech?: SpeechService
  asr?: AsrService
  browser?: BrowserService
  workspace?: WorkspaceService
  library?: LibraryService
  videos?: VideoReaderService
  vision?: VisionService
  /** Free-form host facts a node may log (never part of a fingerprint). */
  host?: Record<string, Json>
}

const MISSING: Record<keyof EngineServices, string> = {
  claude: 'Claude Code n’est pas connecté : connecte ton Claude dans Réglages pour cette étape.',
  cloud: 'Atelier Cloud est injoignable : cette étape passe par le Cloud.',
  media: 'ffmpeg est introuvable : installe-le (sur Mac : « brew install ffmpeg-full ») puis relance l’étape.',
  speech: 'Aucune voix système n’est disponible sur cet ordinateur.',
  asr: 'La reconnaissance vocale n’est pas installée.',
  browser: 'Aucun navigateur (Chromium, Chrome ou Edge) n’a été trouvé : installe-en un pour les animations, puis relance l’étape.',
  workspace: 'Le dossier de travail de la production est indisponible.',
  library: 'Les ressources d’Atelier (polices, musiques) sont introuvables.',
  videos: 'La lecture des vidéos d’appui passe par Atelier Cloud, qui est injoignable.',
  vision: 'La vérification visuelle des images n’est pas disponible sur cet ordinateur.',
  host: 'Information de l’hôte indisponible.'
}

/** The service a node needs, or a permanent `missing_tool` error whose message is shown to the user (French). */
export function need<K extends keyof EngineServices>(ctx: RunCtx, key: K): NonNullable<EngineServices[K]> {
  const s = ctx.services[key]
  if (!s) throw new EngineError('missing_tool', MISSING[key])
  return s as NonNullable<EngineServices[K]>
}
