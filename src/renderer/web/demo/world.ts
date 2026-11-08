// The demo's fictional world, shared by every handler file: the same four channels as the demo store
// (src/renderer/proto/data-core.ts CHANNELS) under numeric ids, a fixed "now", and small helpers. All names are invented.
import { CHANNELS } from '@/proto/data-core'

/** Numeric ids of the demo channels (the real API speaks numbers; the store speaks `ch-*`). */
export const DEMO_CHANNELS = CHANNELS.map((c, i) => ({ id: i + 1, key: c.id, name: c.name, handle: c.handle, niche: c.niche }))

export const channelName = (id: number | null | undefined): string => DEMO_CHANNELS.find((c) => c.id === id)?.name ?? DEMO_CHANNELS[0]!.name

/** ISO time `minutes` ago (negative: in the future). */
export const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()

let seq = 1000
/** A fresh id for things the visitor creates during the tour. */
export const nextId = (): number => ++seq
