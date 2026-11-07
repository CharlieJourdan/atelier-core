// The inspector of the Pipelines canvas: what a click on a node shows (id, kind, ports, params, cost estimate).
import { t, type MessageKey } from '../../../../shared/fr'
import type { CatalogNode, NodeCost, PipelineCostReport } from '../../../../shared/analysis'
import { BUDGET_MODE_IDS, type GaugeMode } from '../../../../shared/gauge'
import { fmtCredits } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { cn } from '@/lib/utils'
import { kindOfType, refSource, type PipelineDoc } from '../shared/graph-layout'

export function costOf(report: PipelineCostReport | null, mode: GaugeMode, nodeId: string): NodeCost | null {
  return report?.modes[mode].nodes.find((n) => n.nodeId === nodeId) ?? null
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="micro-label">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] text-fg-2">{children}</dd>
    </div>
  )
}

const json = (v: unknown): string => JSON.stringify(v, null, 2)

export function NodeInspector({
  doc,
  nodeId,
  catalog,
  cost,
  mode,
  onMode
}: {
  doc: PipelineDoc
  nodeId: string | null
  catalog: readonly CatalogNode[]
  cost: PipelineCostReport | null
  mode: GaugeMode
  onMode: (m: GaugeMode) => void
}) {
  const input = nodeId?.startsWith('$inputs.') ? doc.inputs.find((i) => `$inputs.${i.id}` === nodeId) : null
  const node = nodeId && !input ? doc.nodes.find((n) => n.id === nodeId) : null
  return (
    <Panel
      title={t('pipelines.inspector.title')}
      data-testid="node-inspector"
      action={
        <div role="radiogroup" aria-label={t('analysis.mode.label')} className="inline-flex rounded-full border border-line-2 p-0.5">
          {BUDGET_MODE_IDS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => onMode(m)}
              className={cn('rounded-full px-2.5 py-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand/60', mode === m ? 'bg-brand text-ink-fg' : 'text-fg-2 hover:text-fg')}
            >
              {t(`analysis.mode.${m}`)}
            </button>
          ))}
        </div>
      }
    >
      {!node && !input ? (
        <p className="text-[13px] text-fg-3">{t('pipelines.inspector.empty')}</p>
      ) : input ? (
        <dl className="flex flex-col gap-3">
          <Row label={t('pipelines.inspector.id')}>
            <span className="font-mono">{input.id}</span>
          </Row>
          <Row label={t('pipelines.inspector.kind')}>{t('pipelines.kind.input')}</Row>
          <Row label={t('pipelines.inspector.inputKind')}>{input.kind}</Row>
          <Row label={t('pipelines.inspector.label')}>{input.label}</Row>
          <Row label={t('pipelines.inspector.required')}>{input.required ? t('pipelines.inspector.yes') : t('pipelines.inspector.no')}</Row>
          {input.help && <Row label={t('pipelines.inspector.help')}>{input.help}</Row>}
        </dl>
      ) : node ? (
        <NodeBody doc={doc} node={node} catalog={catalog} cost={cost} mode={mode} />
      ) : null}
    </Panel>
  )
}

function NodeBody({ doc, node, catalog, cost, mode }: { doc: PipelineDoc; node: PipelineDoc['nodes'][number]; catalog: readonly CatalogNode[]; cost: PipelineCostReport | null; mode: GaugeMode }) {
  const spec = catalog.find((c) => c.type === node.type)
  const nodeCost = costOf(cost, mode, node.id)
  const wired = Object.entries(node.in ?? {})
  const modeParams = node.modes?.[mode]
  return (
    <dl className="flex flex-col gap-3">
      <Row label={t('pipelines.inspector.id')}>
        <span className="font-mono">{node.id}</span>
      </Row>
      <Row label={t('pipelines.inspector.type')}>
        <span className="font-mono">{node.type}</span> · {t(`pipelines.kind.${kindOfType(node.type)}` as MessageKey)}
      </Row>
      <Row label={t('pipelines.inspector.gate')}>{t(`pipelines.gate.${node.gate ?? 'none'}` as MessageKey)}</Row>
      <Row label={t('pipelines.inspector.where')}>{node.where ? t(`pipelines.where.${node.where}` as MessageKey) : spec ? spec.executors.join(', ') : '—'}</Row>
      <Row label={t('pipelines.inspector.inputs')}>
        {wired.length === 0 && (spec?.inputs.length ?? 0) === 0 ? (
          t('pipelines.inspector.none')
        ) : (
          <ul className="flex flex-col gap-0.5">
            {(spec?.inputs ?? wired.map(([name]) => ({ name, type: '', required: false }))).map((p) => {
              const ref = node.in?.[p.name]
              const src = ref ? refSource(ref) : null
              return (
                <li key={p.name} className="flex flex-wrap gap-x-2">
                  <span className="font-mono">{p.name}</span>
                  {p.type && <span className="text-fg-3">{p.type}</span>}
                  {ref ? <span className="font-mono text-fg">← {ref}</span> : <span className={p.required ? 'text-err' : 'text-fg-3'}>{p.required ? t('pipelines.inspector.missing') : t('pipelines.inspector.optional')}</span>}
                  {src && !src.startsWith('$') && !doc.nodes.some((n) => n.id === src) && <span className="text-err">{t('pipelines.inspector.unknownSource')}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </Row>
      <Row label={t('pipelines.inspector.outputs')}>
        {spec && spec.outputs.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {spec.outputs.map((o) => (
              <li key={o.name} className="flex gap-2">
                <span className="font-mono">{o.name}</span>
                <span className="text-fg-3">{o.type}</span>
              </li>
            ))}
          </ul>
        ) : (
          t('pipelines.inspector.none')
        )}
      </Row>
      <Row label={t('pipelines.inspector.params')}>
        {node.params && Object.keys(node.params).length > 0 ? <pre className="overflow-auto rounded-field border border-line bg-surface-2 p-2 font-mono text-[11px]">{json(node.params)}</pre> : t('pipelines.inspector.none')}
      </Row>
      {modeParams && Object.keys(modeParams).length > 0 && (
        <Row label={t('pipelines.inspector.modeParams', { mode: t(`analysis.mode.${mode}`) })}>
          <pre className="overflow-auto rounded-field border border-line bg-surface-2 p-2 font-mono text-[11px]">{json(modeParams)}</pre>
        </Row>
      )}
      <Row label={t('pipelines.inspector.cost')}>
        {nodeCost ? (
          <span data-testid="node-cost">
            {nodeCost.credits === 0 ? t('analysis.cost.free') : fmtCredits(nodeCost.credits)} · {t('pipelines.inspector.duration', { n: Math.round(nodeCost.durationS) })}
          </span>
        ) : (
          t('pipelines.inspector.noCost')
        )}
      </Row>
    </dl>
  )
}
