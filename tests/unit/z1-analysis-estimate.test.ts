// Regression: the cost report of a template pipeline had a duration of NaN seconds for every node that reads the channel
// style (params like "$style.voice" failed validation, the node was estimated from no params).
import { describe, expect, it } from 'vitest'
import { memoryCore } from './helpers'

describe('pipelines.estimate', () => {
  it('gives finite credits and durations for every node of the template, in both modes', async () => {
    const core = memoryCore()
    try {
      const tpl = (await core.api['pipelines.templates']())[0]
      if (!tpl) throw new Error('no template')
      const report = await core.api['pipelines.estimate'](tpl.json)
      for (const mode of ['qualite_max', 'usage_max'] as const) {
        const m = report.modes[mode]
        expect(Number.isFinite(m.durationS), mode).toBe(true)
        expect(m.nodes.length).toBeGreaterThan(5)
        for (const n of m.nodes) {
          expect(Number.isFinite(n.credits), `${mode} ${n.nodeId} credits`).toBe(true)
          expect(Number.isFinite(n.durationS), `${mode} ${n.nodeId} duration`).toBe(true)
        }
      }
      const voice = report.modes.usage_max.nodes.find((n) => n.nodeId === 'voice')
      expect(voice?.durationS).toBeGreaterThan(0)
    } finally {
      core.close()
    }
  })
})
