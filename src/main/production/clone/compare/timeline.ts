// Our timeline read back from the director's edit plan (the engine's `director` output): base-track shots in time order,
// all drawn motion unless the shot is found or user footage, no presenter (POV bricks). Pure.
import type { OurShot } from '../../../../shared/clone'

export function timelineOf(editplan: unknown): OurShot[] | null {
  const p = editplan as { kind?: string; shots?: { track: string; start: number; end: number; kind: string }[] }
  if (p?.kind !== 'editplan' || !Array.isArray(p.shots)) return null
  return p.shots.filter((s) => s.track === 'base' && s.end > s.start).sort((a, b) => a.start - b.start)
    .map((s) => ({ startS: s.start, lengthS: Math.round((s.end - s.start) * 1000) / 1000, origin: /stock|user/.test(s.kind) ? 'found' : 'motion', layout: 'off', motion: !/stock|user/.test(s.kind) }))
}
