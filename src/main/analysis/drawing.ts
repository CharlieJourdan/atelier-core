// `pipelines.saveDrawing`: the editor's drawn pipeline becomes an executable pipeline of the library. The drawing is
// checked, compiled by the engine (src/engine/pipelines/from-drawing.ts: real nodes only, the others reported), validated
// against the production registry and saved — as a new library pipeline, or as the next version of the one it already
// became (an unchanged drawing keeps its version).
import { pipelineFromDrawing } from '../../engine/pipelines/from-drawing'
import { DRAWING_KINDS, DRAWING_RUNNERS, type DrawingStep, type PipelineDrawing, type SaveDrawingResult } from '../../shared/pipeline-drawing'
import { checkPipeline } from './catalog'
import { PipelineInvalidError, type PipelineLibrary } from './library'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The drawing as sent by the renderer, checked field by field (French errors). */
export function checkDrawing(v: unknown): PipelineDrawing {
  if (!isObj(v) || typeof v.name !== 'string' || !Array.isArray(v.steps)) throw new Error('Pipeline dessinée invalide.')
  if (v.steps.length === 0 || v.steps.length > 60) throw new Error('Une pipeline dessinée a entre 1 et 60 étapes.')
  const steps: DrawingStep[] = v.steps.map((s, i) => {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.label !== 'string') throw new Error(`Étape ${i + 1} invalide.`)
    if (!(DRAWING_KINDS as readonly unknown[]).includes(s.kind)) throw new Error(`Étape « ${s.label} » : type inconnu.`)
    if (!(DRAWING_RUNNERS as readonly unknown[]).includes(s.runner)) throw new Error(`Étape « ${s.label} » : exécutant inconnu.`)
    const step: DrawingStep = { id: s.id.slice(0, 80), kind: s.kind as DrawingStep['kind'], label: s.label.slice(0, 120), runner: s.runner as DrawingStep['runner'] }
    if (s.gate === true) step.gate = true
    if (typeof s.share === 'number' && Number.isFinite(s.share)) step.share = Math.max(0, Math.min(100, s.share))
    return step
  })
  const out: PipelineDrawing = { name: v.name.trim().slice(0, 120) || 'Pipeline dessinée', steps }
  if (typeof v.description === 'string') out.description = v.description.slice(0, 600)
  if (v.format === 'short') out.format = 'short'
  return out
}

export interface SaveDrawingOptions {
  /** The library pipeline this drawing already became: a new version is added to it. */
  pipelineId?: number
  channelId?: number | null
  minutes?: number
}

export function saveDrawing(library: PipelineLibrary, drawingRaw: unknown, opts: SaveDrawingOptions = {}): SaveDrawingResult {
  const drawing = checkDrawing(drawingRaw)
  const slug = drawing.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'pipeline'
  const compiled = pipelineFromDrawing(drawing, { id: `drawn-${slug}`, ...(typeof opts.minutes === 'number' ? { minutes: opts.minutes } : {}) })
  const json = JSON.stringify(compiled.pipeline)
  const check = checkPipeline(json)
  if (!check.ok) throw new PipelineInvalidError(check.problems)
  let row
  if (typeof opts.pipelineId === 'number') {
    const current = library.row(opts.pipelineId)
    const same = current.latestVersion > 0 && library.versionJson(opts.pipelineId, current.latestVersion) === check.json
    row = same ? current : library.addVersion(opts.pipelineId, check.json, 'Depuis l’éditeur')
  } else {
    row = library.create({
      name: drawing.name,
      description: drawing.description ?? 'Dessinée dans l’éditeur de pipelines.',
      origin: 'own',
      channelId: opts.channelId ?? null,
      json: check.json,
      note: 'Depuis l’éditeur'
    })
  }
  return { pipelineId: row.id, version: row.latestVersion, notes: compiled.notes, mapping: compiled.mapping }
}
