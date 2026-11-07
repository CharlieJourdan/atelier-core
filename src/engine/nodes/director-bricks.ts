// The channel's own bricks in the edit plan (docs/ENGINE-SPEC.md §25.2): the approved custom bricks the app gives the director (param
// `bricks`, from the channel's « Briques sur mesure » that are switched on) are placed where each one says: over the first seconds (it takes
// the title card's place), before the end (a subscribe reminder), or on each person the narration names with a role (a character card, the
// name and the role going into the fields the brick binds). Every other field takes the brick's default; the values are checked against the
// brick's fields, a cue whose values do not fit is dropped with a diagnostic. No two overlays at once, none over a presenter in
// picture-in-picture or a label. This pass runs BEFORE our templates' (director-motion.ts), which then keep out of the bricks' way.
// Pure: same inputs, same shots.
import { z } from 'zod'
import { BrickPlacement, resolveValues } from '../formats/brick'
import { CustomMotionSpec } from '../formats/motion'
import type { Shot } from '../formats/editplan'
import { FPS, toFrame, type Beat, type Word } from '../formats/timing'
import { namedPersonCue, personCues } from '../text/motion-cues'

export const BricksPlanParams = z.array(BrickPlacement).max(8)
export type BricksPlanParams = z.infer<typeof BricksPlanParams>

const GAP_S = 0.8

export interface BricksInput {
  bricks: readonly BrickPlacement[]
  words: readonly Word[]
  beats: readonly Beat[]
  durationS: number
  shots: readonly Shot[]
  accent: string
  theme: 'dark' | 'light'
  people?: (beat: Beat) => { name: string; role: string }[]
}

interface Cue {
  startS: number
  endS: number
  beat: number
  values: Record<string, unknown>
}

const overlaps = (a: { startS: number; endS: number }, b: { startS: number; endS: number }, margin: number): boolean => a.startS < b.endS + margin && a.endS > b.startS - margin

function cuesOf(b: BrickPlacement, o: BricksInput): Cue[] {
  const D = o.durationS
  const len = Math.min(b.use.seconds, D)
  if (b.use.on === 'start') return [{ startS: Math.min(0.2, o.words[0]?.start ?? 0), endS: Math.min(D, Math.min(0.2, o.words[0]?.start ?? 0) + len), beat: 0, values: {} }]
  if (b.use.on === 'end') {
    const startS = Math.max(0, D - len - 0.3)
    return [{ startS, endS: Math.min(D, startS + len), beat: o.beats.at(-1)?.i ?? 0, values: {} }]
  }
  // a person named with a role: the narration's own (« le professeur Élise Moreau ») and the scene pass's
  const people = personCues(o.words, o.beats)
  if (o.people) {
    for (const beat of o.beats) for (const p of o.people(beat)) {
      const c = namedPersonCue(o.words, beat, p)
      if (c) people.push(c)
    }
  }
  const seen = new Set<string>()
  const out: Cue[] = []
  for (const c of people.sort((x, y) => x.startS - y.startS)) {
    if (seen.has(c.key)) continue
    seen.add(c.key)
    const values: Record<string, unknown> = {}
    const props = c.props as { name?: string; role?: string }
    if (b.use.bind.name && props.name) values[b.use.bind.name] = props.name
    if (b.use.bind.role && props.role) values[b.use.bind.role] = props.role
    out.push({ startS: c.startS, endS: Math.min(D, c.startS + len), beat: c.beat, values })
  }
  return out
}

/** The bricks' overlay shots (ids `b001`…) and what the director says about them. */
export function placeBricks(o: BricksInput): { shots: Shot[]; diagnostics: string[] } {
  const diagnostics: string[] = []
  const busy: { startS: number; endS: number; margin: number }[] = []
  for (const s of o.shots) {
    if (s.track === 'overlay' && (s.kind === 'avatar' || s.kind === 'motion')) busy.push({ startS: s.startFrame / FPS, endS: s.endFrame / FPS, margin: 0.3 })
    if (s.track === 'labels') busy.push({ startS: s.startFrame / FPS, endS: s.endFrame / FPS, margin: 0.2 })
  }
  const chosen: { b: BrickPlacement; c: Cue; values: Record<string, unknown> }[] = []
  for (const b of o.bricks) {
    let n = 0
    for (const c of cuesOf(b, o)) {
      if (n >= b.use.max) break
      if (c.endS - c.startS < Math.min(b.seconds.min, o.durationS) - 1e-6) continue
      if (busy.some((x) => overlaps(c, x, x.margin)) || chosen.some((x) => overlaps(c, x.c, GAP_S))) {
        diagnostics.push(`bricks: ${b.template} at ${c.startS.toFixed(1)} s skipped, something else is on screen`)
        continue
      }
      const v = resolveValues({ id: b.template.slice('custom:'.length), fields: b.fields }, c.values)
      if (!v.ok) {
        diagnostics.push(`bricks: ${b.template} at ${c.startS.toFixed(1)} s dropped (${v.problems[0] ?? 'invalid'})`)
        continue
      }
      chosen.push({ b, c, values: v.values })
      n++
    }
  }
  chosen.sort((x, y) => x.c.startS - y.c.startS)
  const shots: Shot[] = []
  for (const { b, c, values } of chosen) {
    const startFrame = toFrame(c.startS)
    const endFrame = Math.min(toFrame(o.durationS), toFrame(c.endS))
    if (endFrame <= startFrame) continue
    shots.push({
      id: `b${String(shots.length + 1).padStart(3, '0')}`,
      track: 'overlay',
      startFrame,
      endFrame,
      kind: 'motion',
      transitionIn: 'cut',
      role: 'scene',
      beat: c.beat,
      graphic: CustomMotionSpec.parse({ template: b.template, props: values, accent: o.accent, theme: o.theme })
    })
  }
  if (o.bricks.length > 0) diagnostics.push(`bricks: ${shots.length} overlay(s) from the channel's own bricks (${[...new Set(chosen.map((x) => x.b.template))].join(', ') || 'none placed'})`)
  return { shots, diagnostics }
}
