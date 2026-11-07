// P4 starts from a ready base when one fits (Charlie, 2026-11-04; decision 0112): the base's measured style is the starting
// point, and EVERY one of its settings is checked against this channel's measurement:
//   - measured equal (within the field's measurement tolerance) → kept, with this channel's evidence;
//   - measured differently → replaced by the measured value (character, layouts, rhythm, motion, voice…);
//   - not measured here → dropped: the definition's own default stays (a base setting is never kept without proof).
// When the base's renders proved it (blind judge « same channel »), a kept setting holds the base's proven value; otherwise it
// holds the measurement. Improvements the base's own rounds earned are applied where this channel measures the same « before »
// (they need no new round to be found again). What the user says (presenter, voice, language, cost) never comes from a base.
// Pure; P4 calls `startFromBase` after writing the measured fields, P4's check calls `baseStartAccepts` / `baseStartProblems`.
import { isDeepStrictEqual } from 'node:util'
import { atPath, isSourced, withAtPath, type BaseStart, type Sourced, type StyleDefinition } from '../../../../shared/clone'
import type { ReadyBase } from './base-registry'
import { matchBase } from './base-match'

/** Measurement tolerance of a field: two measures closer than this are the same setting. */
export interface Tolerance { rel: number; abs: number }

const EXACT: Tolerance = { rel: 0, abs: 0 }
const SHARE: Tolerance = { rel: 0, abs: 0.03 }
/** Seconds, rates and counts measured on whole videos: 5 % (two videos of one channel differ by more). */
export const DEFAULT_TOLERANCE: Tolerance = { rel: 0.05, abs: 0 }

/** Per field (or field prefix): shares within 3 points, loudness within 1 LU, music bed within 2 dB, sync within 50 ms; counts
 *  exact. Strings, booleans, enums, identities and configurations are always compared exactly. */
export const TOLERANCES: readonly (readonly [string, Tolerance])[] = [
  ['sourcing.originShares', SHARE], ['sourcing.kindShares', SHARE], ['sourcing.foundStillsShare', SHARE],
  ['presenter.layoutCurve', SHARE], ['presenter.presenceByPart', SHARE], ['motion.coverageByPart', SHARE],
  ['script.parts', SHARE], ['script.illustratedShare', SHARE], ['script.promiseRepeatAt', SHARE], ['editing.cutTypes', SHARE],
  ['sound.loudnessLufs', { rel: 0, abs: 1 }], ['sound.musicLevelUnderVoiceDb', { rel: 0, abs: 2 }],
  ['editing.illustrationLeadS', { rel: 0, abs: 0.05 }], ['captions.syncOffsetS', { rel: 0, abs: 0.05 }],
  ['presenter.angleCount', EXACT], ['script.partCount', EXACT], ['presenter.configurations', EXACT], ['presenter.identity', EXACT]
]

export function toleranceOf(field: string): Tolerance {
  return TOLERANCES.find(([p]) => field === p || field.startsWith(`${p}.`))?.[1] ?? DEFAULT_TOLERANCE
}

/** Same setting within a tolerance: numbers within it, everything else (strings, booleans, keys, lengths) exactly. */
export function withinTolerance(a: unknown, b: unknown, tol: Tolerance): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= Math.max(tol.abs, tol.rel * Math.max(Math.abs(a), Math.abs(b))) + 1e-9
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => withinTolerance(x, b[i], tol))
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    return isDeepStrictEqual(ka, kb) && ka.every((k) => withinTolerance((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol))
  }
  return isDeepStrictEqual(a, b)
}

/** The note of every field a base contributed (the field's own `note`, never copied into another field's evidence), so P4's
 *  check can find a base value that slipped in without its record. */
export const baseNote = (id: string, what: string): string => `base ${id}: ${what}`
const fromBase = (f: Sourced): boolean => (f.note ?? '').startsWith('base ') || f.evidence.some((e) => (e.note ?? '').startsWith('base '))

/** Chosen per clone, never taken from a base: who presents and speaks (the user's clones or a look-alike of THIS channel's
 *  type), the language and the cost target. */
export const NEVER_FROM_BASE: readonly string[] = ['presenter.mode', 'presenter.presenterRef', 'presenter.placeholder', 'voice.mode', 'voice.voiceRef', 'voice.language', 'cost']
const under = (field: string, prefixes: readonly string[]): boolean => prefixes.some((p) => field === p || field.startsWith(`${p}.`))
export const neverFromBase = (field: string): boolean => under(field, NEVER_FROM_BASE)

/** What an earned improvement may change: how the channel is cut, paced, laid out and sounds — never who is on screen or
 *  speaks (identity, kind, timbre, descriptors), which only this channel's measurement decides. */
export const EARNABLE: readonly string[] = ['editing', 'script.wordsPerMinute', 'script.hookWindowS', 'script.illustratedShare', 'motion', 'sound', 'captions', 'sourcing', 'presenter.layoutCurve', 'presenter.presenceByPart', 'presenter.windowMeanS', 'presenter.talkSecondsPerMinute', 'voice.wordsPerMinute', 'voice.pausesPerMinute', 'voice.meanPauseS']
export const earnable = (field: string): boolean => under(field, EARNABLE) && !neverFromBase(field)

/** Starts P4's definition from a base (or records that none fits). `def` holds this channel's measured fields (P4 wrote them);
 *  the result is the definition to continue with and its record (also in `def.baseStart`). */
export function startFromBase(def: StyleDefinition, bases: readonly ReadyBase[]): { definition: StyleDefinition; record: BaseStart } {
  const { base, candidates } = matchBase(def, bases)
  const record: BaseStart = { from: base ? 'base' : 'zero', baseId: base?.id ?? null, pipelineId: base?.pipelineId ?? null, candidates, kept: [], replaced: [], earned: [], dropped: [], savings: { fieldsChecked: 0, fieldsProven: 0, roundsEarned: 0 } }
  if (!base) return { definition: { ...def, baseStart: record }, record }
  const proven = base.proof?.sameChannel === true
  let out = def
  for (const [field, b] of Object.entries(base.style)) {
    const here = atPath(def, field)
    record.savings.fieldsChecked++
    if (neverFromBase(field) || !isSourced(here) || here.source !== 'measured') { record.dropped.push(field); continue }
    if (!withinTolerance(b.value, here.value, toleranceOf(field))) { record.replaced.push({ field, base: b.value, measured: here.value }); continue }
    const value = proven ? b.value : here.value
    const note = proven ? `proven value ${JSON.stringify(b.value)} kept: measured ${JSON.stringify(here.value)} here, within tolerance` : 'measured equal here (the base is not render-proven: the measurement is kept)'
    out = withAtPath(out, field, { value, source: 'measured', evidence: here.evidence, note: baseNote(base.id, note) } satisfies Sourced)
    record.kept.push({ field, value, base: b.value, measured: here.value, proven })
    if (proven) record.savings.fieldsProven++
  }
  const rounds = new Set<number>()
  for (const c of base.earned) {
    const here = atPath(def, c.target)
    if (!earnable(c.target) || !isSourced(here) || here.source !== 'measured' || !withinTolerance(c.before, here.value, toleranceOf(c.target))) continue
    out = withAtPath(out, c.target, { value: c.after, source: 'measured', evidence: here.evidence, note: baseNote(base.id, `earned by its round ${c.round} (${c.sheet}): ${c.why}`) } satisfies Sourced)
    record.kept = record.kept.filter((k) => k.field !== c.target)
    record.replaced = record.replaced.filter((r) => r.field !== c.target)
    record.earned.push({ field: c.target, round: c.round, before: c.before, after: c.after, why: c.why, sheet: c.sheet })
    rounds.add(c.round)
  }
  record.savings.roundsEarned = rounds.size
  // each earned round is an improvement round the clone does not have to run again (the version counts improvement rounds)
  return { definition: { ...out, version: def.version + rounds.size, baseStart: record }, record }
}

/** True when a measured field may differ from this channel's measurement because the base start recorded it: a proven base value
 *  within the field's tolerance, or an earned change whose « before » is this measurement. Tolerances are the engine's, not the record's. */
export function baseStartAccepts(def: StyleDefinition, field: string, measured: unknown): boolean {
  const s = def.baseStart
  if (!s || s.from !== 'base') return false
  const now = atPath(def, field)
  if (!isSourced(now)) return false
  const tol = toleranceOf(field)
  const kept = s.kept.find((k) => k.field === field)
  if (kept && isDeepStrictEqual(now.value, kept.value) && withinTolerance(kept.value, measured, tol)) return true
  const earned = s.earned.find((e) => e.field === field)
  return !!earned && isDeepStrictEqual(now.value, earned.after) && withinTolerance(earned.before, measured, tol)
}

/** The rule « no base setting without measured proof »: every kept or earned field was measured on THIS channel (`measured` = the
 *  fields P4's check knows were measured), and no field carries a base's evidence without being in the record. */
export function baseStartProblems(def: StyleDefinition, measured: ReadonlySet<string>, bases: readonly ReadyBase[]): string[] {
  const s = def.baseStart
  const p: string[] = []
  if (!s) return p
  if (s.from === 'zero' && (s.kept.length || s.earned.length || s.replaced.length)) p.push('built from zero but the record keeps base settings')
  if (s.from === 'base' && !s.baseId) p.push('started from a base without naming it')
  const base = bases.find((b) => b.id === s.baseId)
  if (s.from === 'base' && s.baseId && !base) p.push(`started from base ${s.baseId}, which is not a ready base`)
  // an earned change is the base's own, verbatim (the record alone is no proof), and only of what may be earned
  for (const e of s.earned) {
    if (!earnable(e.field)) p.push(`${e.field} may not be changed by a base's earned improvement`)
    if (base && !base.earned.some((c) => c.target === e.field && c.round === e.round && isDeepStrictEqual(c.before, e.before) && isDeepStrictEqual(c.after, e.after))) p.push(`${e.field}: the earned improvement is not one base ${base.id} earned`)
  }
  for (const k of s.kept) if (neverFromBase(k.field)) p.push(`${k.field} is chosen per clone, never kept from a base`)
  const recorded = new Set([...s.kept.map((k) => k.field), ...s.earned.map((e) => e.field)])
  for (const f of recorded) if (!measured.has(f)) p.push(`${f} keeps the base's setting but this channel did not measure it: no proof it matches`)
  for (const k of s.kept) if (!withinTolerance(k.base, k.measured, toleranceOf(k.field))) p.push(`${k.field} keeps the base's setting although it was measured differently`)
  const walk = (node: unknown, path: string): void => {
    if (isSourced(node)) { if (fromBase(node) && !recorded.has(path)) p.push(`${path} carries a base's evidence without a kept or earned record`); return }
    if (node && typeof node === 'object' && !Array.isArray(node)) for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
  }
  for (const k of ['script', 'voice', 'presenter', 'motion', 'editing', 'sourcing', 'sound', 'captions', 'packaging', 'cost'] as const) walk(def[k], k)
  return p
}
