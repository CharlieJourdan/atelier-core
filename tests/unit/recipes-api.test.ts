// Recipes and projects through the IPC api (production-2, decision 0011): the technologies list, saving a recipe as
// immutable versions (refused when it does not compile), export / import of one validated `.atelier-recette.json`, a
// channel's settings, checkpoints and recipe per video type, projects pinned to a recipe version; and, with a full
// ffmpeg, a project made from a recipe of the existing technologies runs on the fakes (demo mode) to an MP4.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROJECTS_METHODS, RECIPES_METHODS, type RecipeDocument } from '../../src/shared/api'
import { hasFullFfmpeg, NO_FULL_FFMPEG } from './engine-node-helpers'
import { memoryCore } from './helpers'
import { waitFor } from './z1-runs-fixtures'

const BRICKS = [
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

const entry = (tech: string): RecipeDocument['bricks'][number] => ({ tech, settings: {}, engine: null, fallbacks: [], style: null })

const doc = (over: Partial<RecipeDocument> = {}): RecipeDocument => ({
  $schema: 'atelier.recette/2',
  base: null,
  language: null,
  mix: null,
  options: {},
  inputs: {},
  name: 'Documentaire express',
  videoType: 'documentaire',
  format: { aspect: '16:9', minutes: 1 },
  capCredits: null,
  checkpoints: null,
  bricks: BRICKS.map((tech) => entry(tech)),
  ...over
})

describe('recipes and projects IPC', () => {
  it('lists its methods', () => {
    expect([...RECIPES_METHODS]).toEqual([
      'technologies.list', // the code registry, by stage
      'recipes.bases', // the base pipelines and their options (production-3)
      'recipes.fromBase', // a pipeline of the team from a base
      'recipes.translate', // the same pipeline in another language (clonage-traduction)
      'recipes.edit', // edit operations, a new version (decision 0024)
      'recipes.list', // the team's recipes
      'recipes.get', // one recipe at a version
      'recipes.check', // the editor's live check
      'recipes.save', // a new recipe or a new immutable version
      'recipes.archive', // archive / restore
      'recipes.compile', // what it runs for a channel
      'recipes.export', // one .atelier-recette.json
      'recipes.import', // a validated file becomes a recipe
      'recipes.share', // a pipeline's code and the text that shares it (production-lab; off in the beta)
      'recipes.fromCode', // a shared code becomes a pipeline (production-lab; off in the beta)
      'recipes.channel', // a channel's settings
      'recipes.setChannel', // a channel's settings and checkpoints
      'recipes.useForChannel' // the recipe of a channel per video type
    ])
    // agents-production adds « J'ai mon script »'s file reader
    expect([...PROJECTS_METHODS]).toEqual(['projects.list', 'projects.get', 'projects.create', 'projects.update', 'projects.compile', 'projects.run', 'projects.quote', 'projects.readScript'])
  })

  it('technologies come from the code registry, with their settings as editor fields', async () => {
    const core = memoryCore()
    try {
      const techs = await core.api['technologies.list']()
      const voice = techs.find((t) => t.id === 'voice.tts@1')
      expect(voice).toMatchObject({ name: 'voice.tts', version: 1, stage: 'voix', status: 'validated', cloudUsages: ['synthesize'], superseded: false })
      expect(voice?.fields.find((f) => f.key === 'speed')).toMatchObject({ type: 'number', default: 1, min: 0.7, max: 1.2, recipe: true, channel: true })
      expect(techs.find((t) => t.id === 'render.assemble@1')?.fields.find((f) => f.key === 'encoderPreset')).toMatchObject({ type: 'enum', channel: false })
      expect(techs.find((t) => t.id === 'voice.own@1')?.status).toBe('draft')
    } finally {
      core.close()
    }
  })

  it('saves versions, refuses a recipe that does not compile, exports and imports one validated file', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      expect(await api['recipes.list']()).toEqual([])
      expect((await api['recipes.check'](doc())).ok).toBe(true)
      expect((await api['recipes.check'](doc({ bricks: [entry('idea.research@1')] }))).errors.map((e) => e.code)).toEqual(['no_video'])
      await expect(Promise.resolve().then(() => api['recipes.save']({ doc: doc({ bricks: [entry('nope@1')] }) }))).rejects.toThrow(/pas valable/)

      const v1 = await api['recipes.save']({ doc: doc() })
      expect(v1).toMatchObject({ version: 1, docVersion: 1, bricks: BRICKS.length, videoType: 'documentaire' })
      const v2 = await api['recipes.save']({ id: v1.id, doc: doc({ name: 'Documentaire v2', bricks: doc().bricks.filter((b) => b.tech !== 'sound.music@1') }), note: 'sans musique' })
      expect(v2).toMatchObject({ id: v1.id, version: 2, name: 'Documentaire v2' })
      expect(v2.versions.map((v) => v.number)).toEqual([2, 1])
      // version 1 is immutable: still the document it was saved with
      expect((await api['recipes.get'](v1.id, 1)).doc.bricks).toHaveLength(BRICKS.length)

      const file = await api['recipes.export'](v1.id)
      expect(file.fileName).toBe('documentaire-v2.atelier-recette.json')
      const imported = await api['recipes.import'](file.json)
      expect(imported.id).not.toBe(v1.id)
      expect(imported.doc).toEqual((await api['recipes.get'](v1.id)).doc)
      await expect(Promise.resolve().then(() => api['recipes.import']('pas du json'))).rejects.toThrow(/JSON/)
      await expect(Promise.resolve().then(() => api['recipes.import'](JSON.stringify({ ...doc(), bricks: [] })))).rejects.toThrow(/pas valable/)

      const archived = await api['recipes.archive'](imported.id, true)
      expect(archived.archived).toBe(true)
      expect((await api['recipes.list']()).at(-1)?.id).toBe(imported.id)
    } finally {
      core.close()
    }
  })

  it('a channel keeps its settings and checkpoints, and picks one recipe per video type', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const ch = await api['channels.create']({ name: 'Mystères', niche: 'mystères' })
      const r = await api['recipes.save']({ doc: doc() })
      expect(await api['recipes.channel'](ch.id)).toMatchObject({ checkpoints: ['topic', 'thumbnail'], defaultCheckpoints: true, technologies: {}, recipes: {} })
      const set = await api['recipes.setChannel'](ch.id, { technologies: { 'voice.tts': { voice: 'voix-mysteres' } }, checkpoints: ['script', 'thumbnail'] })
      expect(set).toMatchObject({ checkpoints: ['script', 'thumbnail'], defaultCheckpoints: false, technologies: { 'voice.tts': { voice: 'voix-mysteres' } } })
      await expect(Promise.resolve().then(() => api['recipes.setChannel'](ch.id, { technologies: { 'render.assemble': { crf: 30 } } }))).rejects.toThrow(/pas valables/)
      await expect(Promise.resolve().then(() => api['recipes.setChannel'](ch.id, { technologies: { 'nope.tech': {} } }))).rejects.toThrow(/inconnue/)

      const used = await api['recipes.useForChannel'](ch.id, 'documentaire', r.id)
      expect(used.recipes).toEqual({ documentaire: r.id })
      await expect(Promise.resolve().then(() => api['recipes.useForChannel'](ch.id, 'short', r.id))).rejects.toThrow(/autre type/)
      expect((await api['recipes.list']())[0]?.channels).toEqual([{ channelId: ch.id, videoType: 'documentaire' }])

      const compiled = await api['recipes.compile'](r.id, ch.id)
      expect(compiled.ok).toBe(true)
      expect(compiled.checkpoints).toEqual(['script', 'thumbnail'])
      expect(compiled.nodes.find((n) => n.id === 'voice')?.params).toMatchObject({ voice: 'voix-mysteres' })
      expect(compiled.nodes.filter((n) => n.gate === 'owner').map((n) => n.id)).toEqual(['script', 'thumbnails'])
    } finally {
      core.close()
    }
  })

  it('a project pins its recipe version; it changes until it runs; it needs a channel to run', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const r = await api['recipes.save']({ doc: doc() })
      const p = await api['projects.create']({ recipeId: r.id, channelId: null, title: 'Le phare', idea: 'Le phare oublié de la côte sauvage' })
      expect(p).toMatchObject({ recipeVersion: 1, channelId: null, runId: null, recipeName: 'Documentaire express' })
      await api['recipes.save']({ id: r.id, doc: doc({ name: 'Autre' }) })
      expect((await api['projects.get'](p.id)).recipeVersion).toBe(1)
      const up = await api['projects.update'](p.id, { adjustments: { minutes: 2, technologies: { 'voice.tts': { speed: 1.1 } } } })
      expect(up.adjustments).toEqual({ minutes: 2, technologies: { 'voice.tts': { speed: 1.1 } } })
      const c = await api['projects.compile'](p.id)
      expect(c.nodes.find((n) => n.id === 'voice')?.params).toMatchObject({ speed: 1.1 })
      await expect(Promise.resolve().then(() => api['projects.update'](p.id, { adjustments: { technologies: { 'render.assemble': { crf: 99 } } } }))).rejects.toThrow(/ne peut pas/)
      await expect(api['projects.run'](p.id)).rejects.toThrow(/Choisis une chaîne/)
      expect((await api['projects.list']()).map((x) => x.id)).toEqual([p.id])
    } finally {
      core.close()
    }
  })
})

describe('a recipe’s credit cap (decision 0015)', () => {
  it('a project whose quote is over its recipe’s cap per video does not start, and nothing is created', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const ch = await api['channels.create']({ name: 'Phares', niche: 'histoire' })
      const r = await api['recipes.save']({ doc: doc({ capCredits: 1, checkpoints: [] }) })
      const p = await api['projects.create']({ recipeId: r.id, channelId: ch.id, title: 'Le phare', idea: 'Le phare oublié' })
      expect((await api['production.quote']({ minutes: 1, channelId: ch.id })).modes.usage_max.totalCredits).toBeGreaterThan(1)
      await expect(api['projects.run'](p.id)).rejects.toThrow(/plafond/)
      expect((await api['projects.get'](p.id)).runId).toBeNull()
      expect(await api['production.list']()).toEqual([])
      expect((await api['videos.list']()).filter((v) => v.channelId === ch.id)).toEqual([])
      // under the cap, it starts
      const ok = await api['recipes.save']({ id: r.id, doc: doc({ capCredits: 100_000, checkpoints: [] }) })
      const p2 = await api['projects.create']({ recipeId: ok.id, channelId: ch.id, title: 'Le phare', idea: 'Le phare oublié' })
      expect((await api['projects.run'](p2.id)).runId).not.toBeNull()
    } finally {
      core.close()
    }
  })
})

describe.skipIf(!hasFullFfmpeg)(`a project interrupted mid-run (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('launching it again resumes the same run: never two runs for one project', { timeout: 240_000 }, async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'atelier-recipe-resume-'))
    const opts = { paths: { userData: dir }, productionRuns: { dataDir: dir } }
    let core = memoryCore(opts)
    try {
      const ch = await core.api['channels.create']({ name: 'Phares', niche: 'histoire' })
      const r = await core.api['recipes.save']({ doc: doc({ checkpoints: [], format: { aspect: '16:9', minutes: 0.5 } }) })
      const p = await core.api['projects.create']({ recipeId: r.id, channelId: ch.id, title: 'Le phare', idea: 'Le phare oublié de la côte sauvage' })
      const first = await core.api['projects.run'](p.id)
      // the app quits mid-run, then starts again: the run is interrupted
      core.close()
      core = memoryCore(opts)
      const api = core.api
      expect((await api['production.get'](first.runId as number)).status).toBe('interrupted')
      const again = await api['projects.run'](p.id)
      expect(again.runId).toBe(first.runId)
      expect((await api['production.list']()).map((x) => x.id)).toEqual([first.runId])
      const run = await waitFor(
        async () => {
          const d = await api['production.get'](first.runId as number)
          if (d.status === 'failed' || d.status === 'cancelled') throw new Error(`run ${d.status}`)
          return d.status === 'succeeded' ? d : null
        },
        230_000,
        'the resumed run to finish'
      )
      expect(run.videoFileRef).toMatch(/\.mp4$/)
      // a finished project does not run again
      await expect(api['projects.run'](p.id)).rejects.toThrow(/déjà/)
    } finally {
      core.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
})

describe.skipIf(!hasFullFfmpeg)(`a project runs on the fakes to an MP4 (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('a recipe of the existing technologies, a project for a channel: the run makes the video', { timeout: 240_000 }, async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'atelier-recipe-run-'))
    const core = memoryCore({ productionRuns: { dataDir: dir } })
    const api = core.api
    try {
      const ch = await api['channels.create']({ name: 'Phares', niche: 'histoire' })
      // no checkpoint: the run goes straight to the end
      const r = await api['recipes.save']({ doc: doc({ checkpoints: [], format: { aspect: '16:9', minutes: 0.5 } }) })
      const p = await api['projects.create']({ recipeId: r.id, channelId: ch.id, title: 'Le phare', idea: 'Le phare oublié de la côte sauvage' })
      const launched = await api['projects.run'](p.id)
      expect(launched.runId).not.toBeNull()
      await expect(api['projects.run'](p.id)).rejects.toThrow(/déjà lancé/)
      const run = await waitFor(
        async () => {
          const d = await api['production.get'](launched.runId as number)
          if (d.status === 'failed' || d.status === 'cancelled') throw new Error(`run ${d.status}: ${JSON.stringify(d.nodes.filter((n) => n.error))}`)
          return d.status === 'succeeded' ? d : null
        },
        230_000,
        'the run to finish'
      )
      expect(run.demo).toBe(true)
      expect(run.pipelineLabel).toBe('Documentaire express')
      expect(run.videoFileRef).toMatch(/\.mp4$/)
      expect(run.packageDir && existsSync(path.join(run.packageDir, 'video.mp4'))).toBe(true)
      expect((await api['projects.get'](p.id)).runStatus).toBe('succeeded')
    } finally {
      core.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
})
