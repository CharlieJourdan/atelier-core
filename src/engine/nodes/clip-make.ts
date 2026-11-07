// `clip.make@1` (production-model §2.5, pipeline-avatar §2.7, decision 0035): the generated-video items of the list become clips
// made FROM their still (image to video, the still `visuals.fulfil` made with the style), with gentle, physically plausible
// motion and nothing new appearing. One generation may serve two shots (`sameAs`, `clipShotsPerGeneration` 2): the clip is
// asked for both lengths end to end; the first shot gets its wide beginning, the second a tight crop of the rest, so the pair
// is billed once. Each item tries the pipeline's clip engines in order (refused, failed or past `timeoutS` → the next one);
// when none works the item has no clip and the render shows its still with a slow push (segments.ts), listed, never silent.
// Checks: a blank clip, and with the eyes an object that changes or text that appears, get one regeneration.
// fake (demo): the clip is drawn from the still (a slow zoom with a moving marker), cut the same way.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { clipLengthFor } from '../../shared/visual-engines'
import { EngineError } from '../errors'
import { INTERMEDIATE_ENCODER } from '../render/segments'
import type { NodeOutputs } from '../artefacts'
import { GenList, type GenItem } from '../formats/editplan'
import { FPS, frameSizeOf, type Aspect } from '../formats/timing'
import { DRAW_VIDEO_VERSION, drawClip } from '../media/draw-video'
import { probe } from '../media/probe'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { atomicCopy, atomicWrite, eachLimited, hashOf, progress, readValue, scratch, throwIfAborted } from './common'
import { BLANK_STDDEV, FAILURE_FR, hashDistance, judgeVision, statsOf, type CheckFailure } from './visuals-checks'
import { ClipEngineId, clipEngineOrder, firstThatWorks, withDeadline } from './visuals-engines'
import { Look } from './visuals-look'

export const ClipParams = z.object({
  /** Clips made at once (a clip takes minutes at the provider). */
  parallel: z.number().int().min(1).max(8).default(8),
  engine: ClipEngineId.optional(),
  fallbacks: z.array(ClipEngineId).max(4).optional(),
  /** A clip style (`clip` family): its motion line and negatives. */
  look: Look.optional(),
  /** How long one engine may take for one clip before the next engine takes it (pipeline-avatar §2.7: 15 min). */
  timeoutS: z.number().min(1).max(3600).default(900),
  /** The eyes look at three frames of each clip (an object that changes, text, fingers), when the host has them. */
  vision: z.boolean().optional(),
  /** Short shots on a per-second engine (vrais-tests): a clip of one shot no longer than `shortMaxS`, without a face, goes to this
   *  engine first, at its exact length; its clip gets the drift check (the eyes when the host has them, else the still-versus-clip
   *  hash guard) and one regeneration. */
  shortEngine: ClipEngineId.optional(),
  shortMaxS: z.number().min(1).max(6).default(3),
  /** The pipeline's motion line when the style gives none (avatar@1: its references' steady phone camera, record 0055). */
  motion: z.string().min(1).max(400).optional(),
  /** A demo's stand-ins (decision 0109): `found` makes no drawn clip (the found still takes the shot's camera move in the render). */
  standIns: z.enum(['drawn', 'found']).optional()
})
type Params = z.infer<typeof ClipParams>

const ImagesRecord = z.array(z.object({ itemId: z.string(), file: z.number().int().min(0) }).passthrough())

/** The motion asked of every clip when neither its style nor its pipeline says one (§23 « video from image »). */
export const DEFAULT_MOTION = 'Gentle, physically plausible motion with a slow camera push; the scene stays the same and nothing new appears'
const DEFAULT_NEGATIVE = ['new objects appearing', 'objects changing shape or colour', 'morphing', 'readable text', 'extra fingers']
const ENCODE = [...INTERMEDIATE_ENCODER, '-an']
/** The second shot of a shared clip is this much tighter (a close crop of the same scene). */
const TIGHT = 1.35
/** A face keeps the main engine (Veo holds faces better than the short engine on our benchmark, vrais-tests). */
const FACE = /\b(?:face|faces|portrait|looks? at the camera|eyes)\b/i
/**
 * The still-versus-clip guard of a short-engine clip without the eyes: its late frame shares almost nothing with its start still
 * (a new scene). Measured on 45 benchmark clips (2026-11-01): camera moves alone reach 36 bits of 64, so only a near-total
 * change counts; the eyes are the real drift check.
 */
export const SCENE_CHANGE_BITS = 44

/** The engines of one clip: a short single shot without a face tries the short engine first. */
export function enginesFor(p: { engine?: string | undefined; fallbacks?: readonly string[] | undefined; shortEngine?: string | undefined; shortMaxS?: number | undefined }, totalS: number, shots: number, prompt: string): (string | undefined)[] {
  const base = clipEngineOrder(p)
  const short = p.shortEngine
  if (!short || shots !== 1 || totalS > (p.shortMaxS ?? 3) + 1e-9 || FACE.test(prompt)) return base
  return [short, ...base.filter((e) => e !== short)]
}

/** One clip in the `clips` record (`clips.files[file]`). */
export interface ClipMade {
  itemId: string
  file: number
  durationS: number
  width: number
  height: number
  demo: boolean
  engine?: string
  /** A shared generation: `wide` for its first shot, `tight` for the crop of the second. */
  part?: 'wide' | 'tight'
  fallback?: string
  checks?: string[]
}

/** The prompt of a clip: the scene of its still, then how it moves. */
export function clipPrompt(item: GenItem, look: Look | undefined, pipelineMotion?: string): { prompt: string; negative: string } {
  const scene = item.shot ? `${item.shot.size} of ${item.shot.scene}` : (item.prompt ?? item.context.subject)
  const motion = look?.motion ?? pipelineMotion ?? DEFAULT_MOTION
  const negative = [...new Set([...DEFAULT_NEGATIVE, ...(look?.negative ?? [])])].join(', ').slice(0, 1500)
  return { prompt: `${scene}. ${motion}.`.replace(/\.\./g, '.').slice(0, 4000), negative }
}

const fileHash = async (file: string): Promise<string> => createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 24)

/** One shot's piece of a generation: from `startS`, `durationS` long, cover-scaled (×`zoom` for the tight crop), 30 fps. */
async function cut(ctx: RunCtx, src: string, out: string, o: { startS: number; durationS: number; zoom: number; aspect: Aspect }): Promise<void> {
  const [w, h] = frameSizeOf(o.aspect)
  const zw = Math.round((w * o.zoom) / 2) * 2
  const zh = Math.round((h * o.zoom) / 2) * 2
  await need(ctx, 'media').run(
    'ffmpeg',
    [
      '-v', 'error', '-y', '-ss', o.startS.toFixed(3), '-i', src, '-t', o.durationS.toFixed(3),
      '-vf', `scale=${zw}:${zh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},fps=${FPS},format=yuv420p`,
      ...ENCODE, out
    ],
    { signal: ctx.signal }
  )
}

async function make(ctx: RunCtx, inputs: ResolvedInputs, p: Params, drawn: boolean): Promise<NodeOutputs> {
  const list = readValue(inputs.list, GenList, 'the generation list')
  const record = readValue(inputs.images, ImagesRecord, 'the pictures')
  const stillOf = new Map(record.map((r) => [r.itemId, inputs.images?.files?.[r.file]]))
  // a still the illustration check made again has a new scene (avatar-qualite): the clip moves that scene, not the old one
  const sceneOf = new Map(record.flatMap((r) => (typeof r.scene === 'string' ? [[r.itemId, r.scene] as const] : [])))
  const heads = list.items.filter((it) => it.kind === 'video.gen' && it.sameAs === undefined)
  const tailsOf = (id: string): GenItem[] => list.items.filter((it) => it.sameAs === id)
  const aspect: Aspect = list.items[0]?.constraints.aspect ?? '16:9'
  const [w, h] = frameSizeOf(aspect)
  const dir = await scratch(ctx, 'clips')
  const cacheDir = await need(ctx, 'workspace').cache('clips')
  const warn = (text: string): void => ctx.emit({ kind: 'log', level: 'warn', text })
  const made = new Map<string, ClipMade & { path: string }>()
  const degraded: { itemId: string; reason: string }[] = []
  let billedS = 0
  let done = 0
  await eachLimited(heads, p.parallel, async (head) => {
    throwIfAborted(ctx)
    const tails = tailsOf(head.id)
    const shots = [head, ...tails]
    const still = stillOf.get(head.id)
    if (!still) throw new EngineError('bad_input', `the still of ${head.id} is missing: the pictures brick makes it first`)
    const total = shots.reduce((n, s) => n + s.constraints.durationS, 0)
    const scene = sceneOf.get(head.id)
    const { prompt, negative } = clipPrompt(scene && head.shot ? { ...head, shot: { ...head.shot, scene } } : head, p.look, p.motion)
    const engines = enginesFor(p, total, shots.length, prompt)
    // the whole generation is cached once; its cut pieces are cheap to redo
    const key = hashOf({ v: 1, still: await fileHash(still), prompt, negative, parts: shots.map((s) => s.constraints.durationS), aspect, engines, vision: p.vision === true, how: drawn ? `drawn-${DRAW_VIDEO_VERSION}` : 'cloud', seed: ctx.seed })
    const cached = path.join(cacheDir, `${key}.mp4`)
    const noteFile = `${cached}.json`
    let note: { demo: boolean; engine?: string; fallback?: string; checks?: string[] } | null = existsSync(cached)
      ? await readFile(noteFile, 'utf8').then((t) => JSON.parse(t) as { demo: boolean }).catch(() => null)
      : null
    // a demo clip cached by an earlier run is asked again in a real run (solidite: one demo item marked a real film DÉMO)
    if (note?.demo && !drawn && ctx.services.cloud?.realRun === true) note = null
    if (!note) {
      const jobDir = path.join(dir, `job-${head.id}`)
      await mkdir(jobDir, { recursive: true })
      if (drawn) {
        const tmp = path.join(jobDir, 'drawn.mp4')
        await drawClip(need(ctx, 'media'), { still, out: tmp, seconds: Math.max(1, Math.ceil(total)), aspect, signal: ctx.signal })
        await atomicCopy(tmp, cached)
        note = { demo: true }
      } else {
        const cloud = need(ctx, 'cloud')
        const gen = (engine: string | undefined, tag: string): Promise<{ file: string; demo: boolean; seconds: number }> =>
          withDeadline(ctx.signal, p.timeoutS, engine, async (signal) => {
            const seconds = clipLengthFor(engine, total)
            const res = await cloud.generateVideo(
              { prompt, seconds, aspect, image: still, negative, ...(engine ? { engine } : {}) },
              { idempotencyKey: `clip-${key}${engine ? `-${engine}` : ''}${tag}`, signal, dir: jobDir }
            )
            const file = res.files[0]
            if (!file) throw new EngineError('bad_output', `the Cloud returned no clip for ${head.id}`)
            billedS += seconds
            return { file, demo: res.demo, seconds }
          })
        const got = await firstThatWorks(engines, (engine) => gen(engine, ''), { refusals: 'next', log: (t) => warn(`${head.id}: ${t}`) })
        if (got.value === null) {
          const why = got.tried.map((t) => `${t.engine ?? 'moteur par défaut'} (${t.code === 'refused' ? 'refusé' : t.message})`).join(', ')
          for (const s of shots) degraded.push({ itemId: s.id, reason: `clip impossible : ${why} → l’image avec un mouvement de caméra` })
          progress(ctx, (done += shots.length), list.items.filter((it) => it.kind === 'video.gen').length, `${done} clips`)
          return
        }
        let clip = got.value
        // the checks, then ONE regeneration on the same engine
        // a clip of the short engine gets the drift check: the eyes when the host has them, else the scene-change guard
        const drifting = p.shortEngine !== undefined && got.engine === p.shortEngine
        const judge = async (file: string): Promise<CheckFailure[]> => {
          const len = Math.max(0.1, (await probe(need(ctx, 'media'), file, ctx.signal)).durationS)
          const frames = [0.15, 0.5, 0.85].map((f) => f * len)
          const stats = await Promise.all(frames.map((t) => statsOf(ctx, file, t)))
          const out: CheckFailure[] = stats.some((s) => s.stddev < BLANK_STDDEV) ? ['blank'] : []
          const vision = ctx.services.vision
          if ((p.vision || drifting) && vision) out.push(...judgeVision(await vision.inspect({ files: [file], prompt, kind: 'clip', people: p.look?.people ?? 'anyone' }, ctx.signal), p.look?.people ?? 'anyone'))
          else if (drifting && hashDistance((await statsOf(ctx, still)).dhash, (stats[2] as (typeof stats)[number]).dhash) >= SCENE_CHANGE_BITS) out.push('drift')
          return out
        }
        let failures = await judge(clip.file)
        if (failures.length > 0) {
          warn(`${head.id}: clip check failed (${failures.join(', ')}): generated once more`)
          try {
            clip = await gen(got.engine, '-r1')
            failures = await judge(clip.file)
          } catch (e) {
            if (!(e instanceof EngineError) || e.code === 'budget') throw e
            warn(`${head.id}: the regeneration failed (${e.message}): the first clip is kept`)
          }
        }
        await atomicCopy(clip.file, cached)
        note = {
          demo: clip.demo,
          ...(got.engine ? { engine: got.engine } : {}),
          ...(got.tried.length > 0 ? { fallback: `${got.tried.map((t) => t.engine ?? 'moteur par défaut').join(', ')} en échec → ${got.engine ?? 'moteur par défaut'}` } : {}),
          ...(failures.length > 0 ? { checks: failures.map((f) => FAILURE_FR[f]) } : {})
        }
      }
      await atomicWrite(noteFile, JSON.stringify(note))
    }
    // the pieces: the head from the start (wide), each partner a tight crop of what follows
    const len = (await probe(need(ctx, 'media'), cached, ctx.signal)).durationS
    let at = 0
    for (const [k, s] of shots.entries()) {
      const d = s.constraints.durationS
      const startS = Math.max(0, Math.min(at, len - d))
      const out = path.join(dir, `${s.id}.mp4`)
      if (shots.length === 1) await copyFile(cached, out)
      else await cut(ctx, cached, out, { startS, durationS: Math.min(d, len), zoom: k === 0 ? 1 : TIGHT, aspect })
      at += d
      const info = await probe(need(ctx, 'media'), out, ctx.signal)
      const v = info.streams.find((x) => x.codec_type === 'video')
      made.set(s.id, {
        itemId: s.id,
        file: 0,
        path: out,
        durationS: Math.round(info.durationS * 1000) / 1000,
        width: v?.width ?? w,
        height: v?.height ?? h,
        demo: note.demo,
        ...(note.engine ? { engine: note.engine } : {}),
        ...(shots.length > 1 ? { part: k === 0 ? ('wide' as const) : ('tight' as const) } : {}),
        ...(note.fallback ? { fallback: note.fallback } : {}),
        ...(note.checks ? { checks: note.checks } : {})
      })
    }
    progress(ctx, (done += shots.length), list.items.filter((it) => it.kind === 'video.gen').length, `${done} clips`)
  })
  if (!drawn) ctx.reportCost({ units: [{ unit: 'video_s', qty: billedS }], provider: 'video' })
  if (degraded.length > 0) warn(`${degraded.length} shots without a clip show their still with a camera move (listed in the clips meta)`)
  // the record in the order of the list
  const order = list.items.filter((it) => made.has(it.id)).map((it) => made.get(it.id) as ClipMade & { path: string })
  const records: ClipMade[] = order.map(({ path: _p, ...r }, file) => ({ ...r, file }))
  return {
    clips: {
      files: order.map((r) => r.path),
      value: records as unknown as Json,
      meta: {
        count: records.length,
        generations: heads.filter((h) => made.has(h.id)).length,
        ...(records.length > 0 ? { demo: records.some((r) => r.demo) } : {}),
        ...(degraded.length > 0 ? { degraded: degraded as unknown as Json } : {})
      }
    }
  }
}

export const clipMake = defineNode({
  type: 'clip.make@1',
  inputs: {
    list: { type: 'json.genlist', required: true },
    images: { type: 'media.image[]', required: true }
  },
  outputs: { clips: 'media.clip[]' },
  params: ClipParams,
  executors: ['local'],
  estimate: (ctx) => {
    const meta = ctx.inputs.list?.meta
    const num = (k: string): number => (typeof meta?.[k] === 'number' ? (meta[k] as number) : 0)
    const seconds = num('videoSeconds')
    return { units: seconds > 0 ? [{ unit: 'video_s', qty: seconds }] : [], provider: 'video', durationS: 5 + seconds * 12 }
  },
  run: (ctx, inputs, p) => make(ctx, inputs, p, false),
  // found stand-ins: no drawn clip with its sweeping marker; the render shows each found still with the shot's move (decision 0109)
  fake: (ctx, inputs, p) => (p.standIns === 'found' && inputs.images?.meta?.standIns === 'found' ? Promise.resolve({ clips: { files: [], value: [], meta: { count: 0 } } }) : make(ctx, inputs, p, true))
})
