// « Créer une pipeline » on four long videos of The Japanese Method (style-japanese, research note style-japanese-method-2026-11 (old repository)):
// the eyes are a fake that answers what was measured on frames and transcripts over each video's first five minutes (the window
// the eyes watch), the agent is a fake, the prices are a fresh Atelier Cloud's default grid. The channel's presenter talks to
// camera only in a 3–6 s selfie opening (2 % of the window) but acts in 20–42 % of the pictures of its three recent videos:
// the proposal must be `avatar@1` with the presenter acting, almost all pictures clips, no labels, warm daylight and a hand-held
// camera — never Headcast's grey light and steady camera that `avatar@1`'s own profile carries.
import { describe, expect, it } from 'vitest'
import { technologyRegistry } from '../../src/engine/technologies'
import type { ChannelIntelPort } from '../../src/main/eyes/port'
import { creditsBook } from '../../src/main/production/estimates/book'
import { StyleAgentService } from '../../src/main/production/style-agent'
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

// 0:00–5:00 of each video (frames one a second over 0:00–0:59 and 60 s of the body, 28 more spread over the whole video;
// auto-caption word timings). Presenter = the red-polo man speaking to camera (a hand-held selfie); his acting shots are
// pictures. Every picture moves (frame-to-frame difference ≥ 7/255 inside a shot): clips. motion = the offer's sales page and QR card.
const base = { layouts: ['full'], look: 'photoreal' as const, captions: 'none' as const, labelsPerMinute: 0, light: 'warm' as const, camera: 'handheld' as const }
export const JAPANESE_METHOD: Record<string, StyleMeasures> = {
  // « I'm 52 and Japanese — 11 Things I Removed From My Home After 50 » (21:35)
  kzyCJJWvPPQ: { ...base, presenterShare: 0.02, hookPresenterShare: 0.1, presenterRunMaxS: 3, presenterActs: 0.4, pictures: { aiImage: 0, aiClip: 0.97, stock: 0, archive: 0, motion: 0.03 }, shotS: 2.7, wordsPerMinute: 188, offer: { atS: 290, durationS: 15, card: true } },
  // « 11 Things Making Your Home Uncomfortable for Guests » (27:37): the offer comes at 5:30, after the eyes' window
  'J_lLLactF-8': { ...base, presenterShare: 0.015, hookPresenterShare: 0.13, presenterRunMaxS: 4, presenterActs: 0.32, pictures: { aiImage: 0, aiClip: 1, stock: 0, archive: 0, motion: 0 }, shotS: 2.9, wordsPerMinute: 185, offer: null },
  // « 13 Japanese Home Habits for a Simple, Calm Life » (31:31): offer at 5:10, after the window
  't-BLnR8CDV8': { ...base, presenterShare: 0.025, hookPresenterShare: 0.13, presenterRunMaxS: 4, presenterActs: 0.21, pictures: { aiImage: 0, aiClip: 1, stock: 0, archive: 0, motion: 0 }, shotS: 2.6, wordsPerMinute: 195, offer: null },
  // « Decluttering Room by Room Is Backwards » (23:16, the older format: the presenter never acts)
  WzxvBmDLcA0: { ...base, presenterShare: 0.02, hookPresenterShare: 0.2, presenterRunMaxS: 6, presenterActs: 0, pictures: { aiImage: 0, aiClip: 0.93, stock: 0, archive: 0, motion: 0.07 }, shotS: 2.7, wordsPerMinute: 216, offer: { atS: 245, durationS: 20, card: true } }
}

const analysis = (m: StyleMeasures): AnalysisResult => ({
  summary: 'A middle-aged Japanese man compares Japanese and American homes and gives numbered decluttering rules.',
  hook: { text: 'Tonight, when you get home, stop at your front door and count the shoes.', endsAtS: 70, technique: 'story' },
  structure: [{ fromS: 0, toS: 300, kind: 'body', summary: '' }],
  pacing: { cutsPerMinute: 60 / m.shotS, tempo: 'fast', notes: '' },
  shotTypes: [],
  onScreenText: [],
  music: { present: true, mood: 'calm piano', notes: '' },
  callsToAction: [],
  measures: m
})

function eyes(): ChannelIntelPort {
  return {
    connected: () => true,
    channelData: async () => {
      throw new Error('video links only')
    },
    async analyseVideo(url) {
      const id = new URL(url).searchParams.get('v') ?? ''
      const m = JAPANESE_METHOD[id]
      if (!m) throw new Error(`unknown video ${id}`)
      return { analysis: analysis(m), demo: false }
    }
  }
}

const LINKS = Object.keys(JAPANESE_METHOD).map((id) => `https://www.youtube.com/watch?v=${id}`)

async function service() {
  const core = memoryCore({})
  const channelId = Number(core.db.prepare("INSERT INTO channels (name, niche) VALUES ('Kenji at Home', 'decluttering')").run().lastInsertRowid)
  const svc = new StyleAgentService({
    db: core.db,
    reg,
    costInput: async () => ({ book, backend: 'subscription' }),
    intel: eyes,
    sampler: null,
    model: null,
    adopt: (input) => core.context.pipelineAgent.adopt(input),
    channels: () => [channelId],
    measureCredits: (min) => Math.ceil(min * 1.2)
  })
  return { svc, core }
}

async function study(links: string[]): Promise<StudyView> {
  return (await service()).svc.study({ text: 'Reproduce this channel’s style.', links, agent: false })
}

const setting = (v: StudyView['variants'][number], brick: string, key: string): unknown => v.doc.bricks.find((b) => b.tech.startsWith(`${brick}@`))?.settings[key]

describe('« Créer une pipeline » on The Japanese Method', () => {
  it('lands on avatar@1 with the presenter acting, clips, no labels, the references’ light and camera', async () => {
    const v = await study(LINKS)
    const rows = v.variants.map((x) => {
      const m = (x.doc.mix ?? {}) as Record<string, unknown>
      const pct = (k: string): string => `${Math.round(Number(m[k] ?? 0) * 100)}`
      return `| ${x.kind} | ${pct('presenter')} / ${pct('clipAi')} / ${pct('imageAi')} | ${String(m.curve ?? 'flat')} | ${String(x.doc.options.presenterInBroll ?? '—')} | ${String(setting(x, 'director.plan', 'illustration') ?? '—')} | ${x.perMinute ? Math.round(x.perMinute.avg) : '—'} | ${x.likeness ?? '—'} |`
    })
    console.log(['| Variante | Présentateur / clips / images % | Courbe | Présentateur dans les images | Grammaire | Crédits / min | Estimation /100 |', '|---|---|---|---|---|---|---|', ...rows].join('\n'))
    console.log(JSON.stringify(v.profile))
    expect(v.base).toBe('avatar@1')
    expect(v.reason).toBe('presenter')
    const faithful = v.variants.find((x) => x.kind === 'faithful')
    if (!faithful) throw new Error('no faithful variant')
    expect(faithful.doc.options.presenterInBroll).toBe('presenter-as-actor')
    expect(faithful.doc.mix?.presenter).toBeLessThan(0.1)
    expect(setting(faithful, 'director.plan', 'labelsPerMin')).toBe(0)
    // Headcast's grammar (grey overcast light, steady camera) is avatar@1's own profile, not these references'
    expect(setting(faithful, 'director.plan', 'illustration')).toBe('presenter-vlog')
    expect(setting(faithful, 'clip.make', 'clipMotion')).not.toMatch(/steady/i)
    expect(setting(faithful, 'director.plan', 'presenterRunMaxS')).toBeLessThanOrEqual(6)
    expect(v.profile?.offerAtS).toBeGreaterThan(240)
    expect(faithful.likeness).toBeGreaterThanOrEqual(70)
  })

  it('« Utiliser cette pipeline » keeps the references’ measured profile with the pipeline', async () => {
    const { svc, core } = await service()
    const v = await svc.study({ text: 'Reproduce this channel’s style.', links: LINKS, agent: false })
    const d = await svc.adopt(v.id, 'faithful')
    expect(d.doc.options.presenterInBroll).toBe('presenter-as-actor')
    const first = (await core.context.pipelineAgent.thread(d.id)).messages[0]?.text ?? ''
    console.log(first)
    expect(first).toMatch(/Profil mesuré \(4 vidéos\)/)
    expect(first).toMatch(/joue dans 27 % des images/)
    expect(first).toMatch(/lumière jour chaud/)
    expect(first).toMatch(/caméra à la main/)
    expect(first).toMatch(/aucun texte/)
  })
})
