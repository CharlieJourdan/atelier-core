// Real mode, the store's actions for Cerveau (ideas) and Monétisation (revenues, subscription prices). They go through
// the registered live driver; the screens call them only when `state.mode === 'live'`. Changes show at once (optimistic)
// and are reconciled by the next snapshot (the main process reports `ideas` / `money` changes); a refused write puts
// the previous state back and reports the error in `live.error`.
import type { ChannelId } from '../types'
import type { Idea, IdeaColumn } from '../data-brain'
import type { MoneyEntry } from '../data-brain-money'
import type { ProtoState, ProtoStore } from '../store'
import { channelIdOf, ideaIdOf, mapIdea, mapIdeas, statusOfColumn } from './mapping-brain'
import { entriesOfRevenues, revenueIdOf, revenueInputOf } from './mapping-money'
import { liveDriver, type LiveBrainDriver, type LiveMoneyDriver } from './registry'

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function brainMoneyActions(store: ProtoStore) {
  const fail = (err: unknown): void => store.set((s) => ({ ...s, live: { ...s.live, error: errorText(err) } }))
  const brain = (): LiveBrainDriver | null => (store.get().mode === 'live' ? (liveDriver()?.brain ?? null) : null)
  const money = (): LiveMoneyDriver | null => (store.get().mode === 'live' ? (liveDriver()?.money ?? null) : null)
  const ideasNow = (): Idea[] => store.get().liveIdeas ?? []
  const setIdeas = (fn: (all: Idea[]) => Idea[]): void => store.set((s) => ({ ...s, liveIdeas: fn(s.liveIdeas ?? []) }))
  const upsert = (idea: Idea | null): void => {
    if (idea) setIdeas((all) => [idea, ...all.filter((i) => i.id !== idea.id)])
  }

  return {
    /** A new idea typed by hand, in a channel. */
    createIdea: async (input: { channelId: ChannelId; title: string; angle: string }): Promise<void> => {
      const d = brain()
      const channelId = channelIdOf(input.channelId)
      if (!d || channelId === null) return
      try {
        upsert(mapIdea(await d.createIdea({ channelId, title: input.title.trim(), angle: input.angle.trim() })))
      } catch (err) {
        fail(err)
      }
    },

    /** Edits an idea's title and angle. */
    updateIdea: async (id: string, patch: { title: string; angle: string }): Promise<void> => {
      const d = brain()
      const liveId = ideaIdOf(id)
      const before = ideasNow().find((i) => i.id === id)
      if (!d || liveId === null || !before) return
      setIdeas((all) => all.map((i) => (i.id === id ? { ...i, title: patch.title.trim(), angle: patch.angle.trim() } : i)))
      try {
        upsert(mapIdea(await d.updateIdea(liveId, { title: patch.title.trim(), angle: patch.angle.trim() })))
      } catch (err) {
        setIdeas((all) => all.map((i) => (i.id === id ? before : i)))
        fail(err)
      }
    },

    /** Moves a card on: « Valider » keeps the idea, « Lancer » turns it into a video (`ideas.toVideo`). */
    moveIdea: async (id: string, column: IdeaColumn): Promise<void> => {
      const d = brain()
      const liveId = ideaIdOf(id)
      const before = ideasNow().find((i) => i.id === id)
      if (!d || liveId === null || !before) return
      setIdeas((all) => all.map((i) => (i.id === id ? { ...i, column } : i)))
      try {
        const row = column === 'production' ? await d.ideaToVideo(liveId) : await d.updateIdea(liveId, { status: statusOfColumn(column) })
        upsert(mapIdea(row))
      } catch (err) {
        setIdeas((all) => all.map((i) => (i.id === id ? before : i)))
        fail(err)
      }
    },

    deleteIdea: async (id: string): Promise<void> => {
      const d = brain()
      const liveId = ideaIdOf(id)
      const before = ideasNow().find((i) => i.id === id)
      if (!d || liveId === null || !before) return
      setIdeas((all) => all.filter((i) => i.id !== id))
      try {
        await d.deleteIdea(liveId)
      } catch (err) {
        upsert(before)
        fail(err)
      }
    },

    /** Asks the ideas agent for `count` ideas for one channel; resolves with how many it brought. */
    generateIdeas: async (channelId: ChannelId, count = 5): Promise<number> => {
      const d = brain()
      const id = channelIdOf(channelId)
      if (!d || id === null) return 0
      try {
        const found = mapIdeas(await d.generateIdeas(id, count))
        setIdeas((all) => [...found, ...all.filter((i) => !found.some((f) => f.id === i.id))])
        return found.length
      } catch (err) {
        fail(err)
        return 0
      }
    },

    /** A revenue entered by hand (the « Ajouter un revenu » form). */
    addRevenue: async (entry: Omit<MoneyEntry, 'id'>): Promise<void> => {
      const d = money()
      if (!d) return
      const now = new Date()
      try {
        const row = await d.saveRevenue(revenueInputOf(entry, now))
        store.set((s) => (s.liveMoney ? { ...s, liveMoney: { ...s.liveMoney, revenues: [row, ...s.liveMoney.revenues.filter((r) => r.id !== row.id)] } } : s))
      } catch (err) {
        fail(err)
      }
    },

    deleteRevenue: async (entryId: string): Promise<void> => {
      const d = money()
      const id = revenueIdOf(entryId)
      const before = store.get().liveMoney?.revenues
      if (!d || id === null || !before) return
      store.set((s) => (s.liveMoney ? { ...s, liveMoney: { ...s.liveMoney, revenues: s.liveMoney.revenues.filter((r) => r.id !== id) } } : s))
      try {
        await d.deleteRevenue(id)
      } catch (err) {
        store.set((s) => (s.liveMoney ? { ...s, liveMoney: { ...s.liveMoney, revenues: before } } : s))
        fail(err)
      }
    },

    /** The monthly price typed for an AI account (null: not set). */
    setSubscriptionPrice: async (accountId: string, euros: number | null): Promise<void> => {
      const d = money()
      const before = store.get().liveMoney?.subscriptions
      if (!d || !before) return
      const next = { ...before }
      if (euros === null) delete next[accountId]
      else next[accountId] = euros
      store.set((s) => (s.liveMoney ? { ...s, liveMoney: { ...s.liveMoney, subscriptions: next } } : s))
      try {
        await d.setSubscriptions(next)
      } catch (err) {
        store.set((s) => (s.liveMoney ? { ...s, liveMoney: { ...s.liveMoney, subscriptions: before } } : s))
        fail(err)
      }
    }
  }
}

/** The revenue entries of the list, as the screen shows them. */
export function liveEntries(state: Pick<ProtoState, 'liveMoney'>, now = new Date()): MoneyEntry[] {
  const m = state.liveMoney
  return m ? entriesOfRevenues(m.revenues, m.overview.usdToEur, now) : []
}
