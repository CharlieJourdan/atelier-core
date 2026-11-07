// The presenter engines (production-7, docs/specs/pipeline-avatar.md §2.5, decision 0034), shared by the Cloud (which adapter
// serves each) and the engine (how long one generation may be, what a framing needs). The ids are those of the engines registry
// (cloud/src/providers/engines.ts). A presenter engine is a consistency class: one engine per video, chosen before it starts.
export const PRESENTER_ENGINES = [
  'presenter:heygen-mcp',
  'presenter:heygen-avatar4',
  'presenter:hedra-c3',
  'presenter:kling-avatar2-std',
  'presenter:infinitetalk-fast',
  'presenter:infinitetalk-gpu',
  'presenter:infinitetalk-std',
  'presenter:pruna-avatar',
  'presenter:kling-avatar-kie'
] as const
export type PresenterEngine = (typeof PRESENTER_ENGINES)[number]

export const PRESENTER_RESOLUTIONS = ['480p', '540p', '720p', '1080p'] as const
export type PresenterResolution = (typeof PRESENTER_RESOLUTIONS)[number]

export interface PresenterEngineCan {
  /**
   * The longest audio one generation takes, in seconds. A video's presenter is generated in as few calls as this allows
   * (pipeline-avatar §2.5 b). From the public docs where they say it, else our cautious reading: confirm on the first real
   * call (docs/PROVIDERS.md §6).
   */
  maxCallS: number
  /** The face is registered once with the provider (a « look »); its id is kept on the presenter per engine. */
  registration: boolean
  /** Resolutions it makes, the cheapest first; the first one at or above 720p is the default. */
  resolutions: readonly PresenterResolution[]
  /** Provider US$ per second of video per resolution (2026-10-30/31 public prices, provisional: pipeline-avatar §9). */
  usdPerS: Partial<Record<PresenterResolution, number>>
}

export const PRESENTER_ENGINE_CAN: Record<PresenterEngine, PresenterEngineCan> = {
  // HeyGen Avatar IV « Photo Look » through HeyGen's MCP server on the founder's web plan (production-10): 16 credits a minute
  // (help.heygen.com « How to use credits », read 2026-11-01) at the Business top-up of 0.05 USD a credit = 0.0133 USD a second;
  // the plan itself (Pro 49 or Business 149 USD a month) is a fixed cost shown apart. 1080p 16:9. Longest call not published: 180 s until measured.
  // Its look (production-17) is the portrait's HeyGen asset, registered on the first call and reused while the portrait is the same.
  'presenter:heygen-mcp': { maxCallS: 180, registration: true, resolutions: ['1080p'], usdPerS: { '1080p': (16 * 0.05) / 60 } },
  // HeyGen API v3 (production-10): Avatar IV from an image link and an audio link, nothing registered; 0.05 $/s (Enterprise page).
  'presenter:heygen-avatar4': { maxCallS: 180, registration: false, resolutions: ['720p', '1080p'], usdPerS: { '720p': 0.05, '1080p': 0.05 } },
  // Hedra Character-3: 540p / 720p / 1080p; « up to 60 s » per request on standard plans (FAQ; another page says less at 1080p).
  'presenter:hedra-c3': { maxCallS: 60, registration: false, resolutions: ['540p', '720p', '1080p'], usdPerS: { '540p': 0.025, '720p': 0.05, '1080p': 0.0625 } },
  // Kling AI Avatar v2 standard on fal: output length = the audio's; no published cap, kept at a minute.
  'presenter:kling-avatar2-std': { maxCallS: 60, registration: false, resolutions: ['720p', '1080p'], usdPerS: { '720p': 0.0562, '1080p': 0.0562 } },
  // InfiniteTalk hosted (WaveSpeed « fast »): image-to-video drifts in colour past about a minute (model repo).
  'presenter:infinitetalk-fast': { maxCallS: 60, registration: false, resolutions: ['480p', '720p'], usdPerS: { '480p': 0.015, '720p': 0.03 } },
  // InfiniteTalk on a rented GPU (RunPod serverless): ≈ 0,005 $/s is an ESTIMATE until Charlie's benchmark (decision 0015).
  'presenter:infinitetalk-gpu': { maxCallS: 60, registration: false, resolutions: ['480p', '720p'], usdPerS: { '480p': 0.003, '720p': 0.005 } },
  // production-10 fallbacks, prices read 2026-11-01 on the providers' model pages:
  // InfiniteTalk (standard) on WaveSpeed: 0.03 / 0.06 USD a second at 480p / 720p, 3 s minimum, 600 s maximum.
  'presenter:infinitetalk-std': { maxCallS: 60, registration: false, resolutions: ['480p', '720p'], usdPerS: { '480p': 0.03, '720p': 0.06 } },
  // Pruna P-Video Avatar on WaveSpeed: 0.025 / 0.045 USD a second at 720p / 1080p, audio up to 3 minutes.
  'presenter:pruna-avatar': { maxCallS: 180, registration: false, resolutions: ['720p', '1080p'], usdPerS: { '720p': 0.025, '1080p': 0.045 } },
  // Kling AI Avatar standard on Kie.ai: 8 credits (≈ 0.04 USD) a second, 720p, at most 300 s (kept at 180 until measured).
  'presenter:kling-avatar-kie': { maxCallS: 180, registration: false, resolutions: ['720p'], usdPerS: { '720p': 0.04 } }
}

export const isPresenterEngine = (v: unknown): v is PresenterEngine => typeof v === 'string' && (PRESENTER_ENGINES as readonly string[]).includes(v)

/**
 * The resolution an engine is asked for when a pipeline wants `wanted` (avatar-qualite: `avatar.speak` wants 1080p): the best
 * up to `wanted` that costs no more a second than the engine's default (Charlie 01/11: sharper, never dearer). HeyGen (plan
 * and API) and Kling make 1080p at their 720p price; Hedra and Pruna charge more for it, so they stay at 720p.
 */
export function resolutionFor(engine: PresenterEngine, wanted: PresenterResolution): PresenterResolution {
  const can = PRESENTER_ENGINE_CAN[engine]
  const base = defaultResolution(engine)
  const price = can.usdPerS[base] ?? Number.POSITIVE_INFINITY
  const rank = (x: PresenterResolution): number => PRESENTER_RESOLUTIONS.indexOf(x)
  const fits = can.resolutions.filter((x) => rank(x) <= rank(wanted) && (can.usdPerS[x] ?? Number.POSITIVE_INFINITY) <= price)
  return [...fits].sort((a, b) => rank(b) - rank(a))[0] ?? base
}

/** The default resolution of an engine: 720p when it makes it, else its best. */
export function defaultResolution(engine: PresenterEngine): PresenterResolution {
  const r = PRESENTER_ENGINE_CAN[engine].resolutions
  return r.includes('720p') ? '720p' : (r[r.length - 1] as PresenterResolution)
}

/** The framings of a presenter (pipeline-avatar §2.5 a): the portrait is `medium`; angles and re-crops add the others. */
export const FRAMINGS = ['wide', 'medium', 'close'] as const
export type Framing = (typeof FRAMINGS)[number]
