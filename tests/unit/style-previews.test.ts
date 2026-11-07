// « Créer une pipeline » (production-15, Charlie 01/11): a few words are enough (example videos recommended), and the saved
// previews per technology are shown free — the set the app ships (made on the fakes) and the app's own (the model tests'
// real samples), the app's own winning; a pipeline lists the previews of what it uses and can switch to.
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase, previewCatalog, previewKeysOf, technologyRegistry, voiceoverBase } from '../../src/engine/technologies'
import { PreviewStore } from '../../src/main/production/previews'
import { BASE_STYLES } from '../../src/main/production/styles/seeds'
import { PREVIEWS_SCHEMA } from '../../src/shared/previews'
import { PREVIEWS_METHODS } from '../../src/shared/api'
import { memoryCore } from './helpers'

const reg = technologyRegistry()
const SHIPPED = path.resolve(import.meta.dirname, '../../resources/previews')

describe('saved previews per technology', () => {
  it('a pipeline lists what it uses and can switch to: its pictures’ style and engines, its clips, its presenter', () => {
    const keys = previewKeysOf(fromBase(avatarBase), reg).map((k) => k.key)
    expect(keys).toEqual(expect.arrayContaining(['style:phone-real', 'style:presenter-studio', 'image:gpt-image-25-low', 'image:nano-banana-2']))
    expect(keys.some((k) => k.startsWith('clip:'))).toBe(true)
    expect(keys.some((k) => k.startsWith('presenter:'))).toBe(true)
    const voiceover = previewKeysOf(fromBase(voiceoverBase), reg).map((k) => k.key)
    expect(voiceover.some((k) => k.startsWith('presenter:') || k === 'style:presenter-studio')).toBe(false)
  })

  it('the app ships one preview for every engine and style the base pipelines can use (made on the fakes)', () => {
    const store = new PreviewStore([SHIPPED])
    const shipped = new Set(store.list().map((p) => p.key))
    for (const k of previewCatalog(reg, BASE_STYLES)) expect(shipped.has(k.key), k.key).toBe(true)
    for (const p of store.list()) {
      expect(p.source).toBe('demo')
      expect(p.files.length).toBeGreaterThan(0)
      expect(p.files.every((f) => (p.family === 'image' ? f.type === 'image' : f.type === 'video'))).toBe(true)
    }
  })

  it('reads a preview’s file, refuses others, and a real sample saved later wins over the shipped one', async () => {
    const own = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-previews-')))
    const store = new PreviewStore([SHIPPED, own])
    const low = store.list(['image:gpt-image-25-low'])[0]
    expect(low?.source).toBe('demo')
    const f = await store.file('image:gpt-image-25-low', low?.files[0]?.ref)
    expect(f.mime).toBe('image/jpeg')
    expect(f.size).toBeGreaterThan(1000)
    await expect(store.file('image:gpt-image-25-low', '../manifest.json')).rejects.toThrow()
    await expect(store.file('image:nope', 'x.jpg')).rejects.toThrow(/Aperçu/)
    store.save({ key: 'image:gpt-image-25-low', kind: 'engine', family: 'image', label: 'GPT Image 2.5 (bas)', source: 'real', madeAt: '2026-11-02' }, [{ name: 'real.jpg', type: 'image', bytes: new Uint8Array([255, 216, 255, 0]) }])
    expect(store.list(['image:gpt-image-25-low'])[0]?.source).toBe('real')
    expect((await store.file('image:gpt-image-25-low', 'image-gpt-image-25-low/real.jpg')).size).toBe(4)
    // a manifest that is not ours is ignored
    const other = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-previews-')))
    writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ schema: 'other', items: [{ key: 'image:x' }] }))
    expect(new PreviewStore([other]).list()).toEqual([])
    expect(PREVIEWS_SCHEMA).toBe('atelier.previews/1')
  })

  it('reaches the renderer through IPC: the previews of a pipeline document', async () => {
    // pipeline-ui: + previews.options, the before / after of the options a user may pick
    expect(PREVIEWS_METHODS).toEqual(['previews.forDoc', 'previews.file', 'previews.options'])
    const core = memoryCore({})
    const items = await core.api['previews.forDoc'](fromBase(avatarBase) as never)
    expect(items.map((p) => p.key)).toContain('style:phone-real')
  })
})

describe('Créer une pipeline from a few words', () => {
  it('needs words or links; « voix off » gives the base without a presenter, no eyes spent', async () => {
    const core = memoryCore({})
    await expect(core.api['style.study']({ text: '' })).rejects.toThrow(/quelques mots/)
    const v = await core.api['style.study']({ text: 'Une voix off sur des images d’archives, sans présentateur', agent: false })
    expect(v.base).toBe('voiceover@1')
    expect(v.measured).toBe(0)
    expect(v.measureCredits).toBe(0)
    expect(v.variants.length).toBeGreaterThan(0)
    expect(v.text).toContain('voix off')
    const a = await core.api['style.study']({ text: 'Une grand-mère qui donne ses astuces de cuisine', agent: false })
    expect(a.base).toBe('avatar@1')
  })
})
