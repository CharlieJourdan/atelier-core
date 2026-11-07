// Fingerprints (ENGINE-SPEC §7, lot P2 proof): the same input always gives the same fingerprint, checked by
// properties over thousands of random inputs, plus golden values that pin the canonical form on every OS.
import { createHash } from 'node:crypto'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CanonicalError,
  canonicalJson,
  contentFingerprint,
  isFingerprint,
  nodeFingerprint,
  outputFingerprint,
  type FingerprintInput
} from '../../src/engine'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Object keys; `__proto__` is left out (assigning it sets the prototype instead of adding a key). */
const key = (maxLength: number): fc.Arbitrary<string> => fc.string({ unit: 'binary', maxLength }).filter((k) => k !== '__proto__')

/** Any JSON-like value, including `undefined` fields (dropped) and -0 (written 0). */
const jsonish = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string({ unit: 'binary' }),
    fc.array(tie('value'), { maxLength: 5 }),
    fc.dictionary(key(6), fc.option(tie('value'), { nil: undefined }), { maxKeys: 6 })
  )
})).value

/** The same logical value rebuilt with every object's keys inserted in another order. */
function reorder(v: unknown, flip: boolean): unknown {
  if (Array.isArray(v)) return v.map((x) => reorder(x, flip))
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    if (flip) keys.reverse()
    else keys.sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = reorder((v as Record<string, unknown>)[k], !flip)
    return out
  }
  return v
}

const fpInput = fc.record({
  type: fc.constantFrom('voice.tts@1', 'voice.tts@2', 'render.assemble@1', 'x.y@10') as fc.Arbitrary<FingerprintInput['type']>,
  params: fc.dictionary(key(8), jsonish, { maxKeys: 6 }),
  inputs: fc.dictionary(key(8), fc.stringMatching(/^[0-9a-f]{64}$/), { maxKeys: 4 }),
  seed: fc.integer(),
  notes: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined })
})

describe('canonical serialisation', () => {
  it('sorts keys, drops undefined, keeps arrays in order, one form per number', () => {
    expect(canonicalJson({ b: 1, a: [3, 1, { d: undefined, c: -0 }], e: 'é\n', f: 1e21, g: 0.1 })).toBe(
      '{"a":[3,1,{"c":0}],"b":1,"e":"é\\n","f":1e+21,"g":0.1}'
    )
    expect(canonicalJson([undefined, null])).toBe('[null,null]')
    expect(canonicalJson(Object.assign(Object.create(null) as object, { z: true, Z: false }))).toBe('{"Z":false,"z":true}')
  })

  it('refuses what is not plain data rather than guessing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const bad of [NaN, Infinity, 1n, () => 1, Symbol('s'), new Date(0), new Map(), cyclic, { a: { b: [NaN] } }]) {
      expect(() => canonicalJson(bad), String(typeof bad)).toThrow(CanonicalError)
    }
    expect(() => canonicalJson({ a: { b: [NaN] } })).toThrow(/a\.b\[0\]/)
    expect(() => nodeFingerprint({ type: 'a@1', params: {}, inputs: {}, seed: 1.5 })).toThrow(CanonicalError)
  })

  it('golden values: the canonical text and the hashes are pinned (same on every host and OS)', () => {
    const input: FingerprintInput = {
      type: 'voice.tts@1',
      params: { voice: 'clara', speed: 1.25, tags: ['b', 'a'], extra: undefined },
      inputs: { script: 'a'.repeat(64) },
      seed: 7
    }
    const text = `{"inputs":{"script":"${'a'.repeat(64)}"},"params":{"speed":1.25,"tags":["b","a"],"voice":"clara"},"seed":7,"type":"voice.tts@1"}`
    expect(canonicalJson({ type: input.type, params: input.params, inputs: input.inputs, seed: input.seed })).toBe(text)
    expect(nodeFingerprint(input)).toBe(sha(`atelier.node/1\n${text}`))
    expect(nodeFingerprint(input)).toBe('2f7c05b32c9a9cd2d737f69b152090f3dda80ef2db4d983aba392cae83f7be6f')
    expect(contentFingerprint({ value: 'Sujet : les pyramides' })).toBe(sha('atelier.content/1\njson\n"Sujet : les pyramides"'))
    expect(outputFingerprint('f'.repeat(64), 'audio')).toBe(sha(`atelier.output/1\n${'f'.repeat(64)}\naudio`))
    // empty notes are left out: a node without change requests keeps the spec's formula
    expect(nodeFingerprint({ ...input, notes: [] })).toBe(nodeFingerprint(input))
    expect(nodeFingerprint({ ...input, notes: ['plus court'] })).not.toBe(nodeFingerprint(input))
  })
})

describe('fingerprint properties (thousands of random inputs)', () => {
  it('the same logical input always gives the same fingerprint, whatever the key order or copy', () => {
    fc.assert(
      fc.property(fpInput, fc.boolean(), (input, flip) => {
        const a = nodeFingerprint(input)
        const b = nodeFingerprint(reorder(structuredClone(input), flip) as FingerprintInput)
        const c = nodeFingerprint(input)
        return a === b && a === c && isFingerprint(a)
      }),
      { numRuns: 3000, seed: 20261020 }
    )
  })

  it('serialisation is a fixed point: parsing the canonical text and writing it again gives the same text', () => {
    fc.assert(
      fc.property(jsonish, (v) => {
        const text = canonicalJson(v)
        return canonicalJson(JSON.parse(text)) === text
      }),
      { numRuns: 3000, seed: 7 }
    )
  })

  it('different canonical inputs give different fingerprints (params, inputs, seed or version)', () => {
    fc.assert(
      fc.property(fpInput, fpInput, (x, y) => {
        const same = canonicalJson({ ...x, notes: x.notes?.length ? x.notes : undefined }) === canonicalJson({ ...y, notes: y.notes?.length ? y.notes : undefined })
        return same === (nodeFingerprint(x) === nodeFingerprint(y))
      }),
      { numRuns: 3000, seed: 99 }
    )
  })

  // one property per field (review PA finding 9): mutating that field alone always changes the fingerprint
  const hex = fc.stringMatching(/^[0-9a-f]{64}$/)
  const types = ['voice.tts@1', 'voice.tts@2', 'render.assemble@1', 'x.y@10', 'x.y@11'] as const

  it('another type or version always changes the fingerprint', () => {
    fc.assert(
      fc.property(fpInput, fc.constantFrom(...types), (input, type) => {
        fc.pre(type !== input.type)
        return nodeFingerprint(input) !== nodeFingerprint({ ...input, type })
      }),
      { numRuns: 2000, seed: 11 }
    )
  })

  it('changing, adding or removing one param always changes the fingerprint', () => {
    fc.assert(
      fc.property(fpInput, key(8), jsonish, (input, k, value) => {
        const before = Object.hasOwn(input.params, k) ? input.params[k] : undefined
        fc.pre(value !== undefined && (before === undefined || canonicalJson(before) !== canonicalJson(value)))
        const changed = nodeFingerprint({ ...input, params: { ...input.params, [k]: value } })
        if (changed === nodeFingerprint(input)) return false
        // removing a param the node had (a defined one) changes it too
        if (before === undefined) return true
        const rest = { ...input.params }
        delete rest[k]
        return nodeFingerprint({ ...input, params: rest }) !== nodeFingerprint(input)
      }),
      { numRuns: 2000, seed: 12 }
    )
  })

  it('each input: a new artefact on one port, or one port more or less, always changes the fingerprint', () => {
    fc.assert(
      fc.property(fpInput, key(8), hex, (input, port, fp) => {
        fc.pre(!Object.hasOwn(input.inputs, port) || input.inputs[port] !== fp)
        const base = nodeFingerprint(input)
        if (nodeFingerprint({ ...input, inputs: { ...input.inputs, [port]: fp } }) === base) return false
        for (const p of Object.keys(input.inputs)) {
          const rest = { ...input.inputs }
          delete rest[p]
          if (nodeFingerprint({ ...input, inputs: rest }) === base) return false
        }
        return true
      }),
      { numRuns: 2000, seed: 13 }
    )
  })

  it('a new change note, or another run setting the node reads, always changes the fingerprint', () => {
    fc.assert(
      fc.property(fpInput, fc.string(), fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 }), (input, note, a, b) => {
        fc.pre(a !== b)
        const noted = nodeFingerprint({ ...input, notes: [...(input.notes ?? []), note] }) !== nodeFingerprint(input)
        const minutes = nodeFingerprint({ ...input, settings: { minutes: a } }) !== nodeFingerprint({ ...input, settings: { minutes: b } })
        const mode = nodeFingerprint({ ...input, settings: { budgetMode: 'usage_max' } }) !== nodeFingerprint({ ...input, settings: { budgetMode: 'qualite_max' } })
        const declared = nodeFingerprint({ ...input, settings: { minutes: a } }) !== nodeFingerprint(input)
        // no setting read: the formula stays R7.1's
        const none = nodeFingerprint({ ...input, settings: {} }) === nodeFingerprint(input)
        return noted && minutes && mode && declared && none
      }),
      { numRuns: 2000, seed: 14 }
    )
  })

  it('a new seed (regenerate unchanged) always changes the fingerprint', () => {
    fc.assert(
      fc.property(fpInput, fc.integer(), (input, other) => {
        fc.pre(other !== input.seed)
        return nodeFingerprint(input) !== nodeFingerprint({ ...input, seed: other })
      }),
      { numRuns: 2000, seed: 3 }
    )
  })
})
