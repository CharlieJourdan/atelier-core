// The read-only graph of a pipeline (production-13, decision 0023, docs/specs/production-model.md §11), n8n-like but
// drawn by the app: the seven stages as columns, the bricks as nodes, the slots they hand each other as lines, parallel
// branches stacked, the inputs first and the finished video last. Where the canvas is too narrow for the columns to read
// (the editor's column), the stages become bands read top to bottom (graph-layout.ts, decision 0033). Hovering a brick
// lights its lines and names what they carry; clicking it calls `onOpen`. During a run the bricks take their live state and the line into the
// running brick flows. Nothing here edits the pipeline: main builds the graph from the compiled pipeline.
import { Film, Lock } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { GraphNodeView, PipelineGraphView } from '../../../../shared/pipeline-graph'
import { cn } from '@/lib/utils'
import { StageMark, stageLabel } from '../recettes/ui'
import { HEAD_H, LABEL_W, layoutGraph } from './graph-layout'
import type { BrickRunState } from './graph-run'
import { GraphNode, type BrickCost } from './GraphNode'

/** Below this the text gets too small: the canvas scrolls sideways instead. */
const MIN_SCALE = 0.68
/** The columns are kept while they read at this size at least; under it, the stages become bands. */
const COLUMNS_SCALE = 0.85

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[11.5px] text-fg-3" data-testid="graph-legend">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex size-4 items-center justify-center rounded-full bg-warn/15 text-warn">
          <Lock className="size-[9px]" strokeWidth={2.5} aria-hidden />
        </span>
        {t('graph.legend.lock')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="0" y1="3" x2="22" y2="3" stroke="var(--fg-4)" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
        {t('graph.legend.dashed')}
      </span>
      <span>{t('graph.legend.parallel')}</span>
    </div>
  )
}

export function PipelineGraph({
  graph,
  costs,
  creditEur = 0,
  run,
  runFinished = false,
  onOpen,
  testId = 'pipeline-graph'
}: {
  graph: PipelineGraphView
  /** By brick: its estimate (null: spends nothing); absent: no prices shown. */
  costs?: Map<string, BrickCost | null> | null
  creditEur?: number
  /** By brick: its state in the run shown. */
  run?: Map<string, BrickRunState> | null
  runFinished?: boolean
  onOpen?: (node: GraphNodeView) => void
  testId?: string
}) {
  const columns = useMemo(() => layoutGraph(graph, 'horizontal'), [graph])
  const bands = useMemo(() => layoutGraph(graph, 'vertical'), [graph])
  const outer = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  const [hot, setHot] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const measure = (): void => setRoom(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const layout = room === 0 || room >= columns.width * COLUMNS_SCALE ? columns : bands
  const scale = room === 0 ? 1 : Math.max(MIN_SCALE, Math.min(1, room / layout.width))
  const h = layout.orientation === 'horizontal'

  const touches = (e: { from: string; to: string }): boolean => hot !== null && (e.from === hot || e.to === hot)
  const near = useMemo(() => {
    if (hot === null) return null
    const s = new Set([hot])
    for (const e of graph.edges) if (e.from === hot || e.to === hot) s.add(e.from === hot ? e.to : e.from)
    return s
  }, [hot, graph.edges])
  const state = (id: string) => run?.get(id)?.state

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={outer}
        data-testid={testId}
        data-orientation={layout.orientation}
        role="group"
        aria-label={t('graph.aria')}
        className="relative overflow-x-auto overflow-y-hidden rounded-[16px] border border-line bg-bg"
        style={{ backgroundImage: 'radial-gradient(var(--line-2) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
      >
        <div className="mx-auto" style={{ width: layout.width * scale, height: layout.height * scale }}>
          <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
            {/* the stages: one soft band each, with its number and name */}
            {layout.stages.map((s) => (
              <div
                key={s.stage}
                data-testid={`graph-stage-${s.stage}`}
                className="absolute rounded-[14px] bg-hover"
                style={{ left: s.x, top: s.y, width: s.width, height: s.height }}
              >
                <div className={cn('flex gap-2 px-3', h ? 'items-center' : 'flex-col items-start pt-3')} style={h ? { height: HEAD_H - 4 } : { width: LABEL_W - 8 }}>
                  <StageMark stage={s.stage} className="size-5 text-[10.5px]" />
                  <span className="text-[11.5px] leading-tight font-semibold tracking-[0.01em] text-fg-2 uppercase">{stageLabel(s.stage)}</span>
                </div>
              </div>
            ))}

            <svg className="absolute inset-0" width={layout.width} height={layout.height} aria-hidden>
              {layout.sideEdges.map((e) => (
                <path key={`in-${e.to}`} d={e.d} fill="none" stroke="var(--line-3)" strokeWidth={1.25} strokeDasharray="1 4" strokeLinecap="round" opacity={hot === null || hot === e.to ? 1 : 0.35} />
              ))}
              {layout.edges.map((e) => {
                const lit = touches(e)
                const into = state(e.to)
                const flowing = !e.off && (into === 'running' || into === 'queued') && (state(e.from) === 'done' || state(e.from) === 'cached')
                const fed = !e.off && (state(e.from) === 'done' || state(e.from) === 'cached')
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    data-testid={`graph-edge-${e.from}>${e.to}`}
                    data-off={e.off ? 'true' : 'false'}
                    d={e.d}
                    fill="none"
                    className={cn(flowing && 'graph-flow')}
                    stroke={lit ? 'var(--fg)' : flowing ? 'var(--info)' : fed ? 'var(--fg-3)' : 'var(--line-3)'}
                    strokeWidth={lit ? 2 : 1.5}
                    strokeDasharray={e.off ? '5 4' : flowing ? '6 6' : undefined}
                    strokeLinecap="round"
                    opacity={hot !== null && !lit ? 0.3 : e.off ? 0.75 : 1}
                  />
                )
              })}
              {layout.endEdge && <path d={layout.endEdge} fill="none" stroke={runFinished ? 'var(--ok)' : 'var(--line-3)'} strokeWidth={1.5} />}
            </svg>

            {/* what a lit line carries */}
            {layout.edges
              .filter((e) => touches(e))
              .map((e) => (
                <span
                  key={`label-${e.from}>${e.to}`}
                  className="pointer-events-none absolute z-[2] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-2 bg-surface-pop px-1.5 text-[10.5px] leading-[17px] whitespace-nowrap text-fg-2 shadow-[var(--shadow-pop)]"
                  style={{ left: e.mid.x, top: e.mid.y }}
                >
                  {e.slots.map((s) => t(`graph.slot.${s}` as MessageKey)).join(' · ')}
                </span>
              ))}

            {layout.side && (
              <div
                data-testid="graph-inputs"
                className="absolute flex flex-col gap-1.5 overflow-hidden rounded-[12px] border border-line-2 bg-surface-1 px-3 py-2.5"
                style={{ left: layout.side.x, top: layout.side.y, width: layout.side.width, maxHeight: layout.side.height }}
              >
                <span className="text-[11px] font-semibold tracking-[0.01em] text-fg-2 uppercase">{t('graph.inputs')}</span>
                <div className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${layout.sideCols}, minmax(0, 1fr))` }}>
                  {graph.inputs.map((i) => (
                    <span key={i.id} className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-[11.5px] text-fg">{i.label}</span>
                      <span className="text-[10.5px] text-fg-4">{t(`graph.input.${i.source}` as MessageKey)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {graph.nodes.map((n) => {
              const p = layout.nodes.get(n.id)
              if (!p) return null
              return (
                <GraphNode
                  key={n.id}
                  node={n}
                  x={p.x}
                  y={p.y}
                  cost={costs ? (costs.get(n.id) ?? null) : undefined}
                  creditEur={creditEur}
                  run={run?.get(n.id) ?? null}
                  hot={hot === n.id}
                  dim={near !== null && !near.has(n.id)}
                  orientation={layout.orientation}
                  onOpen={onOpen}
                  onHover={setHot}
                />
              )
            })}

            {layout.end && (
              <div
                data-testid="graph-end"
                className={cn('absolute flex items-center gap-2.5 rounded-[12px] border px-3', runFinished ? 'border-ok/60 bg-ok/10' : 'border-line-2 bg-surface-1')}
                style={{ left: layout.end.x, top: layout.end.y, width: layout.end.width, height: layout.end.height }}
              >
                <span aria-hidden className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full', runFinished ? 'bg-ok text-ink-fg' : 'bg-ink text-ink-fg')}>
                  <Film className="size-[14px]" strokeWidth={2} />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[12.5px] font-semibold text-fg">{t('graph.end')}</span>
                  <span className="truncate text-[10.5px] text-fg-3">{t('graph.end.hint')}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <Legend />
    </div>
  )
}
