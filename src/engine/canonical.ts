// Canonical serialisation and fingerprints (docs/ENGINE-SPEC.md §7). The same logical value MUST give the same bytes,
// and so the same fingerprint, on every host and OS: object keys sorted, no whitespace, one form per number,
// `undefined` fields dropped, arrays kept in order. Anything that is not plain JSON data is refused rather than guessed.
import { createHash } from 'node:crypto'
import type { Json, NodeTypeId } from './types'

export class CanonicalError extends Error {
  readonly path: string
  constructor(message: string, path: string) {
    super(`${message} at ${path || '<root>'}`)
    this.path = path
    this.name = 'CanonicalError'
  }
}

/** Keys compare by UTF-16 code units, which is what `<` does on every JavaScript engine (never locale-dependent). */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function write(value: unknown, path: string, seen: Set<object>, out: string[]): void {
  if (value === null) {
    out.push('null')
    return
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false')
      return
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalError('non-finite number', path)
      // ECMAScript's Number::toString is the shortest round-trip form and is specified exactly; -0 becomes 0.
      out.push(Object.is(value, -0) ? '0' : String(value))
      return
    case 'string':
      // no Unicode normalisation (decision): strings are content, and different code points are different content.
      // Hosts normalise text they read from the OS (e.g. macOS NFD file names) before it reaches the engine.
      out.push(JSON.stringify(value))
      return
    case 'object':
      break
    default:
      throw new CanonicalError(`unsupported ${typeof value}`, path)
  }
  const obj = value as object
  if (seen.has(obj)) throw new CanonicalError('circular reference', path)
  seen.add(obj)
  if (Array.isArray(obj)) {
    out.push('[')
    obj.forEach((item: unknown, i) => {
      if (i > 0) out.push(',')
      // a hole or an undefined item has no "dropped" form inside an array: it is written as null, like JSON does
      write(item === undefined ? null : item, `${path}[${i}]`, seen, out)
    })
    out.push(']')
  } else {
    const proto = Object.getPrototypeOf(obj) as unknown
    if (proto !== Object.prototype && proto !== null) throw new CanonicalError('not a plain object', path)
    const rec = obj as Record<string, unknown>
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort(byCodeUnit)
    out.push('{')
    keys.forEach((k, i) => {
      if (i > 0) out.push(',')
      out.push(JSON.stringify(k), ':')
      write(rec[k], path ? `${path}.${k}` : k, seen, out)
    })
    out.push('}')
  }
  seen.delete(obj)
}

/** The canonical JSON text of a value (spec R7.2). Throws `CanonicalError` on anything that is not plain data. */
export function canonicalJson(value: unknown): string {
  const out: string[] = []
  write(value, '', new Set(), out)
  return out.join('')
}

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** Domain prefixes keep the three kinds of fingerprint from ever colliding with one another. */
const DOMAIN = { node: 'atelier.node/1\n', content: 'atelier.content/1\n', output: 'atelier.output/1\n' } as const

/** What a node run's fingerprint is computed from (spec R7.1). */
export interface FingerprintInput {
  type: NodeTypeId
  /** Params after the mode overlay and `$style` / `$inputs` resolution. */
  params: Record<string, unknown>
  /** Input port -> fingerprint of the artefact wired to it. */
  inputs: Record<string, string>
  seed: number
  /** Change requests made at a gate (spec R11.3); left out of the hash while empty. */
  notes?: string[]
  /** Run-wide settings the node declares it reads (`NodeDef.reads`: target minutes, budget mode); left out while empty. */
  settings?: Record<string, Json>
  /** `fake`: the node's demo implementation ran (R1.6), so a later real run never reuses a demo result. Absent = real. */
  impl?: 'fake'
  /** The version of the node's demo implementation (`NodeDef.fakeVersion`), only for a demo run: a changed demo is made again. */
  fakeVersion?: number
}

/** sha256 (hex) of a node run: `type@version + params + input fingerprints + seed` (spec R7.1). */
export function nodeFingerprint(input: FingerprintInput): string {
  const { type, params, inputs, seed, notes, settings, impl, fakeVersion } = input
  if (!Number.isSafeInteger(seed)) throw new CanonicalError('seed must be a safe integer', 'seed')
  const body: Record<string, unknown> = { type, params, inputs, seed }
  if (notes && notes.length > 0) body.notes = notes
  if (settings && Object.values(settings).some((v) => v !== undefined)) body.settings = settings
  if (impl) body.impl = impl
  if (impl && fakeVersion) body.fakeVersion = fakeVersion
  return sha256(DOMAIN.node + canonicalJson(body))
}

/** Fingerprint of user-supplied content (pipeline inputs, replaced outputs): a hash of the bytes or of the JSON value. */
export function contentFingerprint(content: { bytes: Uint8Array } | { value: Json }): string {
  if ('bytes' in content) return sha256(Buffer.concat([Buffer.from(DOMAIN.content + 'bytes\n'), content.bytes]))
  return sha256(DOMAIN.content + 'json\n' + canonicalJson(content.value))
}

/** Fingerprint of one output of a node run, derived from the run's fingerprint and the output's name. */
export function outputFingerprint(nodeFp: string, output: string): string {
  return sha256(DOMAIN.output + nodeFp + '\n' + output)
}

/** Fingerprint of a record whose content is already a set of fingerprints (e.g. a node with a replaced output). */
export function compositeFingerprint(label: string, parts: Record<string, string>): string {
  return sha256(DOMAIN.node + canonicalJson({ composite: label, parts }))
}

/** True for a 64-char lowercase hex string, the only form of fingerprint the engine produces. */
export const isFingerprint = (s: string): boolean => /^[0-9a-f]{64}$/.test(s)
