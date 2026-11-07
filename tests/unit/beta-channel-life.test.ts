// The beta: a channel's life. Archiving pauses its agents in the runtime and hides it (nothing is deleted, videos stay
// readable); restoring resumes exactly the agents the archive paused. « Traduire une chaîne » makes a new channel in its
// language that keeps the source as its reference, copies the source's style sheet and style profile, and gets a library
// pipeline whose script is written in the source language then translated (`script.translate@1`), every later node reading
// the translation.
import { describe, expect, it } from 'vitest'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import { simpleVideoPipeline } from '../../src/engine/pipelines/simple-video'
import { withTranslation } from '../../src/main/channels/life'
import { CHANNEL_LIFE_METHODS } from '../../src/shared/api'
import { buildStyleProfile } from '../../src/shared/style-profile'
import { fixtureVideos } from './fixtures/eyes-analyses'
import { memoryCore } from './helpers'

const PROFILE = buildStyleProfile(fixtureVideos(), { now: '2026-10-25T10:00:00.000Z', thumbnail: { traits: ['fond jaune'], face: true, layout: 'band' } })!

describe('channel life IPC', () => {
  it('lists its methods', () => {
    expect([...CHANNEL_LIFE_METHODS]).toEqual([
      'channelLife.archive', // hides the channel, pauses its running agents
      'channelLife.restore', // shows it again, resumes the agents the archive paused
      'channelLife.meta', // language and translation source per channel
      'channelLife.findTranslation', // a live translation of a channel in a language
      'channelLife.translate' // the translated channel, its pipeline and copied style
    ])
  })

  it('archive pauses the channel’s agents and keeps its videos; restore resumes only those', async () => {
    const core = memoryCore()
    try {
      const api = core.api
      const ch = await api['channels.create']({ name: 'Mystères', niche: 'mystères' })
      const other = await api['channels.create']({ name: 'Autre', niche: 'autre' })
      const video = await api['videos.create'](ch.id, { title: 'Une vidéo', brief: 'sujet' })
      await api['orchestra.seed']()
      const team = (await api['orchestra.agents']()).filter((a) => a.channelId === ch.id)
      expect(team.length).toBeGreaterThan(1)
      // the owner paused one of them herself: archiving and restoring leave it paused
      const mine = team[1]!
      await api['orchestra.updateAgent'](mine.id, { paused: true })

      const archived = await api['channelLife.archive'](ch.id)
      expect(archived.channel.archived).toBe(true)
      expect(archived.agentsPaused).toBe(team.length - 1)
      expect((await api['channels.list']()).map((c) => c.id)).toEqual([other.id])
      expect((await api['channels.list'](true)).map((c) => c.id).sort()).toEqual([ch.id, other.id].sort())
      expect((await api['orchestra.agents']()).filter((a) => a.channelId === ch.id).every((a) => a.paused)).toBe(true)
      // the other channel's team is untouched, the video is still there
      expect((await api['orchestra.agents']()).filter((a) => a.channelId === other.id).some((a) => !a.paused)).toBe(true)
      expect((await api['videos.get'](video.video.id)).video.title).toBe('Une vidéo')
      // the runtime does not seed a new team for an archived channel
      await api['orchestra.seed']()
      expect((await api['orchestra.agents']()).filter((a) => a.channelId === ch.id).length).toBe(team.length)

      const restored = await api['channelLife.restore'](ch.id)
      expect(restored.channel.archived).toBe(false)
      expect(restored.agentsResumed).toBe(team.length - 1)
      const after = (await api['orchestra.agents']()).filter((a) => a.channelId === ch.id)
      expect(after.find((a) => a.id === mine.id)?.paused).toBe(true)
      expect(after.filter((a) => a.id !== mine.id).every((a) => !a.paused)).toBe(true)
      await expect(async () => api['channelLife.archive'](9999)).rejects.toThrow('Chaîne inconnue')
    } finally {
      core.close()
    }
  })

  it('translate: a new channel in its language, the source as reference, copied style, a translated pipeline', async () => {
    const core = memoryCore({ loadExample: true })
    try {
      const api = core.api
      const { channelIds } = await api['example.status']()
      const sourceId = channelIds[0] as number
      const source = await api['channels.get'](sourceId)
      await api['eyes.save'](sourceId, PROFILE, 'profil de départ')
      const sheet = (await api['styles.get'](sourceId)).current
      expect(sheet).not.toBeNull()

      expect(await api['channelLife.findTranslation'](sourceId, 'en')).toBeNull()
      const res = await api['channelLife.translate']({ sourceId, language: 'en' })
      expect(res.channel.name).toBe(`${source.name} (EN)`)
      expect(res.channel.niche).toBe(source.niche)
      expect(res.meta).toEqual({ channelId: res.channel.id, language: 'en', translatedFrom: sourceId, translatedFromName: source.name })
      expect(res.copied).toEqual({ styleSheet: true, styleProfile: true })
      expect((await api['styles.get'](res.channel.id)).current).toEqual(sheet)
      expect((await api['eyes.get'](res.channel.id)).current).toEqual(PROFILE)

      // the pipeline is the new channel's default; its script is written in French then translated into English
      expect(res.pipeline.channelId).toBe(res.channel.id)
      expect((await api['styles.get'](res.channel.id)).defaultPipelineId).toBe(res.pipeline.id)
      const doc = JSON.parse((await api['pipelines.get'](res.pipeline.id)).json) as Pipeline
      const byType = (t: string) => doc.nodes.filter((n) => n.type === t)
      const write = byType('script.write@1')[0]!
      const translate = byType('script.translate@1')[0]!
      expect(write.params?.language).toBe('fr')
      expect(translate.in).toEqual({ script: `${write.id}.text`, outline: `${write.id}.outline` })
      expect(translate.params?.language).toBe('en')
      expect(byType('voice.tts@1')[0]?.in?.script).toBe(`${translate.id}.text`)
      expect(byType('voice.tts@1')[0]?.params?.language).toBe('en')
      // nothing but the translation reads the original script any more
      const readers = doc.nodes.filter((n) => n.id !== translate.id && Object.values(n.in ?? {}).some((r) => r === `${write.id}.text` || r === `${write.id}.outline`))
      expect(readers).toEqual([])
      expect((await api['pipelines.check'](JSON.stringify(doc))).ok).toBe(true)

      // the language and the reference are kept; a second translation into English is refused, Spanish is fine
      const meta = await api['channelLife.meta']()
      expect(meta.find((m) => m.channelId === res.channel.id)?.translatedFrom).toBe(sourceId)
      expect(meta.find((m) => m.channelId === sourceId)?.language).toBe('fr')
      expect(await api['channelLife.findTranslation'](sourceId, 'en')).toBe(res.channel.id)
      await expect(async () => api['channelLife.translate']({ sourceId, language: 'en' })).rejects.toThrow('existe déjà')
      await expect(async () => api['channelLife.translate']({ sourceId, language: 'fr' })).rejects.toThrow('autre langue')
      await expect(async () => api['channelLife.translate']({ sourceId, language: 'xx' as never })).rejects.toThrow('langue')
      const es = await api['channelLife.translate']({ sourceId, language: 'es', name: 'Misterios' })
      expect(es.channel.name).toBe('Misterios')
      // the new channels have their team in the runtime
      const agents = await api['orchestra.agents']()
      expect(agents.some((a) => a.channelId === es.channel.id && a.role === 'channel_lead')).toBe(true)
      // once archived, the English copy no longer counts: it can be made again
      await api['channelLife.archive'](res.channel.id)
      expect(await api['channelLife.findTranslation'](sourceId, 'en')).toBeNull()
      // the reserved settings cannot be written from the renderer
      await expect(async () => api['settings.set'](`channelLife.meta.${es.channel.id}`, {})).rejects.toThrow('cannot be changed')
    } finally {
      core.close()
    }
  })

  it('withTranslation retargets a pipeline that already translates, and refuses one without a script', () => {
    const once = withTranslation(simpleVideoPipeline(8), 'fr', 'en')
    const twice = withTranslation(once, 'fr', 'de')
    expect(twice.nodes.filter((n) => n.type === 'script.translate@1')).toHaveLength(1)
    expect(twice.nodes.find((n) => n.type === 'script.translate@1')?.params?.language).toBe('de')
    expect(twice.nodes.find((n) => n.type === 'voice.tts@1')?.params?.language).toBe('de')
    const noScript: Pipeline = { ...simpleVideoPipeline(8), nodes: simpleVideoPipeline(8).nodes.filter((n) => n.type !== 'script.write@1') }
    expect(() => withTranslation(noScript, 'fr', 'en')).toThrow('rien à traduire')
  })
})
