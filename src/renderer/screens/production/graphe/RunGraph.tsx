// The graph of a run (production-13, R11.2): the pipeline of the project the run was launched from (`graph.run`), each
// brick lit with its live state from the run's nodes (waiting, running, done, failed, credits spent), refreshed with the
// run. A run launched from no project has no graph: nothing is shown. Clicking a brick picks its node in the run view.
import { useMemo } from 'react'
import { t } from '../../../../shared/fr'
import type { RunDetail } from '../../../../shared/runs'
import { call, useLoader } from '@/state/client'
import { brickStates, withRunGates } from './graph-run'
import { PipelineGraph } from './PipelineGraph'

export function RunGraph({ run, onPick }: { run: RunDetail; onPick: (nodeId: string) => void }) {
  const graph = useLoader(() => call('graph.run', run.id), String(run.id), [])
  const shown = useMemo(() => (graph.data ? withRunGates(graph.data, run.nodes) : null), [graph.data, run.nodes])
  const states = useMemo(() => (shown ? brickStates(shown, run.nodes) : null), [shown, run.nodes])
  if (!shown?.ok || !states) return null
  return (
    <section className="flex flex-col gap-2" data-testid="run-graph">
      <p className="m-0 text-[12px] text-fg-3">{t('graph.hint.run')}</p>
      <PipelineGraph
        graph={shown}
        run={states}
        runFinished={run.status === 'succeeded'}
        testId="run-pipeline-graph"
        onOpen={(n) => {
          const pick = states.get(n.id)?.pick
          if (pick) onPick(pick)
        }}
      />
    </section>
  )
}
