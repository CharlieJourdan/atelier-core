// essais-utilisateur: twelve links a new user might paste were all « reproduced » at 65–80 / 100 (a studio cartoon, a 3D city
// timelapse, a podcast, a vlog, a music teaser). The feasibility says early which parts Atelier makes, the share, the people and
// technologies needed and what instead; the agent's words pass only with known ids and the verdict follows the share. The public
// pages read with yt-dlp give the real title, the length, the channel and a channel's videos when the Cloud cannot read it.
import { describe, expect, it } from 'vitest'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { channelRoot, parseTab, parseVideo, tabArgs, videoArgs, youtubeMeta } from '../../src/main/eyes/youtube-meta'
import { assessFeasibility, HUMANS, INSTEAD, mergeAgentFeasibility, MISSING, traitsOf } from '../../src/main/production/style-agent/feasibility'

const m = (o: Partial<VideoMeasure>): VideoMeasure => ({ minutes: 20, presenterShare: 0, layouts: [], kinds: {}, shotS: 5, lookFamily: 'photoreal', captions: false, labelsPerMinute: 1, wordsPerMinute: 140, curve: null, offerAtS: null, ...o }) as VideoMeasure
const judge = (measures: VideoMeasure[], words: string, unread: string | null = null) => assessFeasibility([{ measures, words }], unread)

describe('feasibility: what the code reads', () => {
  it('an archive documentary with data cards is reproducible', () => {
    const f = judge([m({ kinds: { archive: 0.4, motion: 0.5, stock: 0.1 }, lookFamily: 'archive' })], 'Mais pourquoi l’économie nazie était-elle si mauvaise ? archive footage, line charts')
    expect(f?.verdict).toBe('yes')
    expect(f?.share).toBeGreaterThanOrEqual(90)
    expect(f?.humans.map((h) => h.id)).toEqual(['editor-review'])
  })

  it('a filmed podcast is not reproducible: guests recorded, rushes edited, Atelier re-voices or edits instead', () => {
    const f = judge([m({ presenterShare: 0.6, layouts: ['split', 'full'], lookFamily: 'photoreal' })], 'Cette IA vous coupe la parole. Le plus grand spécialiste nous explique tout. podcast interview')
    expect(f?.verdict).toBe('partial')
    expect(f?.parts[0]?.can).toBe('no')
    expect(f?.humans.map((h) => h.id)).toContain('guests')
    expect(f?.missing.map((x) => x.id)).toContain('rush-editing')
    expect(f?.instead.map((x) => x.id)).toEqual(expect.arrayContaining(['own-footage', 'revoice']))
  })

  it('a vlog shot handheld needs the owner’s footage', () => {
    const t = traitsOf({ measures: [m({ presenterShare: 0.75, camera: 'handheld' })], words: 'UNI VLOG | Ma vie d’étudiant à Séoul' })
    expect(t.vlog).toBe(true)
    expect(judge([m({ presenterShare: 0.75, camera: 'handheld' })], 'UNI VLOG')?.humans.map((h) => h.id)).toContain('vlog-filming')
  })

  it('a music teaser made by a crew is not reproducible, even when the eyes call it AI clips', () => {
    const f = judge([m({ kinds: { clipAi: 0.5, motion: 0.5 }, lookFamily: 'illustrated' })], '3ème Mouvement (le 13 Novembre)\nMusic\nvinyle + tee en préco, réalisé par X, dop : Y, VFX : Z, LEAD 2D')
    expect(f?.verdict).toBe('no')
    expect(f?.missing.map((x) => x.id)).toEqual(expect.arrayContaining(['live-action', 'original-music']))
    expect(f?.humans.map((h) => h.id)).toEqual(expect.arrayContaining(['animator', 'musician']))
  })

  it('a studio cartoon is out of reach; simple drawings are approached', () => {
    const studio = judge([m({ kinds: { motion: 1 }, lookFamily: 'illustrated', shotS: 1.3 })], 'MrBeast Lab | Official Trailer. A high-energy animated commercial for the toy line, monsters')
    expect(studio?.verdict).toBe('no')
    expect(studio?.missing.map((x) => x.id)).toContain('character-animation')
    const simple = judge([m({ kinds: { motion: 1 }, lookFamily: 'illustrated' })], 'How Steve Jobs Actually Built Apple. A simple, hand-drawn animation style with characters')
    expect(simple?.verdict).toBe('partial')
    expect(simple?.missing.map((x) => x.id)).toEqual(['consistent-characters'])
  })

  it('3D: a city timelapse is approached, game cinematics are not, and what was not watched is said', () => {
    const city = judge([m({ kinds: { motion: 1 }, lookFamily: '3d', shotS: 43 })], 'EVOLUTION OF PARIS | 3D CITY TIMELAPSE', 'J’ai regardé 5 premières minutes sur 10')
    expect(city?.verdict).toBe('partial')
    expect(city?.missing.map((x) => x.id)).toEqual(['3d-scenes', 'whole-video-eyes'])
    expect(city?.unread).toMatch(/5 premières minutes/)
    const game = judge([m({ kinds: { clipAi: 1 }, lookFamily: '3d' })], 'When Ha-Go Tanks Ambushed M3 Stuarts. Brass Rain, wishlist our free-to-play game on Steam, 3D characters')
    expect(game?.missing.map((x) => x.id)).toContain('3d-characters')
  })

  it('a recap of an animated series: the extracts are the owner’s to import, the presenter filmed', () => {
    const f = judge([m({ presenterShare: 0.35, kinds: { clipAi: 1 }, lookFamily: 'illustrated' })], 'L’histoire COMPLÈTE des Grandes Grandes Vacances : un dessin animé sur l’occupation')
    expect(f?.verdict).not.toBe('yes')
    expect(f?.missing.map((x) => x.id)).toContain('licensed-footage')
    expect(f?.humans.map((h) => h.id)).toEqual(expect.arrayContaining(['presenter-filmed', 'footage-owner']))
  })

  it('nothing read: no judgement', () => {
    expect(assessFeasibility([{ measures: [], words: '' }])).toBeNull()
  })
})

describe('feasibility: the agent’s words, checked', () => {
  const code = judge([m({ kinds: { archive: 0.5, motion: 0.5 }, lookFamily: 'archive' })], 'archive documentary')
  it('takes its share, why and parts; unknown ids never pass; the verdict follows the share', () => {
    const f = mergeAgentFeasibility(code, { share: 23, why: 'Une animation de studio.', parts: [{ title: 'Les personnages', share: 70, can: 'no', how: 'studio' }, { title: 'x', can: 'maybe' }], missing: ['character-animation', 'teleport'], humans: ['animator'], instead: ['nearest'] })
    expect(f?.source).toBe('agent')
    expect(f?.verdict).toBe('no')
    expect(f?.share).toBe(25)
    expect(f?.parts).toHaveLength(1)
    expect(f?.missing.map((x) => x.id)).toEqual(['character-animation'])
    expect(f?.instead.map((x) => x.id)).toEqual(['nearest', 'revoice'])
  })
  it('keeps the code’s judgement when the agent gives no share or no why, and the code’s lists when its own are empty', () => {
    expect(mergeAgentFeasibility(code, { why: 'x' })).toBe(code)
    expect(mergeAgentFeasibility(code, null)).toBe(code)
    const f = mergeAgentFeasibility(code, { share: 90, why: 'Archives et cartes.', missing: [] })
    expect(f?.verdict).toBe('yes')
    expect(f?.humans.map((h) => h.id)).toEqual(code?.humans.map((h) => h.id))
  })
  it('« reproductible » needs every big part made as it is; a reproducible style needs no animator', () => {
    const f = mergeAgentFeasibility(code, { share: 75, why: 'Un présentateur filmé, des cartes.', parts: [{ title: 'Le présentateur', share: 55, can: 'partial', how: 'avatar' }, { title: 'Les cartes', share: 45, can: 'yes', how: 'motion' }], humans: ['presenter-filmed', 'animator'] })
    expect(f?.verdict).toBe('partial')
    expect(f?.humans.map((h) => h.id)).toEqual(['presenter-filmed', 'animator'])
    const yes = mergeAgentFeasibility(code, { share: 85, why: 'Archives et cartes.', parts: [{ title: 'Archives', share: 60, can: 'yes', how: 'trouvées' }], humans: ['animator'] })
    expect(yes?.verdict).toBe('yes')
    expect(yes?.humans.map((h) => h.id)).toEqual(['editor-review'])
  })
  it('every list entry is said in French with its cost', () => {
    for (const x of Object.values(MISSING)) expect(x.cost.length).toBeGreaterThan(20)
    for (const x of [...Object.values(HUMANS), ...Object.values(INSTEAD)]) expect(x.title).toMatch(/[a-zé]/)
  })
})

describe('the public pages, read with yt-dlp', () => {
  const video = JSON.stringify({ id: 'FpapAhiepW4', title: '3ème Mouvement (le 13 Novembre)', uploader_url: 'https://www.youtube.com/@hjeunecrack', uploader_id: '@hjeunecrack', channel: 'H JeuneCrack', duration: 62, view_count: 14775, channel_follower_count: 28800, description: 'réalisé par @lvact', categories: ['Music'] })
  it('reads a video: title, channel page, length, words', () => {
    const v = parseVideo(video)
    expect(v).toMatchObject({ title: '3ème Mouvement (le 13 Novembre)', channelUrl: 'https://www.youtube.com/@hjeunecrack', durationS: 62, categories: ['Music'] })
    expect(parseVideo('not json')).toBeNull()
  })
  it('reads a channel tab; a Short without a length counts as one', () => {
    const tab = JSON.stringify({ channel: 'Yarnhub', title: 'Yarnhub - Shorts', channel_follower_count: 3390000, entries: [{ id: 'SAPOcPZyFCI', title: 'When the last bridge was too far', duration: null, view_count: 322000 }] })
    const r = parseTab(tab, true)
    expect(r).toMatchObject({ title: 'Yarnhub', subscribers: 3390000 })
    expect(r.videos[0]).toMatchObject({ id: 'SAPOcPZyFCI', durationS: 45, views: 322000 })
    expect(channelRoot('https://www.youtube.com/@Yarnhub/videos')).toBe('https://www.youtube.com/@Yarnhub')
  })
  it('is read-only: no login, no cookies, metadata only, the link after --', () => {
    for (const a of [videoArgs('https://youtu.be/x'), tabArgs('https://www.youtube.com/@x/videos', 12)]) {
      expect(a).toContain('--no-cookies-from-browser')
      expect(a.indexOf('--')).toBe(a.length - 2)
      expect(a.join(' ')).not.toMatch(/--cookies |--username|--password|--exec/)
    }
    expect(videoArgs('x')).toContain('--skip-download')
    expect(tabArgs('x', 99)).toContain('30')
  })
  it('answers null, never an error, when yt-dlp is missing or refused', async () => {
    const meta = youtubeMeta(async () => {
      throw new Error('spawn yt-dlp ENOENT')
    })
    const signal = new AbortController().signal
    expect(await meta.video('https://youtu.be/x', signal)).toBeNull()
    expect(await meta.channel('https://www.youtube.com/@x', 10, signal)).toBeNull()
  })
  it('a channel joins its long videos and its Shorts', async () => {
    const meta = youtubeMeta(async (_cmd, args) => {
      const url = args.at(-1) as string
      const short = url.endsWith('/shorts')
      return { stdout: JSON.stringify({ channel: 'Finary', channel_follower_count: 1000, entries: [{ id: short ? 's1' : 'v1', title: 't', duration: short ? null : 1300, view_count: 5 }] }), stderr: '' }
    })
    const c = await meta.channel('https://www.youtube.com/@Finary', 10, new AbortController().signal)
    expect(c?.videos.map((v) => [v.id, v.durationS])).toEqual([['v1', 1300], ['s1', 45]])
    expect(c?.title).toBe('Finary')
  })
})

describe('the style sample runs on the real engines when the runs can', () => {
  it('real only when the runs say the Cloud is available', async () => {
    const { realSample } = await import('../../src/main/production/style-agent/sample-runner')
    expect(realSample({ realState: () => ({ available: true, reason: '' }) })).toBe(true)
    expect(realSample({ realState: () => ({ available: false, reason: 'non relié' }) })).toBe(false)
    expect(realSample({})).toBe(false)
  })
})
