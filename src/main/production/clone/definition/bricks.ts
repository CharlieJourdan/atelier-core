// The real `bricks` service of the cloning engine (chantier B, decision 0095): the feasibility map measured from the
// analyses' shots against the engine's brick catalogue (`productionRegistry`), and the alternatives faithful to the
// channel's measured universe. No LLM, no money.
import { productionRegistry } from '../../../../engine/nodes'
import type { Synthesis, VideoAnalysis } from '../../../../shared/clone'
import type { CloneServices } from '../services'
import { faithfulAlternatives } from './alternatives'
import { channelUniverse, measureElements } from './elements'

/** True when the engine registers a node of that type (any version: `motion.render` matches `motion.render@1`). */
export function engineHasBrick(): (node: string) => boolean {
  const types = new Set(productionRegistry().list().map((d) => d.type.split('@')[0]!))
  return (node) => types.has(node.split('@')[0]!)
}

export function bricksService(hasBrick: (node: string) => boolean = engineHasBrick()): CloneServices['bricks'] {
  // The corpus of each map() call, keyed by its synthesis (P3 passes the same object to alternatives()): never another
  // clone's topics or palette, even when one service serves several clones at once.
  const corpora = new WeakMap<Synthesis, readonly VideoAnalysis[]>()
  return {
    map: async (synthesis, analyses, brief) => { corpora.set(synthesis, analyses); return measureElements(analyses, brief, hasBrick) },
    alternatives: async (elements, synthesis) => faithfulAlternatives(elements, channelUniverse(corpora.get(synthesis) ?? [], synthesis))
  }
}
