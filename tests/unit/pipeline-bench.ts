// The bench of solidite's proofs: an in-process Atelier Cloud with fake providers (loopback only, nothing paid) and an
// app core signed in to it, on which every base pipeline (avatar, voiceover, documentary, story-short) is launched for
// real (« Moteur réel ») from an imported script, run to its end with every gate approved, and read back: the quote, the
// app's spend and the Cloud's own ledger of the team. The fakes can be wrapped to inject faults (tests/soak).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BASE_PIPELINES, fromBase } from '../../src/engine/technologies'
import { FakeProvider } from '../../src/main/llm/fake'
import { fakeEngineReply } from '../../src/main/agents/fake-engine'
import { lockedError } from '../../src/main/llm/access'
import type { RemoteRenderer } from '../../src/engine/remote-render/executor'
import type { RecipeDocument } from '../../src/shared/recipes'
import type { RunDetail } from '../../src/shared/runs'
import { appCore, connect, startCloud, type AppRig, type CloudRig } from './cloud-app-helpers'

const ROOT = path.join(__dirname, '..', '..')

// The Cloud's sources import each other with .ts extensions: loaded through computed paths (as cloud-app-helpers.ts does)
type Method = (input: Record<string, unknown>, ctx: unknown) => Promise<{ costUsd?: number; [k: string]: unknown }>
interface Decl {
  id: string
  usage: string | null
  unit: string
  costUsdPerUnit: number
}
const PROVIDERS = 'providers'
const { FAKE_ADAPTERS } = (await import(`../../cloud/src/${PROVIDERS}/fakes.ts`)) as { FAKE_ADAPTERS: Record<string, Record<string, Method>> }
const { FAKE_ENGINES } = (await import(`../../cloud/src/${PROVIDERS}/engines.ts`)) as { FAKE_ENGINES: readonly Decl[] }
const { RetryableProviderError } = (await import(`../../cloud/src/${PROVIDERS}/types.ts`)) as { RetryableProviderError: new (message: string) => Error }

/** What the real engine would bill for this input (its declared public price), the way its real adapter reports it. */
function standInCost(d: Decl, input: Record<string, unknown>): number {
  const n = (k: string, dflt = 1): number => (typeof input[k] === 'number' ? (input[k] as number) : dflt)
  if (d.unit === 'image') return d.costUsdPerUnit * n('count')
  if (d.unit === 'clip' || d.unit === 'call') return d.costUsdPerUnit
  if (d.unit === 'kchars') return (d.costUsdPerUnit * String(input.text ?? '').length) / 1000
  if (d.unit === 'second') return d.costUsdPerUnit * n('seconds')
  return 0
}

/**
 * Stand-ins of the real engines (solidite): keyless « real » adapters with the engines' own ids that answer with the
 * fakes' media and bill the engine's declared price, so the Cloud captures at cost exactly as on the beta, offline and
 * free. With them the bench measures quote against capture as a real run would.
 */
/** A fault a stand-in plays on one call (tests/soak): a retryable error, a failure, a call that never answers. */
export type Fault = 'ok' | 'retryable' | 'fail' | 'hang'
export type FaultPlan = (usage: string, engine: string) => Fault

export function standIns(without: readonly string[] = [], fault: FaultPlan = () => 'ok'): { realAdapters: unknown[]; engines: string[] } {
  const decls = FAKE_ENGINES.filter((d) => d.usage !== null && FAKE_ADAPTERS[d.usage] && ['synthesize', 'generateImage', 'generateVideo', 'talkingAvatar'].includes(d.usage) && !without.some((w) => d.id === w || (w.endsWith(':') && d.id.startsWith(w))))
  const realAdapters = decls.map((d) => {
    const usage = d.usage as string
    const fake = FAKE_ADAPTERS[usage] as Record<string, Method>
    const call: Method = async (input, ctx) => {
      const f = fault(usage, d.id)
      if (f === 'retryable') throw new RetryableProviderError(`${d.id}: provider busy (soak)`)
      if (f === 'fail') throw new Error(`${d.id}: provider failed (soak)`)
      if (f === 'hang') return new Promise<never>(() => undefined)
      return { ...(await (fake[usage] as Method).call(fake, input, ctx)), costUsd: standInCost(d, input), costUnknown: undefined }
    }
    return { id: d.id, kind: 'real', keyless: true, [usage]: call }
  })
  return { realAdapters, engines: decls.map((d) => d.id) }
}
export const RESOURCES = path.join(ROOT, 'resources')

export const SCRIPT = [
  'Le ciel est bleu à cause de la lumière du soleil.',
  'Cette lumière blanche mélange toutes les couleurs, du rouge au violet.',
  'En traversant l’air, elle rencontre des milliards de minuscules molécules.',
  'Ces molécules dispersent le bleu bien plus que le rouge.',
  'Le bleu rebondit alors dans tout le ciel, et nos yeux le voient partout.',
  'Au coucher du soleil, la lumière traverse beaucoup plus d’air.',
  'Le bleu se perd en route, et il ne reste que l’orange et le rouge.',
  'Sur la Lune, sans air, le ciel reste noir même en plein jour.',
  'La prochaine fois que tu lèves les yeux, pense à ces molécules.'
].join(' ')

export const BASE_IDS = BASE_PIPELINES.map((b) => b.id)

/** The stand-in engines of one family (`voice`, `image`, `clip`, `presenter`): what a brick of that family can run on. */
export const enginesOfFamily = (family: string): string[] => standIns().engines.filter((id) => id.startsWith(`${family}:`))

interface CloudDb {
  prepare(sql: string): { all(...a: unknown[]): unknown[] }
}
export const cloudDb = (rig: CloudRig): CloudDb => (rig.t.cloud as unknown as { db: CloudDb }).db

/** The team's jobs on the Cloud, in order. */
export const cloudJobs = (rig: CloudRig): { usage: string; state: string; credits: number; provider: string }[] =>
  cloudDb(rig).prepare('SELECT usage, state, credits, provider FROM jobs WHERE team_id = ? ORDER BY rowid').all(rig.teamId) as never

/** Everything the Cloud captured from the team (its own ledger, not the app's copy). */
export const cloudCaptured = (rig: CloudRig): number =>
  -(cloudDb(rig).prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM wallet_entries WHERE team_id = ? AND kind = 'capture'").all(rig.teamId) as { n: number }[])[0]!.n || 0

export interface Bench {
  rig: CloudRig
  app: AppRig
  close(): Promise<void>
}

/** A Cloud (fakes, `cloudOptions` to createCloud) and an app signed in to it. */
export async function bench(
  o: { credits?: number; cloudOptions?: Record<string, unknown>; real?: boolean; without?: string[]; fault?: FaultPlan; cloudFetch?: typeof fetch; remoteRender?: RemoteRenderer } = {}
): Promise<Bench> {
  // `real` (default): the engines' stand-ins served for real (paidCalls on, outside the test guard, nothing reaches a network);
  // `without`: engines (or a family, `voice:`) the Cloud does not serve for real (it answers their jobs with its demo)
  const real = o.real === false ? {} : { paidCalls: true, env: { NODE_ENV: 'production' }, ...standIns(o.without, o.fault) }
  const rig = await startCloud(o.credits ?? 50_000, { ...real, ...o.cloudOptions })
  const userData = mkdtempSync(path.join(tmpdir(), 'atelier-pipeline-bench-'))
  // the engine's roles answered by the fake team's engine part, the rest « no model »: nothing ever reaches a model
  const fake = new FakeProvider((req) => {
    const reply = fakeEngineReply(req)
    if (!reply) throw lockedError()
    return reply
  })
  const app = appCore({
    paths: { userData },
    productionHost: { resourcesDir: RESOURCES, worker: { command: process.execPath, args: [] }, ...(o.remoteRender ? { remoteRender: o.remoteRender } : {}) },
    productionRuns: { resourcesDir: RESOURCES },
    chatProvider: () => fake,
    retryDelayMs: 0,
    ...(o.cloudFetch ? { cloudFetch: o.cloudFetch } : {})
  })
  await connect(app, rig)
  return {
    rig,
    app,
    close: async () => {
      app.core.close()
      await rig.t.cloud.jobs.whenIdle()
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}

/** A project on a base pipeline with the script imported, on a new channel (with clips and an avatar for a Short). */
export async function project(app: AppRig, baseId: string, o: { minutes?: number; ops?: Record<string, unknown>[]; title?: string; script?: string } = {}): Promise<number> {
  const api = app.core.api
  const base = BASE_PIPELINES.find((b) => b.id === baseId)
  if (!base) throw new Error(`no base ${baseId}`)
  const channel = await api['channels.create']({ name: `Chaîne ${baseId}`, niche: 'sciences' })
  const sample = path.join(RESOURCES, 'fake-media', 'sample.mp4')
  await api['channelClips.addFiles'](channel.id, [sample])
  const r = await api['recipes.save']({ doc: fromBase(base) as unknown as RecipeDocument })
  const declares = base.options.some((d) => d.id === 'script')
  // the stand-in engines answer every stock video with the same sample clip: the film really repeats one picture, which the render
  // refuses (decision 0102). The bench measures runs, quotes and captures, not the film's quality: its render reports instead
  const renders = (fromBase(base) as unknown as { bricks: { tech: string }[] }).bricks.some((x) => x.tech.startsWith('render.assemble'))
  const report = renders ? [{ op: 'setSetting', brick: 'render.assemble', key: 'editBlocking', value: 'report' }] : []
  const ops = [...(declares ? [{ op: 'setOption', option: 'script', value: 'import' }] : []), ...report, ...(o.ops ?? [])]
  const edited = ops.length > 0 ? await api['recipes.edit'](r.id, ops as never) : r
  const p = await api['projects.create']({
    recipeId: edited.id,
    channelId: channel.id,
    title: o.title ?? 'Le ciel en une minute',
    idea: 'Pourquoi le ciel est bleu',
    inputs: { script: o.script ?? SCRIPT },
    adjustments: { minutes: o.minutes ?? 1 }
  })
  return p.id
}

/** Runs a run to its end, approving every gate like the owner; throws past `timeoutMs` with the nodes' states (a hang). */
export async function toEnd(app: AppRig, runId: number, timeoutMs = 240_000): Promise<RunDetail> {
  const api = app.core.api
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = api['production.get'](runId) as RunDetail
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run
    if (Date.now() > deadline) throw new Error(`HANG: run ${runId} still ${run.status}: ${run.nodes.map((n) => `${n.nodeId}=${n.state}`).join(' ')}`)
    for (const node of run.waitingNodes) {
      try {
        api['production.approve'](runId, node)
      } catch {
        // decided meanwhile
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}
