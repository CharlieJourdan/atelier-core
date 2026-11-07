// Real mode, voices: the Cloud's voice list as the screens read it (mapping, empty states with their reason), « Mes voix » on
// the real store (Production › Technologies; presentation mode shows none since production-2), the clone form's checks,
// and the voice settings that reach the engine's run. No IPC: a fake live driver stands in for the main process.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CloudVoices } from '../../src/shared/api'
import { NO_FEATURES } from '../../src/shared/features'
import { t } from '../../src/shared/fr'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { VOICES } from '../../src/renderer/proto/data-production'
import { defaultVoice, mapVoice, mapVoices, voicesNotice, voicesOf, type LiveVoices } from '../../src/renderer/proto/live/mapping-voices'
import { setLiveDriver, type LiveDriver, type LiveRunInput, type LiveSnapshot } from '../../src/renderer/proto/live/registry'
import { applySnapshot, createProtoStore, initialState, ProtoProvider, storeActions } from '../../src/renderer/proto/store'
import { MyVoices } from '../../src/renderer/screens/production/recettes/MyVoices'
import { TechnologiesPanel } from '../../src/renderer/screens/production/recettes/TechnologiesPanel'
import { clipProblem } from '../../src/renderer/screens/production/proto/VoiceClone'

const CLOUD: CloudVoices = {
  status: 'ok',
  clone: 'demo',
  voices: [
    { id: 'demo-claire', name: 'Claire (démo)', language: 'fr', demo: true, cloned: false },
    { id: 'demo-hugo', name: 'Hugo (démo)', language: 'fr', demo: true, cloned: false },
    { id: 'demo-ava', name: 'Ava (demo)', language: 'en', demo: true, cloned: false },
    { id: 'clone-abc123def456', name: 'Marie', language: 'fr', demo: false, cloned: true }
  ]
}

describe('the Cloud voice list as the screens read it', () => {
  it('maps platform and cloned voices, keeps the demo flag, upper-cases the language', () => {
    expect(mapVoice(CLOUD.voices[0]!)).toEqual({ id: 'demo-claire', name: 'Claire (démo)', kind: 'platform', lang: 'FR', note: '', demo: true })
    expect(mapVoice(CLOUD.voices[3]!)).toEqual({ id: 'clone-abc123def456', name: 'Marie', kind: 'clone', lang: 'FR', note: '' })
    const live = mapVoices(CLOUD)
    expect(live).toMatchObject({ status: 'ok', clone: 'demo' })
    expect(live.voices.map((v) => v.id)).toEqual(CLOUD.voices.map((v) => v.id))
  })

  it('shows the demo voices in demo mode, nothing until the first read in real mode, and the Cloud’s voices after', () => {
    expect(voicesOf({ mode: 'demo', liveVoices: null })).toEqual({ voices: VOICES, status: 'demo', clone: null })
    expect(voicesOf({ mode: 'live', liveVoices: null })).toEqual({ voices: [], status: 'loading', clone: null })
    const live = mapVoices(CLOUD)
    expect(voicesOf({ mode: 'live', liveVoices: live })).toBe(live)
    // real mode never falls back to the invented demo voices
    expect(voicesOf({ mode: 'live', liveVoices: { status: 'not-connected', voices: [], clone: null } }).voices).toEqual([])
  })

  it('says why the list is empty instead of inventing voices', () => {
    expect(voicesNotice('not-connected')).toBe('cloud.voices.notConnected')
    expect(voicesNotice('unreachable')).toBe('cloud.voices.unreachable')
    for (const s of ['ok', 'demo', 'loading'] as const) expect(voicesNotice(s)).toBeNull()
    expect(t('cloud.voices.notConnected')).toMatch(/Atelier Cloud n’est pas connecté/)
  })

  it('a new video starts with the chosen voice if it still exists, else the channel’s, else a clone, else the first', () => {
    const v = mapVoices(CLOUD).voices
    expect(defaultVoice(v, 'demo-hugo', 'db-1')).toBe('demo-hugo')
    expect(defaultVoice(v, 'gone', 'db-1')).toBe('clone-abc123def456')
    expect(defaultVoice(v.slice(0, 3), '', 'db-1')).toBe('demo-claire')
    expect(defaultVoice([], '', 'db-1')).toBe('')
    // the demo list keeps its old default (the first voice, a clone, unless the channel has one)
    expect(defaultVoice(VOICES, '', 'ch-histoires')).toBe('vo-storyteller')
    expect(defaultVoice(VOICES, '', 'nope')).toBe(VOICES[0]!.id)
  })
})

describe('« Mes voix »', () => {
  const render = (state: Parameters<typeof initialState>[0]): string =>
    renderToStaticMarkup(
      <ProtoProvider store={createProtoStore(initialState(state))}>
        <FeaturesProvider value={NO_FEATURES}>
          <TooltipProvider>
            {state?.mode === 'live' ? <MyVoices /> : <TechnologiesPanel route={{ section: 'production', page: 'ressources' }} onRoute={() => undefined} />}
          </TooltipProvider>
        </FeaturesProvider>
      </ProtoProvider>
    )

  it('presentation mode: Production shows no invented voice any more (production-2, decision 0008)', () => {
    const html = render({ mode: 'demo' })
    for (const v of VOICES) expect(html).not.toContain(`data-testid="voice-${v.id}"`)
    expect(html).not.toContain('data-testid="demo-badge"')
    expect(html).not.toContain('data-testid="my-voices"')
  })

  it('real mode lists the Cloud’s voices: platform ones with their demo tag, the clone as a clone', () => {
    const html = render({ mode: 'live', liveVoices: mapVoices(CLOUD) })
    expect(html).toContain('data-testid="voice-demo-claire"')
    expect(html).toContain('data-testid="voice-clone-abc123def456"')
    expect(html).toMatch(/data-testid="voice-clone-abc123def456" data-kind="clone"/)
    expect(html).toContain(t('prod.res.voiceKind.clone'))
    expect(html).toContain(t('prod.res.voices.demoNote'))
    expect(html).not.toContain('vo-narrator') // none of the invented voices
    expect(html).not.toContain('voices-notice')
    expect(html).toContain('data-testid="add-voice"')
    expect(html).not.toMatch(/data-testid="add-voice"[^>]*disabled/)
  })

  it('real mode says it when the app is not connected: no voices, the reason, the add button disabled', () => {
    const html = render({ mode: 'live', liveVoices: { status: 'not-connected', voices: [], clone: null } })
    expect(html).toContain('data-testid="voices-notice"')
    expect(html).toContain('Atelier Cloud n’est pas connecté')
    expect(html).not.toMatch(/data-testid="voice-/)
    expect(html).toMatch(/data-testid="add-voice"[^>]*disabled/)
    const down = render({ mode: 'live', liveVoices: { status: 'unreachable', voices: [], clone: null } })
    expect(down).toContain('Atelier Cloud ne répond pas')
  })
})

// production-2: the characters' voice picker left with « Nouvelle vidéo » (decision 0008); the run still takes them (below).

describe('the clone form’s checks', () => {
  it('accepts mp3, m4a and wav up to 20 MB and says what is wrong otherwise', () => {
    expect(clipProblem('ma-voix.WAV', 1000)).toBeNull()
    expect(clipProblem('a.mp3', 20 * 1024 * 1024)).toBeNull()
    expect(clipProblem('a.m4a', 5)).toBeNull()
    expect(clipProblem('a.flac', 5)).toBe('cloud.clone.format')
    expect(clipProblem('sans-extension', 5)).toBe('cloud.clone.format')
    expect(clipProblem('a.mp3', 0)).toBe('cloud.clone.unreadable')
    expect(clipProblem('a.mp3', 20 * 1024 * 1024 + 1)).toBe('cloud.clone.tooBig')
  })
})

describe('real mode: voices in the snapshot, voice settings in the run', () => {
  const snap = (voices?: LiveVoices): LiveSnapshot => ({
    status: { enabled: false, running: 0, maxConcurrent: 3, tasks: {}, agents: 0, accountsReady: 1, accountsLimited: 0, resumesAt: null, openInbox: 0 },
    channels: [{ id: 'db-7', name: 'Histoire', handle: '', color: 1, initials: 'H', niche: '', language: 'fr', format: 'long', connected: false, subscribers: 0, views28d: 0, revenue28d: 0, trend: 0, cadence: '', automation: { idea: 'auto', script: 'auto', production: 'auto', packaging: 'auto', publishing: 'auto' }, pipelineIds: [], products: [], createdDaysAgo: 0 }],
    agents: [],
    videos: [],
    pipelines: [],
    inbox: [],
    accounts: [],
    threads: [],
    messages: [],
    ...(voices ? { voices } : {})
  })

  it('a snapshot brings the voices; one without them keeps the previous list; demo mode ignores them', () => {
    const store = createProtoStore(initialState({ mode: 'live' }))
    expect(store.get().liveVoices).toBeNull()
    store.set((s) => applySnapshot(s, snap(mapVoices(CLOUD))))
    expect(store.get().liveVoices?.voices).toHaveLength(4)
    store.set((s) => applySnapshot(s, snap()))
    expect(store.get().liveVoices?.voices).toHaveLength(4)
    const demo = createProtoStore(initialState({ mode: 'demo' }))
    demo.set((s) => applySnapshot(s, snap(mapVoices(CLOUD))))
    expect(demo.get().liveVoices).toBeNull()
  })

  it('launching sends the narrator’s voice and the characters’ voices as the run’s style', async () => {
    const started: LiveRunInput[] = []
    const noop = async () => undefined
    const driver: LiveDriver = {
      load: async () => snap(),
      answer: noop,
      say: noop,
      createAgent: noop,
      updateAgent: noop,
      memory: async () => [],
      deleteMemory: noop,
      routines: async () => [],
      toggleRoutine: noop,
      tasks: async () => [],
      inboxItem: async () => undefined,
      status: async () => snap().status,
      tick: noop,
      schedule: noop,
      startRun: async (input) => {
        started.push(input)
        return { libraryId: null, notes: [] }
      }
    }
    setLiveDriver(driver)
    const store = createProtoStore(initialState({ mode: 'live' }))
    store.set((s) => applySnapshot(s, snap(mapVoices(CLOUD))))
    const act = storeActions(store)
    const video = { channelId: 'db-7', title: 'Dialogue', brief: 'b', format: 'long' as const, pipelineId: 'live-simple-narrated', stage: 'idea' as const, progress: 0, status: 'running' as const, dueInDays: 0, publishInDays: null, publishTime: '18:00', durationSec: 60, creditsSpent: 0, creditsEstimate: 0, agentId: '', thumbHue: 1 }
    act.addVideo(video, { inputs: { script: 'ALICE: Salut.\nBOB: Oui.' }, style: { voice: 'demo-claire', speakers: { ALICE: 'demo-hugo', BOB: 'clone-abc123def456' } } })
    await vi.waitFor(() => expect(started).toHaveLength(1))
    expect(started[0]!.style).toEqual({ voice: 'demo-claire', speakers: { ALICE: 'demo-hugo', BOB: 'clone-abc123def456' } })
    act.addVideo(video)
    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(started[1]!.style).toBeUndefined()
    setLiveDriver(null)
  })
})
