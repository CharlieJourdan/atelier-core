// Artefacts (docs/ENGINE-SPEC.md §3): what a node produces, a structured value and/or files. This module knows the
// shape each artefact type must have, so the engine can check every output after `run` (R2.2) and every replaced
// output at a gate (R11.3), and which artefact types a pipeline input of a given kind may feed.
import { ARTEFACT_TYPES, type ArtefactType, type InputKind, type Json } from './types'

/** An artefact as the store keeps it and as nodes receive it (spec R3.4). */
export interface Artefact {
  type: ArtefactType
  fingerprint: string
  /** Absolute paths of the artefact's files (inside the store once stored). */
  files?: string[]
  value?: Json
  meta?: Record<string, Json>
}

/** What a node returns for one output: the engine adds the type and the fingerprint. */
export interface OutputValue {
  files?: string[]
  value?: Json
  meta?: Record<string, Json>
}

export type NodeOutputs = Record<string, OutputValue>

export const isArtefactType = (t: string): t is ArtefactType => (ARTEFACT_TYPES as readonly string[]).includes(t)

/** `media.image[]` -> true. A list type and its element type are different types (R3.1). */
export const isListType = (t: ArtefactType): boolean => t.endsWith('[]')

/** The family of a type, from its prefix: `text`, `json`, `audio`, `media`, `video`, `image`, `subs`, `package`. */
export const familyOf = (t: ArtefactType): string => t.slice(0, t.indexOf('.'))

/** Edge typing (R3.2, decision: exact match, no implicit coercion in v2). */
export const edgeAccepts = (source: ArtefactType, target: ArtefactType): boolean => source === target

/**
 * Which artefact types a pipeline input of each kind may feed (decision, P2): a user's text may be a brief or a
 * script; a video, their footage clips or a finished video; an audio file, a voice, music or a sound; an image, a list
 * of images or thumbnails. `file` is a generic upload and may feed any port: its content is checked by the node.
 */
const KIND_FEEDS: Record<InputKind, readonly ArtefactType[] | 'any'> = {
  text: ['text.input', 'text.brief', 'text.script'],
  video: ['media.clip[]', 'video.final'],
  audio: ['audio.voice', 'audio.music', 'audio.sfx'],
  image: ['media.image[]', 'image.thumbnail[]'],
  file: 'any'
}

export function inputKindFeeds(kind: InputKind, target: ArtefactType): boolean {
  const feeds = KIND_FEEDS[kind]
  return feeds === 'any' || feeds.includes(target)
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Checks that an output value has the shape of its artefact type (R2.2). Returns a problem in English (for logs and
 * tests; the user sees a French message built from the error code), or null when it fits.
 * - `text.*`: a string value.
 * - `json.*`: an object or array value (each JSON format's own schema is checked by the lot that defines it).
 * - list types (`x[]`): a `files` array (possibly empty) or an array value.
 * - other media (`audio.*`, `video.*`, `subs.*`): at least one file.
 * - `package.youtube`: an object value (title, description…) and its files.
 */
export function checkOutputShape(type: ArtefactType, out: OutputValue): string | null {
  const files = out.files
  if (files !== undefined && (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || f === ''))) {
    return 'files must be non-empty strings'
  }
  const family = familyOf(type)
  if (isListType(type)) {
    if (Array.isArray(files) || Array.isArray(out.value)) return null
    return `${type} needs a files list or an array value`
  }
  if (family === 'text') return typeof out.value === 'string' ? null : `${type} needs a string value`
  if (family === 'json') {
    return isPlainObject(out.value) || Array.isArray(out.value) ? null : `${type} needs an object or array value`
  }
  if (type === 'package.youtube') return isPlainObject(out.value) ? null : `${type} needs an object value`
  return files && files.length > 0 ? null : `${type} needs at least one file`
}
