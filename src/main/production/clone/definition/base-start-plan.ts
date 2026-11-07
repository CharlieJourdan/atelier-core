// P5 side of « start from an existing base » (decision 0112): the plan's bricks are composed from the definition (what the
// channel measures), and compared with the base pipeline's own bricks: those the measurement still needs are kept, the ones it
// needs and the base lacks are added, the base's others are dropped. Settings never come from the base (plan-rules.ts). Pure.
import type { PipelinePlan, StyleDefinition } from '../../../../shared/clone'
import { BASE_PIPELINES, type BasePipeline } from '../../../../engine/technologies/bases'

const bare = (tech: string): string => tech.split('@')[0]!

/** What became of the base pipeline's bricks in this plan, or null when the definition was built from zero. */
export function startedFromOf(def: StyleDefinition, plan: Pick<PipelinePlan, 'bricks'>, bases: readonly BasePipeline[] = BASE_PIPELINES): PipelinePlan['startedFrom'] {
  const s = def.baseStart
  if (!s || s.from !== 'base' || !s.baseId || !s.pipelineId) return null
  const pipeline = bases.find((b) => b.id === s.pipelineId)
  const baseNodes = [...new Set((pipeline?.doc.bricks ?? []).map((b) => bare(b.tech)))]
  const planNodes = [...new Set(plan.bricks.map((b) => b.node))]
  return {
    baseId: s.baseId,
    pipelineId: s.pipelineId,
    keptBricks: planNodes.filter((n) => baseNodes.includes(n)),
    addedBricks: planNodes.filter((n) => !baseNodes.includes(n)),
    droppedBricks: baseNodes.filter((n) => !planNodes.includes(n))
  }
}

/** One line for the decision log. */
export function startedFromLine(def: StyleDefinition, s: PipelinePlan['startedFrom']): string {
  if (!s) return def.baseStart ? `built from zero (${def.baseStart.candidates.map((c) => `${c.id} ${c.score}: ${c.why[0] ?? ''}`).join('; ') || 'no ready base'})` : 'built from zero'
  return `started from base ${s.baseId} (${s.pipelineId}): ${s.keptBricks.length} of its bricks kept, ${s.addedBricks.length} added (${s.addedBricks.join(', ') || 'none'}), ${s.droppedBricks.length} dropped (${s.droppedBricks.join(', ') || 'none'})`
}
