// production-8 (decision 0035): the quality options of `avatar@1` for images and clips pick the engines; « Qui apparaît » and
// « Marques » reach the pictures brick; the clip brick asks the stills brick for start stills only and, in eco, the director
// for two shots per generation; the brick's style reaches its node as a look when the compiler is given its document. Pure.
import { describe, expect, it } from 'vitest'
import { BASE_STYLES } from '../../src/main/production/styles/seeds'
import { avatarBase, compileRecipe, fromBase, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { estimateCost, optionCostDeltas, type PriceBook } from '../../src/engine/technologies/cost'
import type { PipelineNode } from '../../src/engine/pipeline-schema'
import { validatePipeline } from '../../src/engine/validate'
import { productionRegistry } from '../../src/engine/nodes'
import { DEFAULT_SIMPLE_STYLE } from '../../src/engine/pipelines/simple-video'
import { withSpeakers } from '../../src/engine/pipelines/speakers'

const reg = technologyRegistry()
const styles = Object.fromEntries(BASE_STYLES.map((s) => [s.id, s]))

function nodes(options: RecipeDoc['options'] = {}, withStyles = true): Record<string, PipelineNode> {
  const r = compileRecipe({ ...fromBase(avatarBase), options }, reg, withStyles ? { styles } : {})
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '))
  const v = validatePipeline(r.pipeline, productionRegistry(), { styleFields: [...Object.keys(DEFAULT_SIMPLE_STYLE), 'pace'] })
  if (!v.ok) throw new Error(v.errors.map((e) => `${e.code} ${e.path}`).join('; '))
  return Object.fromEntries(r.pipeline.nodes.map((n) => [n.id, n]))
}

describe('avatar@1 wires the pictures bricks', () => {
  it('by default (eco): GPT Image low for the stills, Veo Lite on the slow queue for the clips, two shots per clip', () => {
    const n = nodes()
    // production-10: OpenAI direct, then the same model on fal, then on Kie.ai; clips: UnificAlly relaxed → Grok Lite (vrais-tests) → Vertex → Kie.ai
    expect(n.visuals?.params).toMatchObject({ engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low', 'image:gpt-image-25-kie'], stillsOnly: true, people: 'not-presenter', brands: 'real' })
    expect(n.clips).toMatchObject({ type: 'clip.make@1', in: { list: 'director.genlist', images: 'visuals.images' } })
    expect(n.clips?.params).toMatchObject({ engine: 'clip:veo31-lite-relaxed', fallbacks: ['clip:grok-imagine-15-lite', 'clip:veo31-lite-vertex', 'clip:veo31-lite-kie'], timeoutS: 900 })
    expect(n.director?.params).toMatchObject({ clipShotsPerGeneration: 2 })
    // production-17: the thumbnails' art on the brick's image engine, like the stills (the first real run drew them on the Cloud's demo)
    expect(n.thumbnails?.params).toMatchObject({ engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low'] })
    // the render and the check read the clip brick's clips
    expect(n.render?.in?.clips).toBe('clips.clips')
  })

  it('captions are burnt only with the option on (off by default, like the reference); the final encode is CRF 18 medium (production-17)', () => {
    // the run style's `burn: true` is only the fallback of pipelines that do not set it: avatar@1's option always does
    expect(nodes().captions?.params).toMatchObject({ burn: false })
    expect(nodes({ captions: true }).captions?.params).toMatchObject({ burn: true })
    expect(nodes().render?.params).toMatchObject({ crf: 18, preset: 'medium' })
  })

  it('standard and premium change the clip engines and make one shot per clip', () => {
    expect(nodes({ 'quality.clips': 'standard' }).clips?.params).toMatchObject({ engine: 'clip:veo31-lite', fallbacks: ['clip:grok-imagine-15-lite', 'clip:veo31-lite-vertex', 'clip:veo31-lite-kie'] })
    const premium = nodes({ 'quality.clips': 'premium', 'quality.images': 'premium' })
    expect(premium.clips?.params).toMatchObject({ engine: 'clip:veo31-fast' })
    expect(premium.director?.params?.clipShotsPerGeneration).toBeUndefined()
    expect(premium.visuals?.params).toMatchObject({ engine: 'image:nano-banana-2', fallbacks: ['image:gpt-image-25-medium'] })
  })

  it('« Qui apparaît » and « Marques » reach the director and the pictures', () => {
    const n = nodes({ presenterInBroll: 'presenter-as-actor', brands: 'none' })
    expect(n.visuals?.params).toMatchObject({ people: 'presenter-as-actor', brands: 'none' })
    expect((n.director?.params?.screen as { people?: string; brands?: string }) ?? {}).toMatchObject({ people: 'presenter-as-actor', brands: 'none' })
    expect(nodes({ presenterInBroll: 'nobody' }).visuals?.params?.people).toBe('nobody')
  })

  it('« joue l’action »: the channel’s presenter (`$style.presenter`) reaches the stills brick, only with that option', () => {
    const doc = (options: RecipeDoc['options']) => {
      const r = compileRecipe({ ...fromBase(avatarBase), options }, reg)
      if (!r.ok) throw new Error('compile')
      return withSpeakers(r.pipeline, { presenter: { id: 'p1', portrait: 'C:/p1.png', angles: [], registrations: {} } }).nodes.find((n) => n.id === 'visuals')
    }
    expect(doc({ presenterInBroll: 'presenter-as-actor' })?.params?.presenter).toBe('$style.presenter')
    expect(doc({})?.params?.presenter).toBeUndefined()
  })

  it('the style reaches the node as a look when the compiler has its document; else the pin only', () => {
    expect(nodes().visuals?.params?.look).toMatchObject({ style: 'phone-real@1', people: 'not-presenter', brands: 'real', references: ['room-shots'] })
    expect(nodes({}, false).visuals?.params?.look).toBeUndefined()
  })
})

describe('what the options cost (2026-10-31 public prices, US $ per finished minute)', () => {
  const book: PriceBook = {
    currency: 'usd',
    engines: {
      'presenter:infinitetalk-fast': { unit: 'second', perUnit: 0.015 },
      'presenter:hedra-c3': { unit: 'second', perUnit: 0.025 },
      'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 0.075, maxSecondsPerCall: 8 },
      'clip:veo31-lite-vertex': { unit: 'second', perUnit: 0.03 },
      'clip:veo31-lite': { unit: 'clip', perUnit: 0.15, maxSecondsPerCall: 8 },
      'clip:veo31-fast': { unit: 'clip', perUnit: 0.3, maxSecondsPerCall: 8 },
      'clip:minimax-h3-lite': { unit: 'second', perUnit: 0.03 },
      'image:gpt-image-25-low': { unit: 'image', perUnit: 0.0059 },
      'image:gpt-image-25-medium': { unit: 'image', perUnit: 0.0132 },
      'image:nano-banana-2': { unit: 'image', perUnit: 0.067 },
      'voice:elevenlabs-v2': { unit: 'kchars', perUnit: 0.08 },
      'voice:minimax-28-hd': { unit: 'kchars', perUnit: 0.1 },
      'music:library': { unit: 'minute', perUnit: 0 }
    },
    llm: { models: {}, perUsd: 1 }
  }
  it('eco < standard < premium for images and clips; eco clips cost half of one shot per clip on the same engine', () => {
    const doc = fromBase(avatarBase)
    const d = optionCostDeltas(doc, reg, { book, backend: 'subscription' })
    expect(d['quality.clips']?.eco).toBe(0)
    expect(d['quality.clips']?.standard).toBeGreaterThan(0)
    expect(d['quality.clips']?.premium).toBeGreaterThan(d['quality.clips']?.standard as number)
    expect(d['quality.images']?.premium).toBeGreaterThan(d['quality.images']?.standard as number)
    const clipLine = (o: RecipeDoc): number => {
      const r = estimateCost(o, reg, { book, backend: 'subscription' })
      if (!r.ok) throw new Error(r.errors.join('; '))
      return r.estimate.lines.find((l) => l.id === 'clips')?.perMinute.avg ?? 0
    }
    // every clip shot paired, the cheap rules of vrais-tests off: half of one shot per clip
    const forced = { ...fromBase(avatarBase), options: { clipPairs: 'all', motionShots: 'all', shortClips: 'same' } }
    const one = { ...forced, options: { ...forced.options, clipPairs: 'none' } }
    one.bricks = one.bricks.map((b) => (b.tech === 'clip.make@1' ? { ...b, settings: { shotsPerGeneration: 1 } } : b))
    expect(clipLine(forced) / clipLine(one)).toBeCloseTo(0.5, 2)
    // the default (pairs on one action, short shots per second, motion only where it is seen) stays under one shot per clip
    expect(clipLine(doc)).toBeLessThan(clipLine(one))
  })
})
