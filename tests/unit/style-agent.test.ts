// « Reproduire un style » in the app (production-15), on fake eyes, a fake LLM and fake sample runs: two reference links are
// measured and the proposal lands near them; the sample is quoted before it runs, refused without the click on that very
// quote (or once the pipeline changed), and measured from its edit plan; applying a gap's edit raises the predicted score
// and the remade sample scores higher; a reference without a presenter gives the « sans présentateur » base; the IPC and
// the team agent's tools reach the same service.
import { describe, expect, it } from 'vitest'
import type { EditPlan } from '../../src/engine/formats/editplan'
import { technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { creditsBook } from '../../src/main/production/estimates/book'
import type { EngineInfo } from '../../src/shared/api'
import { cloudHelpers } from './cloud-app-helpers'
import type { ChannelIntelPort } from '../../src/main/eyes/port'
import { catalogue, roleTechnologies } from '../../src/main/orchestra/technologies'
import { studyText } from '../../src/main/orchestra/tools-style'
import { checkLinks, demoIntel, demoStyleOf, parseLink } from '../../src/main/production/style-agent/references'
import { StyleAgentService, type SampleResult } from '../../src/main/production/style-agent'
import { STYLE_METHODS } from '../../src/shared/api'
import type { AnalysisResult, StyleMeasures } from '../../src/shared/video-analysis'
import { memoryCore } from './helpers'
import type { YoutubeMetaPort } from '../../src/main/eyes/youtube-meta'

const reg = technologyRegistry()
// the engines a fresh Atelier Cloud publishes on its default grid (fakes), as the app's estimates read them
const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}
const book = creditsBook(engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, (cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }).cloud.pricing.current()), [])

const AVATAR: StyleMeasures = { presenterShare: 0.3, hookPresenterShare: 0.32, layouts: ['full', 'split'], pictures: { aiImage: 0.85, aiClip: 0.15, stock: 0, archive: 0, motion: 0 }, shotS: 5, look: 'photoreal', captions: 'none', labelsPerMinute: 1, wordsPerMinute: 180, offer: { atS: 90, durationS: 20, card: true } }
const AVATAR_2: StyleMeasures = { ...AVATAR, presenterShare: 0.26, shotS: 5.4, wordsPerMinute: 172 }
const VOICEOVER: StyleMeasures = { presenterShare: 0, hookPresenterShare: 0, layouts: [], pictures: { aiImage: 0.2, aiClip: 0, stock: 0.8, archive: 0, motion: 0 }, shotS: 7, look: 'stock', captions: 'sentences', labelsPerMinute: 0, wordsPerMinute: 150, offer: null }

const analysis = (m: StyleMeasures): AnalysisResult => ({
  summary: 'Comment ranger une cuisine sans rien acheter. La méthode des trois boîtes.',
  hook: { text: 'Vous rangez votre cuisine à l’envers.', endsAtS: 10, technique: 'shock' },
  structure: [{ fromS: 0, toS: 300, kind: 'body', summary: '' }],
  pacing: { cutsPerMinute: 60 / m.shotS, tempo: 'medium', notes: '' },
  shotTypes: [],
  onScreenText: [],
  music: { present: true, mood: '', notes: '' },
  callsToAction: [],
  measures: m
})

/** Fake eyes: a channel link gives two videos, a video link one; the measures come from the link's words. */
function fakeEyes(): ChannelIntelPort & { calls: string[] } {
  const calls: string[] = []
  const style = (url: string): StyleMeasures => (url.includes('voix') ? VOICEOVER : url.includes('v2') ? AVATAR_2 : AVATAR)
  return {
    calls,
    connected: () => true,
    async channelData(url) {
      calls.push(`channel ${url}`)
      const id = url.includes('voix') ? 'voix' : 'chan'
      return { data: { url, channelId: '', title: 'Mamie range', subscribers: 1000, totalViews: null, videoCount: 2, videos: [`${id}1`, `${id}v2`].map((v, i) => ({ id: v, title: `Vidéo ${i}`, views: 100 - i, likes: null, comments: null, durationS: 780, publishedAt: '2026-10-01', thumbnailUrl: null })), quotaUnits: 1 }, demo: false }
    },
    async analyseVideo(url, minutes) {
      calls.push(`analyse ${url} ${minutes}`)
      return { analysis: analysis(style(url)), demo: false }
    }
  }
}

/** The sample's edit plan from its pipeline: the render gives the presenter only half the time asked (a gap to close). */
function planOf(doc: RecipeDoc): EditPlan {
  const frames = 540
  const presenter = Math.round((doc.mix?.presenter ?? 0) * frames * 0.5)
  const clip = Math.round((doc.mix?.clipAi ?? 0) * frames)
  const shot = (id: string, kind: string, a: number, b: number) => ({ id, track: 'base', startFrame: a, endFrame: b, kind, transitionIn: 'cut', role: 'scene', beat: 0 })
  const shots = [
    ...(presenter > 0 ? [shot('p', 'avatar', 0, presenter)] : []),
    ...(clip > 0 ? [shot('c', 'video.gen', presenter, presenter + clip)] : []),
    shot('i1', 'image.gen', presenter + clip, Math.round((presenter + clip + frames) / 2)),
    shot('i2', 'image.gen', Math.round((presenter + clip + frames) / 2), frames)
  ]
  return { schema: 'atelier.editplan/1', fps: 30, size: { w: 1920, h: 1080 }, frames, tracks: { base: [], overlay: [], labels: [] }, captionsPreset: 'none', shots, chapters: [], diagnostics: [] } as unknown as EditPlan
}

function rig(o: { model?: boolean; meta?: YoutubeMetaPort; answer?: string } = {}) {
  const core = memoryCore({})
  const channelId = Number(core.db.prepare("INSERT INTO channels (name, niche) VALUES ('Mamie range', 'rangement')").run().lastInsertRowid)
  const eyes = fakeEyes()
  const runs = new Map<number, RecipeDoc>()
  const started: { doc: RecipeDoc; script: string; credits: number }[] = []
  const prompts: string[] = []
  const svc = new StyleAgentService({
    db: core.db,
    reg,
    costInput: async () => ({ book, backend: 'subscription' }),
    intel: () => eyes,
    ...(o.meta ? { meta: o.meta } : {}),
    sampler: {
      async hold() {
        return { credits: 150, debited: true }
      },
      async start(s) {
        started.push(s)
        runs.set(runs.size + 1, s.doc)
        return runs.size
      },
      async result(runId): Promise<SampleResult> {
        const doc = runs.get(runId) as RecipeDoc
        return { status: 'done', error: null, plan: planOf(doc), credits: 12, lookFamily: null }
      }
    },
    model:
      o.model === false
        ? null
        : async (req) => {
            prompts.push(req.prompt)
            if (o.answer) return { text: o.answer, model: 'fake' }
            return { text: '```atelier-style\n{"summary": "Un présentateur à l’écran un tiers du temps, des images IA réalistes.", "script": "Vous rangez votre cuisine à l’envers. Voici la méthode des trois boîtes, qui libère un placard entier en dix minutes, sans rien acheter."}\n```', model: 'fake' }
          },
    adopt: (input) => core.context.pipelineAgent.adopt(input),
    channels: () => [channelId],
    measureCredits: (min) => Math.ceil(min * 1.2)
  })
  return { core, svc, eyes, started, prompts, channelId }
}

describe('style: the references and the proposal', () => {
  it('reads YouTube video and channel links only', () => {
    expect(parseLink('https://www.youtube.com/@mamierange')?.kind).toBe('channel')
    expect(parseLink('https://youtu.be/abcdefgh')?.kind).toBe('video')
    expect(parseLink('https://www.youtube.com/watch?v=abcdefgh')?.kind).toBe('video')
    expect(parseLink('https://example.com/@x')).toBeNull()
    expect(() => checkLinks([])).toThrow(/au moins un lien/)
    expect(() => checkLinks(Array.from({ length: 6 }, (_, i) => `https://youtu.be/abcdef${i}`))).toThrow(/5 liens/)
  })

  it('measures two references with the eyes and lands the proposal near them', async () => {
    const { svc, eyes, prompts } = rig()
    const v = await svc.study({ links: ['https://www.youtube.com/@mamierange', 'https://youtu.be/abcdefghv2'] })
    expect(eyes.calls.filter((c) => c.startsWith('analyse'))).toHaveLength(3)
    // only the first minutes are watched
    for (const c of eyes.calls.filter((x) => x.startsWith('analyse'))) expect(Number(c.split(' ')[2])).toBeLessThanOrEqual(5)
    expect(v.measured).toBe(3)
    expect(v.measureCredits).toBeGreaterThan(0)
    expect(v.base).toBe('avatar@1')
    expect(v.reason).toBe('presenter')
    expect(v.summary).toContain('présentateur')
    expect(prompts[0]).toContain('presenter 30 %')
    expect(v.script).toContain('trois boîtes')
    const faithful = v.variants.find((x) => x.kind === 'faithful')
    expect(faithful?.perMinute?.avg).toBeGreaterThan(0)
    expect(faithful?.likeness).toBeGreaterThanOrEqual(80)
    expect(faithful?.doc.mix?.presenter).toBeCloseTo(0.28, 1)
    expect(faithful?.doc.mix?.curve).toBe('flat')
    expect(v.profile?.lookFamily).toBe('photoreal')
  })

  it('gives the « sans présentateur » base when the references show no presenter', async () => {
    const { svc } = rig({ model: false })
    const v = await svc.study({ links: ['https://www.youtube.com/@voixdumonde'] })
    expect(v.base).toBe('voiceover@1')
    expect(v.reason).toBe('no-presenter')
    expect(v.summary).toBeNull()
    for (const x of v.variants) expect(x.doc.bricks.some((b) => b.tech.startsWith('avatar.speak'))).toBe(false)
  })
})

describe('style: the sample, its score and its gaps', () => {
  it('is quoted before it runs and refused without the click on that quote', async () => {
    const { svc, started } = rig()
    const v = await svc.study({ links: ['https://www.youtube.com/@mamierange'] })
    await expect(svc.sample(v.id, 'faithful', 'nope')).rejects.toThrow(/devis/)
    const q = await svc.quote(v.id, 'faithful')
    expect(q.quote?.credits.avg).toBeGreaterThan(0)
    expect(q.quote?.credits.avg).toBeLessThan(200)
    expect(q.quote?.seconds).toBe(18)
    expect(q.quote?.hold).toBe(150)
    expect(started).toHaveLength(0)
    await expect(svc.sample(v.id, 'faithful', 'not-the-quote')).rejects.toThrow(/devis/)
    await expect(svc.sample(v.id, 'premium', q.quote?.id)).rejects.toThrow(/devis/)
    // a quote answered by another question is stale
    const s = await svc.sample(v.id, 'faithful', q.quote?.id)
    expect(started).toHaveLength(1)
    expect(started[0]?.doc.options.script).toBe('import')
    expect(started[0]?.doc.checkpoints).toEqual([])
    expect(started[0]?.script).toContain('trois boîtes')
    // the run's cap is the hold the owner saw: a run quoted above it does not start
    expect(started[0]?.doc.capCredits).toBe(150)
    expect(s.quote).toBeNull()
    // the same quote cannot run twice
    await expect(svc.sample(v.id, 'faithful', q.quote?.id)).rejects.toThrow(/devis/)
  })

  it('measures the sample, lists its gaps, and the score moves up once a gap’s edit is applied', async () => {
    const { svc } = rig()
    const v = await svc.study({ links: ['https://www.youtube.com/@mamierange'] })
    const q = await svc.quote(v.id, 'faithful')
    await svc.sample(v.id, 'faithful', q.quote?.id)
    const done = await svc.get(v.id)
    const s = done.sample
    expect(s?.status).toBe('done')
    expect(s?.credits).toBe(12)
    expect(s?.measures?.presenterShare).toBeLessThan(0.2)
    expect(s?.score).not.toBeNull()
    expect(s?.gaps.length).toBeGreaterThan(0)
    expect(s?.gaps.length).toBeLessThanOrEqual(3)
    const i = s?.gaps.findIndex((g) => g.dimension === 'presenter') ?? -1
    expect(i).toBeGreaterThanOrEqual(0)
    const gap = s?.gaps[i]
    expect(gap?.ops.length).toBeGreaterThan(0)
    expect(gap?.perMinute?.after.avg).toBeGreaterThan(gap?.perMinute?.before.avg ?? Infinity)
    expect(gap?.scoreAfter).toBeGreaterThan(s?.score ?? 100)
    const edited = await svc.applyGap(v.id, i)
    expect(edited.sample?.stale).toBe(true)
    expect(edited.sample?.predicted).toBeGreaterThan(s?.score ?? 100)
    expect(edited.variants.find((x) => x.kind === 'faithful')?.edits).toBeGreaterThan(0)
    // « Refaire l'exemple »: quoted again, made again, and measured closer
    const q2 = await svc.quote(v.id, 'faithful')
    await svc.sample(v.id, 'faithful', q2.quote?.id)
    const again = await svc.get(v.id)
    expect(again.sample?.stale).toBe(false)
    expect(again.sample?.score).toBeGreaterThan(s?.score ?? 100)
  }, 30_000) // a whole memory core: study, quote, sample, gaps (the view now prices ingredients and draws proposals)

  it('refuses a quote once the pipeline changed, and adopts the variant with its edits', async () => {
    const { svc, core } = rig()
    const v = await svc.study({ links: ['https://www.youtube.com/@mamierange'] })
    const q = await svc.quote(v.id, 'faithful')
    await svc.sample(v.id, 'faithful', q.quote?.id)
    const measured = await svc.get(v.id)
    const q2 = await svc.quote(v.id, 'faithful')
    await svc.applyGap(v.id, measured.sample?.gaps.findIndex((g) => g.ops.length > 0) ?? -1)
    await expect(svc.sample(v.id, 'faithful', q2.quote?.id)).rejects.toThrow(/devis/)
    const d = await svc.adopt(v.id, 'faithful')
    expect(d.name).toBe('Mamie range · format long') // the channel's name and the format (parcours-utilisateur, #93)
    expect(core.context.pipelineAgent.threads.messages(d.id).length).toBeGreaterThan(0)
  }, 30_000) // a whole memory core
})

describe('style: wiring', () => {
  it('lists its IPC methods and offers the team’s pipeline architect the same tools (never the run)', async () => {
    expect(STYLE_METHODS).toHaveLength(12) // + style.pick (clonage-traduction), style.choose (parcours-utilisateur)
    const tools = roleTechnologies('pipeline_architect')
    for (const t of ['style.study', 'style.read', 'style.quote']) expect(tools).toContain(t)
    expect(catalogue().some((t) => t.id === 'style.sample')).toBe(false)
    const { svc } = rig()
    const v = await svc.study({ links: ['https://www.youtube.com/@mamierange'] })
    expect(studyText(await svc.quote(v.id, 'faithful'))).toMatch(/waiting for the owner's click/)
  })

  it('works through the app’s IPC on the eyes’ demonstration when Atelier Cloud is not connected', async () => {
    const core = memoryCore({})
    core.db.prepare("INSERT INTO channels (name, niche) VALUES ('Démo', '')").run()
    const v = await core.api['style.study']({ links: ['https://www.youtube.com/@demo1'], agent: false })
    expect(v.demo).toBe(true)
    expect(v.measureCredits).toBe(0)
    expect(v.variants.length).toBeGreaterThan(0)
    expect((await core.api['style.list']())[0]?.id).toBe(v.id)
    expect(demoIntel().connected()).toBe(true)
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => demoStyleOf(`https://youtu.be/${x}`))).size).toBeGreaterThan(1)
  })
})

describe('style: can Atelier make it (essais-utilisateur)', () => {
  const meta = (calls: string[]): YoutubeMetaPort => ({
    async video(url) {
      calls.push(`video ${url}`)
      return { id: 'abcdefgh', title: 'Ma vie d’étudiant à Séoul', channel: 'Mamie range', channelUrl: 'https://www.youtube.com/@mamierange', durationS: 1245, views: 1000, subscribers: 5000, description: 'UNI VLOG, filmé au téléphone', categories: ['People & Blogs'] }
    },
    async channel() {
      return null
    }
  })

  it('a video link: its real title, what was not watched, and an honest verdict before any proposal', async () => {
    const calls: string[] = []
    const { svc, prompts } = rig({ meta: meta(calls) })
    const v = await svc.study({ links: ['https://www.youtube.com/watch?v=abcdefgh'] })
    expect(v.references[0]?.title).toBe('Ma vie d’étudiant à Séoul')
    expect(v.feasibility?.unread).toMatch(/5 premières minutes sur 21/)
    expect(v.feasibility?.missing.map((m) => m.id)).toContain('whole-video-eyes')
    expect(v.feasibility?.source).toBe('code')
    // the agent read the page's words and the code's first judgement
    expect(prompts[0]).toMatch(/UNI VLOG/)
    expect(prompts[0]).toMatch(/PARTLY WATCHED/)
    expect(prompts[0]).toMatch(/Lists for "feasibility"/)
    expect(v.scope).toBe('video')
  })

  it('« le style de sa chaîne »: the video’s channel is read as a channel', async () => {
    const calls: string[] = []
    const { svc, eyes } = rig({ meta: meta(calls) })
    const v = await svc.study({ links: ['https://www.youtube.com/watch?v=abcdefgh'], scope: 'channel' })
    expect(eyes.calls[0]).toBe('channel https://www.youtube.com/@mamierange')
    expect(v.references[0]?.kind).toBe('channel')
    expect(v.scope).toBe('channel')
  })

  it('the agent’s verdict passes checked, and no likeness is above the share Atelier makes', async () => {
    const answer = '```atelier-style\n' + JSON.stringify({ summary: 'Un vlog filmé : Atelier ne peut pas le reproduire.', script: 'Une phrase. Puis une autre phrase pour l’exemple de la chaîne.', feasibility: { share: 20, why: 'Un vlog, ce sont tes journées filmées.', parts: [{ title: 'Toi filmé', share: 80, can: 'no', how: 'filmé' }], humans: ['vlog-filming', 'someone'], missing: ['rush-editing'], instead: ['own-footage'] } }) + '\n```'
    const { svc } = rig({ meta: meta([]), answer })
    const v = await svc.study({ links: ['https://www.youtube.com/watch?v=abcdefgh'] })
    expect(v.feasibility).toMatchObject({ verdict: 'no', share: 20, source: 'agent' })
    expect(v.feasibility?.humans.map((h) => h.id)).toEqual(['vlog-filming'])
    expect(v.feasibility?.instead.map((h) => h.id)).toEqual(['own-footage', 'revoice'])
    expect(v.feasibility?.unread).toMatch(/premières minutes/)
    for (const x of v.variants) if (x.likeness !== null) expect(x.likeness).toBeLessThanOrEqual(20)
  })

  it('out of reach: the agent’s nearest base keeps its own mix, not the reference’s', async () => {
    const answer = '```atelier-style\n' + JSON.stringify({ summary: 'Hors de portée.', script: 'Une phrase. Puis une autre phrase pour l’exemple de la chaîne.', base: 'documentary@2', feasibility: { share: 10, why: 'Des scènes 3D de studio.', parts: [{ title: '3D', share: 90, can: 'no', how: 'studio' }] } }) + '\n```'
    const { svc } = rig({ meta: meta([]), answer })
    const v = await svc.study({ links: ['https://www.youtube.com/watch?v=abcdefgh'] })
    expect(v.feasibility?.verdict).toBe('no')
    expect(v.base).toBe('documentary@2')
    const doc = v.variants[0]?.doc as unknown as { mix?: Record<string, number> }
    expect(doc.mix?.presenter ?? 0).toBe(0)
  })

  it('without the pages (no yt-dlp), the study still goes on', async () => {
    const { svc } = rig()
    const v = await svc.study({ links: ['https://www.youtube.com/watch?v=abcdefgh'] })
    expect(v.feasibility?.unread).toBeNull()
    expect(v.variants.length).toBeGreaterThan(0)
  })
})
