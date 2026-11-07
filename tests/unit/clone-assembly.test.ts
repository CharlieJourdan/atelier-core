// « Créer une pipeline » on the cloning engine (moteur-assemblage): the engine service behind the screen and `clone.*`
// runs a clone P0→P10 in the background on fakes, pauses on a question only the user can answer and goes on with his
// answer, cleans its intermediate files at the end; the app producer runs a round through the app's API (quote checked,
// gates approved, the same video every round so unchanged nodes come back cached); the engine's render review (0086) and
// music where the reference has none become P7 defects; the old nearest-base path is gone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Round, type IntakeState, type StyleDefinition, type PipelinePlan } from '../../src/shared/clone'
import { CLONE_METHODS } from '../../src/shared/api/clone'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { deterministicSynthesis } from '../../src/main/production/clone/fakes/synthesis'
import { CloneEngine, cloneIdFor } from '../../src/main/production/clone/engine'
import { appProducer, loadEngineIds } from '../../src/main/production/clone/app-producer'
import { CloudUnreachable } from '../../src/main/production/clone/cloud-down'
import { engineReviewDefects, soundWhereNone } from '../../src/main/production/clone/engine-review'
import { channelOfUrl } from '../../src/main/production/clone/app'
import { cleanIntermediates } from '../../src/main/production/clone/create'
import { CloneStore } from '../../src/main/production/clone/store'
import { definitionDefaults } from '../../src/main/production/clone/definition-defaults'
import type { ChannelRow } from '../../src/shared/workflow'

const ready = (url: string, budget = 10): IntakeState => ({
  draft: { intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: budget, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false },
  said: ['copie cette chaîne'], asked: null, inputsSettled: true
})

function engineOn(kind: 'presenter-motion' | 'full-3d', twoStyles = false) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-assembly-'))
  const ch = fakeChannel(kind)
  const engine = new CloneEngine({
    dataDir,
    services: () => {
      const { services } = fakeServices(ch)
      if (!twoStyles) return services
      // a channel with two formats: the synthesis cannot choose, the user must
      return { ...services, synthesiser: { synthesise: async (analyses, brief) => {
        const body = deterministicSynthesis(analyses, brief.style)
        return { ...body, styles: [{ id: 's1', description: 'long explainers', videos: analyses.slice(0, 3).map((a) => a.videoId) }, { id: 's2', description: 'shorts', videos: analyses.slice(3).map((a) => a.videoId) }], chosenStyle: brief.style }
      } } }
    },
    notify: () => {},
    now: () => new Date('2026-11-04T10:00:00Z')
  })
  return { dataDir, ch, engine }
}

describe('the clone engine service (« Créer une pipeline »)', () => {
  it('runs a clone P0→P10 in the background from a ready intake, saves everything and cleans its intermediates', async () => {
    const t = engineOn('presenter-motion')
    const turn = t.engine.intakeTurn(t.engine.startIntake(), `je veux copier ${t.ch.url}`)
    expect(turn.text.length).toBeGreaterThan(0)
    expect(turn.changes.some((c) => c.field === 'references')).toBe(true)
    const { cloneId } = t.engine.start(ready(t.ch.url))
    expect(cloneId).toBe('2026-11-04-fake-presenter-motion')
    expect(t.engine.state(cloneId).kind).toBe('running')
    const store = new CloneStore(t.dataDir, cloneId)
    mkdirSync(store.file('p7-reference'), { recursive: true })
    writeFileSync(store.file('p7-reference/cut.mp4'), 'x')
    await t.engine.settled(cloneId)
    expect(t.engine.state(cloneId)).toEqual({ kind: 'done', outcome: 'cloned' })
    expect(t.engine.report(cloneId)?.outcome).toBe('cloned')
    const p = t.engine.progress(cloneId)
    expect(p.steps.find((s) => s.step === 'report')?.status).toBe('done')
    expect(existsSync(store.file('active.json'))).toBe(false)
    // intermediate files went, the artefacts stayed
    expect(existsSync(store.file('p7-reference'))).toBe(false)
    expect(existsSync(store.file('p10-report.json'))).toBe(true)
    expect(store.decisions().some((d) => d.phase === 'cleanup')).toBe(true)
    const pic = await t.engine.file(cloneId, 'p10-report.json')
    expect(pic.mime).toBe('application/json')
    await expect(t.engine.file(cloneId, '../../x.json')).rejects.toThrow()
    expect(t.engine.list().map((c) => c.id)).toEqual([cloneId])
    expect(t.engine.remove(cloneId)).toEqual({ removed: true })
    expect(t.engine.list()).toEqual([])
  })

  it('refuses to start before the brief is complete', () => {
    const t = engineOn('presenter-motion')
    expect(() => t.engine.start(t.engine.startIntake())).toThrow(/not finished/)
  })

  it('an all-3D channel ends after P3 with the « not reproducible » report', async () => {
    const t = engineOn('full-3d')
    const { cloneId } = t.engine.start(ready(t.ch.url))
    await t.engine.settled(cloneId)
    expect(t.engine.state(cloneId)).toEqual({ kind: 'done', outcome: 'not-reproducible' })
  })

  it('« several styles » never pauses: the dominant style is picked, said in the decisions and the progress, and the clone goes on', async () => {
    const t = engineOn('presenter-motion', true)
    const { cloneId } = t.engine.start(ready(t.ch.url))
    await t.engine.settled(cloneId)
    expect(t.engine.state(cloneId)).toEqual({ kind: 'done', outcome: 'cloned' })
    const store = new CloneStore(t.dataDir, cloneId)
    const synthesis = JSON.parse(readFileSync(store.file('p2-synthesis.json'), 'utf8')) as { chosenStyle: string }
    expect(synthesis.chosenStyle).toBe('s1')
    const pick = store.decisions().find((d) => d.phase === 'p2' && d.decision.startsWith('style picked'))
    expect(pick?.decision).toBe('style picked s1: dominant')
    expect(pick?.why).toMatch(/3 of 5 videos/)
    // only the picked style's videos feed the feasibility and the definition
    const only = store.decisions().find((d) => d.decision === 'style s1 only')
    expect(only?.why).toMatch(/belong to another style/)
    const style = (JSON.parse(readFileSync(store.file('p2-synthesis.json'), 'utf8')) as { styles: { id: string; videos: string[] }[] }).styles.find((st) => st.id === 's1')!
    for (const v of ['v1', 'v2', 'v3', 'v4', 'v5'].filter((id) => !style.videos.includes(id))) expect(only?.why).toContain(v)
    expect(store.decisions().some((d) => d.decision === 'ask-user')).toBe(false)
    const watch = t.engine.progress(cloneId).steps.find((s) => s.step === 'watch')!
    expect(watch.facts.some((f) => f.key === 'clone.progress.fact.style.dominant')).toBe(true)
    // too late to override once the clone went past P2: a new clone takes the other style
    expect(() => t.engine.answer(cloneId, 's2')).toThrow(/nouveau clonage/)
  })

  it('the style the user’s words name is picked without asking', async () => {
    const t = engineOn('presenter-motion', true)
    const { cloneId } = t.engine.start({ ...ready(t.ch.url), draft: { ...ready(t.ch.url).draft, style: 's2' } })
    await t.engine.settled(cloneId)
    expect(t.engine.state(cloneId)).toEqual({ kind: 'done', outcome: 'cloned' })
    const store = new CloneStore(t.dataDir, cloneId)
    expect(store.decisions().find((d) => d.decision.startsWith('style picked'))?.decision).toBe('style picked s2: named')
    expect(t.engine.progress(cloneId).steps.find((s) => s.step === 'watch')!.facts.some((f) => f.key === 'clone.progress.fact.style.named')).toBe(true)
  })

  it('a question saved by an older engine (a paused clone) reads as idle: it waits to be resumed, nothing asks', async () => {
    const t = engineOn('full-3d')
    const { cloneId } = t.engine.start(ready(t.ch.url))
    await t.engine.settled(cloneId)
    const store = new CloneStore(t.dataDir, cloneId)
    writeFileSync(store.file('engine-state.json'), JSON.stringify({ kind: 'asking', phase: 'gate', question: 'look at the demo' }))
    rmSync(store.file('p10-report.json'))
    expect(t.engine.state(cloneId)).toEqual({ kind: 'idle' })
  })

  it('a « running » state left by a crash reads as idle (it waits to be resumed)', async () => {
    const t = engineOn('full-3d')
    const { cloneId } = t.engine.start(ready(t.ch.url))
    await t.engine.settled(cloneId)
    const store = new CloneStore(t.dataDir, cloneId)
    writeFileSync(store.file('engine-state.json'), JSON.stringify({ kind: 'running' }))
    rmSync(store.file('p10-report.json'))
    expect(t.engine.state(cloneId)).toEqual({ kind: 'idle' })
  })

  it('names clones by date and handle, uniquely', () => {
    const a = { references: [{ url: 'https://www.youtube.com/@LeMondeEnPOV', kind: 'channel', axes: [] }] } as never
    expect(cloneIdFor(a, new Date('2026-11-04T00:00:00Z'), () => false)).toBe('2026-11-04-lemondeenpov')
    expect(cloneIdFor(a, new Date('2026-11-04T00:00:00Z'), (x) => x === '2026-11-04-lemondeenpov')).toBe('2026-11-04-lemondeenpov-2')
  })

  it('lists exactly the clone methods on the API, and the old creation module is gone', () => {
    expect(CLONE_METHODS).toContain('clone.start')
    expect(existsSync(path.join(__dirname, '../../src/main/production/creation'))).toBe(false)
  })
})

describe('the app producer (P6/P9 on the app engines)', () => {
  const run = (o: Partial<Record<string, unknown>> = {}) => ({ id: 7, videoId: 3, status: 'succeeded', spentCredits: 20, progress: 1, current: null, waitingNodes: [], error: null, packageDir: null as string | null, durationS: 60, nodes: [{ nodeId: 'script', type: 'script.write@2', state: 'done', credits: 5 }, { nodeId: 'director', type: 'director.pov@1', state: 'cached', credits: 0 }], ...o })
  function stubApi(pkg: string, o: { quoteCredits?: number; waitFirst?: boolean; overSpend?: boolean; cloudDown?: boolean } = {}) {
    const calls: { m: string; args: unknown[] }[] = []
    let polls = 0
    const handlers: Record<string, (...a: unknown[]) => unknown> = {
      'recipes.check': () => ({ ok: true, errors: [] }),
      'recipes.save': () => ({ id: 11 }),
      'projects.create': () => ({ id: 21 }),
      'projects.update': (id) => ({ id }),
      'projects.quote': () => ({ demo: o.cloudDown === true, demoReason: '', real: o.cloudDown ? { available: false, reason: 'Atelier Cloud injoignable' } : { available: true, reason: '' }, budgetMode: 'usage_max', modes: { usage_max: { totalCredits: o.quoteCredits ?? 30 } } }),
      'projects.run': (id) => ({ id, runId: 7 }),
      'production.get': () => (o.overSpend ? run({ status: 'running', spentCredits: 300 }) : o.waitFirst && polls++ === 0 ? run({ status: 'waiting', waitingNodes: ['script'], packageDir: pkg }) : run({ packageDir: pkg })),
      'production.approve': () => run(),
      'production.output': (_r, node) => (node === 'script' ? { kind: 'text', text: 'our words' } : { kind: 'editplan', durationS: 61, shots: [{ track: 'base', start: 0, end: 4, kind: 'card' }] }),
      'production.cancel': () => run({ status: 'cancelled' })
    }
    const api = new Proxy({}, { get: (_t, m: string) => (...args: unknown[]) => { calls.push({ m, args }); return handlers[m]!(...args) } })
    return { api: api as never, calls }
  }
  function setup() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'clone-producer-'))
    const pkg = path.join(root, 'pkg')
    mkdirSync(pkg)
    writeFileSync(path.join(pkg, 'final.mp4'), 'film')
    const work = (n: number): string => { const d = path.join(root, `round-${n}`); mkdirSync(d); return d }
    return { root, pkg, work }
  }
  it('quotes, runs real, approves the gates, reads script, plan and review back; the next round fills the same video', async () => {
    const t = setup()
    const s = stubApi(t.pkg, { waitFirst: true })
    const remade: number[] = []
    const producer = appProducer({ api: () => s.api, cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01, remake: (v) => { remade.push(v); return { id: 31 } }, renderReview: async () => ({ schema: 'atelier.review/1', rounds: [], left: [], looked: true, notes: [] }), pollMs: 0, sleep: async () => {} })
    const r1 = await producer.produce({ recipe: { bricks: [] }, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: t.work(1) })
    expect(r1).toMatchObject({ runId: '7', spentUsd: 0.2, scriptText: 'our words', durationS: 60 })
    expect(r1.nodes).toContainEqual({ id: 'director', state: 'cached' })
    expect(s.calls.map((c) => c.m)).toContain('production.approve')
    expect(s.calls.findIndex((c) => c.m === 'projects.quote')).toBeLessThan(s.calls.findIndex((c) => c.m === 'projects.run'))
    expect(loadEngineIds(t.root)).toEqual({ recipeId: 11, channelId: 5, videoId: 3 })
    expect(existsSync(path.join(t.work(9), '..', 'round-1', 'engine-review.json'))).toBe(true)
    await producer.produce({ recipe: { bricks: [] }, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: t.work(2) })
    expect(remade).toEqual([3])
    expect(s.calls.filter((c) => c.m === 'projects.create')).toHaveLength(1)
    // the recipe is saved as a new version of the same recipe
    expect(s.calls.filter((c) => c.m === 'recipes.save').map((c) => (c.args[0] as { id?: number }).id)).toEqual([undefined, 11])
  })
  it('with no Cloud, neither a paid round nor a free demo starts: the clone waits for the Cloud (a drawn-slides demo is never judged)', async () => {
    for (const demo of [false, true]) {
      const t = setup()
      const s = stubApi(t.pkg, { cloudDown: true })
      const producer = appProducer({ api: () => s.api, cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01, remake: () => ({ id: 1 }), renderReview: async () => null, pollMs: 0, sleep: async () => {}, ...(demo ? { demo: true } : {}) })
      await expect(producer.produce({ recipe: { bricks: [] }, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: t.work(1) })).rejects.toBeInstanceOf(CloudUnreachable)
      expect(s.calls.map((c) => c.m)).not.toContain('projects.run')
    }
  })
  it('never starts a round quoted above the money left, and never pays twice for a recorded run', async () => {
    const t = setup()
    const s = stubApi(t.pkg, { quoteCredits: 500 })
    const producer = appProducer({ api: () => s.api, cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01, remake: () => ({ id: 1 }), renderReview: async () => null, pollMs: 0, sleep: async () => {} })
    await expect(producer.produce({ recipe: {}, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: t.work(1) })).rejects.toThrow(/quoted 5\.000 \$/)
    expect(s.calls.map((c) => c.m)).not.toContain('projects.run')
    const dir = t.work(2)
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ runId: 7 }))
    const ok = stubApi(t.pkg)
    const again = appProducer({ api: () => ok.api, cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01, remake: () => ({ id: 1 }), renderReview: async () => null, pollMs: 0, sleep: async () => {} })
    await again.produce({ recipe: {}, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: dir })
    expect(ok.calls.map((c) => c.m)).not.toContain('projects.run')
  })
  it('cancels a run past the cap, books what it spent, and never restarts it on a resume', async () => {
    const t = setup()
    const s = stubApi(t.pkg, { overSpend: true })
    const booked: number[] = []
    const producer = appProducer({ api: () => s.api, cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01, remake: () => ({ id: 1 }), renderReview: async () => null, onSpend: (x) => booked.push(x.usd), pollMs: 0, sleep: async () => {} })
    const dir = t.work(1)
    await expect(producer.produce({ recipe: {}, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: dir })).rejects.toThrow(/over the 1\.00 \$ left: cancelled/)
    expect(booked).toEqual([3])
    expect(s.calls.map((c) => c.m)).toContain('production.cancel')
    // a resume never restarts the capped run: its record is kept aside and a NEW run is quoted against the money left
    await expect(producer.produce({ recipe: {}, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: dir })).rejects.toThrow(/cancelled/)
    expect(existsSync(path.join(dir, 'run-ended-1.json'))).toBe(true)
    expect(s.calls.filter((c) => c.m === 'production.resume')).toHaveLength(0)
    expect(s.calls.filter((c) => c.m === 'projects.quote')).toHaveLength(2)
  })
  it('a run of its video left by an earlier attempt nobody watches any more is cancelled and booked before the new round (a stopped brain)', async () => {
    const t = setup()
    writeFileSync(path.join(t.root, 'engine.json'), JSON.stringify({ recipeId: 11, channelId: 5, videoId: 3 }))
    const s = stubApi(t.pkg)
    const booked: string[] = []
    const remade: number[] = []
    const producer = appProducer({
      api: () => s.api, cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01,
      openRun: (v) => (v === 3 && !s.calls.some((c) => c.m === 'production.cancel') ? 6 : null),
      remake: (v) => { remade.push(v); return { id: 31 } }, renderReview: async () => null, onSpend: (x) => booked.push(x.what), pollMs: 0, sleep: async () => {}
    })
    await producer.produce({ recipe: {}, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: t.work(1) })
    const order = s.calls.map((c) => c.m)
    expect(s.calls.find((c) => c.m === 'production.cancel')!.args[0]).toBe(6)
    expect(order.indexOf('production.cancel')).toBeLessThan(order.indexOf('projects.update'))
    expect(remade).toEqual([3])
    expect(booked.some((w) => /run 6 .*earlier attempt/.test(w))).toBe(true)
  })
  it('an orphan run that ended just before its cancel is booked at what it really spent', async () => {
    const t = setup()
    writeFileSync(path.join(t.root, 'engine.json'), JSON.stringify({ recipeId: 11, channelId: 5, videoId: 3 }))
    const s = stubApi(t.pkg)
    const api = s.api as unknown as Record<string, (...a: unknown[]) => unknown>
    const get = api['production.get']!
    const booked: number[] = []
    const producer = appProducer({
      api: () => new Proxy(api, { get: (o, m: string) => (m === 'production.cancel' ? () => { throw new Error('Cette fabrication est déjà terminée.') } : m === 'production.get' ? (id: unknown) => (id === 6 ? run({ id: 6, status: 'succeeded', spentCredits: 30 }) : get(id)) : o[m]) }) as never,
      cloneDir: t.root, channelId: async () => 5, usdPerCredit: () => 0.01,
      openRun: (v) => (v === 3 && booked.length === 0 ? 6 : null),
      remake: () => ({ id: 31 }), renderReview: async () => null, onSpend: (x) => booked.push(x.usd), pollMs: 0, sleep: async () => {}
    })
    await producer.produce({ recipe: {}, title: 'T', idea: 'I', minutes: 1, maxUsd: 1, workDir: t.work(1) })
    expect(booked[0]).toBe(0.3)
  })
})

describe('P7 defects from the engine review (0086) and sound where the reference has none', () => {
  it('maps every review defect to its compare axis, in French, weighted by severity', () => {
    const d = engineReviewDefects({ schema: 'atelier.review/1', rounds: [], looked: true, notes: [], left: [
      { kind: 'duplicate', severity: 'fail', atS: 12.34, endS: 14, detail: 'la même carte deux fois' },
      { kind: 'map_legend', severity: 'warn', atS: 30, endS: 34, detail: 'carte sans légende' },
      { kind: 'text_unsaid', severity: 'fail', atS: 40, endS: 42, detail: '« 1942 » à l’écran, jamais dit' },
      { kind: 'text_late', severity: 'warn', atS: 50, endS: 52, detail: 'texte 3 s après son mot' }
    ] })
    expect(d.map((x) => x.axis)).toEqual(['illustration', 'motion', 'script', 'illustration'])
    // a repeated picture is a real error (decision 0102): it blocks the example; a text late on its word is a style remark
    expect(d[0]).toMatchObject({ atS: 12.3, weight: 0.8 })
    expect(d[3]).toMatchObject({ weight: 0.3 })
    expect(d[0]!.description).toMatch(/^revue du montage/)
    expect(engineReviewDefects(null)).toEqual([])
  })
  it('flags music only when the reference measured none and the plan adds it', () => {
    const def = definitionDefaults() as unknown as StyleDefinition
    const measuredNone = { ...def, sound: { ...def.sound, music: { value: false, source: 'measured' as const, evidence: [{ frames: [], note: 'no bed' }] } } } as StyleDefinition
    const plan = { bricks: [{ node: 'sound.music', fromBase: null, role: 'music' }], recipe: null } as unknown as PipelinePlan
    expect(soundWhereNone(measuredNone, plan).map((x) => x.axis)).toEqual(['sound'])
    expect(soundWhereNone(def, plan)).toEqual([]) // a default says nothing about the channel
    expect(soundWhereNone(measuredNone, { ...plan, bricks: [] } as PipelinePlan)).toEqual([])
  })
})

describe('own channel lookup and cleanup', () => {
  it('finds the workspace channel of a link by its id or its handle', () => {
    const row = (id: number, name: string, yt: string | null): ChannelRow => ({ id, name, youtubeChannelId: yt, archived: false } as ChannelRow)
    const rows = [row(1, 'Marcel', null), row(2, 'Autre', 'UCabc')]
    expect(channelOfUrl(rows, 'https://www.youtube.com/@marcel')?.id).toBe(1)
    expect(channelOfUrl(rows, 'https://www.youtube.com/channel/UCabc')?.id).toBe(2)
    expect(channelOfUrl(rows, 'https://www.youtube.com/@finary')).toBeNull()
  })
  it('removes the reference downloads, cut passages and scratch frames, keeps the evidence', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-clean-'))
    const store = new CloneStore(dataDir, 'c1')
    for (const d of ['refs/v1', 'p7-reference', 'p2-v1/_frames', 'p2-v1/frames']) mkdirSync(store.file(d), { recursive: true })
    expect(cleanIntermediates(store, dataDir).sort()).toEqual(['p2-v1/_frames', 'p7-reference', 'refs'])
    expect(existsSync(store.file('p2-v1/frames'))).toBe(true)
  })
})

describe('the compiled recipe runs on real engines', () => {
  it('takes each brick engine from the bases that use the brick (ai33 for the voice), never an empty engine a test Cloud fills with a demo', async () => {
    const { engineOf } = await import('../../src/main/production/clone/pipeline/compile')
    expect(engineOf('voice.tts@1').engine).toBe('voice:ai33')
    // set by the avatar base's option defaults (never a demo engine)
    expect(engineOf('avatar.speak@1').engine).toMatch(/^presenter:/)
    expect(engineOf('clip.make@1').engine).toMatch(/^clip:/)
    expect(engineOf('render.assemble@1')).toEqual({ engine: null, fallbacks: [] })
  })
})

describe('real-run lessons (Le Monde en POV, 2026-11-04)', () => {
  it('a judge answer whose axis slipped into a key is repaired, not refused', async () => {
    const { parseJudge } = await import('../../src/main/production/clone/compare/judge')
    const { COMPARE_AXES } = await import('../../src/shared/clone')
    const scores = COMPARE_AXES.map((axis) => (axis === 'layout' ? { layout: 'layout', score: 65, defects: ['letterbox bars'] } : { axis, score: 80, defects: ['x'] }))
    const p = parseJudge(JSON.stringify({ sameChannel: 'yes', reason: 'r', scores }), 'j', 0)
    expect(p.problems).toEqual([])
    expect(p.verdict?.scores.find((s) => s.axis === 'layout')?.score).toBe(65)
  })
  it('a « yes » whose picture axes differ too much counts as « no », said in the verdict', async () => {
    const { parseJudge, SAME_CHANNEL_MIN_PICTURE_SCORE } = await import('../../src/main/production/clone/compare/judge')
    const { COMPARE_AXES } = await import('../../src/shared/clone')
    const scores = COMPARE_AXES.map((axis) => ({ axis, score: axis === 'layout' ? 58 : 82, defects: ['x'] }))
    const v = parseJudge(JSON.stringify({ sameChannel: 'yes', reason: 'same toolkit', scores }), 'j', 0).verdict!
    expect(v.sameChannel).toBe('no')
    expect(v.reason).toMatch(new RegExp(`layout 58 under ${SAME_CHANNEL_MIN_PICTURE_SCORE}`))
    const ok = parseJudge(JSON.stringify({ sameChannel: 'yes', reason: 'r', scores: scores.map((x) => ({ ...x, score: 80 })) }), 'j', 0).verdict!
    expect(ok.sameChannel).toBe('yes')
  })
  it('a voice cut inside a word blocks the example', async () => {
    const { BLOCKING_DEFECT_WEIGHT } = await import('../../src/shared/clone')
    const d = engineReviewDefects({ schema: 'atelier.review/1', rounds: [], looked: true, notes: [], left: [{ kind: 'audio_dropout', severity: 'fail', atS: 28.3, endS: 28.6, detail: 'La voix se coupe dans « d’une »' }] })
    expect(d[0]!.weight).toBe(BLOCKING_DEFECT_WEIGHT)
  })
  it('stops when a round re-renders the very same film: the changes reached no brick, the judge is not paid again', async () => {
    const { runClone } = await import('../../src/main/production/clone/orchestrator')
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-same-'))
    const ch = fakeChannel('presenter-motion')
    const { services, state } = fakeServices(ch)
    let n = 0
    const produce = services.runs.produce
    services.runs.produce = async (...a) => { const p = await produce(...a); n++; return { ...p, bricks: { keys: {}, rerun: n === 1 ? ['script'] : [], reused: [] } } }
    const answers = { intent: 'copy-channel' as const, references: [{ url: ch.url, kind: 'channel' as const, axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['x'] }
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers })
    const store = new CloneStore(dataDir, 'c1')
    expect(store.decisions().some((d) => /re-ran no brick/.test(d.why))).toBe(true)
    expect(state.judged).toBe(1) // round 1 only: round 2's identical film was not judged again
    expect(store.load('p6-round-02.json', Round)?.decision).toBe('stop-nothing-to-fix')
    expect(report.rounds).toBeGreaterThanOrEqual(1)
  })
})
