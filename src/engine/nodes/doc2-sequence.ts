// The sequencer of `documentary@2` (research note documentary-2-2026-11 (old repository) § Sequencing): which way each stretch of the narration is
// shown, from what the scene pass found in it (a film to search, a person, several things listed, a place, a figure, a map, a chart, a
// document) and from the measured profile (doc2-profile.ts). It is deterministic for a seed: the variety is a rule, not luck.
// Rules measured on five whole videos of the reference channel:
// - the families keep their measured shares per part (the hook is film-led, the body prints-led), by deficit;
// - a map, a chart or a document comes only when the words give one, and never closer than its measured gap to the last one;
// - a non-film pattern never follows itself (5 % of the reference's changes do); no pattern comes three times in a row, film included:
//   a third film stretch is shown as a board or a still of the same words (one stretch's clips are one montage, `filmRunMax` caps a run);
// - the prints boards rotate their layouts (centred, large, side, two, three, four) by deficit, and turn to cream paper in short runs.
import { DOC2_PROFILE, familyOf, sharesAt, type Doc2Family, type Doc2Pattern, type Doc2Profile } from './doc2-profile'
import type { Doc2Scene } from './doc2-scene'

/** A stretch of narration to show: one sentence, or a part of a long one. */
export interface Doc2Slot {
  /** The sentence (from 1). */
  sentence: number
  start: number
  end: number
  /** The scene pass's answer for the sentence (shared by the parts of a long sentence). */
  scene: Doc2Scene
  /** The second part of a long sentence. */
  part: number
  /** The sentence opens a chapter (its title). */
  chapter?: string
}

export interface Doc2Unit {
  pattern: Doc2Pattern
  slots: Doc2Slot[]
  start: number
  end: number
  /** A prints board on cream paper instead of the slate. */
  cream?: boolean
}

/** A small seeded generator (mulberry32). */
export function seededRng(seed: string): () => number {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** What a scene can be shown as (the families its words give). */
export function familiesOf(sc: Doc2Scene): Set<Doc2Family> {
  const out = new Set<Doc2Family>()
  if (sc.film) out.add('film')
  if (sc.photo || sc.person || (sc.photos && sc.photos.length > 0)) out.add('prints')
  if (sc.photo) out.add('still')
  if (sc.map) out.add('map')
  if (sc.chart && sc.chart.rows.length >= 1) out.add('chart')
  if (sc.document) out.add('document')
  return out
}

/** The prints layouts a scene allows: several pictures listed make a board of two to four; a text beside asks for the side layout. */
function layoutsFor(sc: Doc2Scene): Doc2Pattern[] {
  const many = sc.photos?.length ?? 0
  if (many >= 4) return ['prints-4', 'prints-3', 'prints-2']
  if (many === 3) return ['prints-3', 'prints-2']
  if (many === 2) return ['prints-2']
  const side = sc.number !== undefined || sc.date !== undefined || sc.quote !== undefined || sc.place !== undefined
  return side ? ['print-side', 'print-centre', 'print-large'] : ['print-centre', 'print-large', 'print-side']
}

/**
 * Units from slots: each slot gets a pattern; a map or a chart keeps the next slot too when its own is shorter than its measured length
 * and the next one has nothing of its own to show.
 */
export function sequenceDoc2(slots: readonly Doc2Slot[], o: { seed: string; profile?: Doc2Profile }): Doc2Unit[] {
  const P = o.profile ?? DOC2_PROFILE
  const rnd = seededRng(`doc2|${o.seed}`)
  const time: Record<Doc2Family, number> = { film: 0, prints: 0, still: 0, map: 0, chart: 0, document: 0 }
  const hookTime: Record<Doc2Family, number> = { film: 0, prints: 0, still: 0, map: 0, chart: 0, document: 0 }
  const layoutCount: Record<string, number> = {}
  let boards = 0
  const last: Record<'map' | 'chart' | 'document', number> = { map: -Infinity, chart: -Infinity, document: -Infinity }
  const units: Doc2Unit[] = []
  let filmRun = 0
  let creamLeft = 0
  let lastLayout: Doc2Pattern | null = null
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] as Doc2Slot
    const t = s.start
    const inHook = t < P.hookS
    const target = sharesAt(P, t)
    const spent = inHook ? hookTime : time
    const total = Object.values(spent).reduce((a, b) => a + b, 0) + (s.end - s.start)
    const prev = units.at(-1)
    const prevPrev = units.at(-2)
    const can = familiesOf(s.scene)
    if (s.part > 0) {
      // the second part of a long sentence: never a second map, chart or document out of one sentence
      can.delete('map')
      can.delete('chart')
      can.delete('document')
    }
    for (const k of ['map', 'chart', 'document'] as const) if (t - last[k] < P.gapS[k]) can.delete(k)
    // the channels open on film: no map in the first seconds (the first maps come at 20–80 s)
    if (t < P.firstMapAfterS) can.delete('map')
    if (can.size === 0) can.add('film')
    // a map, a chart, a document are rare and come from the words: one is offered only while its family is under its share
    for (const k of ['map', 'chart', 'document'] as const) if (spent[k] / Math.max(30, total) >= (target[k] ?? 0) * 1.2) can.delete(k)
    if (can.size === 0) can.add('film')
    // never three film stretches in a row: the same words as a board, or as a still when the stretch is too short for a board
    if (prev && prevPrev && prev.pattern === 'film' && prevPrev.pattern === 'film') {
      can.delete('film')
      if (s.end - s.start >= P.boardMinS) can.add('prints')
      else if (can.size === 0) can.add('still')
    }
    const scores = new Map<Doc2Family, number>()
    for (const f of can) {
      const deficit = (target[f] ?? 0) - spent[f] / Math.max(1, total)
      let sc = deficit * 14 + (rnd() - 0.5) * 0.6
      // when one is there, under its share and its gap allows, it wins over the films' and boards' deficits (round 2 of director-motion:
      // a Swiss map lost to a board), and the hook's first map whatever its share
      if (f === 'map' || f === 'chart' || f === 'document') sc += (target[f] ?? 0) > 0 ? 7 : -5
      if (f === 'map' && t < P.firstMapByS && last.map < 0) sc += 3
      if (f === 'prints' && s.scene.person) sc += 1
      if (f === 'prints' && (s.scene.photos?.length ?? 0) >= 2) sc += 1
      if (f === 'still') sc -= 1.5
      // the reference's montages: film clips come in runs (mean 2.8 shots), boards often two in a row (with another layout)
      if (prev && familyOf(prev.pattern) === f) sc += f === 'film' ? (filmRun < 3 ? 1 : 0) : f === 'prints' ? 0.4 : 0
      if (f === 'film' && filmRun >= P.filmRunMax) sc -= 6
      // the same family as the last two units is avoided unless it is film (a montage of clips)
      if (f !== 'film' && prev && familyOf(prev.pattern) === f && prevPrev && familyOf(prevPrev.pattern) === f) sc -= 4
      scores.set(f, sc)
    }
    const scoreOf = (f: Doc2Family): number => scores.get(f) ?? -Infinity
    const fam = [...can].sort((a, b) => scoreOf(b) - scoreOf(a))[0] as Doc2Family
    let pattern: Doc2Pattern
    if (fam === 'prints') {
      const allowed = layoutsFor(s.scene).filter((l) => l !== lastLayout || layoutsFor(s.scene).length === 1)
      const choice = (allowed.length > 0 ? allowed : layoutsFor(s.scene))
        .map((l, k) => ({ l, sc: (P.printLayouts[l as keyof Doc2Profile['printLayouts']] ?? 0) - (layoutCount[l] ?? 0) / Math.max(1, boards) - k * 0.04 + (rnd() - 0.5) * 0.05 }))
        .sort((a, b) => b.sc - a.sc)[0]
      pattern = (choice?.l ?? 'print-centre') as Doc2Pattern
      // the same layout twice in a row is broken by the next best one (a pattern never follows itself)
      if (prev?.pattern === pattern) {
        const other = (['print-centre', 'print-large', 'print-side'] as Doc2Pattern[]).find((l) => l !== pattern)
        if (other) pattern = other
      }
      layoutCount[pattern] = (layoutCount[pattern] ?? 0) + 1
      boards++
      lastLayout = pattern
    } else pattern = fam as Doc2Pattern
    // a pattern never follows itself (but a film follows a film: the clips are different)
    if (prev && prev.pattern === pattern && pattern !== 'film' && familyOf(pattern) !== 'prints') {
      const alt = [...can].filter((f) => f !== fam).sort((a, b) => scoreOf(b) - scoreOf(a))[0]
      pattern = alt === 'prints' ? 'print-centre' : ((alt ?? 'film') as Doc2Pattern)
    }
    let end = s.end
    const unitSlots = [s]
    // a map or a chart holds while it builds: it takes the next short slot when that one brings nothing of its own
    if ((pattern === 'map' || pattern === 'chart') && end - s.start < P.lengthS[pattern] * 0.7) {
      const next = slots[i + 1]
      const nextOwn = next ? familiesOf(next.scene) : new Set<Doc2Family>()
      if (next && !nextOwn.has('map') && !nextOwn.has('chart') && !nextOwn.has('document') && next.end - s.start <= P.lengthS[pattern] * 1.6) {
        unitSlots.push(next)
        end = next.end
        i++
      }
    }
    const unit: Doc2Unit = { pattern, slots: unitSlots, start: s.start, end }
    if (familyOf(pattern) === 'prints') {
      if (creamLeft <= 0 && rnd() < P.creamShare / Math.max(1, P.creamRun) * 1.6) creamLeft = P.creamRun
      if (creamLeft > 0) {
        unit.cream = true
        creamLeft--
      }
    }
    units.push(unit)
    const f = familyOf(pattern)
    ;(inHook ? hookTime : time)[f] += end - s.start
    if (f === 'map' || f === 'chart' || f === 'document') last[f] = s.start
    filmRun = f === 'film' ? filmRun + Math.max(1, Math.round((end - s.start) / P.filmClipS)) : 0
  }
  return units
}

/** The checks the plan must pass (and the tests assert): no non-film pattern twice in a row, maps / charts / documents apart. */
export function sequenceProblems(units: readonly Doc2Unit[], P: Doc2Profile = DOC2_PROFILE): string[] {
  const out: string[] = []
  units.forEach((u, i) => {
    const prev = units[i - 1]
    if (prev && prev.pattern === u.pattern && u.pattern !== 'film') out.push(`${u.pattern} twice in a row at ${u.start.toFixed(1)} s`)
    if (prev && units[i - 2]?.pattern === u.pattern && prev.pattern === u.pattern) out.push(`${u.pattern} three times in a row at ${u.start.toFixed(1)} s`)
  })
  for (const k of ['map', 'chart', 'document'] as const) {
    const ts = units.filter((u) => u.pattern === k).map((u) => u.start)
    ts.forEach((t, i) => {
      if (i > 0 && t - (ts[i - 1] as number) < P.gapS[k] - 1e-6) out.push(`${k} ${(t - (ts[i - 1] as number)).toFixed(0)} s after the last one`)
    })
  }
  return out
}

/** Screen time per family over the units (shares 0..1), for the plan's diagnostics. */
export function familyShares(units: readonly Doc2Unit[]): Record<Doc2Family, number> {
  const t: Record<Doc2Family, number> = { film: 0, prints: 0, still: 0, map: 0, chart: 0, document: 0 }
  for (const u of units) t[familyOf(u.pattern)] += u.end - u.start
  const all = Object.values(t).reduce((a, b) => a + b, 0) || 1
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / all])) as Record<Doc2Family, number>
}
