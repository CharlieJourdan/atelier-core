// production-equipe: the agent team produces a video with no human in the loop when Charlie chose so. Two structural
// blockers found on the way to a real run from an imported channel:
// 1. `project.run real: true` needed Charlie's yes in the task, even on a channel he set to « tout automatique » with a
//    confirmed budget — the level's own approvals never count as his yes, so the team could only ever make demos;
// 2. a team run stopped at its owner gates (the default checkpoints topic + thumbnail, a package gate) and waited for
//    Charlie forever, even when the channel's level does not gate those steps.
import { afterEach, describe, expect, it } from 'vitest'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import type { RecipeDocument } from '../../src/shared/api'
import { fakeTeamReply } from '../../src/main/agents/fake-team'
import { FakeProvider } from '../../src/main/llm/fake'
import { PROJECT_TOOLS } from '../../src/main/orchestra/tools-project'
import { gateOfNode, realRunAllowed } from '../../src/main/orchestra/goals'
import { isSlotTitle, topicFromResult } from '../../src/main/orchestra/plan'
import type { ToolCtx } from '../../src/main/orchestra/tool-args'
import { ProjectStore, RecipeStore } from '../../src/main/production/recipes'
import { drain, rig, type Rig } from './orchestra-helpers'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'

const HOUR = 3_600_000
const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``
const runTool = PROJECT_TOOLS['project.run'] as NonNullable<(typeof PROJECT_TOOLS)[string]>

const teamDoc = (doc: Pipeline): Pipeline => ({
  $schema: 'atelier.pipeline/1',
  id: doc.id,
  version: doc.version,
  name: doc.name,
  format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 1, min: 0.5, max: 30 } },
  inputs: [
    { id: 'topic', kind: 'text', required: true, label: 'Sujet' },
    { id: 'script', kind: 'text', required: true, label: 'Script' }
  ],
  budget: { default: 'usage_max' },
  nodes: [
    { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' }, gate: 'owner' },
    { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' } },
    { id: 'voice', type: 'voice.tts@1', in: { script: 'script.text' }, params: { voice: '$style.voice' } },
    { id: 'render', type: 'render.assemble@1', in: { voice: 'voice.audio' } },
    { id: 'package', type: 'package.youtube@1', in: { video: 'render.video' }, gate: 'owner' }
  ]
})

const brick = (tech: string): RecipeDocument['bricks'][number] => ({ tech, settings: {}, engine: null, fallbacks: [], style: null })
const importDoc = (): RecipeDocument => ({
  $schema: 'atelier.recette/2',
  base: null,
  language: null,
  mix: null,
  options: {},
  inputs: {},
  name: 'Mes scripts',
  videoType: 'documentaire',
  format: { aspect: '16:9', minutes: 1 },
  capCredits: null,
  checkpoints: [],
  bricks: ['script.import@1', 'voice.tts@1', 'director.plan@1', 'visuals.fulfil@1', 'captions.make@1', 'sound.music@1', 'render.assemble@1', 'thumbnail.make@1', 'package.youtube@1'].map(brick)
})
const SCRIPT = 'Voici le script. On parle de radiateurs, de purge et de chaleur. ' + 'Il faut couper le chauffage, attendre, puis ouvrir la vis de purge. '.repeat(4)

let f: Fixture | null = null
let r: Rig | null = null
afterEach(() => {
  r?.core.close()
  f?.cleanup()
  r = null
  f = null
})

describe('the team works alone when the channel is « tout automatique »', () => {
  it('maps a run node to the goal gate it belongs to', () => {
    expect(gateOfNode('research.topic@1')).toBe('topic')
    expect(gateOfNode('script.write@1')).toBe('script')
    expect(gateOfNode('voice.tts@1')).toBe('voice')
    expect(gateOfNode('thumbnail.make@1')).toBe('thumbnail')
    expect(gateOfNode('package.youtube@1')).toBe('kit')
    expect(gateOfNode('render.assemble@1')).toBe('video')
    expect(gateOfNode('avatar.presenter@1')).toBe('video')
  })

  it('a real run is allowed alone only on confirmed goals that gate neither voice nor video', () => {
    const base = { status: 'confirmed' as const, gates: [] as ('topic' | 'voice' | 'video' | 'script' | 'thumbnail' | 'kit')[] }
    expect(realRunAllowed({ ...base, level: 'all-auto' })).toBe(true)
    expect(realRunAllowed({ ...base, level: 'custom', gates: ['topic', 'thumbnail'] })).toBe(true)
    expect(realRunAllowed({ ...base, level: 'custom', gates: ['video'] })).toBe(false)
    expect(realRunAllowed({ ...base, level: 'manual', gates: ['topic', 'script', 'voice', 'thumbnail', 'video', 'kit'] })).toBe(false)
    // recommended keeps the old rule (Charlie says yes to the real engine), a draft never spends
    expect(realRunAllowed({ ...base, level: 'recommended', gates: ['topic', 'thumbnail'] })).toBe(false)
    expect(realRunAllowed({ ...base, status: 'proposed', level: 'all-auto' })).toBe(false)
    expect(realRunAllowed(null)).toBe(false)
  })

  it('project.run real: true on a « tout automatique » channel needs no yes in the task, within its budget only', async () => {
    const launched: { id: number; real: boolean }[] = []
    let level: 'all-auto' | 'recommended' = 'all-auto'
    let budget = 1000
    const project = { id: 7, channelId: 3, videoId: 5, title: 'Purger un radiateur', idea: 'Les 4 erreurs de la purge', runId: null }
    const quote = { budgetMode: 'usage_max', modes: { usage_max: { totalCredits: 400 } } }
    const ctx = {
      env: {
        now: () => Date.parse('2026-11-03T10:00:00Z'),
        db: null,
        goals: { get: () => ({ status: 'confirmed', level, gates: level === 'all-auto' ? [] : ['topic', 'thumbnail'], budgetCredits: budget }) },
        services: {
          production: { list: () => [], get: () => null },
          teamProjects: {
            get: () => project,
            quote: async () => quote,
            run: async (id: number, real: boolean) => {
              launched.push({ id, real })
              return { runId: 11 }
            }
          }
        }
      },
      agent: { channelId: 3 },
      channelId: 3,
      approved: () => false,
      effect: () => null,
      remember: () => undefined
    } as unknown as ToolCtx
    const out = await runTool(ctx, { project: 7, real: true })
    expect(String(out)).toMatch(/REAL/)
    expect(launched).toEqual([{ id: 7, real: true }])
    // over the budget left: refused even on « tout automatique »
    budget = 100
    await expect(runTool(ctx, { project: 7, real: true })).rejects.toThrow(/left in the channel's budget/)
    // the recommended level keeps Charlie's yes
    level = 'recommended'
    budget = 1000
    await expect(runTool(ctx, { project: 7, real: true })).rejects.toThrow(/ask Charlie first/)
    expect(launched).toHaveLength(1)
    // a video whose topic was never saved is never launched (run #1 of the real trial was about « Vidéo du jeu. 5 nov. »)
    level = 'all-auto'
    Object.assign(project, { title: 'Vidéo du jeu. 5 nov. 18:00', idea: 'Vidéo du jeu. 5 nov. 18:00' })
    await expect(runTool(ctx, { project: 7 })).rejects.toThrow(/no topic yet/)
    expect(launched).toHaveLength(1)
  })

  it('a team run on a « tout automatique » channel passes its owner gates alone; a gated step still waits for Charlie', { timeout: 60_000 }, async () => {
    f = fixture()
    const fx = f
    r = rig({ core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } }, providerFor: (a) => new FakeProvider(fakeTeamReply, `fake-${a.id}`) })
    const rg = r
    const api = rg.core.api
    const o = rg.core.orchestra
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    const recipe = await api['recipes.save']({ doc: importDoc() })
    await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
    await api['projects.create']({ recipeId: recipe.id, channelId: ch.id, title: 'Purger un radiateur', idea: '', inputs: { script: SCRIPT } })
    await api['projects.create']({ recipeId: recipe.id, channelId: ch.id, title: 'Changer un joint', idea: '', inputs: { script: SCRIPT } })
    // custom level: Charlie only validates the publication kit; topics, voice and video are the team's
    o.parts.goals.save(ch.id, { slots: [5, 6].map((day) => ({ day, time: '18:00', kind: 'long' as const })), formats: [{ kind: 'long', minutes: 1, perWeek: 2 }], budgetCredits: 50_000, level: 'custom', gates: ['kit'], confirm: true })
    const settle = (): Promise<unknown> => waitFor(async () => (await api['production.list']()).every((x) => x.status !== 'running' && x.status !== 'queued'), 10_000, 'runs to settle')
    let kitAsked = 0
    for (let i = 0; i < 60; i++) {
      await drain(rg)
      await settle()
      // the planner looks at a run waiting at a gate within a minute
      rg.clock.advance(2 * 60_000)
      await drain(rg)
      await settle()
      // Charlie answers only what reaches him: the kit validations, and a run's package gate (his « kit » gate)
      for (const run of await api['production.list']()) {
        if (run.status === 'waiting') {
          expect(run.waitingNodes).toEqual(['package'])
          for (const node of run.waitingNodes) await api['production.approve'](run.id, node)
          kitAsked++
        }
      }
      for (const item of o.inbox().filter((x) => x.kind === 'validate' && x.gate !== null)) {
        expect(item.gate, `${item.title}: ${item.body}`).toBe('kit')
        o.answer(item.id, { choice: 'Valider' })
      }
      await settle()
      const slots = rg.core.db.prepare('SELECT status FROM orch_plan_slots WHERE channel_id = ?').all(ch.id) as { status: string }[]
      if (slots.length === 2 && slots.every((s) => s.status === 'ready')) break
      rg.clock.advance(HOUR)
    }
    const slots = rg.core.db.prepare('SELECT status FROM orch_plan_slots WHERE channel_id = ?').all(ch.id) as { status: string }[]
    expect(slots.map((s) => s.status)).toEqual(['ready', 'ready'])
    const runs = await api['production.list']()
    expect(runs.every((x) => x.status === 'succeeded')).toBe(true)
    // the topic gate of each run was passed by the level, said in the events; the package gate reached Charlie
    const auto = rg.core.db.prepare(`SELECT text FROM orch_events WHERE type = 'auto-approved' AND text LIKE '%research%'`).all()
    expect(auto).toHaveLength(2)
    expect(kitAsked).toBe(2)
  })

  it("a slot's video is made at the goals' length, not the pipeline's default, and the brief says it", { timeout: 60_000 }, async () => {
    f = fixture()
    const fx = f
    r = rig({ core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } }, providerFor: (a) => new FakeProvider(fakeTeamReply, `fake-${a.id}`) })
    const rg = r
    const api = rg.core.api
    const o = rg.core.orchestra
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    const recipe = await api['recipes.save']({ doc: importDoc() })
    await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
    // a 3-minute format: the pipeline's own default (1 min here, 12 for avatar@1) must not decide the video's length
    o.parts.goals.save(ch.id, { slots: [{ day: 5, time: '18:00', kind: 'long' as const }], formats: [{ kind: 'long', minutes: 3, perWeek: 1 }], budgetCredits: 50_000, level: 'all-auto', confirm: true })
    for (let i = 0; i < 30; i++) {
      await drain(rg)
      const projects = await api['projects.list']({ channelId: ch.id })
      if (projects.length > 0) break
      rg.clock.advance(HOUR)
    }
    const [p] = await api['projects.list']({ channelId: ch.id })
    expect(p).toBeDefined()
    expect((await api['projects.get'](p!.id)).adjustments.minutes).toBe(3)
    const briefs = rg.core.db.prepare(`SELECT json_extract(payload, '$.brief') AS b FROM orch_tasks WHERE json_extract(payload, '$.plan.step') = 'script'`).all() as { b: string }[]
    expect(briefs[0]?.b).toMatch(/Target length: 3 min/)
  })

  it('the topic a step chose reaches the video and the run, even when the lead only stated it', () => {
    expect(isSlotTitle('Vidéo du jeu. 5 nov. 18:00')).toBe(true)
    expect(isSlotTitle('Purger vos radiateurs')).toBe(false)
    const t = topicFromResult('Sujet décidé pour le jeu. 5 nov. 18:00 (3 min) : « Purger vos radiateurs : les 4 erreurs que je vois dans toutes les caves ». Angle : erreurs vues en 40 ans.')
    expect(t?.title).toBe('Purger vos radiateurs : les 4 erreurs que je vois dans toutes les caves')
    expect(t?.idea).toMatch(/Angle : erreurs vues en 40 ans/)
    expect(topicFromResult('')).toBeNull()
  })

  it('a slot video gets the topic the topic step stated, and its run is about it', { timeout: 60_000 }, async () => {
    f = fixture()
    const fx = f
    r = rig({ core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } }, providerFor: (a) => new FakeProvider(fakeTeamReply, `fake-${a.id}`) })
    const rg = r
    const api = rg.core.api
    const o = rg.core.orchestra
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    const recipe = await api['recipes.save']({ doc: importDoc() })
    await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
    o.parts.goals.save(ch.id, { slots: [{ day: 5, time: '18:00', kind: 'long' as const }], formats: [{ kind: 'long', minutes: 1, perWeek: 1 }], budgetCredits: 50_000, level: 'all-auto', confirm: true })
    for (let i = 0; i < 40; i++) {
      await drain(rg)
      if ((await api['production.list']()).length > 0) break
      rg.clock.advance(HOUR)
    }
    const [run] = await api['production.list']()
    expect(run).toBeDefined()
    expect(run!.topic).toMatch(/^Sujet décidé : « Les bons gestes/)
    const video = rg.core.db.prepare('SELECT title, brief FROM videos WHERE id = ?').get(run!.videoId) as { title: string; brief: string }
    expect(isSlotTitle(video.title)).toBe(false)
    expect(video.title).toMatch(/^Les bons gestes/)
  })

  it('a video whose run is over can be remade on a fresh project; never while its run goes on', { timeout: 60_000 }, async () => {
    f = fixture()
    const fx = f
    r = rig({ core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } }, providerFor: (a) => new FakeProvider(fakeTeamReply, `fake-${a.id}`) })
    const rg = r
    const api = rg.core.api
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    const recipe = await api['recipes.save']({ doc: importDoc() })
    const first = await api['projects.create']({ recipeId: recipe.id, channelId: ch.id, title: 'Purger un radiateur', idea: '', inputs: { script: SCRIPT }, adjustments: { minutes: 2 } })
    const store = new ProjectStore(rg.core.db, new RecipeStore(rg.core.db), null as never)
    const launched = await api['projects.run'](first.id)
    const videoId = (await api['production.get'](launched.runId as number)).videoId
    await waitFor(async () => ['succeeded', 'waiting'].includes((await api['production.get'](launched.runId as number)).status), 10_000, 'the run to settle')
    const status = (await api['production.get'](launched.runId as number)).status
    if (status === 'waiting') expect(() => store.remakeForVideo(videoId)).toThrow(/pas finie/)
    await api['production.cancel'](launched.runId as number)
    await waitFor(async () => (await api['production.get'](launched.runId as number)).status === 'cancelled', 10_000, 'the cancel')
    const fresh = store.remakeForVideo(videoId)
    expect(fresh.id).not.toBe(first.id)
    expect(fresh.runId).toBeNull()
    expect(fresh.adjustments.minutes).toBe(2)
    expect(store.forVideo(videoId)?.id).toBe(fresh.id)
  })

  it('a QC that refused the video holds the slot (no « kit prêt » on a bad video) and tells the lead to remake it, once', { timeout: 60_000 }, async () => {
    f = fixture()
    const fx = f
    const qcResult = 'QC vidéo : FAIL, sujet hors brief, ne pas publier.'
    const qcSays = (req: { prompt: string }): string | null =>
      /Brief: Planned step "qc"/.test(req.prompt) ? qcResult + block([{ type: 'done', result: qcResult }]) : null
    r = rig({
      core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } },
      providerFor: (a) => new FakeProvider((req) => qcSays(req) ?? fakeTeamReply(req), `fake-${a.id}`)
    })
    const rg = r
    const api = rg.core.api
    const o = rg.core.orchestra
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    const recipe = await api['recipes.save']({ doc: importDoc() })
    await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
    await api['projects.create']({ recipeId: recipe.id, channelId: ch.id, title: 'Purger un radiateur', idea: '', inputs: { script: SCRIPT } })
    o.parts.goals.save(ch.id, { slots: [{ day: 5, time: '18:00', kind: 'long' as const }], formats: [{ kind: 'long', minutes: 1, perWeek: 1 }], budgetCredits: 50_000, level: 'all-auto', confirm: true })
    const settle = (): Promise<unknown> => waitFor(async () => (await api['production.list']()).every((x) => x.status !== 'running' && x.status !== 'queued'), 10_000, 'runs to settle')
    for (let i = 0; i < 30; i++) {
      await drain(rg)
      await settle()
      rg.clock.advance(2 * 60_000)
      await drain(rg)
      if (rg.core.db.prepare(`SELECT 1 FROM orch_events WHERE type = 'plan-warning' AND text LIKE '%contrôle qualité%'`).get()) break
      rg.clock.advance(HOUR)
    }
    const slot = rg.core.db.prepare('SELECT status FROM orch_plan_slots WHERE channel_id = ?').get(ch.id) as { status: string }
    expect(slot.status).toBe('planned')
    const later = rg.core.db.prepare(`SELECT step FROM orch_plan_steps WHERE channel_id = ? AND step IN ('thumbnail','kit')`).all(ch.id)
    expect(later).toHaveLength(0)
    const remakes = rg.core.db.prepare(`SELECT json_extract(payload, '$.brief') AS b FROM orch_tasks WHERE title LIKE 'Refaire%'`).all() as { b: string }[]
    expect(remakes).toHaveLength(1)
    expect(remakes[0]!.b).toMatch(/fresh: true/)
    // another pass: still one remake task
    rg.clock.advance(HOUR)
    await drain(rg)
    expect(rg.core.db.prepare(`SELECT 1 FROM orch_tasks WHERE title LIKE 'Refaire%'`).all()).toHaveLength(1)
  })
})

describe('the dashboard tells the subscription from the production budget', () => {
  it('Claude turns are said to be on the subscription; each channel shows its credits spent against its budget', async () => {
    const rg = rig({
      providerFor: (a) =>
        new FakeProvider(
          (req) =>
            req.prompt.includes('Lis le tableau')
              ? { text: '', toolCalls: [{ name: 'dashboard_read', args: {} }], afterTools: ([res]) => `vu${block([{ type: 'done', result: res?.text ?? '' }])}` }
              : fakeTeamReply(req),
          `fake-${a.id}`
        )
    })
    r = rg
    const api = rg.core.api
    const o = rg.core.orchestra
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    o.parts.goals.save(ch.id, { budgetCredits: 700, level: 'all-auto', confirm: true })
    const lead = rg.core.db.prepare('SELECT id FROM orch_agents WHERE slug = ?').get(`lead-${ch.id}`) as { id: number }
    const t = o.enqueue({ assigneeId: lead.id, kind: 'plan', title: 'Tableau', brief: 'Lis le tableau' })
    for (let i = 0; i < 12 && o.parts.queue.get(t.id).status !== 'done'; i++) await o.tick({ wait: true })
    const text = o.parts.queue.get(t.id).result ?? ''
    expect(text).toMatch(/subscription/i)
    expect(text).not.toMatch(/^Spent this month \(settled\)/m)
    expect(text).toMatch(/#\d+ Marcel: 0 of 700 credits/)
  })
})

describe('a production step that launched nothing is followed up', () => {
  it('the lead gets ONE « Lancer la fabrication » task, which launches the run', { timeout: 60_000 }, async () => {
    f = fixture()
    const fx = f
    let refused = 0
    const rg = rig({
      core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } },
      providerFor: (a) =>
        new FakeProvider((req) => {
          // the first production turn refuses to launch (as the real lead did, misreading its budget)
          if (/Brief: Planned step "production"/.test(req.prompt) && refused++ === 0) return 'Pas lancé.' + block([{ type: 'done', result: 'Production NON lancée.' }])
          if (/^Title: Lancer la fabrication/m.test(req.prompt)) {
            const video = /video #(\d+)/.exec(req.prompt)?.[1]
            return { text: '', toolCalls: [{ name: 'project_run', args: { video: Number(video) } }], afterTools: ([res]) => `ok${block([{ type: 'done', result: res?.text ?? '' }])}` }
          }
          return fakeTeamReply(req)
        }, `fake-${a.id}`)
    })
    r = rg
    const api = rg.core.api
    const o = rg.core.orchestra
    const ch = await api['channels.create']({ name: 'Marcel', niche: 'chauffage' })
    const recipe = await api['recipes.save']({ doc: importDoc() })
    await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
    await api['projects.create']({ recipeId: recipe.id, channelId: ch.id, title: 'Purger un radiateur', idea: '', inputs: { script: SCRIPT } })
    o.parts.goals.save(ch.id, { slots: [{ day: 5, time: '18:00', kind: 'long' as const }], formats: [{ kind: 'long', minutes: 1, perWeek: 1 }], budgetCredits: 50_000, level: 'all-auto', confirm: true })
    for (let i = 0; i < 30 && (await api['production.list']()).length === 0; i++) {
      await drain(rg)
      rg.clock.advance(HOUR)
    }
    expect(await api['production.list']()).toHaveLength(1)
    expect(rg.core.db.prepare(`SELECT 1 FROM orch_tasks WHERE title LIKE 'Lancer la fabrication%'`).all()).toHaveLength(1)
  })
})
