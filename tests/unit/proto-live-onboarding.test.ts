// Real mode of the onboarding: the session that creates the channel, runs the analysis, answers its questions, makes the
// library pipeline, starts the test video and builds the team — against a fake IPC (nothing reaches the main process, nothing
// is spent) — plus what the answers of the flow say to the backend.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisDetail, LibraryPipelineRow, ReferenceSummary } from '../../src/shared/analysis'
import type { OrchAgent } from '../../src/shared/api/orchestra'
import type { RunDetail } from '../../src/shared/runs'
import { setLocale } from '../../src/shared/fr'
import { LiveOnboardingSession, pickReference, runSettled, type Call, type LiveDraft, type OnboardingDeps } from '../../src/renderer/proto/live/onboarding-live'
import type { LiveRunInput } from '../../src/renderer/proto/live/registry'
import { footageAnswers, liveDraftOf, pausedRolesOf } from '../../src/renderer/screens/onboarding/live/draft'
import { leaveStep } from '../../src/renderer/screens/onboarding/live/flow'
import { initialAnswers, type Answers } from '../../src/renderer/screens/onboarding/model'

const REFS: ReferenceSummary[] = [
  { id: 'archives-silencieuses', name: 'Archives Silencieuses', niche: 'Histoire', format: 'Documentaire', subscribers: 1 },
  { id: 'recits-manette', name: 'Récits Manette', niche: 'Jeu', format: 'Histoires', subscribers: 1 },
  { id: 'top-dix-anime', name: 'Top Dix Animé', niche: 'Culture', format: 'Top 10', subscribers: 1 }
]

function detail(over: Partial<AnalysisDetail> = {}): AnalysisDetail {
  return {
    id: 5,
    referenceId: 'archives-silencieuses',
    channelName: 'Archives Silencieuses',
    sourceLink: '',
    status: 'choose_examples',
    score: null,
    example: false,
    createdAt: '',
    mode: 'usage_max',
    reference: { id: 'archives-silencieuses', name: 'Archives Silencieuses', niche: 'Histoire', format: 'Documentaire', subscribers: 1, uploadsPerWeek: 1, recentVideos: [], proposedExamples: ['as-3', 'as-7'] },
    chosenExamples: [],
    examples: [],
    steps: [],
    profile: null,
    scriptCard: null,
    styleDraft: null,
    questions: ['camera', 'gameplay'],
    answers: {},
    replace: {},
    adjust: {},
    gauge: null,
    cost: { minutes: 8, modes: { qualite_max: { credits: 900, perMinute: 112 }, usage_max: { credits: 400, perMinute: 50 } } },
    proposedPipelineJson: '{"nodes":[]}',
    createdPipelineId: null,
    messages: [],
    ...over
  } as AnalysisDetail
}

const row = (id: number): LibraryPipelineRow => ({ id, name: `Pipeline ${id}`, description: '', origin: 'analysis', channelId: 3, channelName: 'Chaîne', isDefault: true, latestVersion: 1, example: false, updatedAt: '' })
const agent = (id: number, role: string, paused = false, channelId: number | null = 3): OrchAgent => ({ id, slug: `${role}-${id}`, role, name: `${role} ${id}`, parentId: null, channelId, paused } as OrchAgent)
const run = (over: Partial<RunDetail> = {}): RunDetail => ({ id: 77, videoId: 9, status: 'waiting', waitingNodes: ['script'], nodes: [{ nodeId: 'script', label: 'Script', state: 'waiting_gate' }], ...over }) as unknown as RunDetail

interface Harness {
  deps: OnboardingDeps
  calls: [string, ...unknown[]][]
  starts: LiveRunInput[]
  agents: OrchAgent[]
  answered: Record<string, boolean>
}

function harness(over: Record<string, (...args: never[]) => unknown> = {}): Harness {
  const h: Harness = { deps: null as never, calls: [], starts: [], agents: [agent(1, 'channel_lead'), agent(2, 'scriptwriter'), agent(3, 'packaging'), agent(4, 'researcher'), agent(9, 'researcher', false, 8)], answered: {} }
  const handlers: Record<string, (...args: never[]) => unknown> = {
    'channels.create': () => ({ id: 3, name: 'Affaires non résolues' }),
    'channels.update': () => ({ id: 3 }),
    'analysis.references': () => REFS,
    'analysis.start': () => ({ kind: 'started', analysis: detail() }),
    'analysis.chooseExamples': () => detail({ status: 'done' }),
    'analysis.get': () => detail({ status: 'done', answers: { ...h.answered }, createdPipelineId: null }),
    'analysis.answer': ((id: number, input: string, value: boolean) => {
      h.answered[input] = value
      return detail({ status: 'done', answers: { ...h.answered } })
    }) as never,
    'analysis.createPipeline': () => ({ pipeline: row(11), styleVersion: 1 }),
    'pipelines.estimate': () => ({ minutes: 8, modes: { usage_max: { credits: 400, perMinute: 50, durationS: 600, nodes: [] }, qualite_max: { credits: 900, perMinute: 112, durationS: 600, nodes: [] } } }),
    'pipelines.saveVersion': () => ({ ok: true, pipeline: row(11) }),
    'production.quote': () => ({ debited: false, modes: { usage_max: { totalCredits: 400 } } }),
    'production.list': () => [{ id: 77 }],
    'production.get': () => run(),
    'production.requestChanges': () => run({ waitingNodes: ['script'] }),
    'production.retry': () => run({ status: 'running', waitingNodes: [] }),
    'orchestra.seed': () => [],
    'orchestra.agents': () => h.agents,
    'orchestra.updateAgent': ((id: number, patch: { paused: boolean }) => {
      h.agents = h.agents.map((a) => (a.id === id ? { ...a, paused: patch.paused } : a))
      return h.agents.find((a) => a.id === id)
    }) as never,
    ...over
  }
  const call = (async (method: string, ...args: unknown[]) => {
    h.calls.push([method, ...args])
    const fn = handlers[method]
    if (!fn) throw new Error(`unexpected call ${method}`)
    return (fn as (...a: unknown[]) => unknown)(...args)
  }) as unknown as Call
  h.deps = {
    call,
    startRun: async (input) => {
      h.starts.push(input)
      return { libraryId: null, notes: [], runId: 77 }
    }
  }
  return h
}

const count = (h: Harness, method: string): number => h.calls.filter((c) => c[0] === method).length

const DRAFT: LiveDraft = { kind: 'niche', name: 'Affaires non résolues', niche: 'Affaires non résolues', standards: '', link: '', hint: 'niche-cold', versionNote: 'v2' }

beforeEach(() => setLocale('fr'))

describe('real onboarding: what the answers say to the backend', () => {
  const a = (p: Partial<Answers>): Answers => ({ ...initialAnswers('Atlas'), ...p })

  it('picks the reference channel from keywords, else the first one', () => {
    expect(pickReference(REFS, 'niche-cold')?.id).toBe('archives-silencieuses')
    expect(pickReference(REFS, 'niche-money')?.id).toBe('top-dix-anime')
    expect(pickReference(REFS, 'youtube.com/@mon-gameplay-fr')?.id).toBe('recits-manette')
    expect(pickReference(REFS, '')?.id).toBe('archives-silencieuses')
    expect(pickReference([], 'x')).toBeUndefined()
  })

  it('a niche gives a named channel with its niche; a link is kept as a note, never as a YouTube id', () => {
    const niche = liveDraftOf(a({ hasChannel: 'no', creation: 'niche', nicheId: 'niche-cold' }), [])
    expect(niche).toMatchObject({ kind: 'niche', name: 'Affaires non résolues', niche: 'Enquêtes et affaires non résolues', standards: '', link: '' })
    expect(niche.hint).toContain('niche-cold')
    const own = liveDraftOf(a({ hasChannel: 'yes', link: 'youtube.com/@grandesenigmes' }), [])
    expect(own).toMatchObject({ kind: 'own', link: 'youtube.com/@grandesenigmes' })
    expect(own.standards).toContain('youtube.com/@grandesenigmes')
    const tr = liveDraftOf(a({ hasChannel: 'no', creation: 'translate', translateLink: 'youtube.com/@source', targetLang: 'en' }), [])
    expect(tr).toMatchObject({ kind: 'translate', link: 'youtube.com/@source' })
    expect(tr.standards).toContain('youtube.com/@source')
    expect(tr.name).toContain('(EN)')
    const idea = liveDraftOf(a({ hasChannel: 'no', creation: 'idea', idea: 'Des légendes de phares' }), [])
    expect(idea).toMatchObject({ kind: 'idea', niche: 'Des légendes de phares' })
  })

  it('footage switches answer the analysis; jobs done by the user pause their agents', () => {
    expect(footageAnswers(a({ gameplay: true, rushes: false }))).toEqual({ gameplay: true, camera: false })
    expect(pausedRolesOf(a({}))).toEqual([])
    expect(pausedRolesOf(a({ automation: { ...initialAnswers('x').automation, script: 'human', packaging: 'human' } }))).toEqual(['scriptwriter', 'packaging'])
  })
})

describe('real onboarding: the session', () => {
  it('creates the channel once, updates it when the answers change, and keeps the link as a note', async () => {
    const h = harness()
    const s = new LiveOnboardingSession(h.deps)
    expect(await s.ensureChannel(DRAFT)).toBe(3)
    expect(await s.ensureChannel(DRAFT)).toBe(3)
    expect(count(h, 'channels.create')).toBe(1)
    expect(count(h, 'channels.update')).toBe(0)
    expect(h.calls[0]).toEqual(['channels.create', { name: 'Affaires non résolues', niche: 'Affaires non résolues', standards: '' }])
    await s.ensureChannel({ ...DRAFT, name: 'Autre nom' })
    expect(h.calls.find((c) => c[0] === 'channels.update')).toEqual(['channels.update', 3, { name: 'Autre nom', niche: 'Affaires non résolues', standards: '' }])
    expect(s.getState().channelId).toBe(3)
  })

  it('a failing creation keeps the error and rethrows (the flow shows it, nothing moves on)', async () => {
    const h = harness({ 'channels.create': () => Promise.reject(new Error('Nom déjà pris')) as never })
    const s = new LiveOnboardingSession(h.deps)
    await expect(s.ensureChannel(DRAFT)).rejects.toThrow('Nom déjà pris')
    expect(s.getState()).toMatchObject({ channelId: null, error: 'Nom déjà pris' })
  })

  it('runs the analysis on the reference channel with the link, chooses the proposed examples, estimates, and runs once', async () => {
    const h = harness()
    const s = new LiveOnboardingSession(h.deps)
    await s.ensureChannel(DRAFT)
    const seen: string[] = []
    s.subscribe(() => seen.push(s.getState().analysisPhase))
    const linked = { ...DRAFT, kind: 'own' as const, link: 'youtube.com/@x', hint: 'youtube.com/@x' }
    await s.runAnalysis(linked)
    await s.runAnalysis(linked)
    expect(count(h, 'analysis.start')).toBe(1)
    expect(h.calls.find((c) => c[0] === 'analysis.start')).toEqual(['analysis.start', { referenceId: 'archives-silencieuses', link: 'youtube.com/@x' }])
    expect(h.calls.find((c) => c[0] === 'analysis.chooseExamples')).toEqual(['analysis.chooseExamples', 5, ['as-3', 'as-7']])
    const st = s.getState()
    expect(st.analysisPhase).toBe('done')
    expect(st.analysis?.status).toBe('done')
    expect(st.reference).toEqual({ id: 'archives-silencieuses', name: 'Archives Silencieuses', standsInForLink: true })
    expect(st.estimate?.modes.usage_max.credits).toBe(400)
    expect(seen).toContain('running')
    // a niche has no link: not a stand-in for anything
    const s2 = new LiveOnboardingSession(harness().deps)
    await s2.runAnalysis(DRAFT)
    expect(s2.getState().reference?.standsInForLink).toBe(false)
  })

  it('an analysis that fails ends in error and can be retried', async () => {
    let fail = true
    const h = harness({ 'analysis.start': (() => (fail ? Promise.reject(new Error('Hors service')) : { kind: 'started', analysis: detail() })) as never })
    const s = new LiveOnboardingSession(h.deps)
    await expect(s.runAnalysis(DRAFT)).rejects.toThrow('Hors service')
    expect(s.getState()).toMatchObject({ analysisPhase: 'error', error: 'Hors service' })
    fail = false
    await s.runAnalysis(DRAFT, true)
    expect(s.getState().analysisPhase).toBe('done')
  })

  it('sends only the changed answers to the analysis, makes the library pipeline once, and a new version when they change', async () => {
    const h = harness()
    const s = new LiveOnboardingSession(h.deps)
    await s.ensureChannel(DRAFT)
    await s.runAnalysis(DRAFT)
    const made = await s.finishQuestions(DRAFT, { gameplay: false, camera: true })
    expect(made.id).toBe(11)
    expect(h.calls.filter((c) => c[0] === 'analysis.answer')).toEqual([
      ['analysis.answer', 5, 'camera', true],
      ['analysis.answer', 5, 'gameplay', false]
    ])
    expect(h.calls.find((c) => c[0] === 'analysis.createPipeline')).toEqual(['analysis.createPipeline', 5, 3])
    await s.finishQuestions(DRAFT, { gameplay: false, camera: true })
    expect(count(h, 'analysis.createPipeline')).toBe(1)
    expect(count(h, 'pipelines.saveVersion')).toBe(0)
    await s.finishQuestions(DRAFT, { gameplay: true, camera: true })
    expect(count(h, 'analysis.createPipeline')).toBe(1)
    expect(h.calls.find((c) => c[0] === 'pipelines.saveVersion')).toEqual(['pipelines.saveVersion', 11, '{"nodes":[]}', 'v2'])
    expect(s.getState().pipeline?.id).toBe(11)
  })

  it('refuses to make a pipeline before the analysis is done', async () => {
    const s = new LiveOnboardingSession(harness().deps)
    await expect(s.finishQuestions(DRAFT, {})).rejects.toThrow()
  })

  it('starts the test video through the live run path on the new pipeline, stops at its gate, sends it back with remarks', async () => {
    const h = harness()
    const s = new LiveOnboardingSession(h.deps)
    await s.ensureChannel(DRAFT)
    await s.runAnalysis(DRAFT)
    await s.finishQuestions(DRAFT, {})
    await s.loadQuote()
    expect(s.getState().quote?.debited).toBe(false)
    await s.startTest({ title: 'Vidéo test', topic: 'Histoire' })
    await s.startTest({ title: 'Vidéo test', topic: 'Histoire' })
    expect(h.starts).toEqual([{ channelId: 3, title: 'Vidéo test', topic: 'Histoire', minutes: 8, gateMode: 'step', deadline: null, pipelineId: 11 }])
    expect(s.getState()).toMatchObject({ runPhase: 'started' })
    expect(runSettled(s.getState().run)).toBe(true)
    await s.sendBack('  Plus de rythme ')
    expect(h.calls.find((c) => c[0] === 'production.requestChanges')).toEqual(['production.requestChanges', 77, 'script', 'Plus de rythme'])
    await s.retryRun()
    expect(s.getState().run?.status).toBe('running')
    expect(runSettled(s.getState().run)).toBe(false)
  })

  it('cannot start a test video without a pipeline', async () => {
    const s = new LiveOnboardingSession(harness().deps)
    await expect(s.startTest({ title: 't', topic: 't' })).rejects.toThrow()
  })

  it('builds the team of the channel (seed), pausing the jobs the user does herself, and undoes it when she changes her mind', async () => {
    const h = harness()
    const s = new LiveOnboardingSession(h.deps)
    await s.ensureChannel(DRAFT)
    await s.setupTeam(['scriptwriter'])
    await s.setupTeam(['scriptwriter'])
    expect(count(h, 'orchestra.seed')).toBe(1)
    expect(h.calls.filter((c) => c[0] === 'orchestra.updateAgent')).toEqual([['orchestra.updateAgent', 2, { paused: true }]])
    expect(s.getState().team?.map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(s.getState()).toMatchObject({ teamPhase: 'done', pausedRoles: ['scriptwriter'] })
    await s.setupTeam([])
    expect(h.agents.find((x) => x.id === 2)?.paused).toBe(false)
    expect(s.getState().pausedRoles).toEqual([])
  })

  it('leaving the channel step creates the channel, leaving the questions step makes the pipeline; other steps do nothing', async () => {
    const h = harness()
    const s = new LiveOnboardingSession(h.deps)
    const answers = { ...initialAnswers('Atlas'), hasChannel: 'no' as const, creation: 'niche' as const, nicheId: 'niche-cold', gameplay: true }
    await leaveStep(s, 1, answers, [])
    await leaveStep(s, 2, answers, [])
    expect(h.calls).toEqual([])
    await leaveStep(s, 3, answers, [])
    expect(count(h, 'channels.create')).toBe(1)
    await s.runAnalysis(liveDraftOf(answers, []))
    await leaveStep(s, 6, answers, [])
    expect(h.calls.find((c) => c[0] === 'analysis.answer' && c[2] === 'gameplay')).toEqual(['analysis.answer', 5, 'gameplay', true])
    expect(s.getState().pipeline?.id).toBe(11)
  })

  it('the run path of the real driver takes a library pipeline as it is', async () => {
    vi.resetModules()
    const calls: [string, ...unknown[]][] = []
    vi.doMock('@/state/client', () => ({
      call: async (method: string, ...args: unknown[]) => {
        calls.push([method, ...args])
        return { id: 77, videoId: 9 }
      },
      useEvent: () => undefined
    }))
    const { desktopDriver } = await import('../../src/renderer/proto/live/driver')
    const res = await desktopDriver.startRun({ channelId: 3, title: 'T', topic: 'S', minutes: 8, gateMode: 'step', deadline: null, pipelineId: 11 })
    expect(res).toMatchObject({ libraryId: null, runId: 77 })
    expect(calls[0]).toEqual(['production.start', { pipelineId: 11, channelId: 3, title: 'T', topic: 'S', minutes: 8, budgetMode: 'usage_max', gateMode: 'step' }])
    vi.doUnmock('@/state/client')
  })
})
