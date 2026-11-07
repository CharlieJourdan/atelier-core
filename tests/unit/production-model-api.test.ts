// The production model through the app's API (production-3, decisions 0021, 0022, 0024): the base pipelines with their
// options; a pipeline made from `avatar@1`; edit operations saved as a new version (a « soon » option or an engine of the
// wrong family refused whole); a style of the wrong family refused; a version stored as `atelier.recette/1` still loads;
// a project pins the exact style version and keeps it when the style gets a new version.
import { describe, expect, it } from 'vitest'
import { memoryCore } from './helpers'

describe('pipelines from a base, edit operations, pinned styles', () => {
  it('lists the base pipelines and makes a pipeline of the team from avatar@1', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const bases = await api['recipes.bases']()
      // production-15 ships the voice-over base (no presenter) beside the avatar one
      // style-markets ships the documentary base (archives and cards) after them, clone-reddit-shorts the story short, clone-monde-pov
      // the 2D motion-design story, documentary-2 the measured archive documentary, avatar-base-marcel « Chaîne avatar »
      expect(bases.map((b) => b.id)).toEqual(['avatar@1', 'voiceover@1', 'story-short@1', 'pov@1', 'documentary@2', 'avatar@2'])
      const avatar = bases[0]
      expect(avatar?.copies).toBe(0)
      // production-9 built the chapter marks; the advanced editing (the overlay agent) is still to come
      expect(avatar?.options.find((o) => o.id === 'chapters')?.choices.find((c) => c.value === true)?.soon).toBeNull()
      expect(avatar?.options.find((o) => o.id === 'editing')?.choices.find((c) => c.value === 'advanced')?.soon).toBe('montage-avance')
      expect(avatar?.options.find((o) => o.id === 'clipShare')).toMatchObject({ kind: 'slider', slider: { min: 0, max: 0.5, step: 0.01 }, default: 0.21 })
      const r = await api['recipes.fromBase']('avatar@1', 'Avatar — cuisine')
      expect(r).toMatchObject({ name: 'Avatar — cuisine', version: 1, videoType: 'avatar-long' })
      expect(r.doc.base).toBe('avatar@1')
      expect((await api['recipes.bases']())[0]?.copies).toBe(1)
      const c = await api['recipes.compile'](r.id)
      expect(c.ok).toBe(true)
      expect(c.pins['avatar.speak']).toMatchObject({ engine: 'presenter:heygen-mcp', fallbackScope: 'video', style: 'presenter-studio' })
      await expect(Promise.resolve().then(() => api['recipes.fromBase']('nope@1'))).rejects.toThrow(/inconnue/)
    } finally {
      core.close()
    }
  })

  it('edits by operations: a new version each time, refused whole when one operation fails', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const r = await api['recipes.fromBase']('avatar@1')
      const v2 = await api['recipes.edit'](r.id, [{ op: 'setOption', option: 'quality.images', value: 'premium' }, { op: 'setOption', option: 'captions', value: true }], 'plus beau')
      expect(v2).toMatchObject({ version: 2, doc: { options: { 'quality.images': 'premium', captions: true } } })
      expect(v2.versions[0]).toMatchObject({ number: 2, note: 'plus beau' })
      expect((await api['recipes.compile'](r.id)).pins['visuals.fulfil']?.engine).toBe('image:nano-banana-2')
      await expect(Promise.resolve().then(() => api['recipes.edit'](r.id, [{ op: 'rename', name: 'X' }, { op: 'setOption', option: 'editing', value: 'advanced' }]))).rejects.toThrow(/montage-avance/)
      await expect(Promise.resolve().then(() => api['recipes.edit'](r.id, [{ op: 'setFallbacks', brick: 'voice.tts', fallbacks: ['clip:wan22'] }]))).rejects.toThrow(/engine_family/)
      // a style of the wrong family (a presenter style on the pictures) or unknown is refused
      await expect(Promise.resolve().then(() => api['recipes.edit'](r.id, [{ op: 'setStyle', brick: 'visuals.fulfil', style: 'presenter-studio' }]))).rejects.toThrow(/presenter style/)
      await expect(Promise.resolve().then(() => api['recipes.edit'](r.id, [{ op: 'setStyle', brick: 'visuals.fulfil', style: 'nulle-part' }]))).rejects.toThrow(/no style/)
      expect((await api['recipes.get'](r.id)).version).toBe(2)
    } finally {
      core.close()
    }
  })

  it('a version stored as atelier.recette/1 loads as version 2', async () => {
    const core = memoryCore()
    try {
      const r = await core.api['recipes.fromBase']('avatar@1')
      const v1 = {
        $schema: 'atelier.recette/1',
        name: 'Ancienne',
        videoType: 'documentaire',
        format: { aspect: '16:9', minutes: 2 },
        capCredits: null,
        checkpoints: null,
        bricks: ['idea.research@1', 'script.write@1', 'voice.tts@1', 'director.plan@1', 'visuals.fulfil@1', 'captions.make@1', 'render.assemble@1', 'package.youtube@1'].map((tech) => ({ tech, settings: {} }))
      }
      core.db.prepare('INSERT INTO recipe_versions (recipe_id, number, json, note, created_at) VALUES (?, 2, ?, ?, ?)').run(r.id, JSON.stringify(v1), 'v1', new Date().toISOString())
      const d = await core.api['recipes.get'](r.id)
      expect(d.doc).toMatchObject({ $schema: 'atelier.recette/2', name: 'Ancienne', base: null, mix: null, options: {} })
      expect((await core.api['recipes.compile'](r.id)).ok).toBe(true)
      // a /1 file still imports, as /2
      const imported = await core.api['recipes.import'](JSON.stringify(v1))
      expect(imported.doc.$schema).toBe('atelier.recette/2')
    } finally {
      core.close()
    }
  })

  it('a project pins the exact style version and keeps it when the style gets a new version', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const r = await api['recipes.fromBase']('avatar@1')
      const before = await api['projects.create']({ recipeId: r.id, channelId: null, title: 'La poêle', idea: 'Rattraper une poêle brûlée' })
      // phone-real ships a version 2 (vrais-tests): a new project pins it
      expect(before.pins['visuals.fulfil']).toMatchObject({ style: 'phone-real@2', engine: 'image:gpt-image-25-low' })
      expect(before.pins['avatar.speak']).toMatchObject({ style: 'presenter-studio@1', engine: 'presenter:heygen-mcp', fallbackScope: 'video' })
      const style = await api['brickStyles.get']('phone-real')
      const next = await api['brickStyles.save']({ doc: { ...style.doc, promptSuffix: 'Shot on an old phone, warm evening light.' }, note: 'plus chaud' })
      expect(next.version).toBe(3)
      expect((await api['projects.get'](before.id)).pins['visuals.fulfil']?.style).toBe('phone-real@2')
      const after = await api['projects.create']({ recipeId: r.id, channelId: null, title: 'Le four', idea: 'Nettoyer un four sans produit' })
      expect(after.pins['visuals.fulfil']?.style).toBe('phone-real@3')
    } finally {
      core.close()
    }
  })
})
