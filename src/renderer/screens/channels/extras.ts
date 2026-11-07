// What a channel's detail view edits beyond the shared channel model (the mix of styles, rules, watched competitors,
// connections). Kept in a small module-level store so it survives going back to the list and opening the channel again.
import { useSyncExternalStore } from 'react'
import { CHANNEL_RULES, CONNECTION_DEFAULTS, STYLE_MIX, competitorsOf, type ConnectionId, type ConnectionState } from '@/proto/data-onboarding-channels'
import type { ProtoChannel } from '@/proto/types'

export interface ChannelExtras {
  /** Pipeline id → share of the output in %, summing to 100. */
  mix: Record<string, number>
  rules: string[]
  watched: Record<string, boolean>
  connections: Record<ConnectionId, ConnectionState>
}

const cache = new Map<string, ChannelExtras>()
const listeners = new Set<() => void>()
let version = 0

export function evenMix(ids: string[]): Record<string, number> {
  if (ids.length === 0) return {}
  const base = Math.floor(100 / ids.length)
  return Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 100 - base * (ids.length - 1) : base]))
}

/** Scales the shares so they sum to 100 again (after removing one). */
export function normalize(mix: Record<string, number>): Record<string, number> {
  const ids = Object.keys(mix)
  const sum = ids.reduce((s, k) => s + (mix[k] ?? 0), 0)
  if (ids.length === 0) return {}
  if (sum <= 0) return evenMix(ids)
  let given = 0
  return Object.fromEntries(
    ids.map((k, i) => {
      const v = i === ids.length - 1 ? 100 - given : Math.round(((mix[k] ?? 0) / sum) * 100)
      given += v
      return [k, v]
    })
  )
}

/** Sets one share and spreads the rest over the others in proportion, so the total stays 100. */
export function rebalance(mix: Record<string, number>, id: string, value: number): Record<string, number> {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  const others = Object.keys(mix).filter((k) => k !== id)
  if (others.length === 0) return { [id]: 100 }
  const rest = 100 - v
  const currentOthers = others.reduce((s, k) => s + (mix[k] ?? 0), 0)
  const next: Record<string, number> = { [id]: v }
  let given = 0
  others.forEach((k, i) => {
    const share = i === others.length - 1 ? rest - given : Math.round(currentOthers > 0 ? ((mix[k] ?? 0) / currentOthers) * rest : rest / others.length)
    next[k] = Math.max(0, share)
    given += next[k]
  })
  return next
}

export function seedExtras(channel: Pick<ProtoChannel, 'id' | 'connected' | 'pipelineIds'>): ChannelExtras {
  const defaults = CONNECTION_DEFAULTS[channel.id] ?? { analytics: 'off', storage: 'on', publishing: 'off', discord: 'off' }
  return {
    mix: STYLE_MIX[channel.id] ?? evenMix(channel.pipelineIds),
    rules: [...(CHANNEL_RULES[channel.id] ?? [])],
    watched: Object.fromEntries(competitorsOf(channel.id).map((c) => [c.id, c.watched])),
    connections: { ...defaults, analytics: channel.connected ? 'on' : defaults.analytics === 'on' ? 'on' : 'off' }
  }
}

export function useChannelExtras(channel: Pick<ProtoChannel, 'id' | 'connected' | 'pipelineIds'>): [ChannelExtras, (patch: Partial<ChannelExtras>) => void] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
    () => version
  )
  let extras = cache.get(channel.id)
  if (!extras) {
    extras = seedExtras(channel)
    cache.set(channel.id, extras)
  }
  const update = (patch: Partial<ChannelExtras>): void => {
    cache.set(channel.id, { ...(cache.get(channel.id) ?? seedExtras(channel)), ...patch })
    version += 1
    for (const l of listeners) l()
  }
  return [extras, update]
}

/** For tests: forget everything that was edited. */
export function resetChannelExtras(): void {
  cache.clear()
  version += 1
}
