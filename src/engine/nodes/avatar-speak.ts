// `avatar.speak@1` (docs/ENGINE-SPEC.md §23 « avatar », `avatar.talk` there): a talking presenter for the stretches of the film
// the director marked as « avatar » (its hook and its outro by default: an avatar is the dearest item, research note of the old repository:
// BUSINESS-INFRA.md §3.2). For each avatar item of the generation list the node cuts that stretch out of the voice (exactly the
// shot's own frames, so the lips stay on the words the film plays at that moment) and asks Atelier Cloud for a talking head
// driven by that audio (`talkingAvatar`, Hedra): the clip is as long as the stretch. `render.assemble` places the clip full
// frame (it IS the base shot) or in picture-in-picture over the base (the item's `layout`). run: one Cloud job per item, billed
// by the second, cached per item by the audio's own bytes (a changed voice makes the clip again, a changed word elsewhere does
// not). fake (demo): a silhouette whose mouth is the voice's waveform, drawn here, free, the same files and records.
// production-7 (`talk` set, decision 0034): « one generation, then cut » — every shot's stretch joined into as few calls as the
// engine allows, on ONE presenter engine for the whole video, each shot cut back out (src/engine/presenter/).
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { GenList, type GenItem } from '../formats/editplan'
import { FPS, WordsValue, type Word } from '../formats/timing'
import { DRAW_VIDEO_VERSION, drawPresenter } from '../media/draw-video'
import { probe } from '../media/probe'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { PresenterEngineParams, talkBatched } from '../presenter/talk'
import { writeReusable } from './reuse'
import { atomicCopy, atomicWrite, eachLimited, hashOf, progress, readFile0, readValue, scratch, throwIfAborted } from './common'

export const AvatarParams = z.object({
  /**
   * The presenter: the provider's own id of a portrait (for Hedra, an image asset of the user's account). The pipeline's
   * `avatar` input or the channel's default fills it. The demo draws a silhouette whatever it is.
   */
  avatarId: z.string().min(1).max(100).default('atelier-demo'),
  /** Clips asked at once. */
  parallel: z.number().int().min(1).max(3).default(3),
  // production-7: the engine and its fallbacks (the pin), the channel's presenter (`$style.presenter`) and the batch method;
  // all absent: one clip per shot on the Cloud's default provider, exactly as before
  ...PresenterEngineParams,
  /** A demo's stand-ins (decision 0109): `drawn` silhouette (the default) or `found` photograph of the planned presenter type —
   *  the presenter's own picture, else a free stock photo searched with `standInPerson` (presenter/stand-in.ts). */
  standIns: z.enum(['drawn', 'found']).optional(),
  standInPerson: z.string().min(1).max(200).optional()
})
type Params = z.infer<typeof AvatarParams>

/** One avatar clip, in the order of the avatar items (`clips.files[file]`). */
interface AvatarClip {
  itemId: string
  file: number
  durationS: number
  width: number
  height: number
  demo: boolean
  startFrame: number
  endFrame: number
  layout: 'full' | 'pip'
  /** What the voice says over the clip (from the word times). */
  text: string
}

interface CacheNote {
  demo: boolean
  durationS: number
  width: number
  height: number
}

/** The words spoken between two times (seconds): a word belongs to the stretch its middle falls in. */
export function wordsBetween(words: readonly Word[], from: number, to: number): string {
  return words
    .filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 < to)
    .map((w) => w.w)
    .join(' ')
}

const sha256 = async (file: string): Promise<string> => createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 32)

/** The ledger key of a presenter: this exact voice, avatar and engine (the takes in the cache are cut from the voice). */
const reuseKey = (voiceFingerprint: string | undefined, p: Params): string | null => (voiceFingerprint ? hashOf({ voice: voiceFingerprint, avatarId: p.avatarId, engine: p.engine ?? null, talk: p.talk !== undefined }) : null)

/** Tells the quote how many seconds of presenter this voice now has in the cache (issue #115): a retest will not pay them again. */
async function keepReusable(ctx: RunCtx, inputs: ResolvedInputs, p: Params, seconds: number): Promise<void> {
  const key = reuseKey(inputs.voice?.fingerprint, p)
  const root = await need(ctx, 'workspace').cache('reuse')
  if (key && seconds > 0) await writeReusable(root, 'avatar.speak', key, { avatar_s: seconds })
}

async function speak(ctx: RunCtx, inputs: ResolvedInputs, p: Params, drawn: boolean): Promise<NodeOutputs> {
  const list = readValue(inputs.genlist, GenList, 'the generation list')
  const words = readValue(inputs.words, WordsValue, 'the word times')
  const voice = readFile0(inputs.voice, 'the voice')
  const items = list.items.filter((it): it is GenItem & { voiceRange: NonNullable<GenItem['voiceRange']> } => it.kind === 'avatar' && it.voiceRange !== undefined)
  if (list.items.some((it) => it.kind === 'avatar' && !it.voiceRange)) throw new EngineError('bad_input', 'an avatar item has no voice range')
  const empty = { clips: { files: [], value: [], meta: { count: 0 } } }
  if (items.length === 0) return empty
  if (p.talk) {
    // the handles never reach past the voice
    const heard = (await probe(need(ctx, 'media'), voice, ctx.signal)).durationS
    const r = await talkBatched(ctx, {
      items,
      voice,
      voiceS: heard > 0 ? heard : Math.max(...items.map((it) => it.voiceRange.endFrame / FPS), (words.at(-1) as Word).end),
      text: (from, to) => wordsBetween(words, from, to),
      avatarId: p.avatarId,
      engine: p.engine,
      fallbacks: p.fallbacks,
      presenter: p.presenter,
      talk: p.talk,
      parallel: p.parallel,
      drawn,
      ...(drawn && p.standIns === 'found' ? { standIn: { person: p.standInPerson } } : {})
    })
    if (!drawn) ctx.reportCost({ units: [{ unit: 'avatar_s', qty: r.billedS }], provider: 'avatar' })
    if (!drawn) await keepReusable(ctx, inputs, p, r.plan.generatedS)
    return {
      clips: {
        files: r.clips.map((m) => m.file),
        value: r.clips.map((m) => m.clip) as unknown as Json,
        meta: {
          count: r.clips.length,
          demo: r.clips.some((m) => m.clip.demo),
          engine: r.engine,
          calls: r.plan.calls.length,
          generatedS: r.plan.generatedS,
          shownS: r.plan.shownS,
          ...(Object.keys(r.registrations).length > 0 ? { registrations: r.registrations } : {})
        }
      }
    }
  }
  const media = need(ctx, 'media')
  const dir = await scratch(ctx, 'avatar')
  const cacheDir = await need(ctx, 'workspace').cache('avatar')
  const font = path.join(need(ctx, 'library').root, 'fonts', 'Inter-Bold.ttf')
  const made: ({ file: string; clip: AvatarClip } | undefined)[] = new Array(items.length)
  let billedS = 0
  let done = 0
  // a failure stops the others from starting another paid clip and lets the ones in flight finish (and be cached) first
  await eachLimited(items, p.parallel, async (item, i) => {
    throwIfAborted(ctx)
    const t0 = item.voiceRange.startFrame / FPS
    const dur = (item.voiceRange.endFrame - item.voiceRange.startFrame) / FPS
    // exactly the shot's own stretch of the voice: the clip starts with the shot, so the lips follow the words
    const wav = path.join(dir, `${item.id}.wav`)
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t0.toFixed(4), '-t', dur.toFixed(4), '-i', voice, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav], { signal: ctx.signal })
    const seconds = Math.max(1, Math.ceil(dur))
    const key = hashOf({ v: 1, audio: await sha256(wav), avatarId: p.avatarId, aspect: item.constraints.aspect, seconds, how: drawn ? `drawn-${DRAW_VIDEO_VERSION}` : 'cloud', seed: ctx.seed })
    const cached = path.join(cacheDir, `${key}.mp4`)
    const noteFile = `${cached}.json`
    let note: CacheNote | null = existsSync(cached) ? await readFile(noteFile, 'utf8').then((t) => JSON.parse(t) as CacheNote).catch(() => null) : null
    // a demo shot cached by an earlier run is asked again in a real run (solidite)
    if (note?.demo && !drawn && ctx.services.cloud?.realRun === true) note = null
    if (!note) {
      const jobDir = path.join(dir, `job-${item.id}`)
      await mkdir(jobDir, { recursive: true })
      let src: string
      let demo = true
      if (drawn) {
        src = path.join(jobDir, 'drawn.mp4')
        await drawPresenter(media, { audio: wav, out: src, seconds: dur, aspect: item.constraints.aspect, hash: key, font, label: 'Présentateur de démonstration', signal: ctx.signal })
      } else {
        const res = await need(ctx, 'cloud').talkingAvatar({ avatarId: p.avatarId, audioFile: wav, seconds, aspect: item.constraints.aspect }, { idempotencyKey: `avatar-${key}`, signal: ctx.signal, dir: jobDir })
        const got = res.files[0]
        if (!got) throw new EngineError('internal', `the Cloud returned no avatar clip for ${item.id}`)
        src = got
        demo = res.demo
        billedS += seconds
      }
      const info = await probe(media, src, ctx.signal)
      const v = info.streams.find((s) => s.codec_type === 'video')
      note = { demo, durationS: Math.round(info.durationS * 1000) / 1000, width: v?.width ?? 0, height: v?.height ?? 0 }
      await atomicCopy(src, cached)
      await atomicWrite(noteFile, JSON.stringify(note))
    }
    const out = path.join(dir, `${String(i + 1).padStart(3, '0')}-${item.id}.mp4`)
    await copyFile(cached, out)
    made[i] = {
      file: out,
      clip: {
        itemId: item.id,
        file: i,
        durationS: note.durationS,
        width: note.width,
        height: note.height,
        demo: note.demo,
        startFrame: item.voiceRange.startFrame,
        endFrame: item.voiceRange.endFrame,
        // a split shot is a whole presenter clip until the render composes the picture beside it (production-9)
        layout: item.layout === 'pip' ? 'pip' : 'full',
        text: wordsBetween(words, t0, t0 + dur)
      }
    }
    progress(ctx, ++done, items.length, `${done} présentateur${done > 1 ? 's' : ''} sur ${items.length}`)
  })
  if (!drawn) ctx.reportCost({ units: [{ unit: 'avatar_s', qty: billedS }], provider: 'avatar' })
  if (!drawn) await keepReusable(ctx, inputs, p, items.reduce((n, it) => n + Math.max(1, Math.ceil((it.voiceRange.endFrame - it.voiceRange.startFrame) / FPS)), 0))
  const clips = made.filter((m): m is NonNullable<typeof m> => m !== undefined)
  return {
    clips: {
      files: clips.map((m) => m.file),
      value: clips.map((m) => m.clip) as unknown as Json,
      meta: { count: clips.length, demo: clips.some((m) => m.clip.demo) }
    }
  }
}

export const avatarSpeak = defineNode({
  type: 'avatar.speak@1',
  inputs: {
    genlist: { type: 'json.genlist', required: true },
    voice: { type: 'audio.voice', required: true },
    words: { type: 'json.words', required: true }
  },
  outputs: { clips: 'media.clip[]' },
  params: AvatarParams,
  executors: ['local'],
  reuse: { kind: 'avatar.speak', key: (fp, p) => reuseKey(fp.voice, p) },
  // the Cloud bills the seconds of the avatar items; processing takes a good while per second of clip
  estimate: (ctx) => {
    const seconds = ctx.inputs.genlist?.meta?.avatarSeconds
    const s = typeof seconds === 'number' ? seconds : 0
    return { units: [{ unit: 'avatar_s', qty: s }], provider: 'avatar', durationS: 10 + s * 20 }
  },
  run: (ctx, inputs, p) => speak(ctx, inputs, p, false),
  fake: (ctx, inputs, p) => speak(ctx, inputs, p, true)
})
