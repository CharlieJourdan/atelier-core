// The footage chain, end to end: spoken beats → needs (Claude) → search (archives, stock, YouTube) → watch the best videos (Gemini shot log,
// budgeted) → filter the shots (code) → the picker chooses (Claude, with a contact sheet) → download ONLY the chosen range (yt-dlp, or ffmpeg
// on a direct file) → snap it to real scene cuts and cut it (ffmpeg) → verify the clip on a contact sheet (Claude) → on a bad verdict, try the
// next-best candidate once → whatever has no fit is a GAP, the only thing that should be generated. Every paid step goes through the ledger
// before it runs. Everything external is injected, so the whole chain is tested without a network, a process or a model.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { BudgetExceeded, type CostLedger } from './budget.ts'
import { cutClip, detectSceneCuts, downloadWindow, planCut, type CutPlan, type LogoCorner } from './cut.ts'
import { planNeeds, type Beat, type Need } from './needs.ts'
import { pickMedia, type Pick, type PickItem } from './pick.ts'
import { dedupeCandidates, heuristicRank, type AskClaude } from './rank.ts'
import { searchMedia, type MediaSearchDeps, type MediaSearchOptions } from './search.ts'
import { downloadExcerpt } from './providers/ytdlp.ts'
import { verifyClips, type Verdict } from './verify.ts'
import { filterShots, shotsToCandidates, watchMaxCostUsd, WATCH_DEFAULT_MODEL, type Shot, type WatchInput, type WatchResult } from './watch.ts'
import type { MediaCandidate, RunFn } from './types.ts'

export interface ChainDeps {
  claude: AskClaude
  searchDeps: MediaSearchDeps
  run: RunFn
  workDir: string
  ledger: CostLedger
  /** Gemini watching a public video; absent = no shot logs (web candidates keep a default window and a note). */
  watch?: (input: WatchInput) => Promise<WatchResult>
  /** Injectable pieces (tests). */
  search?: typeof searchMedia
  download?: typeof downloadExcerpt
  signal?: AbortSignal
}

export interface ChainOptions {
  /** Candidates per kind and per query. */
  perQuery?: number
  /** YouTube videos to watch per beat. */
  watchPerBeat?: number
  maxCandidates?: number
  /** Cut and verify the chosen clips (default on). `false` stops at the pick. */
  cut?: boolean
  verify?: boolean
  /** Extra provider ids to ask (e.g. `youtube-excerpt` is added automatically when `watch` exists). */
  providers?: string[]
  topic?: string
  searchOptions?: Partial<MediaSearchOptions>
}

export interface BeatResult {
  beat: Beat
  need: Need
  pick: Pick | null
  /** The cut clip, for a video pick. */
  clip?: { file: string; plan: CutPlan; source: MediaCandidate; verdict?: Verdict }
  /** True when nothing fits: only here should a picture be generated. */
  gap: boolean
  notes: string[]
}

export interface ChainResult {
  needs: Need[]
  results: BeatResult[]
  calls: { claudeNeeds: number; claudePicks: number; claudeVerify: number; geminiWatches: number }
  summary: ReturnType<CostLedger['summary']>
}

const isYoutube = (c: MediaCandidate): boolean => c.provider === 'youtube-excerpt'

async function probeSize(file: string, run: RunFn): Promise<{ w: number; h: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
  const m = /(\d+),(\d+)/.exec(stdout)
  return { w: m ? Number(m[1]) : 1920, h: m ? Number(m[2]) : 1080 }
}

export async function sourceFootage(beats: readonly Beat[], deps: ChainDeps, o: ChainOptions = {}): Promise<ChainResult> {
  const search = deps.search ?? searchMedia
  const download = deps.download ?? downloadExcerpt
  const calls = { claudeNeeds: 0, claudePicks: 0, claudeVerify: 0, geminiWatches: 0 }
  await mkdir(deps.workDir, { recursive: true })

  // 1. needs
  const planned = await planNeeds(beats, deps.claude, { ...(o.topic ? { topic: o.topic } : {}), ...(deps.signal ? { signal: deps.signal } : {}) })
  calls.claudeNeeds = planned.calls
  const needs = planned.needs
  const notes = new Map<string, string[]>(beats.map((b) => [b.id, []]))
  const note = (id: string, s: string): void => void notes.get(id)?.push(s)

  // 2 + 3. search and watch, beat by beat (the ledger is shared, so the order is the budget's order)
  const pools = new Map<string, MediaCandidate[]>()
  for (const need of needs) {
    if (need.mode === 'none') continue
    const found: MediaCandidate[] = []
    const providers = deps.watch || o.providers ? [...new Set([...(o.providers ?? []), ...(deps.watch ? ['youtube-excerpt'] : [])])] : undefined
    for (const query of need.queries.slice(0, 3)) {
      try {
        deps.ledger.countSearch()
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          note(need.beat, `search budget reached (${e.limit}): fewer queries run`)
          break
        }
        throw e
      }
      const r = await search(
        query,
        { kinds: need.kinds, count: o.perQuery ?? 6, ...(need.era ? { era: need.era } : {}), orientation: 'landscape', ...o.searchOptions, ...(providers ? { providers: [...(await defaultProviderIds(deps)), ...providers] } : {}) },
        deps.searchDeps
      )
      for (const e of r.errors) note(need.beat, `${e.provider}: ${e.message}`)
      found.push(...r.candidates)
    }
    // watch the best web videos: their shots replace the whole-video candidate
    const videos = dedupeCandidates(found.filter(isYoutube)).slice(0, o.watchPerBeat ?? 2)
    const others = found.filter((c) => !isYoutube(c))
    const shotCandidates: MediaCandidate[] = []
    for (const v of videos) {
      if (!deps.watch) {
        shotCandidates.push(v)
        continue
      }
      const rangeEnd = Math.min(8 * 60, Math.max(60, v.durationS ?? 300))
      const model = WATCH_DEFAULT_MODEL
      try {
        deps.ledger.reserveWatch(watchMaxCostUsd(model, rangeEnd))
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) throw e
        note(need.beat, `watch skipped (${e.what} budget ${e.limit}): the video keeps a default window`)
        shotCandidates.push(v)
        continue
      }
      try {
        const w = await deps.watch({ url: v.pageUrl, startS: 0, endS: rangeEnd, focus: need.need })
        calls.geminiWatches++
        deps.ledger.record(`watch ${v.id}`, w.costUsd, w.ms)
        const kept = filterShots(w.shots)
        shotCandidates.push(...shotsToCandidates({ id: v.id, title: v.title, ...(v.creator ? { creator: v.creator } : {}), url: v.pageUrl, previewUrl: v.previewUrl }, kept))
        if (kept.length === 0) note(need.beat, `no usable shot in « ${v.title.slice(0, 50)} » (${w.shots.length} shots logged)`)
      } catch (e) {
        if (deps.signal?.aborted) throw e
        note(need.beat, `watch failed: ${e instanceof Error ? e.message : String(e)}`)
        shotCandidates.push(v)
      }
    }
    const asked = [need.need, ...need.queries]
    pools.set(need.beat, heuristicRank(dedupeCandidates([...others, ...shotCandidates]), asked, { minMatch: 0.2 }).slice(0, o.maxCandidates ?? 10))
  }

  // 4. pick
  const items: PickItem[] = needs.filter((n) => n.mode !== 'none').map((n) => ({ id: n.beat, spoken: beats.find((b) => b.id === n.beat)!.text, need: n, candidates: pools.get(n.beat) ?? [] }))
  const picked = await pickMedia(items, deps.claude, { ...(deps.signal ? { signal: deps.signal } : {}) })
  calls.claudePicks = picked.calls
  const pickById = new Map(picked.picks.map((p) => [p.id, p]))

  // 5 + 6. cut and verify
  const results: BeatResult[] = []
  for (const beat of beats) {
    const need = needs.find((n) => n.beat === beat.id)!
    const pick = pickById.get(beat.id) ?? null
    const r: BeatResult = { beat, need, pick, gap: need.mode !== 'none' && !pick?.choice, notes: notes.get(beat.id)! }
    if (pick?.choice && pick.choice.kind === 'video' && o.cut !== false) {
      for (const source of [pick.choice, ...pick.backups.filter((b) => b.kind === 'video')].slice(0, 2)) {
        const clip = await cutOne(source, beat, deps, download).catch((e: unknown) => {
          if (deps.signal?.aborted) throw e
          r.notes.push(`cut failed: ${e instanceof Error ? e.message : String(e)}`)
          return null
        })
        if (!clip) continue
        if (o.verify !== false) {
          calls.claudeVerify++
          const { verdicts } = await verifyClips([{ id: beat.id, need: need.need, spoken: beat.text, ...(need.person ? { person: need.person } : {}), ...(need.era ? { era: need.era } : {}), file: clip.file, durationS: clip.plan.outputS }], deps.claude, deps.run, path.join(deps.workDir, 'verify', beat.id), deps.signal ? { signal: deps.signal } : {})
          clip.verdict = verdicts[0]
          if (verdicts[0]!.verdict !== 'keep') {
            r.notes.push(`${source.id}: ${verdicts[0]!.verdict} (${verdicts[0]!.problem}) ${verdicts[0]!.note}`)
            continue
          }
        }
        r.clip = clip
        break
      }
      if (!r.clip) r.gap = true
    }
    results.push(r)
  }
  return { needs, results, calls, summary: deps.ledger.summary() }
}

async function defaultProviderIds(deps: ChainDeps): Promise<string[]> {
  const { PROVIDERS } = await import('./catalog.ts')
  return (deps.searchDeps.providers ?? PROVIDERS).filter((p) => !p.optIn && !p.paid).map((p) => p.id)
}

/** Downloads the chosen shot (window = shot ± margin), snaps it to real scene cuts and cuts it. */
async function cutOne(source: MediaCandidate, beat: Beat, deps: ChainDeps, download: typeof downloadExcerpt): Promise<NonNullable<BeatResult['clip']>> {
  const range = source.excerpt ?? { startS: 0, endS: 12 }
  const win = downloadWindow(range.startS, range.endS)
  const dir = path.join(deps.workDir, 'clips', beat.id)
  let file: string
  let windowStart = win.startS
  if (isYoutube(source)) {
    const got = await download(source.pageUrl, { startS: win.startS, endS: win.endS }, dir, { run: deps.run, ...(deps.signal ? { signal: deps.signal } : {}) })
    file = got.file
    windowStart = got.range.startS
  } else {
    // a direct file (an archive film): ffmpeg reads the range from its address
    file = path.join(dir, 'segment.mp4')
    await mkdir(dir, { recursive: true })
    await deps.run('ffmpeg', ['-y', '-v', 'error', '-ss', String(win.startS), '-t', String(win.endS - win.startS), '-i', source.fileUrl, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', file], { timeoutMs: 300_000 })
  }
  // the file starts at the window's start: cut times found in it are relative to it
  const rel = await detectSceneCuts(file, deps.run)
  const plan = planCut({ shotStartS: range.startS - windowStart, shotEndS: range.endS - windowStart, cuts: rel, windowStartS: 0, windowEndS: range.endS - windowStart + (win.endS - range.endS) })
  if (!plan) throw new Error('no cut-free run of at least 2.2 s in the excerpt')
  const size = await probeSize(file, deps.run)
  const out = path.join(dir, 'clip.mp4')
  await cutClip(file, plan, out, { srcW: size.w, srcH: size.h, logo: logoOf(source) }, deps.run)
  return { file: out, plan, source }
}

const logoOf = (c: MediaCandidate): LogoCorner => (c.logo as LogoCorner | undefined) ?? 'none'

export type { Shot }
