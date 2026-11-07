// « Le parcours de la vidéo » in the pipeline editor (production-13): the graph of the pipeline as edited, compiled by main
// with the channel in view like a run would be (`graph.pipeline`), each brick priced from the editor's estimate
// (production-11). Clicking a brick opens its settings (`onOpen`); a brick an option switched off leads to that option.
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { PipelineEstimateView } from '../../../../shared/estimates'
import type { GraphNodeView, PipelineGraphView } from '../../../../shared/pipeline-graph'
import type { RecipeDocument } from '../../../../shared/recipes'
import { call } from '@/state/client'
import type { BrickCost } from './GraphNode'
import { PipelineGraph } from './PipelineGraph'

/** Each brick's share of the estimate: the lines it spends (pictures and clips are the same brick), over the total. */
export function brickCosts(graph: PipelineGraphView, estimate: PipelineEstimateView | null): Map<string, BrickCost | null> | null {
  if (!estimate?.available) return null
  const total = estimate.perMinute.avg
  const out = new Map<string, BrickCost | null>()
  for (const n of graph.nodes) {
    const lines = estimate.lines.filter((l) => l.brick === n.id)
    if (lines.length === 0) {
      // the LLM line is the team's, not one brick's: a brick on an LLM engine says whether the subscription covers it
      out.set(n.id, n.engine?.startsWith('llm:') ? { perMinute: 0, perVideo: 0, share: 0, llm: estimate.llm.included ? 'included' : 'paid' } : null)
      continue
    }
    const perMinute = lines.reduce((a, l) => a + l.perMinute.avg, 0)
    out.set(n.id, { perMinute, perVideo: lines.reduce((a, l) => a + l.perVideo.avg, 0), share: total > 0 ? perMinute / total : 0 })
  }
  return out
}

export function PipelineGraphCard({
  doc,
  channelId,
  estimate,
  onOpen
}: {
  doc: RecipeDocument
  channelId: number | null
  estimate: PipelineEstimateView | null
  onOpen: (node: GraphNodeView) => void
}) {
  const [graph, setGraph] = useState<PipelineGraphView | null>(null)
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      call('graph.pipeline', doc, channelId).then(
        (g) => live && setGraph(g),
        () => live && setGraph(null)
      )
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [doc, channelId])
  const costs = useMemo(() => (graph ? brickCosts(graph, estimate) : null), [graph, estimate])

  return (
    <section className="card mb-6 flex flex-col gap-3 p-5" data-testid="pipe-graph">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-semibold text-fg">{t('graph.title')}</h3>
        <p className="text-[12px] text-fg-3">{t('graph.hint')}</p>
      </div>
      {!graph ? (
        <p className="text-[12.5px] text-fg-3">{t('graph.loading')}</p>
      ) : !graph.ok ? (
        <p className="text-[12.5px] text-fg-3" data-testid="graph-invalid">
          {t('graph.invalid')}
        </p>
      ) : (
        <PipelineGraph graph={graph} costs={costs} creditEur={estimate?.creditEur ?? 0} onOpen={onOpen} />
      )}
    </section>
  )
}
