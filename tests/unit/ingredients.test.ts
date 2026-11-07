// parcours-utilisateur (Charlie 02/11): every ingredient of a pipeline offers its realistic sources — mine, found by the agent,
// generated, cloned — read from what the pipeline can do, never from a table per genre. His Reddit example as a user who already runs
// such channels: his own gameplay clips, his own scripts, his cloned voice, his profile picture on the card; an avatar channel: the
// presenter cloned or invented, several shots, archives where they fit. Each choice applies, compiles and is priced.
import { describe, expect, it } from 'vitest'
import { avatarBase, compileRecipe, documentary2Base, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { storyShortBase } from '../../src/engine/technologies/bases/story-short'
import { ingredientsOf, withIngredients } from '../../src/engine/technologies/ingredients'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { priceView } from '../../src/main/production/style-agent/ingredients-view'

const reg = technologyRegistry()
const ids = (doc: ReturnType<typeof fromBase>, refs: VideoMeasure[] = []) => Object.fromEntries(ingredientsOf(doc, reg, refs).map((i) => [i.id, i.options.map((o) => `${o.source}:${o.id}`)]))

describe('the ingredients of a pipeline', () => {
  it('a story short offers my own clips, my scripts, my cloned voice and my profile picture, without knowing me', () => {
    const doc = fromBase(storyShortBase)
    const all = ingredientsOf(doc, reg, [])
    const by = Object.fromEntries(all.map((i) => [i.id, i]))
    expect(by.pictures?.current).toBe('pictures-import')
    expect(by.script?.current).toBe('script-import')
    expect(by.voice?.options.map((o) => o.source)).toEqual(['generate', 'clone', 'import'])
    expect(by.branding?.options.find((o) => o.id === 'branding-import')?.needs).toMatch(/photo de profil/)
    // no presenter, no cards: those ingredients do not exist for it
    expect(by.presenter).toBeUndefined()
    expect(by.motion).toBeUndefined()
  })

  it('an avatar channel offers its presenter invented or cloned, fewer, several shots; a documentary its cards', () => {
    expect(ids(fromBase(avatarBase)).presenter).toEqual(['generate:presenter-invented', 'clone:presenter-clone', 'generate:presenter-less', 'generate:presenter-angles'])
    expect(ids(fromBase(documentary2Base)).motion).toEqual(['generate:motion-keep', 'generate:motion-more', 'none:motion-none'])
  })

  it('the pictures the references never show come last and are marked far', () => {
    const refs = [{ kinds: { archive: 0.8, motion: 0.2 } } as VideoMeasure]
    const pics = ingredientsOf(fromBase(documentary2Base), reg, refs).find((i) => i.id === 'pictures')
    expect(pics?.options.at(-1)?.far).toBe(true)
    expect(pics?.options.find((o) => o.id === 'pictures-find')?.title).toMatch(/Archives/)
    expect(pics?.reference).toMatch(/archives 80 %/)
  })

  it('cards no brick can draw (the eyes read real clips as « 100 % animations ») are pictures to source', () => {
    const doc = { ...fromBase(storyShortBase), mix: { motion: 1, curve: 'flat' } } as ReturnType<typeof fromBase>
    const pics = ingredientsOf(doc, reg, []).find((i) => i.id === 'pictures')
    expect(pics?.options.map((o) => o.id)).toContain('pictures-import')
    const mine = withIngredients(doc, { pictures: 'pictures-import' }, reg)
    expect(mine.mix).toMatchObject({ userFootage: 1 })
    expect((mine.mix as unknown as Record<string, number>).motion).toBeUndefined()
  })

  it('« Je m’enregistre » reads as what it means, never as a free video', () => {
    const voice = ingredientsOf(fromBase(storyShortBase), reg, []).find((i) => i.id === 'voice')
    expect(voice?.options.find((o) => o.id === 'voice-import')?.lever).toBe('Ta propre voix : la voix ne coûte plus rien')
  })

  it('the owner\'s own media is never marked far, even when the eyes read the reference\'s real clips as generated', () => {
    const refs = [{ kinds: { clipAi: 1 } } as VideoMeasure]
    const pics = ingredientsOf(fromBase(storyShortBase), reg, refs).find((i) => i.id === 'pictures')
    expect(pics?.options.find((o) => o.id === 'pictures-import')?.far).toBe(false)
  })

  it('chosen ingredients apply and the pipeline still compiles (my own recording replaces the synthetic voice)', () => {
    const doc = withIngredients(fromBase(avatarBase), { voice: 'voice-import', pictures: 'pictures-find', presenter: 'presenter-less', music: 'music-find' }, reg)
    expect(doc.bricks.some((b) => b.tech.startsWith('voice.own@'))).toBe(true)
    expect(doc.bricks.some((b) => b.tech.startsWith('voice.tts@'))).toBe(false)
    expect((doc.mix as unknown as Record<string, number>).stock).toBeGreaterThan(0)
    expect((doc.mix as unknown as Record<string, number>).imageAi ?? 0).toBe(0)
    const r = compileRecipe(doc, reg, { id: 't' })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
  })

  it('the price up front lists the levers that move it most, never one far from the references', () => {
    const p = priceView({ min: 40, avg: 45, max: 52 }, 12, [
      { id: 'presenter', title: 'Présentateur', reference: null, current: 'a', chosen: 'a', options: [{ id: 'a', source: 'generate', title: 'A', detail: '', needs: null, lever: null, far: false, perMinute: null, deltaPct: 0, renderSeconds: null }, { id: 'less', source: 'generate', title: 'Moins de présentateur', detail: '', needs: null, lever: null, far: false, perMinute: null, deltaPct: -38, renderSeconds: null }] },
      { id: 'pictures', title: 'Images', reference: null, current: 'k', chosen: 'k', options: [{ id: 'gen', source: 'generate', title: 'Générées', detail: '', needs: null, lever: null, far: true, perMinute: null, deltaPct: 60, renderSeconds: null }, { id: 'tiny', source: 'find', title: 'Trouvées', detail: '', needs: null, lever: null, far: false, perMinute: null, deltaPct: -2, renderSeconds: null }] }
    ])
    expect(p.levers).toEqual([{ ingredient: 'presenter', option: 'less', title: 'Moins de présentateur', deltaPct: -38, after: null }])
  })
})

describe('choosing an ingredient in « Créer une pipeline »', () => {
  it('the choice reaches every variant, unknown ones are refused', async () => {
    const { memoryCore } = await import('./helpers')
    const { StyleAgentService } = await import('../../src/main/production/style-agent')
    const core = memoryCore({})
    try {
      const svc = new StyleAgentService({ db: core.db, reg, costInput: async () => null, intel: () => ({ connected: () => false }) as never, channels: () => [], sampler: null, model: null, adopt: (input: never) => core.context.pipelineAgent.adopt(input) } as never)
      const v = await svc.study({ text: 'Des histoires Reddit lues vite sur des clips satisfaisants', agent: false })
      expect(v.base).toBe('story-short@1')
      expect(v.ingredients.map((i) => i.id)).toEqual(['pictures', 'script', 'voice', 'branding', 'music'])
      const c = await svc.choose(v.id, 'voice', 'voice-import')
      expect(c.ingredients.find((i) => i.id === 'voice')?.chosen).toBe('voice-import')
      expect(c.variants.every((x) => x.doc.bricks.some((b) => b.tech.startsWith('voice.own@')))).toBe(true)
      await expect(svc.choose(v.id, 'voice', 'voice-of-a-star')).rejects.toThrow(/inconnu/)
      // the adopted pipeline remembers the owner's ingredients and what to bring
      await svc.choose(v.id, 'branding', 'branding-import')
      const d = await svc.adopt(v.id, 'faithful')
      const first = core.db.prepare('SELECT text FROM pipeline_messages WHERE recipe_id = ? ORDER BY id LIMIT 1').get(d.id) as { text: string } | undefined
      expect(first?.text ?? '').toMatch(/Tes ingrédients[\s\S]*Je m’enregistre \(à fournir : ton enregistrement[\s\S]*Ma photo de profil sur la carte/)
    } finally {
      core.close()
    }
  }, 30_000) // a whole memory core: study, two choices and an adoption
})
