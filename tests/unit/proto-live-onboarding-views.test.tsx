// Real mode of the onboarding, the screens: they render the session's real data (analysis steps and examples, the gauge and
// the engine's estimate, the test run's node states, the team) and the « simulé » mark appears in real mode only.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../src/shared/fr'
import type { AnalysisDetail } from '../../src/shared/analysis'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { LiveOnboardingSession, setOnboardingDeps, type Call, type LiveDraft } from '../../src/renderer/proto/live/onboarding-live'
import { createProtoStore, initialState, ProtoProvider } from '../../src/renderer/proto/store'
import { initialAnswers, type StepProps } from '../../src/renderer/screens/onboarding/model'
import { LiveQuestionsStep, LiveTeamStep } from '../../src/renderer/screens/onboarding/live/LiveExtras'
import { LiveAnalysisStep } from '../../src/renderer/screens/onboarding/live/LiveAnalysis'
import { LiveReportStep } from '../../src/renderer/screens/onboarding/live/LiveReport'
import { LiveTestStep } from '../../src/renderer/screens/onboarding/live/LiveTest'
import { SimBadge } from '../../src/renderer/screens/onboarding/live/SimBadge'

const noop = (): void => undefined
const DRAFT: LiveDraft = { kind: 'niche', name: 'Affaires non résolues', niche: 'Enquêtes', standards: '', link: 'youtube.com/@x', hint: 'niche-cold', versionNote: 'v2' }

const DONE = {
  id: 5,
  status: 'done',
  mode: 'usage_max',
  reference: { id: 'archives-silencieuses', name: 'Archives Silencieuses', niche: 'Histoire', format: 'Documentaire raconté', subscribers: 1, uploadsPerWeek: 1, recentVideos: [], proposedExamples: ['as-3'] },
  examples: [{ video: { id: 'as-3', title: 'Le procès d’un orage', views: 1_250_000, durationS: 690, publishedDaysAgo: 19, outlier: true }, segments: [] }],
  steps: [
    { id: 'read', status: 'done', n: 8 },
    { id: 'examples', status: 'done', n: 2 },
    { id: 'video', status: 'done', n: 40 },
    { id: 'script', status: 'done', n: 6 },
    { id: 'synthesis', status: 'done', n: 2 }
  ],
  profile: {
    summary: 'Un documentaire raconté, sans visage.',
    components: [
      { component: 'stock', share: 0.5 },
      { component: 'ai_image', share: 0.3 }
    ],
    cutsPerMinute: 11,
    voice: { kind: 'synthetic', gender: 'f', energy: 'calme', wpm: 150 },
    notes: {}
  },
  scriptCard: { structure: ['Accroche', 'Mise en place'], hook: '', tone: '', wpm: 150, lengthMin: 8, vocabulary: '', shape: '', skills: [] },
  questions: ['camera'],
  answers: {},
  gauge: { score: 74, tier: 'adaptations', l: 1, supportSuggested: false },
  cost: { minutes: 8, modes: { qualite_max: { credits: 900, perMinute: 112 }, usage_max: { credits: 400, perMinute: 50 } } },
  proposedPipelineJson: '{"nodes":[]}',
  createdPipelineId: null
} as unknown as AnalysisDetail

const RUN = {
  id: 77,
  status: 'waiting',
  waitingNodes: ['script'],
  progress: 0.4,
  demo: true,
  current: null,
  error: null,
  nodes: [
    { nodeId: 'research', label: 'Recherche', state: 'done' },
    { nodeId: 'script', label: 'Script', state: 'waiting_gate' },
    { nodeId: 'voice', label: 'Voix', state: 'pending' }
  ]
}

async function session(): Promise<LiveOnboardingSession> {
  const call = (async (method: string) => {
    const table: Record<string, unknown> = {
      'channels.create': { id: 3 },
      'analysis.references': [{ id: 'archives-silencieuses', name: 'Archives Silencieuses', niche: '', format: '', subscribers: 1 }],
      'analysis.start': { kind: 'started', analysis: { ...DONE, status: 'choose_examples' } },
      'analysis.chooseExamples': DONE,
      'analysis.get': DONE,
      'analysis.answer': DONE,
      'analysis.createPipeline': { pipeline: { id: 11, name: 'Documentaire — Affaires' }, styleVersion: 1 },
      'pipelines.estimate': {
        minutes: 8,
        modes: {
          usage_max: { credits: 400, perMinute: 50, durationS: 900, nodes: [{ nodeId: 'research_topic', type: 'research.topic@1', where: 'local', credits: 0, durationS: 60 }, { nodeId: 'voice', type: 'voice.tts@1', where: 'cloud', credits: 120, durationS: 120 }] },
          qualite_max: { credits: 900, perMinute: 112, durationS: 900, nodes: [] }
        }
      },
      'production.quote': { debited: false, modes: { usage_max: { totalCredits: 400 } } },
      'production.list': [{ id: 77 }],
      'production.get': RUN,
      'orchestra.seed': [],
      'orchestra.agents': [{ id: 1, role: 'channel_lead', name: 'Responsable · Affaires', channelId: 3, paused: false }, { id: 2, role: 'scriptwriter', name: 'Scénariste · Affaires', channelId: 3, paused: true }],
      'orchestra.updateAgent': {}
    }
    if (!(method in table)) throw new Error(`unexpected ${method}`)
    return table[method]
  }) as unknown as Call
  const s = new LiveOnboardingSession({ call, startRun: async () => ({ libraryId: null, notes: [], runId: 77 }) })
  await s.ensureChannel(DRAFT)
  await s.runAnalysis(DRAFT)
  return s
}

function view(el: ReactElement, mode: 'live' | 'demo' = 'live'): string {
  const store = createProtoStore(initialState({ mode }))
  return renderToStaticMarkup(
    <ProtoProvider store={store}>
      <TooltipProvider>{el}</TooltipProvider>
    </ProtoProvider>
  )
}

function props(live: LiveOnboardingSession | null, extra: Partial<StepProps> = {}): StepProps {
  return { a: { ...initialAnswers('Atlas'), hasChannel: 'no', creation: 'niche', nicheId: 'niche-cold' }, set: noop, mode: 'add-channel', next: noop, ready: false, setReady: noop, live, ...extra }
}

beforeEach(() => setLocale('fr'))
afterEach(() => setOnboardingDeps(null))

describe('real onboarding: the screens', () => {
  it('the « simulé » mark is shown in real mode only', () => {
    expect(view(<SimBadge />, 'demo')).toBe('')
    setOnboardingDeps({ call: (() => Promise.reject(new Error('no'))) as unknown as Call, startRun: async () => ({ libraryId: null, notes: [] }) })
    expect(view(<SimBadge />, 'live')).toContain('simulé')
    expect(view(<SimBadge />, 'demo')).toBe('')
  })

  it('the analysis shows its real steps and example videos, the stand-in notice for a link, and the simulated competitors', async () => {
    const s = await session()
    setOnboardingDeps({ call: (() => Promise.reject(new Error('no'))) as unknown as Call, startRun: async () => ({ libraryId: null, notes: [] }) })
    const html = view(<LiveAnalysisStep {...props(s)} />)
    expect(html).toContain('data-state="done"')
    expect(html).toContain('Lecture de la chaîne')
    expect(html).toContain('8 vidéos lues')
    expect(html).toContain('Le procès d’un orage')
    expect(html).toContain('Archives Silencieuses')
    expect(html).toContain('analysis-competitors')
    expect(html).toContain('simulé')
    // a pasted link: the reference channel stands in, and the screen says so
    expect(html).toContain('Atelier Cloud')
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('the report shows the real note, the engine’s estimate and the proposal not yet in the library', async () => {
    const s = await session()
    let html = view(<LiveReportStep {...props(s)} />)
    expect(html).toContain('74 %')
    expect(html).toContain('Reproductible avec adaptations')
    expect(html).toContain('≈ 400')
    expect(html).toContain('≈ 15 min')
    expect(html).toContain('Recherche')
    expect(html).toContain('Voix')
    expect(html).toContain('Un documentaire raconté, sans visage.')
    expect(html).toContain('Banque d’images')
    expect(html).toContain('50 %')
    expect(html).toContain('Accroche')
    expect(html).toContain('ajouté à ta bibliothèque')
    await s.finishQuestions(DRAFT, { camera: false })
    html = view(<LiveReportStep {...props(s)} />)
    expect(html).toContain('Pipeline créé dans ta bibliothèque')
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('the test video asks before launching, then shows the run’s own node states and waits at the gate', async () => {
    const s = await session()
    await s.finishQuestions(DRAFT, {})
    await s.loadQuote()
    let html = view(<LiveTestStep {...props(s)} />)
    expect(html).toContain('live-test-launch')
    expect(html).toContain('Ce test coûte environ 400 crédits (8 min de vidéo)')
    expect(html).toContain('Services de démonstration')
    expect(html).toContain('Passer la vidéo test')
    await s.startTest({ title: 'Vidéo test', topic: 'Histoire' })
    html = view(<LiveTestStep {...props(s)} />)
    expect(html).toContain('data-run-id="77"')
    expect(html).toContain('attend ta validation à l’étape « Script »')
    expect(html).toContain('1 étapes terminées sur 3')
    expect(html).toContain('test-relaunch')
    expect(html).toContain('test-approve')
    for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
  })

  it('the questions say what is sent to the analysis; the team shows what was created in the runtime', async () => {
    const s = await session()
    expect(view(<LiveQuestionsStep {...props(s)} />)).toContain('live-questions-note')
    await s.setupTeam(['scriptwriter'])
    const html = view(<LiveTeamStep {...props(s)} />)
    expect(html).toContain('data-phase="done"')
    expect(html).toContain('2 agents')
    expect(html).toContain('Scénariste · Affaires')
  })
})
