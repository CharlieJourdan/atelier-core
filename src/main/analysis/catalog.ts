// The engine's node catalogue as the analysis area uses it: validation of a pipeline document (problems by code and
// path, translated in the renderer), the cost of a pipeline in both budget modes (engine estimate → credits with the
// local price grid, the same placeholders as Atelier Cloud's), and the node list for the inspector and the Builder.
import { estimatePipeline } from '../../engine/estimate'
import { productionRegistry } from '../../engine/nodes'
import { simpleVideoPipeline } from '../../engine/pipelines/simple-video'
import type { NodeRegistry } from '../../engine/registry'
import { validatePipeline, type ResolvedPipeline } from '../../engine/validate'
import type { CatalogNode, PipelineCheck, PipelineCostReport, PipelineProblem, TemplateInfo } from '../../shared/analysis'
import { BUDGET_MODE_IDS } from '../../shared/gauge'
import { creditsForUnits } from '../credits/prices'

let registry: NodeRegistry | null = null
export function catalogRegistry(): NodeRegistry {
  registry ??= productionRegistry()
  return registry
}

/** Documents above this size are refused before parsing (an import is a pasted text or a picked file). */
export const MAX_PIPELINE_CHARS = 200_000

export const TEMPLATES: readonly { id: string; build: () => TemplateInfo }[] = [
  {
    id: 'simple-video',
    build: () => {
      const p = simpleVideoPipeline(8)
      return { id: 'simple-video', name: 'Vidéo simple', description: p.name, json: pretty(p) }
    }
  }
]

export function pretty(doc: unknown): string {
  return JSON.stringify(doc, null, 2)
}

export function parseJson(text: string): { ok: true; doc: unknown } | { ok: false; problems: PipelineProblem[] } {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, problems: [{ code: 'empty', path: '' }] }
  if (text.length > MAX_PIPELINE_CHARS) return { ok: false, problems: [{ code: 'too_large', path: '' }] }
  try {
    return { ok: true, doc: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, problems: [{ code: 'json', path: '' }] }
  }
}

const pathText = (path: (string | number)[]): string => path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.').replace(/\.\[/g, '[')

/** Validates a document (text or parsed): shape (`pipelineSchema`) then graph rules (`validatePipeline`). */
export function checkPipeline(input: string | unknown): PipelineCheck & { plan?: ResolvedPipeline } {
  let doc: unknown = input
  if (typeof input === 'string') {
    const parsed = parseJson(input)
    if (!parsed.ok) return parsed
    doc = parsed.doc
  }
  const res = validatePipeline(doc, catalogRegistry())
  if (!res.ok) return { ok: false, problems: res.errors.map((e) => ({ code: e.code, path: pathText(e.path) })) }
  return { ok: true, json: pretty(res.plan.pipeline), name: res.plan.pipeline.name, plan: res.plan }
}

/**
 * The `$style.x` fields an estimate resolves with (a typical channel). Without them the params of a node that reads the
 * style fail validation and the node is estimated from no params at all (a voice then had a duration of NaN seconds).
 */
const ESTIMATE_STYLE = { language: 'fr', voice: 'demo-claire', pace: 'natural', captions: 'highlight', burn: true } as const

/** Credits of a valid pipeline in both modes, for its default length (and per minute). */
export async function costReport(plan: ResolvedPipeline, minutes?: number): Promise<PipelineCostReport> {
  const m = minutes ?? plan.pipeline.format.minutes.default
  const modes = {} as PipelineCostReport['modes']
  for (const mode of BUDGET_MODE_IDS) {
    const est = await estimatePipeline(plan, { budgetMode: mode, minutes: m, style: ESTIMATE_STYLE })
    const nodes = est.nodes.map((n) => ({
      nodeId: n.nodeId,
      type: n.type,
      where: n.where,
      credits: n.paid ? creditsForUnits(n.estimate.units, n.estimate.provider) : 0,
      durationS: n.estimate.durationS
    }))
    const credits = nodes.reduce((s, n) => s + n.credits, 0)
    modes[mode] = { credits, perMinute: Math.round((credits / m) * 10) / 10, durationS: est.durationS, nodes }
  }
  return { minutes: m, modes }
}

export function catalogNodes(): CatalogNode[] {
  return catalogRegistry()
    .list()
    .map((d) => ({
      type: d.type,
      inputs: Object.entries(d.inputs).map(([name, p]) => ({ name, type: p.type, required: p.required })),
      outputs: Object.entries(d.outputs).map(([name, type]) => ({ name, type })),
      executors: [...d.executors],
      defaultGate: d.defaultGate ?? 'none',
      claudeRole: d.claudeRole ?? null
    }))
}

/** The catalogue as text for the Builder's system prompt (generated, never hand-written). */
export function catalogText(): string {
  return catalogNodes()
    .map((n) => {
      const ins = n.inputs.map((i) => `${i.name}: ${i.type}${i.required ? ' (obligatoire)' : ''}`).join(', ') || 'aucune'
      const outs = n.outputs.map((o) => `${o.name}: ${o.type}`).join(', ')
      return `- ${n.type} — entrées : ${ins} ; sorties : ${outs} ; exécuteurs : ${n.executors.join(', ')} ; validation par défaut : ${n.defaultGate}`
    })
    .join('\n')
}
