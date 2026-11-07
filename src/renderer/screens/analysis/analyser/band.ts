// The coloured time band of an example video: every timeline segment becomes a coloured stretch (green = we remake it
// well, amber = with adaptations, red = we cannot), by what the segment's component becomes in the current gauge state
// (the user's answers move the colours together with the note). Pure.
import type { TimelineSegment } from '../../../../shared/analysis'
import { effectiveComponent, segmentTone, type ComponentId, type GaugeState, type SegmentTone } from '../../../../shared/gauge'

export interface BandSegment {
  index: number
  /** Left edge and width in percent of the video. */
  left: number
  width: number
  startS: number
  endS: number
  component: ComponentId
  /** What actually makes it (itself, the user's footage, or a replacement). */
  by: ComponentId
  replaced: boolean
  footage: boolean
  capability: number
  tone: SegmentTone
  note: string
}

export function bandSegments(segments: readonly TimelineSegment[], state: GaugeState): BandSegment[] {
  const total = segments.reduce((m, s) => Math.max(m, s.endS), 0)
  if (total <= 0) return []
  return segments
    .filter((s) => s.endS > s.startS)
    .map((s, index) => {
      const eff = effectiveComponent(s.component, state)
      return {
        index,
        left: (s.startS / total) * 100,
        width: ((s.endS - s.startS) / total) * 100,
        startS: s.startS,
        endS: s.endS,
        component: s.component,
        by: eff.by,
        replaced: eff.replaced,
        footage: eff.footage,
        capability: eff.capability,
        tone: segmentTone(eff.capability),
        note: s.note
      }
    })
}

/** Share of the video (0..1) per tone, for the legend. */
export function toneShares(segs: readonly BandSegment[]): Record<SegmentTone, number> {
  const out: Record<SegmentTone, number> = { green: 0, amber: 0, red: 0 }
  for (const s of segs) out[s.tone] += s.width / 100
  return out
}

/** 75 gives « 1:15 ». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
