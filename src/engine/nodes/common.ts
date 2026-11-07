// Helpers shared by the production nodes of lot P4: reading typed input artefacts, Claude calls with structured answers
// (docs/ENGINE-SPEC.md §32), working folders, progress phrases and the content hash of inner caches.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'
import type { Artefact } from '../artefacts'
import { canonicalJson } from '../canonical'
import { AbortError, EngineError } from '../errors'
import type { RunCtx } from '../registry'
import { need, type ModelTier } from '../services'

/** The JSON value of an input artefact, checked against its format (a bad upstream value is a permanent error). */
export function readValue<T>(a: Artefact | undefined, schema: z.ZodType<T>, what: string): T {
  if (!a) throw new EngineError('missing_input', `${what} is missing`)
  const r = schema.safeParse(a.value)
  if (!r.success) {
    const first = r.error.issues[0]
    throw new EngineError('bad_input', `${what} does not match its format: ${first ? `${first.path.join('.')} ${first.message}` : ''}`)
  }
  return r.data
}

/** The text of a text artefact. */
export function readText(a: Artefact | undefined, what: string): string {
  if (!a || typeof a.value !== 'string' || !a.value.trim()) throw new EngineError('bad_input', `${what} is empty`)
  return a.value
}

/** The first file of a media artefact. */
export function readFile0(a: Artefact | undefined, what: string): string {
  const f = a?.files?.[0]
  if (!f) throw new EngineError('bad_input', `${what} has no file`)
  return f
}

/** A number from an artefact's meta. */
export function metaNumber(a: Artefact | undefined, key: string): number | undefined {
  const v = a?.meta?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Writes a cache entry atomically (temp file in the same folder, then rename, R7.7): a crash never leaves half of it. */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** Copies a file into a cache entry atomically. */
export async function atomicCopy(src: string, file: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await copyFile(src, tmp)
  await rename(tmp, file)
}

/** A fresh scratch folder for this node run. */
export async function scratch(ctx: RunCtx, label: string): Promise<string> {
  return need(ctx, 'workspace').scratch(label)
}

/** Short stable hash of any JSON-able value (inner cache keys, R33.2: always include the node seed). */
export function hashOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 32)
}

/**
 * Runs `work` on every item, `n` at a time. A failure stops the others from starting another item (a paid picture, a paid clip)
 * and lets the ones in flight finish (they are cached) before it is thrown.
 */
export async function eachLimited<T>(items: readonly T[], n: number, work: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0
  let stop = false
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      try {
        while (!stop && next < items.length) {
          const i = next++
          await work(items[i] as T, i)
        }
      } catch (e) {
        stop = true
        throw e
      }
    })
  )
  const bad = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (bad) throw bad.reason as Error
}

/** Reports progress with a short French phrase (R34.1). */
export function progress(ctx: RunCtx, done: number, total: number, text: string): void {
  ctx.emit({ kind: 'progress', frac: total > 0 ? Math.min(1, done / total) : 1, text })
}

export function throwIfAborted(ctx: RunCtx): void {
  if (ctx.signal.aborted) throw new AbortError()
}

/**
 * Extracts the first complete JSON value of a reply (R32.2): the reply may wrap it in prose or a code fence.
 * Returns undefined when there is none.
 */
export function firstJson(text: string): unknown {
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== '{' && c !== '[') continue
    let depth = 0
    let inString = false
    for (let j = i; j < text.length; j++) {
      const d = text[j]
      if (inString) {
        if (d === '\\') j++
        else if (d === '"') inString = false
        continue
      }
      if (d === '"') inString = true
      else if (d === '{' || d === '[') depth++
      else if (d === '}' || d === ']') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1)) as unknown
          } catch {
            break
          }
        }
      }
    }
  }
  return undefined
}

/**
 * One structured Claude call (R32.1, R32.2): the answer is parsed and validated; a failure gets ONE repair request that
 * quotes the validation error (never the same prompt twice in a row); a second failure is a `schema` error.
 */
export async function askJson<T>(ctx: RunCtx, o: { role: string; tier?: ModelTier; system: string; prompt: string; schema: z.ZodType<T>; images?: string[] }): Promise<T> {
  const claude = need(ctx, 'claude')
  let prompt = o.prompt
  let lastError = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await claude.ask({ role: o.role, ...(o.tier ? { tier: o.tier } : {}), system: o.system, prompt, json: true, ...(o.images ? { images: o.images } : {}), signal: ctx.signal })
    const value = firstJson(reply.text)
    const r = o.schema.safeParse(value)
    if (r.success) return r.data
    const issue = r.error.issues[0]
    lastError = value === undefined ? 'the reply holds no JSON value' : `${issue ? issue.path.join('.') : ''}: ${issue?.message ?? 'invalid'}`
    prompt = `${o.prompt}\n\nYour previous answer was not valid (${lastError}). Answer again with ONE JSON value that fixes exactly this, nothing else.`
  }
  throw new EngineError('schema', `${o.role}: the answer stayed invalid after one repair (${lastError})`)
}

/** The language line every Claude prompt starts with (R32.5). */
export const languageLine = (lang: string): string =>
  `Output language: ${lang === 'fr' ? 'French (français)' : lang === 'en' ? 'English' : lang}. Every word meant for the viewer is in this language.`
