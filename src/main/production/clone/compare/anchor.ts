// The improver stays anchored to the measurements (moteur-briques, after the POV gate of 2026-11-04 pushed the measured
// first-person share from 0.048 to 0.35): a definition change to a field the corpus measures (a number, or a record of
// shares) is kept within that field's spread over the corpus videos (min to max of each video measured alone, widened by the
// synthesis's own measurement tolerance: values that close are « the same » for the synthesis). A value
// outside is brought back to the nearest bound; a change that then moves nothing is dropped. Only a new analysis can move
// a measured field further. Fields the corpus does not measure (texts, the improver's own wording fields) pass unchanged. Pure.
import type { Change, VideoAnalysis } from '../../../../shared/clone'
import { EXTRACTORS, NUMBER_TOLERANCE } from '../analysis/synthesis'
import { deriveFields } from '../definition/derive'

export interface Spread { min: number; max: number }
/** A number field's spread, or a record field's spread per key. */
export type FieldSpread = { kind: 'number'; spread: Spread } | { kind: 'record'; keys: Map<string, Spread> }

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNumRecord = (v: unknown): v is Record<string, number> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).length > 0 && Object.values(v).every(isNum)
const valueOf = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? (v as { value: unknown }).value : v)
const widen = (s: Spread | undefined, n: number): Spread => (s ? { min: Math.min(s.min, n), max: Math.max(s.max, n) } : { min: n, max: n })

/** Per definition field, what each corpus video measures alone (the synthesis's readers and the derived fields). */
export function corpusSpread(analyses: readonly VideoAnalysis[]): Map<string, FieldSpread> {
  const perVideo = new Map<string, unknown[]>()
  const add = (field: string, v: unknown): void => { if (v !== undefined && v !== null) perVideo.set(field, [...(perVideo.get(field) ?? []), v]) }
  for (const a of analyses) {
    for (const x of EXTRACTORS) { try { add(x.field, x.read(a)) } catch { /* this video cannot read it */ } }
    for (const d of deriveFields([a])) add(d.field, valueOf(d.value))
  }
  const out = new Map<string, FieldSpread>()
  for (const [field, values] of perVideo) {
    if (values.length < analyses.length) continue // a field some video cannot measure has no spread to hold to
    if (values.every(isNum)) out.set(field, { kind: 'number', spread: margin(values.reduce<Spread | undefined>((s, n) => widen(s, n), undefined)!, 0) })
    else if (values.every(isNumRecord)) {
      const keys = new Map<string, Spread>()
      const all = new Set(values.flatMap((r) => Object.keys(r)))
      for (const k of all) for (const r of values) keys.set(k, widen(keys.get(k), r[k] ?? 0))
      out.set(field, { kind: 'record', keys: new Map([...keys].map(([k, b]) => [k, margin(b, MIN_SHARE_MARGIN)])) })
    }
  }
  return out
}

/** The smallest margin a share keeps around what was measured (a 0 share measured on a short corpus is not « never »). */
export const MIN_SHARE_MARGIN = 0.02
/** A spread widened by the measurement tolerance (relative), at least `floor` on each side. */
const margin = (s: Spread, floor: number): Spread => ({
  min: Math.max(s.min >= 0 ? 0 : -Infinity, r3(s.min - Math.max(floor, Math.abs(s.min) * NUMBER_TOLERANCE))),
  max: r3(s.max + Math.max(floor, Math.abs(s.max) * NUMBER_TOLERANCE))
})

/**
 * A definition value as the flat record the corpus spread is keyed by, and the way back: a record of numbers as is; a per-part
 * curve (`[{part, share}]`, `[{part, perMinute}]`) keyed by part; a per-part layout curve (`[{part, shares: {…}}]`) keyed
 * `part.layout` (the synthesis's own keys). Null for anything else.
 */
function asRecord(v: unknown): { record: Record<string, number>; back(r: Record<string, number>): unknown } | null {
  if (isNumRecord(v)) return { record: v, back: (r) => r }
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => x && typeof x === 'object' && typeof (x as { part?: unknown }).part === 'string')) return null
  const items = v as ({ part: string } & Record<string, unknown>)[]
  const field = (['share', 'perMinute'] as const).find((f) => items.every((x) => isNum(x[f])))
  if (field) return { record: Object.fromEntries(items.map((x) => [x.part, x[field] as number])), back: (r) => items.map((x) => ({ ...x, [field]: r[x.part] })) }
  if (items.every((x) => isNumRecord(x.shares) || (x.shares && typeof x.shares === 'object' && Object.keys(x.shares).length === 0))) {
    const record = Object.fromEntries(items.flatMap((x) => Object.entries(x.shares as Record<string, number>).map(([k, n]) => [`${x.part}.${k}`, n])))
    return { record, back: (r) => items.map((x) => ({ ...x, shares: Object.fromEntries(Object.keys(x.shares as Record<string, number>).map((k) => [k, r[`${x.part}.${k}`]])) })) }
  }
  return null
}

const clamp = (n: number, s: Spread): number => Math.min(s.max, Math.max(s.min, n))

/** The changes with every measured field held within its corpus spread; `held` says what was brought back (pure). */
export function anchorChanges(changes: readonly Change[], spread: ReadonlyMap<string, FieldSpread>): { changes: Change[]; held: string[] } {
  const out: Change[] = []
  const held: string[] = []
  for (const c of changes) {
    const s = c.cause === 'definition' ? spread.get(c.target) : undefined
    if (!s) { out.push(c); continue }
    let after: unknown = c.after
    let bounds = ''
    if (s.kind === 'number' && isNum(c.after)) {
      after = r3(clamp(c.after, s.spread))
      bounds = `${s.spread.min}–${s.spread.max}`
    } else if (s.kind === 'record') {
      const flat = asRecord(c.after)
      if (flat) {
        // a key no corpus video measured (a share the reference never shows) is held near nothing, never invented
        const held = Object.fromEntries(Object.entries(flat.record).map(([k, n]) => [k, r3(clamp(n, s.keys.get(k) ?? { min: 0, max: MIN_SHARE_MARGIN }))]))
        after = flat.back(held)
        bounds = [...s.keys].map(([k, b]) => `${k} ${r3(b.min)}–${r3(b.max)}`).join(', ')
      }
    }
    if (JSON.stringify(after) === JSON.stringify(c.after)) { out.push(c); continue }
    held.push(`${c.target}: ${JSON.stringify(c.after)} → ${JSON.stringify(after)} (measured over the corpus: ${bounds})`)
    if (JSON.stringify(after) === JSON.stringify(c.before)) continue
    out.push({ ...c, after, why: `${c.why} (held within the corpus's measured spread ${bounds})` })
  }
  return { changes: out, held }
}
