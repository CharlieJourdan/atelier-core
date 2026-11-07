// The stock / archive path of `visuals.fulfil@1`: one Atelier Cloud search per stock item (Pexels, Wikimedia Commons, or the
// demo files), and the choice of the result that becomes the item's picture. A pipeline that searches public archives first
// (`archives`, style-markets: the documentary base) asks them locally (engine/archive: Wikimedia Commons, Internet Archive, NASA,
// the Met — free public APIs, a licence per item, public domain and CC BY / BY-SA only), and the Cloud's stock when they have nothing.
// Nothing found anywhere is a gap the caller flags: a found item is never replaced by a generated picture.
import { orientationOf } from '../../shared/cloud-api'
import { downloadArchive, searchArchives, type ArchiveHit } from '../archive'
import type { GenItem } from '../formats/editplan'
import type { RunCtx } from '../registry'
import { need, type StockHit } from '../services'
import { noteArchiveTrouble } from './archive-trouble'

/** How many results a search brings back (the Cloud downloads each of them, so a video search asks for fewer). */
export const STOCK_COUNT = { photo: 3, video: 2 } as const

export const isStockItem = (item: GenItem): boolean => item.kind === 'stock.photo' || item.kind === 'stock.video'

/** What the images record keeps of a stock picture: where it came from, its licence, and the credit line to publish. */
export interface StockCredit {
  id: string
  /** The stock provider, or the public archive the picture was found in. */
  source: StockHit['source'] | ArchiveHit['source']
  kind: StockHit['kind']
  title: string
  creator: string
  creatorUrl: string | null
  pageUrl: string | null
  licence: string
  attribution: string
  attributionRequired: boolean
}

export const creditOf = (h: StockHit): StockCredit => ({
  id: h.id,
  source: h.source,
  kind: h.kind,
  title: h.title,
  creator: h.creator,
  creatorUrl: h.creatorUrl,
  pageUrl: h.pageUrl,
  licence: h.licence,
  attribution: h.attribution,
  attributionRequired: h.attributionRequired
})

/**
 * The best match among the results: for now the first one whose orientation fits the picture asked for (the providers rank
 * by relevance, so the first is the best by their own measure). Ranking the candidates by LOOKING at them (the "eyes",
 * Gemini over thumbnails against the beat's text) is a later step; it replaces this function and nothing else.
 */
export function pickBest(hits: readonly StockHit[], want: StockHit['orientation']): StockHit | undefined {
  return hits.find((h) => h.orientation === want)
}

export interface StockFound {
  /** The local file of the chosen result (a picture, or a video the caller takes a frame of). */
  src: string
  /** What the images record keeps of it (its licence and credit line). */
  credit: StockCredit
  kind: StockHit['kind']
  demo: boolean
}

/** The credit of a public archive's picture. */
export const archiveCreditOf = (h: ArchiveHit): StockCredit => ({
  id: h.id,
  source: h.source,
  kind: 'photo',
  title: h.title,
  creator: h.creator ?? '',
  creatorUrl: null,
  pageUrl: h.pageUrl,
  licence: h.licence,
  attribution: h.attribution,
  attributionRequired: h.attributionRequired
})

/**
 * The public archives' best picture for the item (downloaded into `dir`), or null: nothing found, or every source failed (the
 * caller then makes a period picture). A cancel is never swallowed.
 */
export async function findArchive(ctx: RunCtx, query: string, size: { width: number; height: number }, dir: string): Promise<StockFound | null> {
  try {
    const { hits, errors } = await searchArchives(query, { count: 4, orientation: size.width >= size.height ? 'landscape' : 'portrait' }, { signal: ctx.signal })
    if (hits.length === 0 && errors.length > 0) {
      noteArchiveTrouble(ctx)
      ctx.emit({ kind: 'log', level: 'warn', text: `archives for « ${query} »: ${errors.map((e) => `${e.source}: ${e.message}`).join('; ').slice(0, 200)} (not « nothing found »; the next source is asked)` })
    }
    for (const hit of hits.slice(0, 2)) {
      try {
        const { file } = await downloadArchive(hit, dir, { signal: ctx.signal })
        return { src: file, credit: archiveCreditOf(hit), kind: 'photo', demo: false }
      } catch (e) {
        if (ctx.signal.aborted) throw e
        ctx.emit({ kind: 'log', level: 'warn', text: `archive ${hit.source} ${hit.id}: ${(e as Error).message.slice(0, 200)}` })
      }
    }
  } catch (e) {
    if (ctx.signal.aborted) throw e
    noteArchiveTrouble(ctx)
    ctx.emit({ kind: 'log', level: 'warn', text: `archives for « ${query} »: ${(e as Error).message.slice(0, 200)}` })
  }
  return null
}

/**
 * The found picture for the item, or null when nothing was found anywhere: the public archives first for an archive pipeline, then
 * the Cloud's stock search (Pixabay, then the keyless banks: Commons, Wellcome, the Met, NASA, Internet Archive — record 0069). A
 * real run never takes a demo answer (one fake picture used to mark a whole real film « DÉMO », clone-markets-2). Null means a gap:
 * the caller flags it and never generates a picture in its place (Charlie, 02/11: what exists is found, never generated).
 */
/** The first of the hits Claude chose for an item (visuals-photo-plan.ts) that downloads, or null. */
export async function downloadPlanned(ctx: RunCtx, planned: readonly ArchiveHit[], dir: string): Promise<StockFound | null> {
  for (const hit of planned.slice(0, 3)) {
    try {
      const { file } = await downloadArchive(hit, dir, { signal: ctx.signal })
      return { src: file, credit: archiveCreditOf(hit), kind: 'photo', demo: false }
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `archive ${hit.source} ${hit.id}: ${(e as Error).message.slice(0, 200)}` })
    }
  }
  return null
}

/** A wider query for an item nothing was found for: its subject, else the first words of the query. Null when it would not differ. */
export function widerQuery(item: GenItem, query: string): string | null {
  const subject = item.context.subject.trim()
  const wide = subject && subject !== query ? subject : query.split(/\s+/).slice(0, 2).join(' ')
  return wide && wide !== query ? wide : null
}

export async function findStock(
  ctx: RunCtx,
  item: GenItem,
  query: string,
  size: { width: number; height: number },
  opts: { idempotencyKey: string; dir: string; archives?: boolean; planned?: readonly ArchiveHit[] }
): Promise<StockFound | null> {
  const kind = item.kind === 'stock.video' ? 'video' : 'photo'
  // documentary-2: the photographs Claude chose by looking; none chosen is a gap (never the first stock hit instead)
  if (opts.archives && kind === 'photo' && opts.planned) return downloadPlanned(ctx, opts.planned, opts.dir)
  // an archive pipeline asks the public archives first, then the found-media chain of the Cloud
  if (opts.archives && kind === 'photo') {
    const archive = await findArchive(ctx, query, size, opts.dir)
    if (archive) return archive
  }
  const orientation = orientationOf(size.width, size.height)
  const { archives: _local, planned: _planned, ...cloudOpts } = opts
  const res = await need(ctx, 'cloud').searchStock({ query, orientation, kind, count: STOCK_COUNT[kind] }, { ...cloudOpts, signal: ctx.signal })
  if (res.demo && ctx.services.cloud?.realRun === true) {
    ctx.emit({ kind: 'log', level: 'warn', text: `stock « ${query} »: the Cloud answered a demo in a real run, taken as nothing found` })
    return null
  }
  const hit = pickBest(res.results, orientation)
  return hit ? { src: hit.file, credit: creditOf(hit), kind: hit.kind, demo: res.demo } : null
}
