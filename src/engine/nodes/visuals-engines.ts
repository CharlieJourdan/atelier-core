// Which engine makes a still or a clip, and what happens when it fails (production-model R3.3–R3.4, pipeline-avatar §2.6–§2.7,
// decision 0035). Stills and clips are not a consistency class: each ITEM falls back on its own to the next engine of the
// pipeline's list. A still refused by moderation is rewritten once in plainer words on the SAME engine (ENGINE-SPEC §23 step 5:
// a refusal is never shopped around), then degraded; a provider that is down or slow sends the item to the next engine. A
// clip refused, failed or past its timeout (15 min by default) goes to the next engine, then becomes the still with a camera
// move. Money (`budget`), a missing service or a broken request stop the node as before.
import { z } from 'zod'
import { referencesOf } from '../../shared/visual-engines'
import { EngineError, isAbortError } from '../errors'

export const ImageEngineId = z.string().regex(/^image:[a-z0-9][a-z0-9.-]{0,60}$/)
export const ClipEngineId = z.string().regex(/^clip:[a-z0-9][a-z0-9.-]{0,60}$/)

/** The engines one image item tries, in order. Absent pin: the Cloud's default provider (`undefined`), as before engines. */
export function imageEngineOrder(p: { engine?: string | undefined; fallbacks?: readonly string[] | undefined }, wantsReferences: boolean): (string | undefined)[] {
  if (!p.engine) return [undefined]
  const list = [...new Set([p.engine, ...(p.fallbacks ?? [])])]
  // a picture that keeps a reference (the presenter's portrait, the room, a recurring object) goes first to the engines
  // that can read one; the others still serve it, without the reference, if all of those fail
  return wantsReferences ? [...list.filter((e) => referencesOf(e) > 0), ...list.filter((e) => referencesOf(e) === 0)] : list
}

export function clipEngineOrder(p: { engine?: string | undefined; fallbacks?: readonly string[] | undefined }): (string | undefined)[] {
  return p.engine ? [...new Set([p.engine, ...(p.fallbacks ?? [])])] : [undefined]
}

export class EngineTimeout extends EngineError {
  constructor(engine: string | undefined, seconds: number) {
    super('transient', `${engine ?? 'le fournisseur'} n’a pas rendu son travail en ${Math.round(seconds / 60)} min`)
  }
}

/**
 * Runs `work` with its own deadline: the signal it gets aborts when the run is cancelled or the deadline passes. A deadline
 * is an `EngineTimeout` (the next engine may take the item); a cancel stays a cancel.
 */
export async function withDeadline<T>(signal: AbortSignal, seconds: number | null, engine: string | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (seconds === null) return work(signal)
  const timer = new AbortController()
  const handle = setTimeout(() => timer.abort(), seconds * 1000)
  try {
    return await work(AbortSignal.any([signal, timer.signal]))
  } catch (e) {
    if (timer.signal.aborted && !signal.aborted && (isAbortError(e) || (e instanceof Error && /abort/i.test(e.message)))) throw new EngineTimeout(engine, seconds)
    throw e
  } finally {
    clearTimeout(handle)
  }
}

/**
 * A moderation refusal, as opposed to a provider that failed: the Cloud reports every job that did not succeed as `refused`
 * (« Le fournisseur a échoué : … »), with the adapter's own message; the adapters start a content-policy refusal with
 * `refused:`. Only those are « refused » for the fallback rules; any other failed job is the provider's trouble.
 */
export const isModeration = (e: unknown): boolean =>
  e instanceof EngineError && e.code === 'refused' && /\brefused:|moderat|content.?polic|safety|blocked|prohibited|not allowed|sensitive/i.test(e.message)

/** A failure after which the next engine may take the item: down, slow, failed; for a clip also a moderation refusal. */
const passesOn = (e: unknown, refusals: boolean): boolean => e instanceof EngineError && (e.code === 'transient' || e.code === 'refused') && (refusals || !isModeration(e))

export type Tried = { engine: string | undefined; code: string; message: string }

/**
 * Tries the engines in order until one works. Returns the value and the engine, or null with what each engine said when all
 * of them failed in a way that lets the item degrade. A refusal ends the list unless `refusals` is `next` (clips).
 */
export async function firstThatWorks<T>(
  engines: readonly (string | undefined)[],
  call: (engine: string | undefined) => Promise<T>,
  o: { refusals: 'next' | 'stop'; log: (text: string) => void }
): Promise<{ value: T; engine: string | undefined; tried: Tried[] } | { value: null; tried: Tried[] }> {
  const tried: Tried[] = []
  for (const engine of engines) {
    try {
      return { value: await call(engine), engine, tried }
    } catch (e) {
      if (!(e instanceof EngineError)) throw e
      const moderation = isModeration(e)
      if (!passesOn(e, o.refusals === 'next') && !moderation) throw e
      tried.push({ engine, code: moderation ? 'refused' : e.code === 'refused' ? 'failed' : e.code, message: e.message })
      if (moderation && o.refusals === 'stop') return { value: null, tried }
      o.log(`${engine ?? 'default engine'} failed (${e.code}: ${e.message})${engines.at(-1) === engine ? '' : ': the next engine takes the item'}`)
    }
  }
  return { value: null, tried }
}
