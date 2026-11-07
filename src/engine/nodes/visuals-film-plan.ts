// The archive films of a whole video, planned at once (documentary-2): every film item's words are searched in the public archives with a
// ladder of queries (as written, without its years, its first words: archive catalogues are terse), Claude picks the film that shows the
// words for each query (sourcing/pick.ts, six queries a call), then LOOKS at each chosen film — a contact sheet of frames across the reel —
// and says which moments show the words of each clip that uses it, so a montage cuts the right seconds and never the same ones twice
// (round 1 cut fixed moments: titles and off-subject seconds). Everything is free (archives, the subscription); nothing is generated.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { GenItem } from '../formats/editplan'
import type { RunCtx } from '../registry'
import { need } from '../services'
import { PICK_BATCH, pickMedia, type Pick, type PickItem } from '../sourcing/pick.ts'
import { searchMedia } from '../sourcing/search.ts'
import { sheetArgs } from '../sourcing/sheet.ts'
import type { MediaCandidate } from '../sourcing/types.ts'
import { probe } from '../media/probe'
import { ARCHIVE_USER_AGENT } from '../archive/http'
import { noteArchiveTrouble } from './archive-trouble'
import { askJson, firstJson } from './common'

/** The free film sources asked (keyless). */
export const FILM_PROVIDERS = ['wikimedia-video', 'internet-archive-video'] as const
/** The film sources whose keys only the Cloud holds, asked through its media route. */
export const CLOUD_FILM_PROVIDERS = ['europeana-video', 'nara-video'] as const
/** Reels looked at for one video, and the optional lines (clips without a film of their own) asked of each. */
export const REELS_MAX = 12
const ORPHAN_LINES = 24
/** Frames on a film's contact sheet. */
export const SHEET_TILES = 24
const SHEET_COLS = 6

export interface FilmCut {
  film: MediaCandidate
  /** Where the clip starts in the film (seconds). */
  startS: number
  /** The film's length. */
  lengthS: number
}

/** The queries tried for some words, most precise first: as written, without years and figures, its first three words. */
export function queryLadder(q: string): string[] {
  const noYears = q.replace(/\b\d[\d,.]*\b/g, ' ').replace(/\s+/g, ' ').trim()
  const short = noYears.split(' ').slice(0, 3).join(' ')
  return [...new Set([q.trim(), noYears, short].filter((x) => x.length >= 3))]
}

const Moments = z.object({ unusable: z.boolean().optional(), lines: z.array(z.object({ line: z.number().int().min(1), tiles: z.array(z.number().int().min(0)).max(6) })) })

async function pool<T>(xs: readonly T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) await f(xs[next++] as T)
  }))
}

/** The cuts of every film item (by item id), best first; an item absent has no film (a gap). */
export async function planFilms(ctx: RunCtx, wanted: readonly { item: GenItem; query: string }[], o: { dir: string; claude: boolean }): Promise<Map<string, FilmCut[]>> {
  const media = need(ctx, 'media')
  const warn = (text: string): void => ctx.emit({ kind: 'log', level: 'warn', text })
  const out = new Map<string, FilmCut[]>()
  const queries = [...new Set(wanted.map((w) => w.query))]
  // 1. search, rung by rung, until two films answer
  const found = new Map<string, MediaCandidate[]>()
  const noKey = new Set<string>()
  await pool(queries, 4, async (q) => {
    const seen = new Map<string, MediaCandidate>()
    const alt = wanted.find((w) => w.query === q && w.item.alt)?.item.alt
    // the precise words first, then (always) the broader ones: Claude may refuse every precise hit
    const rungs = queryLadder(q)
    for (const rung of [...rungs, ...(alt ? [alt] : [])]) {
      // the precise rungs stop once four films answer; the broad words are always asked
      if (rung !== alt && rung !== rungs[0] && seen.size >= 4) continue
      try {
        const r = await searchMedia(rung, { kinds: ['video'], providers: [...FILM_PROVIDERS], count: 8, minDurationS: 6, excludeReview: true }, { signal: ctx.signal })
        for (const c of r.candidates) if (c.kind === 'video' && c.fileUrl && !seen.has(c.fileUrl)) seen.set(c.fileUrl, c)
        if (r.candidates.length === 0 && r.errors.length > 0) noteArchiveTrouble(ctx) // throttled or down, not « nothing found » (issue #106)
      } catch (e) {
        if (ctx.signal.aborted) throw e
        noteArchiveTrouble(ctx)
      }
      // the keyed archives through the Cloud (Europeana: the BnF, the Bundesarchiv, national film archives; NARA), when it answers
      const cloud = ctx.services.cloud
      if (cloud?.searchMedia && seen.size < 6) {
        try {
          const r = await cloud.searchMedia({ query: rung, kinds: ['video'], count: 6, minDurationS: 6, providers: [...CLOUD_FILM_PROVIDERS] }, ctx.signal)
          for (const c of r.candidates) if (c.kind === 'video' && c.fileUrl && c.review === 'clear' && !seen.has(c.fileUrl)) seen.set(c.fileUrl, c as MediaCandidate)
          for (const s of r.skipped) if (s.reason === 'no-key') noKey.add(s.detail ?? s.provider)
        } catch (e) {
          if (ctx.signal.aborted) throw e
        }
      }
    }
    found.set(q, [...seen.values()].slice(0, 12))
  })
  if (noKey.size > 0) warn(`films: the Cloud holds no key for ${[...noKey].join(', ')} (free keys to add to its vault)`)
  // 2. Claude picks per query (the words of its clips), or the archives' order without Claude
  const chosen = new Map<string, MediaCandidate[]>()
  const askable = queries.filter((q) => (found.get(q) ?? []).length > 0)
  if (o.claude && ctx.services.claude && askable.length > 0) {
    try {
      const spoken = (q: string): string => wanted.filter((w) => w.query === q).map((w) => w.item.context.said ?? w.item.context.beatText).join(' … ').slice(0, 600)
      const picks = await pickParallel(ctx, askable.map((q) => ({ id: q, spoken: spoken(q), candidates: found.get(q) ?? [] })))
      picks.forEach((p, i) => {
        if (p) chosen.set(p.id, p.choice ? [p.choice, ...p.backups.filter((c) => c.fileUrl !== p.choice?.fileUrl)] : [])
        else chosen.set(askable[i] as string, found.get(askable[i] as string) ?? [])
      })
    } catch (e) {
      if (ctx.signal.aborted) throw e
      warn(`films: the pick failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)}), the archives' own order is kept`)
    }
  }
  for (const q of queries) if (!chosen.has(q)) chosen.set(q, found.get(q) ?? [])
  // 3. the reels: each chosen film once, then (a pile of period reels, as an editor keeps them) the archives' best film for the words
  // Claude refused, which may still hold a moment that fits; every reel is looked at once, its own clips first, the orphans after
  const reels = new Map<string, { film: MediaCandidate; own: GenItem[] }>()
  for (const w of wanted) {
    const film = chosen.get(w.query)?.[0]
    if (!film) continue
    const u = reels.get(film.fileUrl) ?? { film, own: [] }
    u.own.push(w.item)
    reels.set(film.fileUrl, u)
  }
  const orphans = wanted.filter((w) => !chosen.get(w.query)?.[0]).map((w) => w.item)
  for (const q of queries) {
    if (reels.size >= REELS_MAX || (chosen.get(q)?.length ?? 0) > 0) continue
    const extra = (found.get(q) ?? []).find((c) => !reels.has(c.fileUrl) && (c.durationS ?? 60) >= 30)
    if (extra) reels.set(extra.fileUrl, { film: extra, own: [] })
  }
  await mkdir(o.dir, { recursive: true })
  const looked: { film: MediaCandidate; length: number; times: number[]; own: GenItem[]; optional: GenItem[]; picks: Map<number, number[]> }[] = []
  let n = 0
  await pool([...reels.values()], 3, async ({ film, own }) => {
    const k = ++n
    let length = film.durationS ?? 0
    try {
      if (!length) length = (await probe(media, film.fileUrl, ctx.signal)).durationS
    } catch (e) {
      if (ctx.signal.aborted) throw e
    }
    if (!length || length < 4) return
    // across the reel, past its leader and titles (the first 4 %) and before its end titles (the last 5 %)
    const times = Array.from({ length: SHEET_TILES }, (_, i) => Math.max(1, length * (0.04 + (0.91 * (i + 0.5)) / SHEET_TILES)))
    const optional = orphans.slice(0, ORPHAN_LINES)
    const lineOf = [...own, ...optional]
    let picks = new Map<number, number[]>()
    if (o.claude && ctx.services.claude && lineOf.length > 0) {
      const frames: (string | null)[] = new Array(times.length).fill(null)
      await pool(times.map((t, i) => ({ t, i })), 4, async ({ t, i }) => {
        const f = path.join(o.dir, `f${k}-${i}.jpg`)
        try {
          await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(1), '-user_agent', ARCHIVE_USER_AGENT, '-i', film.fileUrl, '-frames:v', '1', '-vf', 'scale=320:-2', f], { signal: ctx.signal })
          frames[i] = f
        } catch (e) {
          if (ctx.signal.aborted) throw e
        }
      })
      const ok = frames.map((f, i) => ({ f, i })).filter((x): x is { f: string; i: number } => x.f !== null)
      if (ok.length < 4) return
      const sheet = path.join(o.dir, `sheet-${k}.jpg`)
      try {
        await media.run('ffmpeg', sheetArgs(ok.map((x) => x.f), sheet, { cols: SHEET_COLS, labels: ok.map((x) => String(x.i + 1)) }), { signal: ctx.signal })
        const lines = lineOf.map((it, j) => `${j + 1}${j >= own.length ? '*' : ''}. ${(it.context.said ?? it.context.beatText).slice(0, 200)}`)
        const answer = await askJson(ctx, {
          role: 'director',
          tier: 'fast',
          system:
            'You are the film editor of a history documentary. The picture is a contact sheet of one archive film: numbered tiles, frames taken across the reel in order. ' +
            'For each numbered line of narration, give up to 3 tile numbers (best first) whose moment shows what the line says, or a picture of the very thing it talks about (its place, its people, its action, at that time); never soldiers, crowds, snow or ruins the line does not talk about. ' +
            'Lines marked * are optional: give them tiles only when a tile truly fits them (the right time and place), else []. ' +
            'Never a title card, a countdown leader, a black or burnt-out white frame, a caption or credits. Different lines take different tiles. [] when no tile fits. ' +
            'Set "unusable": true when the film cannot serve a period documentary at all: subtitles or text burnt into most frames, modern colour footage for a past era, a lecture, a cartoon. ' +
            'Answer with ONE JSON object: {"unusable":false,"lines":[{"line":<n>,"tiles":[<tile numbers>]}]}.',
          prompt: [`Film: « ${film.title.slice(0, 120)} » (${Math.round(length)} s).`, 'Lines:', ...lines].join('\n'),
          schema: Moments,
          images: [sheet]
        })
        if (answer.unusable) {
          warn(`film « ${film.title.slice(0, 60)} »: unusable (burnt-in text, wrong era…), its clips take a photograph`)
          return
        }
        picks = new Map(answer.lines.map((l) => [l.line, l.tiles.filter((t) => t >= 1 && t <= SHEET_TILES)]))
      } catch (e) {
        if (ctx.signal.aborted) throw e
        warn(`film « ${film.title.slice(0, 60)} »: no moments chosen (${e instanceof Error ? e.message.slice(0, 120) : String(e)})`)
      }
    }
    looked.push({ film, length, times, own, optional, picks })
  })
  // each clip its own moment: its own reel's best free tile (else a free spot across it); an orphan the first reel that has a tile for it
  const usedOf = new Map<string, Set<number>>()
  const cutAt = (r: (typeof looked)[number], it: GenItem, tile: number): FilmCut => ({ film: r.film, startS: Math.max(0, Math.min(r.length - it.constraints.durationS - 0.8, (r.times[tile - 1] ?? 0) - 1)), lengthS: r.length })
  for (const r of looked) {
    const used = usedOf.get(r.film.fileUrl) ?? new Set<number>()
    usedOf.set(r.film.fileUrl, used)
    r.own.forEach((it, j) => {
      const best = (r.picks.get(j + 1) ?? []).find((t) => !used.has(t))
      // Claude looked and saw no moment for it: no cut picked at random (a leader, a title); its photograph, or a neighbour's reel, instead
      if (best === undefined && r.picks.size > 0) return
      const tile = best ?? Array.from({ length: SHEET_TILES }, (_, i) => ((j * 7 + 5 + i) % (SHEET_TILES - 6)) + 4).find((t) => !used.has(t)) ?? 6
      used.add(tile)
      // the query's next film stands by, at a moment of its own, for when this one does not answer
      const q = wanted.find((w) => w.item.id === it.id)?.query ?? ''
      const backup = (chosen.get(q) ?? []).find((c) => c.fileUrl !== r.film.fileUrl && (c.durationS ?? 0) > it.constraints.durationS + 8)
      out.set(it.id, [cutAt(r, it, tile), ...(backup ? [{ film: backup, startS: (backup.durationS ?? 0) * (0.2 + ((j * 0.17) % 0.6)), lengthS: backup.durationS ?? 0 }] : [])])
    })
  }
  for (const it of orphans) {
    for (const r of looked) {
      const j = r.optional.indexOf(it)
      const used = usedOf.get(r.film.fileUrl) as Set<number>
      const tile = j < 0 ? undefined : (r.picks.get(r.own.length + j + 1) ?? []).find((t) => !used.has(t))
      if (tile === undefined) continue
      used.add(tile)
      out.set(it.id, [cutAt(r, it, tile)])
      break
    }
  }
  const missing = wanted.filter((w) => !out.has(w.item.id)).length
  if (missing > 0) warn(`films: ${missing} of ${wanted.length} clip(s) with no archive film`)
  return out
}

/** What the picks said (written beside the sheets: a run's scratch shows why a clip or a photograph is missing). */
export const pickReport: { id: string; choice: string | null; why: string; error?: string }[] = []

/**
 * `pickMedia` over many items, three calls at a time (the sourcing pick runs its batches one after the other). Claude's answer is read
 * leniently (the first JSON object in it); a batch with no answer at all is asked again without its pictures; an item still unanswered
 * keeps the archives' own order (`undefined`), never « nothing fits » — only Claude saying so is a refusal.
 */
export async function pickParallel(ctx: RunCtx, items: readonly PickItem[]): Promise<(Pick | undefined)[]> {
  const claude = need(ctx, 'claude')
  let error = ''
  const lenient = {
    ask: async (req: Parameters<typeof claude.ask>[0]) => {
      try {
        const r = await claude.ask(req)
        const j = firstJson(r.text)
        return { text: j === undefined ? r.text : JSON.stringify(j) }
      } catch (e) {
        if (ctx.signal.aborted) throw e
        error = e instanceof Error ? e.message.slice(0, 200) : String(e)
        throw e
      }
    }
  }
  const answered = (p: Pick): boolean => p.why !== 'no answer for this item'
  const chunks: PickItem[][] = []
  for (let i = 0; i < items.length; i += PICK_BATCH) chunks.push(items.slice(i, i + PICK_BATCH))
  const out: (Pick | undefined)[][] = new Array(chunks.length)
  await pool(chunks.map((c, i) => ({ c, i })), 3, async ({ c, i }) => {
    let picks = (await pickMedia(c, lenient, { signal: ctx.signal })).picks
    if (!picks.some(answered)) picks = (await pickMedia(c.map(({ sheet: _s, ...rest }) => rest), lenient, { signal: ctx.signal })).picks
    out[i] = picks.map((p) => (answered(p) ? p : undefined))
    for (const p of picks) pickReport.push({ id: p.id, choice: p.choice?.title.slice(0, 80) ?? null, why: p.why, ...(answered(p) ? {} : { error }) })
  })
  return out.flat()
}
