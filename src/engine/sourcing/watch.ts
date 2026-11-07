// « Watching » a public video: Gemini (a Flash model) reads a public YouTube link and answers a SHOT LOG, one entry per shot with its
// time range, what it shows, what kind of footage it is, how much text and which corner logo, and flags for AI-made, edited
// compilation and burnt-in subtitles, with a quality score 1 to 5. Our code filters that log (`filterShots`), the picker chooses among the
// surviving shots (`shotsToCandidates`), and only the chosen range is downloaded (yt-dlp, ./cut.ts). Reading a video costs money, so the
// call is budgeted: a range of at most 8 minutes, low media resolution, a capped answer, and the cost is computed from the usage the API
// reports (`watchCostUsd`). Nothing here uploads or writes anywhere: Google reads the public page on its side.
// REST (official docs read 2026-10-24, same shapes as cloud/src/providers/gemini.ts): POST {base}/v1beta/models/{model}:generateContent,
// key in the `x-goog-api-key` header; contents[].parts[] { fileData{fileUri}, videoMetadata{startOffset,endOffset}, text };
// generationConfig { responseMimeType, responseJsonSchema, mediaResolution, maxOutputTokens, temperature }.
// TO VERIFY with the first real run (tests use a fake): that videoMetadata offsets are accepted on a YouTube link, that the shot times in
// the answer are on the whole video's clock (assumed, `timesAreClipRelative` flips it), and the real token counts per minute.
import type { MediaCandidate } from './types.ts'
import { FAIR_USE_LICENCE, creditLine } from './legal.ts'

export const SHOT_KINDS = ['archive-film', 'newsreel', 'modern-footage', 'photo-still', 'aerial', 'nature', 'event', 'gameplay', 'talking-head', 'interview', 'studio', 'graphic', 'title-card', 'screen-capture', 'reenactment', 'animation'] as const
export type ShotKind = (typeof SHOT_KINDS)[number]
export const TEXT_LEVELS = ['none', 'small', 'lower-third', 'large'] as const
export const LOGO_CORNERS = ['none', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

export interface Shot {
  startS: number
  endS: number
  /** At most 20 words. */
  shows: string
  kind: ShotKind
  text: (typeof TEXT_LEVELS)[number]
  logo: (typeof LOGO_CORNERS)[number]
  ai: boolean
  edited: boolean
  subtitles: boolean
  quality: 1 | 2 | 3 | 4 | 5
  /** Dense mode only (`dense: true`): the text burnt in, verbatim; the words spoken under the shot; the camera move. */
  onText?: string
  says?: string
  camera?: string
}

/** The camera moves the dense mode names (src/shared/shot-log.ts CAMERA_MOVES). */
export const WATCH_CAMERA = ['still', 'push-in', 'pull-out', 'pan', 'tilt', 'tracking', 'handheld', 'animated', 'unknown'] as const

export const WATCH_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'MM:SS.s on the video clock' },
          end: { type: 'string' },
          shows: { type: 'string' },
          kind: { type: 'string', enum: SHOT_KINDS },
          text: { type: 'string', enum: TEXT_LEVELS },
          logo: { type: 'string', enum: LOGO_CORNERS },
          ai: { type: 'boolean' },
          edited: { type: 'boolean' },
          subtitles: { type: 'boolean' },
          quality: { type: 'integer', minimum: 1, maximum: 5 }
        },
        required: ['start', 'end', 'shows', 'kind', 'text', 'logo', 'ai', 'edited', 'subtitles', 'quality']
      }
    }
  },
  required: ['shots']
} as const

/** The dense schema: the b-roll one plus the verbatim text, the words said and the camera move (« watch a whole video »). */
export const WATCH_DENSE_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...WATCH_SCHEMA.properties.shots.items.properties,
          onText: { type: 'string', description: 'text burnt into the picture, verbatim, empty if none' },
          says: { type: 'string', description: 'the words spoken during the shot, verbatim' },
          camera: { type: 'string', enum: WATCH_CAMERA }
        },
        required: ['start', 'end', 'shows', 'kind', 'text', 'logo', 'ai', 'edited', 'subtitles', 'quality', 'onText', 'says', 'camera']
      }
    }
  },
  required: ['shots']
} as const

export function watchPrompt(focus?: string, dense = false): string {
  if (dense) {
    return (
      'Watch this part of the video and list EVERY shot in order, without skipping any: a shot is a continuous take between two cuts (a hard cut, a dissolve or a new card or graphic all start a new shot). Times are MM:SS.s on the video’s own clock. For each shot give: start, end, ' +
      'shows (what is on screen, 15 words at most), kind (one of: ' + SHOT_KINDS.join(', ') + '), text (none, small, lower-third or large), logo (corner of a channel logo or none), ai, edited, subtitles, quality (1 to 5), ' +
      'onText (the text burnt into the picture, verbatim and short, empty if none), says (the words spoken during the shot, verbatim), camera (one of: ' + WATCH_CAMERA.join(', ') + ').' +
      '\nAnswer ONLY with JSON that matches the schema. Do not invent shots; a still image is kind photo-still.'
    )
  }
  return (
    'Watch the video and list its shots in order. A shot is a continuous take between two cuts. For each shot give: start and end (MM:SS.s on the video’s own clock), shows (what is on screen, 20 words at most: place, people only if named on screen, action), ' +
    'kind (one of: ' + SHOT_KINDS.join(', ') + '), text (none, small, lower-third or large: how much text is burnt into the picture), logo (which corner holds a channel or agency logo or watermark, or none), ' +
    'ai (true if the picture looks AI-generated), edited (true if it is a montage or compilation edit of other clips rather than one source take), subtitles (true if subtitles are burnt in), quality (1 to 5: sharpness, exposure, steadiness, usable as b-roll).' +
    (focus ? `\nPay most attention to shots that show: ${focus}. Still list every shot.` : '') +
    '\nAnswer ONLY with JSON that matches the schema. Do not invent shots; if a stretch is a still image, say kind photo-still.'
  )
}

const ts = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return undefined
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim())
  if (m) return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** The shots of an answer, validated: unknown kinds, inverted or out-of-range times and malformed rows are dropped, never guessed. */
export function parseShotLog(text: string, range: { startS: number; endS: number }, o: { timesAreClipRelative?: boolean } = {}): Shot[] {
  let rows: unknown[]
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { shots?: unknown }
    rows = Array.isArray(parsed.shots) ? parsed.shots : []
  } catch {
    return []
  }
  const shift = o.timesAreClipRelative ? range.startS : 0
  const out: Shot[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    const a = ts(x.start)
    const b = ts(x.end)
    if (a === undefined || b === undefined) continue
    const startS = a + shift
    const endS = b + shift
    // a small tolerance: the model rounds to the second
    if (!(endS > startS) || startS < range.startS - 1 || endS > range.endS + 1) continue
    const kind = SHOT_KINDS.find((k) => k === x.kind)
    const textLevel = TEXT_LEVELS.find((k) => k === x.text)
    const logo = LOGO_CORNERS.find((k) => k === x.logo)
    const quality = Number(x.quality)
    if (!kind || !textLevel || !logo || !Number.isInteger(quality) || quality < 1 || quality > 5) continue
    out.push({
      startS: Math.round(startS * 10) / 10,
      endS: Math.round(endS * 10) / 10,
      shows: String(x.shows ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      kind,
      text: textLevel,
      logo,
      ai: x.ai === true,
      edited: x.edited === true,
      subtitles: x.subtitles === true,
      quality: quality as Shot['quality'],
      ...(typeof x.onText === 'string' ? { onText: x.onText.replace(/\s+/g, ' ').trim().slice(0, 300) } : {}),
      ...(typeof x.says === 'string' ? { says: x.says.replace(/\s+/g, ' ').trim().slice(0, 600) } : {}),
      ...(typeof x.camera === 'string' ? { camera: WATCH_CAMERA.find((c) => c === x.camera) ?? 'unknown' } : {})
    })
  }
  return out.sort((p, q) => p.startS - q.startS)
}

/** The kinds of real footage a documentary can use as it is. */
export const REAL_FOOTAGE: readonly ShotKind[] = ['archive-film', 'newsreel', 'modern-footage', 'photo-still', 'aerial', 'nature', 'event']

export interface ShotFilter {
  kinds?: readonly ShotKind[]
  minQuality?: number
  minDurationS?: number
  /** Allow a small burnt-in text (default); `false` keeps only shots with no text at all. */
  allowSmallText?: boolean
}

/** Code, no AI: keeps real footage, little or no text, quality ≥ 3, at least 2.5 s, never AI-made, edited compilations or subtitled. */
export function filterShots(shots: readonly Shot[], f: ShotFilter = {}): Shot[] {
  const kinds = f.kinds ?? REAL_FOOTAGE
  return shots.filter(
    (s) => kinds.includes(s.kind) && (s.text === 'none' || (f.allowSmallText !== false && s.text === 'small')) && s.quality >= (f.minQuality ?? 3) && s.endS - s.startS >= (f.minDurationS ?? 2.5) && !s.ai && !s.edited && !s.subtitles
  )
}

/** The surviving shots of a video as candidates the picker can read: each one is a web excerpt (fair use, human review) with its range. */
export function shotsToCandidates(video: { id: string; title: string; creator?: string; url: string; previewUrl?: string }, shots: readonly Shot[]): MediaCandidate[] {
  return shots.map((s, i) => ({
    provider: 'youtube-excerpt',
    id: `${video.id}@${s.startS}`,
    kind: 'video' as const,
    title: s.shows || video.title,
    description: `From « ${video.title} »${video.creator ? ` (${video.creator})` : ''}, ${s.startS}–${s.endS} s`,
    ...(video.creator ? { creator: video.creator } : {}),
    tags: [s.kind],
    pageUrl: video.url,
    previewUrl: video.previewUrl ?? '',
    fileUrl: video.url,
    durationS: Math.round((s.endS - s.startS) * 10) / 10,
    licence: FAIR_USE_LICENCE,
    credit: creditLine(video.title, video.creator, FAIR_USE_LICENCE.short, 'YouTube (public excerpt)'),
    review: 'human-review' as const,
    reviewReason: 'fair-use excerpt of someone else’s video: a person must check it before publishing',
    costUsd: 0,
    score: 20 * (1 - i / Math.max(shots.length, 1)),
    excerpt: { startS: s.startS, endS: s.endS },
    ...(s.logo !== 'none' ? { logo: s.logo } : {})
  }))
}

// ---- the call ----------------------------------------------------------------------------------------------------------------------------

/** USD per 1M tokens (input incl. video, output incl. thinking). Same table as cloud/src/providers/gemini.ts (read 2026-10-24). */
export const WATCH_PRICES: Record<string, { input: number; audio: number; output: number }> = {
  'gemini-3.1-flash-lite': { input: 0.25, audio: 0.5, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, audio: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, audio: 0.3, output: 0.4 },
  'gemini-3.8-flash': { input: 0.75, audio: 0.75, output: 3.75 }
}
export const WATCH_DEFAULT_MODEL = 'gemini-3.1-flash-lite'
export const WATCH_MAX_RANGE_S = 8 * 60
export const WATCH_MAX_OUTPUT_TOKENS = 8192
/** The dense log writes the words said too: a longer answer (still capped, the range is shorter). */
export const WATCH_DENSE_MAX_OUTPUT_TOKENS = 16384
/** Frames a second accepted for a watch (Gemini's default is 1). */
export const WATCH_MAX_FPS = 5

export interface WatchUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  promptTokensDetails?: Array<{ modality: string; tokenCount: number }>
}

/** A model not in the table is priced at the highest known rate, so a budget never under-counts. */
export function watchCostUsd(model: string, u: WatchUsage | undefined): number {
  if (!u) return 0
  const all = Object.values(WATCH_PRICES)
  const p = WATCH_PRICES[model] ?? Object.entries(WATCH_PRICES).find(([k]) => model.startsWith(k))?.[1] ?? { input: Math.max(...all.map((x) => x.input)), audio: Math.max(...all.map((x) => x.audio)), output: Math.max(...all.map((x) => x.output)) }
  const audio = (u.promptTokensDetails ?? []).filter((d) => d.modality.toUpperCase() === 'AUDIO').reduce((s, d) => s + d.tokenCount, 0)
  const rest = Math.max(0, (u.promptTokenCount ?? 0) - audio)
  return (rest * p.input + audio * p.audio + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * p.output) / 1_000_000
}

/** The most a watch can cost, from the range alone (≈ 100 tokens a second at low resolution + a capped answer): checked BEFORE the call. */
export function watchMaxCostUsd(model: string, rangeS: number, o: { dense?: boolean; fps?: number } = {}): number {
  // at low resolution ≈ 66 tokens a frame + 32 a second of audio: the frames scale with fps
  const perS = 110 + 66 * Math.max(0, (o.fps ?? 1) - 1)
  return watchCostUsd(model, { promptTokenCount: Math.ceil(rangeS * perS) + 600, candidatesTokenCount: o.dense ? WATCH_DENSE_MAX_OUTPUT_TOKENS : WATCH_MAX_OUTPUT_TOKENS })
}

export interface WatchInput {
  /** A public YouTube link (the Cloud route refuses anything else). */
  url: string
  startS?: number
  endS: number
  /** What the shots should preferably show (the need's words). */
  focus?: string
  /** The dense shot log (verbatim text, words said, camera), for « watch a whole video ». */
  dense?: boolean
  /** Frames a second Gemini samples (default 1; more for a hook or a Short). */
  fps?: number
}

export interface WatchDeps {
  apiKey: string
  model?: string
  fetch?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  baseUrl?: string
}

export interface WatchResult {
  shots: Shot[]
  model: string
  costUsd: number
  ms: number
  usage: WatchUsage | undefined
  rangeStartS: number
  rangeEndS: number
}

export class WatchError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'WatchError'
    this.retryable = retryable
  }
}

export async function geminiWatch(input: WatchInput, d: WatchDeps): Promise<WatchResult> {
  const model = d.model ?? WATCH_DEFAULT_MODEL
  const startS = Math.max(0, Math.floor(input.startS ?? 0))
  const endS = Math.min(Math.ceil(input.endS), startS + WATCH_MAX_RANGE_S)
  if (!(endS > startS)) throw new WatchError('the range to watch is empty')
  const f = d.fetch ?? globalThis.fetch
  const base = (d.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')
  const started = Date.now()
  const timeout = AbortSignal.timeout(d.timeoutMs ?? 180_000)
  const res = await f(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': d.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    signal: d.signal ? AbortSignal.any([d.signal, timeout]) : timeout,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ fileData: { fileUri: input.url }, videoMetadata: { startOffset: `${startS}s`, endOffset: `${endS}s`, ...(input.fps ? { fps: input.fps } : {}) } }, { text: watchPrompt(input.focus, input.dense === true) }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: input.dense ? WATCH_DENSE_SCHEMA : WATCH_SCHEMA, mediaResolution: 'MEDIA_RESOLUTION_LOW', maxOutputTokens: input.dense ? WATCH_DENSE_MAX_OUTPUT_TOKENS : WATCH_MAX_OUTPUT_TOKENS, temperature: 0.1 }
    })
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(new RegExp(d.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '•••').slice(0, 300)
    throw new WatchError(`Gemini answered HTTP ${res.status}: ${body}`, res.status === 429 || res.status >= 500)
  }
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string }; usageMetadata?: WatchUsage }
  if (json.promptFeedback?.blockReason) throw new WatchError(`the video was refused (${json.promptFeedback.blockReason})`)
  const first = json.candidates?.[0]
  const text = (first?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (first?.finishReason === 'MAX_TOKENS') throw new WatchError(`the shot log was cut at ${input.dense ? WATCH_DENSE_MAX_OUTPUT_TOKENS : WATCH_MAX_OUTPUT_TOKENS} tokens: watch a shorter range`)
  if (!text.trim()) throw new WatchError('empty answer', true)
  return { shots: parseShotLog(text, { startS, endS }), model, costUsd: watchCostUsd(model, json.usageMetadata), ms: Date.now() - started, usage: json.usageMetadata, rangeStartS: startS, rangeEndS: endS }
}
