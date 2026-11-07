// Merge of lot P4 into PAF: the P4 nodes that read a run-wide setting declare it in `reads` (review PA finding 1), so a
// change of the target duration reruns exactly the nodes whose output depends on it and what is downstream of them.
import { describe, expect, it } from 'vitest'
import {
  MemoryArtefactStore,
  MemoryNodeStateStore,
  declaredSettings,
  nodeFingerprint,
  startRun,
  validatePipeline,
  type AnyNodeDef,
  type RunSettings
} from '../../src/engine'
import { productionRegistry } from '../../src/engine/nodes'
import { DEFAULT_SIMPLE_STYLE, simpleVideoPipeline } from '../../src/engine/pipelines/simple-video'
import { tempDir, testServices } from './engine-node-helpers'

/** A node's fingerprint with fixed params, inputs and seed: only the run settings vary. */
const fpOf = (def: AnyNodeDef, run: RunSettings): string =>
  nodeFingerprint({ type: def.type, params: {}, inputs: {}, seed: 0, settings: declaredSettings(def, run) })

const MINUTES_READERS = ['package.youtube@1', 'research.topic@1', 'script.factcheck@1', 'script.write@1', 'script.write@2', 'voice.own@1', 'voice.tts@1']

describe('P4 nodes declare the run settings they read', () => {
  const nodes = productionRegistry().list()
  const base: RunSettings = { minutes: 1, budgetMode: 'usage_max' }

  it('changing minutes changes the fingerprint of the nodes that read it, and only theirs', () => {
    const changed = nodes.filter((d) => fpOf(d, base) !== fpOf(d, { ...base, minutes: 3 })).map((d) => d.type)
    expect(changed.sort()).toEqual(MINUTES_READERS)
    for (const t of ['beats.split@1', 'director.plan@1', 'visuals.fulfil@1', 'captions.make@1', 'sound.music@1', 'render.assemble@1'])
      expect(nodes.some((d) => d.type === t), t).toBe(true)
  })

  it('no P4 node reads the budget mode at run time (its modes go through params, R5.4)', () => {
    const changed = nodes.filter((d) => fpOf(d, base) !== fpOf(d, { ...base, budgetMode: 'qualite_max' }))
    expect(changed.map((d) => d.type)).toEqual([])
  })

  it('scheduler: same minutes reuse research and script; another target duration reruns both and lengthens the script', async () => {
    const tmp = tempDir('reads')
    try {
      const registry = productionRegistry()
      const full = simpleVideoPipeline(1)
      const pipeline = {
        ...full,
        nodes: full.nodes.filter((n) => n.id === 'research' || n.id === 'script').map(({ gate: _gate, ...n }) => n)
      }
      const v = validatePipeline(pipeline, registry, { styleFields: Object.keys(DEFAULT_SIMPLE_STYLE) })
      if (!v.ok) throw new Error(JSON.stringify(v.errors))
      const store = new MemoryArtefactStore()
      const state = new MemoryNodeStateStore()
      const services = testServices(tmp.dir)
      const launch = async (minutes: number) => {
        const ran: string[] = []
        const fps: Record<string, string> = {}
        const run = startRun({
          plan: v.plan,
          store,
          state,
          scope: 'reads',
          inputs: { topic: { value: 'Les phares de Bretagne' } },
          style: { ...DEFAULT_SIMPLE_STYLE },
          minutes,
          useFakes: true,
          services,
          onEvent: (e) => {
            if (e.kind === 'start') ran.push(e.nodeId)
            if (e.kind === 'done' || e.kind === 'cached') fps[e.nodeId] = e.fingerprint
          }
        })
        const r = await run.done
        expect(r.status).toBe('done')
        const text = (await store.getRun(fps.script as string))?.outputs.text?.value
        return { ran: ran.sort(), words: String(text).split(/\s+/).filter(Boolean).length }
      }
      const one = await launch(1)
      expect(one.ran).toEqual(['research', 'script'])
      expect((await launch(1)).ran).toEqual([])
      const two = await launch(2)
      expect(two.ran).toEqual(['research', 'script'])
      expect(two.words).toBeGreaterThan(one.words)
    } finally {
      tmp.cleanup()
    }
  })
})
