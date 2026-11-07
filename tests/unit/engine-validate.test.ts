// `atelier.pipeline/1` validation (ENGINE-SPEC §3, §5; lot P2 proof: a graph with a loop is refused, a wrong type too).
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { NodeRegistry, RegistryError, defineNode, findCycles, validatePipeline, type ValidationError } from '../../src/engine'
import { harness, videoPipeline } from './engine-fakes'

const { registry } = harness()
type Doc = ReturnType<typeof videoPipeline> & { nodes: Record<string, unknown>[] }
const doc = (): Doc => videoPipeline() as Doc
const codes = (errors: ValidationError[]): string[] => errors.map((e) => e.code)
const errorsOf = (d: unknown, opts = {}): ValidationError[] => {
  const r = validatePipeline(d, registry, opts)
  return r.ok ? [] : r.errors
}

describe('validatePipeline', () => {
  it('accepts the example pipeline and orders it topologically, declaration order breaking ties', () => {
    const r = validatePipeline(doc(), registry, { styleFields: ['voice'] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.order).toEqual(['research', 'script', 'voice', 'beats', 'visuals', 'render', 'thumbs', 'package'])
    expect(r.plan.nodes.get('render')?.deps).toEqual(['beats', 'visuals', 'voice'])
    expect(r.plan.nodes.get('package')?.gate).toBe('owner') // the node's default gate
    expect(r.plan.nodes.get('script')?.gate).toBe('none')
  })

  it('refuses a graph with a loop, and names the loop', () => {
    const d = doc()
    // research now reads the script, which reads research: a loop of two
    d.nodes[0] = { id: 'research', type: 'research.topic@1', in: { topic: 'script.text' } }
    const errs = errorsOf(d)
    const cycle = errs.filter((e) => e.code === 'cycle')
    expect(cycle).toHaveLength(1)
    expect(cycle[0]?.message).toContain('research -> script -> research')
    expect(cycle[0]?.path).toEqual(['nodes', 0])
    // the loop also wires a script into a brief port: reported too (every error at once)
    expect(codes(errs)).toContain('type_mismatch')
  })

  it('refuses a node that reads itself', () => {
    const d = doc()
    d.nodes.push({ id: 'loop', type: 'beats.split@1', in: { script: 'script.text', words: 'voice.words', extra: 'loop.beats' } })
    const errs = errorsOf(d)
    // the extra port is unknown, so it is not type-checked; the self-reference is still a loop
    expect(codes(errs).sort()).toEqual(['cycle', 'unknown_port'])
  })

  it('finds every separate loop', () => {
    const deps = new Map([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['c']],
      ['d', ['a']]
    ])
    expect(findCycles(['a', 'b', 'c', 'd'], deps)).toEqual([['a', 'b'], ['c']])
  })

  it('refuses a wrong type: images on an audio input, with the path of the port', () => {
    const d = doc()
    d.nodes[5] = { id: 'render', type: 'render.assemble@1', in: { beats: 'beats.beats', visuals: 'visuals.clips', voice: 'thumbs.images' } }
    expect(errorsOf(d)).toEqual([
      { code: 'type_mismatch', path: ['nodes', 5, 'in', 'voice'], message: 'thumbs.images is image.thumbnail[], input "voice" expects audio.voice' }
    ])
  })

  it('a list type is not its element type, and a pipeline input must fit the port', () => {
    const d = doc()
    d.inputs = [...(d.inputs as unknown[]), { id: 'music', kind: 'audio', label: 'Musique' }]
    d.nodes[2] = { id: 'voice', type: 'voice.tts@1', in: { script: '$inputs.music' } }
    expect(codes(errorsOf(d))).toEqual(['type_mismatch'])
    // a generic file may feed any port
    d.inputs = [...(d.inputs as unknown[]), { id: 'any', kind: 'file', label: 'Fichier' }]
    d.nodes[2] = { id: 'voice', type: 'voice.tts@1', in: { script: '$inputs.any' } }
    expect(errorsOf(d)).toEqual([])
  })

  it('reports every other rule with its stable code', () => {
    const d = doc()
    d.inputs = [...(d.inputs as unknown[]), { id: 'topic', kind: 'text', label: 'Encore' }]
    d.nodes.push({ id: 'script', type: 'script.write@1', in: { brief: 'research.brief' } }) // duplicate id
    d.nodes.push({ id: 'ghost', type: 'nothing.here@1', in: {} }) // unknown type
    d.nodes.push({ id: 'old', type: 'research.topic@9', in: { topic: '$inputs.topic' } }) // unknown version
    d.nodes.push({ id: 'r2', type: 'research.topic@2', in: { topic: '$inputs.nope' } }) // unknown input ref
    d.nodes.push({ id: 'b2', type: 'beats.split@1', in: { script: 'script.text' } }) // missing input "words"
    d.nodes.push({ id: 'b3', type: 'beats.split@1', in: { script: 'nobody.text', words: 'voice.nothing' } }) // unknown node / output
    d.nodes.push({ id: 'v2', type: 'voice.tts@1', in: { script: 'script.text' }, where: 'gpu', params: { speed: 9 } }) // bad where, bad params
    d.nodes.push({ id: 'v3', type: 'voice.tts@1', in: { script: 'script.text', mood: 'script.text' } }) // unknown port
    d.nodes.push({ id: 's2', type: 'script.write@1', in: { brief: '$style.brief' } }) // style refs belong to params
    const errs = errorsOf(d, { styleFields: ['voice'] })
    expect(codes(errs).sort()).toEqual(
      [
        'bad_params',
        'bad_where',
        'duplicate_id',
        'duplicate_id',
        'missing_input',
        'unknown_node_type',
        'unknown_node_type',
        'unknown_port',
        'unknown_ref',
        'unknown_ref',
        'unknown_ref',
        'unknown_ref'
      ].sort()
    )
    for (const e of errs) expect(e.path.length, e.message).toBeGreaterThan(0)
    expect(errs.find((e) => e.code === 'bad_params')?.path).toEqual(['nodes', 14, 'params', 'speed'])
  })

  it('checks params after each mode overlay, and points at the mode that broke them', () => {
    const d = doc()
    d.nodes[4] = { ...d.nodes[4], modes: { qualite_max: { videoShare: 3 }, usage_max: { videoShare: 0 } } }
    expect(errorsOf(d)).toEqual([
      expect.objectContaining({ code: 'bad_params', path: ['nodes', 4, 'modes', 'qualite_max', 'videoShare'] })
    ])
    d.nodes[4] = { ...d.nodes[4], modes: { usage_max: { colour: 'red' } } }
    expect(codes(errorsOf(d))).toEqual(['bad_params'])
  })

  it('checks $style fields when the style is known, and leaves reference values to run time', () => {
    expect(codes(errorsOf(doc(), { styleFields: ['music'] }))).toEqual(['unknown_ref'])
    expect(errorsOf(doc())).toEqual([]) // style not given: references are only checked for their shape
    const d = doc()
    d.nodes[2] = { ...d.nodes[2], params: { voice: '$style.voice', speed: '$style.speed' } } // a number from the style
    expect(errorsOf(d, { styleFields: ['voice', 'speed'] })).toEqual([])
  })

  it('reports shape errors as `schema` with their path', () => {
    const bad = [
      { ...doc(), $schema: 'atelier.pipeline/2' },
      // (9:16 used to be refused: it is the shape of a short now; another shape still is)
      { ...doc(), format: { kind: 'youtube_long', aspect: '4:3', minutes: { default: 1, min: 1, max: 2 } } },
      { ...doc(), format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 50, min: 1, max: 30 } } },
      { ...doc(), nodes: [] },
      { ...doc(), surprise: true },
      { ...doc(), nodes: [{ id: 'a.b', type: 'research.topic@1' }] },
      { ...doc(), nodes: [{ id: 'a', type: 'research.topic', in: {} }] },
      { ...doc(), nodes: [{ id: 'a', type: 'research.topic@1', in: { topic: 'not a ref' } }] },
      'not even an object'
    ]
    for (const d of bad) {
      const errs = errorsOf(d)
      expect(errs.length, JSON.stringify(d).slice(0, 80)).toBeGreaterThan(0)
      expect(new Set(codes(errs))).toEqual(new Set(['schema']))
    }
    expect(errorsOf({ ...doc(), $schema: 'x' })[0]?.path).toEqual(['$schema'])
  })
})

describe('NodeRegistry', () => {
  const base = {
    inputs: {},
    outputs: { brief: 'text.brief' as const },
    params: z.object({}),
    executors: ['local' as const],
    estimate: () => ({ units: [], durationS: 1 }),
    run: () => Promise.resolve({}),
    fake: () => Promise.resolve({})
  }

  it('keeps versions side by side and lists them sorted', () => {
    expect(registry.has('research.topic@1')).toBe(true)
    expect(registry.has('research.topic@2')).toBe(true)
    expect(registry.list().map((d) => d.type).slice(0, 2)).toEqual(['beats.split@1', 'package.youtube@1'])
  })

  it('refuses malformed definitions and a second registration of one version', () => {
    const r = new NodeRegistry([defineNode({ ...base, type: 'a.b@1' })])
    expect(() => r.register(defineNode({ ...base, type: 'a.b@1' }))).toThrow(/already registered/)
    expect(() => r.register(defineNode({ ...base, type: 'a.b' as 'a@1' }))).toThrow(RegistryError)
    expect(() => r.register(defineNode({ ...base, type: 'c@1', outputs: { x: 'audio.wav' as 'audio.voice' } }))).toThrow(/unknown type/)
    expect(() => r.register(defineNode({ ...base, type: 'd@1', executors: [] }))).toThrow(/at least one executor/)
    expect(() => r.register(defineNode({ ...base, type: 'e@1', outputs: {} }))).toThrow(/at least one output/)
    expect(() => r.register(defineNode({ ...base, type: 'f@1', inputs: { 'a.b': { type: 'text.brief', required: true } } }))).toThrow(/port name/)
  })
})
