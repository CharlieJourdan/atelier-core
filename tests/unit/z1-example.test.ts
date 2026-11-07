// Lot Z1: the example workspace (load, delete in one click, first launch only, never real tasks).
import { describe, expect, it } from 'vitest'
import { EXAMPLE_METHODS } from '../../src/shared/api'
import { EXAMPLE_AREAS, EXAMPLE_STATE_KEY, ExampleWorkspace, type ExampleArea } from '../../src/main/example'
import { memoryCore } from './helpers'

describe('example workspace', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...EXAMPLE_METHODS]).toEqual([
      'example.status', // is it loaded, which channels are examples
      'example.load', // loads the invented channels, videos and figures
      'example.delete' // deletes every example row in one transaction
    ])
  })

  it('loads two example channels and eight videos, without a single task for the runner', async () => {
    const core = memoryCore()
    try {
      expect(await core.api['example.status']()).toEqual({ loaded: false, channelIds: [], deleted: false })
      const s = await core.api['example.load']()
      expect(s.loaded).toBe(true)
      expect(s.channelIds).toHaveLength(2)
      const channels = await core.api['channels.list']()
      expect(channels.map((c) => c.name)).toEqual(['Les Grandes Énigmes', 'Top Savoirs'])
      expect(await core.api['videos.list']()).toHaveLength(8)
      expect(await core.api['tasks.list']()).toEqual([])
      expect(() => core.api['example.load']()).toThrow('déjà chargé')
    } finally {
      core.close()
    }
  })

  it('deletes only the example rows and remembers it was deleted', async () => {
    const core = memoryCore()
    try {
      await core.api['example.load']()
      const own = await core.api['channels.create']({ name: 'Ma chaîne' })
      await core.api['videos.create'](own.id, { title: 'Ma vidéo' })
      const s = await core.api['example.delete']()
      expect(s).toEqual({ loaded: false, channelIds: [], deleted: true })
      expect((await core.api['channels.list']()).map((c) => c.name)).toEqual(['Ma chaîne'])
      expect((await core.api['videos.list']()).map((v) => v.title)).toEqual(['Ma vidéo'])
      expect(core.context.settings.get(EXAMPLE_STATE_KEY)).toBe('deleted')
    } finally {
      core.close()
    }
  })

  it('loads on first launch only: never again once loaded or deleted, never over existing channels', () => {
    const core = memoryCore()
    try {
      const ws = core.context.example
      expect(ws.loadOnFirstLaunch()).toBe(true)
      ws.delete()
      expect(ws.loadOnFirstLaunch()).toBe(false)
      expect(ws.status().loaded).toBe(false)
    } finally {
      core.close()
    }
    const other = memoryCore()
    try {
      void other.api['channels.create']({ name: 'Déjà là' })
      expect(other.context.example.loadOnFirstLaunch()).toBe(false)
    } finally {
      other.close()
    }
  })

  it('the core loads it at start only when asked', async () => {
    const off = memoryCore()
    const on = memoryCore({ loadExample: true })
    try {
      expect((await off.api['example.status']()).loaded).toBe(false)
      expect((await on.api['example.status']()).loaded).toBe(true)
    } finally {
      off.close()
      on.close()
    }
  })

  it('runs every area seed and clear inside one transaction; a failing area leaves nothing behind', () => {
    const core = memoryCore()
    try {
      const calls: string[] = []
      const ok: ExampleArea = { name: 'ok', seed: () => calls.push('seed'), clear: () => calls.push('clear') }
      const bad: ExampleArea = {
        name: 'bad',
        seed: () => {
          throw new Error('boom')
        },
        clear: () => undefined
      }
      const ws = new ExampleWorkspace(core.db, core.context.settings, [ok, bad])
      expect(() => ws.load()).toThrow('boom')
      expect(ws.status().loaded).toBe(false)
      expect(core.context.settings.get(EXAMPLE_STATE_KEY)).toBe(null)
      const good = new ExampleWorkspace(core.db, core.context.settings, [ok])
      good.load()
      good.delete()
      expect(calls).toEqual(['seed', 'seed', 'clear'])
      expect(EXAMPLE_AREAS.length).toBeGreaterThanOrEqual(7)
    } finally {
      core.close()
    }
  })
})
