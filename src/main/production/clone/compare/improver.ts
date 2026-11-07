// P8 — find the CAUSE of each gap (spec §2 P8): for every compared curve that is off, either the Style Definition says
// something else than the reference measured (→ a `definition` change to the reference's value), or the definition is
// already right and the brick did not deliver it (→ a `rule`: an engine calibration of that brick, numeric fields; or a
// `brick` change recorded for the engine when it cannot be calibrated). Defects the curves cannot see (illustration,
// script, captions…) go to an optional model pass that may only propose definition fields. Pure, except `ask`.
import { StyleDefinition, atPath, isSourced, sourcedFields, withAtPath, type Change, type CompareAxis, type Evidence, type PipelinePlan, type Round, type Sourced } from '../../../../shared/clone'
import { calibrationTarget, factorOf, type Calibration } from './calibration'
import type { Curve } from './curves'
import type { AskFn } from './judge'
import { SETTING_MAP } from '../plan-rules'

/** The definition fields some brick setting reads (SETTING_MAP): changing any other field cannot change a render (moteur-briques:
 *  the 2026-11-04 proofs changed `sourcing.*`, `captions.style`, `motion.densityByPart` for nothing). */
export const BRICK_READ_FIELDS: ReadonlySet<string> = new Set(SETTING_MAP.flatMap((r) => r.fields))
export const readByBrick = (field: string): boolean => BRICK_READ_FIELDS.has(field)

/** The note of a definition value the improver proposed without a measurement (saved `user`, never `measured`). */
export const IMPROVER_NOTE = 'proposed by the improver after round'
/** A value the user chose (never changed by a round); a value the improver proposed earlier stays open to the next rounds. */
export const userChose = (f: Sourced): boolean => f.source === 'user' && !(f.note ?? '').startsWith(IMPROVER_NOTE)
/** Marks a brick change: what the engine brick must learn to deliver; nothing in the clone applies it. */
export const BRICK_TO_FIX = 'brick to fix (not applied):'

/** Distance above which a curve is a gap to fix. */
export const GAP: Record<string, number> = { 'shot-length': 0.2, 'shot-curve': 0.2, 'layout-share': 0.15, presence: 0.12, 'motion-density': 0.25, palette: 0.12, pace: 0.06, loudness: 0.2 }
/** Relative tolerance under which the definition already « says » the reference value. */
const SAME = 0.05

/** Which brick delivers a definition field when the plan does not say (engine node types). */
export const FIELD_BRICK: Record<string, string> = {
  'voice.wordsPerMinute': 'voice.tts', 'script.wordsPerMinute': 'script.write', 'editing.meanShotS': 'director', 'editing.hookMeanShotS': 'director',
  'sound.loudnessLufs': 'render.assemble', 'motion.palette': 'motion.render', 'presenter.presenceByPart': 'director',
  'presenter.layoutCurve': 'director', 'motion.densityByPart': 'director'
}

/** The plan brick that reads a field (a setting citing it, matched to a brick by node prefix), else FIELD_BRICK. */
export function brickFor(plan: PipelinePlan | null, field: string): string {
  const setting = plan?.settings.find((s) => s.fields.includes(field))
  const node = setting && plan?.bricks.find((b) => setting.key === b.node || setting.key.startsWith(`${b.node}.`) || setting.key.startsWith(`${b.node.split('@')[0]}.`))?.node
  return node ?? FIELD_BRICK[field] ?? 'unknown'
}

const r2 = (x: number): number => Math.round(x * 100) / 100
const relOff = (a: number, b: number): number => (Math.max(Math.abs(a), Math.abs(b)) === 0 ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)))
const meanOf = (xs: readonly number[]): number => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0)

interface Want { field: string; value: unknown; numeric?: { ref: number; ours: number } }

/** What the reference measured, as definition values, for one off curve. */
function wanted(c: Curve, def: StyleDefinition): Want[] {
  const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
  switch (c.name) {
    case 'shot-curve': {
      if (c.ours.length === 0) return []
      const ref = meanOf(c.reference.filter((x) => x > 0))
      const ours = meanOf(c.ours.filter((x) => x > 0))
      const out: Want[] = [{ field: 'editing.meanShotS', value: r2(ref), numeric: { ref, ours } }]
      if ((c.reference[0] ?? 0) > 0 && (c.ours[0] ?? 0) > 0) out.push({ field: 'editing.hookMeanShotS', value: r2(c.reference[0]!), numeric: { ref: c.reference[0]!, ours: c.ours[0]! } })
      return out
    }
    case 'pace':
      if (c.ours.length === 0) return []
      return [
        { field: 'voice.wordsPerMinute', value: Math.round(c.reference[0]!), numeric: { ref: c.reference[0]!, ours: c.ours[0]! } },
        { field: 'script.wordsPerMinute', value: Math.round(c.reference[0]!) }
      ]
    case 'loudness':
      if (c.ours.length === 0) return []
      return [{ field: 'sound.loudnessLufs', value: r2(c.reference[0]!), numeric: { ref: c.reference[0]!, ours: c.ours[0]! } }]
    case 'palette': {
      const cols: string[] = []
      for (let i = 0; i + 3 < c.reference.length + 1; i += 4) cols.push(hex(c.reference[i]!, c.reference[i + 1]!, c.reference[i + 2]!))
      return cols.length ? [{ field: 'motion.palette', value: cols }] : []
    }
    case 'presence': {
      const labels = c.labels ?? []
      const keep = def.presenter.presenceByPart.value.filter((p) => !labels.includes(p.part))
      return labels.length ? [{ field: 'presenter.presenceByPart', value: [...keep, ...labels.map((part, k) => ({ part, share: r2(c.reference[k] ?? 0) }))] }] : []
    }
    case 'motion-density': {
      const labels = c.labels ?? []
      const keep = def.motion.densityByPart.value.filter((p) => !labels.includes(p.part))
      return labels.length ? [{ field: 'motion.densityByPart', value: [...keep, ...labels.map((part, k) => ({ part, perMinute: r2(c.reference[k] ?? 0) }))] }] : []
    }
    case 'layout-share': {
      const labels = c.labels ?? []
      const byPart = new Map<string, Record<string, number>>()
      labels.forEach((l, k) => {
        const [part, layout] = l.split(':')
        if (!part || !layout) return
        const m = byPart.get(part) ?? {}
        if ((c.reference[k] ?? 0) > 0) m[layout] = r2(c.reference[k]!)
        byPart.set(part, m)
      })
      const keep = def.presenter.layoutCurve.value.filter((p) => !byPart.has(p.part))
      return byPart.size ? [{ field: 'presenter.layoutCurve', value: [...keep, ...[...byPart].map(([part, shares]) => ({ part, shares }))] }] : []
    }
    default:
      return []
  }
}

/** True when the definition's current value already says the wanted one. */
function alreadySays(current: unknown, want: unknown): boolean {
  if (typeof current === 'number' && typeof want === 'number') return relOff(current, want) <= SAME
  return JSON.stringify(current) === JSON.stringify(want)
}

/** The judge wrote about anonymous items (A, B…); after judging, the saved key turns them back into « the reference » and
 *  « ours », so whoever fixes the cause knows which side to move (pure). */
export function unblind(text: string, key: Readonly<Record<string, 'reference' | 'ours'>>): string {
  const labels = Object.keys(key).filter((k) => /^[A-Z]$/.test(k))
  if (labels.length === 0) return text
  return text.replace(new RegExp(`\\b(${labels.join('|')})\\b`, 'g'), (l) => (key[l] === 'reference' ? 'the reference' : 'ours'))
}

/** The defects of an axis in the round (judge + review), as the strings a change says it fixes. */
export function axisDefects(round: Round, axis: CompareAxis): string[] {
  const c = round.comparison
  if (!c) return []
  return [
    ...c.verdict.scores.filter((s) => s.axis === axis).flatMap((s) => s.defects.map((d) => `${axis}: ${unblind(d, c.blindKey)}`)),
    ...c.defects.filter((d) => d.axis === axis).map((d) => `${axis}: ${d.description}`)
  ]
}

/** Changes from the compared curves (pure). */
export function curveChanges(round: Round, def: StyleDefinition, plan: PipelinePlan | null, calibration: Calibration): Change[] {
  const c = round.comparison
  if (!c) return []
  const out: Change[] = []
  const seen = new Set<string>()
  const p = (round.production as Round['production'] | undefined)?.passage
  for (const curve of c.curves) {
    if (curve.distance <= (GAP[curve.name] ?? 0.2)) continue
    const gap = `${curve.name} off by ${curve.distance} (${curve.note ?? 'measured'})`
    // the reference passage this curve was measured on, with its matched frames: what makes the new value a measurement
    const evidence: Evidence[] | undefined = p ? [{ video: p.videoId, fromS: p.fromS, toS: p.toS, frames: (c.pairs ?? []).slice(0, 3).map((x) => x.reference), note: `${curve.name} measured on the reference passage (${c.sheet})` }] : undefined
    for (const w of wanted(curve, def)) {
      if (seen.has(w.field)) continue
      const field = atPath(def, w.field)
      if (!isSourced(field) || userChose(field)) continue
      seen.add(w.field)
      const fixes = [gap, ...axisDefects(round, curve.axis)]
      if (!alreadySays(field.value, w.value) && !readByBrick(w.field)) {
        // no brick reads it: a definition change would re-render the same film; the engine must learn to read it
        const brick = brickFor(plan, w.field)
        out.push({ cause: 'brick', target: brick, before: null, after: w.value, why: `${BRICK_TO_FIX} no brick reads ${w.field} yet (the reference measures ${JSON.stringify(w.value)}): changing the definition would not change the render; ${brick} must honour the field`, fixes })
        continue
      }
      if (!alreadySays(field.value, w.value)) {
        out.push({ cause: 'definition', target: w.field, before: field.value, after: w.value, why: `the reference passage measures ${JSON.stringify(w.value)}, the definition said ${JSON.stringify(field.value)}`, fixes, ...(evidence ? { evidence } : {}) })
        continue
      }
      // the brick already delivers this field within tolerance: the gap of the curve lies elsewhere
      if (w.numeric && relOff(w.numeric.ref, w.numeric.ours) <= SAME) continue
      const brick = brickFor(plan, w.field)
      // a calibration reaches the render only through a plan setting reading the field (runner.ts calibrate)
      if (w.numeric && w.numeric.ours > 0 && readByBrick(w.field)) {
        const before = factorOf(calibration, brick, w.field)
        // ask the brick for ref/ours of what it was asked: a slow voice is asked faster, long shots are asked shorter
        const after = Math.round(before * (w.numeric.ref / w.numeric.ours) * 1000) / 1000
        out.push({ cause: 'rule', target: calibrationTarget(brick, w.field), before, after, why: `the definition already says ${JSON.stringify(w.value)} but ${brick} delivered ${r2(w.numeric.ours)}: calibrate the brick`, fixes })
      } else {
        out.push({ cause: 'brick', target: brick, before: null, after: w.value, why: `${BRICK_TO_FIX} the definition already says ${JSON.stringify(w.value)} for ${w.field} but ${brick} does not deliver it (no plan setting can carry more than the definition already says): the engine brick must honour the field`, fixes })
      }
    }
  }
  return out
}

/** Axes the curves do not measure: only a model reading the defects can point at a definition field for them. */
export const MODEL_AXES: readonly CompareAxis[] = ['illustration', 'script', 'captions', 'identity', 'motion', 'palette', 'layout']

/** The model pass's prompt (pure): low axes with their defects, and the definition's fields it may change. */
export function fixPrompt(round: Round, def: StyleDefinition, axes: readonly CompareAxis[]): string {
  // only the fields a brick reads: a change to any other one renders the same film
  const fields = sourcedFields(def).filter((f) => !userChose(f.field) && readByBrick(f.path) && axes.some((a) => f.path.startsWith(SECTION_OF[a])))
  return [
    'A video style is described by the fields below. A render made from them was compared with the reference; these differences were seen:',
    ...axes.flatMap((a) => axisDefects(round, a)).map((d) => `- ${d}`),
    '',
    'Fields you may change (path = current value):',
    ...fields.map((f) => `- ${f.path} = ${JSON.stringify(f.field.value).slice(0, 300)}`),
    '',
    'Propose the smallest changes to these fields that remove the CAUSE of the differences. Answer ONLY JSON: {"changes":[{"target":"<path>","after":<value of the same type>,"why":"…","fixes":["<difference>"]}]}'
  ].join('\n')
}

const SECTION_OF: Record<CompareAxis, string> = {
  identity: 'presenter.', layout: 'presenter.', cadence: 'editing.', illustration: 'sourcing.', motion: 'motion.', palette: 'motion.',
  voice: 'voice.', sound: 'sound.', script: 'script.', captions: 'captions.'
}

/** The model's proposals, kept only when they target an existing non-user definition field a brick reads, with a value of the
 *  same shape. */
export function parseFixes(text: string, def: StyleDefinition): Change[] {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return []
  let raw: unknown
  try { raw = JSON.parse(text.slice(s, e + 1)) } catch { return [] }
  const list = (raw as { changes?: unknown }).changes
  if (!Array.isArray(list)) return []
  const out: Change[] = []
  for (const x of list as { target?: unknown; after?: unknown; why?: unknown; fixes?: unknown }[]) {
    if (typeof x.target !== 'string' || typeof x.why !== 'string' || !Array.isArray(x.fixes) || x.fixes.length === 0) continue
    const f = atPath(def, x.target)
    if (!isSourced(f) || userChose(f) || x.after === undefined || !readByBrick(x.target)) continue
    if (typeof f.value !== typeof x.after || Array.isArray(f.value) !== Array.isArray(x.after)) continue
    if (JSON.stringify(f.value) === JSON.stringify(x.after)) continue
    // the new value must keep the definition valid (a list of strings stays a list of strings)
    if (!StyleDefinition.safeParse(withAtPath(def, x.target, { ...f, value: x.after })).success) continue
    out.push({ cause: 'definition', target: x.target, before: f.value, after: x.after, why: x.why, fixes: x.fixes.filter((d): d is string => typeof d === 'string') })
  }
  return out
}

/** Score under which an axis without a curve fix goes to the model pass. */
export const LOW_SCORE = 80

export interface ImproverDeps {
  plan(): PipelinePlan | null
  calibration(): Calibration
  /** Optional model pass for the axes curves do not measure. */
  ask?: AskFn
  onSpend?(s: { usd: number; seconds: number; what: string }): void
}

/** The real improver (`CloneServices['improver']`). */
export function causeImprover(d: ImproverDeps): { propose(round: Round, def: StyleDefinition): Promise<Change[]> } {
  return {
    async propose(round, def) {
      const changes = curveChanges(round, def, d.plan(), d.calibration())
      const covered = new Set(changes.flatMap((c) => c.fixes.map((f) => f.split(':')[0])))
      const low = (round.comparison?.verdict.scores ?? []).filter((s) => s.score < LOW_SCORE && MODEL_AXES.includes(s.axis) && !covered.has(s.axis)).map((s) => s.axis)
      if (d.ask && low.length) {
        const r = await d.ask({ prompt: fixPrompt(round, def, low), images: [] })
        d.onSpend?.({ usd: r.costUsd, seconds: 0, what: `improver round ${round.n}` })
        const taken = new Set(changes.map((c) => c.target))
        for (const c of parseFixes(r.text, def)) if (!taken.has(c.target)) changes.push(c)
      }
      return changes
    }
  }
}

