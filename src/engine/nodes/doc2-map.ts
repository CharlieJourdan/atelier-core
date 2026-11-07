// The map and camera grammar of `documentary@2` (director-motion, research note documentary-2-2026-11 (old repository) § Camera): how each kind of shot
// moves, measured with tracked points on three whole videos (≈ 1 050 shots). A map arrives with an eased move that settles at ≈ 55 % of
// the shot, then creeps; a route is followed as it draws; a region spreads over ≈ 1.5 s; several places are visited on their words. Pure.
import type { Motion } from '../formats/editplan'
import type { Map3dPropsInput } from '../formats/map3d'
import type { Doc2Profile } from './doc2-profile'
import type { Doc2Scene } from './doc2-scene'

const r3 = (x: number): number => Math.round(x * 1000) / 1000
const clip = (s: string | undefined, max: number): string | undefined => (s?.trim() ? s.trim().slice(0, max).trimEnd() : undefined)

/** Countries of one region shown together as it spreads; the regions a card may hold. */
const SPREAD_GROUP = 2
const MAX_REGIONS = 6

/** A region of three countries or more, split into groups that come one after the other (the reference's Axis fills over ≈ 1.5 s). */
export function spreadRegions(regions: NonNullable<Doc2Scene['map']>['regions'], atOf: (on: string | undefined) => number | undefined, spreadS: number): NonNullable<Map3dPropsInput['regions']> {
  const out: NonNullable<Map3dPropsInput['regions']> = []
  regions.forEach((r, i) => {
    const room = MAX_REGIONS - out.length - (regions.length - i - 1)
    const at = atOf(r.on)
    const groups = Math.max(1, Math.min(room, Math.ceil(r.countries.length / SPREAD_GROUP)))
    for (let g = 0; g < groups; g++) {
      const countries = r.countries.filter((_, k) => Math.floor((k * groups) / r.countries.length) === g)
      out.push({
        countries,
        tone: r.tone,
        // a shaded land always says whose it is (Charlie's second review: maps without a legend): its label, else its one country's name
        ...(g === 0 && (r.label ?? (r.countries.length === 1 ? r.countries[0] : undefined)) ? { label: clip(r.label ?? r.countries[0], 40) as string } : {}),
        ...(at !== undefined ? { atS: r3(at + (g * spreadS) / groups) } : g > 0 ? { atS: r3(0.8 + (g * spreadS) / groups) } : { atS: 0.8 })
      })
    }
  })
  return out
}

type Key = NonNullable<NonNullable<Map3dPropsInput['camera']>['keys']>[number]

/**
 * The camera of a map: a route is followed from its start while the view opens; two places or more said in a long shot are visited on
 * their words; else one eased move, large when the map arrives (the first of a part), smaller later, sometimes pulling back.
 */
export function mapCamera(m: NonNullable<Doc2Scene['map']>, o: { d: number; arrival: boolean; rnd: () => number; P: Doc2Profile; atOf: (on: string | undefined) => number | undefined }): Key[] {
  const C = o.P.camera
  const settle = r3(Math.max(1.2, o.d * C.mapSettleAt))
  const levels = o.arrival ? C.mapArrival : C.mapBody
  const wide = Math.max(2.5, m.zoom - levels)
  const route = m.routes[0]
  if (route && o.d >= 4.5) return creep([{ atS: 0, center: route.from, zoom: Math.min(9, m.zoom + levels / 2), pitch: C.mapPitch[1] }, { atS: settle, center: m.center, zoom: Math.max(2.5, m.zoom - levels / 2), pitch: C.mapPitch[1] }], o.d)
  const stops = m.pins.map((p) => ({ p, at: o.atOf(p.on ?? p.label) })).filter((x): x is typeof x & { at: number } => x.at !== undefined)
  if (stops.length >= 2 && o.d >= 7) {
    const keys: Key[] = [{ atS: 0, center: m.center, zoom: wide, pitch: C.mapPitch[0] }]
    for (const s of stops.slice(0, 3)) {
      const at = r3(Math.max(s.at - 0.3, (keys.at(-1) as Key).atS + 1.2))
      if (at < o.d - 1) keys.push({ atS: at, center: { lat: s.p.lat, lon: s.p.lon }, zoom: m.zoom, pitch: C.mapPitch[1] })
    }
    if (keys.length >= 2) return creep(keys, o.d)
  }
  const a: Key = { atS: 0, center: m.center, zoom: wide, pitch: C.mapPitch[0] }
  const b: Key = { atS: settle, center: m.center, zoom: m.zoom, pitch: C.mapPitch[1] }
  return creep(o.rnd() < C.mapOutShare ? [{ ...b, atS: 0 }, { ...a, atS: settle }] : [a, b], o.d)
}

/** After it settles the camera keeps creeping to the shot's end (qualite-montage: a map that stopped 3 s before its cut looked frozen). */
function creep(keys: Key[], d: number): Key[] {
  const last = keys.at(-1) as Key
  if (d - last.atS < 1) return keys
  const out = keys.at(-2) !== undefined && (keys.at(-2) as Key).zoom > last.zoom
  // (the card's last key may sit no later than 0.3 s before its end, formats/motion.ts: 0.35 against rounding)
  return [...keys, { ...last, atS: r3(d - 0.35), zoom: r3(Math.max(2.5, last.zoom + (out ? -0.12 : 0.12))) }]
}

/** The map card of a scene: its camera, its spreading regions, its routes drawn on their words, its fact boxes. */
export function map3dProps(m: NonNullable<Doc2Scene['map']>, o: { d: number; arrival: boolean; rnd: () => number; P: Doc2Profile; look: 'satellite' | 'parchment'; atOf: (on: string | undefined) => number | undefined }): Record<string, unknown> {
  const at = (on: string | undefined): { atS?: number } => {
    const t = o.atOf(on)
    return t !== undefined ? { atS: t } : {}
  }
  return {
    ...(m.kicker ? { kicker: clip(m.kicker, 40) } : {}),
    title: clip(m.title, 60),
    look: o.look,
    camera: { keys: mapCamera(m, o), ease: 'push' },
    regions: spreadRegions(m.regions, o.atOf, o.P.camera.mapSpreadS),
    pins: m.pins.map((x) => ({ lat: x.lat, lon: x.lon, label: clip(x.label, 40), ...at(x.on ?? x.label) })),
    routes: m.routes.map((r) => {
      const t = o.atOf(r.on) ?? Math.min(o.d - 1, 1.5)
      return { from: r.from, to: r.to, via: r.via, ...(r.label ? { label: clip(r.label, 40) } : {}), atS: t, drawS: r3(Math.max(0.8, Math.min(o.d - t - 0.5, o.P.camera.routeDrawS))) }
    }),
    facts: m.facts.map((f, i) => ({ text: clip(f.text.toUpperCase(), 30), atS: o.atOf(f.on) ?? Math.min(o.d - 0.8, 1.5 + i * 1.3) }))
  }
}

/** The camera of a full-frame still: one even zoom of the same amount whatever its length, sometimes out (never a pan). */
export function stillMove(P: Doc2Profile, rnd: () => number): Motion {
  const z = 1 + P.camera.stillZoom
  return rnd() < P.camera.stillOutShare ? { kind: 'pull', from: z, to: 1, ease: 'linear' } : { kind: 'push', from: 1, to: z, ease: 'linear' }
}

/** The slow even push under an archive film, in the old-TV frame or filling the frame. */
export const filmMove = (P: Doc2Profile, seconds: number): Motion => ({ kind: 'push', from: 1, to: r3(Math.min(1.2, 1 + P.camera.filmPerS * seconds)), ease: 'linear' })

/** The camera of a prints board: it holds, unless the layout's measured share gives it the soft zoom. */
export function boardMove(P: Doc2Profile, pattern: string, seconds: number, rnd: () => number): { move: 'still' | 'settle'; moveZoom?: number } {
  const C = P.camera
  const share = pattern === 'print-large' ? C.settleShare.large : pattern.startsWith('prints-') ? C.settleShare.several : C.settleShare.small
  // a board held longer than the profile allows settles whatever its layout's share (nothing held ~5 s with nothing moving)
  if (rnd() >= share && seconds <= C.holdMaxS) return { move: 'still' }
  return { move: 'settle', moveZoom: r3(Math.min(C.settleMax, Math.max(C.settleMin, C.settlePerS * seconds))) }
}
