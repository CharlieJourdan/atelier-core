// Production rebuilt (production-2, decisions 0010 and 0011): the technology registry generated from the manifests in
// code (every existing node registered as a technology, labels in French, Cloud usages and agent tools that exist), and
// the recipe compiler: a recipe of the existing technologies compiles to a valid `atelier.pipeline/1`; settings resolve
// technology < recipe < channel < project, each layer limited to what the technology lets it set; the same recipe for
// two channels with different channel settings gives two pipelines that differ only in those params; checkpoints become
// owner gates (default: topic + thumbnail); a broken recipe is refused with stable codes.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { productionRegistry } from '../../src/engine/nodes'
import { DEFAULT_SIMPLE_STYLE } from '../../src/engine/pipelines/simple-video'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import {
  CHECKPOINTS,
  compileRecipe,
  checkRecipe,
  defineTechnology,
  settingKeys,
  STAGES,
  TECHNOLOGIES,
  TechnologyError,
  TechnologyRegistry,
  technologyRegistry,
  VIDEO_TYPES,
  type RecipeDoc
} from '../../src/engine/technologies'
import { validatePipeline } from '../../src/engine/validate'
import { TECHNOLOGY_IDS } from '../../src/main/orchestra/technologies'
import { USAGES } from '../../src/shared/cloud-api'
import { fr } from '../../src/shared/fr'
import { RECIPE_CHECKPOINTS, RECIPE_STAGES, RECIPE_VIDEO_TYPES } from '../../src/shared/recipes'

const reg = technologyRegistry()
const STYLE_FIELDS = [...Object.keys(DEFAULT_SIMPLE_STYLE), 'systemVoice']

const DOCU_BRICKS = [
  'idea.research@1',
  'script.write@1',
  'voice.tts@1',
  'director.plan@1',
  'visuals.fulfil@1',
  'captions.make@1',
  'sound.music@1',
  'render.assemble@1',
  'thumbnail.make@1',
  'package.youtube@1'
]

/** A brick entry of `atelier.recette/2` with its engine, fallbacks and style left open. */
const entry = (tech: string, settings: Record<string, unknown> = {}): RecipeDoc['bricks'][number] => ({ tech, settings, engine: null, fallbacks: [], style: null })

function recipe(over: Partial<RecipeDoc> = {}, bricks: string[] = DOCU_BRICKS): RecipeDoc {
  return {
    $schema: 'atelier.recette/2',
    base: null,
    language: null,
    mix: null,
    options: {},
    inputs: {},
    name: 'Documentaire',
    videoType: 'documentaire',
    format: { aspect: '16:9', minutes: 1 },
    capCredits: 400,
    checkpoints: null,
    bricks: bricks.map((tech) => entry(tech)),
    ...over
  }
}

function compiled(r: ReturnType<typeof compileRecipe>): Pipeline {
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.pipeline
}

const valid = (p: Pipeline): void => {
  const v = validatePipeline(p, productionRegistry(), { styleFields: STYLE_FIELDS })
  expect(v.ok ? [] : v.errors).toEqual([])
}

/** Every leaf that differs between two JSON values, as `path: a → b`. */
function diff(a: unknown, b: unknown, at = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`]
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k))
}

describe('the technology registry (decision 0010)', () => {
  it('the shared lists mirror the engine’s', () => {
    expect([...RECIPE_STAGES]).toEqual([...STAGES])
    expect([...RECIPE_CHECKPOINTS]).toEqual([...CHECKPOINTS])
    expect([...RECIPE_VIDEO_TYPES]).toEqual([...VIDEO_TYPES])
  })

  it('registers every production node as (part of) a technology, at least one per stage, with no behaviour of its own', () => {
    const nodeTypes = new Set(reg.list().flatMap((t) => t.nodes.map((n) => n.type)))
    for (const def of productionRegistry().list()) expect(nodeTypes, def.type).toContain(def.type)
    for (const stage of STAGES) expect(reg.list().some((t) => t.stage === stage), stage).toBe(true)
    expect(reg.list().map((t) => t.id)).toHaveLength(TECHNOLOGIES.length)
  })

  it('every technology has a French label and blurb, every setting a French label; usages and agent tools exist', () => {
    const keys = fr as Record<string, string>
    for (const t of reg.list()) {
      expect(keys[t.labelKey], t.labelKey).toBeTruthy()
      expect(keys[`${t.labelKey}.blurb`], `${t.labelKey}.blurb`).toBeTruthy()
      for (const k of settingKeys(t)) expect(keys[`techSet.${k}`], `techSet.${k}`).toBeTruthy()
      for (const u of t.cloudUsages) expect(USAGES as readonly string[], `${t.id} usage ${u}`).toContain(u)
      for (const a of t.agentTools) expect(TECHNOLOGY_IDS, `${t.id} tool ${a}`).toContain(a)
    }
  })

  it('refuses a malformed manifest: unknown node or port, a slot that does not exist, an overridable setting it lacks, no default', () => {
    const base = {
      id: 'test.thing@1' as const,
      labelKey: 'tech.test.thing',
      stage: 'script' as const,
      kind: 'script' as const,
      provides: { script: 'n.text' },
      params: z.object({ a: z.number().default(1) }),
      overridable: { recipe: ['a' as const], channel: [] },
      nodeParams: () => ({}),
      cloudUsages: [],
      agentTools: [],
      access: 'everyone' as const,
      status: 'draft' as const
    }
    const r = new TechnologyRegistry(productionRegistry())
    expect(() => r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'nope.node@1', in: {} }] }))).toThrow(/not registered/)
    expect(() => r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'script.write@1', in: { nope: '@brief' } }] }))).toThrow(/no input "nope"/)
    expect(() => r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'script.write@1', in: { brief: '@nothing' } }] }))).toThrow(/names no slot/)
    expect(() =>
      r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'script.write@1', in: { brief: '@brief' } }], overridable: { recipe: ['zzz' as 'a'], channel: [] } }))
    ).toThrow(/overridable "zzz"/)
    expect(() =>
      r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'script.write@1', in: { brief: '@brief' } }], params: z.object({ a: z.number() }) }))
    ).toThrow(TechnologyError)
    r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'script.write@1', in: { brief: '@brief' } }] }))
    expect(() => r.register(defineTechnology({ ...base, nodes: [{ id: 'n', type: 'script.write@1', in: { brief: '@brief' } }] }))).toThrow(/already registered/)
  })
})

describe('compiling a recipe (decision 0011)', () => {
  it('a recipe of the existing technologies compiles to a valid pipeline, one fixed budget mode, the cap carried', () => {
    const p = compiled(compileRecipe(recipe(), reg))
    valid(p)
    expect(p.budget).toEqual({ default: 'usage_max', capCredits: 400 })
    expect(p.nodes.every((n) => n.modes === undefined)).toBe(true)
    expect(p.nodes.map((n) => n.id)).toEqual(['research', 'script', 'voice', 'beats', 'director', 'visuals', 'captions', 'sound', 'render', 'thumbnails', 'package'])
    // the render reads the captions and the music although they come before it in the stage, and the package the thumbnails after it
    expect(p.nodes.find((n) => n.id === 'render')?.in).toMatchObject({ subs: 'captions.subs', music: 'sound.music', images: 'visuals.images', clips: 'visuals.clips' })
    expect(p.nodes.find((n) => n.id === 'package')?.in).toMatchObject({ thumbnails: 'thumbnails.thumbnails' })
    // clone-reddit-shorts: the music brick also takes the channel's own track when it has one (optional)
    expect(p.inputs.map((i) => i.id)).toEqual(['topic', 'channelMusic'])
    expect(p.inputs.find((i) => i.id === 'channelMusic')?.required).toBeFalsy()
  })

  it('default checkpoints are the topic and the thumbnail (owner gates); every other node is explicitly none', () => {
    const r = compileRecipe(recipe(), reg)
    const p = compiled(r)
    expect(r.ok && r.checkpoints).toEqual(['topic', 'thumbnail'])
    const gates = Object.fromEntries(p.nodes.map((n) => [n.id, n.gate]))
    expect(gates).toMatchObject({ research: 'owner', thumbnails: 'owner', package: 'none', script: 'none', render: 'none' })
    // the channel's checkpoints, then the recipe's own, win in that order
    const channel = compiled(compileRecipe(recipe(), reg, { channel: { technologies: {}, checkpoints: ['script', 'final'] } }))
    expect(channel.nodes.filter((n) => n.gate === 'owner').map((n) => n.id)).toEqual(['script', 'render'])
    const own = compiled(compileRecipe(recipe({ checkpoints: ['voice'] }), reg, { channel: { technologies: {}, checkpoints: ['script'] } }))
    expect(own.nodes.filter((n) => n.gate === 'owner').map((n) => n.id)).toEqual(['voice'])
  })

  it('the same recipe for two channels with different channel settings: two pipelines that differ only in those params', () => {
    const doc = recipe()
    const a = compiled(compileRecipe(doc, reg, { channel: { technologies: { 'voice.tts': { voice: 'voix-a' }, 'package.youtube': { footer: ['Chaîne A'] } }, checkpoints: null } }))
    const b = compiled(compileRecipe(doc, reg, { channel: { technologies: { 'voice.tts': { voice: 'voix-b', speed: 1.1 }, 'package.youtube': { footer: ['Chaîne B'] } }, checkpoints: null } }))
    valid(a)
    valid(b)
    const ia = a.nodes.findIndex((n) => n.id === 'voice')
    const ip = a.nodes.findIndex((n) => n.id === 'package')
    expect(diff(a, b).sort()).toEqual(
      [
        `nodes.${ia}.params.voice: "voix-a" → "voix-b"`,
        `nodes.${ia}.params.speed: 1 → 1.1`,
        `nodes.${ip}.params.footer.0: "Chaîne A" → "Chaîne B"`
      ].sort()
    )
  })

  it('settings resolve technology < recipe < channel < project, each layer limited to what it may set', () => {
    const doc = recipe({ bricks: DOCU_BRICKS.map((tech) => entry(tech, tech === 'render.assemble@1' ? { crf: 18 } : tech === 'voice.tts@1' ? { speed: 0.9 } : {})) })
    const p = compiled(compileRecipe(doc, reg, { channel: { technologies: { 'voice.tts': { speed: 1.05 } }, checkpoints: null }, project: { technologies: { 'voice.tts': { speed: 1.2 } }, minutes: 2 } }))
    expect(p.nodes.find((n) => n.id === 'render')?.params).toMatchObject({ crf: 18, preset: 'medium' })
    expect(p.nodes.find((n) => n.id === 'voice')?.params).toMatchObject({ speed: 1.2, voice: '$style.voice' })
    expect(p.format.minutes.default).toBe(2)
    // a channel may not set the render quality; a project may not set what neither the recipe nor the channel may
    const bad = compileRecipe(doc, reg, { channel: { technologies: { 'render.assemble': { crf: 30 } }, checkpoints: null } })
    expect(bad.ok ? [] : bad.errors.map((e) => e.code)).toEqual(['not_overridable'])
    const out = compileRecipe(recipe({ bricks: [entry('voice.tts@1', { speed: 3 }), ...recipe().bricks.filter((b) => b.tech !== 'voice.tts@1')] }), reg)
    expect(out.ok ? [] : out.errors.map((e) => e.code)).toContain('bad_settings')
  })

  it('unset settings leave the node param open, so the channel’s style profile can fill it', () => {
    const p = compiled(compileRecipe(recipe(), reg))
    const director = p.nodes.find((n) => n.id === 'director')?.params ?? {}
    for (const k of ['cpm', 'mix', 'videoShare', 'maxVideoClips']) expect(director, k).not.toHaveProperty(k)
    const thumbs = p.nodes.find((n) => n.id === 'thumbnails')?.params ?? {}
    for (const k of ['layout', 'style', 'withFace']) expect(thumbs, k).not.toHaveProperty(k)
  })

  it('a translation replaces the script for every later brick; a short is a 9:16 film with the shorts captions', () => {
    const bricks = [...DOCU_BRICKS]
    bricks.splice(2, 0, 'script.translate@1')
    const p = compiled(compileRecipe(recipe({ format: { aspect: '9:16', minutes: 1 } }, bricks), reg))
    valid(p)
    expect(p.nodes.find((n) => n.id === 'translate')?.in).toEqual({ script: 'script.text', outline: 'script.outline' })
    expect(p.nodes.find((n) => n.id === 'voice')?.in).toEqual({ script: 'translate.text' })
    expect(p.format).toMatchObject({ kind: 'youtube_short', aspect: '9:16' })
    expect(p.nodes.find((n) => n.id === 'director')?.params).toMatchObject({ aspect: '9:16', captionsPreset: 'shorts', cpm: 24 })
    expect(p.nodes.find((n) => n.id === 'captions')?.params).toMatchObject({ preset: 'shorts' })
  })

  it('a presenter and animated overlays ask the director for their shots; a gameplay background asks for its folder', () => {
    const bricks = [...DOCU_BRICKS]
    bricks.splice(5, 0, 'avatar.speak@1', 'motion.render@1', 'card.intro@1')
    const p = compiled(compileRecipe(recipe({}, bricks), reg, { channel: { technologies: { 'avatar.speak': { avatarId: 'mon-avatar', layout: 'pip' } }, checkpoints: ['avatar'] } }))
    valid(p)
    const director = p.nodes.find((n) => n.id === 'director')
    expect(director?.params).toMatchObject({ avatar: { segments: ['hook', 'outro'], layout: 'pip' }, motion: {} })
    expect(director?.in).toMatchObject({ script: 'script.text' })
    expect(p.nodes.find((n) => n.id === 'avatar')).toMatchObject({ params: { avatarId: 'mon-avatar' }, gate: 'owner' })
    expect(p.nodes.find((n) => n.id === 'render')?.in).toMatchObject({ avatar: 'avatar.clips', motion: 'motion.graphics', graphics: 'card.card' })
    const g = compiled(compileRecipe(recipe({}, DOCU_BRICKS.map((b) => (b === 'visuals.fulfil@1' ? 'background.clips@1' : b))), reg))
    valid(g)
    expect(g.inputs.find((i) => i.id === 'gameplay')).toMatchObject({ required: true })
  })

  it('refuses a broken recipe with stable codes', () => {
    const codes = (doc: unknown): string[] => {
      const r = checkRecipe(doc, reg)
      return r.ok ? [] : [...new Set(r.errors.map((e) => e.code))]
    }
    expect(codes({ ...recipe(), $schema: 'nope' })).toEqual(['schema'])
    expect(codes(recipe({}, ['idea.research@1', 'nope.tech@1']))).toEqual(['unknown_technology'])
    expect(codes(recipe({}, ['script.write@1', 'idea.research@1', ...DOCU_BRICKS.slice(2)]))).toEqual(['stage_order'])
    expect(codes(recipe({}, ['idea.research@1', 'script.write@1', 'script.pasted@1', ...DOCU_BRICKS.slice(2)]))).toContain('duplicate_node')
    expect(codes(recipe({}, DOCU_BRICKS.filter((b) => b !== 'voice.tts@1')))).toEqual(['missing_slot'])
    expect(codes(recipe({}, DOCU_BRICKS.filter((b) => b !== 'render.assemble@1' && b !== 'package.youtube@1')))).toEqual(['no_video'])
    expect(codes(recipe({}, [...DOCU_BRICKS, 'voice.tts@1']))).toContain('stage_order')
    expect(codes(recipe())).toEqual([])
  })
})
