// The pipeline a run uses and its style. Default: the template pipeline of lot P4 (`simpleVideoPipeline`), whose
// voice node also reads `$style.systemVoice` when the owner picked a system voice (demo voice of `voice.tts`).
// Pipelines from lot P6's library plug in here through the factory (`ProductionRunsDeps.pipeline`).
import { productionRegistry } from '../../../engine/nodes'
import type { Pipeline } from '../../../engine/pipeline-schema'
import { DEFAULT_SIMPLE_STYLE, simpleVideoPipeline } from '../../../engine/pipelines/simple-video'
import { withSpeakers } from '../../../engine/pipelines/speakers'
import type { NodeRegistry } from '../../../engine/registry'
import { validatePipeline, type ResolvedPipeline } from '../../../engine/validate'
import type { RunStyle } from '../../../shared/runs'
import type { Db } from '../../db'

export type PipelineFactory = (minutes: number, style: Record<string, unknown>) => Pipeline

export const templatePipeline: PipelineFactory = (minutes, style) => {
  const p = simpleVideoPipeline(minutes)
  if (typeof style.systemVoice === 'string') {
    for (const n of p.nodes) if (n.id === 'voice') n.params = { ...(n.params ?? {}), systemVoice: '$style.systemVoice' }
  }
  return p
}

/**
 * The latest version of a library pipeline (Production › Pipelines, or a drawing saved from the editor), with its
 * length set to the run's (inside the document's bounds widened to the run's minutes).
 */
export function libraryPipeline(db: Db, id: number, minutes: number): Pipeline {
  const row = db
    .prepare(
      `SELECT v.json FROM library_pipeline_versions v JOIN library_pipelines p ON p.id = v.pipeline_id
       WHERE p.id = ? ORDER BY v.number DESC LIMIT 1`
    )
    .get(id) as { json: string } | undefined
  if (!row) throw new Error(`Pipeline introuvable dans la bibliothèque : ${id}.`)
  const doc = JSON.parse(row.json) as Pipeline
  const m = doc.format?.minutes
  if (m) doc.format.minutes = { ...m, default: minutes, min: Math.min(m.min, minutes), max: Math.max(m.max, minutes) }
  return doc
}

export { withSpeakers }

export const DEFAULT_RUN_STYLE: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE }

export function defaultRegistry(): NodeRegistry {
  return productionRegistry()
}

/** The run's full style: defaults, then the owner's overrides (unset fields keep the default). */
export function mergeStyle(defaults: Record<string, unknown>, overrides: RunStyle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults }
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) out[k] = v
  return out
}

/** Validates a pipeline document against the registry, or throws a French error listing the problems. */
export function resolvePipeline(doc: unknown, registry: NodeRegistry, style: Record<string, unknown>): ResolvedPipeline {
  const v = validatePipeline(doc, registry, { styleFields: Object.keys(style) })
  if (!v.ok) {
    const list = v.errors.slice(0, 5).map((e) => `${e.code} (${e.path.join('.')})`).join(', ')
    throw new Error(`Le pipeline n’est pas valable : ${list}.`)
  }
  return v.plan
}
