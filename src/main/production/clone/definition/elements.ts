// P3's measure (chantier B, spec §2 P3): every shot of every corpus video falls into ONE element of the style (the
// presenter, found archives, motion maps, 3D scenes…); an element's screen share is its pooled measured screen time.
// Each element gets the engine brick that makes it, or a human input (an import slot), or « impossible » with the missing
// technology and its cost. Pure: the brick catalogue is passed in (the engine registry in production).
import type { AnalysedShot, Brief, ChannelUniverse, FeasibilityElement, MediaOrigin, Synthesis, VideoAnalysis } from '../../../../shared/clone'
import { agreed, corpusEvidence, frequentItems, round3, screenSeconds } from './stats'

type Kind = AnalysedShot['kind']

/** One element of the style: the shots it covers and how it is made. */
interface ElementRule {
  id: string
  axis: string
  description: string
  match(s: AnalysedShot, presenterKind: string): boolean
  make(ctx: { brief: Brief; presenterKind: string }): Pick<FeasibilityElement, 'how' | 'brick' | 'slot' | 'missing'>
}

const STILL_KINDS: readonly Kind[] = ['archive-photo', 'document']
const MOTION_KINDS: readonly Kind[] = ['map', 'chart', 'motion-graphic', 'title-card', 'illustration']

const brick = (node: string): Pick<FeasibilityElement, 'how' | 'brick' | 'slot' | 'missing'> => ({ how: 'brick', brick: node, slot: null, missing: null })
const human = (kind: NonNullable<FeasibilityElement['slot']>['kind'], what: string, userSupplies: boolean): Pick<FeasibilityElement, 'how' | 'brick' | 'slot' | 'missing'> =>
  ({ how: 'human-input', brick: null, slot: { kind, what, userSupplies }, missing: null })

/** What a missing technology would cost (ESTIMATES, said as such in the note; never a measure). */
export const MISSING_TECH: Record<string, { technology: string; buildCostUsd: number | null; importCostUsd: number | null; note: string }> = {
  '3d': {
    technology: '3D scene rendering (game-engine characters, vehicles, battle scenes)',
    buildCostUsd: 3000,
    importCostUsd: 0,
    note: 'estimate, not measured: building a 3D scene brick is weeks of engineering; importing the user\'s own renders costs nothing through the footage slot'
  }
}

/** The elements, in a fixed order; the first rule a shot matches owns it. */
export const ELEMENT_RULES: readonly ElementRule[] = [
  {
    id: 'presenter', axis: 'presenter', description: 'presenter on screen',
    // a person speaking in FOUND footage (an archive of a public figure at a lectern, seen on a Finary Short) or a « presenter »
    // shot the analysis saw off screen is not the channel's presenter: it is footage of what is said
    match: (s) => s.origin === 'presenter' || (s.kind === 'presenter' && s.origin !== 'found' && s.layout !== 'off'),
    make: ({ brief, presenterKind }) => {
      if (brief.ownChannel) return brick('avatar.speak') // his own avatar clone speaks for him (P4 checks it exists)
      if (presenterKind === 'avatar') return brick('avatar.speak') // a look-alike avatar of the same type is a brick
      return human('presenter-footage', 'the presenter filmed on camera (a look-alike placeholder of the same type stands in)', brief.humanInputs.face)
    }
  },
  { id: '3d', axis: 'visuals', description: '3D rendered scenes', match: (s) => s.origin === '3d', make: () => ({ how: 'impossible', brick: null, slot: null, missing: MISSING_TECH['3d']! }) },
  {
    id: 'filmed', axis: 'visuals', description: 'footage filmed by the channel',
    match: (s) => s.origin === 'filmed',
    make: ({ brief }) => human('footage', 'the channel\'s own filmed footage (FOUND footage of the same kind stands in, never generated)', brief.humanInputs.footage)
  },
  { id: 'found-stills', axis: 'visuals', description: 'found stills (archive photos, documents)', match: (s) => s.origin === 'found' && STILL_KINDS.includes(s.kind), make: () => brick('visuals.fulfil') },
  { id: 'gameplay', axis: 'visuals', description: 'gameplay footage', match: (s) => s.kind === 'gameplay', make: () => brick('background.clips') },
  { id: 'found-footage', axis: 'visuals', description: 'found moving footage (archives, stock, web)', match: (s) => s.origin === 'found', make: () => brick('visuals.fulfil') },
  { id: 'screen', axis: 'visuals', description: 'screen captures', match: (s) => s.origin === 'screen' || s.kind === 'screen-capture', make: () => brick('visuals.fulfil') },
  { id: 'generated', axis: 'visuals', description: 'generated pictures and clips', match: (s) => s.origin === 'generated', make: () => brick('clip.make') },
  { id: 'drawn', axis: 'motion', description: 'drawn 2D scenes and characters', match: (s) => s.origin === 'drawn', make: () => brick('motion.render') },
  { id: 'motion-cards', axis: 'motion', description: 'motion design (maps, charts, cards, kinetic type)', match: (s) => s.origin === 'motion' || MOTION_KINDS.includes(s.kind), make: () => brick('motion.render') },
  { id: 'other', axis: 'visuals', description: 'other shots', match: () => true, make: () => brick('visuals.fulfil') }
]

/** The element that owns a shot by its measured ORIGIN alone (the repair pass): by construction the elements then cover exactly
 *  the origin shares the shots measure. Found shots still split stills / gameplay / moving footage. */
const BY_ORIGIN: Partial<Record<MediaOrigin, string>> = { presenter: 'presenter', '3d': '3d', filmed: 'filmed', screen: 'screen', generated: 'generated', drawn: 'drawn', motion: 'motion-cards' }
function ownerByOrigin(s: AnalysedShot): ElementRule {
  const id = s.origin === 'found' ? (STILL_KINDS.includes(s.kind) ? 'found-stills' : s.kind === 'gameplay' ? 'gameplay' : 'found-footage') : BY_ORIGIN[s.origin] ?? 'other'
  return ELEMENT_RULES.find((r) => r.id === id)!
}

/** The elements of a corpus with their MEASURED screen shares (pooled screen time) and evidence. When the shot-by-shot rules
 *  disagree with the analyses' own origin shares or presenter presence (crossCheckElements), the map repairs itself: every
 *  shot is owned by its measured origin and the shares are recomputed (the stricter of the two is kept). P3's check stays strict. */
export function measureElements(analyses: readonly VideoAnalysis[], brief: Brief, hasBrick: (node: string) => boolean = () => true): FeasibilityElement[] {
  const total = screenSeconds(analyses)
  if (total <= 0) return []
  const presenterKind = agreed(analyses.map((a) => a.presenter.kind))?.value ?? analyses[0]?.presenter.kind ?? 'none'
  const first = elementsOwnedBy((s) => ELEMENT_RULES.find((r) => r.match(s, presenterKind))!, analyses, brief, presenterKind, total, hasBrick)
  const problems = crossCheckElements(first, analyses)
  if (problems.length === 0) return first
  const repaired = elementsOwnedBy(ownerByOrigin, analyses, brief, presenterKind, total, hasBrick)
  return crossCheckElements(repaired, analyses).length < problems.length ? repaired : first
}

function elementsOwnedBy(owner: (s: AnalysedShot) => ElementRule, analyses: readonly VideoAnalysis[], brief: Brief, presenterKind: string, total: number, hasBrick: (node: string) => boolean): FeasibilityElement[] {
  const out: FeasibilityElement[] = []
  for (const rule of ELEMENT_RULES) {
    const mine = (s: AnalysedShot): boolean => owner(s) === rule
    const seconds = analyses.reduce((t, a) => t + a.shots.filter(mine).reduce((x, s) => x + s.lengthS, 0), 0)
    if (seconds <= 0) continue
    let made = rule.make({ brief, presenterKind })
    if (made.how === 'brick' && made.brick && !hasBrick(made.brick)) {
      made = { how: 'impossible', brick: null, slot: null, missing: { technology: `${rule.description} (no ${made.brick} brick in this engine)`, buildCostUsd: null, importCostUsd: 0, note: 'the brick is missing from the engine registry: build it or import the shots' } }
    }
    const kinds = [...new Set(analyses.flatMap((a) => a.shots.filter(mine).map((s) => s.kind)))].sort()
    const origins = [...new Set(analyses.flatMap((a) => a.shots.filter(mine).map((s) => s.origin)))]
    out.push({
      id: rule.id, axis: rule.axis, description: rule.description,
      screenShare: { value: round3(seconds / total), evidence: corpusEvidence(analyses, mine) },
      ...made,
      ...(origins.length === 1 ? { origin: origins[0] } : {}),
      kinds
    })
  }
  return out
}

/** Pooled origin shares of the analyses (each video weighted by its read duration). */
export function pooledOriginShares(analyses: readonly VideoAnalysis[]): Partial<Record<MediaOrigin, number>> {
  const total = screenSeconds(analyses)
  const out: Partial<Record<MediaOrigin, number>> = {}
  for (const a of analyses) {
    const read = a.shots.reduce((t, s) => t + s.lengthS, 0)
    for (const [o, share] of Object.entries(a.editing.originShares)) out[o as MediaOrigin] = (out[o as MediaOrigin] ?? 0) + (share ?? 0) * read
  }
  for (const k of Object.keys(out)) out[k as MediaOrigin] = round3(out[k as MediaOrigin]! / Math.max(total, 1))
  return out
}

/** Problems where the elements' screen shares disagree with the analyses (origin shares and presenter presence). */
export function crossCheckElements(elements: readonly FeasibilityElement[], analyses: readonly VideoAnalysis[], tolerance = 0.05): string[] {
  if (analyses.length === 0) return []
  const problems: string[] = []
  const pooled = pooledOriginShares(analyses)
  const originOf = (e: FeasibilityElement): string | undefined => e.origin ?? (Object.keys(pooled).includes(e.id) ? e.id : undefined)
  const byOrigin = new Map<string, number>()
  for (const e of elements) { const o = originOf(e); if (o) byOrigin.set(o, (byOrigin.get(o) ?? 0) + e.screenShare.value) }
  // A presenter filmed on camera is one element whatever origin the look gave each of his shots (« presenter » for a
  // talking set-up, « filmed » for the same man filmed — seen on Finary: 54 % presenter element = 31 % + 21 % measured):
  // those two origins are compared together.
  const PERSON: readonly string[] = ['presenter', 'filmed']
  // only when the presenter element absorbed the filmed shots (the filmed element holds far less than the filmed time
  // measured); a separate filmed B-roll element keeps its own check
  const together = byOrigin.has('presenter') && (byOrigin.get('filmed') ?? 0) + tolerance < (pooled.filmed ?? 0)
  const group = (o: string): string => (PERSON.includes(o) && together ? 'presenter or filmed' : o)
  const ours = new Map<string, number>()
  const theirs = new Map<string, number>()
  for (const [o, share] of byOrigin) ours.set(group(o), (ours.get(group(o)) ?? 0) + share)
  for (const o of new Set([...byOrigin.keys(), ...(byOrigin.has('presenter') ? PERSON : [])])) theirs.set(group(o), (theirs.get(group(o)) ?? 0) + (pooled[o as MediaOrigin] ?? 0))
  for (const [o, share] of ours) {
    const measured = theirs.get(o) ?? 0
    if (Math.abs(measured - share) > tolerance) problems.push(`${o}: elements cover ${Math.round(share * 100)} % of the screen, the analyses measured ${Math.round(measured * 100)} %`)
  }
  // The presenter element against the measured presence (shots where he is on screen, full-frame or not).
  const presenter = elements.find((e) => e.id === 'presenter' || e.origin === 'presenter')
  if (presenter && analyses.every((a) => a.presenter.kind !== 'none')) {
    const total = screenSeconds(analyses)
    const onScreen = analyses.reduce((t, a) => t + a.shots.filter((s) => s.layout !== 'off').reduce((x, s) => x + s.lengthS, 0), 0) / Math.max(total, 1)
    if (presenter.screenShare.value > onScreen + tolerance) problems.push(`presenter element ${Math.round(presenter.screenShare.value * 100)} % exceeds his measured presence ${Math.round(onScreen * 100)} %`)
  }
  return problems
}

/** The channel's own universe, measured: its topics (titles), tone, structure, palette and fonts. */
export function channelUniverse(analyses: readonly VideoAnalysis[], synthesis?: Synthesis): ChannelUniverse {
  const constant = <T>(field: string): T | undefined => synthesis?.constants.find((c) => c.field === field)?.value as T | undefined
  return {
    topics: analyses.map((a) => a.title).filter(Boolean),
    tone: constant<string>('script.tone') ?? agreed(analyses.map((a) => a.script.tone))?.value ?? '',
    structure: constant<string[]>('script.outline') ?? agreed(analyses.map((a) => a.script.structure))?.value ?? analyses[0]?.script.structure ?? [],
    palette: constant<string[]>('motion.palette') ?? frequentItems(analyses.map((a) => a.motion.palette.map((c) => c.toUpperCase()))),
    fonts: constant<string[]>('motion.fonts') ?? frequentItems(analyses.map((a) => a.motion.fonts))
  }
}
