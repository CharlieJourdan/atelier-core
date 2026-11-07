// The cloning engine as the app builds it (core.ts → `appCloneEngine`): the real services of create.ts over the app's
// own machines — the whole-video watcher (eyes 0085), the local speech recogniser, Claude through the routes and the
// ledger (role `clone_look` fast tier to label frames, `clone_judge` / `clone_improver` balanced tier, no conversation),
// the channel presenters and voices (his own clones; a look-alike made from words on the clone's own channel), the
// recipes, projects and runs (the app producer), the Cloud's quote. Nothing here decides anything about a style.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PipelinePlan } from '../../../shared/clone'
import type { ApiHandlers, ChangeTopic } from '../../../shared/api'
import type { ChannelRow } from '../../../shared/workflow'
import type { ReviewReport } from '../../../engine/review'
import { compileRecipe } from '../../../engine/technologies/compile'
import { videoKey } from '../../../engine/watch/cache'
import { localWhisperService } from '../../../engine/media/whisper'
import type { RunFn } from '../../../engine/sourcing/types'
import type { Db } from '../../db'
import { claudeLabeller } from '../../eyes/labeller'
import type { WholeWatcher } from '../../eyes/whole'
import type { AskInput, AskResult } from '../../llm/ask'
import type { ChannelPresenters } from '../presenters/service'
import type { RecipeStore } from '../recipes'
import { ProjectStore } from '../recipes'
import { readNodes, readRun } from '../runs/rows'
import type { ProductionRuns } from '../runs/service'
import type { ChannelVoices } from '../voices/service'
import { appProducer, loadEngineIds, saveEngineIds } from './app-producer'
import type { AskFn } from './compare/judge'
import { realCloneServices, type CloneMachines } from './create'
import { CloneEngine } from './engine'
import { planQuoteService } from './pipeline/quote'
import { CloneStore } from './store'

export const CLONE_LOOK_ROLE = 'clone_look'
export const CLONE_JUDGE_ROLE = 'clone_judge'
export const CLONE_IMPROVER_ROLE = 'clone_improver'

export interface AppCloneDeps {
  db: Db
  dataDir: string
  run: RunFn
  watcher: WholeWatcher | null
  ask(input: AskInput): Promise<AskResult>
  /** The routes put this role on the user's subscription (it bills nothing). */
  onSubscription(role: string): boolean
  api(): ApiHandlers
  recipes: RecipeStore
  runs(): ProductionRuns | null
  presenters: Pick<ChannelPresenters, 'portrait' | 'angles' | 'styleFor'>
  voices: Pick<ChannelVoices, 'styleFor'>
  channels: { list(): ChannelRow[]; create(input: { name: string; ownerGates: [] }): { id: number }; setArchived(id: number, archived: boolean): unknown }
  usdPerCredit(): number
  /** The Cloud wallet's available credits (null when not signed in): a look-alike's pictures are paid from it. */
  walletCredits?(): Promise<number | null>
  notify(topic: ChangeTopic): void
  now?: () => Date
  resumeOnStart?: boolean
}

/** The most a look-alike's pictures may cost (a portrait + up to six angles on the Cloud's image engine, ≈ 0.04 $ each,
 *  rounded up): refused when the clone's budget left is under it. A ceiling said as such, not a measure. */
export const LOOKALIKE_MAX_USD = 0.4

const TOKENS = { inputTokens: 9000, outputTokens: 2500, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** A channel of the workspace that is this YouTube channel (its UC id or its handle in the link), or null. */
export function channelOfUrl(channels: readonly ChannelRow[], url: string): ChannelRow | null {
  const u = url.toLowerCase()
  const handle = /@([\w.-]+)/.exec(u)?.[1] ?? null
  const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
  return channels.find((c) => !c.archived && ((c.youtubeChannelId && u.includes(c.youtubeChannelId.toLowerCase())) || (handle !== null && slug(c.name) === slug(handle)))) ?? null
}

function safeJson<T>(file: string): T | null {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null } catch { return null }
}

export function appCloneEngine(d: AppCloneDeps): CloneEngine {
  const now = d.now ?? (() => new Date())
  const projects = (): ProjectStore => {
    const runs = d.runs()
    if (!runs) throw new Error('Les fabrications ne sont pas disponibles ici.')
    return new ProjectStore(d.db, d.recipes, runs)
  }
  // the judge writes a defect list for ten axes: room for it (a cut answer is unusable and paid again)
  const asker = (role: string, tier: 'fast' | 'balanced', system: string): AskFn => async (o) => {
    const r = await d.ask({ role, tier, system, prompt: o.prompt, ...(o.images.length ? { images: o.images } : {}), maxTokens: 12000, estimate: TOKENS })
    return { text: r.text, costUsd: r.costUsd, model: r.model }
  }
  /** The clone's own channel for its runs (its placeholders live there), made once. */
  const channelFor = (cloneId: string): number => {
    const dir = new CloneStore(d.dataDir, cloneId).dir
    const ids = loadEngineIds(dir)
    if (ids.channelId !== null && d.channels.list().some((c) => c.id === ids.channelId)) return ids.channelId
    const made = d.channels.create({ name: `Clonage ${cloneId}`.slice(0, 80), ownerGates: [] })
    saveEngineIds(dir, { ...ids, channelId: made.id })
    return made.id
  }
  const renderReview = async (runId: number): Promise<ReviewReport | null> => {
    try {
      const row = readRun(d.db, runId)
      const render = readNodes(d.db, runId).find((x) => x.type.startsWith('render.assemble@'))
      const runs = d.runs()
      if (!render?.fingerprint || !runs) return null
      const stored = await runs.storeFor(row.video_id).getRun(render.fingerprint)
      return (stored?.outputs.video as { meta?: { review?: ReviewReport } } | undefined)?.meta?.review ?? null
    } catch {
      return null
    }
  }
  /** C's plan quote over the app's own: the compiled recipe quoted by the engines for its length, on the clone's channel. */
  const quote = (plan: PipelinePlan, cloneId: string): Promise<number> => planQuoteService({
    quoteRecipe: async (recipe, minutes) => {
      const runs = d.runs()
      if (!runs) throw new Error('Les fabrications ne sont pas disponibles ici.')
      const check = d.recipes.check(recipe)
      if (!check.ok) throw new Error(`the plan's recipe is refused: ${JSON.stringify(check.errors).slice(0, 600)}`)
      const channelId = channelFor(cloneId)
      const compiled = compileRecipe(recipe as never, d.recipes.registry, { channel: d.recipes.production(channelId), id: `clone-${cloneId}`, version: plan.definitionVersion })
      if (!compiled.ok) throw new Error(`the plan's recipe does not compile: ${JSON.stringify(compiled.errors).slice(0, 600)}`)
      // the engines quote 0.5–30 min; the dollars asked are for `minutes`, scaled from the length really quoted
      const quoted = Math.min(30, Math.max(0.5, minutes))
      const q = await runs.quote({ channelId, topic: 'quote', minutes: quoted, real: true }, compiled.pipeline)
      const mode = q.modes[q.budgetMode ?? 'usage_max'] ?? Object.values(q.modes)[0]
      return (mode?.totalCredits ?? 0) * d.usdPerCredit() * (minutes / quoted)
    }
  }).quoteUsdPerMinute(plan)
  /** Runs a paid presenter call and books what the wallet lost into the clone's ledger. */
  const booked = async <T>(cloneId: string, what: string, f: () => Promise<T>): Promise<T> => {
    const store = new CloneStore(d.dataDir, cloneId)
    const answers = safeJson<{ testBudgetUsd?: number }>(store.file('p0-brief.json'))
    const left = (answers?.testBudgetUsd ?? 0) - store.spent()
    if (left < LOOKALIKE_MAX_USD) throw new Error(`the look-alike's pictures may cost up to ${LOOKALIKE_MAX_USD} $ and only ${left.toFixed(2)} $ are left: not made`)
    const before = (await d.walletCredits?.().catch(() => null)) ?? null
    const started = Date.now()
    try {
      return await f()
    } finally {
      const after = before === null ? null : ((await d.walletCredits?.().catch(() => null)) ?? null)
      const usd = before !== null && after !== null ? Math.max(0, before - after) * d.usdPerCredit() : 0
      new CloneStore(d.dataDir, cloneId).spend({ usd: Math.round(usd * 10_000) / 10_000, seconds: Math.round((Date.now() - started) / 1000), what: before === null ? `${what} (wallet not readable: cost not measured)` : what })
    }
  }
  const machines: CloneMachines = {
    dataDir: d.dataDir,
    run: d.run,
    watch: async (i, s) => {
      if (!d.watcher) throw new Error('the whole-video watcher runs only in the app (a data folder)')
      // a copy the user supplied is read locally first (free), before any download or model reading of the link
      const supplied = path.join(d.dataDir, 'clone-copies', `${videoKey(i.url)}.mp4`)
      const file = i.file ?? (existsSync(supplied) ? supplied : null)
      return (await d.watcher.watch({ url: i.url, title: i.title, ...(file ? { file, downloaded: true } : {}) }, s)).log
    },
    cached: async (url) => (d.watcher ? (await d.watcher.cached(url)) !== null : false),
    asr: localWhisperService({ platform: process.platform, cacheDir: path.join(d.dataDir, 'cache', 'asr') }),
    looker: claudeLabeller((input) => d.ask({ ...input, role: CLONE_LOOK_ROLE })),
    lookerOnSubscription: () => d.onSubscription(CLONE_LOOK_ROLE),
    judgeAsk: asker(CLONE_JUDGE_ROLE, 'balanced', 'You compare two video excerpts you have never seen. Answer exactly in the format asked.'),
    fixAsk: asker(CLONE_IMPROVER_ROLE, 'balanced', 'You are Atelier\'s cloning engine improver. Answer exactly in the format asked.'),
    own: {
      presenter: async (url) => {
        const c = channelOfUrl(d.channels.list(), url)
        return c ? d.presenters.styleFor(c.id)?.id ?? null : null
      },
      voice: async (url) => {
        const c = channelOfUrl(d.channels.list(), url)
        return c ? d.voices.styleFor(c.id)?.voice ?? null : null
      }
    },
    pictures: (cloneId) => ({
      // a look-alike from words only, on the clone's own channel; its pictures are kept in the clone folder
      // (`presenter/<name>/portrait.png`, `angle-<n>.png`): the ref is that folder
      portrait: async (prompt, name) => {
        const channelId = channelFor(cloneId)
        const store = new CloneStore(d.dataDir, cloneId)
        const folder = store.file(path.join('presenter', name))
        const meta = path.join(folder, 'presenter.json')
        if (existsSync(meta)) return folder
        const made = await booked(cloneId, 'p4 look-alike portrait', () => d.presenters.portrait({ channelId, name: 'Présentateur provisoire', description: prompt.slice(0, 1000) }))
        const ref = d.presenters.styleFor(channelId)
        if (!ref?.portrait) throw new Error('the look-alike portrait was not kept')
        mkdirSync(folder, { recursive: true })
        writeFileSync(path.join(folder, 'portrait.png'), readFileSync(ref.portrait))
        writeFileSync(meta, JSON.stringify({ presenterId: made.id, channelId }) + '\n')
        return folder
      },
      angles: async (folder, angles) => {
        const { presenterId, channelId, angles: made } = JSON.parse(readFileSync(path.join(folder, 'presenter.json'), 'utf8')) as { presenterId: number; channelId: number; angles?: number }
        if (typeof made === 'number') return made // already bought (a resume after a refused P4 never pays twice)
        const r = await booked(cloneId, 'p4 look-alike angles', () => d.presenters.angles(presenterId, { count: Math.min(6, Math.max(3, angles.length)) }))
        const ref = d.presenters.styleFor(channelId)
        // named by the spec's angle numbers (C's recipe reads `<folder>/angle-<angle>.png`; angle 0 is the portrait)
        writeFileSync(path.join(folder, 'angle-0.png'), readFileSync(path.join(folder, 'portrait.png')))
        // each spec angle gets a made picture of ITS framing (the service cycles framings in its own order; by index a « close »
        // angle could get the « wide » picture), then the unused ones in order
        const left = [...(ref?.angles ?? [])]
        angles.forEach((spec, i) => {
          const want = (spec as { framing?: string }).framing
          const k = left.findIndex((a) => a.framing === want)
          const a = k >= 0 ? left.splice(k, 1)[0] : left.shift()
          if (a) writeFileSync(path.join(folder, `angle-${(spec as { angle?: number }).angle ?? i + 1}.png`), readFileSync(a.file))
        })
        writeFileSync(path.join(folder, 'presenter.json'), JSON.stringify({ presenterId, channelId, angles: r.kept.length }) + '\n')
        return r.kept.length
      }
    }),
    producer: (cloneId, o) => appProducer({
      ...(o?.demo ? { demo: true } : {}),
      api: d.api,
      cloneDir: new CloneStore(d.dataDir, cloneId).dir,
      channelId: async () => channelFor(cloneId),
      usdPerCredit: d.usdPerCredit,
      remake: (videoId) => projects().remakeForVideo(videoId),
      openRun: (videoId) => { const p = projects().forVideo(videoId); return p?.runId != null && p.runStatus !== null && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(p.runStatus) ? p.runId : null },
      videoFile: (videoId, ref) => { const runs = d.runs(); return runs ? path.join(runs.artefactsDir(videoId), ref) : null },
      onSpend: (s) => new CloneStore(d.dataDir, cloneId).spend(s),
      renderReview
    }),
    quoteUsdPerMinute: quote,
    now: () => now().toISOString()
  }
  return new CloneEngine({
    dataDir: d.dataDir,
    services: (id) => realCloneServices(machines, id),
    notify: () => d.notify('production'),
    now,
    resumeOnStart: d.resumeOnStart ?? false,
    // a deleted clone takes its own workspace channel (and with it its look-alike) out of the channel list
    onRemove: (cloneId) => {
      const ids = loadEngineIds(new CloneStore(d.dataDir, cloneId).dir)
      if (ids.channelId !== null && d.channels.list().some((c) => c.id === ids.channelId)) d.channels.setArchived(ids.channelId, true)
    },
    log: (line) => console.warn(`[clone] ${line}`)
  })
}
