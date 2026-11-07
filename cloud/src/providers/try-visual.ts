// `npm run cloud -- providers bench-visual --plan PLAN.json --out DIR [--budget-usd 15] [--parallel 4] [--team TEAM_ID]` (chantier
// vrais-tests, 2026-11-01): the still and clip model benchmark, run by hand, outside the wallet. The plan is a JSON list of calls
// { name, engine, prompt, negative?, image? (the start still of a clip), refs? (reference pictures of a still), seconds?, width?,
// height? }, picture paths relative to the plan file. Every engine must be really live (paidCalls on, listed in realEngines, its key
// in the vault). The budget is a hard ceiling: before a call starts, the spend so far, the calls running (counted at their estimate)
// and this call's estimate (the registry line × its units × 2, a margin for the provider's own rounding) must fit in it; a call
// that does not fit is skipped, never started. The real cost of each call (the provider's dry-run quote or usage) replaces its
// estimate. Results go to DIR/results.jsonl (one line per call) and DIR/<name>.<ext>; a name already done is not paid twice.
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { USAGE_INPUTS } from '../../../src/shared/cloud-api.ts'
import { clipLengthFor, isClipEngine, isImageEngine } from '../../../src/shared/visual-engines.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { REMOTE_LINK_TTL_S } from '../jobs.ts'
import { mimeFor } from '../storage.ts'
import { runUsage, type ProviderAdapter } from './types.ts'
import { engineUsd } from './visual-common.ts'

export const BENCH_VISUAL_MAX_USD = 15
/** Each call's estimate is its registry price × units × this margin (dry runs and token usage can be above the « from » price). */
export const ESTIMATE_MARGIN = 2

export const BenchItem = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/),
  engine: z.string(),
  prompt: z.string().min(1).max(4000),
  negative: z.string().max(500).optional(),
  image: z.string().optional(),
  refs: z.array(z.string()).max(4).optional(),
  seconds: z.number().int().min(1).max(15).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional()
})
export type BenchItem = z.infer<typeof BenchItem>

export interface BenchVisualArgs {
  plan: string | undefined
  out: string | undefined
  budgetUsd?: number | undefined
  parallel?: number | undefined
  team?: string | undefined
}

export interface BenchRow {
  name: string
  engine: string
  status: 'ok' | 'failed' | 'skipped'
  costUsd: number
  quotedUsd?: number | null
  ms?: number
  file?: string
  error?: string
}

/** What one call is counted at before it runs. PURE. */
export function benchEstimateUsd(item: BenchItem): number {
  const units = isClipEngine(item.engine) ? (unitIsClip(item.engine) ? 1 : clipLengthFor(item.engine, item.seconds ?? 4)) : 1
  return engineUsd(item.engine) * units * ESTIMATE_MARGIN
}
const unitIsClip = (engine: string): boolean => /^clip:veo31-/.test(engine)

export async function benchVisual(cloud: Cloud, a: BenchVisualArgs, actor: string, publicUrl: string | undefined, say: (line: string) => void): Promise<BenchRow[]> {
  const say1 = (line: string): void => say(cloud.vault.mask(line))
  const bad = (m: string): never => {
    throw new CloudError('bad_request', m)
  }
  if (!a.plan) return bad('--plan PLAN.json is required')
  if (!a.out) return bad('--out DIR is required')
  const budget = a.budgetUsd ?? BENCH_VISUAL_MAX_USD
  if (!(budget > 0) || budget > BENCH_VISUAL_MAX_USD) return bad(`--budget-usd is a positive number of dollars, at most ${BENCH_VISUAL_MAX_USD}`)
  const parallel = Math.max(1, Math.min(8, a.parallel ?? 4))
  const planPath = resolve(a.plan)
  const parsed = z.array(BenchItem).safeParse(JSON.parse(readFileSync(planPath, 'utf8')))
  if (!parsed.success) return bad(`the plan is not a list of calls: ${parsed.error.issues[0]?.message ?? ''}`)
  const items = parsed.data
  const base = dirname(planPath)
  const outDir = resolve(a.out)
  mkdirSync(outDir, { recursive: true })
  const resultsPath = join(outDir, 'results.jsonl')
  const done = new Set(
    existsSync(resultsPath)
      ? readFileSync(resultsPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as BenchRow)
          .filter((r) => r.status === 'ok')
          .map((r) => r.name)
      : []
  )

  // every engine live and every picture present before the first call
  const adapters = new Map<string, ProviderAdapter>()
  for (const it of items) {
    if (!isImageEngine(it.engine) && !isClipEngine(it.engine)) return bad(`${it.name}: ${it.engine} is not a still or clip engine`)
    const usage = isClipEngine(it.engine) ? 'generateVideo' : 'generateImage'
    if (!adapters.has(it.engine)) {
      const r = cloud.registry.resolveFor(usage, { engine: it.engine })
      if (r.status !== 'real') return bad(`${it.engine} is not live: ${r.reason ?? 'unknown reason'}`)
      adapters.set(it.engine, r.adapter)
    }
    for (const p of [it.image, ...(it.refs ?? [])]) if (p && !existsSync(resolve(base, p))) return bad(`${it.name}: ${p} does not exist`)
  }
  const todo = items.filter((i) => !done.has(i.name))
  const worst = todo.reduce((s, i) => s + benchEstimateUsd(i), 0)
  say1(`Plan : ${todo.length} appels (${items.length - todo.length} déjà faits), estimation haute ${worst.toFixed(3)} $, plafond ${budget.toFixed(2)} $`)

  const team = a.team ?? cloud.accounts.teams()[0]?.id
  if (!team) return bad('no team in this Cloud: create one first (admin user add)')
  const publicBase = publicUrl?.replace(/\/+$/, '')
  const link = (id: string): { name: string; url: string } => {
    const art = cloud.storage.forTeam(team, id)
    const direct = cloud.storage.presign(art, REMOTE_LINK_TTL_S)
    if (direct) return { name: art.name, url: direct }
    if (!publicBase) return bad('set config.json "publicUrl" (this Cloud must run and be reachable) or use "s3" storage')
    return { name: art.name, url: publicBase + cloud.storage.signedPath(art.id, REMOTE_LINK_TTL_S).path }
  }
  const uploaded = new Map<string, string>()
  const artefactOf = async (p: string): Promise<string> => {
    const path = resolve(base, p)
    const known = uploaded.get(path)
    if (known) return known
    const name = path.replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9._-]/g, '_')
    const art = await cloud.storage.put(team, null, { name, mime: mimeFor(path), bytes: readFileSync(path) }, false)
    uploaded.set(path, art.id)
    return art.id
  }

  let spent = 0
  let reserved = 0
  const rows: BenchRow[] = []
  const record = (r: BenchRow): void => {
    rows.push(r)
    appendFileSync(resultsPath, JSON.stringify(r) + '\n')
    say1(`${r.name} ${r.engine}: ${r.status}${r.status === 'ok' ? `, ${r.costUsd.toFixed(4)} $, ${((r.ms ?? 0) / 1000).toFixed(0)} s` : r.error ? ` (${r.error})` : ''}`)
  }

  const runOne = async (it: BenchItem): Promise<void> => {
    const est = benchEstimateUsd(it)
    if (spent + reserved + est > budget + 1e-9) return record({ name: it.name, engine: it.engine, status: 'skipped', costUsd: 0, error: `the budget left (${(budget - spent - reserved).toFixed(3)} $) does not cover ${est.toFixed(3)} $` })
    reserved += est
    const adapter = adapters.get(it.engine) as ProviderAdapter
    const started = Date.now()
    let ref: string | null = null
    try {
      cloud.registry.assertCallable(adapter)
      cloud.audit.record(actor, 'provider.try', isClipEngine(it.engine) ? 'generateVideo' : 'generateImage', { provider: adapter.id, engine: it.engine, name: it.name })
      const ctx = {
        signal: AbortSignal.timeout(40 * 60_000),
        progress: () => undefined,
        secret: () => cloud.vault.readForAdapter(adapter.secretName as string, adapter.id),
        jobId: `bench-${it.name}`,
        artefact: link,
        artefactUrl: (id: string) => link(id).url,
        callbackUrl: () => bad('not available in a bench'),
        providerRef: () => ref,
        setProviderRef: (r: string | null) => void (ref = r)
      }
      const out = isClipEngine(it.engine)
        ? await runUsage(adapter, 'generateVideo', USAGE_INPUTS.generateVideo.parse({ prompt: it.prompt, seconds: it.seconds ?? 4, aspect: '16:9', engine: it.engine, ...(it.negative ? { negative: it.negative } : {}), ...(it.image ? { imageArtefactId: await artefactOf(it.image) } : {}) }), ctx)
        : await runUsage(
            adapter,
            'generateImage',
            USAGE_INPUTS.generateImage.parse({
              prompt: it.prompt,
              width: it.width ?? 1280,
              height: it.height ?? 720,
              engine: it.engine,
              ...(it.negative ? { negative: it.negative } : {}),
              ...(it.refs?.length ? { referenceArtefactIds: await Promise.all(it.refs.map(artefactOf)) } : {})
            }),
            ctx
          )
      spent += out.costUsd
      const f = out.files[0]
      const file = f ? join(outDir, `${it.name}.${f.name.split('.').pop() ?? 'bin'}`) : undefined
      if (f && file) writeFileSync(file, f.bytes)
      const quoted = out.data.quotedUsd
      record({ name: it.name, engine: it.engine, status: 'ok', costUsd: out.costUsd, quotedUsd: typeof quoted === 'number' ? quoted : null, ms: Date.now() - started, ...(file ? { file } : {}) })
    } catch (err) {
      // a failed generation is not billed by these providers (documented); a dry run or an upload may still have happened: count nothing
      record({ name: it.name, engine: it.engine, status: 'failed', costUsd: 0, ms: Date.now() - started, error: cloud.vault.mask(err instanceof Error ? err.message : String(err)).slice(0, 300) })
    } finally {
      reserved -= est
    }
  }

  const queue = [...todo]
  await Promise.all(
    Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await runOne(it)
    })
  )
  say1(`Dépense : ${spent.toFixed(4)} $ sur ${budget.toFixed(2)} $. Résultats : ${resultsPath}`)
  return rows
}
