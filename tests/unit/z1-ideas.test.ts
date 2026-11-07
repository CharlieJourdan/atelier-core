// Lot Z1: ideas and automations of the Production section (store, schedule, firing, IPC, example rows).
import { describe, expect, it } from 'vitest'
import { IDEAS_METHODS } from '../../src/shared/api'
import { nextRunAt } from '../../src/main/ideas/automations'
import { parseAgentIdeas } from '../../src/main/ideas/store'
import { FakeProvider } from '../../src/main/llm/fake'
import { memoryCore } from './helpers'

const AUTO = {
  name: 'Lundi',
  channelId: 1,
  cadence: 'weekly' as const,
  weekday: 1,
  hour: 9,
  topicFrom: 'ideas' as const,
  topic: '',
  minutes: 2,
  budgetMode: 'usage_max' as const,
  gateMode: 'step' as const,
  enabled: true
}

describe('ideas and automations', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...IDEAS_METHODS]).toEqual([
      'ideas.list', // ideas, all channels or one
      'ideas.create', // a hand-written idea
      'ideas.update', // title, angle, status (new / kept / rejected)
      'ideas.delete', // removes one idea
      'ideas.generate', // the ideas agent proposes new ones (user's Claude Code)
      'ideas.toVideo', // « Créer la vidéo »: a plain video row, idea marked used
      'automations.list', // the rules with their next firing
      'automations.create', // a new rule
      'automations.update', // edit / enable / disable
      'automations.delete', // removes a rule
      'automations.runNow', // fires a rule now (engine run)
      'automations.history' // what each firing did
    ])
  })

  it('computes the next firing in local time', () => {
    const wed = new Date(2026, 9, 21, 10, 30) // Wednesday 21 Oct 2026, 10:30
    expect(nextRunAt('manual', 9, null, wed)).toBeNull()
    expect(nextRunAt('daily', 9, null, wed)).toEqual(new Date(2026, 9, 22, 9))
    expect(nextRunAt('daily', 18, null, wed)).toEqual(new Date(2026, 9, 21, 18))
    expect(nextRunAt('weekly', 9, 1, wed)).toEqual(new Date(2026, 9, 26, 9)) // next Monday
    expect(nextRunAt('weekly', 11, 3, wed)).toEqual(new Date(2026, 9, 21, 11)) // later today
    expect(nextRunAt('weekly', 10, 3, wed)).toEqual(new Date(2026, 9, 28, 10)) // today but passed → next week
  })

  it('stores ideas, refuses bad input in French, and turns one into a plain video without any task', async () => {
    const core = memoryCore()
    try {
      const ch = await core.api['channels.create']({ name: 'Ma chaîne' })
      const idea = await core.api['ideas.create']({ channelId: ch.id, title: '  Le   Masque de fer ', angle: 'angle' })
      expect(idea).toMatchObject({ title: 'Le Masque de fer', source: 'manual', status: 'new', channelName: 'Ma chaîne' })
      expect(() => core.api['ideas.create']({ channelId: ch.id, title: '   ' })).toThrow('vide')
      expect(() => core.api['ideas.create']({ channelId: 999, title: 'x' })).toThrow('Chaîne introuvable')
      expect(() => core.api['ideas.update'](idea.id, { status: 'used' })).toThrow('créant sa vidéo')
      expect(() => core.api['ideas.update'](idea.id, { status: 'bogus' as never })).toThrow('inconnu')
      const kept = await core.api['ideas.update'](idea.id, { status: 'kept' })
      expect(kept.status).toBe('kept')
      const used = await core.api['ideas.toVideo'](idea.id)
      expect(used.status).toBe('used')
      expect(used.videoId).not.toBeNull()
      const video = await core.api['videos.get'](used.videoId!)
      expect(video.video).toMatchObject({ title: 'Le Masque de fer', status: 'idea' })
      expect(await core.api['tasks.list']()).toEqual([])
      expect(() => core.api['ideas.toVideo'](idea.id)).toThrow('déjà sa vidéo')
      core.api['ideas.delete'](idea.id)
      expect(await core.api['ideas.list']()).toEqual([])
      expect(() => core.api['ideas.delete'](idea.id)).toThrow('introuvable')
      expect(() => core.api['ideas.list'](-1)).toThrow('Identifiant invalide')
    } finally {
      core.close()
    }
  })

  it('asks the ideas agent and keeps only a valid ```atelier-ideas``` answer', async () => {
    const good = 'Voici :\n```atelier-ideas\n[{"title":"Le Mary Celeste","angle":"Un navire vide","score":71},{"title":"Les catacombes","angle":"300 km"}]\n```'
    const provider = new FakeProvider([good, 'pas de bloc'])
    const core = memoryCore({ chatProvider: () => provider })
    try {
      const ch = await core.api['channels.create']({ name: 'Histoire', niche: 'mystères' })
      const rows = await core.api['ideas.generate'](ch.id, 2)
      expect(rows.map((r) => [r.title, r.source, r.score])).toEqual([
        ['Le Mary Celeste', 'agent', 71],
        ['Les catacombes', 'agent', null]
      ])
      expect(provider.calls[0]?.prompt).toContain('Niche : mystères')
      await expect(core.api['ideas.generate'](ch.id, 2)).rejects.toThrow('lisible')
      await expect(core.api['ideas.generate'](ch.id, 50)).rejects.toThrow('entre 1 et 10')
      expect(parseAgentIdeas('```atelier-ideas\n[{"title":""}]\n```')).toBeNull()
      expect(parseAgentIdeas('```atelier-ideas\nnot json\n```')).toBeNull()
    } finally {
      core.close()
    }
  })

  it('fires an automation: next idea → video → engine start, recorded; skipped without an idea; failed without an engine', async () => {
    const core = memoryCore({ now: () => new Date(2026, 9, 21, 10, 30) })
    try {
      const ch = await core.api['channels.create']({ name: 'Histoire' })
      const a = await core.api['automations.create']({ ...AUTO, channelId: ch.id })
      expect(a.nextRunAt).toBe(new Date(2026, 9, 26, 9).toISOString())
      const skipped = await core.api['automations.runNow'](a.id)
      expect(skipped).toMatchObject({ status: 'skipped' })

      await core.api['ideas.create']({ channelId: ch.id, title: 'Idée neuve' })
      core.context.automations.starter = null
      const failed = await core.api['automations.runNow'](a.id)
      expect(failed).toMatchObject({ status: 'failed', message: 'Le moteur de production n’est pas disponible.' })

      const started: unknown[] = []
      core.context.automations.starter = async (input) => {
        started.push(input)
        return { runId: 42 }
      }
      const keep = await core.api['ideas.create']({ channelId: ch.id, title: 'Idée gardée' })
      await core.api['ideas.update'](keep.id, { status: 'kept' })
      const ok = await core.api['automations.runNow'](a.id)
      expect(ok).toMatchObject({ status: 'started', runId: 42 })
      expect(started[0]).toMatchObject({ channelId: ch.id, topic: 'Idée gardée', minutes: 2, gateMode: 'step' })
      const ideas = await core.api['ideas.list'](ch.id)
      expect(ideas.find((i) => i.title === 'Idée gardée')?.status).toBe('used')
      expect((await core.api['automations.history'](a.id)).map((h) => h.status)).toEqual(['started', 'failed', 'skipped'])
      expect((await core.api['automations.list']())[0]?.lastRunAt).not.toBeNull()
    } finally {
      core.close()
    }
  })

  it('validates automations and fires only the due ones on tick', async () => {
    let now = new Date(2026, 9, 21, 10, 30)
    const core = memoryCore({ now: () => now })
    try {
      const ch = await core.api['channels.create']({ name: 'Top' })
      expect(() => core.api['automations.create']({ ...AUTO, channelId: ch.id, weekday: null })).toThrow('jour de la semaine')
      expect(() => core.api['automations.create']({ ...AUTO, channelId: ch.id, hour: 24 })).toThrow('entre 0 et 23')
      expect(() => core.api['automations.create']({ ...AUTO, channelId: ch.id, topicFrom: 'fixed', topic: ' ' })).toThrow('sujet')
      expect(() => core.api['automations.create']({ ...AUTO, channelId: ch.id, minutes: 0 })).toThrow('durée')
      const fixed = await core.api['automations.create']({ ...AUTO, channelId: ch.id, cadence: 'daily', weekday: null, hour: 11, topicFrom: 'fixed', topic: '10 records' })
      const off = await core.api['automations.update'](
        (await core.api['automations.create']({ ...AUTO, channelId: ch.id, cadence: 'daily', weekday: null, hour: 11 })).id,
        { enabled: false }
      )
      expect(off.nextRunAt).toBeNull()
      core.context.automations.starter = async () => ({ runId: 7 })
      expect(await core.context.automations.tick()).toEqual([])
      now = new Date(2026, 9, 21, 11, 1)
      const fired = await core.context.automations.tick()
      expect(fired.map((f) => f.automationId)).toEqual([fixed.id])
      expect((await core.api['automations.list']()).find((x) => x.id === fixed.id)?.nextRunAt).toBe(new Date(2026, 9, 22, 11).toISOString())
      core.api['automations.delete'](fixed.id)
      expect(() => core.api['automations.delete'](fixed.id)).toThrow('introuvable')
    } finally {
      core.close()
    }
  })

  it('the example workspace brings ideas and automations, and takes them away', async () => {
    const core = memoryCore()
    try {
      await core.api['example.load']()
      const ideas = await core.api['ideas.list']()
      expect(ideas.length).toBe(7)
      expect(ideas.every((i) => i.example)).toBe(true)
      expect(ideas.some((i) => i.status === 'used' && i.videoId !== null)).toBe(true)
      const autos = await core.api['automations.list']()
      expect(autos.map((a) => [a.name, a.enabled])).toEqual([
        ['Documentaire du lundi', false],
        ['Top 10 du jeudi', false]
      ])
      expect(await core.api['automations.history']()).toHaveLength(1)
      await core.api['example.delete']()
      expect(await core.api['ideas.list']()).toEqual([])
      expect(await core.api['automations.list']()).toEqual([])
      expect(await core.api['automations.history']()).toEqual([])
    } finally {
      core.close()
    }
  })
})
