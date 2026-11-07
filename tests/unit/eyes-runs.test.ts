// A channel's style profile and its competitors' outliers become the run's style and params when the run starts (lot "eyes"):
// script tone/structure/hook, director pace/mix/shots, captions preset, thumbnail traits, research inspiration. A run for a
// channel without a profile is byte for byte what it was before. Small nodes with permissive params record what they receive.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineNode, NodeRegistry, type ArtefactType } from '../../src/engine'
import type { NodeHost } from '../../src/engine/host'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import { applyRunContext, NO_CONTEXT, styleWithProfile } from '../../src/main/production/runs/profile'
import type { RunDetail } from '../../src/shared/api'
import { buildStyleProfile, profileToRunParams } from '../../src/shared/style-profile'
import { fixtureVideos } from './fixtures/eyes-analyses'
import { memoryCore } from './helpers'
import { waitFor } from './z1-runs-fixtures'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

const PROFILE = buildStyleProfile(fixtureVideos(), { now: '2026-10-25T10:00:00.000Z', thumbnail: { traits: ['fond jaune', 'visage surpris'], face: true, layout: 'band' } })!
const DEFAULT_STYLE = { language: 'fr', captions: 'highlight', burn: true }

type Seen = Record<string, Record<string, unknown>>

/** The five node types a profile touches, with permissive params; each run records the params it was given. */
function registry(seen: Seen): NodeRegistry {
  const permissive = z.object({}).passthrough()
  const node = (type: `${string}@${number}`, inputs: Record<string, { type: ArtefactType; required: boolean }>, out: [string, ArtefactType]) => {
    const run = async (_c: unknown, _i: unknown, p: Record<string, unknown>) => {
      seen[type] = p
      return { [out[0]]: out[1].startsWith('text.') ? { value: 'x' } : { value: [] } }
    }
    return defineNode<Record<string, unknown>>({
      type,
      inputs,
      outputs: { [out[0]]: out[1] },
      params: permissive,
      executors: ['local'],
      estimate: () => ({ units: [], durationS: 1 }),
      run: (c, i, p) => run(c, i, p),
      fake: (c, i, p) => run(c, i, p)
    })
  }
  return new NodeRegistry([
    node('research.topic@1', { topic: { type: 'text.input', required: true } }, ['brief', 'text.brief']),
    node('script.write@1', { brief: { type: 'text.brief', required: true } }, ['text', 'text.script']),
    node('director.plan@1', { script: { type: 'text.script', required: true } }, ['plan', 'json.editplan']),
    node('captions.make@1', { script: { type: 'text.script', required: true } }, ['subs', 'json.words']),
    node('thumbnail.make@1', { brief: { type: 'text.brief', required: true } }, ['thumbs', 'json.words'])
  ])
}

const template = (over: { directorParams?: Record<string, unknown> } = {}) =>
  (minutes: number): Pipeline => ({
    $schema: 'atelier.pipeline/1',
    id: 'profile-test',
    version: 1,
    name: 'Vidéo avec profil',
    format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: minutes, min: 0.5, max: 30 } },
    inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet' }],
    budget: { default: 'usage_max' },
    nodes: [
      { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' }, params: { language: '$style.language' } },
      { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' }, params: { language: '$style.language' } },
      { id: 'director', type: 'director.plan@1', in: { script: 'script.text' }, params: { captionsPreset: '$style.captions', ...(over.directorParams ?? {}) } },
      { id: 'captions', type: 'captions.make@1', in: { script: 'script.text' }, params: { preset: '$style.captions', burn: '$style.burn' } },
      { id: 'thumbnail', type: 'thumbnail.make@1', in: { brief: 'research.brief' } }
    ]
  })

function setup(o: { directorParams?: Record<string, unknown> } = {}) {
  const seen: Seen = {}
  // its own data folder: the artefact store is per video id, so runs of two tests would otherwise reuse each other's nodes
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'eyes-runs-'))
  const core = memoryCore({
    productionRuns: {
      dataDir,
      registry: registry(seen),
      pipeline: template(o),
      defaultStyle: DEFAULT_STYLE,
      host: (): NodeHost => ({ services: {}, cleanup: () => Promise.resolve() }),
      notifyEveryMs: 0,
      demo: true
    }
  })
  cleanups.push(
    () => core.close(),
    () => rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  )
  return { core, seen }
}

const startInput = (channelId: number, over: Record<string, unknown> = {}) => ({ channelId, title: 'Ma vidéo', topic: 'Le phare', minutes: 1, budgetMode: 'usage_max' as const, gateMode: 'all' as const, ...over })
const finished = (core: ReturnType<typeof memoryCore>, id: number): Promise<RunDetail> =>
  waitFor(async () => {
    const r = await core.api['production.get'](id)
    return r.status === 'succeeded' || r.status === 'failed' ? r : null
  }, 8000, `run ${id}`)
const stored = (core: ReturnType<typeof memoryCore>, id: number) => {
  const row = core.db.prepare('SELECT pipeline_json, style_json FROM video_runs WHERE id = ?').get(id) as { pipeline_json: string; style_json: string }
  return { doc: JSON.parse(row.pipeline_json) as Pipeline, style: JSON.parse(row.style_json) as Record<string, unknown>, raw: row }
}
const paramsOf = (doc: Pipeline, id: string): Record<string, unknown> => doc.nodes.find((n) => n.id === id)?.params ?? {}

describe('applying a context to a pipeline (pure)', () => {
  const doc = template()(1)

  it('without a profile and without inspiration the very same document comes back', () => {
    expect(applyRunContext(doc, NO_CONTEXT)).toBe(doc)
    expect(styleWithProfile(DEFAULT_STYLE, NO_CONTEXT)).toBe(DEFAULT_STYLE)
  })

  it('the channel’s own script words reach the script writer, with or without a style profile, and never override the pipeline (#107)', () => {
    const withoutProfile = applyRunContext(doc, { profile: null, inspiration: [], channelStyle: 'Script style: tutoiement' })
    expect(paramsOf(withoutProfile, 'script')).toMatchObject({ channelStyle: 'Script style: tutoiement' })
    const both = applyRunContext(doc, { profile: PROFILE, inspiration: [], channelStyle: 'Script style: tutoiement' })
    expect(paramsOf(both, 'script')).toMatchObject({ channelStyle: 'Script style: tutoiement', style: profileToRunParams(PROFILE).nodes['script.write@1'].style })
    expect(paramsOf(withoutProfile, 'director')).toEqual(paramsOf(doc, 'director'))
  })

  it('fills the params the pipeline left open on each type of node, and none other', () => {
    const out = applyRunContext(doc, { profile: PROFILE, inspiration: [] })
    const p = profileToRunParams(PROFILE).nodes
    expect(paramsOf(out, 'script')).toEqual({ language: '$style.language', style: p['script.write@1'].style, ctaMode: 'end' })
    expect(paramsOf(out, 'director')).toMatchObject({ captionsPreset: '$style.captions', cpm: 16, mix: { stock: 0.58, image: 0.42 }, videoShare: 0, minShotS: 1.25, maxShotS: 7.5 })
    expect(paramsOf(out, 'captions')).toEqual({ preset: '$style.captions', burn: '$style.burn', position: 'bottom' })
    expect(paramsOf(out, 'thumbnail')).toEqual({ withFace: true, layout: 'band', style: 'fond jaune, visage surpris' })
    expect(paramsOf(out, 'research')).toEqual({ language: '$style.language' })
    // the original document is untouched
    expect(paramsOf(doc, 'director')).toEqual({ captionsPreset: '$style.captions' })
  })

  it('never overwrites what the pipeline set itself', () => {
    const own = template({ directorParams: { cpm: 9, mix: { stock: 1, image: 0 } } })(1)
    const out = applyRunContext(own, { profile: PROFILE, inspiration: [] })
    expect(paramsOf(out, 'director')).toMatchObject({ cpm: 9, mix: { stock: 1, image: 0 }, minShotS: 1.25 })
  })

  it('adds the competitors’ outliers to the research node (at most 8)', () => {
    const inspiration = Array.from({ length: 10 }, (_, i) => ({ title: `Titre ${i}`, why: 'x', channel: 'Rival' }))
    const out = applyRunContext(doc, { profile: null, inspiration })
    expect((paramsOf(out, 'research').inspiration as unknown[]).length).toBe(8)
    expect(paramsOf(out, 'script')).toEqual({ language: '$style.language' })
  })

  it('the profile’s captions preset goes under the owner’s overrides and over the defaults', () => {
    expect(styleWithProfile(DEFAULT_STYLE, { profile: PROFILE, inspiration: [] })).toEqual({ ...DEFAULT_STYLE, captions: 'classic' })
  })
})

describe('a run starts from the channel’s profile', () => {
  async function withChannel() {
    const s = setup()
    const channel = await s.core.api['channels.create']({ name: 'Histoire' })
    return { ...s, channelId: channel.id }
  }

  it('without a profile: the stored pipeline and style are exactly the template and the defaults, and the nodes see no extra param', async () => {
    const { core, seen, channelId } = await withChannel()
    const run = await core.api['production.start'](startInput(channelId))
    expect((await finished(core, run.id)).status).toBe('succeeded')
    const { doc, style } = stored(core, run.id)
    expect(doc).toEqual(template()(1))
    expect(style).toEqual(DEFAULT_STYLE)
    expect(seen['script.write@1']).toEqual({ language: 'fr' })
    expect(seen['director.plan@1']).toEqual({ captionsPreset: 'highlight' })
    expect(seen['captions.make@1']).toEqual({ preset: 'highlight', burn: true })
    expect(seen['research.topic@1']).toEqual({ language: 'fr' })
  })

  it('with a profile: the nodes receive the style, the pace, the mix, the captions and the thumbnail traits', async () => {
    const { core, seen, channelId } = await withChannel()
    core.context.eyes.store.saveProfile(channelId, PROFILE, 'test', 'built')
    const run = await core.api['production.start'](startInput(channelId))
    expect((await finished(core, run.id)).status).toBe('succeeded')
    const { style } = stored(core, run.id)
    expect(style).toEqual({ ...DEFAULT_STYLE, captions: 'classic' })
    expect(seen['script.write@1']).toMatchObject({
      language: 'fr',
      ctaMode: 'end',
      style: { tone: PROFILE.script.tone, structure: ['hook', 'body', 'outro'], hookPattern: 'question', hookSeconds: 14 }
    })
    expect(seen['director.plan@1']).toMatchObject({ captionsPreset: 'classic', cpm: 16, mix: { stock: 0.58, image: 0.42 }, shotTypes: PROFILE.shotTypes })
    expect(seen['captions.make@1']).toMatchObject({ preset: 'classic', position: 'bottom', burn: true })
    expect(seen['thumbnail.make@1']).toMatchObject({ withFace: true, layout: 'band', style: 'fond jaune, visage surpris' })
  })

  it('the owner’s own style override beats the profile', async () => {
    const { core, seen, channelId } = await withChannel()
    core.context.eyes.store.saveProfile(channelId, PROFILE, 'test', 'built')
    const run = await core.api['production.start'](startInput(channelId, { style: { captions: 'pill' } }))
    await finished(core, run.id)
    expect(stored(core, run.id).style.captions).toBe('pill')
    expect(seen['captions.make@1']).toMatchObject({ preset: 'pill' })
  })

  it('another channel’s profile does not apply', async () => {
    const { core, seen, channelId } = await withChannel()
    const other = await core.api['channels.create']({ name: 'Autre' })
    core.context.eyes.store.saveProfile(other.id, PROFILE, 'test', 'built')
    const run = await core.api['production.start'](startInput(channelId))
    await finished(core, run.id)
    expect(stored(core, run.id).doc).toEqual(template()(1))
    expect(seen['script.write@1']).toEqual({ language: 'fr' })
  })

  it('a video of the channel (videoId) is enough to find the profile; "Refaire pareil" keeps what the first run used', async () => {
    const { core, seen, channelId } = await withChannel()
    core.context.eyes.store.saveProfile(channelId, PROFILE, 'test', 'built')
    const first = await core.api['production.start'](startInput(channelId))
    await finished(core, first.id)
    const second = await core.api['production.start']({ videoId: first.videoId, topic: 'Un autre sujet', minutes: 1, budgetMode: 'usage_max', gateMode: 'all' })
    await finished(core, second.id)
    expect(paramsOf(stored(core, second.id).doc, 'director')).toMatchObject({ cpm: 16 })
    // the profile changes after: a redo of the first run still runs with the first one
    const edited = { ...PROFILE, pace: { ...PROFILE.pace, cutsPerMinute: 30 } }
    core.context.eyes.store.saveProfile(channelId, edited, 'plus vite', 'edited')
    const redo = await core.api['production.redo'](first.id)
    await finished(core, redo.id)
    expect(paramsOf(stored(core, redo.id).doc, 'director')).toMatchObject({ cpm: 16 })
    const fresh = await core.api['production.start'](startInput(channelId))
    await finished(core, fresh.id)
    expect(paramsOf(stored(core, fresh.id).doc, 'director')).toMatchObject({ cpm: 30 })
    expect(seen['director.plan@1']).toMatchObject({ cpm: 30 })
  })

  it('a quote for the channel is made with the same profile', async () => {
    const { core, channelId } = await withChannel()
    core.context.eyes.store.saveProfile(channelId, PROFILE, 'test', 'built')
    const q = await core.api['production.quote']({ minutes: 1, topic: 'Le phare', channelId })
    expect(q.modes.usage_max.nodes.map((n) => n.nodeId)).toEqual(['research', 'script', 'director', 'captions', 'thumbnail'])
    await expect(core.api['production.quote']({ minutes: 1, channelId: -3 })).rejects.toThrow()
  })

  it('the competitors’ outliers reach the research node of a run', async () => {
    const { core, seen, channelId } = await withChannel()
    const store = core.context.eyes.store
    const rivalId = store.addCompetitor(channelId, 'https://www.youtube.com/@rival')
    store.setCompetitorName(rivalId, 'Rival')
    const NOW = Date.now()
    const videos = Array.from({ length: 20 }, (_, i) => ({
      id: `rv${String(i).padStart(2, '0')}`,
      title: `Rival titre ${i}`,
      views: i === 4 ? 600_000 : Math.round(100_000 * (1 - Math.exp(-(7 * (i + 1)) / 30))),
      likes: null,
      comments: null,
      durationS: 600,
      publishedAt: new Date(NOW - 7 * (i + 1) * 86_400_000).toISOString(),
      thumbnailUrl: null
    }))
    store.saveRead({ channelId, sourceKey: rivalId, url: 'https://www.youtube.com/@rival', title: 'Rival', subscribers: 1000, videos, quotaUnits: 3, demo: true, readAt: new Date(NOW).toISOString() })
    const run = await core.api['production.start'](startInput(channelId))
    await finished(core, run.id)
    const inspiration = seen['research.topic@1']?.inspiration as { title: string; channel: string; why: string }[]
    expect(inspiration).toHaveLength(1)
    expect(inspiration[0]).toMatchObject({ title: 'Rival titre 4', channel: 'Rival' })
    expect(inspiration[0]?.why).toMatch(/the views of the channel's videos of the same age/)
    // a profile is not needed for that, and the script is left as before
    expect(seen['script.write@1']).toEqual({ language: 'fr' })
  })
})
