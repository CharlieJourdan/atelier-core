// Chantier C (moteur-pipeline, decision 0099): P5 composes the pipeline from the Style Definitions of the acceptance channels with
// base bricks only (no base styling), compiles it to a recipe the engine accepts, fills the slots with placeholders, and lists the
// bricks built for what the analyses measured. Fixture definitions (chantier B's), no money.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sourcedFields, withAtPath, type PipelinePlan } from '../../src/shared/clone'
import { BASE_PIPELINES } from '../../src/engine/technologies/bases'
import { compileRecipe } from '../../src/engine/technologies/compile'
import { technologyRegistry } from '../../src/engine/technologies/registry'
import { phaseContext } from '../../src/main/production/clone/context'
import { FINARY, JAPANESE, MARCEL, MONDE_POV, YARNHUB } from '../../src/main/production/clone/definition/fixtures/profiles'
import { runDefinition, type DefinitionRun } from '../../src/main/production/clone/definition/fixtures/run'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { buildPlan, checkP5 } from '../../src/main/production/clone/p5-plan'
import { SETTING_MAP } from '../../src/main/production/clone/plan-rules'
import { brickSettings, compilePlan, recipeProblems } from '../../src/main/production/clone/pipeline/compile'
import { PLANNER_ONLY } from '../../src/main/production/clone/pipeline/settings'
import { cardStyleFrom, mixSharesFrom, presenterLayoutsFrom, referenceMinutesFrom } from '../../src/main/production/clone/pipeline/values'
import { CardStyle } from '../../src/engine/motion/styled'
import { CloneStore } from '../../src/main/production/clone/store'

const PROOF_DIR = process.env['CLONE_PIPELINE_PROOF_DIR']

function ctxOf() {
  const { services } = fakeServices(fakeChannel('presenter-motion'))
  const store = new CloneStore(mkdtempSync(path.join(os.tmpdir(), 'clone-pipeline-')), 'c1')
  return phaseContext(store, services, 10)
}

async function planOf(name: string, r: DefinitionRun): Promise<PipelinePlan> {
  const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
  if (PROOF_DIR) {
    const dir = path.join(PROOF_DIR, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'p5-pipeline-plan.json'), JSON.stringify(plan, null, 2) + '\n')
  }
  return plan
}

const CHANNELS = {
  finary: () => runDefinition(FINARY),
  marcel: () => runDefinition(MARCEL, { intent: 'own-channel', ownChannel: true }),
  japanese: () => runDefinition(JAPANESE, { intent: 'translate', language: 'fr', sourceLanguage: 'en' }),
  mondePov: () => runDefinition(MONDE_POV)
} as const

const tech = (p: PipelinePlan): string[] => p.bricks.map((b) => b.tech ?? b.node)
const brick = (p: PipelinePlan, t: string): Record<string, unknown> => ((p.recipe as { bricks: { tech: string; settings: Record<string, unknown> }[] }).bricks.find((b) => b.tech === t)?.settings ?? {})

describe('P5 on the acceptance channels', () => {
  for (const [name, run] of Object.entries(CHANNELS)) {
    it(`${name}: the plan passes checkP5 and its recipe compiles into an engine pipeline`, async () => {
      const r = await run()
      const plan = await planOf(name, r)
      expect(checkP5(plan, r.definition).problems).toEqual([])
      const compiled = compileRecipe(plan.recipe as never, technologyRegistry())
      expect(compiled.ok, JSON.stringify(compiled.ok ? '' : compiled.errors)).toBe(true)
      const doc = plan.recipe as { base: unknown; options: Record<string, unknown> }
      expect(doc.base).toBeNull()
      expect(doc.options).toEqual({})
    })
  }

  it('Finary: a presenter slot filled by a look-alike placeholder, his three angles switched, motion in Finary’s style', async () => {
    const r = await CHANNELS.finary()
    const plan = await planOf('finary', r)
    expect(tech(plan)).toEqual(expect.arrayContaining(['director.plan@1', 'avatar.speak@1', 'motion.render@1', 'visuals.fulfil@1']))
    const slot = plan.slots.find((s) => s.kind === 'presenter-footage')!
    expect(slot.filledBy).toBe('placeholder')
    expect(slot.placeholder?.ref).toMatch(/^placeholder:/)
    expect(brick(plan, 'avatar.speak@1')).toMatchObject({ framing: 'multi', presenter: { angles: expect.any(Array) } })
    const style = CardStyle.parse(brick(plan, 'motion.render@1')['style'])
    expect(style).toMatchObject({ ground: '#111111', ink: '#FFFFFF', accent: '#E4002B', face: 'sans', texture: 'glass', fullScreen: true })
    expect(plan.missingBricks.map((m) => [m.id, m.status])).toEqual(expect.arrayContaining([['motion.styled-cards', 'built'], ['presenter.multi-angle', 'built']]))
    // the filmed slot runs now on found footage of the same subject
    expect(plan.slots.find((s) => s.kind === 'footage')?.placeholder?.ref).toMatch(/^found-footage:/)
    // full frame through the hook, then the body's measured shares (full ≈ 80 %, split ≈ 20 % of his time), on the left
    expect(presenterLayoutsFrom(r.definition)).toMatchObject({ presenterSide: 'left' })
  })

  it('Marcel: his own avatar and voice (no placeholder), his three layouts per part, still generated pictures', async () => {
    const r = await CHANNELS.marcel()
    const plan = await planOf('marcel', r)
    expect(plan.slots.every((s) => s.filledBy !== 'placeholder')).toBe(true)
    expect(brick(plan, 'avatar.speak@1')['presenter']).toBeUndefined()
    expect(brick(plan, 'director.plan@1')['layouts']).toEqual(['full', 'pip', 'split'])
    const layouts = brick(plan, 'director.plan@1')['presenterLayouts'] as { split: number; pip: number; outro?: unknown }
    expect(layouts.split).toBeGreaterThan(layouts.pip)
    expect(mixSharesFrom(r.definition)).toMatchObject({ imageAi: expect.any(Number) })
    expect(mixSharesFrom(r.definition).clipAi).toBeUndefined()
    expect(referenceMinutesFrom(r.definition)).toBeGreaterThan(10)
  })

  it('The Japanese Method in French: a look-alike with his four angles, the script and voice in French', async () => {
    const r = await CHANNELS.japanese()
    const plan = await planOf('japanese', r)
    expect((plan.recipe as { language: string }).language).toBe('fr')
    expect(brick(plan, 'avatar.speak@1')).toMatchObject({ framing: 'multi' })
    expect(plan.slots.find((s) => s.kind === 'presenter-footage')?.filledBy).toBe('placeholder')
    // his rare cards are overlays on a blurred page, in yellow capitals
    const style = cardStyleFrom(r.definition)
    expect(style).toMatchObject({ fullScreen: false, texture: 'page', upper: true })
  })

  it('Le Monde en POV: drawn 2D scenes (director.pov), no presenter, 3D shots stood in by drawn scenes', async () => {
    const r = await CHANNELS.mondePov()
    const plan = await planOf('mondePov', r)
    expect(tech(plan)).toContain('director.pov@1')
    expect(tech(plan)).not.toContain('avatar.speak@1')
    expect(tech(plan)).not.toContain('director.plan@1')
    expect(brick(plan, 'director.pov@1')).toMatchObject({ palette: 'dusk' })
    expect(plan.missingBricks.find((m) => m.status === 'stand-in')?.by).toBe('director.pov@1')
    expect(cardStyleFrom(r.definition)).toMatchObject({ easing: 'back', face: 'geometric', texture: 'plates', fullScreen: true })
  })

  it('Yarnhub (all 3D): a plan would carry its 3D as a brick still to build, refused', async () => {
    const r = await runDefinition(YARNHUB)
    const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
    expect(checkP5(plan, r.definition).problems.join()).toMatch(/still to build/)
  })
})

describe('the rule: no base default styling in a compiled plan', () => {
  it('no recipe brick setting equals a base pipeline’s brick setting unless the definition computed it', async () => {
    for (const run of Object.values(CHANNELS)) {
      const r = await run()
      const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
      const recipe = plan.recipe as { bricks: { tech: string; settings: Record<string, unknown> }[] }
      for (const b of recipe.bricks) {
        for (const k of Object.keys(b.settings)) {
          const rule = SETTING_MAP.find((s) => s.key === `${b.tech.split('@')[0]}.${k}`)
          expect(rule, `${b.tech}.${k} has no rule`).toBeDefined()
        }
      }
    }
  })

  it('refuses a recipe that carries a base option, a base, or a base pipeline’s brick setting', async () => {
    const r = await CHANNELS.finary()
    const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
    const recipe = structuredClone(plan.recipe) as { base: string | null; options: Record<string, unknown>; bricks: { tech: string; settings: Record<string, unknown> }[] }
    const withBase = { ...recipe, base: 'avatar@1', options: { music: 'none' } }
    expect(recipeProblems(withBase, plan, BASE_PIPELINES).join()).toMatch(/names a base pipeline.*base options/s)
    const smuggled = structuredClone(recipe)
    smuggled.bricks.find((b) => b.tech === 'voice.tts@1')!.settings['speed'] = 1
    const avatar = BASE_PIPELINES.find((b) => b.id === 'avatar@1')!
    const baseVoice = avatar.doc.bricks.find((b) => b.tech === 'voice.tts@1')!.settings
    smuggled.bricks.find((b) => b.tech === 'voice.tts@1')!.settings['maxPauseS'] = baseVoice['maxPauseS']
    const problems = recipeProblems(smuggled, plan, BASE_PIPELINES).join('\n')
    expect(problems).toMatch(/setting speed is not computed from the definition/)
    expect(problems).toMatch(/maxPauseS differs from the plan|maxPauseS is not computed/)
  })

  it('an unmeasured motion style draws no styled card (null: the brick keeps its own drawing, the plan says so)', async () => {
    const r = await CHANNELS.finary()
    const noPalette = withAtPath(r.definition, 'motion.palette', { value: [], source: 'measured', evidence: [] })
    expect(cardStyleFrom(noPalette)).toBeUndefined()
    const plan = buildPlan(ctxOf(), r.brief, noPalette, r.feasibility)
    expect(brickSettings('motion.render@1', plan.settings)['style']).toBeUndefined()
    // no card is drawn in the templates' own look: the motion brick is left out
    expect(tech(plan)).not.toContain('motion.render@1')
    expect(plan.missingBricks.some((m) => m.id === 'motion.styled-cards')).toBe(false)
  })

  it('every measured definition field is read by a setting or named as planner-only', async () => {
    const read = new Set([...SETTING_MAP.flatMap((s) => s.fields), ...Object.keys(PLANNER_ONLY)])
    for (const [name, run] of Object.entries(CHANNELS)) {
      const r = await run()
      // a field counts by its top path (a structured field: `presenter.placeholder`)
      const unread = sourcedFields(r.definition)
        .filter((f) => f.field.source !== 'default')
        .map((f) => f.path)
        .filter((p) => !read.has(p) && !p.startsWith('analysisMeasures'))
      expect(unread, name).toEqual([])
    }
  })

  it('the mix, its curve and the presenter layouts are valid engine values on every channel', async () => {
    const { MixSchema } = await import('../../src/engine/technologies/mix')
    const { PresenterLayouts } = await import('../../src/engine/nodes/director-layouts')
    for (const [name, run] of Object.entries(CHANNELS)) {
      const r = await run()
      const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
      const mix = plan.settings.find((s) => s.key === 'recipe.mix')!.value
      expect(MixSchema.safeParse(mix).success, name).toBe(true)
      const layouts = presenterLayoutsFrom(r.definition)
      if (layouts) expect(PresenterLayouts.safeParse(layouts).success, `${name} ${JSON.stringify(layouts)}`).toBe(true)
    }
  })

  it('refuses a recipe setting equal to a base pipeline’s value when no measured field backs it', async () => {
    const r = await CHANNELS.mondePov()
    const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
    const pov = BASE_PIPELINES.find((b) => b.id === 'pov@1')!
    const baseBed = pov.doc.bricks.find((b) => b.tech === 'sound.music@1')!.settings['bedDb']
    // the same value marked default (not measured) in the definition: refused
    const unmeasured = withAtPath(r.definition, 'sound.musicLevelUnderVoiceDb', { value: baseBed, source: 'default', evidence: [] })
    const plan2 = buildPlan(ctxOf(), r.brief, unmeasured, r.feasibility)
    expect(recipeProblems(plan2.recipe, plan2, BASE_PIPELINES, unmeasured).join()).toMatch(/bedDb = -15 is a base pipeline's value no measured field backs/)
    // measured equal: allowed
    expect(recipeProblems(plan.recipe, plan, BASE_PIPELINES, r.definition)).toEqual([])
  })

  it('compilePlan is pure: the same plan gives the same recipe', async () => {
    const r = await CHANNELS.mondePov()
    const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
    expect(compilePlan(plan, r.definition)).toEqual(compilePlan(plan, r.definition))
  })
})

describe('the channel-styled card family (engine)', () => {
  it('draws each template in the measured style, never the templates’ own blue accent, with readable ink', async () => {
    const { styledCardHtml } = await import('../../src/engine/motion/styled-cards')
    const { contrast } = await import('../../src/engine/motion/base')
    const { MotionSpec } = await import('../../src/engine/formats/motion')
    for (const run of Object.values(CHANNELS)) {
      const style = cardStyleFrom((await run()).definition)!
      expect(contrast(style.ink, style.ground)).toBeGreaterThanOrEqual(4.5)
      for (const [template, props] of [
        ['title', { title: 'Ton épargne perd de la valeur' }],
        ['figure', { value: 2.4, decimals: 1, suffix: '%', label: 'd’inflation' }],
        ['list', { items: [{ text: 'Un' }, { text: 'Deux' }] }],
        ['kinetic', { words: [{ text: 'Et', atS: 0.1 }, { text: 'pourtant', atS: 0.4, emphasis: true }] }],
        ['chart', { title: 'Prix', kind: 'line', atS: 0.2, points: [{ label: '2015', value: 1 }, { label: '2024', value: 2 }] }]
      ] as const) {
        const spec = MotionSpec.parse({ template, props })
        const html = styledCardHtml(template, spec.props, { width: 1920, height: 1080, durationS: 3, fontCss: '' }, style)
        expect(html).toContain(`--accent:${style.accent}`)
        expect(html).not.toMatch(/#3B82F6/i)
      }
    }
  })
})

describe('the plan quote (cloud service)', () => {
  it('divides the Cloud’s quote of the compiled recipe by its length, and refuses a plan without a recipe', async () => {
    const { planQuoteService } = await import('../../src/main/production/clone/pipeline/quote')
    const r = await CHANNELS.finary()
    const plan = buildPlan(ctxOf(), r.brief, r.definition, r.feasibility)
    const seen: number[] = []
    const svc = planQuoteService({ quoteRecipe: async (_recipe, minutes) => (seen.push(minutes), minutes * 0.55) })
    expect(await svc.quoteUsdPerMinute(plan)).toBeCloseTo(0.55, 3)
    expect(seen[0]).toBe((plan.recipe as { format: { minutes: number } }).format.minutes)
    await expect(svc.quoteUsdPerMinute({ ...plan, recipe: null })).rejects.toThrow(/no compiled recipe/)
  })
})
