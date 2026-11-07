// The node graph of a pipeline: our own SVG edges under real buttons (keyboard reachable), laid out by `layoutGraph`.
import { useMemo } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { cn } from '@/lib/utils'
import { layoutGraph, NODE_KINDS, parsePipelineDoc, type GraphNode, type NodeKind, type PipelineDoc } from './graph-layout'

export const KIND_TONE: Record<NodeKind, string> = {
  input: 'border-line-3 bg-surface-2',
  text: 'border-info/50 bg-info/10',
  audio: 'border-brand/50 bg-brand-soft',
  plan: 'border-warn/50 bg-warn/10',
  visual: 'border-ok/50 bg-ok/10',
  output: 'border-fg-3/50 bg-surface-pop',
  other: 'border-line-2 bg-surface-1'
}

const KIND_DOT: Record<NodeKind, string> = {
  input: 'bg-fg-3',
  text: 'bg-info',
  audio: 'bg-brand',
  plan: 'bg-warn',
  visual: 'bg-ok',
  output: 'bg-fg-2',
  other: 'bg-fg-3'
}

export function KindLegend({ kinds }: { kinds?: readonly NodeKind[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3" aria-label={t('pipelines.graph.legend')}>
      {(kinds ?? NODE_KINDS).map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 rounded-full', KIND_DOT[k])} />
          {t(`pipelines.kind.${k}` as MessageKey)}
        </li>
      ))}
    </ul>
  )
}

function NodeChip({ node, selected, onSelect }: { node: GraphNode; selected: boolean; onSelect?: (id: string) => void }) {
  const gate = node.gate && node.gate !== 'none' ? t(`pipelines.gate.${node.gate}` as MessageKey) : null
  return (
    <button
      type="button"
      data-testid={`graph-node-${node.id}`}
      data-kind={node.kind}
      aria-pressed={selected}
      onClick={() => onSelect?.(node.id)}
      className={cn(
        'absolute flex flex-col justify-center rounded-field border px-3 text-left outline-none transition-[border-color,box-shadow] duration-200 hover:border-fg-3 focus-visible:ring-2 focus-visible:ring-brand/60',
        KIND_TONE[node.kind],
        selected && 'border-brand ring-2 ring-brand/40'
      )}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', KIND_DOT[node.kind])} />
        <span className="truncate text-[12.5px] font-medium text-fg">{node.title}</span>
        {gate && <span className="ml-auto shrink-0 rounded-full border border-line-3 px-1.5 text-[9.5px] text-fg-2">{gate}</span>}
      </span>
      <span className="truncate font-mono text-[10.5px] text-fg-3">{node.type}</span>
    </button>
  )
}

/** The graph of a document given as text, or of an already parsed one. */
export function PipelineGraph({
  json,
  doc,
  selected,
  onSelect,
  className
}: {
  json?: string
  doc?: PipelineDoc | null
  selected?: string | null
  onSelect?: (id: string) => void
  className?: string
}) {
  const parsed = useMemo(() => doc ?? (json ? parsePipelineDoc(json) : null), [doc, json])
  const layout = useMemo(() => (parsed ? layoutGraph(parsed) : null), [parsed])
  if (!layout || layout.nodes.length === 0) {
    return <p className="rounded-card border border-dashed border-line-2 p-6 text-center text-[13px] text-fg-3">{t('pipelines.graph.empty')}</p>
  }
  const kinds = NODE_KINDS.filter((k) => layout.nodes.some((n) => n.kind === k))
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-auto rounded-card border border-line bg-surface-1 p-2" data-testid="pipeline-graph">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} className="absolute inset-0" aria-hidden>
            {layout.edges.map((e) => (
              <path
                key={`${e.from}>${e.to}:${e.port}`}
                d={e.path}
                fill="none"
                strokeWidth={1.5}
                className={cn('transition-colors', selected && (e.from === selected || e.to === selected) ? 'stroke-brand' : 'stroke-line-3')}
              />
            ))}
          </svg>
          {layout.nodes.map((n) => (
            <NodeChip key={n.id} node={n} selected={selected === n.id} {...(onSelect ? { onSelect } : {})} />
          ))}
        </div>
      </div>
      <KindLegend kinds={kinds} />
    </div>
  )
}
