// The validation hook (ENGINE-SPEC §11; lot P2 proof: a pause at a validation, then the resumption): a gated node
// pauses its branch only, then the user approves, asks for a change (rerun with a new fingerprint) or replaces it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EngineError,
  MemoryArtefactStore,
  MemoryNodeStateStore,
  startRun,
  validatePipeline,
  type Artefact,
  type Run,
  type StartRunOptions
} from '../../src/engine'
import { fakeClock, harness, kindsOf, videoPipeline } from './engine-fakes'

/** The test pipeline with the script under a `review` gate. */
function gatedDoc(): unknown {
  const doc = videoPipeline() as { nodes: Record<string, unknown>[] }
  doc.nodes[1] = { ...doc.nodes[1], gate: 'review' }
  return doc
}

function setup() {
  const h = harness()
  const r = validatePipeline(gatedDoc(), h.registry)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  const store = new MemoryArtefactStore()
  const state = new MemoryNodeStateStore()
  const voiceSaw: Artefact[] = []
  h.behave.set('voice.tts@1', (_ctx, inputs) => {
    voiceSaw.push(inputs.script as Artefact)
    return Promise.resolve({ audio: { files: ['v.wav'] }, words: { value: [] } })
  })
  const start = (over: Partial<StartRunOptions> = {}): Run =>
    startRun({
      plan: r.plan,
      store,
      state,
      scope: 'video-1',
      inputs: { topic: { value: 'Les pyramides' } },
      style: { voice: 'clara' },
      useFakes: true,
      clock: fakeClock(),
      ...over
    })
  return { h, start, voiceSaw, store }
}

const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('gates', () => {
  it('pauses at a validation without blocking the independent branch, then resumes on approval', async () => {
    const { h, start } = setup()
    const run = start()
    await run.idle()
    expect(run.state('script')).toBe('waiting_gate')
    expect(run.state('voice')).toBe('pending') // the branch below the gate waits
    expect(run.state('thumbs')).toBe('done') // the independent branch went on (R6.4)
    expect(h.calls).not.toContain('voice.tts@1')
    const gate = run.events.history().find((e) => e.kind === 'gate')
    expect(gate).toMatchObject({ nodeId: 'script', gate: 'review' })

    run.approve('script')
    await run.idle()
    expect(run.state('script')).toBe('done')
    expect(run.state('package')).toBe('waiting_gate') // the final package: always the owner's
    run.approve('package')
    const res = await run.done
    expect(res.status).toBe('done')
    expect(kindsOf(run.events.history(), 'script')).toEqual(['start', 'progress', 'artefact', 'gate', 'done'])
    expect(() => run.approve('script')).toThrow(/not waiting/)
  })

  it('all at once: review gates are skipped, the owner gate on the package is still asked', async () => {
    const { start } = setup()
    const run = start({ gateMode: 'all' })
    await run.idle()
    expect(run.state('script')).toBe('done')
    expect(run.state('package')).toBe('waiting_gate')
    run.approve('package')
    expect((await run.done).status).toBe('done')
  })

  it('a change request reruns the node with the note (new fingerprint), then everything below it', async () => {
    const { h, start } = setup()
    const run = start()
    await run.idle()
    const first = run.events.history().find((e) => e.kind === 'gate' && e.nodeId === 'script')
    run.requestChange('script', 'plus court, plus de suspense')
    await run.idle()
    expect(run.state('script')).toBe('waiting_gate')
    const second = run.events.history().filter((e) => e.kind === 'gate' && e.nodeId === 'script').at(-1)
    expect(second && 'fingerprint' in second && first && 'fingerprint' in first && second.fingerprint !== first.fingerprint).toBe(true)
    expect(h.calls.filter((c) => c === 'script.write@1')).toHaveLength(2)
    run.approve('script')
    await run.idle()
    run.approve('package')
    await run.done
    // one start only; the rerun is announced as a new attempt
    expect(kindsOf(run.events.history(), 'script')).toEqual(['start', 'progress', 'artefact', 'gate', 'retry', 'progress', 'artefact', 'gate', 'done'])
    expect(run.events.history().find((e) => e.kind === 'retry')).toMatchObject({ code: 'change_requested' })
    expect(h.calls.filter((c) => c === 'voice.tts@1')).toHaveLength(1)
  })

  it('a replaced output becomes the node output; dependents read it; a restart reuses it', async () => {
    const { h, start, voiceSaw } = setup()
    const run = start()
    await run.idle()
    await expect(run.replaceOutput('script', { text: { value: 42 } })).rejects.toBeInstanceOf(EngineError)
    await expect(run.replaceOutput('script', { other: { value: 'x' } })).rejects.toThrow(/undeclared/)
    await run.replaceOutput('script', { text: { value: 'Mon propre script.' } })
    expect(run.state('script')).toBe('done')
    expect(voiceSaw.at(-1)?.value).toBe('Mon propre script.')
    run.approve('package')
    await run.done

    // a new run of the same video: the replacement is reused, nothing runs again
    h.calls.length = 0
    const again = start()
    expect((await again.done).status).toBe('done')
    expect(h.calls).toEqual([])
    expect(again.state('script')).toBe('cached')
  })

  it('a replaced media output is fingerprinted by its bytes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atelier-gate-'))
    tmp.push(dir)
    const h = harness()
    const doc = videoPipeline() as { nodes: Record<string, unknown>[] }
    doc.nodes[2] = { ...doc.nodes[2], gate: 'review' } // the voice
    const r = validatePipeline(doc, h.registry)
    if (!r.ok) throw new Error('invalid')
    const fps: string[] = []
    for (const bytes of ['voix A', 'voix B']) {
      const f = path.join(dir, 'voix.wav')
      writeFileSync(f, bytes)
      const run = startRun({ plan: r.plan, store: new MemoryArtefactStore(), inputs: { topic: { value: 't' } }, style: { voice: 'v' }, useFakes: true, clock: fakeClock() })
      await run.idle()
      await run.replaceOutput('voice', { audio: { files: [f] } })
      const a = run.events.history().filter((e) => e.kind === 'artefact' && e.nodeId === 'voice').at(-1)
      fps.push(a && 'fingerprint' in a ? a.fingerprint : '')
      run.cancel()
      await run.done
    }
    expect(fps[0]).not.toBe(fps[1])
  })

  it('a cancel while waiting at a gate cancels that node', async () => {
    const { start } = setup()
    const run = start()
    await run.idle()
    run.cancel()
    const res = await run.done
    expect(res.status).toBe('cancelled')
    expect(res.states).toMatchObject({ script: 'cancelled', voice: 'cancelled', thumbs: 'done' })
  })
})

describe('in-memory stores keep their own copies', () => {
  it('a caller mutating what it got back does not change the store', async () => {
    const store = new MemoryArtefactStore()
    const fp = 'a'.repeat(64)
    await store.putRun({ fingerprint: fp, outputs: { x: { type: 'text.script', fingerprint: 'b'.repeat(64), value: 'v' } } })
    const got = await store.getRun(fp)
    if (got?.outputs.x) got.outputs.x.value = 'changed'
    expect((await store.getRun(fp))?.outputs.x?.value).toBe('v')
    expect((await store.read('b'.repeat(64)))?.value).toBe('v')
    const state = new MemoryNodeStateStore()
    state.addNote('s', 'n', 'one')
    state.notes('s', 'n').push('two')
    expect(state.notes('s', 'n')).toEqual(['one'])
  })
})
