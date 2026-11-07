// The on-disk artefact store (ENGINE-SPEC R7.3, R7.7): runs keyed by fingerprint, atomic writes, files copied in.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FsArtefactStore, MemoryNodeStateStore, startRun, validatePipeline, type StoredRun } from '../../src/engine'
import { fakeClock, harness, videoPipeline } from './engine-fakes'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'atelier-store-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const FP = '0123456789abcdef'.repeat(4)

function sampleRun(src: string): StoredRun {
  const f = path.join(src, 'voice.wav')
  writeFileSync(f, 'RIFF fake audio')
  return {
    fingerprint: FP,
    outputs: {
      audio: { type: 'audio.voice', fingerprint: 'a'.repeat(64), files: [f], meta: { seconds: 12 } },
      words: { type: 'json.words', fingerprint: 'b'.repeat(64), value: [{ w: 'bonjour', s: 0, e: 0.4 }] }
    }
  }
}

describe('FsArtefactStore', () => {
  it('stores a run under <root>/<fingerprint>/ with its files copied in, and reads it back', async () => {
    const root = path.join(tmp(), 'artefacts')
    const store = new FsArtefactStore(root)
    expect(await store.getRun(FP)).toBeNull()
    const stored = await store.putRun(sampleRun(tmp()))
    const file = stored.outputs.audio?.files?.[0] as string
    expect(file.startsWith(path.join(root, FP))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('RIFF fake audio')
    expect(stored.outputs.words?.value).toEqual([{ w: 'bonjour', s: 0, e: 0.4 }])
    // a fresh instance (a restart) finds it, and then reads artefacts by their own fingerprint
    const again = new FsArtefactStore(root)
    expect(await again.read('b'.repeat(64))).toBeNull() // not learnt yet
    expect((await again.getRun(FP))?.outputs.audio?.meta).toEqual({ seconds: 12 })
    expect((await again.read('b'.repeat(64)))?.type).toBe('json.words')
    expect(readdirSync(root)).toEqual([FP]) // no temporary folder left
  })

  it('a crash before the commit leaves nothing cached and no temporary folder', async () => {
    const root = path.join(tmp(), 'artefacts')
    const store = new FsArtefactStore(root, {
      beforeCommit: () => {
        throw new Error('power cut')
      }
    })
    await expect(store.putRun(sampleRun(tmp()))).rejects.toThrow('power cut')
    expect(await new FsArtefactStore(root).getRun(FP)).toBeNull()
    expect(readdirSync(root)).toEqual([])
  })

  it('an existing run wins over a second write of the same fingerprint', async () => {
    const root = path.join(tmp(), 'artefacts')
    const store = new FsArtefactStore(root)
    await store.putRun(sampleRun(tmp()))
    const other = sampleRun(tmp())
    if (other.outputs.words) other.outputs.words.value = ['different']
    const kept = await store.putRun(other)
    expect(kept.outputs.words?.value).toEqual([{ w: 'bonjour', s: 0, e: 0.4 }])
  })

  it('a damaged record, or one pointing outside its folder, counts as not stored (the node runs again)', async () => {
    const root = path.join(tmp(), 'artefacts')
    const store = new FsArtefactStore(root)
    await store.putRun(sampleRun(tmp()))
    const record = path.join(root, FP, 'run.json')
    writeFileSync(record, '{"fingerprint": "trunc')
    expect(await new FsArtefactStore(root).getRun(FP)).toBeNull()
    expect(existsSync(path.join(root, FP))).toBe(false) // removed, so a new write can commit
    await store.putRun(sampleRun(tmp()))
    const evil = { fingerprint: FP, outputs: { audio: { type: 'audio.voice', fingerprint: 'a'.repeat(64), files: ['../../outside.txt'] } } }
    writeFileSync(record, JSON.stringify(evil))
    expect(await new FsArtefactStore(root).getRun(FP)).toBeNull()
  })

  it('a stored run whose file was deleted counts as not stored, so the node makes it again (solidite)', async () => {
    const root = path.join(tmp(), 'artefacts')
    const store = new FsArtefactStore(root)
    const stored = await store.putRun(sampleRun(tmp()))
    rmSync(stored.outputs.audio?.files?.[0] as string)
    expect(await new FsArtefactStore(root).getRun(FP)).toBeNull()
    expect(existsSync(path.join(root, FP))).toBe(false)
    expect(await store.putRun(sampleRun(tmp()))).toMatchObject({ fingerprint: FP })
    expect(await new FsArtefactStore(root).getRun(FP)).not.toBeNull()
  })

  it('refuses anything but a fingerprint as a folder name', async () => {
    const store = new FsArtefactStore(tmp())
    await expect(store.getRun('../escape')).rejects.toThrow(/not a fingerprint/)
    await expect(store.putRun({ fingerprint: 'A'.repeat(64), outputs: {} })).rejects.toThrow(/not a fingerprint/)
  })

  it('serves a whole run of the scheduler, and a second run is all cached', async () => {
    const h = harness()
    const r = validatePipeline(videoPipeline(), h.registry)
    if (!r.ok) throw new Error('invalid')
    const src = tmp()
    // media outputs must be real files for the disk store
    for (const type of ['voice.tts@1', 'visuals.fulfil@1', 'render.assemble@1', 'thumbnail.make@1', 'package.youtube@1'] as const) {
      h.behave.set(type, () => {
        const f = path.join(src, `${type.replace(/[^a-z]/g, '')}.bin`)
        writeFileSync(f, type)
        const outs: Record<string, Record<string, Record<string, unknown>>> = {
          'voice.tts@1': { audio: { files: [f] }, words: { value: [] } },
          'visuals.fulfil@1': { clips: { files: [f, f] } },
          'render.assemble@1': { video: { files: [f] } },
          'thumbnail.make@1': { images: { files: [f] } },
          'package.youtube@1': { pack: { value: { title: 'T' }, files: [f] } }
        }
        return Promise.resolve(outs[type] as never)
      })
    }
    const store = new FsArtefactStore(path.join(tmp(), 'artefacts'))
    const opts = { plan: r.plan, store, scope: 'v', inputs: { topic: { value: 't' } }, style: { voice: 'v' }, useFakes: true, clock: fakeClock(), gateMode: 'all' as const }
    const state = new MemoryNodeStateStore()
    const run = startRun({ ...opts, state })
    await run.idle()
    run.approve('package')
    expect((await run.done).status).toBe('done')
    expect(readdirSync(store.root)).toHaveLength(8)
    h.calls.length = 0
    const again = startRun({ ...opts, state })
    expect((await again.done).status).toBe('done')
    expect(h.calls).toEqual([])
    expect(existsSync(path.join(store.root, readdirSync(store.root)[0] as string, 'run.json'))).toBe(true)
  })
})
