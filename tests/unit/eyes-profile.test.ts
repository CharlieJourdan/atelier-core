// The channel style profile (src/shared/style-profile.ts): built from analyses of the eyes' kind, and turned into what a run
// changes. Pure functions; the fixtures are hand-written analyses (tests/unit/fixtures/eyes-analyses.ts).
import { describe, expect, it } from 'vitest'
import { CAPTION_PRESETS } from '../../src/engine/text/captions'
import { HEADLINE_LAYOUTS } from '../../src/engine/media/headline'
import {
  buildStyleProfile,
  classifyShot,
  DEFAULT_PROFILE,
  PROFILE_CAPTION_PRESETS,
  PROFILE_THUMBNAIL_LAYOUTS,
  profileToRunParams,
  STYLE_PROFILE_ID,
  StyleProfileSchema
} from '../../src/shared/style-profile'
import { analysis, fixtureVideos, video } from './fixtures/eyes-analyses'

const NOW = '2026-10-25T10:00:00.000Z'

describe('the profile’s lists match the engine’s own', () => {
  it('caption presets and thumbnail layouts', () => {
    expect([...PROFILE_CAPTION_PRESETS]).toEqual([...CAPTION_PRESETS])
    expect([...PROFILE_THUMBNAIL_LAYOUTS]).toEqual([...HEADLINE_LAYOUTS])
  })
})

describe('which part of the mix a shot belongs to', () => {
  it('reads English and French wording', () => {
    expect(classifyShot('Stock footage')).toBe('stock')
    expect(classifyShot('b-roll')).toBe('stock')
    expect(classifyShot('images d’archives')).toBe('stock')
    expect(classifyShot('animation')).toBe('generated')
    expect(classifyShot('AI generated images')).toBe('generated')
    expect(classifyShot('graphique animé')).toBe('generated')
    expect(classifyShot('infographie')).toBe('generated')
    expect(classifyShot('talking head')).toBe('footage')
    expect(classifyShot('présentateur face caméra')).toBe('footage')
    expect(classifyShot('screen recording')).toBe('footage')
    expect(classifyShot('gameplay')).toBe('footage')
    expect(classifyShot('on-screen text')).toBeNull()
  })
})

describe('building a profile from analyses', () => {
  const profile = buildStyleProfile(fixtureVideos(), { now: NOW })

  it('is null when there is nothing to read', () => {
    expect(buildStyleProfile([], { now: NOW })).toBeNull()
  })

  it('is a valid profile and says where it comes from', () => {
    expect(StyleProfileSchema.safeParse(profile).success).toBe(true)
    expect(profile?.$schema).toBe(STYLE_PROFILE_ID)
    expect(profile?.source).toEqual({ ownVideos: 2, competitorVideos: 3, builtAt: NOW, demo: false })
  })

  it('takes the pace as a weighted median (a competitor’s outlier counts double) and the tempo as the commonest', () => {
    expect(profile?.pace).toEqual({ cutsPerMinute: 16, tempo: 'fast' })
  })

  it('shares the picture between stock, generated and original footage, and lists the shot types, commonest first', () => {
    expect(profile?.mix).toEqual({ stock: 0.5, generated: 0.36, footage: 0.14 })
    expect(profile?.shotTypes).toEqual(['stock footage', 'animation', 'b-roll', 'infographie', 'screen recording', 'talking head'])
  })

  it('picks the commonest hook, its length and the heaviest example of it', () => {
    expect(profile?.hook).toEqual({ pattern: 'question', seconds: 14, example: 'Pourquoi ce phare a-t-il disparu ?' })
  })

  it('keeps the usual order of the parts, the calls to action, the length and the music', () => {
    expect(profile?.script.structure).toEqual(['hook', 'body', 'outro'])
    expect(profile?.script.ctaPerVideo).toBe(1)
    expect(profile?.script.tone).toMatch(/fast-paced/)
    expect(profile?.length.minutes).toBe(9)
    expect(profile?.music).toEqual({ present: true, mood: 'calme' })
  })

  it('chooses plain captions when there is little on-screen text', () => {
    expect(profile?.captions.preset).toBe('classic')
    expect(profile?.captions.position).toBe('bottom')
  })

  it('chooses word-by-word captions for a lot of very short texts, and the shorts preset for a short film', () => {
    const texts = (n: number, words: string) => Array.from({ length: n }, (_, i) => ({ atS: i * 5, text: words }))
    const busy = [video(analysis({ onScreenText: texts(80, 'OUI NON') }), { durationS: 600 })]
    expect(buildStyleProfile(busy, { now: NOW })?.captions).toMatchObject({ preset: 'word-by-word', position: 'middle' })
    const wide = [video(analysis({ onScreenText: texts(80, 'une phrase assez longue pour le texte') }), { durationS: 600 })]
    expect(buildStyleProfile(wide, { now: NOW })?.captions.preset).toBe('bold-center')
    const short = [video(analysis({ onScreenText: texts(10, 'OUI') }), { durationS: 45 })]
    expect(buildStyleProfile(short, { now: NOW })?.captions).toMatchObject({ preset: 'shorts', position: 'middle' })
    const mid = [video(analysis({ onScreenText: texts(40, 'OUI NON') }), { durationS: 600 })]
    expect(buildStyleProfile(mid, { now: NOW })?.captions.preset).toBe('highlight')
  })

  it('reads the length from the analysis when the channel data gave none', () => {
    const noDuration = [video(analysis(), { durationS: null })]
    expect(buildStyleProfile(noDuration, { now: NOW })?.length.minutes).toBe(10)
  })

  it('keeps the owner’s thumbnail traits (the eyes do not describe thumbnails)', () => {
    const p = buildStyleProfile(fixtureVideos(), { now: NOW, thumbnail: { traits: ['fond jaune', 'visage surpris'], face: true, layout: 'band' } })
    expect(p?.thumbnail).toEqual({ traits: ['fond jaune', 'visage surpris'], face: true, layout: 'band' })
    expect(profile?.thumbnail).toEqual(DEFAULT_PROFILE.thumbnail)
  })

  it('a profile from a demo analysis says so', () => {
    expect(buildStyleProfile([video(analysis(), { demo: true })], { now: NOW })?.source.demo).toBe(true)
  })

  it('counts an outlier double: the same videos with the flag removed give another pace', () => {
    // the same five videos: flagging the slowest one as the outlier pulls the median down
    const slowIsOutlier = fixtureVideos().map((v, i) => ({ ...v, outlier: i === 2 }))
    expect(buildStyleProfile(slowIsOutlier, { now: NOW })?.pace.cutsPerMinute).toBe(14)
    const none = fixtureVideos().map((v) => ({ ...v, outlier: false }))
    expect(buildStyleProfile(none, { now: NOW })?.pace.cutsPerMinute).toBe(16)
    expect(profile?.pace.cutsPerMinute).toBe(16)
  })
})

describe('the schema', () => {
  const profile = buildStyleProfile(fixtureVideos(), { now: NOW })!
  it('refuses unknown fields, out-of-range values and an unknown caption preset', () => {
    expect(StyleProfileSchema.safeParse({ ...profile, extra: 1 }).success).toBe(false)
    expect(StyleProfileSchema.safeParse({ ...profile, pace: { ...profile.pace, cutsPerMinute: 200 } }).success).toBe(false)
    expect(StyleProfileSchema.safeParse({ ...profile, captions: { ...profile.captions, preset: 'neon' } }).success).toBe(false)
    expect(StyleProfileSchema.safeParse({ ...profile, script: { ...profile.script, structure: ['hook', 'party'] } }).success).toBe(false)
    expect(StyleProfileSchema.safeParse(JSON.parse(JSON.stringify(profile))).success).toBe(true)
  })
})

describe('what a profile changes in a run', () => {
  const profile = buildStyleProfile(fixtureVideos(), { now: NOW })!
  const p = profileToRunParams(profile)

  it('sets the captions preset as the run’s style field', () => {
    expect(p.style).toEqual({ captions: 'classic' })
  })

  it('gives the script its tone, structure and hook pattern, and a call-to-action mode', () => {
    expect(p.nodes['script.write@1']).toEqual({
      style: { tone: profile.script.tone, structure: ['hook', 'body', 'outro'], hookPattern: 'question', hookExample: 'Pourquoi ce phare a-t-il disparu ?', hookSeconds: 14 },
      ctaMode: 'end'
    })
    const none = profileToRunParams({ ...profile, script: { ...profile.script, ctaPerVideo: 0 } })
    expect(none.nodes['script.write@1'].ctaMode).toBe('none')
    const twice = profileToRunParams({ ...profile, script: { ...profile.script, ctaPerVideo: 2 } })
    expect(twice.nodes['script.write@1'].ctaMode).toBe('mid_end')
  })

  it('gives the director cuts per minute, the stock/image mix, shot lengths and shot types', () => {
    expect(p.nodes['director.plan@1']).toEqual({
      cpm: 16,
      mix: { stock: 0.58, image: 0.42 },
      videoShare: 0,
      shotTypes: ['stock footage', 'animation', 'b-roll', 'infographie', 'screen recording', 'talking head'],
      minShotS: 1.25,
      maxShotS: 7.5
    })
  })

  it('asks for generated video only when the channel is mostly generated pictures', () => {
    const drawn = profileToRunParams({ ...profile, mix: { stock: 0.1, generated: 0.8, footage: 0.1 } })
    expect(drawn.nodes['director.plan@1'].videoShare).toBe(0.2)
  })

  it('keeps the director’s numbers inside the engine’s bounds', () => {
    const extreme = profileToRunParams({ ...profile, pace: { cutsPerMinute: 60, tempo: 'fast' } }).nodes['director.plan@1']
    expect(extreme.cpm).toBe(40)
    expect(extreme.minShotS).toBeGreaterThanOrEqual(0.8)
    const slow = profileToRunParams({ ...profile, pace: { cutsPerMinute: 1, tempo: 'slow' } }).nodes['director.plan@1']
    expect(slow.cpm).toBe(4)
    expect(slow.maxShotS).toBeLessThanOrEqual(12)
  })

  it('gives the captions their preset and position, and the thumbnails their traits', () => {
    expect(p.nodes['captions.make@1']).toEqual({ preset: 'classic', position: 'bottom' })
    const withTraits = profileToRunParams({ ...profile, thumbnail: { traits: ['fond jaune', 'visage surpris'], face: true, layout: 'band' } })
    expect(withTraits.nodes['thumbnail.make@1']).toEqual({ style: 'fond jaune, visage surpris', withFace: true, layout: 'band' })
  })
})
