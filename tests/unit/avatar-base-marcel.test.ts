// « Chaîne avatar » (avatar@2, chantier avatar-base-marcel): Marcel's hand-made clone made the avatar base, its character / voice /
// set given per channel, and Charlie's three avatar channels as variants. Marcel must come out unchanged: his variant compiles to
// the same pipeline and the same quote as the hand-made recipe « structure mesurée v3 » (avatar-layouts round 3, the fixture),
// and the other two keep every layout rule but the hook's length and the insets' spacing their own videos measure.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AVATAR_CHANNEL_CURVE,
  AVATAR_VARIANTS,
  avatarChannelBase,
  avatarVariant,
  basePipeline,
  checkDeclarations,
  compileRecipe,
  RecipeSchema,
  technologyRegistry,
  variantDoc,
  type RecipeDoc
} from '../../src/engine/technologies'
import { DEFAULT_SIMPLE_STYLE } from '../../src/engine/pipelines/simple-video'
import { withSpeakers } from '../../src/engine/pipelines/speakers'
import { productionRegistry } from '../../src/engine/nodes'
import { validatePipeline } from '../../src/engine/validate'
import { quoteMode } from '../../src/main/production/runs/quote'

const V3 = RecipeSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/marcel-structure-v3.recipe.json', import.meta.url), 'utf8')))
const STYLE: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit' }

function compiled(doc: RecipeDoc, minutes: number) {
  const c = compileRecipe(doc, technologyRegistry(), { id: 'avatar-base', project: { minutes } })
  if (!c.ok) throw new Error(`does not compile: ${c.errors.map((e) => e.code).join(', ')}`)
  return c.pipeline
}
/** The nodes' parameters, the mix and the engines a run gets: what the director, the pictures and the money see. */
function shape(doc: RecipeDoc, minutes: number) {
  const p = compiled(doc, minutes) as unknown as { nodes: { id: string; type: string; params?: unknown }[] }
  return p.nodes.map((n) => ({ id: n.id, type: n.type, params: n.params ?? null }))
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the settings are read loosely in the expectations
const brick = (doc: RecipeDoc, tech: string) => doc.bricks.find((b) => b.tech === tech)!.settings as Record<string, any>
function quote(doc: RecipeDoc, minutes: number) {
  const v = validatePipeline(withSpeakers(compiled(doc, minutes), STYLE), productionRegistry(), { styleFields: Object.keys(STYLE) })
  if (!v.ok) throw new Error('invalid pipeline')
  return quoteMode(v.plan, 'usage_max', { minutes, style: STYLE, useFakes: true, inputs: { topic: { value: 'Avant de couper votre clim pour l’hiver' } } })
}

/** The hand-made recipe as a run of the base would carry it: the script choice (« import », Charlie's own script for that test)
 *  is a choice of the run, not of the style, so both sides take the base's (« agent »), and the language is the channel's (fr).
 *  One change on purpose (avatar-base-marcel, real renders): the hand-made « half » clip pairs became « auto », because pairing two
 *  different subjects on one clip is a duplicate the blocking checks refuse (record 0102); everything else is unchanged. */
const v3AsRun = (): RecipeDoc => ({ ...structuredClone(V3), language: 'fr', options: { ...V3.options, script: 'agent', clipPairs: 'auto' } })
const marcel = (): RecipeDoc => ({ ...variantDoc(avatarVariant('marcel')!), options: { ...variantDoc(avatarVariant('marcel')!).options, script: 'agent' } })

describe('avatar@2 « Chaîne avatar »', () => {
  it('is a base pipeline with every option of avatar@1, at the hand-made clone defaults', () => {
    expect(basePipeline('avatar@2')).toBe(avatarChannelBase)
    expect(basePipeline('avatar@1')).toBeDefined()
    expect(checkDeclarations(avatarChannelBase.options)).toEqual([])
    const d = (id: string) => avatarChannelBase.options.find((o) => o.id === id)!.default
    expect([d('clipPairs'), d('clipShare'), d('music'), d('quality.voice')]).toEqual(['auto', 0.27, 'none', 'standard'])
    expect(RecipeSchema.safeParse(avatarChannelBase.doc).success).toBe(true)
    // the mix is the measured rows' own average, so the director gets the rows unscaled (avatar-layouts round 2)
    expect(avatarChannelBase.doc.mix?.curve).toEqual(AVATAR_CHANNEL_CURVE)
    expect(avatarChannelBase.doc.mix?.clipAi).toBe(0.27)
  })

  it('keeps the character, the voice and the set off the base: the channel (or a variant) gives them', () => {
    expect(avatarChannelBase.doc.inputs).toMatchObject({ presenter: 'channel', voice: 'channel' })
    const speak = brick(avatarChannelBase.doc, 'avatar.speak@1')
    const voice = brick(avatarChannelBase.doc, 'voice.tts@1')
    expect(speak.presenter).toBeUndefined()
    expect(voice.voice).toBeUndefined()
    // no Marcel in the base: his world and his trade's objects are his variant's
    expect(brick(avatarChannelBase.doc, 'director.plan@1').locale).toBeUndefined()
    expect(brick(avatarChannelBase.doc, 'director.plan@1').objectNotes).toBeUndefined()
  })
})

describe('Marcel is unchanged', () => {
  it('his variant carries the hand-made recipe’s director, pictures, clips and voice settings exactly', () => {
    for (const tech of ['director.plan@1', 'visuals.fulfil@1', 'clip.make@1', 'voice.tts@1', 'avatar.speak@1']) expect(brick(marcel(), tech)).toEqual(brick(V3, tech))
    expect(marcel().mix).toEqual(V3.mix)
  })

  it('compiles to the same pipeline (same layouts, same curve, same engines) for 3 and 13 minutes', () => {
    for (const minutes of [3, 13]) expect(shape(marcel(), minutes)).toEqual(shape(v3AsRun(), minutes))
  })

  it('is quoted the same', () => {
    for (const minutes of [3, 13]) {
      const a = quote(marcel(), minutes)
      const b = quote(v3AsRun(), minutes)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })
})

describe('the variants', () => {
  it('are Charlie’s three avatar channels, each a valid recipe of avatar@2', () => {
    expect(AVATAR_VARIANTS.map((v) => v.id)).toEqual(['marcel', 'klaus', 'aime'])
    for (const v of AVATAR_VARIANTS) {
      const doc = variantDoc(v)
      expect(RecipeSchema.safeParse(doc).success).toBe(true)
      expect(doc.base).toBe('avatar@2')
      expect(compileRecipe(doc, technologyRegistry(), { id: v.id, project: { minutes: 3 } }).ok).toBe(true)
      expect(v.character.length).toBeGreaterThan(40)
      expect(v.set.length).toBeGreaterThan(40)
    }
  })

  it('give each channel its world and keep the measured layout geometry', () => {
    const klaus = variantDoc(avatarVariant('klaus')!)
    const aime = variantDoc(avatarVariant('aime')!)
    expect(klaus.language).toBe('de')
    expect(brick(klaus, 'director.plan@1').locale).toBe('de-DE')
    expect(brick(klaus, 'visuals.fulfil@1').locale).toBe('de-DE')
    expect(brick(aime, 'director.plan@1').locale).toBe('fr-FR')
    const base = brick(avatarChannelBase.doc, 'director.plan@1').presenterLayouts
    for (const doc of [klaus, aime]) {
      const l = brick(doc, 'director.plan@1').presenterLayouts
      // what all three channels measure alike: presenter left, the same inset, the outro, the shares
      expect({ ...l, fromS: 0, fullUntilS: 0, insetGapS: 0 }).toEqual({ ...base, fromS: 0, fullUntilS: 0, insetGapS: 0 })
      expect(l.fullUntilS).toBeLessThan(l.fromS)
    }
    // their own videos: a longer full-frame hook than Marcel's 77 s, insets a little further apart or closer
    expect(brick(klaus, 'director.plan@1').presenterLayouts).toMatchObject({ fromS: 146, fullUntilS: 95, insetGapS: 57 })
    expect(brick(aime, 'director.plan@1').presenterLayouts).toMatchObject({ fromS: 99, fullUntilS: 85, insetGapS: 47 })
    // the same curve and budget: a variant costs what Marcel costs for the same length
    expect(klaus.mix).toEqual(avatarChannelBase.doc.mix)
  })

  it('take the MiniMax voice by one setting, once the channel has that clone', () => {
    const v = { ...avatarVariant('klaus')!, voice: { ...avatarVariant('klaus')!.voice, quality: 'high' as const } }
    const p = shape(variantDoc(v), 3).find((n) => n.id === 'voice')!.params as Record<string, unknown>
    expect(p.engine).toBe('voice:minimax-28-hd')
    const std = shape(variantDoc(avatarVariant('klaus')!), 3).find((n) => n.id === 'voice')!.params as Record<string, unknown>
    expect(std.engine).toBe('voice:ai33')
  })
})

describe('a German channel without Claude (the director’s fallback on the words)', () => {
  it('puts Klaus on the sentences he speaks to the viewer, and knows his introduction', async () => {
    const { talkByWords } = await import('../../src/engine/nodes/director-talk')
    const { triggerOf } = await import('../../src/engine/nodes/director-layout-rules')
    expect(talkByWords('Ich war einundvierzig Jahre im Kundendienst.')).toBe('talk')
    expect(talkByWords('Warten Sie.')).toBe('talk')
    expect(talkByWords('Fangen wir an.')).toBe('talk')
    expect(talkByWords('Unten in der Mitte sitzt das Sieb.')).toBe('show')
    expect(triggerOf('Ich bin Klaus.')).toBe('intro')
    expect(triggerOf('Ich bin müde.')).not.toBe('intro')
    expect(triggerOf('Ich war 41 Jahre im Kundendienst.')).toBe('intro')
    // French unchanged
    expect(talkByWords('Je m’appelle Marcel.')).toBe('talk')
    expect(triggerOf('Je m’appelle Marcel.')).toBe('intro')
  })
})
