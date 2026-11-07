// How long a video takes to make (pipeline-ui, Charlie 01/11: « il faut aussi mettre l'estimation du temps de rendu moyen »):
// the timing of each engine, the way the price book holds its price. Data, never in a screen: main's duration model
// (src/main/production/estimates/duration.ts) reads it, the screens show what it computes. Times are wall seconds, submit to
// file, queue included. Measured where a run measured them (research note model-benchmark-2026-11 (old repository), reference-video-2026-11.md
// « Assets wall time »: a 1-minute hook took ≈ 4 min of assets); the others are our estimates until a run measures them.
import type { EngineFamily } from './cloud-engines'

export interface EngineTiming {
  /** Seconds one call takes (one still, one clip, one presenter stretch, one voice chunk). */
  secondsPerCall: number
  /** How many calls run at once on this engine (the queue's own limit, or ours). */
  parallel: number
  /** The longest piece of media one call makes, seconds (a longer stretch takes several calls); null: no limit. */
  maxSecondsPerCall: number | null
  /** Where the figure comes from. */
  source: 'measured' | 'estimate'
}

/** Per engine id. An engine not listed takes its family's default. */
export const ENGINE_TIMINGS: Readonly<Record<string, EngineTiming>> = {
  // clips: Veo 3.1 Lite relaxed 73 s mean (queue 63–79 s), 7 at once on the hook; Grok 1.5 Lite 39 s
  'clip:veo31-lite-relaxed': { secondsPerCall: 73, parallel: 8, maxSecondsPerCall: 8, source: 'measured' },
  'clip:grok-imagine-15-lite': { secondsPerCall: 39, parallel: 8, maxSecondsPerCall: 15, source: 'measured' },
  'clip:veo31-lite': { secondsPerCall: 105, parallel: 8, maxSecondsPerCall: 8, source: 'measured' },
  'clip:veo31-fast': { secondsPerCall: 81, parallel: 8, maxSecondsPerCall: 8, source: 'measured' },
  // stills: GPT Image 2.5 low 12 s, medium 13 s; Nano Banana 2 Lite 35 s
  'image:gpt-image-25-low': { secondsPerCall: 12, parallel: 8, maxSecondsPerCall: null, source: 'measured' },
  'image:gpt-image-25-medium': { secondsPerCall: 13, parallel: 8, maxSecondsPerCall: null, source: 'measured' },
  'image:nano-banana-2': { secondsPerCall: 35, parallel: 8, maxSecondsPerCall: null, source: 'measured' },
  // presenter: HeyGen through its MCP made the hook's 28 s of presenter in 99 s
  'presenter:heygen-mcp': { secondsPerCall: 99, parallel: 3, maxSecondsPerCall: 30, source: 'measured' },
  'presenter:heygen-avatar4': { secondsPerCall: 99, parallel: 3, maxSecondsPerCall: 30, source: 'estimate' },
  // voice: chunks of ≤ 200 characters, a few seconds each
  'voice:ai33': { secondsPerCall: 6, parallel: 4, maxSecondsPerCall: 15, source: 'estimate' },
  'voice:minimax-28-hd': { secondsPerCall: 8, parallel: 4, maxSecondsPerCall: 15, source: 'estimate' }
}

/** The default timing of each family, for an engine no run has measured. */
export const FAMILY_TIMINGS: Readonly<Record<EngineFamily, EngineTiming>> = {
  presenter: { secondsPerCall: 120, parallel: 3, maxSecondsPerCall: 30, source: 'estimate' },
  image: { secondsPerCall: 25, parallel: 8, maxSecondsPerCall: null, source: 'estimate' },
  clip: { secondsPerCall: 90, parallel: 8, maxSecondsPerCall: 8, source: 'estimate' },
  voice: { secondsPerCall: 8, parallel: 4, maxSecondsPerCall: 15, source: 'estimate' },
  llm: { secondsPerCall: 60, parallel: 1, maxSecondsPerCall: null, source: 'estimate' },
  music: { secondsPerCall: 2, parallel: 1, maxSecondsPerCall: null, source: 'estimate' }
}

/** The team's writing and directing (one after the other): seconds per task, plus seconds per finished minute. */
export const LLM_TASK_TIMINGS: Readonly<Record<string, { fixedS: number; perMinuteS: number }>> = {
  script: { fixedS: 60, perMinuteS: 20 },
  factcheck: { fixedS: 30, perMinuteS: 10 },
  sponsor: { fixedS: 20, perMinuteS: 0 },
  director: { fixedS: 45, perMinuteS: 15 },
  metadata: { fixedS: 30, perMinuteS: 0 }
}

/** The edit and the render on the computer: the hook's edit took 23 s; a 10-minute video about 4 min (decision 0012). */
export const RENDER_TIMING = { fixedS: 20, perMinuteS: 24 } as const

/** The spread around the average: everything on time, or the dearest fallbacks and a few redone. */
export const RENDER_TIME_SPREAD = { min: 0.75, max: 1.6 } as const

/** The video lengths the editor shows a render time for, beside the pipeline's own. */
export const RENDER_TIME_LENGTHS = [1, 5, 10, 20] as const

/** One render time: the length of the video and the wall time, seconds. */
export interface RenderTimeView {
  minutes: number
  seconds: { min: number; avg: number; max: number }
}
