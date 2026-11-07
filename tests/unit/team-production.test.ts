// agents-production (chantier B): the team produces videos on the app's real production path, with the deterministic
// fake team (the ATELIER_FAKE_LLM=1 responder, which now works the planner's steps with the real project tools). A channel
// with confirmed goals and three scripts imported with « J'ai mon script »: each planned slot takes one of them (no topic,
// no script to write), the lead prepares and launches its project (a demo run: nothing spent), Charlie answers the run's
// gate and the thumbnail validations in his inbox, one forced failure reaches the inbox and Atlas with its French reason,
// and its relaunch finishes; the videos end `ready`. Then « Tout arrêter » really stops a fabrication. Light test nodes
// (z1-runs-fixtures) stand in for the engine's (no ffmpeg, no network, no model).
import { afterEach, describe, expect, it } from 'vitest'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import type { RecipeDocument } from '../../src/shared/api'
import { fakeTeamReply } from '../../src/main/agents/fake-team'
import { FakeProvider } from '../../src/main/llm/fake'
import { MISSING_SCRIPT } from '../../src/main/production/recipes/projects'
import { T0, drain, rig, type Rig } from './orchestra-helpers'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'

const HOUR = 3_600_000

/** The compiled project, played on the test nodes: the owner's script is a required input, the package an owner gate. */
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
    { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' } },
    { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' } },
    { id: 'voice', type: 'voice.tts@1', in: { script: 'script.text' }, params: { voice: '$style.voice' } },
    { id: 'render', type: 'render.assemble@1', in: { voice: 'voice.audio' } },
    { id: 'package', type: 'package.youtube@1', in: { video: 'render.video' }, gate: 'owner' }
  ]
})

const brick = (tech: string): RecipeDocument['bricks'][number] => ({ tech, settings: {}, engine: null, fallbacks: [], style: null })

/** A pipeline whose Script option is « je l'importe ». */
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

const SCRIPT = (n: number): string =>
  `Voici le script numéro ${n}. On parle de radiateurs, de purge et de chaleur. ` +
  'Il faut couper le chauffage, attendre, puis ouvrir la vis de purge avec douceur. On referme quand l’eau coule. '.repeat(4)

let f: Fixture | null = null
let r: Rig | null = null
afterEach(() => {
  r?.core.close()
  f?.cleanup()
  r = null
  f = null
})

async function setup(): Promise<{ r: Rig; f: Fixture; channelId: number; recipeId: number }> {
  f = fixture()
  const fx = f
  r = rig({
    core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } },
    providerFor: (a) => new FakeProvider(fakeTeamReply, `fake-${a.id}`)
  })
  const api = r.core.api
  const ch = await api['channels.create']({ name: 'Marcel', niche: 'bricolage' })
  const recipe = await api['recipes.save']({ doc: importDoc() })
  await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
  return { r, f: fx, channelId: ch.id, recipeId: recipe.id }
}

/** Runs not finished yet are let to reach a gate or an end (they run in real time on the test nodes). */
async function settle(rg: Rig): Promise<void> {
  await waitFor(async () => (await rg.core.api['production.list']()).every((x) => x.status !== 'running' && x.status !== 'queued'), 10_000, 'runs to settle')
}

describe('the team on the real production path (fake team, test nodes)', () => {
  it('« J\'ai mon script »: a script is a project input; a missing one is said in French before anything runs', async () => {
    const { r, channelId, recipeId } = await setup()
    const api = r.core.api
    const p = await api['projects.create']({ recipeId, channelId, title: 'Purger un radiateur', idea: '', inputs: { script: SCRIPT(1) } })
    expect(p.idea).toBe('Purger un radiateur')
    expect(p.inputs.script).toContain('script numéro 1')
    const empty = await api['projects.create']({ recipeId, channelId, title: 'Sans script', idea: 'Une idée' })
    await expect(api['projects.run'](empty.id)).rejects.toThrow(MISSING_SCRIPT)
    // nothing was created: no run, no orphan video
    expect(await api['production.list']()).toHaveLength(0)
    expect((await api['projects.get'](empty.id)).runId).toBeNull()
  })

  it('three imported scripts, three slots: produced on the fakes, approvals in the inbox, one failure reported, stop works', { timeout: 60_000 }, async () => {
    const { r, f, channelId, recipeId } = await setup()
    const api = r.core.api
    const o = r.core.orchestra
    const titles = ['Purger un radiateur', 'Changer un joint', 'Régler la chaudière']
    for (const [i, title] of titles.entries()) await api['projects.create']({ recipeId, channelId, title, idea: '', inputs: { script: SCRIPT(i + 1) } })
    // goals: Friday, Saturday and Sunday 18:00, recommended level (topics and thumbnails ask Charlie)
    o.parts.goals.save(channelId, {
      slots: [5, 6, 7].map((day) => ({ day, time: '18:00', kind: 'long' as const })),
      formats: [{ kind: 'long', minutes: 1, perWeek: 3 }],
      budgetCredits: 50_000,
      level: 'recommended',
      confirm: true
    })
    // the first run that reaches the render fails (once)
    f.failOnce.add('render.assemble@1')
    let failedRun: number | null = null
    let gatesApproved = 0
    let validations = 0
    for (let i = 0; i < 60; i++) {
      await drain(r)
      await settle(r)
      for (const run of await api['production.list']()) {
        if (run.status === 'waiting') {
          for (const node of run.waitingNodes) {
            await api['production.approve'](run.id, node)
            gatesApproved++
          }
        }
        if (run.status === 'failed' && failedRun === null) {
          failedRun = run.id
          // the failure reached the inbox and Atlas, in French, before anyone relaunches it
          const alert = o.inbox().find((x) => x.kind === 'alert' && x.title.startsWith('Fabrication en échec'))
          expect(alert?.body).toMatch(/La fabrication s’est arrêtée sur une erreur|Rendu|échec/i)
          const atlas = r.core.db.prepare(`SELECT body FROM messages WHERE body LIKE '%a échoué%'`).all() as { body: string }[]
          expect(atlas.length).toBeGreaterThanOrEqual(2) // the channel's room and Atlas's conversation
          const video = r.core.db.prepare('SELECT status FROM videos WHERE id = ?').get(run.videoId) as { status: string }
          expect(video.status).toBe('failed')
          await api['production.retry'](run.id)
        }
      }
      for (const item of o.inbox().filter((x) => x.kind === 'validate' && x.gate)) {
        o.answer(item.id, { choice: 'Valider' })
        validations++
      }
      await settle(r)
      const slots = r.core.db.prepare(`SELECT status FROM orch_plan_slots WHERE channel_id = ?`).all(channelId) as { status: string }[]
      if (slots.length === 3 && slots.every((s) => s.status === 'ready')) break
      r.clock.advance(HOUR)
    }

    // each slot took one imported script: its video carries the script's title, no topic or script step was opened
    const slots = r.core.db
      .prepare(`SELECT s.status, s.video_id, v.title, v.status AS video_status FROM orch_plan_slots s JOIN videos v ON v.id = s.video_id WHERE s.channel_id = ? ORDER BY s.slot_at`)
      .all(channelId) as { status: string; video_id: number; title: string; video_status: string }[]
    expect(slots.map((s) => s.title)).toEqual(titles)
    expect(slots.every((s) => s.status === 'ready' && s.video_status === 'ready')).toBe(true)
    const steps = r.core.db.prepare(`SELECT step, status FROM orch_plan_steps WHERE channel_id = ? AND step IN ('topic','approval','script')`).all(channelId) as { step: string; status: string }[]
    expect(steps.every((s) => s.status === 'skipped')).toBe(true)
    // the team made the runs (demo: nothing spent), one per slot video, on the projects of the imported scripts
    const runs = await api['production.list']()
    expect(runs).toHaveLength(3)
    expect(runs.every((x) => x.status === 'succeeded' && x.demo && x.spentCredits === 0)).toBe(true)
    expect(new Set(runs.map((x) => x.videoId))).toEqual(new Set(slots.map((s) => s.video_id)))
    const projects = await api['projects.list']({ channelId })
    expect(projects.filter((p) => p.runStatus === 'succeeded')).toHaveLength(3)
    // Charlie answered each run's gate and each thumbnail in his inbox; one failure was reported and relaunched
    // each run's package gate (the « kit » step, not gated by the recommended level) is passed once: by Charlie when he
    // looked first, else by the planner for the level (production-equipe: a run's gates follow the channel's level)
    const autoGates = r.core.db.prepare(`SELECT text FROM orch_events WHERE type = 'auto-approved' AND text LIKE '%step package (kit)%'`).all()
    expect(gatesApproved + autoGates.length).toBe(3)
    expect(validations).toBe(3)
    expect(failedRun).not.toBeNull()
    expect(o.inbox(true).filter((x) => x.kind === 'alert' && x.title.startsWith('Fabrication en échec'))).toHaveLength(1)
    // the production steps were done with the project tools, through the lead
    const used = r.core.db.prepare(`SELECT text FROM orch_events WHERE text LIKE '%used project.run%'`).all()
    expect(used).toHaveLength(3)

    // « Tout arrêter »: a fabrication still going is cancelled, its video too
    f.block.add('render.assemble@1')
    const p = await api['projects.create']({ recipeId, channelId, title: 'En cours', idea: '', inputs: { script: SCRIPT(9) } })
    const launched = await api['projects.run'](p.id)
    await waitFor(async () => (await api['production.get'](launched.runId as number)).current?.nodeId === 'render', 10_000, 'the render to start')
    const stopped = await api['autopilot.stop']()
    expect(stopped.runsStopped).toBe(1)
    const run = await waitFor(async () => {
      const d = await api['production.get'](launched.runId as number)
      return d.status === 'cancelled' ? d : null
    }, 10_000, 'the run to be cancelled')
    expect((r.core.db.prepare('SELECT status FROM videos WHERE id = ?').get(run.videoId) as { status: string }).status).toBe('cancelled')
    expect(T0).toBeLessThan(r.clock.now())
  })
})
