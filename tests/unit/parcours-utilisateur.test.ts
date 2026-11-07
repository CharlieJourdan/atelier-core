// parcours-utilisateur: every way into « Créer une pipeline » as a new user takes it, on fake eyes and a fake agent — clone a channel,
// import my own (two proposals at most), translate (a language is needed), mix two channels, create from scratch with an inspiration
// per axis, a little different (two changes ticked from the start), rework one of my pipelines (a new version of it); a channel that
// mixes formats is measured on its best-viewed one, a weak channel is told so plainly with its improvements first, and eyes that
// cannot watch never block the path nor show a provider's name.
import { describe, expect, it } from 'vitest'
import { avatarBase, documentary2Base, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { inspire } from '../../src/engine/technologies/inspirations'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import type { ChannelIntelPort } from '../../src/main/eyes/port'
import { StyleAgentService } from '../../src/main/production/style-agent'
import { channelInsight, formatOf } from '../../src/main/production/style-agent/insight'
import { parseLink, plainProblem } from '../../src/main/production/style-agent/references'
import { parseStyleBlock } from '../../src/main/production/style-agent/prompt'
import type { ChannelVideo } from '../../src/shared/cloud-api'
import type { AnalysisResult, StyleMeasures } from '../../src/shared/video-analysis'
import { memoryCore } from './helpers'

const reg = technologyRegistry()

const ARCHIVES: StyleMeasures = { presenterShare: 0, hookPresenterShare: 0, layouts: [], pictures: { aiImage: 0.05, aiClip: 0, stock: 0, archive: 0.75, motion: 0.2 }, shotS: 5.5, look: 'archive', captions: 'none', labelsPerMinute: 0.4, wordsPerMinute: 165, offer: null }
const STORY: StyleMeasures = { presenterShare: 0, hookPresenterShare: 0, layouts: [], pictures: { aiImage: 0, aiClip: 0, stock: 1, archive: 0, motion: 0 }, shotS: 2.3, look: 'stock', captions: 'words', labelsPerMinute: 0, wordsPerMinute: 305, offer: null }
const MOTION: StyleMeasures = { presenterShare: 0, hookPresenterShare: 0, layouts: [], pictures: { aiImage: 0.1, aiClip: 0, stock: 0, archive: 0.4, motion: 0.5 }, shotS: 4, look: 'illustrated', captions: 'none', labelsPerMinute: 3, wordsPerMinute: 170, offer: null }
const AVATAR: StyleMeasures = { presenterShare: 0.35, hookPresenterShare: 0.4, layouts: ['full', 'split'], pictures: { aiImage: 0.8, aiClip: 0.2, stock: 0, archive: 0, motion: 0 }, shotS: 4.5, look: 'photoreal', captions: 'none', labelsPerMinute: 1, wordsPerMinute: 190, offer: null }

const analysis = (m: StyleMeasures): AnalysisResult => ({
  summary: 'Une histoire racontée pas à pas.',
  hook: { text: 'Personne ne s’attendait à ça.', endsAtS: 8, technique: 'shock' },
  structure: [{ fromS: 0, toS: 300, kind: 'body', summary: '' }],
  pacing: { cutsPerMinute: 60 / m.shotS, tempo: 'medium', notes: '' },
  shotTypes: [],
  onScreenText: [],
  music: { present: true, mood: '', notes: '' },
  callsToAction: [],
  measures: m
})

const video = (id: string, durationS: number, views: number): ChannelVideo => ({ id, title: `Vidéo ${id}`, views, likes: null, comments: null, durationS, publishedAt: '2026-10-01', thumbnailUrl: null })

/** Channels by handle: their latest videos (length, views) and the style the eyes see on them. */
const CHANNELS: Record<string, { title: string; subscribers: number; videos: ChannelVideo[]; style: StyleMeasures }> = {
  markets: { title: 'Markets of the Past', subscribers: 400_000, videos: [1, 2, 3, 4, 5].map((i) => video(`mk${i}`, 1500, 90_000 + i * 1000)), style: ARCHIVES },
  reddit: { title: 'RedditChroniques', subscribers: 120_000, videos: [1, 2, 3, 4, 5].map((i) => video(`rd${i}`, 55, 60_000 + i)), style: STORY },
  monde: { title: 'Le Monde en POV', subscribers: 80_000, videos: [1, 2, 3, 4].map((i) => video(`mo${i}`, 700, 40_000 + i)), style: MOTION },
  marcel: { title: 'Marcel', subscribers: 5_000, videos: [1, 2, 3].map((i) => video(`lu${i}`, 600, 3_000 + i)), style: AVATAR },
  petite: { title: 'Petite chaîne', subscribers: 300, videos: [1, 2, 3, 4].map((i) => video(`pe${i}`, 900, 100 + i)), style: ARCHIVES },
  // long documentaries seen little, Shorts seen a lot: the Shorts are the best-viewed format
  mixte: { title: 'Chaîne mixte', subscribers: 50_000, videos: [...[1, 2, 3].map((i) => video(`ms${i}`, 50, 80_000 + i)), ...[1, 2, 3].map((i) => video(`ml${i}`, 1200, 4_000 + i))], style: ARCHIVES },
  cassee: { title: 'Chaîne sans yeux', subscribers: 20_000, videos: [1, 2, 3].map((i) => video(`ca${i}`, 900, 12_000)), style: ARCHIVES }
}
const handle = (url: string): string => /@([\w-]+)/.exec(url)?.[1] ?? ''

function fakeEyes(): ChannelIntelPort & { calls: string[] } {
  const calls: string[] = []
  const byVideo = (url: string): string => Object.keys(CHANNELS).find((k) => CHANNELS[k]?.videos.some((v) => url.includes(v.id))) ?? 'markets'
  return {
    calls,
    connected: () => true,
    async channelData(url) {
      calls.push(`channel ${url}`)
      // seen live on 02/11: Atelier Cloud without its YouTube key answers a demonstration channel (its videos are not the channel's)
      if (handle(url).startsWith('sansyoutube')) return { data: { url, channelId: '', title: 'Chaîne de démonstration', subscribers: 12_345, totalViews: null, videoCount: 3, videos: [video('demo1', 900, 9000), video('demo2', 900, 8000), video('demo3', 900, 7000)], quotaUnits: 0 }, demo: true }
      const c = CHANNELS[handle(url)]
      if (!c) throw new Error('chaîne inconnue')
      return { data: { url, channelId: '', title: c.title, subscribers: c.subscribers, totalViews: null, videoCount: c.videos.length, videos: c.videos, quotaUnits: 1 }, demo: false }
    },
    async analyseVideo(url, minutes) {
      calls.push(`analyse ${url} ${minutes}`)
      const k = byVideo(url)
      if (url.includes('demo')) throw new Error('Atelier Cloud a refusé la demande (conflict).')
      if (k === 'cassee') throw new Error('Le fournisseur a échoué : Gemini analysis: HTTP 403, the key is refused (PERMISSION_DENIED)')
      return { analysis: analysis((CHANNELS[k] as { style: StyleMeasures }).style), demo: false }
    }
  }
}

const link = (h: string): string => `https://www.youtube.com/@${h}`

function rig(o: { reply?: string } = {}) {
  const core = memoryCore({})
  const channelId = Number(core.db.prepare("INSERT INTO channels (name, niche) VALUES ('Ma chaîne', 'histoire')").run().lastInsertRowid)
  const eyes = fakeEyes()
  const prompts: string[] = []
  const recipes = core.context.pipelineAgent.recipes
  const svc = new StyleAgentService({
    db: core.db,
    reg,
    costInput: async () => null,
    intel: () => eyes,
    sampler: null,
    model: o.reply === undefined ? null : async (req) => {
      prompts.push(req.prompt)
      return { text: o.reply as string, model: 'fake' }
    },
    adopt: (input) => core.context.pipelineAgent.adopt(input),
    recipe: (id) => ({ name: recipes.get(id).name, doc: recipes.doc(id).doc }),
    rework: (id, ops, note) => recipes.edit(id, ops, note),
    channels: () => [channelId]
  })
  return { core, svc, eyes, prompts, recipes }
}

describe('what a channel\'s numbers say', () => {
  it('finds the formats, the best-viewed one of a channel that mixes them, and says it', () => {
    const c = CHANNELS.mixte as (typeof CHANNELS)['mixte']
    const i = channelInsight({ title: c.title, subscribers: c.subscribers, videos: c.videos })
    expect(i.heterogeneous).toBe(true)
    expect(i.best).toBe('short')
    expect(i.lines[0]).toMatch(/mélange plusieurs formats.*Shorts, ceux qui font le plus de vues/)
    expect(formatOf(55)).toBe('short')
    expect(formatOf(600)).toBe('long')
  })

  it('says plainly when a channel is weak, kindly when it is the owner\'s own, and when one works', () => {
    const p = CHANNELS.petite as (typeof CHANNELS)['petite']
    const weak = channelInsight({ title: p.title, subscribers: p.subscribers, videos: p.videos })
    expect(weak.verdict).toBe('weak')
    expect(weak.lines.join(' ')).toMatch(/ne sont pas ouf.*pipeline meilleure/)
    expect(channelInsight({ title: p.title, subscribers: p.subscribers, videos: p.videos }, true).lines.join(' ')).toMatch(/tes vidéos décollent peu/)
    const m = CHANNELS.markets as (typeof CHANNELS)['markets']
    expect(channelInsight({ title: m.title, subscribers: m.subscribers, videos: m.videos }).verdict).toBe('strong')
  })

  it('a channel handle with accents is a channel link (Le Monde en POV)', () => {
    expect(parseLink('https://www.youtube.com/@lemondedécrypté-p5l')?.kind).toBe('channel')
    expect(parseLink('https://www.youtube.com/@lemonded%C3%A9crypt%C3%A9-p5l')?.kind).toBe('channel')
  })

  it('a problem is said in plain French: never a provider, a key or an HTTP code', () => {
    const said = plainProblem(new Error('Le fournisseur a échoué : Gemini analysis: HTTP 403, the key is refused (PERMISSION_DENIED)'))
    expect(said).toMatch(/yeux d’Atelier/)
    expect(said).not.toMatch(/Gemini|403|key/)
    expect(plainProblem(new Error('Video analysis: the answer was cut at 4096 tokens'))).toMatch(/lecture a été coupée/)
  })
})

describe('inspirations per axis (pure)', () => {
  it('each axis sets only what is its own, and says what it took', () => {
    const doc = fromBase(documentary2Base)
    const m = (s: StyleMeasures): VideoMeasure => ({ presenterShare: s.presenterShare, kinds: { archive: s.pictures.archive, motion: s.pictures.motion, imageAi: s.pictures.aiImage, stock: s.pictures.stock }, shotS: s.shotS, labelsPerMinute: s.labelsPerMinute, wordsPerMinute: s.wordsPerMinute, captions: s.captions !== 'none' }) as VideoMeasure
    const r = inspire(doc, [
      { axis: 'editing', title: 'RedditChroniques', refs: [m(STORY)] },
      { axis: 'motion', title: 'Le Monde en POV', refs: [m(MOTION)] },
      { axis: 'script', title: 'Marcel', refs: [m(AVATAR)] }
    ], reg)
    expect(Object.values(r.doc.mix?.shotLengthS ?? {})).toContain(2.3)
    expect(r.doc.mix?.motion).toBeCloseTo(0.5, 2)
    const speed = r.doc.bricks.find((b) => b.tech.startsWith('voice.tts@'))?.settings.speed
    expect(typeof speed).toBe('number')
    expect(speed).toBeGreaterThan(1)
    expect(r.axes.map((a) => a.taken)).toEqual([true, true, true])
    expect(r.axes[1]?.said).toMatch(/Le Monde en POV : des cartes animées sur 50 %/)
  })

  it('a base that draws no cards says the motion gap instead of faking it', () => {
    const r = inspire(fromBase(avatarBase), [{ axis: 'motion', title: 'Le Monde en POV', refs: [{ kinds: { motion: 0.5, archive: 0.5 } } as VideoMeasure] }], reg)
    expect(r.axes[0]?.said).toMatch(/seule la base Documentaire les dessine/)
  })
})

describe('every way into « Créer une pipeline »', () => {
  it('clone: a strong documentary channel, measured on its two most viewed videos, a few varied proposals', async () => {
    const { core, svc, eyes } = rig()
    try {
      const v = await svc.study({ links: [link('markets')], agent: false })
      expect(v.path).toBe('clone')
      expect(v.base).toBe('documentary@2')
      expect(eyes.calls.filter((c) => c.startsWith('analyse'))).toHaveLength(2)
      expect(v.insights[0]?.verdict).toBe('strong')
      expect(v.differentiators.length).toBeGreaterThanOrEqual(3)
      expect(v.differentiators.length).toBeLessThanOrEqual(5)
      expect(v.ask).toMatch(/différencier/)
      expect(v.timing.analysisS).not.toBeNull()
      expect(v.timing.videoS).toBeGreaterThan(0)
      expect(v.questions.some((q) => q.id === 'presenter')).toBe(false)
    } finally {
      core.close()
    }
  })

  it('a channel that mixes formats is measured on its best-viewed one (its Shorts)', async () => {
    const { core, svc, eyes } = rig()
    try {
      const v = await svc.study({ links: [link('mixte')], agent: false })
      expect(eyes.calls.filter((c) => c.startsWith('analyse')).every((c) => c.includes('/shorts/ms'))).toBe(true)
      expect(v.insights[0]?.heterogeneous).toBe(true)
      const longs = await svc.study({ links: [link('mixte')], agent: false, format: 'long' })
      expect(longs.insights[0]?.best).toBe('long')
      expect(eyes.calls.filter((c) => c.startsWith('analyse')).slice(-2).every((c) => c.includes('watch?v=ml'))).toBe(true)
    } finally {
      core.close()
    }
  })

  it('a weak channel is told so, with its improvements first and recommended', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ links: [link('petite')], agent: false })
      expect(v.insights[0]?.verdict).toBe('weak')
      expect(v.insights[0]?.lines.join(' ')).toMatch(/pas ouf/)
      expect(v.differentiators[0]?.effect).toBe('improve')
      expect(v.differentiators[0]?.recommended).toBe(true)
      expect(v.ask).toMatch(/ne décolle pas/)
    } finally {
      core.close()
    }
  })

  // the coordinator's review of the demo films (03/11)
  it('an estimate is never claimed above 80; a pipeline from video links gets a short French name, never the eyes’ description', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ links: ['https://www.youtube.com/watch?v=mk1abcdef'], agent: false })
      expect(v.variants.every((x) => x.likeness === null || x.likeness <= 80)).toBe(true)
      expect(v.differentiators.every((d) => !d.likeness || (d.likeness.before <= 80 && d.likeness.after <= 80))).toBe(true)
      expect(v.variants[0]?.doc.name).toBe('Documentaire · format long')
      const story = await svc.study({ text: 'Des histoires Reddit lues vite sur des clips satisfaisants', agent: false })
      expect(story.variants[0]?.doc.name).toBe('Des histoires Reddit lues vite sur des · Shorts')
    } finally {
      core.close()
    }
  })

  it('import my own channel: identical, two improvements at most', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ links: [link('markets')], path: 'own', agent: false })
      expect(v.own).toBe(true)
      expect(v.differentiators.length).toBeLessThanOrEqual(2)
      expect(v.differentiators.every((d) => d.effect !== 'differ')).toBe(true)
    } finally {
      core.close()
    }
  })

  it('translate: a language is needed, the pipeline speaks it', async () => {
    const { core, svc } = rig()
    try {
      await expect(svc.study({ links: [link('markets')], path: 'translate', agent: false })).rejects.toThrow(/langue/)
      const v = await svc.study({ links: [link('markets')], path: 'translate', language: 'fr', agent: false })
      expect(v.variants.every((x) => x.doc.language === 'fr' && x.doc.name.endsWith('(FR)'))).toBe(true)
      expect(v.ask).toMatch(/originale/)
    } finally {
      core.close()
    }
  })

  it('a little different: two changes that differ are ticked from the start, untickable', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ links: [link('markets')], path: 'different', agent: false })
      const picked = v.differentiators.filter((d) => d.picked)
      expect(picked).toHaveLength(2)
      expect(picked.every((d) => d.effect === 'differ')).toBe(true)
      const none = await svc.pick(v.id, [])
      expect(none.differentiators.some((d) => d.picked)).toBe(false)
    } finally {
      core.close()
    }
  })

  it('create from scratch with an inspiration per axis: each link measured once, each axis says what it gave', async () => {
    const { core, svc, eyes } = rig()
    try {
      const v = await svc.study({
        path: 'inspire',
        text: 'Des histoires d’époque, sobres et sombres',
        instructions: 'Pas de musique triste',
        inspirations: [
          { axis: 'content', link: link('markets') },
          { axis: 'editing', link: link('markets') },
          { axis: 'motion', link: link('monde') },
          { axis: 'script', link: link('marcel') }
        ],
        agent: false
      })
      expect(eyes.calls.filter((c) => c.startsWith('channel'))).toHaveLength(3)
      expect(v.base).toBe('documentary@2')
      expect(v.inspirations.map((a) => a.axis)).toEqual(['content', 'editing', 'motion', 'script'])
      expect(v.inspirations.every((a) => a.taken)).toBe(true)
      expect(v.inspirations.find((a) => a.axis === 'motion')?.said).toMatch(/Le Monde en POV/)
      expect(v.variants[0]?.doc.mix?.motion).toBeCloseTo(0.5, 1)
      expect(v.instructions).toBe('Pas de musique triste')
      const d = await svc.adopt(v.id, v.recommended)
      const first = core.db.prepare('SELECT text FROM pipeline_messages WHERE recipe_id = ? ORDER BY id LIMIT 1').get(d.id) as { text: string } | undefined
      expect(first?.text ?? '').toMatch(/Inspirations[\s\S]*Le Monde en POV[\s\S]*Consignes : Pas de musique triste/)
    } finally {
      core.close()
    }
  })

  it('mix two channels: the content of one, the editing of the other', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ path: 'mix', inspirations: [{ axis: 'content', link: link('reddit') }, { axis: 'editing', link: link('markets') }], agent: false })
      expect(v.path).toBe('mix')
      expect(v.base).toBe('story-short@1')
      expect(v.inspirations.find((a) => a.axis === 'editing')?.said).toMatch(/Markets of the Past : un plan toutes les 5,5 s/)
    } finally {
      core.close()
    }
  })

  it('eyes that cannot watch never block: the channel\'s numbers and the words carry the study, said in plain French', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ links: [link('cassee')], text: 'un documentaire d’histoire sur des archives', agent: false })
      expect(v.agentNote).toMatch(/Je n’ai pas pu regarder les vidéos/)
      expect(v.insights).toHaveLength(1)
      expect(v.base).toBe('documentary@2')
      expect(JSON.stringify(v)).not.toMatch(/Gemini|HTTP 403|PERMISSION/)
    } finally {
      core.close()
    }
  })

  it('a channel Atelier Cloud answers in demonstration is never shown as read: no numbers, its own name, what to do instead', async () => {
    const { core, svc } = rig()
    try {
      const v = await svc.study({ links: [link('sansyoutube')], text: 'un documentaire sur l’histoire des marchés', agent: false })
      expect(v.insights).toEqual([])
      expect(v.references[0]?.title).toBe('sansyoutube')
      expect(v.references[0]?.problem).toMatch(/colle plutôt les liens de 2 ou 3 de ses vidéos/)
      expect(JSON.stringify(v)).not.toMatch(/Chaîne de démonstration|12 345|conflict/)
      // a link alone is never a dead end: the channel's name carries the study (« reddit » in a name is a story channel)
      const alone = await svc.study({ links: ['https://www.youtube.com/@sansyoutube-reddit'], agent: false })
      expect(alone.agentNote).toMatch(/d’après le nom de la chaîne/)
      expect(alone.base).toBe('story-short@1')
    } finally {
      core.close()
    }
  })

  it('rework one of my pipelines: proposals on it, adopted as a new version of the same pipeline', async () => {
    const { core, svc, recipes } = rig()
    try {
      const r = await core.api['recipes.fromBase']('documentary@2', 'Mon docu')
      const v = await svc.study({ path: 'rework', recipeId: r.id, instructions: 'un style plus ancien', agent: false })
      expect(v.rework).toEqual({ id: r.id, name: 'Mon docu' })
      expect(v.variants).toHaveLength(1)
      await expect(svc.adopt(v.id, 'faithful')).rejects.toThrow(/Coche/)
      await svc.pick(v.id, ['maps-parchment'])
      const d = await svc.adopt(v.id, 'faithful')
      expect(d.id).toBe(r.id)
      expect((recipes.doc(r.id).doc.options as { docMapLook?: string }).docMapLook).toBe('parchment')
      await expect(svc.study({ path: 'rework', agent: false })).rejects.toThrow(/pipeline à retravailler/)
    } finally {
      core.close()
    }
  })

  it('the agent asks its own question and matches proposals to the owner\'s words; unknown ids and internal names never pass', async () => {
    const reply = '```atelier-style\n{"summary": "La pipeline documentary@2 suit les archives.", "script": "Personne ne s’attendait à ça. Voici comment une petite ville a tenu tête à un empire pendant dix ans.", "base": "documentary@2", "ask": "Tu veux un look plus ancien ?", "suggested": ["maps-parchment", "clips-everywhere"]}\n```'
    const { core, svc, prompts } = rig({ reply })
    try {
      const v = await svc.study({ links: [link('markets')], text: 'plus ancien, comme un vieil atlas' })
      expect(v.summary).toBe('La pipeline Documentaire suit les archives.')
      expect(v.ask).toBe('Tu veux un look plus ancien ?')
      // documentary-2: archive references get documentary@2, whose old-atlas proposal is its parchment maps
      expect(v.differentiators.find((d) => d.id === 'maps-parchment')?.recommended).toBe(true)
      expect(prompts[0]).toMatch(/maps-parchment — Des cartes en parchemin/)
      expect(prompts[0]).toMatch(/channel numbers: Cette chaîne marche/)
      expect(parseStyleBlock('```atelier-style\n{"suggested": [1, "x"]}\n```').suggested).toEqual(['x'])
    } finally {
      core.close()
    }
  })
})
