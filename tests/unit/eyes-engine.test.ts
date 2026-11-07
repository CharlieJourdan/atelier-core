// The engine side of « les yeux »: the new optional params of script.write (style guidance), director.plan (shot types) and
// research.topic (competitors' outliers as inspiration). Absent, they change nothing: no extra key in the parsed params (so no
// new fingerprint) and no extra line in any prompt.
import { afterAll, describe, expect, it } from 'vitest'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import { researchTopic } from '../../src/engine/nodes/research-topic'
import { scriptWrite } from '../../src/engine/nodes/script-write'
import { outlinePrompt, outlineSystem, Params as ScriptParams, styleGuide, writerSystem } from '../../src/engine/nodes/script-prompts'
import { thumbnailMake } from '../../src/engine/nodes/thumbnail-make'
import { captionsMake } from '../../src/engine/nodes/captions-make'
import type { ClaudeService } from '../../src/engine/services'
import { profileToRunParams, buildStyleProfile } from '../../src/shared/style-profile'
import { fixtureVideos } from './fixtures/eyes-analyses'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'
import { makeFilm } from './film-fixture'

const tmp = tempDir('eyes-engine')
afterAll(() => tmp.cleanup())

const STYLE = { tone: 'fast-paced and direct', structure: ['hook', 'body', 'outro'], hookPattern: 'question', hookExample: 'Pourquoi ce phare a-t-il disparu ?', hookSeconds: 14 }
const outlineOf = (p: unknown) => outlinePrompt({ brief: 'Un brief.', words: 150, minutes: 1, p: p as never, notes: [] })

describe('script.write: the channel’s style as writing guidance', () => {
  it('without a style, nothing changes: no `style` key in the parsed params, no extra line in any prompt', () => {
    const p = scriptWrite.params.parse({})
    expect('style' in (p as object)).toBe(false)
    const plain = ScriptParams.parse({})
    expect(writerSystem('fr', 'SKILLS')).toBe(writerSystem('fr', 'SKILLS', undefined))
    expect(writerSystem('fr', 'SKILLS')).not.toContain('Voice of this channel')
    expect(outlineOf(plain)).not.toContain('Hook pattern of this channel')
    expect(outlineOf(plain)).not.toContain('Shape of this channel')
    expect(styleGuide(undefined, 'writer')).toEqual([])
    expect(styleGuide(undefined, 'outline')).toEqual([])
    expect(outlineSystem('fr')).not.toContain('channel')
  })

  it('with a style, the writer is told the voice and the outline the order of the parts and the hook pattern', () => {
    const p = ScriptParams.parse({ style: STYLE })
    expect(writerSystem('fr', 'SKILLS', p.style)).toContain('Voice of this channel (match it): fast-paced and direct.')
    const outline = outlineOf(p)
    expect(outline).toContain('Shape of this channel\'s videos, as the order of their parts: hook > body > outro.')
    expect(outline).toContain('Hook pattern of this channel: question, lasting about 14 seconds.')
    expect(outline).toContain('copy the pattern, never the words): "Pourquoi ce phare a-t-il disparu ?"')
    // the guidance sits before the answer format, and the brief is still last
    expect(outline.indexOf('Hook pattern')).toBeLessThan(outline.indexOf('Answer with ONE JSON value'))
    expect(outline.indexOf('Brief:')).toBeGreaterThan(outline.indexOf('Answer with ONE JSON value'))
  })

  it('leaves out what the style does not say', () => {
    const empty = ScriptParams.parse({ style: {} })
    expect(styleGuide(empty.style, 'writer')).toEqual([])
    expect(styleGuide(empty.style, 'outline')).toEqual([])
    const patternOnly = ScriptParams.parse({ style: { hookPattern: 'story' } })
    expect(styleGuide(patternOnly.style, 'outline')).toHaveLength(1)
    expect(styleGuide(patternOnly.style, 'outline')[0]).not.toContain('lasting')
  })

  it('refuses a style that is too long or malformed', () => {
    expect(ScriptParams.safeParse({ style: { tone: 'x'.repeat(301) } }).success).toBe(false)
    expect(ScriptParams.safeParse({ style: { structure: [1] } }).success).toBe(false)
  })

  it('a profile’s run params are accepted by every node they target', () => {
    const profile = buildStyleProfile(fixtureVideos(), { now: '2026-10-25T10:00:00.000Z', thumbnail: { traits: ['fond jaune'], face: true, layout: 'band' } })!
    const n = profileToRunParams(profile).nodes
    expect(scriptWrite.params.safeParse(n['script.write@1']).success).toBe(true)
    expect(directorPlan.params.safeParse(n['director.plan@1']).success).toBe(true)
    expect(captionsMake.params.safeParse(n['captions.make@1']).success).toBe(true)
    expect(thumbnailMake.params.safeParse(n['thumbnail.make@1']).success).toBe(true)
    // and a hostile one is not
    expect(captionsMake.params.safeParse({ preset: 'neon' }).success).toBe(false)
  })
})

describe('research.topic: the competitors’ outliers as inspiration', () => {
  const claudeOf = (): { claude: ClaudeService; prompts: string[] } => {
    const prompts: string[] = []
    return {
      prompts,
      claude: {
        ask: async (req) => {
          prompts.push(req.prompt)
          const brief = await researchTopic.fake(makeCtx(testServices(tmp.dir), { node: researchTopic }), { topic: art('text.input', { value: 'Un sujet' }) }, researchTopic.params.parse({}) as never)
          return { text: brief.brief?.value as string }
        }
      }
    }
  }
  const run = (params: Record<string, unknown>, claude: ClaudeService) =>
    researchTopic.run(makeCtx(testServices(tmp.dir, { claude }), { node: researchTopic, minutes: 8 }), { topic: art('text.input', { value: 'Un sujet' }) }, researchTopic.params.parse(params) as never)

  it('without inspiration the parsed params have no such key and the prompt has no such block', async () => {
    expect('inspiration' in (researchTopic.params.parse({}) as object)).toBe(false)
    const { claude, prompts } = claudeOf()
    await run({}, claude)
    expect(prompts[0]).not.toContain('did far better')
  })

  it('with inspiration the prompt lists each title, its channel and why, and forbids copying', async () => {
    const { claude, prompts } = claudeOf()
    await run({ inspiration: [{ title: 'Le phare disparu', channel: 'Rival A', why: '6 times the views' }, { title: 'Sans raison' }] }, claude)
    expect(prompts[0]).toContain('Videos that did far better than the rest of their channel')
    expect(prompts[0]).toContain('- "Le phare disparu" (Rival A): 6 times the views')
    expect(prompts[0]).toContain('- "Sans raison"')
    expect(prompts[0]).toContain('never copy a title')
  })

  it('refuses more than 8 items', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}` }))
    expect(researchTopic.params.safeParse({ inspiration: many }).success).toBe(false)
  })
})

describe('director.plan: the channel’s shot types', () => {
  const FILM = makeFilm(90)
  const inputs = {
    beats: art('json.beats', { value: FILM.beats as never }),
    words: art('json.words', { value: FILM.words as never, meta: { durationS: FILM.durationS, alignment: 'aligned', matched: 1, language: 'fr' } }),
    outline: art('json.outline', { value: FILM.outline as never })
  }
  const systems = async (params: Record<string, unknown>): Promise<string[]> => {
    const seen: string[] = []
    const claude: ClaudeService = {
      ask: (req) => {
        seen.push(req.system)
        const ids = [...req.prompt.matchAll(/^(\d+) · /gm)].map((m) => Number(m[1]))
        return Promise.resolve({ text: JSON.stringify({ beats: ids.map((i) => ({ beat: i, subject: `S${i}`, stockQuery: 'harbor crane', imagePrompt: `scene ${i}`, labels: [] })) }) })
      }
    }
    await directorPlan.run(makeCtx({ claude }), inputs, directorPlan.params.parse(params) as never)
    return seen
  }

  it('without shot types, nothing is added to the scene rules and the parsed params have no such key', async () => {
    expect('shotTypes' in (directorPlan.params.parse({}) as object)).toBe(false)
    const s = await systems({})
    expect(s.length).toBeGreaterThan(0)
    expect(s.every((x) => !x.includes('known for these kinds of shots'))).toBe(true)
  })

  it('with shot types the scene rules name them', async () => {
    const s = await systems({ shotTypes: ['stock footage', 'animation'] })
    expect(s.every((x) => x.includes('known for these kinds of shots: stock footage, animation'))).toBe(true)
  })
})
