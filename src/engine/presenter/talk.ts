// `presenter.talk` v2 inside `avatar.speak@1` (docs/specs/pipeline-avatar.md §2.5 b, decision 0034): the video's presenter
// generated once and cut. The node gives this module its avatar items; it plans the calls (batch.ts), builds each call's
// audio from the voice (the stretches with their handles, a short silence between them), has each call made on ONE engine
// for the whole video (lock.ts), caches each call by its audio's bytes, the engine and the picture, then cuts every shot
// out of its call on the shot's own times (re-cropped when the option « recadrages » asks). The fake draws the call (a
// silhouette whose mouth is the call's own audio, in the framing of the picture) and cuts it the same way.
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { FRAMINGS, PRESENTER_ENGINE_CAN, PRESENTER_ENGINES, PRESENTER_RESOLUTIONS, isPresenterEngine, resolutionFor, type Framing } from '../../shared/presenter-engines'
import { EngineError } from '../errors'
import type { GenItem } from '../formats/editplan'
import { FPS, frameSizeOf, type Aspect } from '../formats/timing'
import { DRAW_VIDEO_VERSION, drawPresenter } from '../media/draw-video'
import { probe } from '../media/probe'
import type { RunCtx } from '../registry'
import { need } from '../services'
import { BT709, COLOUR_TAGS, INTERMEDIATE_ENCODER } from '../render/segments'
import { atomicCopy, atomicWrite, eachLimited, hashOf, progress, scratch, throwIfAborted } from '../nodes/common'
import { BATCH_DEFAULTS, RECROP_ZOOM, framingsOf, planBatches, type BatchPlan } from './batch'
import { talkWithFallback } from './lock'
import { STAND_IN_VERSION, standInCall, standInPicture, type StandIn } from './stand-in'

/** The channel's presenter as the run style carries it (`$style.presenter`, production-7): its pictures and registrations. */
export const PresenterRef = z.object({
  id: z.string().min(1).max(100),
  /** The portrait (the `medium` framing): a file of the presenter's asset. */
  portrait: z.string().min(1).max(1000).optional(),
  /** Extra angles kept by the similarity check (option « plusieurs plans »). */
  angles: z.array(z.object({ framing: z.enum(FRAMINGS), file: z.string().min(1).max(1000) })).max(6).default([]),
  /** The face's id on each engine that registers it. */
  registrations: z.record(z.string(), z.string().min(1).max(200)).default({})
})
export type PresenterRef = z.infer<typeof PresenterRef>

/** `talk`: the batch-and-cut method and its settings (absent: one clip per shot, as before production-7). */
export const TalkParams = z.object({
  /** Audio kept on each side of a stretch. */
  handleS: z.number().min(0).max(1).default(BATCH_DEFAULTS.handleS),
  /** Silence between two stretches of one call. */
  gapS: z.number().min(0).max(1).default(BATCH_DEFAULTS.gapS),
  /** « Continuous » generation: cutaways up to this long between two presenter shots are generated too (0: once, then cut). */
  bridgeS: z.number().min(0).max(30).default(0),
  /** `single` (the portrait), `recrops` (wide / medium / close cut from the one generation), `multi` (the presenter's angles). */
  framing: z.enum(['single', 'recrops', 'multi']).default('single'),
  resolution: z.enum(PRESENTER_RESOLUTIONS).optional(),
  /** A short motion line from the presenter style (empty for an engine that takes none). */
  motion: z.string().max(300).optional()
})
export type TalkParams = z.infer<typeof TalkParams>

/**
 * The longest call asked: the engine's longest generation, and at most 60 s, because the Cloud brings back a provider file of
 * at most 40 MB (`STOCK_MAX_FILE_BYTES`) and a 1080p presenter runs about 4.8 Mbit/s (HeyGen: 66 s fit, Marcel's 162 s call
 * was made and then not downloaded). Calls are priced by the second, so shorter calls cost the same.
 */
const CALL_DOWNLOAD_MAX_S = 60
export function callLimitS(engine: string | undefined | null): number {
  const can = engine && isPresenterEngine(engine) ? PRESENTER_ENGINE_CAN[engine].maxCallS : CALL_DOWNLOAD_MAX_S
  return Math.min(can, CALL_DOWNLOAD_MAX_S)
}

export const PresenterEngineParams = {
  /** The engine the pipeline picked for this brick (its pin). */
  engine: z.enum(PRESENTER_ENGINES).optional(),
  /** Engines that may make the WHOLE presenter instead, in order, if the first fails before any generation exists. */
  fallbacks: z.array(z.enum(PRESENTER_ENGINES)).max(4).optional(),
  presenter: PresenterRef.optional(),
  talk: TalkParams.optional()
}

/** One presenter clip, in the order of the avatar items (`clips.files[file]`). */
export interface TalkClip {
  itemId: string
  file: number
  durationS: number
  width: number
  height: number
  demo: boolean
  startFrame: number
  endFrame: number
  layout: 'full' | 'pip'
  text: string
  /** How the presenter is framed in this shot, the call it was cut from and the engine that made it. */
  framing: Framing
  call: number
  engine: string | null
}

export type AvatarItem = GenItem & { voiceRange: NonNullable<GenItem['voiceRange']> }

interface CallNote {
  demo: boolean
  durationS: number
  width: number
  height: number
  registration?: string
}

const sha256 = async (file: string): Promise<string> => createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 32)
const crf = [...INTERMEDIATE_ENCODER, '-an', '-r', String(FPS)]
/**
 * A mild luma sharpen on every presenter cut (avatar-qualite): HeyGen's 1080p is softer than the reference's presenter (face
 * detail 6.1 against 7.1, a 5×5 Laplacian), and this brings it to 7.4 without halos on 400 % crops. Chroma untouched.
 */
export const PRESENTER_SHARPEN = 'unsharp=5:5:0.35:5:5:0'

export interface TalkInput {
  items: readonly AvatarItem[]
  voice: string
  voiceS: number
  text: (fromS: number, toS: number) => string
  avatarId: string
  engine?: string | undefined
  fallbacks?: readonly string[] | undefined
  presenter?: PresenterRef | undefined
  talk: TalkParams
  parallel: number
  drawn: boolean
  /** A demo's found stand-in (decision 0109): the presenter's photograph instead of the drawn silhouette. */
  standIn?: StandIn | undefined
}

export interface TalkResult {
  clips: { file: string; clip: TalkClip }[]
  plan: BatchPlan
  engine: string | null
  billedS: number
  registrations: Record<string, string>
}

/** The picture each framing speaks from: re-crops all come from the portrait's generation. */
function pictureFor(f: Framing, input: TalkInput): string | undefined {
  if (input.talk.framing !== 'multi' || f === 'medium') return input.presenter?.portrait
  return input.presenter?.angles.find((a) => a.framing === f)?.file ?? input.presenter?.portrait
}

export async function talkBatched(ctx: RunCtx, input: TalkInput): Promise<TalkResult> {
  const media = need(ctx, 'media')
  const dir = await scratch(ctx, 'presenter')
  const cacheDir = await need(ctx, 'workspace').cache('avatar')
  const font = path.join(need(ctx, 'library').root, 'fonts', 'Inter-Bold.ttf')
  const aspect = (input.items[0]?.constraints.aspect ?? '16:9') as Aspect
  const engines = [input.engine, ...(input.fallbacks ?? []).filter((e) => e !== input.engine)]
  const pictures: Framing[] = input.talk.framing === 'multi' ? [...new Set<Framing>(['medium', ...(input.presenter?.angles.map((a) => a.framing) ?? [])])] : ['medium']
  const framings = framingsOf(input.items.length, input.talk.framing, pictures)
  const shots = input.items.map((it, i) => ({
    id: it.id,
    startS: it.voiceRange.startFrame / FPS,
    endS: it.voiceRange.endFrame / FPS,
    // re-crops share the one generation; angles are their own pictures, so their own calls
    source: input.talk.framing === 'multi' ? (framings[i] as Framing) : ('medium' as Framing)
  }))
  const registrations: Record<string, string> = {}
  let billedS = 0
  const standIn = input.drawn ? input.standIn : undefined
  const personMemo = new Map<string, Promise<string | null>>()
  // the picture is this framing's own (an angle, the portrait as medium, a re-crop's whole call): never cut tighter
  const ownPicture = (f: Framing): boolean => input.talk.framing !== 'multi' || f === 'medium' || (input.presenter?.angles.some((a) => a.framing === f) ?? false)

  const { result, engine } = await talkWithFallback(
    engines,
    async (eng, lock) => {
      const maxCallS = callLimitS(eng)
      const plan = planBatches(shots, { handleS: input.talk.handleS, gapS: input.talk.gapS, maxCallS, voiceS: input.voiceS, bridgeS: input.talk.bridgeS })
      const made: { file: string; note: CallNote }[] = new Array(plan.calls.length)
      let done = 0
      // a failure stops the others from starting another paid call and lets the ones in flight finish (and be cached) first
      await eachLimited(plan.calls, input.parallel, async (call, ci) => {
        throwIfAborted(ctx)
        // the call's audio: its pieces of the voice end to end, a silence of gapS between two
        const wav = path.join(dir, `call-${ci + 1}.wav`)
        const parts = call.pieces.map((p, k) => `[0:a]atrim=start=${p.fromS.toFixed(4)}:end=${p.toS.toFixed(4)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=mono[p${k}]`)
        const silence = call.pieces.slice(1).map((_p, k) => `aevalsrc=0:d=${input.talk.gapS.toFixed(4)}:s=44100,aformat=sample_rates=44100:channel_layouts=mono[g${k}]`)
        const chain = call.pieces.map((_p, k) => (k === 0 ? '[p0]' : `[g${k - 1}][p${k}]`)).join('')
        const graph = [...parts, ...silence, `${chain}concat=n=${call.pieces.length * 2 - 1}:v=0:a=1[out]`].join(';')
        await media.run('ffmpeg', ['-v', 'error', '-y', '-i', input.voice, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', wav], { signal: ctx.signal })
        const picture = pictureFor(call.source, input)
        const pictureSha = picture && existsSync(picture) ? await sha256(picture) : null
        // a demo's found stand-in: the picture it speaks from, known before the key (a drawn fallback is never cached as found)
        const still = standIn ? await standInPicture(ctx, { picture, standIn, aspect, dir, memo: personMemo }) : null
        const stillSha = still ? (still === picture ? pictureSha : await sha256(still)) : null
        const avatarId = (eng ? input.presenter?.registrations[eng] : undefined) ?? input.avatarId
        const seconds = Math.max(1, Math.ceil(call.seconds))
        // the pipeline's resolution, or the engine's best below it (a fallback that tops out at 720p still serves)
        const resolution = input.talk.resolution && eng && isPresenterEngine(eng) ? resolutionFor(eng, input.talk.resolution) : input.talk.resolution
        const key = hashOf({
          v: 2,
          audio: await sha256(wav),
          engine: eng ?? null,
          avatarId,
          picture: pictureSha,
          framing: call.source,
          resolution: resolution ?? null,
          motion: input.talk.motion ?? null,
          aspect,
          how: input.drawn ? (still ? `found-${STAND_IN_VERSION}:${stillSha}` : `drawn-${DRAW_VIDEO_VERSION}`) : 'cloud',
          seed: ctx.seed
        })
        const cached = path.join(cacheDir, `${key}.mp4`)
        const noteFile = `${cached}.json`
        let note: CallNote | null = existsSync(cached) ? await readFile(noteFile, 'utf8').then((t) => JSON.parse(t) as CallNote).catch(() => null) : null
        if (!note) {
          const jobDir = path.join(dir, `job-${ci + 1}`)
          await mkdir(jobDir, { recursive: true })
          let src: string
          let demo = true
          let registration: string | undefined
          if (input.drawn && still) {
            src = path.join(jobDir, 'stand-in.mp4')
            await standInCall(media, { picture: still, out: src, seconds: call.seconds, aspect, framing: call.source, ownPicture: still === picture && ownPicture(call.source), signal: ctx.signal })
          } else if (input.drawn) {
            src = path.join(jobDir, 'drawn.mp4')
            await drawPresenter(media, { audio: wav, out: src, seconds: call.seconds, aspect, hash: hashOf({ presenter: input.presenter?.id ?? input.avatarId }), font, label: 'Présentateur de démonstration', framing: call.source, signal: ctx.signal })
          } else {
            const res = await need(ctx, 'cloud').talkingAvatar(
              {
                avatarId,
                audioFile: wav,
                seconds,
                aspect,
                ...(eng ? { engine: eng } : {}),
                ...(picture && pictureSha ? { portraitFile: picture } : {}),
                ...(resolution ? { resolution } : {}),
                ...(input.talk.motion ? { prompt: input.talk.motion } : {})
              },
              { idempotencyKey: `presenter-${key}`, signal: ctx.signal, dir: jobDir }
            )
            const got = res.files[0]
            if (!got) throw new EngineError('internal', `the Cloud returned no presenter video for call ${ci + 1}`)
            src = got
            demo = res.demo
            registration = res.registration
            billedS += seconds
          }
          const info = await probe(media, src, ctx.signal)
          const v = info.streams.find((s) => s.codec_type === 'video')
          note = { demo, durationS: Math.round(info.durationS * 1000) / 1000, width: v?.width ?? 0, height: v?.height ?? 0, ...(registration ? { registration } : {}) }
          await atomicCopy(src, cached)
          await atomicWrite(noteFile, JSON.stringify(note))
        }
        // one generation exists: from now on this video's presenter is this engine's
        lock.produced = true
        if (eng && note.registration) registrations[eng] = note.registration
        made[ci] = { file: cached, note }
        progress(ctx, ++done, plan.calls.length + 1, `présentateur : ${done} génération${done > 1 ? 's' : ''} sur ${plan.calls.length}`)
      })
      return { plan, made }
    },
    (text) => ctx.emit({ kind: 'log', level: 'warn', text })
  )

  // cut every shot out of its call, on the shot's own times
  const [w, h] = frameSizeOf(aspect)
  // a presenter video without colour tags (HeyGen's) is HD video: BT.709. Read as BT.601 (ffmpeg's guess), the skin came out
  // duller (red −5 of 255 on the first real hook, avatar-qualite): the cut says BT.709 and keeps it.
  const untagged = new Map<string, Promise<boolean>>()
  const isUntagged = (file: string): Promise<boolean> => {
    let u = untagged.get(file)
    if (!u) {
      u = probe(media, file, ctx.signal).then((i) => {
        const v = i.streams.find((s) => s.codec_type === 'video')
        return !v?.color_space || v.color_space === 'unknown'
      })
      untagged.set(file, u)
    }
    return u
  }
  const clips: { file: string; clip: TalkClip }[] = []
  for (const [i, item] of input.items.entries()) {
    throwIfAborted(ctx)
    const cut = result.plan.cuts.find((c) => c.shotId === item.id)
    const call = cut ? result.made[cut.call] : undefined
    if (!cut || !call) throw new EngineError('internal', `no presenter call for ${item.id}`)
    const framing = framings[i] as Framing
    const zoom = input.talk.framing === 'recrops' ? RECROP_ZOOM[framing] : 1
    // a re-crop keeps the face: centred across, the upper part down the frame
    const bt709 = await isUntagged(call.file)
    const frame = zoom < 1 ? `crop=iw*${zoom}:ih*${zoom}:(iw-iw*${zoom})/2:(ih-ih*${zoom})*0.3,scale=${w}:${h}:flags=lanczos,setsar=1` : `scale=${w}:${h}:flags=lanczos,setsar=1`
    const vf = `${bt709 ? `${BT709},` : ''}${frame},${PRESENTER_SHARPEN}`
    const out = path.join(dir, `${String(i + 1).padStart(3, '0')}-${item.id}.mp4`)
    const frames = item.voiceRange.endFrame - item.voiceRange.startFrame
    if (cut.offsetS + cut.durationS > call.note.durationS + 2 / FPS) {
      throw new EngineError('internal', `the presenter video of call ${cut.call + 1} is shorter (${call.note.durationS} s) than the shot ${item.id} needs`)
    }
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', cut.offsetS.toFixed(4), '-i', call.file, '-frames:v', String(frames), '-vf', vf, ...crf, ...(bt709 ? COLOUR_TAGS : []), out], { signal: ctx.signal })
    const t0 = item.voiceRange.startFrame / FPS
    clips.push({
      file: out,
      clip: {
        itemId: item.id,
        file: i,
        durationS: Math.round((frames / FPS) * 1000) / 1000,
        width: w,
        height: h,
        demo: call.note.demo,
        startFrame: item.voiceRange.startFrame,
        endFrame: item.voiceRange.endFrame,
        // a split shot is a whole presenter clip until the render composes the picture beside it (production-9)
        layout: item.layout === 'pip' ? 'pip' : 'full',
        text: input.text(t0, t0 + frames / FPS),
        framing,
        call: cut.call,
        engine: engine ?? null
      }
    })
  }
  progress(ctx, 1, 1, `présentateur : ${clips.length} plan${clips.length > 1 ? 's' : ''} coupé${clips.length > 1 ? 's' : ''}`)
  return { clips, plan: result.plan, engine: engine ?? null, billedS, registrations }
}
