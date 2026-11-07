// The pipeline graph through the IPC api (production-13, decision 0023): the editor's graph of a document as edited,
// compiled with a channel's checkpoints like a run would be; a broken document gives its problems, not a graph; a
// project's run gets the graph of its pinned recipe version, whose bricks cover every node the run reports.
import { describe, expect, it } from 'vitest'
import { GRAPH_METHODS, type RecipeDocument } from '../../src/shared/api'
import { memoryCore } from './helpers'

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
  bricks: ['idea.research@1', 'script.write@1', 'voice.tts@1', 'director.plan@1', 'visuals.fulfil@1', 'captions.make@1', 'render.assemble@1', 'thumbnail.make@1', 'package.youtube@1'].map(entry),
  ...over
})

describe('pipeline graph IPC', () => {
  it('lists its methods', () => {
    expect([...GRAPH_METHODS]).toEqual([
      'graph.pipeline', // the graph of a document as edited
      'graph.run' // the graph of the project a run was launched from
    ])
  })

  it('draws a document as edited, with the gates of the channel it is compiled for', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const g = await api['graph.pipeline'](doc())
      expect(g.ok).toBe(true)
      expect(g.nodes.map((n) => n.id)).toEqual(['idea.research', 'script.write', 'voice.tts', 'director.plan', 'visuals.fulfil', 'captions.make', 'render.assemble', 'thumbnail.make', 'package.youtube'])
      // default checkpoints: topic + thumbnail
      expect(g.nodes.filter((n) => n.gate).map((n) => n.id)).toEqual(['idea.research', 'thumbnail.make'])
      const ch = await api['channels.create']({ name: 'Phares', niche: 'histoire' })
      await api['recipes.setChannel'](ch.id, { checkpoints: ['script'] })
      const forChannel = await api['graph.pipeline'](doc(), ch.id)
      expect(forChannel.nodes.filter((n) => n.gate).map((n) => n.id)).toEqual(['script.write'])
      const broken = await api['graph.pipeline'](doc({ bricks: [entry('voice.tts@1')] }))
      expect(broken.ok).toBe(false)
      expect(broken.nodes).toEqual([])
      expect(broken.errors.length).toBeGreaterThan(0)
      const notADoc = await api['graph.pipeline']({ nope: true } as unknown as RecipeDocument)
      expect(notADoc).toMatchObject({ ok: false, nodes: [] })
    } finally {
      core.close()
    }
  })

  it('draws the project a run came from; a run of no project has no graph', async () => {
    const core = memoryCore()
    const api = core.api
    try {
      const ch = await api['channels.create']({ name: 'Phares', niche: 'histoire' })
      const r = await api['recipes.save']({ doc: doc({ checkpoints: [] }) })
      const p = await api['projects.create']({ recipeId: r.id, channelId: ch.id, title: 'Le phare', idea: 'Le phare oublié' })
      const launched = await api['projects.run'](p.id)
      const g = await api['graph.run'](launched.runId as number)
      expect(g?.ok).toBe(true)
      const run = await api['production.get'](launched.runId as number)
      const covered = new Set(g?.nodes.flatMap((n) => n.nodeIds))
      expect(run.nodes.map((n) => n.nodeId).filter((id) => !covered.has(id))).toEqual([])
      expect(g?.nodes.some((n) => n.gate)).toBe(false)
      await api['production.cancel'](launched.runId as number)
      expect(await api['graph.run'](999_999)).toBeNull()
    } finally {
      core.close()
    }
  })
})
