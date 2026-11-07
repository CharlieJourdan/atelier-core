// Found stand-ins for a FREE demo (moteur-doublures, decision 0109): `visuals.fulfil`'s demo path with `standIns: 'found'`. Every
// picture item of the list — found or generated, still or video — becomes a free stock photograph searched with the item's own
// planned words (its search, its key terms, its subject), cover-cropped full frame, with no text and no per-item mark. A video
// item becomes a still: the render gives it the shot's planned camera move, as it does for a still. The look's measured colour
// treatment (« black and white », « saturated red and black »…) is put on the photograph, as the image engine would.
// The search goes through the demo run's Cloud, which reaches only the free usages (cloud-demo.ts): nothing is ever spent.
// No two items take the same photograph while another result is left; an item nothing was found for shows its neighbour's
// picture (said in the record). Without a Cloud, or when nothing at all was found, the caller draws its stand-ins as before.
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { orientationOf } from '../../shared/cloud-api'
import type { NodeOutputs } from '../artefacts'
import { GenList, type GenItem } from '../formats/editplan'
import { frameSizeOf } from '../formats/timing'
import type { ResolvedInputs, RunCtx } from '../registry'
import { need, type StockHit } from '../services'
import type { Json } from '../types'
import { eachLimited, hashOf, progress, readValue, scratch, throwIfAborted } from './common'
import { creditOf, type StockCredit } from './visuals-stock'
import type { Sized } from './visuals-stills'
import { MAX_BORROWED_SHARE } from '../render/shot-check'

/** Results asked per search (the Cloud downloads each). */
export const FOUND_COUNT = 4

/** The words a stand-in is searched with, in order (pure): the item's search, its key terms, its subject; short and distinct. */
export function standInQueries(item: GenItem): string[] {
  const clean = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const terms = item.context.keyTerms.slice(0, 3).join(' ')
  const all = [item.kind.startsWith('stock.') ? clean(item.query) : '', clean(terms), clean(item.context.subject)]
  return [...new Set(all.filter((q) => q.length >= 2))].slice(0, 2)
}

/** Style words of a look line that are not subjects (pure filter below). */
const STYLE_WORD = /photo|cinematic|studio|still|grade|light|depth|grain|illustrat|never|unique|repeat|text|keyword|prompt|style|render|look|frame|shot|colou?r|vivid|saturat|muted|tone|narrated|sentence|within|video|sharp|blur|lens|bokeh/i

/** The subjects a measured look names (pure): « … (e.g. brokerage account screen with a 397 € figure, couple in a legal dispute,
 *  documents) » → short search phrases, for the items whose own words find nothing (a demo's script is a template). */
export function lookQueries(suffix: string | undefined): string[] {
  const parts = (suffix ?? '').split(/[,;:()]|\be\.g\.|\bsuch as\b|\band\b/i).map((x) => x.replace(/[^\p{L}\s-]/gu, ' ').replace(/\s+/g, ' ').trim())
  const subjects = parts.filter((x) => x.length >= 4 && !STYLE_WORD.test(x)).map((x) => x.split(' ').filter((w) => !/^(a|an|the|with|of|in|on|for)$/i.test(w)).slice(0, 3).join(' '))
  return [...new Set(subjects.filter((x) => x.length >= 4))].slice(0, 6)
}

/** The ffmpeg filter of a look's colour treatment, from its measured words (pure); '' when it names none. */
export function lookGrade(suffix: string | undefined): string {
  const s = (suffix ?? '').toLowerCase()
  if (/black[- ]and[- ]white|monochrome|greyscale|grayscale|noir et blanc/.test(s)) return 'hue=s=0,eq=contrast=1.12'
  const tints: [RegExp, string][] = [
    [/\bred\b|rouge/, 'colorbalance=rs=0.28:gs=-0.12:bs=-0.14:rm=0.18:gm=-0.08:bm=-0.1'],
    [/\bteal\b|orange and teal/, 'colorbalance=rs=0.1:bs=0.18:rh=0.12:bh=-0.08'],
    [/\bwarm\b|golden|amber|chaud/, 'colorbalance=rs=0.12:gs=0.04:bs=-0.12:rm=0.08:bm=-0.08'],
    [/\bcool\b|\bblue\b|froid|bleu/, 'colorbalance=rs=-0.1:bs=0.16:rm=-0.06:bm=0.1'],
    [/sepia|sépia/, 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131']
  ]
  const tint = tints.find(([re]) => re.test(s))?.[1]
  const dark = /\bblack\b|dark|low[- ]key|dramatic|sombre/.test(s) ? 'eq=contrast=1.15:brightness=-0.05' : ''
  const sat = /saturated|vivid|saturé/.test(s) ? 'eq=saturation=1.3' : /muted|desaturated|désaturé/.test(s) ? 'eq=saturation=0.7' : ''
  return [tint, dark, sat].filter(Boolean).join(',')
}

interface Found {
  hits: StockHit[]
  query: string
}

/** The found stand-ins of the list's picture items, or null when the run has no Cloud or nothing at all was found. */
export async function fulfilFound(ctx: RunCtx, items: readonly GenItem[], p: Sized & { parallel: number; look?: { suffix?: string | undefined } | undefined }): Promise<NodeOutputs | string> {
  const cloud = ctx.services.cloud
  if (!cloud) return 'no Cloud in this demo run (signed out)'
  if (items.length === 0) return 'no picture item'
  const dir = await scratch(ctx, 'visuals-found')
  const orientation = orientationOf(p.width, p.height)
  const found: (Found | null)[] = new Array(items.length).fill(null)
  // one search per distinct words (a repeated request shares its results), at most two tries per item
  const searches = new Map<string, Promise<StockHit[]>>()
  const failures: string[] = []
  const search = (query: string): Promise<StockHit[]> => {
    let s = searches.get(query)
    if (!s) {
      const jobDir = path.join(dir, `search-${hashOf({ query }).slice(0, 12)}`)
      // the Cloud client downloads the results into this folder: it must exist (Finary, 2026-11-05: 47 searches lost on ENOENT)
      s = mkdir(jobDir, { recursive: true }).then(() => need(ctx, 'cloud')
        .searchStock({ query, orientation, kind: 'photo', count: FOUND_COUNT }, { idempotencyKey: `standin-${hashOf({ v: 1, query, orientation })}`, signal: ctx.signal, dir: jobDir }))
        .then((r) => r.results.filter((h) => h.kind === 'photo'))
        .catch((e: unknown) => {
          if (ctx.signal.aborted) throw e
          failures.push(e instanceof Error ? e.message.slice(0, 120) : String(e))
          ctx.emit({ kind: 'log', level: 'warn', text: `stand-in « ${query} »: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` })
          return []
        })
      searches.set(query, s)
    }
    return s
  }
  await eachLimited(items, p.parallel, async (item, i) => {
    throwIfAborted(ctx)
    for (const query of standInQueries(item)) {
      const hits = await search(query)
      if (hits.length > 0) {
        found[i] = { hits, query }
        return
      }
    }
  })
  // the items nothing was found for take photographs of the subjects the measured look names (on the channel's style)
  const pool: Found[] = []
  if (found.some((f) => f === null)) {
    const got = await Promise.all(lookQueries(p.look?.suffix).map(async (query) => ({ query, hits: await search(query) })))
    pool.push(...got.filter((g) => g.hits.length > 0))
  }
  if (found.every((f) => f === null) && pool.length === 0) {
    const why = `nothing found for any of ${items.length} items${failures.length ? ` (${failures.length} searches failed: ${failures[0]})` : ''}`
    ctx.emit({ kind: 'log', level: 'warn', text: `found stand-ins: ${why}, the demo draws its stand-ins` })
    return why
  }
  // in the list's order: the first result no earlier item took (never the same photograph twice while another is left)
  const used = new Set<string>()
  const grade = lookGrade(p.look?.suffix)
  const files: string[] = new Array(items.length)
  const record: Record<string, Json>[] = new Array(items.length)
  const holds: number[] = []
  for (const [i, item] of items.entries()) {
    throwIfAborted(ctx)
    let f = found[i]
    let hit = f ? (f.hits.find((h) => !used.has(`${h.source}:${h.id}`)) ?? f.hits[0]) : undefined
    let near: string | null = null
    // nothing found for its own words: a photograph no item took of a subject the look names, else from the nearest item's
    // results (its own picture, never a hold)
    for (const o of hit ? [] : pool) {
      const h = o.hits.find((x) => !used.has(`${x.source}:${x.id}`))
      if (h) { f = o; hit = h; near = 'doublure : photo d’un sujet du style'; break }
    }
    if (!hit) {
      const order = found.map((x, k) => ({ x, k })).filter((o) => o.x).sort((a, b) => Math.abs(a.k - i) - Math.abs(b.k - i))
      for (const o of order) {
        const h = o.x?.hits.find((x) => !used.has(`${x.source}:${x.id}`))
        if (h) { f = o.x; hit = h; near = 'doublure : photo d’une recherche voisine'; break }
      }
    }
    const base = { itemId: item.id, kind: item.kind, file: i, source: 'cloud', demo: true, standIn: 'found' } as const
    if (!f || !hit) {
      holds.push(i)
      record[i] = { ...base, licence: 'aucune', prompt: standInQueries(item)[0] ?? '', degraded: 'doublure introuvable → plan voisin' }
      continue
    }
    used.add(`${hit.source}:${hit.id}`)
    const out = path.join(dir, `${String(i + 1).padStart(3, '0')}-${item.id}.jpg`)
    const vf = `scale=${p.width}:${p.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${p.width}:${p.height}${grade ? `,${grade}` : ''},format=yuvj444p`
    await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-y', '-i', hit.file, '-vf', vf, '-frames:v', '1', '-q:v', '2', out], { signal: ctx.signal })
    files[i] = out
    const credit: StockCredit = creditOf(hit)
    const why = near ?? (item.kind === 'video.gen' || item.kind === 'stock.video' ? 'doublure : photo fixe (le mouvement du plan est celui du rendu)' : null)
    record[i] = { ...base, licence: credit.licence, prompt: f.query, stock: credit as unknown as Json, ...(why ? { degraded: why } : {}) }
    progress(ctx, i + 1, items.length, `${i + 1} doublures sur ${items.length}`)
  }
  // more holds than the render accepts (it stops a film whose shots borrow their neighbour's picture): the drawn stand-ins instead
  if (holds.length / items.length > MAX_BORROWED_SHARE * 0.8) {
    const why = `${holds.length} of ${items.length} items without a photograph${failures.length ? ` (${failures.length} searches failed: ${failures[0]})` : ''}`
    ctx.emit({ kind: 'log', level: 'warn', text: `found stand-ins: ${why}, the demo draws its stand-ins` })
    return why
  }
  // a hold shows the nearest picture before, else after
  for (const i of holds) {
    let j = files.slice(0, i).findLastIndex((x) => x)
    if (j < 0) j = files.findIndex((x, k) => k > i && x)
    const from = files[j] as string
    const out = path.join(dir, `${String(i + 1).padStart(3, '0')}-${(items[i] as GenItem).id}.jpg`)
    await copyFile(from, out)
    files[i] = out
  }
  return {
    images: { files, value: record as unknown as Json, meta: { count: files.length, demo: true, standIns: 'found', degraded: record.filter((r) => r.degraded).length, ...(holds.length > 0 ? { provisional: true } : {}) } },
    clips: { files: [], value: [], meta: { count: 0 } }
  }
}

/** `visuals.fulfil`'s demo with found stand-ins: the list's picture items (a presenter is `avatar.speak`'s), or null. */
export async function standInsFound(ctx: RunCtx, inputs: ResolvedInputs, p: { width?: number | undefined; height?: number | undefined; parallel: number; look?: { suffix?: string | undefined } | undefined }): Promise<NodeOutputs | string> {
  const list = readValue(inputs.list, GenList, 'the generation list')
  const aspect = list.items[0]?.constraints.aspect ?? '16:9'
  const [w, h] = frameSizeOf(aspect)
  return fulfilFound(ctx, list.items.filter((it) => it.kind !== 'avatar'), { width: p.width ?? w, height: p.height ?? h, aspect, parallel: p.parallel, look: p.look })
}

/** The drawn stand-ins a found demo fell back to, saying why in their meta (the run's artefact keeps it: a demo is never silent). */
export function drawnInstead(out: NodeOutputs, why: string | null): NodeOutputs {
  if (!why || !out.images) return out
  return { ...out, images: { ...out.images, meta: { ...(out.images.meta ?? {}), standInFallback: why } } }
}
