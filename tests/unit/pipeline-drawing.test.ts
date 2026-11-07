// The editor's drawn pipelines run on the production engine: the drawing → `atelier.pipeline/1` compiler (real nodes
// only, the visual mix from the drawn shares, gates, what is added or left out), its validation against the real node
// registry, `pipelines.saveDrawing` (new library pipeline, then versions), and a run on a library pipeline.
import { afterEach, describe, expect, it } from 'vitest'
import { productionRegistry } from '../../src/engine/nodes'
import { PIPELINES } from '../../src/renderer/proto/data-pipelines'
import { toDrawing } from '../../src/renderer/proto/live/mapping-production'
import { pipelineFromDrawing, visualMix } from '../../src/engine/pipelines/from-drawing'
import { validatePipeline } from '../../src/engine/validate'
import type { DrawingStep, PipelineDrawing } from '../../src/shared/pipeline-drawing'
import { memoryCore } from './helpers'
import { fixture, testPipeline, waitFor } from './z1-runs-fixtures'

const step = (id: string, kind: DrawingStep['kind'], label: string, more: Partial<DrawingStep> = {}): DrawingStep => ({ id, kind, label, runner: 'agent', ...more })

/** The « Documentaire narré » of the demo, as the editor draws it. */
const DOCU: PipelineDrawing = {
  name: 'Documentaire narré',
  steps: [
    step('n-idea', 'idea', 'Sujet', { gate: true }),
    step('n-script', 'script', 'Script', { gate: true }),
    step('n-director', 'director', 'Réalisation'),
    step('n-stock', 'stock', 'Archives et B-roll', { runner: 'api', share: 45 }),
    step('n-images', 'image-gen', 'Images IA', { runner: 'api', share: 35 }),
    step('n-motion', 'motion', 'Cartes animées', { runner: 'code', share: 20 }),
    step('n-voice', 'voice', 'Voix', { runner: 'api' }),
    step('n-music', 'music', 'Musique'),
    step('n-edit', 'edit', 'Montage', { runner: 'code', gate: true }),
    step('n-thumb', 'thumbnail', 'Miniature et titre', { gate: true }),
    step('n-qc', 'qc', 'Contrôle qualité'),
    step('n-publish', 'publish', 'Publication')
  ]
}

/** The Reddit short: gameplay given by the user, an intro card coded for the channel, no music, no package. */
const REDDIT: PipelineDrawing = {
  name: 'Histoire Reddit',
  steps: [
    step('r-idea', 'idea', 'Histoire'),
    step('r-script', 'script', 'Script 60 s'),
    step('r-voice', 'voice', 'Voix', { runner: 'human' }),
    step('r-gameplay', 'gameplay', 'Gameplay', { runner: 'human' }),
    step('r-card', 'card', 'Carte d’intro', { runner: 'code' }),
    step('r-captions', 'captions', 'Sous-titres', { runner: 'code' }),
    step('r-edit', 'edit', 'Montage 9:16', { runner: 'code' })
  ]
}

describe('drawing → executable pipeline', () => {
  it('the documentary drawing compiles to the real nodes and validates against the production registry', () => {
    const c = pipelineFromDrawing(DOCU, { minutes: 10 })
    expect(c.pipeline.nodes.map((n) => n.id)).toEqual(['research', 'script', 'voice', 'beats', 'director', 'visuals', 'motion', 'captions', 'sound', 'render', 'qc', 'thumbnails', 'package'])
    const v = validatePipeline(c.pipeline, productionRegistry(), { styleFields: ['language', 'voice', 'pace', 'captions', 'burn'] })
    expect(v.ok).toBe(true)
    // gates follow the drawing (the package always stops for the owner)
    const gate = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!.gate ?? 'none'
    expect([gate('research'), gate('script'), gate('voice'), gate('director'), gate('render'), gate('package')]).toEqual(['review', 'review', 'none', 'none', 'review', 'owner'])
    // the thumbnails are the owner's pick, whatever the drawing says (its thumbnail step is gated)
    expect(gate('thumbnails')).toBe('owner')
    // the drawn shares set the director's mix (45 % stock, 35 % AI images → 0.56 / 0.44)
    expect(c.pipeline.nodes.find((n) => n.id === 'director')!.params).toMatchObject({ mix: { stock: 0.56, image: 0.44 } })
    expect(c.pipeline.format.minutes.default).toBe(10)
    // what became what, what is left out, what was added
    expect(c.mapping).toMatchObject({ 'n-stock': 'visuals', 'n-images': 'visuals', 'n-thumb': 'thumbnail', 'n-publish': 'package', 'n-motion': 'motion', 'n-qc': 'qc' })
    // (the animated cards used to be the one step left out: the motion step is now `motion.render`, so every step of this drawing runs)
    expect(c.notes.filter((n) => n.code === 'not_executable')).toEqual([])
    // the director picks the overlays from the narration within the drawn share (20 %) and reads the script (the turns of a conversation); the render lays them
    const node = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!
    expect(node('motion')).toMatchObject({ type: 'motion.render@1', in: { plan: 'director.plan' } })
    expect(node('director').params).toMatchObject({ motion: { share: 0.2 } })
    expect(node('director').in).toMatchObject({ script: 'script.text' })
    expect(node('render').in).toMatchObject({ motion: 'motion.graphics' })
    expect(c.notes.some((n) => n.code === 'added')).toBe(true) // the captions the package needs
  })

  it('a thumbnail step is the engine’s thumbnail.make (it used to be the package): wired from the script and the outline, its pick goes into the package folder', () => {
    const c = pipelineFromDrawing({ name: 'Mini', steps: [step('i', 'idea', 'Sujet'), step('t', 'thumbnail', 'Miniature', { gate: true })] })
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: ['language', 'voice', 'pace', 'captions', 'burn'] }).ok).toBe(true)
    expect(c.mapping.t).toBe('thumbnail')
    const node = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!
    expect(node('thumbnails')).toMatchObject({ type: 'thumbnail.make@1', in: { script: 'script.text', outline: 'script.outline' }, params: { language: '$style.language' }, gate: 'owner' })
    // the package comes with it (and the captions it needs), and takes the thumbnails
    expect(node('package').in).toMatchObject({ thumbnails: 'thumbnails.thumbnails' })
    expect(c.pipeline.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['captions', 'thumbnails', 'package']))
    expect(c.notes).toContainEqual({ stepId: 'package', label: 'Paquet YouTube', code: 'added' })
    // no thumbnail step: no thumbnail node, and the package does not read one
    const without = pipelineFromDrawing({ name: 'Rien', steps: [step('p', 'publish', 'Publication')] })
    expect(without.pipeline.nodes.some((n) => n.id === 'thumbnails')).toBe(false)
    expect(without.pipeline.nodes.find((n) => n.id === 'package')!.in).not.toHaveProperty('thumbnails')
  })

  it('the Reddit drawing: gameplay and card are engine nodes, no pictures are generated, the voice is still the engine\u2019s', () => {
    const c = pipelineFromDrawing(REDDIT)
    // the gameplay is the picture track: no visuals node; the card and the background are wired into the render
    expect(c.pipeline.nodes.map((n) => n.id)).toEqual(['research', 'script', 'voice', 'beats', 'director', 'background', 'card', 'captions', 'render'])
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: ['language', 'voice', 'pace', 'captions', 'burn'] }).ok).toBe(true)
    expect(c.mapping).toMatchObject({ 'r-gameplay': 'background', 'r-card': 'card', 'r-voice': 'voice' })
    // (it used to say that the gameplay and the card could not run, and that the pictures were added)
    expect(c.notes.map((n) => [n.stepId, n.code])).toEqual(expect.arrayContaining([['r-voice', 'engine_does_it'], ['director', 'added']]))
    expect(c.notes.filter((n) => n.code === 'not_executable')).toEqual([])
    expect(c.notes.some((n) => n.stepId === 'visuals')).toBe(false)
    const node = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!
    const render = node('render')
    expect(render.in).not.toHaveProperty('music')
    expect(render.in).not.toHaveProperty('images')
    expect(render.in).toMatchObject({ background: 'background.layer', graphics: 'card.card', subs: 'captions.subs', voice: 'voice.audio' })
    expect(node('background')).toMatchObject({ type: 'background.clips@1', in: { voice: 'voice.audio' }, params: { folder: '$inputs.gameplay' } })
    expect(node('card')).toMatchObject({ type: 'card.intro@1', in: { outline: 'script.outline', words: 'voice.words' } })
    // the folder of clips is asked for (a run cannot start without it); the channel name is only suggested
    expect(c.pipeline.inputs).toEqual([
      { id: 'topic', kind: 'text', required: true, label: 'Sujet ou titre' },
      expect.objectContaining({ id: 'gameplay', kind: 'text', required: true }),
      expect.objectContaining({ id: 'channel', kind: 'text', suggested: true })
    ])
  })

  it('the Reddit drawing of the editor (with its publication step) compiles and validates; only the owner gate and the package are added to it', () => {
    const proto = PIPELINES.find((p) => p.id === 'pl-reddit')!
    const c = pipelineFromDrawing(toDrawing(proto))
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: ['language', 'voice', 'pace', 'captions', 'burn'] }).ok).toBe(true)
    expect(c.pipeline.nodes.map((n) => n.id)).toEqual(['research', 'script', 'voice', 'beats', 'director', 'background', 'card', 'captions', 'render', 'package'])
    // nothing of this drawing is left out: only truly unsupported kinds (avatar, motion, code, a video with no picture) are
    expect(c.notes.filter((n) => n.code === 'not_executable')).toEqual([])
    expect(c.pipeline.nodes.find((n) => n.id === 'package')!.in).not.toHaveProperty('images')
  })

  it('a short drawing compiles to 9:16 with the shorts captions; a long one stays exactly as it was (16:9, no aspect params)', () => {
    const styleFields = ['language', 'voice', 'pace', 'captions', 'burn']
    // the editor's own Reddit pipeline is a short (`format: 'short'`): `toDrawing` carries it, the compiler makes a vertical film
    const proto = PIPELINES.find((p) => p.id === 'pl-reddit')!
    expect(proto.format).toBe('short')
    const drawing = toDrawing(proto)
    expect(drawing.format).toBe('short')
    const c = pipelineFromDrawing(drawing, { minutes: 0.5 })
    expect(c.pipeline.format).toMatchObject({ kind: 'youtube_short', aspect: '9:16', minutes: { default: 0.5 } })
    const node = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!
    expect(node('director').params).toMatchObject({ aspect: '9:16', captionsPreset: 'shorts', cpm: 24 })
    expect(node('background').params).toMatchObject({ aspect: '9:16' })
    expect(node('card').params).toMatchObject({ aspect: '9:16' })
    expect(node('captions').params).toMatchObject({ preset: 'shorts' })
    // and it is a valid pipeline: every node that draws agrees with the format (validate.ts)
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields }).ok).toBe(true)
    // a picture-based short (no gameplay): the director's list asks for vertical pictures
    const pictures = pipelineFromDrawing({ name: 'Short illustré', format: 'short', steps: [step('i', 'idea', 'Sujet'), step('s', 'stock', 'Images', { share: 100 })] })
    expect(pictures.pipeline.format.aspect).toBe('9:16')
    expect(pictures.pipeline.nodes.find((n) => n.id === 'director')!.params).toMatchObject({ aspect: '9:16' })
    expect(validatePipeline(pictures.pipeline, productionRegistry(), { styleFields }).ok).toBe(true)
    // a drawing with no format, or a long one: 16:9, and none of the vertical settings leak in
    for (const d of [REDDIT, { ...REDDIT, format: 'long' as const }, DOCU]) {
      const long = pipelineFromDrawing(d)
      expect(long.pipeline.format).toMatchObject({ kind: 'youtube_long', aspect: '16:9' })
      for (const n of long.pipeline.nodes) expect(JSON.stringify(n.params ?? {})).not.toMatch(/9:16|shorts|"cpm"/)
      expect(long.pipeline.nodes.find((n) => n.id === 'captions' || n.id === 'render')).toBeDefined()
    }
  })

  it('a script given to a person is waited for: a required input wired to the pasted-script port, and the engine no longer says it writes it', () => {
    const drawing: PipelineDrawing = { name: 'Top', steps: [step('i', 'idea', 'Sujet'), step('s', 'human-input', 'Script', { runner: 'human', gate: true }), step('v', 'voice', 'Voix')] }
    const c = pipelineFromDrawing(drawing)
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: ['language', 'voice', 'pace', 'captions', 'burn'] }).ok).toBe(true)
    expect(c.pipeline.inputs.find((i) => i.id === 'script')).toMatchObject({ kind: 'text', required: true })
    const script = c.pipeline.nodes.find((n) => n.id === 'script')!
    expect(script.in).toEqual({ brief: 'research.brief', pasted: '$inputs.script' })
    expect(script.gate).toBe('review')
    expect(c.notes.some((n) => n.code === 'engine_does_it' && n.stepId === 's')).toBe(false)
    // an agent's script is still written by the engine, with no such input
    const written = pipelineFromDrawing({ name: 'Doc', steps: [step('s', 'script', 'Script')] })
    expect(written.pipeline.inputs.map((i) => i.id)).toEqual(['topic'])
    expect(written.pipeline.nodes.find((n) => n.id === 'script')!.in).toEqual({ brief: 'research.brief' })
    // a human voice is still the engine's (voice.own needs a recording the launch cannot give yet)
    const voice = pipelineFromDrawing({ name: 'V', steps: [step('v', 'voice', 'Voix', { runner: 'human' })] })
    expect(voice.notes).toContainEqual({ stepId: 'v', label: 'Voix', code: 'engine_does_it' })
  })

  it('a translate step is the script the voice, the beats, the captions and the package read', () => {
    const c = pipelineFromDrawing({ name: 'EN', steps: [step('s', 'script', 'Script'), step('t', 'translate', 'Adaptation'), step('v', 'voice', 'Voix'), step('p', 'publish', 'Publication')] })
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: ['language', 'voice', 'pace', 'captions', 'burn'] }).ok).toBe(true)
    const node = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!
    expect(node('translate')).toMatchObject({ type: 'script.translate@1', in: { script: 'script.text', outline: 'script.outline' }, params: { language: '$style.language' } })
    expect(node('voice').in).toEqual({ script: 'translate.text' })
    expect(node('beats').in).toEqual({ script: 'translate.text', words: 'voice.words', outline: 'translate.outline' })
    expect(node('captions').in).toMatchObject({ script: 'translate.text' })
    expect(node('package').in).toMatchObject({ script: 'translate.text', outline: 'translate.outline' })
    expect(c.mapping.t).toBe('translate')
  })

  it('what has no engine node stays reported: code, and a video generation with no picture to start from (a talking avatar is avatar.speak, animated graphics are motion.render)', () => {
    const c = pipelineFromDrawing({
      name: 'Rien',
      steps: [step('a', 'avatar', 'Avatar'), step('m', 'motion', 'Cartes animées'), step('c', 'code', 'Code'), step('g', 'video-gen', 'Vidéo IA', { share: 100 }), step('h', 'human-input', 'Miniature', { runner: 'human' })]
    })
    expect(c.notes.filter((n) => n.code === 'not_executable').map((n) => n.stepId)).toEqual(['c', 'g', 'h'])
    expect(c.mapping).toMatchObject({ a: 'avatar', m: 'motion', c: null, g: null, h: null })
    // generated video animates a picture: with an image step it is the engine's visuals
    const withImages = pipelineFromDrawing({ name: 'Anime', steps: [step('i', 'image-gen', 'Images', { share: 40 }), step('g', 'video-gen', 'Vidéo IA', { share: 60 })] })
    expect(withImages.mapping).toMatchObject({ i: 'visuals', g: 'visuals' })
    // pictures are not made over a gameplay background: they are reported as left out, not silently dropped
    const over = pipelineFromDrawing({ name: 'Gameplay', steps: [step('x', 'gameplay', 'Gameplay'), step('s', 'stock', 'B-roll', { share: 100 })] })
    expect(over.mapping).toMatchObject({ x: 'background', s: null })
    expect(over.notes).toContainEqual({ stepId: 's', label: 'B-roll', code: 'not_executable' })
  })

  it('an avatar step is avatar.speak: the director marks the hook and the outro, the render takes its clips, the portrait is an optional input', () => {
    const styleFields = ['language', 'voice', 'pace', 'captions', 'burn']
    const c = pipelineFromDrawing({ name: 'Présentateur', steps: [step('i', 'idea', 'Sujet'), step('a', 'avatar', 'Avatar IA', { runner: 'api', gate: true }), step('s', 'stock', 'B-roll', { share: 100 })] })
    expect(c.mapping.a).toBe('avatar')
    expect(c.notes.filter((n) => n.code === 'not_executable')).toEqual([])
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields }).ok).toBe(true)
    const node = (id: string) => c.pipeline.nodes.find((n) => n.id === id)!
    expect(node('avatar')).toMatchObject({ type: 'avatar.speak@1', in: { genlist: 'director.genlist', voice: 'voice.audio', words: 'voice.words' }, params: { avatarId: '$inputs.avatar' }, gate: 'review' })
    expect(node('director').params).toMatchObject({ avatar: { segments: ['hook', 'outro'], layout: 'full' } })
    expect(node('render').in).toMatchObject({ avatar: 'avatar.clips', images: 'visuals.images', clips: 'visuals.clips' })
    // the portrait is asked, never required: without it the node's default stands
    expect(c.pipeline.inputs).toContainEqual(expect.objectContaining({ id: 'avatar', kind: 'text', suggested: true }))
    expect(c.pipeline.inputs.find((i) => i.id === 'avatar')).not.toHaveProperty('required', true)
    // a film without an avatar step keeps exactly the nodes and the director params it had
    const without = pipelineFromDrawing({ name: 'Sans', steps: [step('i', 'idea', 'Sujet')] })
    expect(without.pipeline.nodes.some((n) => n.id === 'avatar')).toBe(false)
    expect(JSON.stringify(without.pipeline.nodes.find((n) => n.id === 'director')!.params)).not.toContain('avatar')
    expect(without.pipeline.nodes.find((n) => n.id === 'render')!.in).not.toHaveProperty('avatar')
    expect(without.pipeline.inputs.some((i) => i.id === 'avatar')).toBe(false)
    // over a gameplay background the presenter is a picture in picture (the background IS the picture track); a short is 9:16
    const over = pipelineFromDrawing({ name: 'Gameplay', format: 'short', steps: [step('g', 'gameplay', 'Gameplay'), step('a', 'avatar', 'Avatar')] })
    expect(over.pipeline.nodes.find((n) => n.id === 'director')!.params).toMatchObject({ aspect: '9:16', avatar: { layout: 'pip' } })
    expect(validatePipeline(over.pipeline, productionRegistry(), { styleFields }).ok).toBe(true)
  })

  it('visual mix: stock vs images, generated video taken on the images; defaults without shares', () => {
    expect(visualMix([step('a', 'stock', 'A', { share: 50 }), step('b', 'image-gen', 'B', { share: 50 })])).toEqual({ mix: { stock: 0.5, image: 0.5 }, videoShare: 0 })
    expect(visualMix([step('a', 'image-gen', 'A', { share: 30 }), step('b', 'video-gen', 'B', { share: 70 })])).toEqual({ mix: { stock: 0, image: 1 }, videoShare: 0.7 })
    expect(visualMix([])).toEqual({ mix: { stock: 0.6, image: 0.4 }, videoShare: 0 })
  })
})

describe('pipelines.saveDrawing', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.()
  })

  it('saves a new library pipeline, then a version when the drawing changes (none when it does not); bad drawings are refused', async () => {
    const core = memoryCore()
    cleanups.push(() => core.close())
    const first = await core.api['pipelines.saveDrawing'](DOCU, { minutes: 10 })
    expect(first.version).toBe(1)
    // every step of the documentary runs now (its animated cards are `motion.render`): nothing is reported as left out
    expect(first.notes.some((n) => n.code === 'not_executable')).toBe(false)
    const row = await core.api['pipelines.get'](first.pipelineId)
    expect(row).toMatchObject({ name: 'Documentaire narré', origin: 'own' })
    expect(JSON.parse(row.json).nodes.map((n: { id: string }) => n.id)).toContain('sound')

    const same = await core.api['pipelines.saveDrawing'](DOCU, { pipelineId: first.pipelineId, minutes: 10 })
    expect(same.version).toBe(1)
    const noMusic = { ...DOCU, steps: DOCU.steps.filter((s) => s.kind !== 'music') }
    const second = await core.api['pipelines.saveDrawing'](noMusic, { pipelineId: first.pipelineId, minutes: 10 })
    expect(second).toMatchObject({ pipelineId: first.pipelineId, version: 2 })
    expect(JSON.parse((await core.api['pipelines.get'](first.pipelineId)).json).nodes.map((n: { id: string }) => n.id)).not.toContain('sound')

    await expect(Promise.resolve().then(() => core.api['pipelines.saveDrawing']({ name: 'x', steps: [] } as PipelineDrawing))).rejects.toThrow(/étapes/)
    await expect(Promise.resolve().then(() => core.api['pipelines.saveDrawing']({ name: 'x', steps: [{ id: 'a', kind: 'teleport', label: 'A', runner: 'agent' }] } as unknown as PipelineDrawing))).rejects.toThrow(/type inconnu/)
  })
})

describe('a run on a library pipeline', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.()
  })

  it('quote and start use the chosen pipeline (its nodes, its name, the run length); an unknown one is refused', async () => {
    const fx = fixture()
    const core = memoryCore({ productionRuns: fx.productionRuns })
    cleanups.push(() => core.close(), () => fx.cleanup())
    const channel = await core.api['channels.create']({ name: 'Chaîne' })
    // A library pipeline written for the test nodes (the library's own check runs on the real registry, so it is
    // inserted directly): no package step, a different name.
    const doc = { ...testPipeline(1), name: 'Ma pipeline dessinée', nodes: testPipeline(1).nodes.filter((n) => n.id !== 'package') }
    const db = core.context.db
    const at = new Date().toISOString()
    const pid = Number(
      db.prepare(`INSERT INTO library_pipelines (name, description, origin, channel_id, example, created_at, updated_at) VALUES (?, '', 'own', NULL, 0, ?, ?)`).run('Ma pipeline dessinée', at, at).lastInsertRowid
    )
    db.prepare('INSERT INTO library_pipeline_versions (pipeline_id, number, json, note, created_at) VALUES (?, 1, ?, ?, ?)').run(pid, JSON.stringify(doc), 'test', at)

    const q = await core.api['production.quote']({ minutes: 2, pipelineId: pid })
    expect(q.pipelineLabel).toBe('Ma pipeline dessinée')
    expect(q.modes.usage_max.nodes.map((n) => n.nodeId)).toEqual(['research', 'script', 'voice', 'render'])

    const run = await core.api['production.start']({ channelId: channel.id, title: 'V', topic: 'T', minutes: 2, budgetMode: 'usage_max', gateMode: 'all', pipelineId: pid })
    expect(run.pipelineLabel).toBe('Ma pipeline dessinée')
    expect(run.minutes).toBe(2)
    expect(run.nodes.map((n) => n.nodeId)).toEqual(['research', 'script', 'voice', 'render'])
    // no owner gate in this pipeline: the run finishes on its own
    await waitFor(async () => ((await core.api['production.get'](run.id)).status === 'succeeded' ? true : null), 8_000, 'run succeeded')

    await expect(core.api['production.quote']({ minutes: 1, pipelineId: 99_999 })).rejects.toThrow(/introuvable/)
    await expect(core.api['production.start']({ channelId: channel.id, title: 'V', topic: 'T', minutes: 1, budgetMode: 'usage_max', gateMode: 'all', pipelineId: 99_999 })).rejects.toThrow(/introuvable/)
  })

  it('a pipeline that needs more than a topic (a person’s script) gets it at launch, keeps it for « Refaire pareil », refuses to start without it', async () => {
    const fx = fixture()
    const core = memoryCore({ productionRuns: fx.productionRuns })
    cleanups.push(() => core.close(), () => fx.cleanup())
    const channel = await core.api['channels.create']({ name: 'Chaîne' })
    const base = testPipeline(1)
    const doc = { ...base, name: 'Script fourni', nodes: base.nodes.filter((n) => n.id !== 'package'), inputs: [...base.inputs, { id: 'script', kind: 'text', required: true, label: 'Script' }] }
    const db = core.context.db
    const at = new Date().toISOString()
    const pid = Number(db.prepare(`INSERT INTO library_pipelines (name, description, origin, channel_id, example, created_at, updated_at) VALUES (?, '', 'own', NULL, 0, ?, ?)`).run('Script fourni', at, at).lastInsertRowid)
    db.prepare('INSERT INTO library_pipeline_versions (pipeline_id, number, json, note, created_at) VALUES (?, 1, ?, ?, ?)').run(pid, JSON.stringify(doc), 'test', at)
    const start = { channelId: channel.id, title: 'V', topic: 'T', minutes: 2, budgetMode: 'usage_max' as const, gateMode: 'all' as const, pipelineId: pid }

    await expect(Promise.resolve().then(() => core.api['production.start'](start))).rejects.toThrow(/script/)
    await expect(Promise.resolve().then(() => core.api['production.start']({ ...start, inputs: { topic: 'x' } }))).rejects.toThrow(/Entrée inconnue/)
    await expect(Promise.resolve().then(() => core.api['production.start']({ ...start, inputs: { script: 42 as unknown as string } }))).rejects.toThrow(/Entrée « script »/)

    const run = await core.api['production.start']({ ...start, inputs: { script: 'Mon texte, mot pour mot.' } })
    await waitFor(async () => ((await core.api['production.get'](run.id)).status === 'succeeded' ? true : null), 8_000, 'run succeeded')
    const row = db.prepare('SELECT inputs_json FROM video_runs WHERE id = ?').get(run.id) as { inputs_json: string }
    expect(JSON.parse(row.inputs_json)).toEqual({ script: 'Mon texte, mot pour mot.' })
    const again = await core.api['production.redo'](run.id)
    const redoRow = db.prepare('SELECT inputs_json FROM video_runs WHERE id = ?').get(again.id) as { inputs_json: string }
    expect(JSON.parse(redoRow.inputs_json)).toEqual({ script: 'Mon texte, mot pour mot.' })
  })
})

