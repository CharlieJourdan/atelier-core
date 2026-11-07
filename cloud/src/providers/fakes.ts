// One fake per usage (§4.6), same shape as the real adapters, deterministic, free, offline. Their media are real small
// files (the voice is resources' sample mp3, images are PNGs drawn here) and every output is marked demo by the jobs
// module. `costUsd` is what the real provider would have billed at the current grid's cost, so a demo P&L reads true.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { type StockResult, type Usage, type UsageInput } from '../../../src/shared/cloud-api.ts'
import { isPresenterEngine, PRESENTER_ENGINE_CAN } from '../../../src/shared/presenter-engines.ts'
import { REPO_ROOT } from '../keysource.ts'
import { USAGE_ITEM, type Measure } from '../pricing.ts'
import { sha256Hex } from '../ids.ts'
import type { ProviderAdapter, ProviderContext } from './types.ts'
import { fakeDesignVoice } from './voice-fakes.ts'
import { clipLengthFor } from '../../../src/shared/visual-engines.ts'
import { FAKE_ENGINES } from './engines.ts'

/** The sample media folder. Lot P1 may move it to resources/fake-media/: this constant is the one line to change. */
export const FAKE_MEDIA_DIR = join(REPO_ROOT, 'resources', 'fake-media')
export const FAKE_VOICE_FILE = join(FAKE_MEDIA_DIR, 'voice.mp3')
export const FAKE_VIDEO_FILE = join(FAKE_MEDIA_DIR, 'sample.mp4')
export const FAKE_VOICE_SECONDS = 10

/** How much of each grid item one usage's input consumes. */
export function measureUsage<U extends Usage>(usage: U, input: UsageInput<U>): Measure {
  const i = input as Record<string, unknown>
  switch (usage) {
    case 'synthesize':
      return [{ item: USAGE_ITEM.synthesize, quantity: (i.text as string).length }]
    case 'generateImage':
      return [{ item: USAGE_ITEM.generateImage, quantity: i.count as number }]
    case 'generateVideo':
      return [{ item: USAGE_ITEM.generateVideo, quantity: i.seconds as number }]
    case 'talkingAvatar':
      return [{ item: USAGE_ITEM.talkingAvatar, quantity: i.seconds as number }]
    case 'channelData':
      return [{ item: USAGE_ITEM.channelData, quantity: 1 }]
    case 'analyseVideo':
      return [{ item: USAGE_ITEM.analyseVideo, quantity: i.minutes as number }]
    case 'submitGpuJob':
      return [{ item: USAGE_ITEM.submitGpuJob, quantity: i.estimatedGpuSeconds as number }]
    case 'searchStock':
      return [{ item: USAGE_ITEM.searchStock, quantity: 1 }]
    case 'cloneVoice':
      return [{ item: USAGE_ITEM.cloneVoice, quantity: 1 }]
    case 'designVoice':
      // one request makes the previews; saving one of them costs nothing at the provider (the 1-credit minimum applies)
      return [{ item: USAGE_ITEM.designVoice, quantity: i.keep ? 0 : 1 }]
    default:
      throw new Error(`unknown usage ${String(usage)}`)
  }
}

export const FAKE_VOICES = [
  { id: 'demo-claire', name: 'Claire (démo)', language: 'fr' },
  { id: 'demo-hugo', name: 'Hugo (démo)', language: 'fr' },
  { id: 'demo-ava', name: 'Ava (demo)', language: 'en' }
]

// ---- a tiny PNG encoder (RGB, no filter) -----------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A width×height PNG: a diagonal gradient seeded by `seed`, with a lighter band across the middle (demo look). */
export function drawPng(width: number, height: number, seed: string): Buffer {
  const h = sha256Hex(seed)
  const base = [0, 2, 4].map((o) => parseInt(h.slice(o, o + 2), 16))
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    const band = Math.abs(y - height / 2) < height / 10
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height)
      for (let c = 0; c < 3; c++) {
        const v = Math.round((base[c] as number) * (1 - t) + 40 * t)
        raw[row + 1 + x * 3 + c] = band ? Math.min(255, v + 90) : v
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(2, 9)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const noSecret = (): string => {
  throw new Error('fakes never read the vault')
}
const tick = async (ctx: ProviderContext, steps = 3): Promise<void> => {
  for (let i = 1; i <= steps; i++) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted')
    await new Promise<void>((r) => setImmediate(r))
    ctx.progress(i / steps)
  }
}

/** Fake per-unit costs mirror grid v1 (they only feed the demo P&L). */
export const FAKE_COST_USD = { char: 0.00018, image: 0.02, videoS: 0.05, avatarS: 0.02, minute: 0.01, gpuS: 0.00031, search: 0.002, clone: 1.5 }

export const fakeVoice: ProviderAdapter = {
  id: 'fake-voice',
  kind: 'fake',
  async synthesize(input, ctx) {
    await tick(ctx)
    const words = input.text.split(/\s+/).filter(Boolean)
    const step = FAKE_VOICE_SECONDS / Math.max(words.length, 1)
    const timings = input.wordTimings
      ? words.map((w, i) => ({ word: w, start: +(i * step).toFixed(3), end: +((i + 1) * step).toFixed(3) }))
      : []
    return {
      files: [{ name: 'voice.mp3', mime: 'audio/mpeg', bytes: readFileSync(FAKE_VOICE_FILE) }],
      data: { voiceId: input.voiceId, durationS: FAKE_VOICE_SECONDS, words: timings },
      costUsd: input.text.length * FAKE_COST_USD.char
    }
  }
}

/** What the real engine would have billed for a job that names one (its registry line), else the generic fake price. */
function engineCostUsd(engine: string | undefined, units: { images?: number; seconds?: number }, fallback: number): number {
  const decl = engine ? FAKE_ENGINES.find((e) => e.id === engine) : undefined
  if (!decl) return fallback
  if (decl.unit === 'image') return decl.costUsdPerUnit * (units.images ?? 1)
  if (decl.unit === 'clip') return decl.costUsdPerUnit
  if (decl.unit === 'second') return decl.costUsdPerUnit * clipLengthFor(engine, units.seconds ?? 1)
  return fallback
}

export const fakeImage: ProviderAdapter = {
  id: 'fake-image',
  kind: 'fake',
  async generateImage(input, ctx) {
    // references must be the team's files (an unknown id throws not_found), as with the real adapters
    for (const id of input.referenceArtefactIds ?? []) ctx.artefact(id)
    await tick(ctx)
    // Drawn at a tenth of the size asked (at least 64 px): a demo stand-in, not a render.
    const w = Math.max(64, Math.round(input.width / 10))
    const hgt = Math.max(36, Math.round(input.height / 10))
    const files = Array.from({ length: input.count }, (_, i) => ({
      name: `image-${i + 1}.png`,
      mime: 'image/png',
      bytes: drawPng(w, hgt, `${input.prompt}#${i}`)
    }))
    return {
      files,
      data: {
        width: w,
        height: hgt,
        requested: { width: input.width, height: input.height },
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.referenceArtefactIds ? { references: input.referenceArtefactIds.length } : {})
      },
      costUsd: engineCostUsd(input.engine, { images: input.count }, input.count * FAKE_COST_USD.image)
    }
  }
}

export const fakeVideo: ProviderAdapter = {
  id: 'fake-video',
  kind: 'fake',
  async generateVideo(input, ctx) {
    if (input.imageArtefactId) ctx.artefact(input.imageArtefactId)
    await tick(ctx)
    return {
      files: [{ name: 'clip.mp4', mime: 'video/mp4', bytes: readFileSync(FAKE_VIDEO_FILE) }],
      data: { seconds: 10, requestedSeconds: input.seconds, ...(input.engine ? { engine: input.engine, fromImage: input.imageArtefactId !== undefined } : {}) },
      costUsd: engineCostUsd(input.engine, { seconds: input.seconds }, input.seconds * FAKE_COST_USD.videoS)
    }
  }
}

/** The id a fake registration gets: `fake-look-` and eight hex digits of the portrait artefact's id (same portrait, same look). */
export const fakeLookId = (portraitArtefactId: string): string => `fake-look-${sha256Hex(portraitArtefactId).slice(0, 8)}`

export const fakeAvatar: ProviderAdapter = {
  id: 'fake-avatar',
  kind: 'fake',
  async talkingAvatar(input, ctx) {
    await tick(ctx)
    // a presenter engine that needs its face registered (HeyGen) hands back the registration of the portrait it was given
    const registration = isPresenterEngine(input.engine) && PRESENTER_ENGINE_CAN[input.engine].registration && input.portraitArtefactId ? fakeLookId(input.portraitArtefactId) : null
    return {
      files: [{ name: 'avatar.mp4', mime: 'video/mp4', bytes: readFileSync(FAKE_VIDEO_FILE) }],
      data: {
        avatarId: input.avatarId,
        requestedSeconds: input.seconds,
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(registration ? { registration } : {})
      },
      costUsd: input.seconds * FAKE_COST_USD.avatarS
    }
  }
}

export const fakeChannelData: ProviderAdapter = {
  id: 'fake-channel-data',
  kind: 'fake',
  async channelData(input, ctx) {
    await tick(ctx, 1)
    const seed = sha256Hex(input.url)
    // views mostly fall with age, with a few spikes (index 3 and 8), so the outlier maths has something to find in the demo
    const spike = (i: number): number => (i === 3 ? 6 : i === 8 ? 3.5 : 1)
    const videos = Array.from({ length: Math.min(input.maxVideos, 12) }, (_, i) => ({
      id: `demo${seed.slice(i, i + 7)}`,
      title: `Vidéo de démonstration n° ${i + 1}`,
      views: Math.round((1000 * (12 - i) + parseInt(seed.slice(i, i + 3), 16)) * spike(i)),
      likes: null,
      comments: null,
      durationS: 480 + i * 37,
      publishedAt: new Date(Date.UTC(2026, 8, 30 - i * 6)).toISOString(),
      thumbnailUrl: null
    }))
    return {
      files: [],
      data: { url: input.url, channelId: `UCdemo${seed.slice(0, 18)}`, title: 'Chaîne de démonstration', subscribers: 12_345, totalViews: null, videoCount: videos.length, videos, quotaUnits: 0 },
      costUsd: 0
    }
  }
}

export const fakeAnalysis: ProviderAdapter = {
  id: 'fake-analysis',
  kind: 'fake',
  async analyseVideo(input, ctx) {
    await tick(ctx)
    const total = Math.max(30, Math.round(input.minutes * 60))
    const seed = parseInt(sha256Hex(input.url).slice(0, 4), 16)
    const hooks = ['question', 'promise', 'shock', 'story']
    // the same shape the real eyes return (`analysis`, src/shared/video-analysis.ts), varying a little with the link
    const analysis = {
      summary: 'Analyse de démonstration : narration en voix off, plans courts, musique douce.',
      hook: { text: 'Et si tout ce que vous croyiez savoir était faux ?', endsAtS: 15, technique: hooks[seed % hooks.length] as string },
      structure: [
        { fromS: 0, toS: 15, kind: 'hook' as const, summary: 'Une question qui ouvre le sujet.' },
        { fromS: 15, toS: Math.round(total * 0.85), kind: 'body' as const, summary: 'Le développement, par étapes.' },
        { fromS: Math.round(total * 0.85), toS: total, kind: 'outro' as const, summary: 'La conclusion et l’appel à s’abonner.' }
      ],
      pacing: { cutsPerMinute: 14, tempo: 'medium' as const, notes: 'Une coupe toutes les quatre secondes environ.' },
      shotTypes: ['stock footage', 'b-roll', 'animation', 'on-screen text'],
      onScreenText: [{ atS: 3, text: 'LA VÉRITÉ' }, { atS: 40, text: '1850' }],
      music: { present: true, mood: 'calme', notes: 'Une boucle douce sous la voix.' },
      callsToAction: [{ atS: Math.round(total * 0.9), text: 'Abonne-toi pour la suite.' }]
    }
    return {
      files: [],
      data: {
        url: input.url,
        summary: analysis.summary,
        cutsPerMinute: analysis.pacing.cutsPerMinute,
        segments: [
          { from: 0, to: 15, kind: 'hook' },
          { from: 15, to: Math.round(input.minutes * 60), kind: 'body' }
        ],
        analysis
      },
      costUsd: input.minutes * FAKE_COST_USD.minute
    }
  }
}

export const fakeGpu: ProviderAdapter = {
  id: 'fake-gpu',
  kind: 'fake',
  async submitGpuJob(input, ctx) {
    await tick(ctx)
    return {
      files: [],
      data: { worker: input.worker, gpuSeconds: input.estimatedGpuSeconds, output: 'demo: nothing was rendered' },
      costUsd: input.estimatedGpuSeconds * FAKE_COST_USD.gpuS
    }
  }
}

/** Stock sizes of the demo pictures, by orientation (drawn at a tenth of a real size, like fakeImage). */
const DEMO_STOCK_SIZE = { landscape: [192, 108], portrait: [108, 192], square: [128, 128] } as const

const VIDEO_CLAIM = { landscape: [1280, 720], portrait: [720, 1280], square: [720, 720] } as const

/** Deterministic demo results: the same query always gives the same ones. Photos are drawn PNGs, videos are the sample clip. */
export const fakeStock: ProviderAdapter = {
  id: 'fake-stock',
  kind: 'fake',
  async searchStock(input, ctx) {
    await tick(ctx, 2)
    const seed = sha256Hex(`${input.kind}|${input.orientation}|${input.query}`)
    const [w, h] = DEMO_STOCK_SIZE[input.orientation]
    const files: { name: string; mime: string; bytes: Buffer }[] = []
    const results: StockResult[] = []
    for (let i = 0; i < input.count; i++) {
      const video = input.kind === 'video'
      const name = video ? `stock-${i + 1}.mp4` : `stock-${i + 1}.png`
      files.push(
        video
          ? { name, mime: 'video/mp4', bytes: readFileSync(FAKE_VIDEO_FILE) }
          : { name, mime: 'image/png', bytes: drawPng(w, h, `${seed}#${i}`) }
      )
      results.push({
        id: `demo-${seed.slice(i * 4, i * 4 + 8)}`,
        source: 'demo',
        kind: input.kind,
        title: `${input.query} (démo ${i + 1})`,
        creator: 'Atelier (démo)',
        creatorUrl: null,
        pageUrl: null,
        licence: 'Démo, libre de droits',
        attribution: 'Média de démonstration, Atelier',
        attributionRequired: false,
        // the demo clip is one sample: it claims the size that was asked for (the engine crops to cover anyway)
        width: video ? (VIDEO_CLAIM[input.orientation][0] as number) : w,
        height: video ? (VIDEO_CLAIM[input.orientation][1] as number) : h,
        orientation: input.orientation,
        durationS: video ? 10 : null,
        file: name
      })
    }
    return { files, data: { query: input.query, kind: input.kind, orientation: input.orientation, results }, costUsd: FAKE_COST_USD.search }
  }
}

/** The id a fake clone gets: `clone-` and twelve hex digits of the artefact and the name (and the engine, when the job names
 *  one: each engine has its own clone of a voice), so the same clip and name give the same voice. */
export const fakeCloneId = (audioArtefactId: string, name: string, engine?: string): string =>
  `clone-${sha256Hex(`${audioArtefactId}
${name}${engine ? `
${engine}` : ''}`).slice(0, 12)}`

export const fakeCloneVoice: ProviderAdapter = {
  id: 'fake-clone-voice',
  kind: 'fake',
  async cloneVoice(input, ctx) {
    // the clip must be one of the team's files (an unknown id throws not_found), as with the real adapter
    ctx.artefact(input.audioArtefactId)
    await tick(ctx, 2)
    return {
      files: [],
      data: { voiceId: fakeCloneId(input.audioArtefactId, input.name, input.engine), name: input.name, language: input.language, ...(input.engine ? { engine: input.engine } : {}) },
      costUsd: FAKE_COST_USD.clone
    }
  }
}

export const FAKE_ADAPTERS: Record<Usage, ProviderAdapter> = {
  synthesize: fakeVoice,
  generateImage: fakeImage,
  generateVideo: fakeVideo,
  talkingAvatar: fakeAvatar,
  channelData: fakeChannelData,
  analyseVideo: fakeAnalysis,
  submitGpuJob: fakeGpu,
  searchStock: fakeStock,
  cloneVoice: fakeCloneVoice,
  designVoice: fakeDesignVoice
}

export const fakeContextSecret = noSecret
