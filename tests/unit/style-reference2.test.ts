// « Créer une pipeline » on Charlie's two reference videos (style-test-2, research note reference-video-2-2026-11 (old repository)): the eyes
// are a fake that answers what was measured by hand on each video's first five minutes (the window the eyes watch), the agent
// is a fake, the prices are a fresh Atelier Cloud's default grid. Both are the same Headcast-made avatar style: the proposal
// is `avatar@1` with the presenter's three layouts, near a quarter of presenter time, the offer card kept, priced, and
// scored near the references. The table is printed for the research page.
import { describe, expect, it } from 'vitest'
import { technologyRegistry } from '../../src/engine/technologies'
import type { ChannelIntelPort } from '../../src/main/eyes/port'
import { creditsBook } from '../../src/main/production/estimates/book'
import { StyleAgentService } from '../../src/main/production/style-agent'
import { demoIntel, demoStyleOf } from '../../src/main/production/style-agent/references'
import type { EngineInfo } from '../../src/shared/api'
import type { StudyView } from '../../src/shared/style-agent'
import type { AnalysisResult, StyleMeasures } from '../../src/shared/video-analysis'
import { cloudHelpers } from './cloud-app-helpers'
import { memoryCore } from './helpers'

const reg = technologyRegistry()
const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}
const book = creditsBook(engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, (cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }).cloud.pricing.current()), [])

// 0:00–5:00 of each video, measured on its scene cuts and transcript (shares of the pictures exclude the presenter's time;
// clips = every moving B-roll shot, the presenter-like actors included; motion = the offer card)
const REFERENCE_1: StyleMeasures = { presenterShare: 0.291, hookPresenterShare: 0.556, layouts: ['full', 'split', 'inset'], pictures: { aiImage: 0.107, aiClip: 0.847, stock: 0, archive: 0, motion: 0.046 }, shotS: 3.8, look: 'photoreal', captions: 'none', labelsPerMinute: 0, wordsPerMinute: 197, offer: { atS: 85, durationS: 9.7, card: true } }
const REFERENCE_2: StyleMeasures = { presenterShare: 0.246, hookPresenterShare: 0.335, layouts: ['full', 'split', 'inset'], pictures: { aiImage: 0.043, aiClip: 0.889, stock: 0, archive: 0, motion: 0.068 }, shotS: 3.7, look: 'photoreal', captions: 'none', labelsPerMinute: 0, wordsPerMinute: 192, offer: { atS: 92, durationS: 15.4, card: true } }

const analysis = (m: StyleMeasures, summary: string): AnalysisResult => ({
  summary,
  hook: { text: 'Le 2 janvier, vous rentrez de chez votre fille après les fêtes.', endsAtS: 47, technique: 'story' },
  structure: [{ fromS: 0, toS: 300, kind: 'body', summary: '' }],
  pacing: { cutsPerMinute: 60 / m.shotS, tempo: 'fast', notes: '' },
  shotTypes: [],
  onScreenText: [],
  music: { present: false, mood: '', notes: '' },
  callsToAction: [],
  measures: m
})

function eyes(): ChannelIntelPort {
  return {
    connected: () => true,
    channelData: async () => {
      throw new Error('a video link only')
    },
    async analyseVideo(url) {
      const two = url.includes('reference2')
      return { analysis: analysis(two ? REFERENCE_2 : REFERENCE_1, two ? 'Cinq gestes avant les premières gelées.' : 'Une vieille astuce contre l’humidité.'), demo: false }
    }
  }
}

async function study(links: string[], o: { intel?: () => ChannelIntelPort; text?: string } = {}): Promise<StudyView> {
  const core = memoryCore({})
  const channelId = Number(core.db.prepare("INSERT INTO channels (name, niche) VALUES ('marcel artisan', 'plomberie')").run().lastInsertRowid)
  const svc = new StyleAgentService({
    db: core.db,
    reg,
    costInput: async () => ({ book, backend: 'subscription' }),
    intel: o.intel ?? eyes,
    sampler: null,
    model: null,
    adopt: (input) => core.context.pipelineAgent.adopt(input),
    channels: () => [channelId],
    measureCredits: (min) => Math.ceil(min * 1.2)
  })
  return svc.study({ text: o.text ?? 'Reproduis le style de ma vidéo.', links, agent: false })
}

const row = (name: string, v: StudyView): string[] =>
  v.variants.map((x) => {
    const m = (x.doc.mix ?? {}) as Record<string, unknown>
    const pct = (k: string): string => `${Math.round(Number(m[k] ?? 0) * 100)}`
    return `| ${name} | ${x.kind} | ${pct('presenter')} / ${pct('clipAi')} / ${pct('imageAi')} | ${String(m.curve ?? 'flat')} | ${x.perMinute ? Math.round(x.perMinute.avg) : '—'} | ${x.likeness ?? '—'} |`
  })

describe('« Créer une pipeline » on the two reference videos', () => {
  it('both give the avatar base with the three layouts, priced and scored near the references', async () => {
    const one = await study(['https://www.youtube.com/watch?v=reference1'])
    const two = await study(['https://www.youtube.com/watch?v=reference2'])
    const table = ['| Référence | Variante | Mix présentateur / clips / images % | Courbe | Crédits / min | Estimation /100 |', '|---|---|---|---|---|---|', ...row('1', one), ...row('2', two)]
    console.log(table.join('\n'))
    for (const v of [one, two]) {
      expect(v.base).toBe('avatar@1')
      expect(v.reason).toBe('presenter')
      expect(v.profile?.layouts).toEqual(['full', 'split', 'inset'])
      expect(v.profile?.offerAtS).toBeGreaterThan(60)
      const faithful = v.variants.find((x) => x.kind === 'faithful')
      expect(faithful?.doc.mix?.presenter).toBeGreaterThan(0.2)
      expect(faithful?.doc.mix?.presenter).toBeLessThan(0.32)
      expect(faithful?.perMinute?.avg).toBeGreaterThan(0)
      expect(faithful?.likeness).toBeGreaterThanOrEqual(70)
      // « économique » halves the clips into stills and keeps the presenter's time: cheaper, and still near the references
      const cheap = v.variants.find((x) => x.kind === 'cheap')
      expect(cheap?.doc.mix?.presenter).toBeCloseTo(faithful?.doc.mix?.presenter ?? 0, 3)
      expect(cheap?.doc.mix?.clipAi).toBeLessThan(faithful?.doc.mix?.clipAi ?? 0)
      expect(cheap?.perMinute?.avg).toBeLessThan(faithful?.perMinute?.avg ?? 0)
      expect(cheap?.likeness).toBeGreaterThanOrEqual((faithful?.likeness ?? 0) - 5)
    }
  })

  it('the eyes’ demonstration gives way to the owner’s words: a presenter they describe gets the avatar base', async () => {
    const text = 'Marcel, plombier à la retraite, parle face caméra dans son atelier, entre des plans réalistes.'
    // demoStyleOf picks the stock voice-over style for this link (no presenter)
    const link = Array.from({ length: 40 }, (_, i) => `https://www.youtube.com/watch?v=demo${i}`).find((l) => demoStyleOf(l) === 1) as string
    const v = await study([link], { intel: demoIntel, text })
    expect(v.demo).toBe(true)
    expect(v.base).toBe('avatar@1')
    expect(v.reason).toBe('chosen')
    const faithful = v.variants.find((x) => x.kind === 'faithful')
    expect(faithful?.doc.mix?.presenter).toBeGreaterThan(0.2)
    expect(faithful?.doc.mix?.stock ?? 0).toBe(0)
    // without words, the demonstration still shows its example style
    expect((await study([link], { intel: demoIntel, text: 'Mon style.' })).base).toBe('voiceover@1')
    // words that agree with the demonstration keep its example measures (and its estimate)
    const avatarLink = Array.from({ length: 40 }, (_, i) => `https://www.youtube.com/watch?v=demo${i}`).find((l) => demoStyleOf(l) === 0) as string
    const same = await study([avatarLink], { intel: demoIntel, text })
    expect(same.base).toBe('avatar@1')
    expect(same.variants.find((x) => x.kind === 'faithful')?.likeness).not.toBeNull()
  })
})
