// The production model in the engine (production-3, decisions 0021, 0022, 0024): `atelier.recette/1` documents load as
// `/2`; the mix adds to 1, moving a share rescales the others, and the `hook-heavy` curve keeps its shape (no stills in
// the opening) while delivering the mix over the video; edit operations apply as a whole or not at all; an engine or a
// fallback of the wrong family is refused; voice and presenter fall back for the whole video; every option of the base
// pipeline `avatar@1` compiles to a valid pipeline and changes only what its operations say; a « soon » choice is refused.
import { describe, expect, it } from 'vitest'
import { productionRegistry } from '../../src/engine/nodes'
import { DEFAULT_SIMPLE_STYLE } from '../../src/engine/pipelines/simple-video'
import {
  applyOps,
  avatarBase,
  averageShares,
  checkDeclarations,
  checkRecipe,
  compileRecipe,
  curveRows,
  fromBase,
  MIX_KINDS,
  MixSchema,
  optionProblem,
  parseRecipe,
  setShare,
  technologyRegistry,
  type EditOp,
  type OptionDecl,
  type RecipeDoc
} from '../../src/engine/technologies'
import { validatePipeline } from '../../src/engine/validate'
import { ENGINE_FAMILIES } from '../../src/shared/cloud-engines'
import { MIX_KINDS as SHARED_MIX_KINDS } from '../../src/shared/recipes'

const reg = technologyRegistry()
const STYLE_FIELDS = [...Object.keys(DEFAULT_SIMPLE_STYLE), 'systemVoice']
const avatar = (): RecipeDoc => fromBase(avatarBase)

function compiled(doc: RecipeDoc) {
  const r = compileRecipe(doc, reg)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r
}

describe('atelier.recette/1 loads as /2', () => {
  const v1 = {
    $schema: 'atelier.recette/1',
    name: 'Documentaire',
    videoType: 'documentaire',
    format: { aspect: '16:9', minutes: 3 },
    capCredits: 300,
    checkpoints: ['topic', 'script'],
    bricks: ['idea.research@1', 'script.write@1', 'voice.tts@1', 'director.plan@1', 'visuals.fulfil@1', 'captions.make@1', 'render.assemble@1', 'package.youtube@1'].map((tech) => ({
      tech,
      settings: tech === 'director.plan@1' ? { videoShare: 0.25, stockShare: 0.4 } : tech === 'voice.tts@1' ? { speed: 1.1 } : {}
    }))
  }

  it('keeps everything it said and adds the version 2 defaults; its mix comes from the director’s settings', () => {
    const r = parseRecipe(v1)
    if (!r.success) throw r.error
    const d = r.data
    expect(d).toMatchObject({ $schema: 'atelier.recette/2', name: 'Documentaire', base: null, language: null, options: {}, inputs: {}, capCredits: 300, checkpoints: ['topic', 'script'] })
    expect(d.bricks.map((b) => b.tech)).toEqual(v1.bricks.map((b) => b.tech))
    expect(d.bricks.every((b) => b.engine === null && b.fallbacks.length === 0 && b.style === null)).toBe(true)
    expect(d.bricks.find((b) => b.tech === 'voice.tts@1')?.settings).toEqual({ speed: 1.1 })
    expect(d.mix).toEqual({ clipAi: 0.25, stock: 0.3, imageAi: 0.45, curve: 'flat' })
    // it compiles exactly as before: the explicit director settings win over the mix
    const director = compiled(d).pipeline.nodes.find((n) => n.id === 'director')?.params
    expect(director).toMatchObject({ videoShare: 0.25, mix: { stock: 0.4, image: 0.6 } })
    expect(checkRecipe(v1, reg).ok).toBe(true)
  })

  it('a version 1 document without both director shares has no mix, so the share it left open stays open', () => {
    const r = parseRecipe({ ...v1, bricks: v1.bricks.map((b) => ({ ...b, settings: {} })) })
    expect(r.success && r.data.mix).toBe(null)
    const one = parseRecipe({ ...v1, bricks: v1.bricks.map((b) => ({ ...b, settings: b.tech === 'director.plan@1' ? { stockShare: 0.3 } : {} })) })
    if (!one.success) throw one.error
    expect(one.data.mix).toBe(null)
    const director = compiled(one.data).pipeline.nodes.find((n) => n.id === 'director')?.params ?? {}
    expect(director).toMatchObject({ mix: { stock: 0.3, image: 0.7 } })
    expect(director).not.toHaveProperty('videoShare')
  })
})

describe('the mix and its curve', () => {
  it('mirrors the shared list and refuses shares that do not add to 1', () => {
    expect([...SHARED_MIX_KINDS]).toEqual([...MIX_KINDS])
    expect(MixSchema.safeParse({ presenter: 0.5, imageAi: 0.4, curve: 'flat' }).success).toBe(false)
    expect(MixSchema.safeParse({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53 }).success).toBe(true)
  })

  it('moving one share rescales the others in proportion', () => {
    const m = setShare({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' as const }, 'clipAi', 0.41)
    expect(m.clipAi).toBe(0.41)
    expect((m.presenter ?? 0) + (m.clipAi ?? 0) + (m.imageAi ?? 0)).toBeCloseTo(1, 10)
    expect((m.presenter ?? 0) / (m.imageAi ?? 1)).toBeCloseTo(0.26 / 0.53, 3)
    expect(m.curve).toBe('hook-heavy')
  })

  it('hook-heavy keeps its shape (no stills in the first 30 s, stills growing) and delivers the mix over the video', () => {
    for (const clip of [0.21, 0.05, 0.45]) {
      const mix = setShare(MixSchema.parse({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' }), 'clipAi', clip)
      const rows = curveRows(mix, 720)
      expect(rows[0]?.shares.imageAi ?? 0).toBe(0)
      const stills = rows.map((r) => r.shares.imageAi ?? 0)
      expect(stills.every((s, i) => i === 0 || s >= (stills[i - 1] as number))).toBe(true)
      const avg = averageShares(rows, 720)
      for (const k of ['presenter', 'clipAi', 'imageAi'] as const) expect(avg[k] ?? 0).toBeCloseTo(mix[k] ?? 0, 2)
    }
  })

  it('a short video keeps the long video’s first rows (Charlie’s rule: « comme sur une vidéo longue »; production-17)', () => {
    const mix = MixSchema.parse({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' })
    const long = curveRows(mix, 720)
    const minute = curveRows(mix, 60)
    expect(minute).toEqual(long.slice(0, 2))
    // the first real 60 s run: fitted on 60 s alone, its second half was asked for stills only
    const second = minute[1]?.shares ?? {}
    expect(second.presenter ?? 0).toBeGreaterThan(0.15)
    expect(second.clipAi ?? 0).toBeGreaterThan(0.3)
    expect(second.imageAi ?? 0).toBeLessThan(0.5)
  })
})

describe('edit operations (decision 0024)', () => {
  it('apply a whole batch, or nothing, with typed errors', () => {
    const doc = avatar()
    const ops: EditOp[] = [
      { op: 'rename', name: 'Avatar — cuisine' },
      { op: 'setCap', capCredits: 900 },
      { op: 'setGate', checkpoints: ['topic', 'thumbnail'] },
      { op: 'setGate', checkpoint: 'script', on: true },
      { op: 'setInput', input: 'sponsor', source: null },
      { op: 'setSetting', brick: 'render.assemble', key: 'crf', value: 19 },
      { op: 'setStyle', brick: 'visuals.fulfil', style: 'clean-stock@1' },
      { op: 'moveBrick', brick: 'captions.make', after: 'sound.music' },
      { op: 'removeBrick', brick: 'thumbnail.make' },
      { op: 'addBrick', tech: 'motion.render@1' },
      { op: 'setMix', kind: 'presenter', share: 0.4 },
      { op: 'setCurve', curve: 'flat' }
    ]
    const r = applyOps(doc, ops, reg)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    const d = r.doc
    expect(d).toMatchObject({ name: 'Avatar — cuisine', capCredits: 900, checkpoints: ['topic', 'script', 'thumbnail'] })
    expect(d.inputs).not.toHaveProperty('sponsor')
    const names = d.bricks.map((b) => b.tech.replace(/@\d+$/, ''))
    expect(names.indexOf('captions.make')).toBe(names.indexOf('sound.music') + 1)
    expect(names).not.toContain('thumbnail.make')
    // added at the end of its stage (Éléments), before the Montage bricks
    expect(names.indexOf('motion.render')).toBe(names.indexOf('avatar.speak') + 1)
    expect(d.mix).toMatchObject({ presenter: 0.4, curve: 'flat' })
    expect(compileRecipe(d, reg).ok).toBe(true)
    // the source document is never changed
    expect(doc.name).toBe('Avatar')

    const bad = applyOps(doc, [{ op: 'rename', name: 'X' }, { op: 'removeBrick', brick: 'nope' }, { op: 'teleport' }], reg)
    expect(bad.ok ? [] : bad.errors.map((e) => [e.op, e.code])).toEqual([
      [1, 'unknown_brick'],
      [2, 'bad_op']
    ])
    expect(applyOps(doc, [{ op: 'addBrick', tech: 'voice.tts@1' }], reg)).toMatchObject({ ok: false, errors: [{ code: 'already_there' }] })
    expect(applyOps(doc, [{ op: 'setStyle', brick: 'qc.check', style: 'phone-real' }], reg)).toMatchObject({ ok: false, errors: [{ code: 'no_style' }] })
  })

  it('setGate changes one gate of the pipeline’s own list; on the channel’s list it asks for a whole list first', () => {
    const doc = avatar()
    expect(applyOps(doc, [{ op: 'setGate', checkpoint: 'voice', on: true }], reg)).toMatchObject({ ok: false, errors: [{ code: 'bad_op' }] })
    const own = applyOps(doc, [{ op: 'setGate', checkpoints: ['topic', 'script', 'final'] }, { op: 'setGate', checkpoint: 'final', on: false }], reg)
    expect(own.ok && own.doc.checkpoints).toEqual(['topic', 'script'])
    const back = applyOps(doc, [{ op: 'setGate', checkpoints: null }], reg)
    expect(back.ok && back.doc.checkpoints).toBe(null)
  })

  it('refuse an engine or a fallback of the wrong family, at the edit and at the compile', () => {
    const doc = avatar()
    expect(applyOps(doc, [{ op: 'setEngine', brick: 'voice.tts', engine: 'image:flux-schnell' }], reg)).toMatchObject({ ok: false, errors: [{ code: 'engine_family' }] })
    expect(applyOps(doc, [{ op: 'setFallbacks', brick: 'avatar.speak', fallbacks: ['presenter:hedra-c3', 'clip:wan22'] }], reg)).toMatchObject({ ok: false, errors: [{ code: 'engine_family' }] })
    expect(applyOps(doc, [{ op: 'setEngine', brick: 'render.assemble', engine: 'clip:wan22' }], reg)).toMatchObject({ ok: false, errors: [{ code: 'no_engine' }] })
    const forged = structuredClone(doc)
    const voice = forged.bricks.find((b) => b.tech === 'voice.tts@1')
    if (voice) voice.fallbacks = ['presenter:hedra-c3']
    const r = compileRecipe(forged, reg)
    expect(r.ok ? [] : r.errors.map((e) => [e.code, e.path.join('.')])).toEqual([['engine_family', `bricks.${voice ? forged.bricks.indexOf(voice) : -1}.fallbacks`]])
    // the Cloud's list, when known, refuses an engine it does not serve
    const unknown = compileRecipe(doc, reg, { engines: new Set(['voice:elevenlabs-v2']) })
    expect(unknown.ok ? [] : [...new Set(unknown.errors.map((e) => e.code))]).toEqual(['unknown_engine'])
  })
})

describe('the base pipeline avatar@1', () => {
  it('declares coherent options, compiles to a valid pipeline, and pins engines and styles by brick', () => {
    expect(checkDeclarations(avatarBase.options)).toEqual([])
    expect(avatarBase.doc.base).toBe(null)
    expect(avatarBase.doc.inputs).toEqual({ presenter: 'channel', voice: 'channel', style: 'channel', sponsor: 'channel' })
    const r = compiled(avatar())
    const v = validatePipeline(r.pipeline, productionRegistry(), { styleFields: STYLE_FIELDS })
    expect(v.ok ? [] : v.errors).toEqual([])
    // production-10 (decision 0039): Charlie's providers of 11-01, principal first
    expect(r.pins['avatar.speak']).toEqual({ tech: 'avatar.speak@1', engine: 'presenter:heygen-mcp', fallbacks: ['presenter:heygen-avatar4', 'presenter:pruna-avatar', 'presenter:kling-avatar-kie', 'presenter:infinitetalk-gpu'], fallbackScope: 'video', style: 'presenter-studio' })
    expect(r.pins['voice.tts']).toMatchObject({ engine: 'voice:ai33', fallbacks: ['voice:minimax-28-hd'], fallbackScope: 'video' })
    expect(r.pins['visuals.fulfil']).toMatchObject({ engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low', 'image:gpt-image-25-kie'], fallbackScope: 'item', style: 'phone-real' })
    expect(r.pins['render.assemble']).toMatchObject({ engine: null, fallbackScope: null })
    // the mix reaches the director: 21 % clips among 74 % of pictures, no stock
    expect(r.pipeline.nodes.find((n) => n.id === 'director')?.params).toMatchObject({ videoShare: 0.28, mix: { stock: 0, image: 1 } })
    // every engine family the avatar base uses is one the Cloud knows
    for (const p of Object.values(r.pins)) if (p.engine) expect(ENGINE_FAMILIES).toContain(p.engine.split(':')[0])
  })

  const values = (d: OptionDecl): (string | boolean | number)[] =>
    d.kind === 'slider' ? [d.min, d.max] : d.choices.filter((c) => !(c.soon ?? d.soon)).map((c) => c.value)
  const touched = (d: OptionDecl): { bricks: Set<string>; mix: boolean } => {
    const ops = d.kind === 'slider' ? d.effects : d.choices.flatMap((c) => c.effects)
    const bricks = new Set<string>()
    for (const o of ops) {
      if ('brick' in o) bricks.add(o.brick)
      if (o.op === 'addBrick') bricks.add(o.tech.replace(/@\d+$/, ''))
    }
    return { bricks, mix: ops.some((o) => o.op === 'setMix' || o.op === 'setCurve') }
  }

  it('every option value compiles and changes only what its operations say', () => {
    const before = compiled(avatar())
    const byName = (d: RecipeDoc) => new Map(d.bricks.map((b) => [b.tech.replace(/@\d+$/, ''), JSON.stringify(b)]))
    let tried = 0
    for (const decl of avatarBase.options) {
      const allowed = touched(decl)
      for (const value of values(decl)) {
        // the base's own stored choices stay (avatar-qualite: « Musique » is stored at « Aucune »)
        const doc = { ...avatar(), options: { ...avatar().options, [decl.id]: value } }
        const r = compileRecipe(doc, reg)
        if (!r.ok) throw new Error(`${decl.id}=${String(value)}: ${JSON.stringify(r.errors)}`)
        tried++
        const v = validatePipeline(r.pipeline, productionRegistry(), { styleFields: STYLE_FIELDS })
        expect(v.ok ? [] : v.errors, `${decl.id}=${String(value)}`).toEqual([])
        const a = byName(before.doc)
        const b = byName(r.doc)
        const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k))
        for (const k of changed) expect(allowed.bricks.has(k), `${decl.id}=${String(value)} changed ${k}`).toBe(true)
        if (!allowed.mix) expect(r.doc.mix, decl.id).toEqual(before.doc.mix)
        for (const k of ['name', 'format', 'inputs', 'capCredits', 'checkpoints', 'language'] as const) expect(r.doc[k], `${decl.id} ${k}`).toEqual(before.doc[k])
      }
    }
    expect(tried).toBeGreaterThan(15)
  })

  it('the options do what they say', () => {
    const at = (options: RecipeDoc['options']) => compiled({ ...avatar(), options })
    expect(at({ music: 'none' }).pipeline.nodes.map((n) => n.id)).not.toContain('sound')
    expect(at({ captions: true }).pipeline.nodes.find((n) => n.id === 'captions')?.params).toMatchObject({ burn: true })
    const imported = at({ script: 'import' })
    expect(imported.pins['script.import']).toBeDefined()
    expect(imported.pins['script.write']).toBeUndefined()
    expect(imported.pipeline.inputs.map((i) => i.id)).toContain('script')
    expect(at({ 'quality.images': 'premium' }).pins['visuals.fulfil']?.engine).toBe('image:nano-banana-2')
    expect(at({ 'quality.presenter': 'standard' }).pins['avatar.speak']).toMatchObject({ engine: 'presenter:heygen-avatar4', fallbacks: ['presenter:heygen-mcp', 'presenter:pruna-avatar', 'presenter:kling-avatar-kie'] })
    const more = at({ clipShare: 0.4 })
    expect(more.doc.mix?.clipAi).toBe(0.4)
    expect(more.pipeline.nodes.find((n) => n.id === 'director')?.params?.videoShare).toBe(0.5)
    // an explicit engine on the brick wins over the option (null: the option decides)
    const own = avatar()
    const vis = own.bricks.find((b) => b.tech === 'visuals.fulfil@1')
    if (vis) vis.engine = 'image:flux-schnell'
    expect(compiled({ ...own, options: { 'quality.images': 'premium' } }).pins['visuals.fulfil']).toMatchObject({ engine: 'image:flux-schnell', fallbacks: [] })
    // the engine and its fallbacks are one pin: the option never adds a fallback equal to the chosen engine
    if (vis) vis.engine = 'image:gpt-image-25-medium'
    expect(compiled(own).pins['visuals.fulfil']).toMatchObject({ engine: 'image:gpt-image-25-medium', fallbacks: [] })
    const fb = avatar()
    const speak = fb.bricks.find((b) => b.tech === 'avatar.speak@1')
    if (speak) speak.fallbacks = ['presenter:infinitetalk-fast']
    expect(compiled(fb).pins['avatar.speak']).toMatchObject({ engine: null, fallbacks: ['presenter:infinitetalk-fast'] })
  })

  it('a brick removed by hand stays removed while its option is at its default; choosing the option puts it back', () => {
    const r = applyOps(avatar(), [{ op: 'removeBrick', brick: 'sound.music' }], reg)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    expect(compiled(r.doc).pipeline.nodes.map((n) => n.id)).not.toContain('sound')
    expect(compiled({ ...r.doc, options: { music: 'library' } }).pipeline.nodes.map((n) => n.id)).toContain('sound')
  })

  it('refuses a « soon » choice, an unknown option or a bad value, and options on a pipeline without a base', () => {
    const codes = (options: RecipeDoc['options'], doc = avatar()) => {
      const r = compileRecipe({ ...doc, options }, reg)
      return r.ok ? [] : r.errors.map((e) => e.code)
    }
    expect(codes({ editing: 'advanced' })).toEqual(['bad_option'])
    // « Marques : aucune » works since production-6 (the director writes the rule into every prompt); acting the scene and the
    // clips' quality since production-8 (the portrait rides with the shots where someone acts; the clip brick's engines)
    expect(codes({ presenterInBroll: 'presenter-as-actor' })).toEqual([])
    expect(codes({ 'quality.clips': 'premium' })).toEqual([])
    expect(codes({ brands: 'none' })).toEqual([])
    expect(codes({ nope: true })).toEqual(['bad_option'])
    expect(codes({ clipShare: 0.9 })).toEqual(['bad_option'])
    expect(codes({ captions: true }, { ...avatar(), base: null })).toEqual(['bad_option'])
    expect(codes({}, { ...avatar(), base: 'documentaire@1' })).toEqual(['unknown_base'])
    expect(optionProblem(avatarBase.options, 'editing', 'advanced')).toMatch(/montage-avance/)
    expect(optionProblem(avatarBase.options, 'chapters', true)).toBe(null)
    expect(optionProblem(avatarBase.options, 'chapters', false)).toBe(null)
  })
})
