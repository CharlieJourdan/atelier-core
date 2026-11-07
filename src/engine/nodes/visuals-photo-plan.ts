// The archive photographs of a whole video, chosen by looking (documentary-2): every photo item's words are searched in the public
// archives with a ladder of queries, the hits of each are laid on a numbered contact sheet, and Claude picks the one that shows the words
// (sourcing/pick.ts: the very thing named, the right place and era, a person only when the archive's own text names them; « none » is
// an answer). Each photo is used once in the video. Round 1 took the archives' first hit and showed a leaf, a sleigh, a modern train.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { searchArchives } from '../archive'
import { ARCHIVE_USER_AGENT } from '../archive/http'
import type { ArchiveHit } from '../archive/types'
import { noteArchiveTrouble } from './archive-trouble'
import type { GenItem } from '../formats/editplan'
import type { RunCtx } from '../registry'
import { need } from '../services'
import type { PickItem } from '../sourcing/pick.ts'
import { sheetArgs } from '../sourcing/sheet.ts'
import type { MediaCandidate } from '../sourcing/types.ts'
import { pickParallel, pickReport, planFilms, queryLadder, type FilmCut } from './visuals-film-plan'

/** Hits laid on one query's sheet. */
export const PHOTO_CANDIDATES = 8

const asCandidate = (h: ArchiveHit): MediaCandidate => ({
  provider: h.source,
  id: h.id,
  kind: 'image',
  title: h.title,
  ...(h.creator ? { creator: h.creator } : {}),
  ...(h.date ? { date: h.date } : {}),
  ...(h.tags ? { tags: h.tags } : {}),
  pageUrl: h.pageUrl,
  previewUrl: h.fileUrl,
  fileUrl: h.fileUrl,
  width: h.width,
  height: h.height,
  licence: { short: h.licence, status: /public domain|cc0/i.test(h.licence) ? 'public-domain' : 'free-licence', attributionRequired: h.attributionRequired },
  credit: h.attribution,
  review: 'clear',
  costUsd: 0,
  score: h.score
})

async function pool<T>(xs: readonly T[], n: number, f: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++
        await f(xs[i] as T, i)
      }
    })
  )
}

/** The hits each photo item may use, best first (by item id); an item absent or empty has none that fits (a gap). */
export async function planPhotos(ctx: RunCtx, wanted: readonly { item: GenItem; query: string }[], o: { dir: string; claude: boolean; landscape: boolean }): Promise<Map<string, ArchiveHit[]>> {
  const media = need(ctx, 'media')
  const queries = [...new Set(wanted.map((w) => w.query))]
  const hitsOf = new Map<string, ArchiveHit[]>()
  await pool(queries, 4, async (q) => {
    const seen = new Map<string, ArchiveHit>()
    const alt = wanted.find((w) => w.query === q && w.item.alt)?.item.alt
    // the precise words first, then (always) the broader ones: Claude may refuse every precise hit
    const rungs = queryLadder(q)
    for (const rung of [...rungs, ...(alt ? [alt] : [])]) {
      // the precise rungs stop once four photographs answer; the broad words are always asked
      if (rung !== alt && rung !== rungs[0] && seen.size >= 4) continue
      try {
        const { hits, errors } = await searchArchives(rung, { count: PHOTO_CANDIDATES, orientation: o.landscape ? 'landscape' : 'portrait' }, { signal: ctx.signal })
        for (const h of hits) if (!seen.has(h.fileUrl)) seen.set(h.fileUrl, h)
        if (hits.length === 0 && errors.length > 0) noteArchiveTrouble(ctx)
      } catch (e) {
        if (ctx.signal.aborted) throw e
        noteArchiveTrouble(ctx) // every source failed: throttled or down, not « nothing found » (issue #106)
      }
    }
    hitsOf.set(q, [...seen.values()].slice(0, PHOTO_CANDIDATES + 4))
  })
  const order = new Map<string, ArchiveHit[]>()
  if (o.claude && ctx.services.claude) {
    await mkdir(o.dir, { recursive: true })
    // one numbered sheet per query (the tiles are the candidates in order)
    const items: PickItem[] = []
    await pool(queries, 3, async (q, k) => {
      const hits = hitsOf.get(q) ?? []
      if (hits.length === 0) return
      const files: string[] = []
      for (const [i, h] of hits.entries()) {
        const f = path.join(o.dir, `p${k}-${i}.jpg`)
        try {
          await media.run('ffmpeg', ['-v', 'error', '-y', '-user_agent', ARCHIVE_USER_AGENT, '-i', h.fileUrl, '-frames:v', '1', '-vf', 'scale=320:-2', f], { signal: ctx.signal })
          files.push(f)
        } catch (e) {
          if (ctx.signal.aborted) throw e
          files.push('')
        }
      }
      const shown = files.map((f, i) => ({ f, i })).filter((x) => x.f !== '')
      let sheet: string | undefined
      if (shown.length > 0) {
        sheet = path.join(o.dir, `sheet-${k}.jpg`)
        try {
          await media.run('ffmpeg', sheetArgs(shown.map((x) => x.f), sheet, { cols: 4, labels: shown.map((x) => String(x.i + 1)) }), { signal: ctx.signal })
        } catch (e) {
          if (ctx.signal.aborted) throw e
          sheet = undefined
        }
      }
      const said = wanted.filter((w) => w.query === q).map((w) => w.item.context.said ?? w.item.context.beatText).join(' … ').slice(0, 600)
      items.push({ id: q, spoken: said, candidates: hits.map(asCandidate), ...(sheet ? { sheet } : {}) })
    })
    try {
      const picks = await pickParallel(ctx, items)
      for (const p of picks) {
        if (!p) continue
        const hits = hitsOf.get(p.id) ?? []
        const byUrl = (c: MediaCandidate): ArchiveHit | undefined => hits.find((h) => h.fileUrl === c.fileUrl)
        order.set(p.id, p.choice ? [p.choice, ...p.backups].map(byUrl).filter((h): h is ArchiveHit => h !== undefined) : [])
      }
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `photos: the pick failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)}), the archives' order is kept` })
    }
  }
  for (const q of queries) if (!order.has(q)) order.set(q, hitsOf.get(q) ?? [])
  // each photo once in the video: an item takes the first of its query's picks no earlier item took
  const used = new Set<string>()
  const out = new Map<string, ArchiveHit[]>()
  for (const w of wanted) {
    const mine = (order.get(w.query) ?? []).filter((h) => !used.has(h.fileUrl))
    if (mine[0]) used.add(mine[0].fileUrl)
    out.set(w.item.id, mine)
  }
  const none = wanted.filter((w) => (out.get(w.item.id) ?? []).length === 0).length
  if (none > 0) ctx.emit({ kind: 'log', level: 'warn', text: `photos: ${none} of ${wanted.length} with no archive photograph that fits` })
  return out
}

/** Both plans of an archive pipeline's list (films and photographs, side by side): a film item gets a photograph too, for when no film fits. */
export async function planArchives(ctx: RunCtx, items: readonly GenItem[], o: { dir: string; films: boolean; landscape: boolean }): Promise<{ films: Map<string, FilmCut[]>; photos: Map<string, ArchiveHit[]> }> {
  const found = items.filter((it) => it.kind === 'stock.video' || it.kind === 'stock.photo').map((item) => ({ item, query: item.query ?? item.context.subject }))
  const claude = ctx.services.claude !== undefined
  pickReport.length = 0
  const [films, photos] = await Promise.all([
    o.films ? planFilms(ctx, found.filter((w) => w.item.kind === 'stock.video'), { dir: path.join(o.dir, 'film-sheets'), claude }) : new Map<string, FilmCut[]>(),
    planPhotos(ctx, found, { dir: path.join(o.dir, 'photo-sheets'), claude, landscape: o.landscape })
  ])
  // what was found and chosen, beside the sheets (a run's scratch says why a picture is missing)
  await writeFile(path.join(o.dir, 'plan-report.json'), JSON.stringify({ films: films.size, photos: [...photos.values()].filter((h) => h.length > 0).length, items: found.length, picks: pickReport }, null, 1)).catch(() => undefined)
  return { films, photos }
}
