// production-5: the channel voice (`voice.make`). A clone without the consent tick is refused; cloning from a channel's own
// videos needs « this channel is mine » and is proposed until accepted; a voice is cloned on several engines from its kept
// sample; a designed voice speaks a sample before being cloned elsewhere; the runs get the default voice per engine; the
// blind listening test writes A/B files and the key apart. A fake Cloud voice maker, nothing paid.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { ChannelVoices, type VoiceMaker } from '../../src/main/production/voices'
import { bestWindow } from '../../src/main/production/voices/sample'
import { shuffled } from '../../src/main/production/voices/blind-test'
import { writeWav } from '../../src/engine/media/wav'
import { energyEnvelope, probe, speechRegions } from '../../src/engine/media/probe'
import { MEDIA, hasFfmpeg, tempDir } from './engine-node-helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

interface Calls {
  clone: { engine?: string; consent: boolean; fileName: string }[]
  speak: { engine: string; voiceId: string }[]
}
function fakeMaker(dir: string): { maker: VoiceMaker; calls: Calls } {
  const calls: Calls = { clone: [], speak: [] }
  const maker: VoiceMaker = {
    async clone(req) {
      const r = req as { name: string; engine?: string; consent: boolean; fileName: string }
      calls.clone.push({ ...(r.engine ? { engine: r.engine } : {}), consent: r.consent, fileName: r.fileName })
      return { id: `${r.engine ?? 'default'}:${r.name}`, name: r.name, language: 'fr', demo: true, cloned: true }
    },
    async design(_req, into) {
      const file = path.join(into, 'preview-1.wav')
      writeFileSync(file, 'x')
      return { previews: [{ generatedVoiceId: 'gen-1', file, durationS: 3 }], demo: true }
    },
    async keep(req) {
      return { voiceId: `designed-${req.generatedVoiceId}`, demo: true }
    },
    async speak(req, into) {
      calls.speak.push({ engine: req.engine, voiceId: req.voiceId })
      const file = path.join(into, 'spoken.wav')
      writeFileSync(file, 'audio')
      return { file, demo: true }
    }
  }
  void dir
  return { maker, calls }
}

function setup(o: { media?: boolean } = {}) {
  const dir = work('voices')
  const db = openDatabase(':memory:')
  const channelId = Number(db.prepare("INSERT INTO channels (name) VALUES ('Histoire')").run().lastInsertRowid)
  const { maker, calls } = fakeMaker(dir)
  let t = Date.parse('2026-11-01T10:00:00Z')
  const voices = new ChannelVoices({ db, dir, maker, media: o.media && MEDIA ? MEDIA : null, now: () => new Date((t += 1000)) })
  return { db, dir, channelId, voices, calls }
}
const bytes = new Uint8Array([1, 2, 3, 4])
const consent = { granted: true, statement: 'own-voice' as const, by: 'Charlie' }

describe('the consent of decision 0025', () => {
  it('a clone without the tick (or with it unticked) is refused and nothing is sent', async () => {
    const s = setup()
    await expect(s.voices.clone({ channelId: s.channelId, name: 'Marie', fileName: 'a.wav', bytes, consent: undefined as never })).rejects.toThrow(/droits sur cette voix/)
    await expect(s.voices.clone({ channelId: s.channelId, name: 'Marie', fileName: 'a.wav', bytes, consent: { granted: false, statement: 'own-voice' } })).rejects.toThrow(/droits sur cette voix/)
    expect(s.calls.clone).toHaveLength(0)
    expect(s.voices.list(s.channelId)).toEqual([])
  })

  it('a clone with the tick: who and when are stored; the voice is cloned on ai33 only (never an unquoted MiniMax HD clone, #109) and becomes the channel’s', async () => {
    const s = setup()
    const v = await s.voices.clone({ channelId: s.channelId, name: 'Marie', fileName: 'ma-voix.wav', bytes, consent })
    expect(v).toMatchObject({ method: 'clone', source: 'upload', status: 'active', isDefault: true, hasSample: true })
    expect(v.consent).toEqual({ by: 'Charlie', at: '2026-11-01T10:00:01.000Z', statement: 'own-voice' })
    expect(v.clones.map((c) => c.engine)).toEqual(['voice:ai33'])
    expect(s.calls.clone.map((c) => c.engine)).toEqual(['voice:ai33'])
    expect(s.calls.clone.every((c) => c.consent)).toBe(true)
    expect(s.voices.styleFor(s.channelId)).toEqual({ voice: 'voice:ai33:Marie', voices: { 'voice:ai33': 'voice:ai33:Marie' } })
  })

  it('cloning from the channel’s videos needs « this channel is mine »', async () => {
    const s = setup()
    await expect(s.voices.fromChannelVideo({ channelId: s.channelId, name: 'Voix de la chaîne', videoFile: 'x.mp4', consent })).rejects.toThrow(/quelqu’un d’autre/)
    expect(s.calls.clone).toHaveLength(0)
  })

  it('an unknown engine and an engine that cannot clone are refused', async () => {
    const s = setup()
    await expect(s.voices.clone({ channelId: s.channelId, name: 'M', fileName: 'a.wav', bytes, consent, engines: ['voice:nobody'] })).rejects.toThrow(/inconnu/)
    await expect(s.voices.clone({ channelId: s.channelId, name: 'M', fileName: 'a.wav', bytes, consent, engines: [] })).rejects.toThrow(/au moins un moteur/)
  })
})

describe('one voice, several engines', () => {
  it('Charlie’s flow: design on ElevenLabs, keep a preview, then clone it on a cheaper engine from a spoken sample', async () => {
    const s = setup()
    const d = await s.voices.design({ channelId: s.channelId, description: 'Une voix de femme posée et chaleureuse, débit calme.' })
    expect(d.previews).toHaveLength(1)
    const kept = await s.voices.keepDesign({ channelId: s.channelId, description: 'Une voix de femme posée et chaleureuse, débit calme.', generatedVoiceId: 'gen-1', name: 'Conteuse', previewFile: d.previews[0]?.file as string })
    expect(kept).toMatchObject({ method: 'design', status: 'active', isDefault: true, clones: [{ engine: 'voice:elevenlabs-v2', voiceId: 'designed-gen-1' }] })
    expect(kept.consent?.statement).toBe('designed')
    const both = await s.voices.cloneOn(kept.id, 'voice:fish-s2')
    // the designed voice spoke a sample on ElevenLabs first, then that sample was cloned on Fish
    expect(s.calls.speak).toEqual([{ engine: 'voice:elevenlabs-v2', voiceId: 'designed-gen-1' }])
    expect(s.calls.clone).toEqual([{ engine: 'voice:fish-s2', consent: true, fileName: 'sample.wav' }])
    expect(both.clones.map((c) => c.engine)).toEqual(['voice:elevenlabs-v2', 'voice:fish-s2'])
  })

  it('import: a provider voice id on an engine, no clone call', () => {
    const s = setup()
    const v = s.voices.import({ channelId: s.channelId, name: 'Hugo', engine: 'voice:minimax-28-hd', providerVoiceId: 'mm-voice-9' })
    expect(v).toMatchObject({ method: 'import', clones: [{ engine: 'voice:minimax-28-hd', voiceId: 'mm-voice-9', demo: false }], isDefault: true })
    expect(s.calls.clone).toHaveLength(0)
  })

  it('a default voice saved with a bare library id before the fix is spoken as ai33 spells it (essais-marcel)', () => {
    const s = setup()
    s.voices.import({ channelId: s.channelId, name: 'George (voix par défaut)', engine: 'voice:ai33', providerVoiceId: 'JBFqnCBsd6RMkjVDRZzb' })
    expect(s.voices.styleFor(s.channelId)).toEqual({ voice: 'elevenlabs_JBFqnCBsd6RMkjVDRZzb', voices: { 'voice:ai33': 'elevenlabs_JBFqnCBsd6RMkjVDRZzb' } })
  })

  it('statuses: a second voice does not take the default; setDefault and retire move it', async () => {
    const s = setup()
    const a = s.voices.import({ channelId: s.channelId, name: 'A', engine: 'voice:ai33', providerVoiceId: 'clone_1' })
    const b = s.voices.import({ channelId: s.channelId, name: 'B', engine: 'voice:ai33', providerVoiceId: 'clone_2' })
    expect(b.isDefault).toBe(false)
    expect(s.voices.setDefault(b.id).isDefault).toBe(true)
    expect(s.voices.list(s.channelId).map((v) => [v.name, v.isDefault])).toEqual([['B', true], ['A', false]])
    expect(s.voices.retire(b.id)).toMatchObject({ status: 'retired', isDefault: false })
    expect(s.voices.styleFor(s.channelId)).toBeNull() // A is active but no longer the default: the run keeps the Cloud's voice
    expect(() => s.voices.accept(a.id)).toThrow(/pas une proposition/)
  })
})

describe('the blind listening test', () => {
  it('the order is a shuffle from the seed (same seed, same order)', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(shuffled(items, 's1')).toEqual(shuffled(items, 's1'))
    expect([...shuffled(items, 's1')].sort()).toEqual(items)
  })

  it.skipIf(!hasFfmpeg)('demo clones: one tone file per engine named A, B, C, a sheet, and the key apart', { timeout: 60_000 }, async () => {
    const s = setup()
    const v = await s.voices.clone({ channelId: s.channelId, name: 'Marie', fileName: 'a.wav', bytes, consent, engines: ['voice:elevenlabs-v2', 'voice:fish-s2', 'voice:ai33'] })
    await expect(s.voices.blindTest(s.voices.import({ channelId: s.channelId, name: 'Seule', engine: 'voice:ai33', providerVoiceId: 'x' }).id)).rejects.toThrow(/deux moteurs/)
    const r = await s.voices.blindTest(v.id)
    expect(r.demo).toBe(true)
    expect(r.files).toEqual(['A.wav', 'B.wav', 'C.wav'])
    for (const f of [...r.files, 'fiche.txt', 'cle.json']) expect(existsSync(path.join(r.dir, f))).toBe(true)
    const key = JSON.parse(readFileSync(path.join(r.dir, 'cle.json'), 'utf8')) as { key: Record<string, string> }
    expect(Object.keys(key.key)).toEqual(['A', 'B', 'C'])
    expect(Object.values(key.key).sort()).toEqual(['voice:ai33', 'voice:elevenlabs-v2', 'voice:fish-s2'])
    // the sheet never names an engine
    expect(readFileSync(path.join(r.dir, 'fiche.txt'), 'utf8')).not.toMatch(/elevenlabs|fish|ai33|minimax/i)
  })
})

describe('isolating the voice from a channel video', () => {
  it('picks the window of at most 60 s with the most speech', () => {
    const regions = [
      { start: 0, end: 5 },
      { start: 20, end: 30 },
      { start: 31, end: 60 },
      { start: 61, end: 80 }
    ]
    expect(bestWindow(regions, 60)).toMatchObject({ start: 19.8, speechS: 10 + 29 + 19 })
    expect(bestWindow([], 60)).toBeNull()
  })

  it.skipIf(!hasFfmpeg)('cuts 30–60 s of speech from a video file, clones it, and proposes the voice until accepted', { timeout: 90_000 }, async () => {
    const s = setup({ media: true })
    const media = MEDIA as NonNullable<typeof MEDIA>
    // 70 s: speech-like bursts (0.4 s on, 0.15 s off), with 10 s of silence at the start
    const rate = 16_000
    const samples = new Float32Array(rate * 70)
    for (let k = rate * 10; k < samples.length; k++) if ((k / rate) % 0.55 < 0.4) samples[k] = 0.3 * Math.sin((2 * Math.PI * 200 * k) / rate)
    const video = path.join(s.dir, 'chaine.wav')
    await writeWav(video, samples, rate)
    const v = await s.voices.fromChannelVideo({ channelId: s.channelId, name: 'Voix de la chaîne', videoFile: video, consent: { granted: true, statement: 'own-channel' }, engines: ['voice:ai33'] })
    expect(v).toMatchObject({ source: 'channel', status: 'proposed', isDefault: false, hasSample: true })
    expect(s.voices.styleFor(s.channelId)).toBeNull() // a proposed voice never speaks
    // ai33 takes at most 30 s: the sample sent was cut
    expect(s.calls.clone[0]?.fileName).toBe('sample-30s.wav')
    const sample = path.join(s.dir, String(v.id), 'sample.wav')
    const d = (await probe(media, sample, new AbortController().signal)).durationS
    expect(d).toBeGreaterThanOrEqual(30)
    expect(d).toBeLessThanOrEqual(61)
    expect(speechRegions(await energyEnvelope(media, sample, new AbortController().signal)).length).toBeGreaterThan(10)
    const accepted = s.voices.accept(v.id)
    expect(accepted).toMatchObject({ status: 'active', isDefault: true })
    expect(s.voices.styleFor(s.channelId)?.voices).toEqual({ 'voice:ai33': 'voice:ai33:Voix de la chaîne' })
  })

  // 2026-11-03 22:21 UTC, production-equipe: `channelVoices.fromChannelVideo` with no `engines` cloned on MiniMax HD too (USD 1.50,
  // unquoted). The default is ai33 Pro only, on this path as on the upload path; MiniMax is cloned only when named.
  it.skipIf(!hasFfmpeg)('cloning from a channel video with no engine named clones on ai33 only, never on MiniMax HD (#109)', { timeout: 90_000 }, async () => {
    const s = setup({ media: true })
    const rate = 16_000
    const samples = new Float32Array(rate * 70)
    for (let k = rate * 10; k < samples.length; k++) if ((k / rate) % 0.55 < 0.4) samples[k] = 0.3 * Math.sin((2 * Math.PI * 200 * k) / rate)
    const video = path.join(s.dir, 'chaine-defaut.wav')
    await writeWav(video, samples, rate)
    const v = await s.voices.fromChannelVideo({ channelId: s.channelId, name: 'Voix de Marcel', videoFile: video, consent: { granted: true, statement: 'own-channel' } })
    expect(v.clones.map((c) => c.engine)).toEqual(['voice:ai33'])
    expect(s.calls.clone.map((c) => c.engine)).toEqual(['voice:ai33'])
    expect(s.calls.clone.some((c) => /minimax/.test(c.engine ?? ''))).toBe(false)
  })
})
