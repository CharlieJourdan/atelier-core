// The cloning engine's contract (docs/METHODE-REVERSE-PIPELINE.md, decision 0095): the pieces every artefact shares.
// Every artefact is a versioned JSON document saved under the creation's folder (`clones/<id>/p<N>-*.json`); every
// number that describes the reference carries its evidence (timestamps, frame paths); every Style Definition field says
// where its value came from (`measured` from the reference, `user` said so, `default` because nothing was measured).
// Pure schemas: no I/O.
import { z } from 'zod'

/** Parts of a video every per-part measure uses (hook, body, promo/sponsor read, end). */
export const VIDEO_PARTS = ['hook', 'body', 'promo', 'end'] as const
export type VideoPart = (typeof VIDEO_PARTS)[number]
export const VideoPartSchema = z.enum(VIDEO_PARTS)

/** Where a presenter sits on screen for one shot (`inset` = picture in picture). */
export const LAYOUTS = ['full', 'half-left', 'half-right', 'inset', 'off'] as const
export type Layout = (typeof LAYOUTS)[number]
export const LayoutSchema = z.enum(LAYOUTS)

/** Where a picture comes from: found (archives, stock, web), filmed, generated, drawn, 3D, or made as motion design. */
export const MEDIA_ORIGINS = ['found', 'filmed', 'generated', 'drawn', '3d', 'motion', 'presenter', 'screen'] as const
export type MediaOrigin = (typeof MEDIA_ORIGINS)[number]
export const MediaOriginSchema = z.enum(MEDIA_ORIGINS)

/** Axes the comparison and the blind judge score (spec §2 P7). */
export const COMPARE_AXES = ['identity', 'layout', 'cadence', 'illustration', 'motion', 'palette', 'voice', 'sound', 'script', 'captions'] as const
export type CompareAxis = (typeof COMPARE_AXES)[number]
export const CompareAxisSchema = z.enum(COMPARE_AXES)

/** Proof of a measure: which corpus video, when, and the frames (paths relative to the clone folder) that show it. */
export const Evidence = z.object({
  video: z.string().min(1).optional(),
  atS: z.number().min(0).optional(),
  fromS: z.number().min(0).optional(),
  toS: z.number().min(0).optional(),
  frames: z.array(z.string().min(1)).default([]),
  note: z.string().optional()
}).refine((e) => e.atS !== undefined || e.fromS !== undefined || e.frames.length > 0 || (e.note ?? '').length > 0, 'evidence must point somewhere (time, frames or a note)')
export type Evidence = z.infer<typeof Evidence>

/** A number (or value) measured on the reference: never without its evidence. */
export function measured<T extends z.ZodType>(value: T) {
  return z.object({ value, evidence: z.array(Evidence).min(1) })
}
export const MeasuredNumber = measured(z.number())
export type MeasuredNumber = z.infer<typeof MeasuredNumber>

/** Where a Style Definition field's value came from. */
export const FIELD_SOURCES = ['measured', 'default', 'user'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

/** A Style Definition field: its value, its source and its evidence (required when measured, a note when the user said it). */
export function sourced<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    source: z.enum(FIELD_SOURCES),
    evidence: z.array(Evidence).default([]),
    note: z.string().optional()
  }).refine((f) => f.source !== 'measured' || f.evidence.length > 0, 'a measured field carries its evidence')
}
export interface Sourced<T = unknown> { value: T; source: FieldSource; evidence: Evidence[]; note?: string }

/** True when a node of a JSON tree is a Sourced field (has value + source + evidence). */
export function isSourced(node: unknown): node is Sourced {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false
  const o = node as Record<string, unknown>
  return 'value' in o && typeof o['source'] === 'string' && (FIELD_SOURCES as readonly string[]).includes(o['source']) && Array.isArray(o['evidence'])
}

/** Every Sourced field of a tree with its dotted path (`script.wordsPerMinute`); arrays use the index (`a.0.b`). */
export function sourcedFields(tree: unknown, prefix = ''): { path: string; field: Sourced }[] {
  if (isSourced(tree)) return [{ path: prefix, field: tree }]
  const out: { path: string; field: Sourced }[] = []
  if (Array.isArray(tree)) tree.forEach((v, i) => out.push(...sourcedFields(v, prefix ? `${prefix}.${i}` : String(i))))
  else if (tree !== null && typeof tree === 'object') {
    for (const [k, v] of Object.entries(tree as Record<string, unknown>)) out.push(...sourcedFields(v, prefix ? `${prefix}.${k}` : k))
  }
  return out
}

/** The value at a dotted path, or undefined. */
export function atPath(tree: unknown, path: string): unknown {
  let node: unknown = tree
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** A copy of a tree with the node at a dotted path replaced (the path must exist). */
export function withAtPath<T>(tree: T, path: string, node: unknown): T {
  const copy = structuredClone(tree)
  const keys = path.split('.')
  let parent: unknown = copy
  for (const key of keys.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object') throw new Error(`no path ${path}`)
    parent = (parent as Record<string, unknown>)[key]
  }
  const last = keys[keys.length - 1]!
  if (parent === null || typeof parent !== 'object' || !(last in parent)) throw new Error(`no path ${path}`)
  ;(parent as Record<string, unknown>)[last] = node
  return copy
}

/** The head every artefact carries: its schema (name + version), the clone it belongs to, when it was written. */
export function head<N extends string>(name: N) {
  return {
    schema: z.literal(`atelier.clone.${name}/1` as const),
    cloneId: z.string().min(1),
    createdAt: z.string().min(1)
  }
}

/** Money and time of one service call or one phase (measured, never guessed). */
export const Spend = z.object({ usd: z.number().min(0), seconds: z.number().min(0).default(0), what: z.string().min(1) })
export type Spend = z.infer<typeof Spend>
