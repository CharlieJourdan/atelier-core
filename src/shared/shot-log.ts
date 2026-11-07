// « Watch a whole video » (chantier regarder-videos): the structured shot log of ONE video read from start to end, its hook broken
// down shot by shot, its cadence curve, and how much of it was really read (coverage). The engine builds it (src/engine/watch/), the
// app caches it per video and hands it to the eyes and the clone flow (src/main/eyes/whole.ts). A log always says plainly what it
// covers: an analysis built on a part of a video is marked partial, never passed off as the whole.
import { z } from 'zod'

/** How the video was read. `local-file`: a file the user supplied; `download`: a normal download the platform served (no cookies,
 *  no login, no circumvention); `gemini-url`: Google's model read the public link on its side. */
export const WATCH_METHODS = ['local-file', 'download', 'gemini-url'] as const
export type WatchMethod = (typeof WATCH_METHODS)[number]

export const LOG_SHOT_KINDS = ['archive-film', 'archive-photo', 'document', 'map', 'chart', 'motion-graphic', 'title-card', 'illustration', 'stock-footage', 'screen-capture', 'presenter', 'gameplay', 'generated', 'other'] as const
export const CAMERA_MOVES = ['still', 'push-in', 'pull-out', 'pan', 'tilt', 'tracking', 'handheld', 'animated', 'unknown'] as const

export const LogShot = z.object({
  /** 1-based, in order. */
  n: z.number().int().min(1),
  startS: z.number().min(0),
  endS: z.number().min(0),
  lengthS: z.number().min(0),
  kind: z.enum(LOG_SHOT_KINDS),
  /** What is on screen, a short sentence. Empty when the shot was not labelled. */
  shows: z.string().max(300),
  /** The text burnt into the picture, verbatim (captions included), empty when none. */
  onScreenText: z.string().max(300),
  /** The words spoken under the shot (from word timings), empty when there are none or no words were available. */
  words: z.string().max(600),
  /** Whether the shot shows what its words say: yes, partly, no; null when it could not be judged. */
  illustrates: z.enum(['yes', 'partly', 'no']).nullable(),
  camera: z.enum(CAMERA_MOVES)
})
export type LogShot = z.infer<typeof LogShot>

export const CadencePoint = z.object({ fromS: z.number(), toS: z.number(), shots: z.number().int().min(0), meanShotS: z.number().min(0), wordsPerMinute: z.number().min(0).nullable() })
export type CadencePoint = z.infer<typeof CadencePoint>

export const HookBreakdown = z.object({
  /** End of the hook: the first sentence end after `minS`, else a fixed window. */
  endS: z.number().min(0),
  shots: z.array(LogShot),
  /** Seconds before the first cut (how long the first picture holds). */
  firstCutS: z.number().nullable(),
  meanShotS: z.number().min(0),
  /** The hook's mean shot over the whole video's: below 1 = a faster hook. */
  paceVsBody: z.number().nullable(),
  /** The words of the hook. */
  words: z.string().max(1500),
  /** The model's reading of the dense hook sheet (every 0.5 s frame): the first image and how the hook grabs. */
  firstImage: z.string().max(300).optional(),
  notes: z.string().max(600).optional()
})
export type HookBreakdown = z.infer<typeof HookBreakdown>

export const Coverage = z.object({
  method: z.enum(WATCH_METHODS),
  durationS: z.number().min(0),
  /** Seconds really read. */
  readS: z.number().min(0),
  complete: z.boolean(),
  /** What could not be read, and why (French, plain). */
  gaps: z.array(z.object({ fromS: z.number(), toS: z.number(), why: z.string() })),
  /** Where shot times come from: counted scene cuts, or the model's own times. */
  cutsFrom: z.enum(['scene-detection', 'model']),
  wordsFrom: z.enum(['whisper', 'captions', 'model', 'none']),
  /** Fields the reading could not fill (e.g. an older Cloud without the dense mode). */
  missing: z.array(z.string())
})
export type Coverage = z.infer<typeof Coverage>

export const WatchCost = z.object({
  usd: z.number().min(0),
  /** True when the dollars are the API-price equivalent of a run on the user's subscription (nothing billed). */
  subscription: z.boolean(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  ms: z.number().min(0),
  usdPerMinute: z.number().min(0),
  secondsPerMinute: z.number().min(0)
})
export type WatchCost = z.infer<typeof WatchCost>

export const WholeVideoLog = z.object({
  version: z.literal(1),
  url: z.string(),
  title: z.string(),
  coverage: Coverage,
  shots: z.array(LogShot),
  hook: HookBreakdown,
  cadence: z.array(CadencePoint),
  stats: z.object({
    /** Cuts found by scene detection before the model joined caption-only or same-take changes (absent: model times). */
    detectedShots: z.number().int().optional(),
    shots: z.number().int(), meanShotS: z.number(), medianShotS: z.number(), cutsPerMinute: z.number(), wordsPerMinute: z.number().nullable(), kinds: z.record(z.string(), z.number()) }),
  cost: WatchCost,
  readAt: z.string()
})
export type WholeVideoLog = z.infer<typeof WholeVideoLog>

const mmss = (s: number): string => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`

/** One plain French line that says what was read: the whole video, or which part and why not the rest. */
export function coverageLine(c: Coverage, shots: number): string {
  if (c.complete) return `Vidéo lue en entier (${mmss(c.durationS)}, ${shots} plans).`
  const why = c.gaps[0]?.why ?? 'raison inconnue'
  return `Vidéo lue en partie seulement : ${mmss(c.readS)} sur ${mmss(c.durationS)} (${why}). Le rythme et la structure ne valent que pour cette partie.`
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** A compact English digest of a log for an agent's prompt: coverage, stats, the hook shot by shot, the cadence curve, the families
 *  and the holds; at most `max` characters. */
export function logDigest(log: WholeVideoLog, max = 3500): string {
  const c = log.coverage
  const s = log.stats
  const lines = [
    `Shot log (${c.method}, ${c.complete ? 'WHOLE video' : `PARTIAL: ${Math.round(c.readS)} of ${Math.round(c.durationS)} s`}, cuts by ${c.cutsFrom}, words by ${c.wordsFrom}${c.missing.length ? `, missing: ${c.missing.join(', ')}` : ''}):`,
    `${s.shots} shots${s.detectedShots && s.detectedShots !== s.shots ? ` (${s.detectedShots} picture changes by scene detection)` : ''}, mean ${s.meanShotS} s, median ${s.medianShotS} s, ${s.cutsPerMinute} cuts/min${s.wordsPerMinute ? `, ${s.wordsPerMinute} words/min` : ''}.`,
    `Families (share of time): ${Object.entries(s.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(', ')}.`,
    `Hook 0–${log.hook.endS} s: ${log.hook.shots.length} shots, mean ${log.hook.meanShotS} s${log.hook.paceVsBody ? ` (${log.hook.paceVsBody}× the video's mean)` : ''}, first cut at ${log.hook.firstCutS ?? '—'} s.${log.hook.notes ? ` ${log.hook.notes}` : ''}`,
    ...log.hook.shots.slice(0, 15).map((h) => `  ${clock(h.startS)} ${h.lengthS} s ${h.kind}/${h.camera}: ${h.shows}${h.onScreenText ? ` [text: ${h.onScreenText}]` : ''}${h.words ? ` « ${h.words.slice(0, 90)} »` : ''}`),
    `Cadence (shots per window, mean shot, words/min): ${log.cadence.map((p) => `${Math.round(p.fromS)}s ${p.shots}×${p.meanShotS}${p.wordsPerMinute ? `/${p.wordsPerMinute}` : ''}`).join('; ')}.`,
    `Holds over 5 s: ${log.shots.filter((x) => x.lengthS > 5).length}; shots not illustrating their words: ${log.shots.filter((x) => x.illustrates === 'no').length}.`
  ]
  const out = lines.join('\n')
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}
