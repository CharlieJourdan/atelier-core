// The `Producer` of the app (moteur-assemblage): P6 and P9 run the plan's compiled recipe on the app's own engines, in
// process, the same way `scripts/brain-run.mjs` does for a session — save the recipe (one recipe per clone, a new version
// per round), a project, a quote checked against the money left, the run started real, watched (spend cap, stall), its
// review gates approved (the clone engine's review is P7), then the script, the director's edit plan, the render and the
// engine's render review (decision 0086) read back. Every round after the first fills the SAME video, so the engine's
// per-video artefact store gives back every node whose fingerprint did not change (`cached`): a round re-renders only
// what its changes touched (D's request). The run id is written in the round folder as soon as it is known: an interrupted
// round waits for that run instead of paying for a new one.
import { CloudUnreachable } from './cloud-down'
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ApiHandlers } from '../../../shared/api'
import type { RunDetail } from '../../../shared/runs'
import type { ReviewReport } from '../../../engine/review'
import type { Producer, ProducedRun } from './compare/runner'
import { timelineOf } from './compare/timeline'

/** Where a clone keeps its engine objects (one recipe, one channel, the video every round fills). */
export const ENGINE_FILE = 'engine.json'
/** The engine's own render review of a round's film (decision 0086), saved beside the render. */
export const ENGINE_REVIEW_FILE = 'engine-review.json'
/** Where a clone keeps the engine objects of its FREE demo renders (decision 0102): their own video, so a demo artefact never comes
 *  back cached in a paid round. */
export const DEMO_ENGINE_FILE = 'engine-demo.json'

export interface EngineIds { recipeId: number | null; channelId: number | null; videoId: number | null }

export interface AppProducerDeps {
  api: () => ApiHandlers
  /** The clone's folder (engine.json lives there). */
  cloneDir: string
  /** A channel for this clone's runs (its presenter and voice placeholders live on it). */
  channelId(): Promise<number>
  /** Dollars per engine credit (the app's rate). */
  usdPerCredit(): number
  /** A new project on the same video, on the recipe's latest version (ProjectStore.remakeForVideo): the round's nodes
   *  whose fingerprint did not change come back from that video's artefact store. */
  remake(videoId: number): Promise<{ id: number }> | { id: number }
  /** The video's run that has not ended (queued, running, waiting), or null: one an earlier attempt started
   *  and nobody watches any more (the brain was stopped mid-round, the round folder was lost) blocks the remake. */
  openRun?(videoId: number): number | null
  /** The absolute file of a run's final video ref (`RunDetail.videoFileRef`, in the video's artefact store), or null. */
  videoFile?(videoId: number, ref: string): string | null
  /** The engine's render review stored with the run's render node, or null. */
  renderReview(runId: number): Promise<ReviewReport | null>
  /** Books the spend of a run that ended without a film (cancelled at the cap, failed, stalled): the clone's ledger. */
  onSpend?(s: { usd: number; seconds: number; what: string }): void
  pollMs?: number
  /** Nothing moved for this long → stop (the run is left for a resume). */
  stallMs?: number
  sleep?(ms: number): Promise<void>
  log?(line: string): void
  /** A free demo render (decision 0102: demo engines, nothing spent; its own video and engine file). */
  demo?: boolean
}

export function loadEngineIds(cloneDir: string, file = ENGINE_FILE): EngineIds {
  const f = path.join(cloneDir, file)
  if (!existsSync(f)) return { recipeId: null, channelId: null, videoId: null }
  return { recipeId: null, channelId: null, videoId: null, ...(JSON.parse(readFileSync(f, 'utf8')) as Partial<EngineIds>) }
}

export function saveEngineIds(cloneDir: string, ids: EngineIds, file = ENGINE_FILE): void {
  writeFileSync(path.join(cloneDir, file), JSON.stringify(ids, null, 2) + '\n', 'utf8')
}

/** The node of a run whose type starts with one of these prefixes. */
const nodeOf = (run: RunDetail, prefixes: readonly string[]): string | null => run.nodes.find((n) => prefixes.some((p) => n.type.startsWith(p)))?.nodeId ?? null

export function appProducer(d: AppProducerDeps): Producer {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const log = d.log ?? (() => {})
  const pollMs = d.pollMs ?? 5000
  const stallMs = d.stallMs ?? 30 * 60_000
  const api = (): ApiHandlers => d.api()
  const engineFile = d.demo ? DEMO_ENGINE_FILE : ENGINE_FILE
  const loadIds = (): EngineIds => loadEngineIds(d.cloneDir, engineFile)
  const saveIds = (ids: EngineIds): void => saveEngineIds(d.cloneDir, ids, engineFile)

  const bookOnce = (workDir: string, runId: number, usd: number, why: string): void => {
    const bookedFile = path.join(workDir, 'booked-runs.json')
    const booked = existsSync(bookedFile) ? (JSON.parse(readFileSync(bookedFile, 'utf8')) as number[]) : []
    if (booked.includes(runId)) return
    d.onSpend?.({ usd, seconds: 0, what: `run ${runId} without a film: ${why.slice(0, 200)}` })
    writeFileSync(bookedFile, JSON.stringify([...booked, runId]) + '\n')
  }
  /** A run that ends without a film: cancelled (a stall too, so it never spends unseen), its spend booked, the run file
   *  marked so a resume never restarts it. */
  const fail = async (runFile: string, run: RunDetail, why: string, cancel: boolean): Promise<never> => {
    if (cancel) { try { await api()['production.cancel'](run.id) } catch { /* already ended */ } }
    const usd = Math.round(run.spentCredits * d.usdPerCredit() * 10_000) / 10_000
    // the record first, then the booking once per run (a resume books a recorded run that was never booked)
    writeFileSync(runFile, JSON.stringify({ runId: run.id, ended: why.slice(0, 500), bookedUsd: usd }) + '\n')
    bookOnce(path.dirname(runFile), run.id, usd, why)
    throw new Error(why)
  }
  /** Watch a run to its end: approve its gates, cancel it past the cap or on a stall. */
  const watch = async (runId: number, maxUsd: number, runFile: string): Promise<RunDetail> => {
    let sign = ''
    let since = Date.now()
    for (;;) {
      const run = await api()['production.get'](runId)
      const spent = run.spentCredits * d.usdPerCredit()
      if (spent > maxUsd + 0.005) return fail(runFile, run, `run ${runId} spent ${spent.toFixed(3)} $, over the ${maxUsd.toFixed(2)} $ left: cancelled`, true)
      if (run.status === 'succeeded') return run
      if (run.status === 'failed' || run.status === 'cancelled') return fail(runFile, run, `run ${runId} ${run.status}: ${run.error ?? 'no reason given'}`, false)
      if (run.status === 'interrupted') { log(`run ${runId} interrupted: resumed`); await api()['production.resume'](runId) }
      if (run.status === 'waiting') {
        for (const node of run.waitingNodes) { log(`run ${runId}: approving gate ${node}`); await api()['production.approve'](runId, node) }
      }
      const now = JSON.stringify([run.status, run.progress, run.current?.nodeId, run.current?.step, run.spentCredits])
      if (now !== sign) { sign = now; since = Date.now() } else if (Date.now() - since > stallMs) return fail(runFile, run, `run ${runId}: nothing moved for ${Math.round(stallMs / 60_000)} min (${run.current?.label ?? 'no step'}): cancelled`, true)
      await sleep(pollMs)
    }
  }

  return {
    async produce({ recipe, title, idea, minutes, maxUsd, workDir }): Promise<ProducedRun> {
      const runFile = path.join(workDir, 'run.json')
      const ids = loadIds()
      let runId: number
      // a run that ended without a film (capped, failed, stalled; its spend booked) is never restarted: its record is kept
      // aside and this attempt is a new run, quoted again against the money left (the user resumed the clone)
      const record = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, 'utf8')) as { runId?: number; ended?: string; bookedUsd?: number }) : null
      const ended = record?.ended
      if (ended && record?.runId) bookOnce(workDir, record.runId, record.bookedUsd ?? 0, ended)
      if (ended && ids.videoId === null && record?.runId) {
        try { ids.videoId = (await api()['production.get'](record.runId)).videoId; saveIds(ids) } catch { /* no run to read */ }
      }
      if (ended) { let k = 1; while (existsSync(path.join(workDir, `run-ended-${k}.json`))) k++; renameSync(runFile, path.join(workDir, `run-ended-${k}.json`)); log(`previous attempt ended (${ended}): a new run`) }
      if (existsSync(runFile)) {
        const saved = JSON.parse(readFileSync(runFile, 'utf8')) as { runId: number; ended?: string }
        runId = saved.runId
        log(`resuming run ${runId}`)
      } else {
        const check = await api()['recipes.check'](recipe as never)
        if (!check.ok) throw new Error(`recipe refused: ${JSON.stringify(check.errors).slice(0, 800)}`)
        const saved = await api()['recipes.save']({ ...(ids.recipeId ? { id: ids.recipeId } : {}), doc: recipe as never, note: path.basename(workDir) })
        ids.recipeId = saved.id
        ids.channelId ??= await d.channelId()
        saveIds(ids)
        // a run of this video an earlier attempt left (the brain stopped mid-round, restarted and resumed it, but this attempt
        // has no record of it): cancelled and its spend booked, else the remake is refused and the clone stops
        const orphan = ids.videoId !== null ? d.openRun?.(ids.videoId) ?? null : null
        if (orphan !== null) {
          log(`run ${orphan} of video ${ids.videoId} was left by an earlier attempt: cancelled`)
          let left: RunDetail | null
          // a run that ended meanwhile cannot be cancelled: what it spent is read, never booked as nothing
          try { left = await api()['production.cancel'](orphan) } catch { left = await Promise.resolve(api()['production.get'](orphan)).catch(() => null) }
          for (let k = 0; k < 10 && left && !['succeeded', 'failed', 'cancelled'].includes(left.status); k++) { await sleep(Math.max(pollMs, 500)); left = await api()['production.get'](orphan) }
          bookOnce(workDir, orphan, Math.round((left?.spentCredits ?? 0) * d.usdPerCredit() * 10_000) / 10_000, `run ${orphan} left by an earlier attempt: cancelled`)
        }
        // the same video every round: its artefact store gives back the nodes this round did not change
        const project = ids.videoId
          ? await api()['projects.update']((await d.remake(ids.videoId)).id, { title, idea, adjustments: { minutes } as never })
          : await api()['projects.create']({ recipeId: saved.id, channelId: ids.channelId, title, idea, adjustments: { minutes } as never })
        writeFileSync(path.join(workDir, 'project.json'), JSON.stringify({ recipeId: saved.id, projectId: project.id, videoId: ids.videoId }) + '\n')
        if (d.demo) {
          // a free demo render: the demo engines, nothing may be spent (the watch cancels it past 0 $). Its found stand-ins
          // need the Cloud's free stock search: with no Cloud they fall back to drawn slides a judge always refuses, so the
          // clone waits for the Cloud instead of judging a meaningless demo (the Finary proof, 2026-11-06)
          const probe = await api()['projects.quote'](project.id, { real: true })
          if (probe.real && !probe.real.available) throw new CloudUnreachable(probe.real.reason)
          const started = await api()['projects.run'](project.id, { real: false })
          if (started.runId === null) throw new Error('the demo render did not start')
          runId = started.runId
        } else {
          const quote = await api()['projects.quote'](project.id, { real: true })
          writeFileSync(path.join(workDir, 'quote.json'), JSON.stringify(quote, null, 2) + '\n')
          const mode = quote.modes[quote.budgetMode ?? 'usage_max'] ?? Object.values(quote.modes)[0]
          const usd = (mode?.totalCredits ?? 0) * d.usdPerCredit()
          if (quote.real && !quote.real.available) throw new CloudUnreachable(quote.real.reason)
          if (quote.demo) throw new Error(`the engines are in demo mode (${quote.demoReason || 'Atelier Cloud not connected'}): a clone round needs real engines`)
          if (quote.real && !quote.real.available) throw new Error(`real engines unavailable: ${quote.real.reason}`)
          if (usd > maxUsd) throw new Error(`the round is quoted ${usd.toFixed(3)} $, over the ${maxUsd.toFixed(2)} $ left: not started`)
          const started = await api()['projects.run'](project.id, { real: true })
          if (started.runId === null) throw new Error('the round did not start')
          runId = started.runId
        }
        writeFileSync(runFile, JSON.stringify({ runId, projectId: project.id, ...(d.demo ? { demo: true } : {}) }) + '\n')
      }
      let run: RunDetail
      try {
        run = await watch(runId, d.demo ? 0 : maxUsd, runFile)
      } catch (e) {
        // even a failed round keeps its video: the next attempt fills it, so what it already made comes back cached
        if (ids.videoId === null) {
          try { ids.videoId = (await api()['production.get'](runId)).videoId; saveIds(ids) } catch { /* no run to read */ }
        }
        throw e
      }
      writeFileSync(path.join(workDir, 'run-report.json'), JSON.stringify({ id: run.id, status: run.status, spentCredits: run.spentCredits, nodes: run.nodes.map((n) => ({ id: n.nodeId, type: n.type, state: n.state, credits: n.credits })) }, null, 2) + '\n')
      if (ids.videoId === null) { ids.videoId = run.videoId; saveIds(ids) }
      // the package's film when the plan packages it, else the render's own file in the video's artefact store
      const packaged = run.packageDir && existsSync(run.packageDir) ? readdirSync(run.packageDir).find((f) => f.endsWith('.mp4')) ?? null : null
      const rendered = run.videoFileRef ? d.videoFile?.(run.videoId, run.videoFileRef) ?? null : null
      const filmFile = packaged && run.packageDir ? path.join(run.packageDir, packaged) : rendered && existsSync(rendered) ? rendered : null
      if (!filmFile) throw new Error(`run ${runId} gave no film`)
      const scriptNode = nodeOf(run, ['script.translate', 'script.write'])
      const directorNode = nodeOf(run, ['director.'])
      const script = scriptNode ? await api()['production.output'](runId, scriptNode) : null
      const plan = directorNode ? await api()['production.output'](runId, directorNode) : null
      writeFileSync(path.join(workDir, 'editplan.json'), JSON.stringify(plan, null, 2) + '\n')
      const review = await d.renderReview(runId)
      writeFileSync(path.join(workDir, ENGINE_REVIEW_FILE), JSON.stringify(review, null, 2) + '\n')
      const planDuration = (plan as { durationS?: unknown } | null)?.durationS
      return {
        runId: String(runId),
        spentUsd: Math.round(run.spentCredits * d.usdPerCredit() * 10_000) / 10_000,
        videoFile: filmFile,
        durationS: run.durationS ?? (typeof planDuration === 'number' && planDuration > 0 ? planDuration : minutes * 60),
        scriptText: script && script.kind === 'text' ? script.text : '',
        nodes: run.nodes.map((n) => ({ id: n.nodeId, state: n.state })),
        timeline: timelineOf(plan)
      }
    }
  }
}
