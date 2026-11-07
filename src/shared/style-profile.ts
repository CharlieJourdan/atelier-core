// The channel STYLE PROFILE (lot "eyes", PLAN-COMPLEXITE §B.3 and §C): what the video analysis ("the eyes") saw in a channel's own
// videos and in its competitors' (hook, structure, pace, shot types, on-screen text, music, calls to action), boiled down to
// the few numbers and words that steer production: the script (tone, structure, hook pattern), the director (cuts per minute,
// shot mix, shot types), the captions (preset), the thumbnails (traits). Versioned per channel and editable by the owner.
//
// Pure functions only: `buildStyleProfile` (analyses → profile), `profileToRunParams` (profile → what a run changes) and the
// schema that validates what crosses IPC or the database. The engine reads the result through plain node params, so a run
// without a profile is a run with no extra param at all, i.e. exactly what it was before.
import { z } from 'zod'
import { median } from './outliers'
import { TEMPOS, type AnalysisResult } from './video-analysis'

export const STYLE_PROFILE_ID = 'atelier.styleprofile/1'

// The engine's own lists (src/engine/text/captions.ts, src/engine/media/headline.ts); a unit test checks they still match.
export const PROFILE_CAPTION_PRESETS = ['classic', 'highlight', 'pill', 'bold-center', 'word-by-word', 'shorts', 'word'] as const
export const PROFILE_CAPTION_POSITIONS = ['bottom', 'middle', 'top'] as const
export const PROFILE_THUMBNAIL_LAYOUTS = ['scrim', 'band'] as const
export const SEGMENT_KIND_LIST = ['hook', 'intro', 'body', 'transition', 'cta', 'outro'] as const

const text = (max: number) => z.string().max(max)
const share = z.number().min(0).max(1)

export const StyleProfileSchema = z.strictObject({
  $schema: z.literal(STYLE_PROFILE_ID),
  /** How many analysed videos it comes from. `builtAt` is null for a profile written by hand. */
  source: z.strictObject({
    ownVideos: z.number().int().min(0),
    competitorVideos: z.number().int().min(0),
    builtAt: z.string().nullable(),
    /** At least one analysis came from the Cloud's demonstration provider: the profile is an example, not a reading. */
    demo: z.boolean()
  }),
  pace: z.strictObject({ cutsPerMinute: z.number().min(1).max(60), tempo: z.enum(TEMPOS) }),
  /** Shares of the picture: stock and archive footage, generated or drawn pictures and animation, original footage (presenter, screen). */
  mix: z.strictObject({ stock: share, generated: share, footage: share }),
  shotTypes: z.array(text(60)).max(8),
  captions: z.strictObject({
    preset: z.enum(PROFILE_CAPTION_PRESETS),
    position: z.enum(PROFILE_CAPTION_POSITIONS),
    onScreenTextPerMinute: z.number().min(0).max(120)
  }),
  hook: z.strictObject({ pattern: text(80), seconds: z.number().min(0).max(120), example: text(400) }),
  script: z.strictObject({ structure: z.array(z.enum(SEGMENT_KIND_LIST)).max(12), tone: text(300), ctaPerVideo: z.number().min(0).max(10) }),
  length: z.strictObject({ minutes: z.number().min(0.5).max(120) }),
  music: z.strictObject({ present: z.boolean(), mood: text(100) }),
  thumbnail: z.strictObject({ traits: z.array(text(80)).max(8), face: z.boolean(), layout: z.enum(PROFILE_THUMBNAIL_LAYOUTS) })
})
export type StyleProfile = z.infer<typeof StyleProfileSchema>

export const DEFAULT_PROFILE: Omit<StyleProfile, 'source' | '$schema'> = {
  pace: { cutsPerMinute: 12, tempo: 'medium' },
  mix: { stock: 0.6, generated: 0.4, footage: 0 },
  shotTypes: [],
  captions: { preset: 'highlight', position: 'bottom', onScreenTextPerMinute: 0 },
  hook: { pattern: '', seconds: 15, example: '' },
  script: { structure: ['hook', 'body', 'outro'], tone: '', ctaPerVideo: 1 },
  length: { minutes: 8 },
  music: { present: true, mood: '' },
  thumbnail: { traits: [], face: false, layout: 'scrim' }
}

// ---------------------------------------------------------------------------------------------------------------- building

/** One analysed video, as the style builder reads it. */
export interface AnalysedVideo {
  origin: 'own' | 'competitor'
  /** The video outperformed its channel (the competitor's outliers count double: they are what worked). */
  outlier: boolean
  /** Length in seconds when the channel data gave it (else read from the analysis's last segment). */
  durationS: number | null
  /** The Cloud answered with its demonstration provider. */
  demo: boolean
  analysis: AnalysisResult
}

/** Hints the analysis cannot give (the eyes do not describe thumbnails yet): the owner's own, or the channel's former sheet. */
export interface ThumbnailHints {
  traits?: string[]
  face?: boolean
  layout?: (typeof PROFILE_THUMBNAIL_LAYOUTS)[number]
}

export interface BuildOptions {
  /** ISO date-time written in `source.builtAt`. */
  now: string
  thumbnail?: ThumbnailHints
}

function weightOf(v: AnalysedVideo): number {
  return v.outlier ? 2 : 1
}

function weightedMedian(items: readonly { value: number; weight: number }[]): number | null {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((s, i) => s + i.weight, 0)
  let acc = 0
  for (const i of sorted) {
    acc += i.weight
    if (acc >= total / 2) return i.value
  }
  return sorted.at(-1)?.value ?? null
}

/** The key with the largest total weight; ties go to the first seen. */
function weightedMode<K extends string>(items: readonly { key: K; weight: number }[]): K | null {
  const totals = new Map<K, number>()
  for (const i of items) totals.set(i.key, (totals.get(i.key) ?? 0) + i.weight)
  let best: K | null = null
  let bestW = 0
  for (const [k, w] of totals) {
    if (w > bestW) {
      best = k
      bestW = w
    }
  }
  return best
}

export type ShotClass = 'stock' | 'generated' | 'footage'

/** Which part of the mix a shot type named by the analysis belongs to (English or French wording); null when it says nothing about it. */
export function classifyShot(shot: string): ShotClass | null {
  const s = shot.toLowerCase()
  // text laid over the picture is not a kind of picture
  if (/on-?screen\s+text|text overlay|texte (affiché|à l[’']écran)|sous-titr|subtitle|caption/.test(s)) return null
  if (/stock|b-?roll|archiv|banque d|librar|biblioth|photo/.test(s)) return 'stock'
  if (/anim|\bai\b|\bia\b|g[ée]n[ée]r|illustr|dessin|cartoon|motion|graphi|3d|infograph|\bmap|carte|diagram|sch[ée]ma|chart|reconstitu/.test(s)) return 'generated'
  if (/talking|face|cam[ée]ra|presenter|pr[ée]sentat|\bhost|interview|vlog|selfie|gameplay|\bjeu|[ée]cran|screen|record|enregistr|live|filmed|film[ée]|original/.test(s)) return 'footage'
  return null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

function durationOf(v: AnalysedVideo): number | null {
  if (v.durationS !== null && v.durationS > 0) return v.durationS
  const end = Math.max(0, ...v.analysis.structure.map((s) => s.toS))
  return end > 0 ? end : null
}

/** The recurring order of the video's parts: the segment kinds sorted by time, runs of the same kind merged. */
function sequenceOf(a: AnalysisResult): (typeof SEGMENT_KIND_LIST)[number][] {
  const out: (typeof SEGMENT_KIND_LIST)[number][] = []
  for (const s of [...a.structure].sort((x, y) => x.fromS - y.fromS)) if (out.at(-1) !== s.kind) out.push(s.kind)
  return out
}

const TONE_BY_TEMPO: Record<(typeof TEMPOS)[number], string> = {
  fast: 'fast-paced and direct: very short sentences, a new fact or image every few seconds, no filler',
  medium: 'clear and steady: short sentences, one idea at a time, a concrete detail in every paragraph',
  slow: 'calm and contemplative: unhurried sentences, room to breathe, atmosphere before facts'
}

/**
 * The profile of a channel from the analyses of its own videos and of its competitors'. Null when there is nothing to read.
 * Every figure is a weighted median or mode (a competitor's outlier counts double), so one odd video cannot move it.
 */
export function buildStyleProfile(videos: readonly AnalysedVideo[], options: BuildOptions): StyleProfile | null {
  if (videos.length === 0) return null
  const w = (v: AnalysedVideo) => weightOf(v)
  const d = DEFAULT_PROFILE

  const cuts = weightedMedian(videos.map((v) => ({ value: v.analysis.pacing.cutsPerMinute, weight: w(v) })).filter((i) => i.value > 0))
  const tempo = weightedMode(videos.map((v) => ({ key: v.analysis.pacing.tempo, weight: w(v) }))) ?? d.pace.tempo

  // the picture mix: every shot type listed counts once per video, by the class it belongs to
  const mixW: Record<ShotClass, number> = { stock: 0, generated: 0, footage: 0 }
  const shotNames = new Map<string, number>()
  for (const v of videos) {
    for (const raw of new Set(v.analysis.shotTypes.map((s) => s.trim().toLowerCase()).filter(Boolean))) {
      shotNames.set(raw, (shotNames.get(raw) ?? 0) + w(v))
      const c = classifyShot(raw)
      if (c) mixW[c] += w(v)
    }
  }
  const mixTotal = mixW.stock + mixW.generated + mixW.footage
  const mix = mixTotal > 0 ? { stock: round2(mixW.stock / mixTotal), generated: round2(mixW.generated / mixTotal), footage: round2(mixW.footage / mixTotal) } : d.mix
  const shotTypes = [...shotNames.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([name]) => name.slice(0, 60))

  // length, on-screen text density and its mean size
  const minutes = weightedMedian(videos.flatMap((v) => { const s = durationOf(v); return s === null ? [] : [{ value: s / 60, weight: w(v) }] }))
  const perMinute = weightedMedian(
    videos.flatMap((v) => {
      const s = durationOf(v)
      return s === null ? [] : [{ value: v.analysis.onScreenText.length / (s / 60), weight: w(v) }]
    })
  )
  const words = videos.flatMap((v) => v.analysis.onScreenText.map((t) => t.text.trim().split(/\s+/).filter(Boolean).length)).filter((n) => n > 0)
  const meanWords = words.length > 0 ? words.reduce((a, b) => a + b, 0) / words.length : 0
  const lengthMin = Math.min(120, Math.max(0.5, round2(minutes ?? d.length.minutes)))
  const density = perMinute ?? 0
  // few words on screen → plain captions; a lot of very short ones → word by word; a short film with many → the shorts preset
  const preset: StyleProfile['captions']['preset'] =
    density < 2 ? 'classic' : density < 6 ? 'highlight' : lengthMin <= 1.5 ? 'shorts' : meanWords <= 3 ? 'word-by-word' : 'bold-center'
  const position: StyleProfile['captions']['position'] = preset === 'word-by-word' || preset === 'bold-center' || preset === 'shorts' ? 'middle' : 'bottom'

  // the hook: the most common technique, how long it lasts and the heaviest example of it
  const techniques = videos.map((v) => ({ key: v.analysis.hook.technique.trim().toLowerCase().slice(0, 80), weight: w(v) })).filter((i) => i.key)
  const pattern = weightedMode(techniques) ?? ''
  const hookVideos = videos.filter((v) => v.analysis.hook.technique.trim().toLowerCase().slice(0, 80) === pattern)
  const example = [...hookVideos].sort((a, b) => w(b) - w(a))[0]?.analysis.hook.text.trim().slice(0, 400) ?? ''
  const hookSeconds = weightedMedian(videos.map((v) => ({ value: v.analysis.hook.endsAtS, weight: w(v) })).filter((i) => i.value > 0))

  // the script: the order of the parts, the number of calls to action
  const sequences = new Map<string, { seq: (typeof SEGMENT_KIND_LIST)[number][]; weight: number }>()
  for (const v of videos) {
    const seq = sequenceOf(v.analysis)
    if (seq.length === 0) continue
    const key = seq.join('>')
    sequences.set(key, { seq, weight: (sequences.get(key)?.weight ?? 0) + w(v) })
  }
  const structure = [...sequences.values()].sort((a, b) => b.weight - a.weight)[0]?.seq ?? d.script.structure
  const ctaPerVideo = median(videos.map((v) => v.analysis.callsToAction.length))

  const moods = videos.filter((v) => v.analysis.music.present && v.analysis.music.mood.trim()).map((v) => ({ key: v.analysis.music.mood.trim().toLowerCase().slice(0, 100), weight: w(v) }))
  const musicShare = videos.filter((v) => v.analysis.music.present).reduce((s, v) => s + w(v), 0) / videos.reduce((s, v) => s + w(v), 0)

  return {
    $schema: STYLE_PROFILE_ID,
    source: { ownVideos: videos.filter((v) => v.origin === 'own').length, competitorVideos: videos.filter((v) => v.origin === 'competitor').length, builtAt: options.now, demo: videos.some((v) => v.demo) },
    pace: { cutsPerMinute: Math.min(60, Math.max(1, round2(cuts ?? d.pace.cutsPerMinute))), tempo },
    mix,
    shotTypes,
    captions: { preset, position, onScreenTextPerMinute: round2(Math.min(120, density)) },
    hook: { pattern, seconds: Math.min(120, Math.max(0, round2(hookSeconds ?? d.hook.seconds))), example },
    script: { structure, tone: TONE_BY_TEMPO[tempo], ctaPerVideo: round2(Math.min(10, ctaPerVideo)) },
    length: { minutes: lengthMin },
    music: { present: musicShare >= 0.5, mood: weightedMode(moods) ?? '' },
    thumbnail: {
      traits: (options.thumbnail?.traits ?? d.thumbnail.traits).slice(0, 8),
      face: options.thumbnail?.face ?? d.thumbnail.face,
      layout: options.thumbnail?.layout ?? d.thumbnail.layout
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- profile → run

/** What a profile changes in a run. Every node entry only holds the params the profile has an opinion on. */
export interface ProfileRunParams {
  /** Run style fields (`$style.captions`), under the owner's own overrides. */
  style: { captions: string }
  /** Params by node TYPE (`script.write@1`…): added to a node only where the pipeline did not set that param itself. */
  nodes: {
    'script.write@1': { style: { tone: string; structure: string[]; hookPattern: string; hookExample: string; hookSeconds: number }; ctaMode: 'none' | 'end' | 'mid_end' }
    'director.plan@1': { cpm: number; mix: { stock: number; image: number }; videoShare: number; shotTypes: string[]; minShotS: number; maxShotS: number }
    'captions.make@1': { preset: string; position: string }
    'thumbnail.make@1': { style: string; withFace: boolean; layout: string }
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export function profileToRunParams(p: StyleProfile): ProfileRunParams {
  // stock stays stock; drawn, generated and animated pictures are the "image" side; original footage is not something the director
  // can make, so its share is spread over both in proportion (the owner supplies footage through the pipeline's own inputs)
  const madeShare = p.mix.stock + p.mix.generated
  const stock = madeShare > 0 ? p.mix.stock / madeShare : 0.6
  const avgShot = 60 / clamp(p.pace.cutsPerMinute, 4, 40)
  const thumbStyle = p.thumbnail.traits.join(', ').slice(0, 600)
  return {
    style: { captions: p.captions.preset },
    nodes: {
      'script.write@1': {
        style: { tone: p.script.tone, structure: [...p.script.structure], hookPattern: p.hook.pattern, hookExample: p.hook.example, hookSeconds: p.hook.seconds },
        ctaMode: p.script.ctaPerVideo < 0.5 ? 'none' : p.script.ctaPerVideo >= 2 ? 'mid_end' : 'end'
      },
      'director.plan@1': {
        cpm: round2(clamp(p.pace.cutsPerMinute, 4, 40)),
        mix: { stock: round2(stock), image: round2(1 - stock) },
        // generated video is a costly upgrade of generated pictures: only a channel that is mostly made of generated footage asks for it
        videoShare: p.mix.generated >= 0.6 ? 0.2 : 0,
        shotTypes: p.shotTypes.slice(0, 6),
        minShotS: round2(clamp(avgShot / 3, 0.8, 4)),
        maxShotS: round2(clamp(avgShot * 2, 3, 12))
      },
      'captions.make@1': { preset: p.captions.preset, position: p.captions.position },
      'thumbnail.make@1': { style: thumbStyle, withFace: p.thumbnail.face, layout: p.thumbnail.layout }
    }
  }
}
