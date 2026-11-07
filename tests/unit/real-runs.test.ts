// production-16's proof, « Moteur réel » end to end on a dev Atelier Cloud (in-process, fake providers, loopback only, nothing
// paid): a project on the base pipeline « Avatar » (avatar@1, imported script) launched from the app with the switch on
// goes through the Cloud's jobs — quote first, each job's hold captured on success, the ledger shows hold and capture —,
// comes back rendered here, and shows which engine each brick used (the Cloud's demo here) and its real cost. With the
// switch off nothing reaches the Cloud's paid jobs; a brick that fails releases its hold; a run cannot go real while the
// app is signed out.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { avatarBase, fromBase } from '../../src/engine/technologies'
import { FakeProvider } from '../../src/main/llm/fake'
import { fakeEngineReply } from '../../src/main/agents/fake-engine'
import { lockedError } from '../../src/main/llm/access'
import { t } from '../../src/shared/fr'
import type { RecipeDocument } from '../../src/shared/recipes'
import type { RunDetail, RunQuote } from '../../src/shared/runs'
import { appCore, connect, startCloud, type AppRig, type CloudRig } from './cloud-app-helpers'
import { startTestBrain } from './headless-helpers'
import { UPLOADS_AT_ONCE } from '../../src/engine/cloud-busy'

const ROOT = path.join(__dirname, '..', '..')
// the Cloud's own fakes, through a computed path so the app's typecheck never walks into cloud/ (as cloud-app-helpers.ts does)
type FakeMethod = (input: never, ctx: never) => Promise<unknown>
const FAKES = 'fakes'
const { fakeImage, fakeStock } = (await import(`../../cloud/src/providers/${FAKES}.ts`)) as { fakeImage: { generateImage: FakeMethod }; fakeStock: { searchStock: FakeMethod } }
const RESOURCES = path.join(ROOT, 'resources')

const SCRIPT = [
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

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

interface CloudDb {
  prepare(sql: string): { all(...a: unknown[]): unknown[] }
}
const cloudDb = (rig: CloudRig): CloudDb => (rig.t.cloud as unknown as { db: CloudDb }).db

/** The Cloud's own ledger of the team: kinds of its wallet entries, in order. */
const ledgerKinds = (rig: CloudRig): string[] =>
  (cloudDb(rig).prepare('SELECT kind FROM wallet_entries WHERE team_id = ? ORDER BY rowid').all(rig.teamId) as { kind: string }[]).map((r) => r.kind)
const jobsOnCloud = (rig: CloudRig): { usage: string; state: string; credits: number; provider: string }[] =>
  cloudDb(rig).prepare('SELECT usage, state, credits, provider FROM jobs WHERE team_id = ? ORDER BY rowid').all(rig.teamId) as never

async function rigs(credits = 20_000, cloudOptions?: Record<string, unknown>, provider?: FakeProvider, cloudFetch?: typeof fetch): Promise<{ rig: CloudRig; app: AppRig }> {
  const rig = await startCloud(credits, cloudOptions)
  const userData = mkdtempSync(path.join(tmpdir(), 'atelier-real-runs-'))
  // the engine's roles answered by the fake team's engine part, the rest « no model »: nothing ever reaches a model
  const fake =
    provider ??
    new FakeProvider((req) => {
      const reply = fakeEngineReply(req)
      if (!reply) throw lockedError()
      return reply
    })
  const app = appCore({
    paths: { userData },
    productionHost: { resourcesDir: RESOURCES, worker: { command: process.execPath, args: [] } },
    productionRuns: { resourcesDir: RESOURCES },
    chatProvider: () => fake,
    retryDelayMs: 0,
    ...(cloudFetch ? { cloudFetch } : {})
  })
  cleanups.push(async () => {
    app.core.close()
    await rig.t.cloud.jobs.whenIdle()
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  return { rig, app }
}

// the stand-in engines answer every stock clip with the same sample: the film really repeats one picture, which the render refuses
// (decision 0102); these runs test the Cloud's jobs and money, not the film's quality, so their render reports instead
const REPORT_ONLY = { op: 'setSetting', brick: 'render.assemble', key: 'editBlocking', value: 'report' }

async function avatarProject(app: AppRig, o: { minutes?: number; channelId?: number; ops?: Record<string, unknown>[] } = {}): Promise<number> {
  const api = app.core.api
  const channelId = o.channelId ?? (await api['channels.create']({ name: 'Le Labo', niche: 'sciences' })).id
  const r = await api['recipes.save']({ doc: fromBase(avatarBase) as unknown as RecipeDocument })
  const edited = await api['recipes.edit'](r.id, [{ op: 'setOption', option: 'script', value: 'import' }, REPORT_ONLY, ...(o.ops ?? [])])
  const p = await api['projects.create']({
    recipeId: edited.id,
    channelId,
    title: 'Le ciel en une minute',
    idea: 'Pourquoi le ciel est bleu',
    inputs: { script: SCRIPT },
    adjustments: { minutes: o.minutes ?? 1 }
  })
  return p.id
}

/** Runs a project's run to its end, approving every gate like the owner. */
async function toEnd(app: AppRig, runId: number, timeoutMs = 240_000): Promise<RunDetail> {
  const api = app.core.api
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = api['production.get'](runId) as RunDetail
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status}: ${run.nodes.map((n) => `${n.nodeId}=${n.state}`).join(' ')}`)
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

describe('« Moteur réel » on a dev Cloud with fake providers', () => {
  it('an avatar@1 run goes through the Cloud jobs (quote, hold, capture) and comes back rendered', { timeout: 300_000 }, async () => {
    const { rig, app } = await rigs()
    await connect(app, rig)
    const api = app.core.api
    const project = await avatarProject(app)

    const quote = await api['projects.quote'](project, { real: true })
    expect(quote.real).toEqual({ available: true, reason: '' })
    expect(quote.demo).toBe(false)
    expect(quote.debited).toBe(true)
    expect(quote.balance.available).toBe(20_000)
    expect(quote.modes.usage_max.totalCredits).toBeGreaterThan(0)

    const launched = await api['projects.run'](project, { real: true })
    const run = await toEnd(app, launched.runId as number)
    expect(run.error, JSON.stringify(run.nodes.filter((n) => n.error).map((n) => [n.nodeId, n.error]))).toBeNull()
    expect(run.status).toBe('succeeded')
    expect(run.cloud).toBe(true)
    expect(run.demo).toBe(false)
    expect(run.videoFileRef).not.toBeNull()

    // every paid brick went through the Cloud: voice, presenter, stills, clips
    const jobs = jobsOnCloud(rig)
    const usages = new Set(jobs.map((j) => j.usage))
    for (const u of ['synthesize', 'talkingAvatar', 'generateImage', 'generateVideo']) expect(usages, u).toContain(u)
    expect(jobs.every((j) => j.state === 'succeeded')).toBe(true)
    // the Cloud's ledger: one hold per job, captured on success
    const kinds = ledgerKinds(rig)
    expect(kinds.filter((k) => k === 'hold').length).toBe(jobs.length)
    expect(kinds.filter((k) => k === 'capture').length).toBe(jobs.length)
    const spent = jobs.reduce((s, j) => s + j.credits, 0)
    expect(rig.t.cloud.wallet.state(rig.teamId)).toMatchObject({ balance: 20_000 - spent, held: 0 })

    // the run view: each brick's engine (the Cloud's demo here) and its real cost, summed in the run
    const paid = run.nodes.filter((n) => n.engines.length > 0)
    expect(paid.length).toBeGreaterThan(0)
    for (const n of paid) {
      expect(n.engines.every((e) => !e.real && e.id.startsWith('fake-'))).toBe(true)
      expect(n.credits).toBe(n.engines.reduce((s, e) => s + e.credits, 0))
    }
    expect(run.nodes.find((n) => n.nodeId === 'avatar' || n.type.startsWith('avatar.speak'))?.engines[0]?.id).toBe('fake-avatar')
    expect(run.spentCredits).toBe(spent)
    // solidite: the run holds itself to the quote the owner saw (the Cloud's engine prices). This dev Cloud bills its demo
    // answers at the grid (play money), so spend against quote is proven with real-priced engines in quote-capture.test.ts
    expect(run.quoteCredits).toBe(quote.modes[run.budgetMode].totalCredits)

    // production-17: a job the app stopped waiting for (the first real run's clip, given up by its brick after 15 min) ends on
    // the Cloud later and is captured there; the run view asks the Cloud about it, and the brick shows the Cloud's capture
    const clipNode = (r: RunDetail) => r.nodes.find((n) => n.engines.some((e) => e.jobs > 0) && n.type.startsWith('clip.make'))
    const before = clipNode(run)?.credits ?? 0
    const clipJob = (app.core.db.prepare(`SELECT job_id AS id FROM video_run_jobs WHERE run_id = ? AND usage = 'generateVideo' LIMIT 1`).get(run.id) as { id: string } | undefined)?.id
    expect(clipJob).toBeDefined()
    app.core.db.prepare(`UPDATE video_run_jobs SET state = 'queued', credits = 0 WHERE job_id = ?`).run(clipJob as string)
    app.core.db.prepare(`UPDATE video_run_nodes SET credits = (SELECT COALESCE(SUM(credits), 0) FROM video_run_jobs WHERE run_id = ? AND node_id = video_run_nodes.node_id) WHERE run_id = ?`).run(run.id, run.id)
    const captured = (cloudDb(rig).prepare('SELECT credits FROM jobs WHERE id = ?').all(clipJob) as { credits: number }[])[0]?.credits ?? 0
    expect(captured).toBeGreaterThan(0)
    expect(clipNode(api['production.get'](run.id) as RunDetail)?.credits).toBe(before - captured)
    let seen = api['production.get'](run.id) as RunDetail
    for (let i = 0; i < 50 && clipNode(seen)?.credits !== before; i++) {
      await new Promise((r) => setTimeout(r, 100))
      seen = api['production.get'](run.id) as RunDetail
    }
    expect(clipNode(seen)?.credits).toBe(before)
    expect(clipNode(seen)?.engines.reduce((s, e) => s + e.credits, 0)).toBe(before)
    expect(seen.spentCredits).toBe(spent)
  })

  it('with the switch off, nothing reaches the Cloud’s paid jobs', { timeout: 300_000 }, async () => {
    const { rig, app } = await rigs()
    await connect(app, rig)
    const api = app.core.api
    const project = await avatarProject(app)
    const quote = await api['projects.quote'](project)
    expect(quote.demo).toBe(true)
    expect(quote.real.available).toBe(true)
    const launched = await api['projects.run'](project)
    const run = await toEnd(app, launched.runId as number)
    expect(run.status).toBe('succeeded')
    expect(run.cloud).toBe(false)
    expect(run.demo).toBe(true)
    expect(run.nodes.every((n) => n.engines.length === 0)).toBe(true)
    expect(jobsOnCloud(rig)).toEqual([])
    expect(ledgerKinds(rig)).toEqual(['grant'])
  })

  it('a brick that fails releases its hold', { timeout: 300_000 }, async () => {
    // the presenter's provider refuses every job on the Cloud: the holds of those jobs go back
    const refusing = { id: 'fake-avatar', kind: 'fake', talkingAvatar: () => Promise.reject(new Error('le fournisseur refuse ce portrait')) }
    const { rig, app } = await rigs(20_000, { fakes: { talkingAvatar: refusing } })
    await connect(app, rig)
    const api = app.core.api
    const project = await avatarProject(app)
    const launched = await api['projects.run'](project, { real: true })
    const run = await toEnd(app, launched.runId as number)
    expect(run.status).toBe('failed')
    const avatarJobs = jobsOnCloud(rig).filter((j) => j.usage === 'talkingAvatar')
    expect(avatarJobs.length).toBeGreaterThan(0)
    expect(avatarJobs.every((j) => j.state === 'failed')).toBe(true)
    const kinds = ledgerKinds(rig)
    expect(kinds.filter((k) => k === 'release').length).toBe(avatarJobs.length)
    expect(rig.t.cloud.wallet.state(rig.teamId).held).toBe(0)
    const avatar = run.nodes.find((n) => n.type.startsWith('avatar.speak'))
    expect(avatar?.state).toBe('error')
    expect(avatar?.credits).toBe(0)
  })

  it('an expired Claude Code sign-in stops the run at once with the French message and the action (production-17)', { timeout: 300_000 }, async () => {
    const expired = new FakeProvider(() => ({ text: '', error: 'Failed to authenticate: OAuth session expired and could not be refreshed' }))
    const { rig, app } = await rigs(20_000, undefined, expired)
    await connect(app, rig)
    const api = app.core.api
    const project = await avatarProject(app)
    const launched = await api['projects.run'](project, { real: true })
    const run = await toEnd(app, launched.runId as number, 120_000)
    expect(run.status).toBe('failed')
    expect(run.error).toBe(t('runs.error.claudeLogin'))
    expect(run.error).toMatch(/Ouvre un terminal, tape claude, puis \/login/)
    // the imported script went through without a model; the first step that needs Claude says why, never « Erreur interne »
    expect(run.nodes.find((n) => n.nodeId === 'script')?.state).toBe('done')
    const stopped = run.nodes.filter((n) => n.state === 'error')
    expect(stopped.length).toBeGreaterThan(0)
    for (const n of stopped) expect(n.error).toMatchObject({ code: 'missing_tool', message: t('runs.error.claudeLogin') })
    expect(JSON.stringify(run)).not.toContain(t('runs.error.internal'))
    // and nothing was left running: no node still pending or running, no credit held on the Cloud
    expect(run.nodes.some((n) => ['pending', 'queued', 'running'].includes(n.state))).toBe(false)
    expect(rig.t.cloud.wallet.state(rig.teamId).held).toBe(0)
  })

  it('a busy Cloud (429 on uploads) is waited out: a 1-minute real run sends at most UPLOADS_AT_ONCE files at once and goes to the end (production-17)', { timeout: 300_000 }, async () => {
    // the first real 60 s run: the Cloud took 2 uploads per team and answered the 3rd 429 at once; the app gave up
    // (« injoignable »). Here every upload is answered 429 (Retry-After: 1) on its first FOUR tries (the scheduler's 3 retries
    // alone gave up), and the Cloud's own budget is 1
    let inFlight = 0
    let most = 0
    let busy = 0
    const tries = new Map<string, number>()
    const cloudFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (!(init?.method === 'POST' && url.includes('/v1/uploads?'))) return fetch(input, init)
      const sha = new URL(url).searchParams.get('sha256') ?? url
      inFlight++
      most = Math.max(most, inFlight)
      try {
        const n = (tries.get(sha) ?? 0) + 1
        tries.set(sha, n)
        if (n <= 4) {
          busy++
          return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'this team already sends files' } }), { status: 429, headers: { 'retry-after': '1', 'content-type': 'application/json' } })
        }
        return await fetch(input, init)
      } finally {
        inFlight--
      }
    }
    const { rig, app } = await rigs(20_000, { server: { bodies: { maxUploadsPerTeam: 1 } } }, undefined, cloudFetch)
    await connect(app, rig)
    const api = app.core.api
    const project = await avatarProject(app, { minutes: 1 })
    const launched = await api['projects.run'](project, { real: true })
    const run = await toEnd(app, launched.runId as number)
    expect(run.error, JSON.stringify(run.nodes.filter((n) => n.error).map((n) => [n.nodeId, n.error]))).toBeNull()
    expect(run.status).toBe('succeeded')
    expect(busy).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(UPLOADS_AT_ONCE)
    expect(jobsOnCloud(rig).every((j) => j.state === 'succeeded')).toBe(true)
    // the clips and the presenter really went through the Cloud (no clip fell back to its still)
    for (const u of ['generateVideo', 'talkingAvatar']) expect(jobsOnCloud(rig).some((j) => j.usage === u), u).toBe(true)
    expect(JSON.stringify(run)).not.toMatch(/injoignable|clip impossible/)
  })

  it('stills that cannot be made stop the render clearly, and the next run remakes them instead of reusing the filled ones (production-17)', { timeout: 300_000 }, async () => {
    // the 60 s run of 01/11: nine stills failed (a busy Cloud) and were filled with their neighbour's picture; the next run
    // reused that output as it was and played one picture for 34 s. Here the stills fail after the first one, the bank too
    const healthy = { broken: true, stills: 0 }
    const generateImage = async (input: unknown, ctx: unknown) => {
      const prompt = String((input as { prompt?: unknown }).prompt ?? '')
      // the thumbnails (« no letters ») always work; the stills fail after the first one while the provider is broken
      if (healthy.broken && !/no letters/i.test(prompt) && ++healthy.stills > 1) throw new Error('le moteur d’images est en panne')
      return fakeImage.generateImage(input as never, ctx as never)
    }
    const searchStock = async (input: unknown, ctx: unknown) => {
      if (healthy.broken) throw new Error('la banque d’images est en panne')
      return fakeStock.searchStock(input as never, ctx as never)
    }
    const { rig, app } = await rigs(20_000, { fakes: { generateImage: { id: 'fake-image', kind: 'fake', generateImage }, searchStock: { id: 'fake-stock', kind: 'fake', searchStock } } })
    await connect(app, rig)
    const api = app.core.api
    const project = await avatarProject(app, { minutes: 1 })
    const first = await toEnd(app, (await api['projects.run'](project, { real: true })).runId as number)
    expect(first.status).toBe('failed')
    const render = first.nodes.find((n) => n.nodeId === 'render')
    expect(render?.state).toBe('error')
    expect(JSON.stringify(render?.error)).toMatch(/Le rendu s’arrête.*relance la fabrication/)
    // the provider is back: the next run makes the stills again (the filled output is provisional), and the film is sound
    healthy.broken = false
    const second = await toEnd(app, (await api['projects.run'](project, { real: true })).runId as number)
    expect(second.error, JSON.stringify(second.nodes.filter((n) => n.error).map((n) => [n.nodeId, n.error]))).toBeNull()
    expect(second.status).toBe('succeeded')
    expect(second.nodes.find((n) => n.nodeId === 'visuals')?.state).toBe('done')
  })

  it('signed out, a run cannot go real (and the quote says why)', async () => {
    const { app } = await rigs()
    const api = app.core.api
    const project = await avatarProject(app)
    const quote = await api['projects.quote'](project, { real: true })
    expect(quote.real.available).toBe(false)
    expect(quote.real.reason).toMatch(/Connecte l’app à Atelier Cloud/)
    expect(quote.demo).toBe(true)
    await expect(api['projects.run'](project, { real: true })).rejects.toThrow(/Connecte l’app à Atelier Cloud/)
    expect((await api['projects.get'](project)).runId).toBeNull()
  })

  it('the presenter look a real run returns is kept on the channel’s presenter and reused by its next run', { timeout: 300_000 }, async () => {
    // a presenter engine that registers the face it was given (HeyGen's photo look) answers with its id
    const FAKES = 'fakes'
    const { fakeAvatar } = (await import(`../../cloud/src/providers/${FAKES}.ts`)) as {
      fakeAvatar: { talkingAvatar(input: { avatarId: string }, ctx: unknown): Promise<{ data: Record<string, unknown> }> }
    }
    const asked: string[] = []
    const registering = {
      id: 'fake-avatar',
      kind: 'fake',
      async talkingAvatar(input: { avatarId: string }, ctx: unknown) {
        asked.push(input.avatarId)
        const r = await fakeAvatar.talkingAvatar(input, ctx)
        return { ...r, data: { ...r.data, registration: 'look-0001' } }
      }
    }
    const { rig, app } = await rigs(20_000, { fakes: { talkingAvatar: registering } })
    await connect(app, rig)
    const api = app.core.api
    const ch = await api['channels.create']({ name: 'Le Labo', niche: 'sciences' })
    const presenter = await api['channelPresenters.portrait']({ channelId: ch.id, name: 'Léa', description: 'Une présentatrice de sciences, la trentaine, souriante, pull bleu.' })
    expect(presenter.registeredEngines).toEqual([])
    const ops = [{ op: 'setEngine', brick: 'avatar.speak', engine: 'presenter:heygen-mcp' }]

    const first = await api['projects.run'](await avatarProject(app, { channelId: ch.id, ops }), { real: true })
    expect((await toEnd(app, first.runId as number)).status).toBe('succeeded')
    const kept = (await api['channelPresenters.list'](ch.id)).find((x) => x.id === presenter.id)
    expect(kept?.registeredEngines).toEqual(['presenter:heygen-mcp'])
    expect(asked).not.toContain('look-0001')

    const before = asked.length
    const second = await api['projects.run'](await avatarProject(app, { channelId: ch.id, ops }), { real: true })
    expect((await toEnd(app, second.runId as number)).status).toBe('succeeded')
    expect(asked.slice(before).length).toBeGreaterThan(0)
    expect(asked.slice(before).every((id) => id === 'look-0001')).toBe(true)
  })

  it('the headless brain makes the same real run, asked through its RPC (the team computer)', { timeout: 300_000 }, async () => {
    const rig = await startCloud(20_000)
    const brain = await startTestBrain({ cloud: false })
    cleanups.push(async () => {
      await brain.stop()
      await rig.t.cloud.jobs.whenIdle()
    })
    await connect({ core: brain.core } as AppRig, rig)
    const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
      const r = await brain.rpc(method, args)
      const body = r.body as { ok: boolean; value?: T; error?: { message: string } }
      if (!body.ok) throw new Error(`${method}: ${body.error?.message ?? r.status}`)
      return body.value as T
    }
    const ch = await call<{ id: number }>('channels.create', { name: 'Le Labo', niche: 'sciences' })
    const base = await call<{ id: number }>('recipes.fromBase', 'avatar@1')
    const recipe = await call<{ id: number }>('recipes.edit', base.id, [{ op: 'setOption', option: 'script', value: 'import' }, REPORT_ONLY])
    const project = await call<{ id: number }>('projects.create', { recipeId: recipe.id, channelId: ch.id, title: 'Le ciel', idea: 'Pourquoi le ciel est bleu', inputs: { script: SCRIPT }, adjustments: { minutes: 1 } })
    const quote = await call<RunQuote>('projects.quote', project.id, { real: true })
    expect(quote.real.available).toBe(true)
    const launched = await call<{ runId: number }>('projects.run', project.id, { real: true })
    const deadline = Date.now() + 240_000
    let run = await call<RunDetail>('production.get', launched.runId)
    while (!['succeeded', 'failed', 'cancelled'].includes(run.status) && Date.now() < deadline) {
      for (const node of run.waitingNodes) await call('production.approve', launched.runId, node).catch(() => null)
      await new Promise((r) => setTimeout(r, 200))
      run = await call<RunDetail>('production.get', launched.runId)
    }
    expect(run.status).toBe('succeeded')
    expect(run.cloud).toBe(true)
    const jobs = jobsOnCloud(rig)
    expect(new Set(jobs.map((j) => j.usage))).toEqual(new Set(['synthesize', 'generateImage', 'generateVideo', 'talkingAvatar']))
    expect(run.spentCredits).toBe(jobs.reduce((n, j) => n + j.credits, 0))
  })
})
