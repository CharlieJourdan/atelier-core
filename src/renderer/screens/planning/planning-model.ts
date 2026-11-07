// Pure model of the planning: which videos land on which day, how same-channel videos of one day stack, which render
// deadlines show up, and how the events of a day share its width. No React, no clock: the fixtures speak in day
// offsets from today, so a "day" here is that offset.
import type { Scope } from '@/proto/store'
import type { ChannelId, ProtoChannel, ProtoVideo } from '@/proto/types'
import { minutesOf } from './dates'

export const HOUR_START = 8
export const HOUR_END = 23
export const HOUR_H = 56
export const EVENT_H = 54
export const GRID_H = (HOUR_END - HOUR_START + 1) * HOUR_H
/** A publication is drawn as a one-hour slot when sharing the day with another one. */
const SLOT_MIN = 60

export interface PlanItem {
  video: ProtoVideo
  channel: ProtoChannel | undefined
  dayOffset: number
  minutes: number
}

export interface PlanGroup {
  key: string
  channelId: ChannelId | null
  channel: ProtoChannel | undefined
  dayOffset: number
  format: 'long' | 'short'
  items: PlanItem[]
  /** First slot of the group. */
  minutes: number
  /** Mean production progress. */
  progress: number
}

export interface RenderDeadline {
  key: string
  channelId: ChannelId | null
  channel: ProtoChannel | undefined
  dayOffset: number
  videos: ProtoVideo[]
}

function visible(v: ProtoVideo, scope: Scope, hidden: readonly string[]): boolean {
  if (scope !== 'all' && v.channelId !== scope) return false
  return !(v.channelId && hidden.includes(v.channelId))
}

/** Every scheduled video in scope, as a slot on a day. */
export function planItems(videos: ProtoVideo[], channels: ProtoChannel[], scope: Scope, hidden: readonly string[] = []): PlanItem[] {
  return videos
    .filter((v) => v.publishInDays !== null && visible(v, scope, hidden))
    .map((v) => ({
      video: v,
      channel: channels.find((c) => c.id === v.channelId),
      dayOffset: v.publishInDays as number,
      minutes: minutesOf(v.publishTime)
    }))
    .sort((a, b) => a.dayOffset - b.dayOffset || a.minutes - b.minutes)
}

/** Same channel, same day, same format → one stack placed at the first slot. */
export function groupItems(items: PlanItem[]): PlanGroup[] {
  const map = new Map<string, PlanItem[]>()
  for (const it of items) {
    const key = `${it.video.channelId ?? 'none'}|${it.dayOffset}|${it.video.format}`
    map.set(key, [...(map.get(key) ?? []), it])
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.minutes - b.minutes)
      const first = sorted[0] as PlanItem
      return {
        key,
        channelId: first.video.channelId,
        channel: first.channel,
        dayOffset: first.dayOffset,
        format: first.video.format,
        items: sorted,
        minutes: first.minutes,
        progress: sorted.reduce((n, i) => n + i.video.progress, 0) / sorted.length
      }
    })
    .sort((a, b) => a.dayOffset - b.dayOffset || a.minutes - b.minutes)
}

/** Videos whose render deadline falls on a day and that are not published yet, one entry per channel and day. */
export function renderDeadlines(videos: ProtoVideo[], scope: Scope, hidden: readonly string[] = [], channels: ProtoChannel[] = []): RenderDeadline[] {
  const map = new Map<string, ProtoVideo[]>()
  for (const v of videos) {
    // real videos without a deadline have no slot, so nothing to render for
    if (v.stage === 'published' || v.noRenderDeadline || !visible(v, scope, hidden)) continue
    const key = `${v.channelId ?? 'none'}|${v.dueInDays}`
    map.set(key, [...(map.get(key) ?? []), v])
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const first = list[0] as ProtoVideo
      return { key, channelId: first.channelId, channel: channels.find((c) => c.id === first.channelId), dayOffset: first.dueInDays, videos: list }
    })
    .sort((a, b) => a.dayOffset - b.dayOffset)
}

export interface Placed {
  group: PlanGroup
  lane: number
  lanes: number
  top: number
}

/** Side-by-side lanes for the groups of one day that overlap in time. */
export function layoutDay(groups: PlanGroup[]): Placed[] {
  const sorted = [...groups].sort((a, b) => a.minutes - b.minutes)
  const out: Placed[] = []
  let cluster: { group: PlanGroup; lane: number; end: number }[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1))
    for (const c of cluster) out.push({ group: c.group, lane: c.lane, lanes, top: topOf(c.group.minutes) })
    cluster = []
  }
  for (const g of sorted) {
    if (cluster.length > 0 && g.minutes >= clusterEnd) flush()
    const taken = new Set(cluster.filter((c) => c.end > g.minutes).map((c) => c.lane))
    let lane = 0
    while (taken.has(lane)) lane++
    cluster.push({ group: g, lane, end: g.minutes + SLOT_MIN })
    clusterEnd = Math.max(clusterEnd, g.minutes + SLOT_MIN)
  }
  if (cluster.length > 0) flush()
  return out
}

export function topOf(minutes: number): number {
  const raw = ((minutes - HOUR_START * 60) / 60) * HOUR_H
  return Math.max(0, Math.min(GRID_H - EVENT_H, raw))
}

/** Pixel offset of the "now" line inside the hour grid, or null outside the 8 h – 24 h window. */
export function nowOffset(now: Date): number | null {
  const m = now.getHours() * 60 + now.getMinutes()
  if (m < HOUR_START * 60) return null
  return ((m - HOUR_START * 60) / 60) * HOUR_H
}

/** Where a drop at `y` pixels from the top of a day column lands, snapped to 15 minutes. */
export function minutesAt(y: number): number {
  const raw = HOUR_START * 60 + (y / HOUR_H) * 60
  const snapped = Math.round(raw / 15) * 15
  return Math.max(HOUR_START * 60, Math.min((HOUR_END + 1) * 60 - 15, snapped))
}
