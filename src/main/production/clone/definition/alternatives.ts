// Alternatives when a clone cannot be fully done (chantier B, spec §2 P3, Charlie's review of 2026-11-04): an alternative
// keeps THIS channel's topic, tone, structure and visual universe (its own measured palette and fonts) and replaces ONLY
// the impossible elements, with bricks the engine has or a human input. It never borrows another channel's template or a
// base pipeline's look. Pure.
import type { ChannelUniverse, FeasibilityAlternative, FeasibilityElement } from '../../../../shared/clone'

/** How an impossible element can still be made, in the channel's own look. */
interface Replacement { title: string; uses: string[]; how: (what: string, u: ChannelUniverse) => string }

const palette = (u: ChannelUniverse): string => (u.palette.length ? `its own palette ${u.palette.join(' ')}` : 'its own colours')
const outline = (u: ChannelUniverse): string => (u.structure.length ? u.structure.join(' → ') : 'its own outline')

const REPLACEMENTS: readonly Replacement[] = [
  {
    title: 'Same stories, the impossible scenes told with real archives and maps',
    uses: ['visuals.fulfil', 'motion.render'],
    how: (what, u) => `Keeps the channel's subjects, ${u.tone ? `its ${u.tone} tone, ` : ''}its outline (${outline(u)}) and ${palette(u)}; the ${what} become real archive footage and photos of the same events, with animated maps and diagrams drawn in that palette.`
  },
  {
    title: 'Same stories, the impossible scenes generated in the channel\'s look',
    uses: ['clip.make', 'motion.render'],
    how: (what, u) => `Keeps the channel's subjects, tone and outline (${outline(u)}); the ${what} become generated clips described shot by shot from the reference frames' content (not their pixels), graded to ${palette(u)}.`
  },
  {
    title: 'Same channel, with your own renders imported',
    uses: ['human-input:footage'],
    how: (what, u) => `Everything else is made by Atelier in the channel's style (${palette(u)}); you supply the ${what} (your own renders) through the footage import slot.`
  }
]

/** The alternatives for the impossible elements of a map, faithful to the measured universe of the channel. */
export function faithfulAlternatives(elements: readonly FeasibilityElement[], universe: ChannelUniverse): FeasibilityAlternative[] {
  const impossible = elements.filter((e) => e.how === 'impossible')
  if (impossible.length === 0) return []
  const what = impossible.map((e) => e.description).join(', ')
  return REPLACEMENTS.map((r) => ({
    title: r.title,
    description: r.how(what, universe),
    keeps: { topic: true, tone: true, structure: true, palette: true },
    replaces: impossible.map((e) => e.id),
    borrowsLookFrom: null,
    palette: [...universe.palette],
    uses: r.uses
  }))
}

/** Problems of alternatives against the channel's measured universe (a palette colour it never uses, a missing palette). */
export function alternativeProblems(alternatives: readonly FeasibilityAlternative[], universe: ChannelUniverse | undefined): string[] {
  if (!universe) return []
  const own = new Set(universe.palette.map((c) => c.toUpperCase()))
  const out: string[] = []
  for (const a of alternatives) {
    if (a.palette === undefined) continue // a service that does not state its palette is judged on `keeps` alone (contract fakes)
    const foreign = a.palette.filter((c) => !own.has(c.toUpperCase()))
    if (foreign.length) out.push(`alternative « ${a.title} » uses colours the channel never uses: ${foreign.join(', ')}`)
    if (own.size > 0 && a.palette.length === 0) out.push(`alternative « ${a.title} » drops the channel's palette`)
  }
  return out
}
