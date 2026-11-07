// The real CloneServices (moteur-assemblage, decision 0095): what A, B, C and D built, plugged into the app's machines.
//   channel/eyes/synthesiser (A): public listing, whole-video analysis (eyes 0085 + local measures + the looker), synthesis
//   bricks/presenters/voices (B): measured feasibility, his own clones or a look-alike of the same type, a catalogue voice
//   cloud (C's compiler + the app's quote), runs (D's planRunner over the app producer: one video per clone, rounds reuse
//   its unchanged nodes), frames/curves/review/judge/improver (D's compare services + the engine's render review, 0086)
//   disk: free space of the data drive. Every model call or engine spend that is paid lands in the clone's ledger.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import path from 'node:path'
import type { CorpusVideo, PipelinePlan, VideoAnalysis } from '../../../shared/clone'
import { DEFAULT_REAL_VOICE_LIST } from '../../../shared/default-voices'
import type { WholeVideoLog } from '../../../shared/shot-log'
import type { AsrService } from '../../../engine/services'
import type { RunFn } from '../../../engine/sourcing/types'
import type { Labeller } from '../../../engine/watch/label'
import { videoKey } from '../../../engine/watch/cache'
import { downloadArgs } from '../../eyes/whole'
import { realChannel } from './analysis/channel'
import { AnalysisEyes } from './analysis/eyes'
import { realSynthesiser } from './analysis/synthesis'
import type { AskFn } from './compare/judge'
import { planRunner, withFoundStandIns, withoutWatermark, type Producer } from './compare/runner'
import { compareServices } from './compare/services'
import { bricksService } from './definition/bricks'
import { peopleServices, type CatalogueVoice, type OwnClonesPort } from './definition/people'
import type { PresenterPicturesPort } from './definition/lookalike'
import { fullReview } from './engine-review'
import type { CloneServices } from './services'
import { ARTEFACTS, CloneStore } from './store'
import { PipelinePlan as PlanSchema, VideoAnalysis as AnalysisSchema } from '../../../shared/clone'

/** The voices the engine may speak with when the channel is not the user's: the Cloud's default catalogue (ai33 Pro
 *  premade narrators, never a person's clone), described by what they sound like. */
export const CATALOGUE_VOICES: readonly CatalogueVoice[] = DEFAULT_REAL_VOICE_LIST.map((v) => ({
  id: v.id,
  name: v.name,
  languages: ['*'],
  descriptors: /brian/i.test(v.name) ? ['male', 'man', 'deep', 'resonant', 'adult', 'narrator', 'calm'] : ['male', 'man', 'warm', 'middle-aged', 'storyteller', 'narrator', 'gentle']
}))

export interface CloneMachines {
  /** The data folder (`userData`): clones live in `<dataDir>/clones/`. */
  dataDir: string
  run: RunFn
  /** The whole-video watcher (eyes 0085). */
  watch(input: { url: string; title: string; durationS: number | null; file?: string }, signal?: AbortSignal): Promise<WholeVideoLog>
  cached(url: string): Promise<boolean>
  asr: AsrService
  /** The vision/reading model of P2 (Haiku through the routes). */
  looker: Labeller
  lookerOnSubscription(): boolean
  /** One model call with pictures and NO conversation (the blind judge, the improver's pass). */
  judgeAsk: AskFn
  fixAsk: AskFn
  own: OwnClonesPort
  pictures(cloneId: string): PresenterPicturesPort
  /** The app's producer; `demo`: free demo renders (decision 0102). */
  producer(cloneId: string, o?: { demo?: boolean }): Producer
  /** Dollars per finished minute the app's engines would bill for this plan (nothing spent). */
  quoteUsdPerMinute(plan: PipelinePlan, cloneId: string): Promise<number>
  now(): string
}

/** Where a corpus video's normal download is kept for the clone (P2 measures it, P7 cuts the passage from it). Files the
 *  user dropped in `<dataDir>/clone-copies/<key>.mp4` (his own copy of a video he has rights to) win over a download. */
export function referenceCopy(m: Pick<CloneMachines, 'dataDir' | 'run'>, store: CloneStore): (video: CorpusVideo) => Promise<string | null> {
  return async (video) => {
    const supplied = path.join(m.dataDir, 'clone-copies', `${videoKey(video.url)}.mp4`)
    if (existsSync(supplied)) return supplied
    const dir = store.file(path.join('refs', video.id))
    const found = (): string | null => (existsSync(dir) ? readdirSync(dir).find((f) => /^v\.(mp4|mkv|webm|mov)$/.test(f)) ?? null : null)
    if (found()) return path.join(dir, found()!)
    mkdirSync(dir, { recursive: true })
    try {
      await m.run('yt-dlp', downloadArgs(video.url, dir), { timeoutMs: 1_800_000 })
    } catch {
      // YouTube often refuses this computer's address: never got around; the analysis says what it could not measure
      rmSync(dir, { recursive: true, force: true })
      return null
    }
    const f = found()
    return f ? path.join(dir, f) : null
  }
}

export function realCloneServices(m: CloneMachines, cloneId: string): CloneServices {
  const store = new CloneStore(m.dataDir, cloneId)
  const copy = referenceCopy(m, store)
  const plan = (): PipelinePlan | null => { try { return store.load(ARTEFACTS.plan, PlanSchema) } catch { return null } }
  const analysis = (id: string): VideoAnalysis | null => { try { return store.load(ARTEFACTS.analysis(id), AnalysisSchema) } catch { return null } }
  const eyes = new AnalysisEyes({
    watch: (i, s) => m.watch(i, s),
    cached: (url) => m.cached(url),
    run: m.run,
    asr: m.asr,
    looker: m.looker,
    lookerOnSubscription: m.lookerOnSubscription(),
    scratchDir: path.join(m.dataDir, 'tmp', 'clone-p2'),
    cloneId,
    now: m.now,
    localCopy: copy,
    fetchImage: async (url) => { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null }
  })
  const compare = compareServices({
    run: m.run,
    cloneDir: store.dir,
    dataDir: m.dataDir,
    referenceFile: async (v) => {
      const f = await copy(v)
      if (!f) throw new Error(`no local copy of the reference ${v.url}: the passage cannot be cut (drop the file in clone-copies/)`)
      return f
    },
    analysis,
    plan,
    judgeAsk: m.judgeAsk,
    fixAsk: m.fixAsk,
    onSpend: (s) => store.spend(s)
  })
  return {
    channel: realChannel(m.run),
    eyes: { analyse: (v, dir) => eyes.analyse(v, dir), quoteUsd: (v) => eyes.quoteUsd(v) },
    synthesiser: realSynthesiser,
    bricks: bricksService(),
    ...peopleServices({ own: m.own, pictures: m.pictures(cloneId), catalogue: CATALOGUE_VOICES }),
    runs: planRunner({ producer: m.producer(cloneId), dataDir: m.dataDir, analysis }),
    demo: (() => {
      const r = planRunner({ producer: m.producer(cloneId, { demo: true }), dataDir: m.dataDir, analysis })
      // found stand-ins (decision 0109): free stock photographs and the presenter's photograph instead of drawn slides
      const found = (plan: PipelinePlan, def: Parameters<typeof withFoundStandIns>[1]): PipelinePlan => ({ ...plan, recipe: withFoundStandIns(plan.recipe, def) as PipelinePlan['recipe'] })
      return {
        produce: (plan, def, passage, dir) => r.produce(found(plan, def), def, passage, dir, 0),
        unmarked: (plan, def, passage, dir) => r.produce({ ...found(plan, def), recipe: withoutWatermark(found(plan, def).recipe) as PipelinePlan['recipe'] }, def, passage, dir, 0)
      }
    })(),
    ...compare,
    review: fullReview(compare.review, { cloneDir: store.dir, plan }),
    cloud: { quoteUsdPerMinute: (p) => m.quoteUsdPerMinute(p, cloneId) },
    disk: { freeGb: () => freeGb(m.dataDir) },
    now: m.now
  }
}

export async function freeGb(dir: string): Promise<number> {
  const s = await statfs(dir)
  return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10
}

/** End of a clone (spec §3): intermediate files go — the reference downloads and cut passages, P2's scratch frames —;
 *  the artefacts, the evidence frames, the rounds' renders and the example (paid media) stay. Returns what was removed. */
export function cleanIntermediates(store: CloneStore, dataDir: string): string[] {
  const gone: string[] = []
  const drop = (abs: string, rel: string): void => { if (existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); gone.push(rel) } }
  drop(store.file('refs'), 'refs')
  drop(store.file('p7-reference'), 'p7-reference')
  for (const e of readdirSync(store.dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('p2-')) drop(path.join(store.dir, e.name, '_frames'), `${e.name}/_frames`)
  }
  drop(path.join(dataDir, 'tmp', 'clone-p2', store.cloneId), 'tmp/clone-p2')
  return gone
}

/** Copies a file into the clone folder (a portrait the presenter service made) and returns its absolute path. */
export function keepIn(store: CloneStore, rel: string, from: string): string {
  const to = store.file(rel)
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(from, to)
  return to
}
