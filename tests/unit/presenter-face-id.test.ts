// The presenter's identity check by face recognition (src/engine/presenter/face-id.ts): its models are fetched once
// and checked against their fingerprint, no Python with OpenCV is `missing_tool`, the verdict's bars, and the angles of a channel
// presenter scored by it on real pictures (a stand-in drawing keeps the skin check, a missing OpenCV falls back to it). Fakes only:
// no Python, no network.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { ChannelPresenters, type PresenterPictures } from '../../src/main/production/presenters'
import { EngineError } from '../../src/engine/errors'
import { FACE_MODELS, FACE_SCRIPT, IDENTITY_KEEP, IDENTITY_REJECT, identityVerdict, localFaceIdentity, type FaceIdentity } from '../../src/engine/presenter/face-id'
import { MEDIA, tempDir } from './engine-node-helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

describe('the local identity check', () => {
  it('fetches each model once, refuses one that does not match its fingerprint, then answers through its JSON files', async () => {
    const dir = work('face-id')
    const fetched: string[] = []
    const bodies = new Map<string, Uint8Array>()
    // the fake models are what the fingerprints say they are: the test swaps the expected hashes for these bodies' hashes
    const original = { y: FACE_MODELS.yunet.sha256, s: FACE_MODELS.sface.sha256 }
    for (const m of Object.values(FACE_MODELS)) bodies.set(m.url, new TextEncoder().encode(`model ${m.file}`))
    ;(FACE_MODELS.yunet as { sha256: string }).sha256 = createHash('sha256').update(bodies.get(FACE_MODELS.yunet.url) as Uint8Array).digest('hex')
    ;(FACE_MODELS.sface as { sha256: string }).sha256 = createHash('sha256').update(bodies.get(FACE_MODELS.sface.url) as Uint8Array).digest('hex')
    try {
      const calls: string[][] = []
      const id = localFaceIdentity({
        platform: 'win32',
        cacheDir: dir,
        python: { file: 'py', args: ['-3.13'] },
        download: async (url) => (fetched.push(url), bodies.get(url) as Uint8Array),
        exec: async (_file, args, env) => {
          calls.push(args)
          if (args.includes('-c')) return
          const input = JSON.parse(readFileSync(env.ATELIER_FACE_IN as string, 'utf8')) as { pairs: [string, string][] }
          writeFileSync(env.ATELIER_FACE_OUT as string, JSON.stringify({ results: input.pairs.map(([, b]) => ({ score: b.includes('other') ? 0.1 : 0.8, facesA: 1, facesB: 1 })) }))
        }
      })
      const signal = new AbortController().signal
      expect(await id.compare([['portrait.png', 'angle.png'], ['portrait.png', 'other.png']], signal)).toEqual([
        { score: 0.8, facesA: 1, facesB: 1 },
        { score: 0.1, facesA: 1, facesB: 1 }
      ])
      await id.compare([['portrait.png', 'angle2.png']], signal)
      expect(fetched).toEqual([FACE_MODELS.yunet.url, FACE_MODELS.sface.url])
      expect(readFileSync(path.join(dir, 'face-id.py'), 'utf8')).toBe(FACE_SCRIPT)
      expect(calls.filter((a) => a.includes('-c'))).toHaveLength(1)
    } finally {
      ;(FACE_MODELS.yunet as { sha256: string }).sha256 = original.y
      ;(FACE_MODELS.sface as { sha256: string }).sha256 = original.s
    }
  })

  it('a model that does not match its fingerprint, or no Python with OpenCV, is missing_tool', async () => {
    const bad = localFaceIdentity({ platform: 'win32', cacheDir: work('face-bad'), python: { file: 'py', args: [] }, download: async () => new TextEncoder().encode('not the model'), exec: async () => undefined })
    await expect(bad.compare([['a', 'b']], new AbortController().signal)).rejects.toMatchObject({ code: 'missing_tool' })
    const none = localFaceIdentity({ platform: 'darwin', cacheDir: work('face-none'), exec: async () => Promise.reject(new Error('no cv2')), download: async () => new Uint8Array() })
    await expect(none.compare([['a', 'b']], new AbortController().signal)).rejects.toBeInstanceOf(EngineError)
  })

  it('the verdict: kept at or above the keep bar, made again between the bars, another person below', () => {
    expect(IDENTITY_KEEP).toBeGreaterThan(IDENTITY_REJECT)
    expect(identityVerdict(0.83)).toBe('keep')
    expect(identityVerdict(IDENTITY_KEEP)).toBe('keep')
    expect(identityVerdict((IDENTITY_KEEP + IDENTITY_REJECT) / 2)).toBe('retry')
    expect(identityVerdict(0.19)).toBe('reject')
    expect(identityVerdict(null)).toBe('reject')
  })
})

describe('the angles of a channel presenter', () => {
  function setup(identity: FaceIdentity | null, demo: boolean) {
    const dir = work('presenters-id')
    const db = openDatabase(':memory:')
    const channelId = Number(db.prepare("INSERT INTO channels (name) VALUES ('Histoire')").run().lastInsertRowid)
    let n = 0
    const engines: (string | undefined)[] = []
    const make = (label: string) => {
      const file = path.join(dir, `${label}-${(n += 1)}.png`)
      writeFileSync(file, `picture ${n}`)
      return { file, demo }
    }
    const pictures: PresenterPictures = { portrait: async () => make('portrait'), edit: async (r) => (engines.push(r.engine), make(r.framing === 'close' ? 'other' : 'same')) }
    const presenters = new ChannelPresenters({ db, dir: path.join(dir, 'presenters'), pictures, media: MEDIA, identity })
    return { channelId, presenters, engines }
  }
  const byName: FaceIdentity = { compare: async (pairs) => pairs.map(([, b]) => ({ score: path.basename(b).startsWith('other') || b.includes('close') ? 0.12 : 0.74, facesA: 1, facesB: 1 })) }

  it('real pictures are scored by face recognition: the same person kept, another dropped after its retry; the engine asked is used', async () => {
    const s = setup(byName, false)
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description: 'A woman in her thirties in a study.' })
    const r = await s.presenters.angles(p.id, { engine: 'image:seedream-50-lite' })
    expect(r.check).toBe('face-id')
    expect(r.engine).toBe('image:seedream-50-lite')
    expect(r.kept.map((a) => [a.framing, a.score])).toEqual([['wide', 0.74], ['medium', 0.74]])
    expect(r.dropped).toEqual([{ framing: 'close', score: 0.12 }])
    expect(new Set(s.engines)).toEqual(new Set(['image:seedream-50-lite']))
    await expect(s.presenters.angles(p.id, { engine: 'image:flux-schnell' })).rejects.toThrow(/Moteur d’image inconnu/)
  })

  it('a stand-in drawing, or a computer without OpenCV, keeps the skin check', async () => {
    const asked: string[] = []
    const spy: FaceIdentity = { compare: async (pairs) => (asked.push(...pairs.map((x) => x[1])), byName.compare(pairs, new AbortController().signal)) }
    const demo = setup(spy, true)
    const p = await demo.presenters.portrait({ channelId: demo.channelId, name: 'Léa', description: 'A woman in her thirties in a study.' })
    expect((await demo.presenters.angles(p.id)).check).toBe('skin')
    expect(asked).toEqual([])
    const missing: FaceIdentity = { compare: async () => Promise.reject(new EngineError('missing_tool', 'no OpenCV')) }
    const real = setup(missing, false)
    const q = await real.presenters.portrait({ channelId: real.channelId, name: 'Léa', description: 'A woman in her thirties in a study.' })
    expect((await real.presenters.angles(q.id)).check).toBe('skin')
  })
})
