// `avatar.speak` (docs/ENGINE-SPEC.md §23): for each avatar item of the generation list it cuts that stretch out of the voice
// (exactly the shot’s own frames) and gets a talking head from Atelier Cloud, billed by the second and cached per item by the
// audio’s bytes; in demo mode it draws a silhouette whose mouth is the voice’s waveform. Real ffmpeg, a stub Cloud, and the
// local in-process Cloud (its fake Hedra) for the upload and the job. No network but loopback.
import { mkdir } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, Cost } from '../../src/engine'
import { cloudHttpService } from '../../src/engine/cloud-http'
import { EngineError } from '../../src/engine/errors'
import type { GenItem, GenList } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { AvatarParams, avatarSpeak, wordsBetween } from '../../src/engine/nodes/avatar-speak'
import { productionRegistry } from '../../src/engine/nodes'
import { readReusable } from '../../src/engine/nodes/reuse'
import type { CloudService } from '../../src/engine/services'
import { MEDIA, NO_FFMPEG, NO_FULL_FFMPEG, art, hasFfmpeg, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

interface TestCloud {
  app: { listen(o: { host: string; port: number }): Promise<string>; server: { address(): unknown } }
  cloud: {
    db: { prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }
  }
}
const HELPERS = 'helpers'
const { makeCloud, signUpAndIn } = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(): TestCloud
  signUpAndIn(t: TestCloud, p: { credits: number }): Promise<{ teamId: string; accessToken: string }>
}

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}
const ffmpeg = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })

const avatarItem = (id: string, startFrame: number, endFrame: number, over: Partial<GenItem> = {}): GenItem => ({
  id,
  kind: 'avatar',
  constraints: { durationS: (endFrame - startFrame) / 30, aspect: '16:9' },
  context: { beatText: '', subject: 'Présentateur', keyTerms: [] },
  unitPrice: 4,
  units: Math.ceil((endFrame - startFrame) / 30),
  priority: 8,
  shotIds: [`av-${id}`],
  voiceRange: { startFrame, endFrame },
  layout: 'full',
  ...over
})
const stockItem: GenItem = {
  id: 'i-1',
  kind: 'stock.photo',
  query: 'harbor',
  constraints: { durationS: 3, aspect: '16:9' },
  context: { beatText: 'x', subject: 'x', keyTerms: [] },
  unitPrice: 0,
  units: 1,
  priority: 0,
  shotIds: ['s1']
}
const listArt = (items: GenItem[], meta: Record<string, number> = {}): Artefact =>
  art('json.genlist', { value: { items, totals: { credits: 0, items: items.length, byKind: {} }, budget: null } satisfies GenList as never, meta })

/** Forty words, one every half second from 0.25 s: « m0 m1 … ». */
const WORDS: Word[] = Array.from({ length: 40 }, (_, i) => ({ w: `m${i}`, start: 0.25 + i * 0.5, end: 0.6 + i * 0.5, sentence: Math.floor(i / 8), paragraph: 0 }))
const wordsArt = art('json.words', { value: WORDS as never, meta: { durationS: 20, alignment: 'provider', matched: 1, language: 'fr' } })

/** A 20 s voice of seeded noise (deterministic, different at every moment, so each stretch has its own bytes). */
async function voice(file: string, seed = 1): Promise<Artefact> {
  await ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=d=20:c=pink:r=48000:seed=${seed}:a=0.3`, '-c:a', 'flac', file])
  return art('audio.voice', { files: [file], meta: { demo: true } })
}

interface Asked {
  avatarId: string
  seconds: number
  aspect: string
  audioFile: string
  key: string
  audioS: number
  audioRate: number
}
/** A Cloud whose talking heads are ffmpeg test patterns; it probes the audio it is given at the moment it is called. */
function stubCloud(asked: Asked[]): CloudService {
  return {
    synthesize: () => Promise.reject(new Error('not used')),
    generateImage: () => Promise.reject(new Error('not used')),
    generateVideo: () => Promise.reject(new Error('not used')),
    searchStock: () => Promise.reject(new Error('not used')),
    talkingAvatar: async (req, opts) => {
      const a = await probe(media, req.audioFile, signal)
      asked.push({ avatarId: req.avatarId, seconds: req.seconds, aspect: req.aspect, audioFile: req.audioFile, key: opts.idempotencyKey, audioS: a.durationS, audioRate: Number(a.streams.find((s) => s.codec_type === 'audio')?.sample_rate) })
      await mkdir(opts.dir, { recursive: true })
      const file = path.join(opts.dir, 'avatar.mp4')
      await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=640x360:d=${a.durationS.toFixed(2)}:r=25`, '-pix_fmt', 'yuv420p', file])
      return { files: [file], demo: false, credits: 7 }
    }
  }
}
const params = AvatarParams.parse({ avatarId: 'portrait-42' })
const streamOf = async (file: string): Promise<{ v: StreamInfo; audio: number; durationS: number }> => {
  const p = await probe(media, file, signal)
  return { v: p.streams.find((s) => s.codec_type === 'video') as StreamInfo, audio: p.streams.filter((s) => s.codec_type === 'audio').length, durationS: p.durationS }
}

describe('the words a stretch says', () => {
  it('keeps the words whose middle falls inside the stretch', () => {
    expect(wordsBetween(WORDS, 0, 2)).toBe('m0 m1 m2 m3')
    expect(wordsBetween(WORDS, 2, 3)).toBe('m4 m5')
    expect(wordsBetween(WORDS, 100, 110)).toBe('')
  })
})

describe('avatar.speak is a registered node with its ports', () => {
  it('reads the list, the voice and the word times, and gives the clips', () => {
    const def = productionRegistry().get('avatar.speak@1')
    expect(def?.inputs).toMatchObject({ genlist: { type: 'json.genlist', required: true }, voice: { type: 'audio.voice', required: true }, words: { type: 'json.words', required: true } })
    expect(def?.outputs).toEqual({ clips: 'media.clip[]' })
    expect(AvatarParams.parse({})).toEqual({ avatarId: 'atelier-demo', parallel: 3 })
  })

  it('estimates the Cloud’s bill from the list’s meta: the seconds of avatar, nothing when there is none', () => {
    const est = (meta: Record<string, number>) => avatarSpeak.estimate({ where: 'local', budgetMode: 'usage_max', minutes: 1, inputs: { genlist: { type: 'json.genlist', meta } } }, params as never)
    expect(est({ avatarSeconds: 14 })).toMatchObject({ units: [{ unit: 'avatar_s', qty: 14 }], provider: 'avatar' })
    expect(est({}).units).toEqual([{ unit: 'avatar_s', qty: 0 }])
  })
})

describe.skipIf(!hasFfmpeg)(`avatar.speak run (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  const items = [avatarItem('avatar-hook', 0, 150), avatarItem('avatar-outro', 450, 570, { layout: 'pip' })]

  it('cuts exactly the shot’s stretch of the voice, asks the Cloud once per item, and records what each clip says', { timeout: 120_000 }, async () => {
    const dir = work('avatar-run')
    const asked: Asked[] = []
    const costs: Cost[] = []
    const v = await voice(path.join(dir, 'voice.flac'))
    const out = await avatarSpeak.run(makeCtx(testServices(dir, { cloud: stubCloud(asked) }), { costs }), { genlist: listArt([stockItem, ...items]), voice: v, words: wordsArt }, params)
    // two jobs, in the shot’s own seconds (5 s and 4 s), 16:9, the portrait asked, distinct idempotency keys
    expect(asked.map((a) => [a.avatarId, a.seconds, a.aspect]).sort()).toEqual([['portrait-42', 4, '16:9'], ['portrait-42', 5, '16:9']])
    expect(asked.map((a) => Math.round(a.audioS * 10) / 10).sort()).toEqual([4, 5])
    expect(asked.every((a) => a.audioRate === 44100 && a.audioFile.endsWith('.wav') && a.key.startsWith('avatar-'))).toBe(true)
    expect(new Set(asked.map((a) => a.key)).size).toBe(2)
    // the records, in the order of the items, with the layout, the frames and the words said over the clip
    const rec = out.clips?.value as unknown as { itemId: string; file: number; startFrame: number; endFrame: number; layout: string; text: string; demo: boolean; width: number }[]
    expect(rec.map((r) => [r.itemId, r.file, r.startFrame, r.endFrame, r.layout])).toEqual([['avatar-hook', 0, 0, 150, 'full'], ['avatar-outro', 1, 450, 570, 'pip']])
    expect(rec[0]?.text).toBe(wordsBetween(WORDS, 0, 5))
    expect(rec[1]?.text).toBe(wordsBetween(WORDS, 15, 19))
    expect(rec.every((r) => r.demo === false && r.width === 640)).toBe(true)
    expect(out.clips?.files).toHaveLength(2)
    expect(out.clips?.meta).toMatchObject({ count: 2, demo: false })
    // billed by the second of avatar: 5 + 4
    expect(costs).toEqual([{ units: [{ unit: 'avatar_s', qty: 9 }], provider: 'avatar' }])
  })

  it('caches per item by the audio’s bytes: the same voice asks for nothing, another voice asks again', { timeout: 120_000 }, async () => {
    const dir = work('avatar-cache')
    const asked: Asked[] = []
    const services = testServices(dir, { cloud: stubCloud(asked) })
    const v = await voice(path.join(dir, 'voice.flac'))
    const inputs = { genlist: listArt(items), voice: v, words: wordsArt }
    await avatarSpeak.run(makeCtx(services), inputs, params)
    expect(asked).toHaveLength(2)
    const costs: Cost[] = []
    const again = await avatarSpeak.run(makeCtx(services, { costs }), inputs, params)
    expect(asked).toHaveLength(2)
    expect(costs).toEqual([{ units: [{ unit: 'avatar_s', qty: 0 }], provider: 'avatar' }])
    expect(again.clips?.files).toHaveLength(2)
    expect((again.clips?.value as unknown as { width: number }[])[0]?.width).toBe(640)
    // a voice made again says other things at that moment: both clips are asked again; so is another portrait
    const other = await voice(path.join(dir, 'voice2.flac'), 2)
    await avatarSpeak.run(makeCtx(services), { ...inputs, voice: other }, params)
    expect(asked).toHaveLength(4)
    await avatarSpeak.run(makeCtx(services), inputs, AvatarParams.parse({ avatarId: 'portrait-43' }))
    expect(asked).toHaveLength(6)
  })

  it('#115: after a real run the quote’s ledger holds the voice’s seconds, so a retest on that voice is quoted at 0 (another voice or portrait: whole)', { timeout: 120_000 }, async () => {
    const dir = work('avatar-ledger')
    const services = testServices(dir, { cloud: stubCloud([]) })
    const v = await voice(path.join(dir, 'voice.flac'))
    await avatarSpeak.run(makeCtx(services), { genlist: listArt(items), voice: v, words: wordsArt }, params)
    const keyOf = (fingerprint: string, p = params): string => avatarSpeak.reuse?.key({ voice: fingerprint }, p as never) as string
    expect(await readReusable(path.join(dir, 'cache', 'reuse'), 'avatar.speak', keyOf(v.fingerprint))).toEqual({ avatar_s: 9 })
    const other = await voice(path.join(dir, 'voice2.flac'), 2)
    expect(await readReusable(path.join(dir, 'cache', 'reuse'), 'avatar.speak', keyOf(other.fingerprint))).toBeNull()
    expect(await readReusable(path.join(dir, 'cache', 'reuse'), 'avatar.speak', keyOf(v.fingerprint, AvatarParams.parse({ avatarId: 'portrait-43' })))).toBeNull()
    expect(avatarSpeak.reuse?.key({}, params as never)).toBeNull()
  })

  it('a vertical item is asked 9:16; a list without an avatar item answers an empty record and asks nothing', { timeout: 120_000 }, async () => {
    const dir = work('avatar-tall')
    const asked: Asked[] = []
    const v = await voice(path.join(dir, 'voice.flac'))
    const services = testServices(dir, { cloud: stubCloud(asked) })
    await avatarSpeak.run(makeCtx(services), { genlist: listArt([avatarItem('avatar-hook', 0, 90, { constraints: { durationS: 3, aspect: '9:16' } })]), voice: v, words: wordsArt }, params)
    expect(asked.map((a) => a.aspect)).toEqual(['9:16'])
    const none = await avatarSpeak.run(makeCtx(services), { genlist: listArt([stockItem]), voice: v, words: wordsArt }, params)
    expect(none.clips).toEqual({ files: [], value: [], meta: { count: 0 } })
    expect(asked).toHaveLength(1)
  })

  it('an avatar item without its voice range is a bad input, and a failing provider is an error shown', { timeout: 60_000 }, async () => {
    const dir = work('avatar-bad')
    const v = await voice(path.join(dir, 'voice.flac'))
    const noRange = avatarItem('avatar-hook', 0, 90)
    delete noRange.voiceRange
    const e1 = await avatarSpeak.run(makeCtx(testServices(dir, { cloud: stubCloud([]) })), { genlist: listArt([noRange]), voice: v, words: wordsArt }, params).catch((e: unknown) => e)
    expect(e1).toBeInstanceOf(EngineError)
    expect(e1).toMatchObject({ code: 'bad_input' })
    let paid = 0
    const failing: CloudService = {
      ...stubCloud([]),
      talkingAvatar: () => {
        paid++
        return Promise.reject(new EngineError('refused', 'Le fournisseur a échoué : portrait inconnu'))
      }
    }
    const e2 = await avatarSpeak.run(makeCtx(testServices(dir, { cloud: failing })), { genlist: listArt(items), voice: v, words: wordsArt }, AvatarParams.parse({ parallel: 1 })).catch((e: unknown) => e)
    expect(e2).toMatchObject({ code: 'refused', message: 'Le fournisseur a échoué : portrait inconnu' })
    // the first failure stops the node from asking for the second clip
    expect(paid).toBe(1)
    // without a Cloud the node says so in French, before anything is asked
    const e3 = await avatarSpeak.run(makeCtx(testServices(dir)), { genlist: listArt(items), voice: v, words: wordsArt }, params).catch((e: unknown) => e)
    expect(e3).toMatchObject({ code: 'missing_tool' })
  })

  it('through the local Atelier Cloud: the voice is uploaded once, the job is a talkingAvatar, the clip comes back', { timeout: 180_000 }, async () => {
    const dir = work('avatar-cloud')
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1_000_000 })
    await t.app.listen({ host: '127.0.0.1', port: 0 })
    const baseUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`
    const cloud = cloudHttpService({ baseUrl, token: () => p.accessToken, pollMs: 10 })
    const v = await voice(path.join(dir, 'voice.flac'))
    const out = await avatarSpeak.run(makeCtx(testServices(dir, { cloud })), { genlist: listArt([items[0] as GenItem]), voice: v, words: wordsArt }, params)
    const jobs = t.cloud.db.prepare("SELECT usage, state, demo FROM jobs WHERE usage = 'talkingAvatar'").all() as { usage: string; state: string; demo: number }[]
    expect(jobs).toEqual([{ usage: 'talkingAvatar', state: 'succeeded', demo: 1 }])
    // the voice stretch is one upload of the team (an artefact with no job), the clip is the Cloud’s demo clip
    const uploads = t.cloud.db.prepare('SELECT COUNT(*) AS n FROM artefacts WHERE job_id IS NULL').get() as { n: number }
    expect(uploads.n).toBe(1)
    const rec = out.clips?.value as unknown as { demo: boolean }[]
    expect(rec[0]?.demo).toBe(true)
    expect((await streamOf(out.clips?.files?.[0] as string)).v.codec_name).toBe('h264')
  })
})

describe.skipIf(!hasFullFfmpeg)(`avatar.speak fake: a drawn presenter (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  /** The mean absolute difference between two frames of a clip inside a region (w:h:x:y). */
  async function regionDiff(file: string, a: number, b: number, crop: string): Promise<number> {
    const grab = async (t: number): Promise<Buffer> => (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'], { signal })).stdout
    const [x, y] = [await grab(a), await grab(b)]
    let d = 0
    for (let i = 0; i < Math.min(x.length, y.length); i++) d += Math.abs((x[i] as number) - (y[i] as number))
    return d / Math.min(x.length, y.length)
  }

  it('draws a silent 30 fps clip of the stretch’s length whose mouth follows the voice and nothing else moves', { timeout: 180_000 }, async () => {
    const dir = work('avatar-drawn')
    // a voice that speaks for the first 2 s of the stretch and is silent after
    const file = path.join(dir, 'voice.flac')
    await ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:r=48000:seed=3:a=0.5', '-af', "volume='if(lt(t,2),1,0)':eval=frame", '-c:a', 'flac', file])
    const v = art('audio.voice', { files: [file], meta: { demo: true } })
    const out = await avatarSpeak.fake(makeCtx(testServices(dir)), { genlist: listArt([avatarItem('avatar-hook', 0, 120)]), voice: v, words: wordsArt }, params)
    const clip = out.clips?.files?.[0] as string
    const s = await streamOf(clip)
    expect(s.v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264', r_frame_rate: '30/1' })
    expect(s.audio).toBe(0)
    expect(s.durationS).toBeGreaterThan(3.8)
    expect(s.durationS).toBeLessThan(4.3)
    expect(out.clips?.value).toMatchObject([{ itemId: 'avatar-hook', file: 0, demo: true, width: 1920, height: 1080, startFrame: 0, endFrame: 120, layout: 'full' }])
    expect(out.clips?.meta).toMatchObject({ count: 1, demo: true })
    // the mouth: the strip under the eyes differs between a spoken moment and a silent one; the shoulders never move
    const mouth = '200:60:860:470'
    const body = '500:200:710:800'
    expect(await regionDiff(clip, 0.6, 3.2, mouth)).toBeGreaterThan(2)
    expect(await regionDiff(clip, 0.6, 3.2, body)).toBeLessThan(0.5)
    expect(await regionDiff(clip, 2.8, 3.4, mouth)).toBeLessThan(await regionDiff(clip, 0.6, 3.2, mouth))
  })

  it('a vertical presenter is 1080x1920', { timeout: 180_000 }, async () => {
    const dir = work('avatar-drawn-tall')
    const v = await voice(path.join(dir, 'voice.flac'))
    const out = await avatarSpeak.fake(makeCtx(testServices(dir)), { genlist: listArt([avatarItem('avatar-hook', 0, 90, { constraints: { durationS: 3, aspect: '9:16' } })]), voice: v, words: wordsArt }, params)
    expect((await streamOf(out.clips?.files?.[0] as string)).v).toMatchObject({ width: 1080, height: 1920 })
  })
})
