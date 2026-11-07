// A pipeline as the editor draws it (the « dessin »): steps with a kind, who runs them, their gate and, for visual steps,
// the share of the video they cover. The production engine turns it into an executable `atelier.pipeline/1` document
// (src/engine/pipelines/from-drawing.ts) with the nodes it really has, and says which drawn steps it cannot run yet.

export const DRAWING_KINDS = [
  'idea',
  'script',
  'director',
  'avatar',
  'stock',
  'image-gen',
  'video-gen',
  'motion',
  'voice',
  'music',
  'gameplay',
  'card',
  'captions',
  'edit',
  'thumbnail',
  'qc',
  'publish',
  'translate',
  'human-input',
  'code'
] as const
export type DrawingKind = (typeof DRAWING_KINDS)[number]

export const DRAWING_RUNNERS = ['agent', 'api', 'human', 'code'] as const
export type DrawingRunner = (typeof DRAWING_RUNNERS)[number]

export interface DrawingStep {
  id: string
  kind: DrawingKind
  label: string
  runner: DrawingRunner
  /** The user validates this step before the next one. */
  gate?: boolean
  /** Visual steps: share of the video (percent). */
  share?: number
}

/** `short`: a vertical film (9:16, shorts captions); `long` (the default when absent): 16:9 long-form. */
export type DrawingFormat = 'long' | 'short'

export interface PipelineDrawing {
  name: string
  description?: string
  /** The shape of the film this pipeline makes. Absent: `long`. */
  format?: DrawingFormat
  steps: DrawingStep[]
}

/** Why a drawn step does not run as drawn (French text in the renderer: `drawing.note.<code>`). */
export type DrawingNoteCode =
  /** No engine node for it yet: the step is left out of the run. */
  | 'not_executable'
  /** Done by the user in the drawing, but the engine does it itself for now (script, voice). */
  | 'engine_does_it'
  /** Not in the drawing but needed to make a video: the engine adds it. */
  | 'added'

export interface DrawingNote {
  /** The drawn step (or, for `added`, the engine node added). */
  stepId: string
  label: string
  code: DrawingNoteCode
}

export interface DrawingCompileResult {
  /** The executable pipeline document (JSON text, `atelier.pipeline/1`). */
  json: string
  /** Drawn step → engine node it became (null: left out). */
  mapping: Record<string, string | null>
  notes: DrawingNote[]
}

/** What `pipelines.saveDrawing` answers: the library pipeline that runs the drawing, and the notes. */
export interface SaveDrawingResult {
  pipelineId: number
  version: number
  notes: DrawingNote[]
  mapping: Record<string, string | null>
}
