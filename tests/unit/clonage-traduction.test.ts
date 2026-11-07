// clonage-traduction: « Comment veux-tu te différencier ? » proposes changes logical for the genre (a documentary never gets AI clips),
// each priced and scored, picked freely and applied to every variant; the owner's own channel gets two at most (parcours-utilisateur); several channels get a
// « plus proche de … » each; « Traduire » copies a pipeline into another language; the cards' style option reaches the director.
import { describe, expect, it } from 'vitest'
import { compileRecipe, documentary2Base, avatarBase, fromBase, technologyRegistry } from '../../src/engine/technologies'
import type { PriceBook } from '../../src/engine/technologies/cost'
import { differentiators, withDifferentiators } from '../../src/engine/technologies/differentiators'
import type { VideoMeasure } from '../../src/engine/technologies/fit'

const reg = technologyRegistry()
const book = {
  currency: 'credits',
  engines: {
    'presenter:infinitetalk-fast': { unit: 'second', perUnit: 1.8 },
    'image:gpt-image-25-low': { unit: 'image', perUnit: 0.7 },
    'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 9, maxSecondsPerCall: 8 },
    'voice:ai33': { unit: 'kchars', perUnit: 1 },
    'music:library': { unit: 'minute', perUnit: 0 }
  }
} as unknown as PriceBook
const ref = (o: Partial<VideoMeasure>): VideoMeasure => ({ presenterShare: 0, kinds: { archive: 0.72, motion: 0.2, imageAi: 0.06 }, shotS: 5.2, wordsPerMinute: 176, captions: false, lookFamily: 'archive', labelsPerMinute: 0, curve: 'flat', ...o }) as VideoMeasure
const refs = [ref({}), ref({ shotS: 6 })]

describe('the differentiators of a documentary', () => {
  const doc = fromBase(documentary2Base)
  const list = differentiators(doc, reg, { refs, cost: { book } as never })

  // parcours-utilisateur (02/11): a few varied changes, one per family first (documentary@2's two look variants are both motion changes)
  it('are logical for the genre and varied: map look, skin, captions, richer editing, a calmer voice; never AI clips or a presenter', () => {
    expect(list.map((d) => d.id)).toEqual(['maps-parchment', 'skin-dossier', 'captions-classic', 'richer-editing', 'voice-calmer'])
    // one family per change, but the two look variants (map, skin) are both « motion »
    expect(new Set(list.map((d) => d.family)).size).toBe(list.length - 1)
    expect(list.some((d) => JSON.stringify(d.ops).includes('clip'))).toBe(false)
    expect(list.find((d) => d.id === 'maps-parchment')?.previewKey).toBeNull()
  })

  it('each says its likeness before and after (the references measured)', () => {
    for (const d of list) expect(d.likeness?.before).toBeGreaterThan(75)
  })

  it('picked ones apply to the pipeline, which still compiles; the look options are set', () => {
    const picked = withDifferentiators(doc, list.filter((d) => d.id === 'maps-parchment' || d.id === 'skin-dossier'), reg)
    expect(picked.options.docMapLook).toBe('parchment')
    expect(picked.options.docSkin).toBe('dossier')
    const r = compileRecipe(picked, reg, { id: 't' })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
  })

  it('two improvements at most for the owner\'s own channel; one « plus proche de » per channel when several are mixed', () => {
    // parcours-utilisateur (Charlie 02/11: « moins de propositions quand c'est ma propre chaîne », not none): two at most, never a
    // change made only to differ from oneself
    const own = differentiators(doc, reg, { refs, own: true })
    expect(own.length).toBeGreaterThan(0)
    expect(own.length).toBeLessThanOrEqual(2)
    expect(own.every((d) => d.effect !== 'differ')).toBe(true)
    const mixed = differentiators(fromBase(avatarBase), reg, {
      refs: [ref({ presenterShare: 0.3, kinds: { clipAi: 0.4, imageAi: 0.6 }, curve: 'hook-heavy' }), ref({ presenterShare: 0.1, shotS: 3 })],
      channels: [
        { title: 'Chaîne A', refs: [ref({ presenterShare: 0.3, curve: 'hook-heavy', shotS: 3 })] },
        { title: 'Chaîne B', refs: [ref({ presenterShare: 0.1, shotS: 6 })] }
      ]
    })
    expect(mixed.length).toBeLessThanOrEqual(5)
    expect(mixed.map((d) => d.family)).toContain('presenter')
  })
})

describe('« Traduire » a pipeline (the app\'s API)', () => {
  it('copies the pipeline into another language as a new pipeline of the team, refused into its own language', async () => {
    const { memoryCore } = await import('./helpers')
    const core = memoryCore()
    try {
      const api = core.api
      const r = await api['recipes.fromBase']('documentary@2', 'Markets — histoire')
      const fr = await api['recipes.translate'](r.id, 'fr')
      expect(fr.id).not.toBe(r.id)
      expect(fr.name).toBe('Markets — histoire (FR)')
      expect(fr.doc.language).toBe('fr')
      expect(fr.doc.base).toBe('documentary@2')
      expect(fr.doc.bricks.map((b) => b.tech)).toEqual(r.doc.bricks.map((b) => b.tech))
      const en = await api['recipes.translate'](fr.id, 'en')
      expect(en.name).toBe('Markets — histoire (EN)')
      await expect(Promise.resolve().then(() => api['recipes.translate'](fr.id, 'fr'))).rejects.toThrow(/déjà/)
      await expect(Promise.resolve().then(() => api['recipes.translate'](fr.id, 'français'))).rejects.toThrow(/Langue invalide/)
    } finally {
      core.close()
    }
  }, 30_000) // a whole memory core: 1.6 s alone, more under the full suite
})

describe('« Créer une pipeline »: differentiators, a target language, the owner\'s own channel', () => {
  async function rig() {
    const { memoryCore } = await import('./helpers')
    const { StyleAgentService } = await import('../../src/main/production/style-agent')
    const core = memoryCore({})
    const svc = new StyleAgentService({ db: core.db, reg, costInput: async () => null, intel: () => ({ connected: () => false }) as never, channels: () => [], sampler: null, model: null, adopt: () => Promise.reject(new Error('not here')) } as never)
    return { core, svc }
  }

  it('proposes the documentary\'s differentiators, applies the picked ones to every variant, and translates the pipeline', async () => {
    const { core, svc } = await rig()
    try {
      const v = await svc.study({ text: 'Un documentaire d’histoire sur des archives et des cartes animées', agent: false, language: 'fr' })
      // documentary-2: a documentary over archives now gets the measured archive documentary, whose proposals are its skins
      expect(v.base).toBe('documentary@2')
      expect(v.language).toBe('fr')
      expect(v.variants.every((x) => x.doc.language === 'fr')).toBe(true)
      expect(v.differentiators.map((d) => d.id)).toContain('skin-dossier')
      expect(v.differentiators.some((d) => d.picked)).toBe(false)
      const picked = await svc.pick(v.id, ['skin-dossier'])
      expect(picked.differentiators.find((d) => d.id === 'skin-dossier')?.picked).toBe(true)
      expect(picked.variants.every((x) => (x.doc.options as { docSkin?: string }).docSkin === 'dossier')).toBe(true)
      await expect(svc.pick(v.id, ['clips-everywhere'])).rejects.toThrow(/inconnue/)
      const none = await svc.pick(v.id, [])
      expect(none.variants.every((x) => (x.doc.options as { docSkin?: string }).docSkin !== 'dossier')).toBe(true)
    } finally {
      core.close()
    }
  })

  it('the owner\'s own channel is cloned as it is: two improvements at most, nothing to differ from', async () => {
    const { core, svc } = await rig()
    try {
      const v = await svc.study({ text: 'Un documentaire d’histoire sur des archives', agent: false, own: true })
      expect(v.own).toBe(true)
      expect(v.differentiators.length).toBeLessThanOrEqual(2)
      expect(v.differentiators.every((d) => d.effect !== 'differ' && !d.picked)).toBe(true)
    } finally {
      core.close()
    }
  })
})
