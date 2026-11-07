// The duration model (pipeline-ui): how long a pipeline takes to make one video, beside its price. It reads the same volumes
// as the cost estimator (the mix after its curve, the shot lengths, the clip settings an option set: COST_DEFAULTS) and times
// them with the engines' timings (src/shared/render-times.ts), the way the cost estimator prices them with the price book.
// Pure: no I/O. The steps follow the run's order: the writing (one task after the other), the voice, then the presenter and
// the pictures at once (the graph runs bricks of one level together; a clip starts from its still), then the edit and render.
//   wall time of a brick = ceil(calls ÷ parallel) × seconds per call      (calls of its engine as the pipeline picks it)
// avg = that; min / max = the spread of RENDER_TIME_SPREAD (all on time, or fallbacks and a few redone).
import { DEFAULT_ENGINES, type EngineFamily } from '../../../shared/cloud-engines'
import { ENGINE_TIMINGS, FAMILY_TIMINGS, LLM_TASK_TIMINGS, RENDER_TIME_SPREAD, RENDER_TIMING, type EngineTiming, type RenderTimeView } from '../../../shared/render-times'
import { applyOptions } from '../../../engine/technologies/compile'
import { COST_DEFAULTS, estimateShares } from '../../../engine/technologies/cost-defaults'
import type { MixKind } from '../../../engine/technologies/mix'
import type { RecipeDoc } from '../../../engine/technologies/recipe'
import type { TechnologyRegistry } from '../../../engine/technologies/registry'
import { techName } from '../../../engine/technologies/types'

/** Characters of one voice call (the narration is read in chunks). */
const VOICE_CHUNK_CHARS = 200

/** The timing of an engine (null: the family's default engine): its own, else its family's. */
export function timingOf(engine: string | null, family: EngineFamily): EngineTiming {
  return ENGINE_TIMINGS[engine ?? DEFAULT_ENGINES[family].engine] ?? FAMILY_TIMINGS[family]
}

/** Wall seconds of `calls` calls on one engine. */
export function wallSeconds(calls: number, timing: EngineTiming): number {
  if (calls <= 0) return 0
  return Math.ceil(calls / timing.parallel - 1e-9) * timing.secondsPerCall
}

/** The average wall seconds of one video of `minutes` minutes, step by step (null: the options do not apply). */
export function renderSteps(source: RecipeDoc, reg: TechnologyRegistry, minutes: number): { writing: number; voice: number; assets: number; render: number } | null {
  const applied = applyOptions(source, reg)
  if (!applied.ok) return null
  const doc = applied.doc
  const brick = (name: string) => doc.bricks.find((b) => techName(b.tech) === name)
  const engineOf = (family: EngineFamily, exclude?: string): string | null => {
    const b = doc.bricks.find((x) => reg.get(x.tech)?.engineFamily === family && techName(x.tech) !== exclude)
    return b ? (b.engine ?? DEFAULT_ENGINES[family].engine) : null
  }
  const T = minutes * 60

  // the writing: the team's tasks, one after the other
  const tasks: [string, boolean][] = [
    ['script', !!brick('script.write')],
    ['factcheck', !!brick('script.factcheck')],
    ['sponsor', !!brick('script.sponsor')],
    ['director', !!brick('director.plan') || !!brick('director.pov')],
    ['metadata', !!brick('package.youtube')]
  ]
  const writing = tasks.filter(([, on]) => on).reduce((s, [id]) => s + (LLM_TASK_TIMINGS[id]?.fixedS ?? 0) + (LLM_TASK_TIMINGS[id]?.perMinuteS ?? 0) * minutes, 0)

  // the voice, in chunks
  const tts = brick('voice.tts')
  const voiceEngine = engineOf('voice')
  const speed = typeof tts?.settings.speed === 'number' ? tts.settings.speed : 1
  const voice = voiceEngine ? wallSeconds(Math.ceil((COST_DEFAULTS.voiceCharsPerMinute * speed * minutes) / VOICE_CHUNK_CHARS), timingOf(voiceEngine, 'voice')) : 0

  // the presenter and the pictures, at once
  const presenterEngine = engineOf('presenter')
  const { shares } = estimateShares(doc.mix, presenterEngine !== null, minutes)
  const share = (k: MixKind): number => shares[k] ?? 0
  const len = { ...COST_DEFAULTS.shotLengthS, ...(doc.mix?.shotLengthS ?? {}) }
  let presenter = 0
  if (presenterEngine) {
    const timing = timingOf(presenterEngine, 'presenter')
    const shown = T * share('presenter')
    const continuous = brick('avatar.speak')?.settings.generation === 'continuous'
    const generated = continuous ? shown * COST_DEFAULTS.continuousRatio : shown * (1 + (2 * COST_DEFAULTS.handleS + COST_DEFAULTS.gapS) / len.presenter)
    presenter = wallSeconds(timing.maxSecondsPerCall ? Math.ceil(generated / timing.maxSecondsPerCall - 1e-9) : generated > 0 ? 1 : 0, timing)
  }
  let pictures = 0
  const imageEngine = engineOf('image', 'thumbnail.make')
  if (imageEngine) {
    const clip = doc.bricks.find((b) => reg.get(b.tech)?.engineFamily === 'clip')
    const s = clip?.settings ?? {}
    const perGen = typeof s.shotsPerGeneration === 'number' ? s.shotsPerGeneration : COST_DEFAULTS.clipShotsPerGeneration
    const asked = typeof s.pairShare === 'number' ? s.pairShare : perGen >= 2 ? 1 : 0
    const paired = s.pairSameAction === true ? Math.min(asked, COST_DEFAULTS.sameActionPairShare) : asked
    const clipShare = s.motionOnly === true ? Math.min(share('clipAi'), COST_DEFAULTS.motionShare * (share('clipAi') + share('imageAi'))) : share('clipAi')
    const gens = (T * clipShare) / len.clipAi * (1 - paired / 2)
    const stills = (T * (share('imageAi') + share('clipAi') - clipShare)) / len.imageAi + gens
    const still = timingOf(imageEngine, 'image')
    const stillsTime = wallSeconds(Math.ceil(stills - 1e-9), still)
    // a clip starts from its still: the first wave of stills, then the clips
    const clipEngine = clip ? (clip.engine ?? DEFAULT_ENGINES.clip.engine) : null
    const clipsTime = clipEngine && gens > 0 ? still.secondsPerCall + wallSeconds(Math.ceil(gens - 1e-9), timingOf(clipEngine, 'clip')) : 0
    pictures = Math.max(stillsTime, clipsTime)
  }
  const assets = Math.max(presenter, pictures)

  const render = RENDER_TIMING.fixedS + RENDER_TIMING.perMinuteS * minutes
  return { writing, voice, assets, render }
}

/** The render time of one video of `minutes` minutes: average, and its spread; null when the options do not apply. */
export function renderTime(doc: RecipeDoc, reg: TechnologyRegistry, minutes: number): RenderTimeView | null {
  const steps = renderSteps(doc, reg, minutes)
  if (!steps) return null
  const avg = Math.round(steps.writing + steps.voice + steps.assets + steps.render)
  return { minutes, seconds: { min: Math.round(avg * RENDER_TIME_SPREAD.min), avg, max: Math.round(avg * RENDER_TIME_SPREAD.max) } }
}
