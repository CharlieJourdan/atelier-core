// Which ready base fits this channel (base-registry.ts), with a score and why. The match reads the channel's MEASURED style
// (the fields P4 measured on the whole-video analyses) and each base's measured style, and compares what decides the kind
// of channel: a presenter or not, where the pictures come from, how much the presenter is on screen, the cutting pace, the
// music. A channel made mostly of drawn or 3D pictures, or a presenter channel against a base without one (or the reverse),
// never fits: it is built from zero. Pure.
import { atPath, isSourced, type MediaOrigin, type StyleDefinition } from '../../../../shared/clone'
import type { ReadyBase } from './base-registry'

/** Below this score no base fits: the pipeline is built from zero. */
export const BASE_FIT_MIN = 0.6
/** The pictures must come from much the same places: below this origin similarity no base fits, whatever the rest. */
export const ORIGINS_MIN = 0.5
/** A channel with this much drawn or 3D screen is another kind of channel than a base without it. */
export const MADE_GATE = 0.3

/** What decides the kind of channel, read from measured values only. */
export interface Signature {
  presenter: boolean | null
  origins: Partial<Record<MediaOrigin, number>> | null
  /** Share of the runtime with the presenter on screen. */
  presence: number | null
  meanShotS: number | null
  music: boolean | null
}

export interface BaseCandidate { id: string; score: number; fits: boolean; why: string[] }

type Read = (path: string) => unknown

/** A definition's measured values (a field marked `default` or `user` was not measured: it says nothing about the channel). */
export const measuredOf = (def: StyleDefinition): Read => (path) => {
  const f = atPath(def, path)
  return isSourced(f) && f.source === 'measured' ? f.value : undefined
}

/** A base's measured values. */
export const styleOf = (base: ReadyBase): Read => (path) => base.style[path]?.value

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

export function signatureOf(read: Read): Signature {
  const kind = read('presenter.kind')
  const talk = num(read('presenter.talkSecondsPerMinute'))
  const music = read('sound.music')
  return {
    presenter: kind === undefined ? null : kind !== 'none',
    origins: (read('sourcing.originShares') as Signature['origins'] | undefined) ?? null,
    presence: talk === null ? null : Math.min(1, talk / 60),
    meanShotS: num(read('editing.meanShotS')),
    music: typeof music === 'boolean' ? music : null
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100
const pct = (n: number): string => `${Math.round(n * 100)} %`

/** 1 − half the L1 distance of two share vectors (1 = same mix of origins). */
export function originSimilarity(a: Partial<Record<MediaOrigin, number>>, b: Partial<Record<MediaOrigin, number>>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<MediaOrigin>
  let d = 0
  for (const k of keys) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0))
  return Math.max(0, 1 - d / 2)
}

const madeShare = (o: Partial<Record<MediaOrigin, number>> | null): number => (o ? (o.drawn ?? 0) + (o['3d'] ?? 0) : 0)

/** How well one base fits a channel's signature: weighted origins 0.45, presence 0.2, pace 0.2, music 0.15; gates first. */
export function scoreBase(channel: Signature, base: ReadyBase): BaseCandidate {
  const b = signatureOf(styleOf(base))
  const why: string[] = []
  const no = (reason: string): BaseCandidate => ({ id: base.id, score: 0, fits: false, why: [reason] })
  if (channel.presenter === null || channel.origins === null) return no('the analysis did not measure the presenter or the origins of the pictures: nothing to compare')
  if (channel.presenter !== b.presenter) return no(channel.presenter ? 'the channel has a presenter, the base has none' : `the channel has no presenter, the base (${base.goodFor}) is built around one`)
  if (madeShare(channel.origins) >= MADE_GATE && madeShare(b.origins) < MADE_GATE) return no(`${pct(madeShare(channel.origins))} of the screen is drawn or 3D: a kind of channel the base does not make`)
  const origins = b.origins ? originSimilarity(channel.origins, b.origins) : 0
  why.push(`origins of the pictures ${pct(origins)} alike`)
  const presence = channel.presence !== null && b.presence !== null ? 1 - Math.abs(channel.presence - b.presence) : 0.5
  why.push(channel.presence !== null && b.presence !== null ? `presenter on screen ${pct(channel.presence)} vs ${pct(b.presence)}` : 'presenter time not measured on both')
  const pace = channel.meanShotS && b.meanShotS ? Math.min(channel.meanShotS, b.meanShotS) / Math.max(channel.meanShotS, b.meanShotS) : 0.5
  why.push(channel.meanShotS && b.meanShotS ? `mean shot ${channel.meanShotS} s vs ${b.meanShotS} s` : 'pace not measured on both')
  const music = channel.music === null || b.music === null ? 0.5 : channel.music === b.music ? 1 : 0.5
  why.push(channel.music === null || b.music === null ? 'music not measured on both' : channel.music === b.music ? 'same music use' : 'music differs')
  const score = r2(0.45 * origins + 0.2 * presence + 0.2 * pace + 0.15 * music)
  if (origins < ORIGINS_MIN) why.push(`the pictures come from elsewhere (origins under ${pct(ORIGINS_MIN)} alike)`)
  return { id: base.id, score, fits: score >= BASE_FIT_MIN && origins >= ORIGINS_MIN, why }
}

/** Every base scored (best first) and the one to start from, or null (build from zero). */
export function matchBase(def: StyleDefinition, bases: readonly ReadyBase[]): { base: ReadyBase | null; candidates: BaseCandidate[] } {
  const channel = signatureOf(measuredOf(def))
  const candidates = bases.map((b) => scoreBase(channel, b)).sort((x, y) => y.score - x.score)
  const best = candidates.find((c) => c.fits)
  return { base: best ? bases.find((b) => b.id === best.id)! : null, candidates }
}
