// A node's outputs against its declaration (docs/ENGINE-SPEC.md R2.2, R11.3): what `run` returned, or what the user
// gave at a gate to replace it, is checked and turned into artefacts with their fingerprints.
import { readFile } from 'node:fs/promises'
import { checkOutputShape, type Artefact, type NodeOutputs } from './artefacts'
import { compositeFingerprint, contentFingerprint, outputFingerprint } from './canonical'
import { EngineError } from './errors'
import type { AnyNodeDef } from './registry'
import type { StoredRun } from './store'

/**
 * Problems with outputs, in English (logs, tests). `partial`: a replacement may give only some outputs, but at least
 * one; a node run must give every declared output and nothing else.
 */
export function outputProblems(def: AnyNodeDef, outputs: NodeOutputs | undefined, partial: boolean): string[] {
  const problems: string[] = []
  const given = outputs && typeof outputs === 'object' ? outputs : {}
  for (const name of Object.keys(given)) if (!Object.hasOwn(def.outputs, name)) problems.push(`undeclared output "${name}"`)
  for (const [name, type] of Object.entries(def.outputs)) {
    const out = given[name]
    if (!out) {
      if (!partial) problems.push(`missing output "${name}"`)
      continue
    }
    const bad = checkOutputShape(type, out)
    if (bad) problems.push(`output "${name}": ${bad}`)
  }
  if (partial && Object.keys(given).length === 0) problems.push('nothing to replace')
  return problems
}

/** The artefacts of a node run whose fingerprint is `fp`, or a permanent `bad_output` error. */
export function runArtefacts(def: AnyNodeDef, fp: string, outputs: NodeOutputs): StoredRun {
  const problems = outputProblems(def, outputs, false)
  if (problems.length > 0) throw new EngineError('bad_output', `${def.type}: ${problems.join('; ')}`)
  const artefacts: Record<string, Artefact> = {}
  for (const [name, type] of Object.entries(def.outputs)) {
    artefacts[name] = { type, fingerprint: outputFingerprint(fp, name), ...(outputs[name] ?? {}) }
  }
  return { fingerprint: fp, outputs: artefacts }
}

/**
 * The user's version of a node's result (R11.3): each given output is fingerprinted by its content (the bytes of
 * its files and its value), the others keep the original's; the record's fingerprint is derived from all of them.
 */
export async function replacementRun(def: AnyNodeDef, original: StoredRun, given: NodeOutputs): Promise<StoredRun> {
  const problems = outputProblems(def, given, true)
  if (problems.length > 0) throw new EngineError('bad_output', problems.join('; '))
  const outputs: Record<string, Artefact> = {}
  const parts: Record<string, string> = { from: original.fingerprint }
  for (const [name, type] of Object.entries(def.outputs)) {
    const out = given[name]
    if (!out) {
      const kept = original.outputs[name]
      if (!kept) throw new EngineError('bad_output', `the original result has no output "${name}"`)
      outputs[name] = kept
      parts[name] = kept.fingerprint
      continue
    }
    let fp: string
    if (out.files && out.files.length > 0) {
      const bytes = await Promise.all(out.files.map((f) => readFile(f)))
      fp = contentFingerprint({ value: [out.value ?? null, ...bytes.map((b) => contentFingerprint({ bytes: b }))] })
    } else fp = contentFingerprint({ value: out.value ?? null })
    outputs[name] = { type, fingerprint: fp, ...out }
    parts[name] = fp
  }
  return { fingerprint: compositeFingerprint('replace', parts), outputs }
}
