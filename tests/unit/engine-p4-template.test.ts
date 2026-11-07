// End to end test of the template pipeline of lot P4 (`runTemplate`, src/engine/demo.ts): a topic in, a 16:9 MP4 and its
// package out, in demo mode with the deterministic tone voice. Real ffmpeg; no network, no Claude, no Cloud.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runTemplate, type TemplateRunResult } from '../../src/engine/demo'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { MemoryNodeStateStore } from '../../src/engine/state'
import { FsArtefactStore } from '../../src/engine/store'
import { MEDIA, NO_FULL_FFMPEG, RESOURCES, hasFullFfmpeg, tempDir } from './engine-node-helpers'

const signal = new AbortController().signal
const NODES = ['research', 'script', 'voice', 'beats', 'director', 'visuals', 'captions', 'sound', 'render', 'package']
const TOPIC = 'Le phare de Créac’h, gardien de la mer d’Iroise'

describe.skipIf(!hasFullFfmpeg)(`runTemplate, tone voice (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  const tmp = tempDir('template')
  const store = new FsArtefactStore(path.join(tmp.dir, 'artefacts'))
  const state = new MemoryNodeStateStore()
  const base = { dataDir: tmp.dir, resourcesDir: RESOURCES, topic: TOPIC, minutes: 0.25, store, state, services: { speech: undefined } }
  let first: TemplateRunResult
  let firstWords: { durationS: number; alignment: string }

  beforeAll(async () => {
    first = await runTemplate(base)
    const fp = first.fingerprints.voice as string
    firstWords = ((await store.getRun(fp))?.outputs.words?.meta ?? {}) as typeof firstWords
  }, 300_000)
  afterAll(() => tmp.cleanup())

  it('runs every node to done and writes a 1920x1080 video with one audio stream of the voice’s length', { timeout: 120_000 }, async () => {
    expect(first.errors).toEqual([])
    expect(first.status).toBe('done')
    for (const id of NODES) expect(first.states[id], id).toBe('done')
    expect(first.ran).toEqual(expect.arrayContaining(NODES))
    expect(first.video).not.toBeNull()
    expect(existsSync(first.video as string)).toBe(true)
    const info = await probe(MEDIA as NonNullable<typeof MEDIA>, first.video as string, signal)
    const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
    expect(v).toMatchObject({ width: 1920, height: 1080 })
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
    expect(firstWords.durationS).toBeGreaterThan(0)
    expect(Math.abs(info.durationS - firstWords.durationS)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(info.durationS - 15)).toBeLessThanOrEqual(2.5)
  })

  it('writes the package folder: video, description, captions, metadata and a checklist that says DÉMO', () => {
    const names = first.packageFiles.map((f) => path.basename(f))
    for (const n of ['video.mp4', 'description.txt', 'captions.srt', 'metadata.json', 'checklist.md']) {
      expect(names.some((x) => x.endsWith(n)), n).toBe(true)
    }
    for (const f of first.packageFiles) expect(existsSync(f), f).toBe(true)
    // the store prefixes each stored file with its index (0-video.mp4)
    const by = (n: string): string => first.packageFiles.find((f) => path.basename(f).endsWith(n)) as string
    expect(readFileSync(by('checklist.md'), 'utf8')).toContain('DÉMO')
    const metadata = JSON.parse(readFileSync(by('metadata.json'), 'utf8')) as Record<string, unknown>
    expect(typeof metadata).toBe('object')
    expect(readFileSync(by('description.txt'), 'utf8').trim().length).toBeGreaterThan(0)
    expect(readFileSync(by('captions.srt'), 'utf8')).toMatch(/-->/)
  })

  it('a second run with the same store, state and data folder reuses everything in under 5 s', { timeout: 60_000 }, async () => {
    const again = await runTemplate(base)
    expect(again.status).toBe('done')
    expect(again.ran).toEqual([])
    expect(again.ms).toBeLessThan(5000)
    expect(again.fingerprints).toEqual(first.fingerprints)
    expect(again.video).toBe(first.video)
  })

  it('a style voice change reruns the voice and what follows, never the research or the script', { timeout: 300_000 }, async () => {
    const third = await runTemplate({ ...base, style: { voice: 'demo-hugo' } })
    expect(third.errors).toEqual([])
    expect(third.status).toBe('done')
    expect(third.ran).not.toContain('research')
    expect(third.ran).not.toContain('script')
    expect(third.ran).toContain('voice')
    expect(third.ran).toContain('render')
    expect(third.fingerprints.research).toBe(first.fingerprints.research)
    expect(third.fingerprints.script).toBe(first.fingerprints.script)
    expect(third.fingerprints.voice).not.toBe(first.fingerprints.voice)
    expect(third.fingerprints.render).not.toBe(first.fingerprints.render)
  })
})

describe('runTemplate on a host without ffmpeg', () => {
  it('fails the voice with missing_tool (French, ffmpeg named); the independent branch is done, dependents stay pending', { timeout: 120_000 }, async () => {
    const tmp = tempDir('template-noffmpeg')
    try {
      const r = await runTemplate({ dataDir: tmp.dir, resourcesDir: RESOURCES, topic: TOPIC, minutes: 0.25, services: { speech: undefined, media: undefined } })
      expect(r.status).toBe('error')
      const err = r.errors.find((e) => e.nodeId === 'voice')
      expect(err).toBeDefined()
      expect(err).toMatchObject({ code: 'missing_tool' })
      expect(err?.message).toContain('ffmpeg')
      expect(err?.message).toMatch(/introuvable/)
      expect(r.states.voice).toBe('error')
      expect(r.states.research).toBe('done')
      expect(r.states.script).toBe('done')
      for (const id of ['beats', 'director', 'visuals', 'captions', 'sound', 'render', 'package']) expect(r.states[id], id).toBe('pending')
      expect(r.video).toBeNull()
    } finally {
      tmp.cleanup()
    }
  })
})
