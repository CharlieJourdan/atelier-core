// solidite, « no silent overrides »: a pipeline option never undoes a value the recipe set itself without saying so.
// Avatar round 2 rendered as round 1 because the « clipShare » slider (default 0.21, nobody moved it) silently replaced
// the recipe's own `mix.clipAi`. Now a slider nobody moved leaves the recipe's own value alone; one moved on purpose
// replaces it and the override is listed (recipes.check, projects.compile) and kept in the run's notes.
import { afterEach, describe, expect, it } from 'vitest'
import { avatarBase, compileRecipe, fromBase, setShare, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import type { RecipeDocument } from '../../src/shared/recipes'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'
import { memoryCore } from './helpers'

const reg = technologyRegistry()
const avatar = (): RecipeDoc => fromBase(avatarBase)
const compiled = (doc: RecipeDoc) => {
  const r = compileRecipe(doc, reg)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r
}
const withClips = (share: number, options: RecipeDoc['options'] = {}): RecipeDoc => {
  const d = avatar()
  return { ...d, mix: setShare(d.mix as NonNullable<RecipeDoc['mix']>, 'clipAi', share), options }
}

describe('an option never replaces the recipe’s own value in silence', () => {
  it('the base as it is: the slider applies, nothing to say', () => {
    const r = compiled(avatar())
    expect(r.doc.mix?.clipAi).toBe(0.21)
    expect(r.overrides).toEqual([])
  })

  it('the recipe’s own clip share wins over a slider nobody moved (avatar round 2)', () => {
    const r = compiled(withClips(0.4))
    expect(r.doc.mix?.clipAi).toBe(0.4)
    expect(r.overrides).toEqual([])
  })

  it('a slider moved on purpose replaces it, and says so', () => {
    const r = compiled(withClips(0.4, { clipShare: 0.3 }))
    expect(r.doc.mix?.clipAi).toBe(0.3)
    expect(r.overrides).toEqual([{ option: 'clipShare', path: 'mix.clipAi', from: 0.4, to: 0.3 }])
    // the same value moved to: nothing replaced
    expect(compiled(withClips(0.4, { clipShare: 0.4 })).overrides).toEqual([])
  })
})

let fx: Fixture | null = null
afterEach(() => fx?.cleanup())

describe('the override is shown before the run and kept in it', () => {
  it('recipes.check and projects.compile list it; the run keeps it in its notes', async () => {
    const f = fixture()
    fx = f
    // the run itself goes on the fixture's light test nodes (the point is what the project hands it)
    const light = (doc: Pipeline): Pipeline => ({
      ...doc,
      format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 1, min: 0.5, max: 30 } },
      inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet' }],
      budget: { default: 'usage_max' },
      nodes: [
        { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' } },
        { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' } }
      ]
    })
    const core = memoryCore({ productionRuns: { ...f.productionRuns, adaptDocument: light } })
    try {
      const api = core.api
      const doc = { ...withClips(0.4, { clipShare: 0.3, script: 'import' }) } as unknown as RecipeDocument
      const check = await api['recipes.check'](doc)
      expect(check.overrides).toEqual([{ option: 'clipShare', path: 'mix.clipAi', from: 0.4, to: 0.3 }])
      const ch = await api['channels.create']({ name: 'Marcel' })
      const recipe = await api['recipes.save']({ doc })
      const p = await api['projects.create']({ recipeId: recipe.id, channelId: ch.id, title: 'Essai', idea: 'Un essai', inputs: { script: 'Un script court. Deux phrases.' } })
      expect((await api['projects.compile'](p.id)).overrides).toEqual([{ option: 'clipShare', path: 'mix.clipAi', from: 0.4, to: 0.3 }])
      const launched = await api['projects.run'](p.id)
      const run = await waitFor(async () => (await api['production.get'](launched.runId as number)) ?? null, 8_000, 'run')
      expect(run.notes).toEqual(['L’option « clipShare » a remplacé une valeur que la pipeline fixait elle-même : mix.clipAi 0.4 → 0.3.'])
    } finally {
      core.close()
    }
  })
})
