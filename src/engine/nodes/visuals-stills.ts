// One generated still through Atelier Cloud (`image.make`, production-8, decision 0035): the pipeline's engines in order (per
// item), the references the engine can read, a plainer rewrite after a refusal, the checks with one regeneration, and the
// degraded path (a found still, else a hold of a neighbour picture) when every engine said no. visuals-fulfil.ts calls it.
import path from 'node:path'
import { referencesOf } from '../../shared/visual-engines'
import { EngineError } from '../errors'
import type { GenItem } from '../formats/editplan'
import type { Aspect } from '../formats/timing'
import type { RunCtx } from '../registry'
import { need } from '../services'
import { FAILURE_FR, judgeStats, judgeVision, statsOf, type CheckFailure } from './visuals-checks'
import { firstThatWorks, imageEngineOrder, isModeration } from './visuals-engines'
import type { Composed } from './visuals-look'
import { plainer } from './visuals-look'
import { findStock, type StockCredit } from './visuals-stock'

export interface Sized {
  width: number
  height: number
  aspect: Aspect
}

/** Normalises any picture to a cover-cropped JPEG of the target size. */
export async function toStill(ctx: RunCtx, src: string, out: string, p: Sized): Promise<void> {
  await need(ctx, 'media').run(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', src, '-vf', `scale=${p.width}:${p.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${p.width}:${p.height},format=yuvj444p`, '-frames:v', '1', '-q:v', '2', out],
    { signal: ctx.signal }
  )
}

export interface StillRequest {
  item: GenItem
  composed: Composed
  /** Reference files in priority order (the presenter's portrait, the room, recurring objects' first pictures). */
  references: string[]
  engines: { engine?: string | undefined; fallbacks?: readonly string[] | undefined }
  key: string
  jobDir: string
  /** Where the accepted picture goes (a JPEG of the target size). */
  out: string
  size: Sized
  /** The hashes of the pictures already kept in this video (the near-duplicate check reads and extends it). */
  kept: string[]
  vision: boolean
  people: 'anyone' | 'not-presenter' | 'presenter-as-actor' | 'nobody'
}

export interface StillResult {
  demo: boolean
  engine?: string
  /** Generation jobs and stock searches sent (each is billed). */
  images: number
  searches: number
  degraded?: string
  /** No picture at all: the item holds a neighbour's picture (filled once every item is done). */
  hold?: true
  stock?: StockCredit
  /** Checks still failing after the one regeneration (French), kept in the record. */
  checks?: string[]
  /** References really sent with the kept picture. */
  references?: number
  /** The engines that failed before the one that made it (French, for the record). */
  fallback?: string
}

export async function makeStill(ctx: RunCtx, r: StillRequest): Promise<StillResult> {
  const cloud = need(ctx, 'cloud')
  const log = (text: string): void => ctx.emit({ kind: 'log', level: 'warn', text: `${r.item.id}: ${text}` })
  let images = 0
  let searches = 0
  let sent = 0
  const gen = async (engine: string | undefined, prompt: string, tag: string): Promise<boolean> => {
    const n = referencesOf(engine)
    const refs = n > 0 ? r.references.slice(0, n) : []
    const req = {
      prompt,
      width: r.size.width,
      height: r.size.height,
      ...(engine ? { engine } : {}),
      ...(r.composed.negative ? { negative: r.composed.negative } : {}),
      ...(refs.length > 0 ? { references: refs } : {})
    }
    // the idempotency key of a picture made before engines existed stays what it was
    const res = await cloud.generateImage(req, { idempotencyKey: `image-${r.key}${engine ? `-${engine}` : ''}${tag}`, signal: ctx.signal, dir: r.jobDir })
    images++
    const src = res.files[0]
    if (!src) throw new EngineError('bad_output', `the Cloud returned no image for ${r.item.id}`)
    await toStill(ctx, src, r.out, r.size)
    sent = refs.length
    return res.demo
  }
  const order = imageEngineOrder(r.engines, r.references.length > 0)
  const made = await firstThatWorks(
    order,
    async (engine) => {
      try {
        return await gen(engine, r.composed.prompt, '')
      } catch (e) {
        if (!isModeration(e)) throw e
        // §23 step 5: once in plainer words, on the same engine
        log(`refused by ${engine ?? 'the provider'}: rewritten in plainer words`)
        return await gen(engine, plainer(r.composed.prompt), '-plain')
      }
    },
    { refusals: 'stop', log }
  )
  if (made.value === null) {
    const why = made.tried.at(-1)
    // a found still on the same subject, else the neighbour's picture (never a black slot, never a failed node)
    const query = (r.item.context.keyTerms.slice(0, 3).join(' ') || r.item.context.subject).slice(0, 80)
    try {
      const found = await findStock(ctx, { ...r.item, kind: 'stock.photo' }, query, r.size, { idempotencyKey: `stock-${r.key}-degraded`, dir: r.jobDir })
      searches++
      if (found) {
        await toStill(ctx, found.src, r.out, r.size)
        return { demo: found.demo, images, searches, stock: found.credit, degraded: `image ${why?.code === 'refused' ? 'refusée' : 'impossible'} → photo de banque` }
      }
    } catch (e) {
      if (!(e instanceof EngineError) || e.code === 'budget') throw e
    }
    return { demo: true, images, searches, hold: true, degraded: `image ${why?.code === 'refused' ? 'refusée' : 'impossible'} → plan voisin` }
  }
  let demo = made.value
  const engine = made.engine
  // the checks, then ONE regeneration on the same engine when one fails
  const judge = async (): Promise<{ failures: CheckFailure[]; hash: string }> => {
    const stats = await statsOf(ctx, r.out)
    const failures = judgeStats(stats, r.kept)
    const vision = ctx.services.vision
    if (r.vision && vision) failures.push(...judgeVision(await vision.inspect({ files: [r.out], prompt: r.composed.prompt, kind: 'still', people: r.people }, ctx.signal), r.people))
    return { failures, hash: stats.dhash }
  }
  let verdict = await judge()
  if (verdict.failures.length > 0) {
    log(`check failed (${verdict.failures.join(', ')}): generated once more`)
    const tweak = verdict.failures.includes('duplicate') ? ', a different composition and angle' : verdict.failures.includes('text') ? ', no writing anywhere' : ''
    try {
      demo = await gen(engine, `${r.composed.prompt}${tweak}`.slice(0, 4000), '-r1')
      verdict = await judge()
    } catch (e) {
      if (!(e instanceof EngineError) || e.code === 'budget' || e.code === 'missing_tool') throw e
      log(`the regeneration failed (${e.message}): the first picture is kept`)
    }
  }
  r.kept.push(verdict.hash)
  return {
    demo,
    ...(engine ? { engine } : {}),
    images,
    searches,
    ...(sent > 0 ? { references: sent } : {}),
    ...(verdict.failures.length > 0 ? { checks: verdict.failures.map((f) => FAILURE_FR[f]) } : {}),
    ...(made.tried.length > 0 ? { fallback: `${made.tried.map((t) => t.engine ?? 'moteur par défaut').join(', ')} en échec → ${engine ?? 'moteur par défaut'}` } : {})
  }
}

/** Where a still's job files go. */
export const jobDirOf = (dir: string, item: GenItem): string => path.join(dir, `job-${item.id}`)
