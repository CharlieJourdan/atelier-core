// « One generation, then cut » (docs/specs/pipeline-avatar.md §2.5 b, decision 0034): the presenter of a video is not made
// shot by shot. Every presenter shot's stretch of the voice, with a small handle on each side, is joined in order into as few
// audio files as the engine's longest generation allows, with a short silence between stretches; the engine makes the talking
// video once per file; each shot is then cut back out of it on its own times. The lips stay on the words because the audio
// is the same, and the cuts are the director's, which land on word boundaries (R21.2). Pure: no file, no call.
//   Joining: two shots whose gap costs less to generate than two handles and a silence are one stretch (two presenter shots
//   in a row are one shot to the engine); the voice runs under the cutaways, so a cut is never heard.
//   Calls: stretches are packed in order; a new call starts only when the next stretch would pass `maxCallS`.
//   Angles: each framing that is its own picture (an angle of the presenter) is its own series of calls; re-crops share one.
import type { Framing } from '../../shared/presenter-engines'

/** One presenter shot on the voice's clock (seconds), with the framing it is shown in. */
export interface PresenterShot {
  id: string
  startS: number
  endS: number
  /** Which picture of the presenter speaks it (`medium` = the portrait). */
  source?: Framing
}

export interface BatchOptions {
  /** Audio kept on each side of a stretch (ENGINE-SPEC §23: 0.2 s). */
  handleS: number
  /** Silence between two stretches in one call, so the mouth closes between them. */
  gapS: number
  /** The engine's longest generation, in seconds. */
  maxCallS: number
  /** The voice's length: handles never reach outside it. */
  voiceS: number
  /**
   * « Continuous » generation (production-10, the base of the cost ladder): two presenter shots with a cutaway of at most this
   * long between them are one stretch, so the presenter is also generated under the cutaway. 0 or absent: once, then cut.
   */
  bridgeS?: number
}

export const BATCH_DEFAULTS = { handleS: 0.2, gapS: 0.1 } as const
/**
 * The cutaways the « continuous » generation bridges (a presenter section with its short inserts). 9.5 s gives ≈ 24 s generated
 * per finished minute at a 26 % share on the 12-minute fixture film, Charlie's 23.9 s of 2026-10-31: to measure on real videos.
 */
export const CONTINUOUS_BRIDGE_S = 9.5

/** A run of the voice the engine speaks: one or more shots and their handles. */
export interface Stretch {
  shots: string[]
  /** On the voice's clock, handles included. */
  fromS: number
  toS: number
}

/** One generation: pieces of the voice laid end to end, a silence of `gapS` between two pieces. */
export interface CallPlan {
  source: Framing
  pieces: { stretch: number; fromS: number; toS: number; atS: number }[]
  /** The length of the call's audio (what the engine bills). */
  seconds: number
}

/** Where a shot is in the generated video: `offsetS` into call `call`, for the shot's own length. */
export interface Cut {
  shotId: string
  call: number
  offsetS: number
  durationS: number
}

export interface BatchPlan {
  stretches: Stretch[]
  calls: CallPlan[]
  cuts: Cut[]
  /** Seconds generated (Σ calls) and shown (Σ shots). */
  generatedS: number
  shownS: number
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000

/** The stretches of one picture's shots (sorted), joined when the gap is cheaper to generate than two handles and a silence. */
function stretchesOf(shots: readonly PresenterShot[], o: BatchOptions): { stretches: Stretch[]; owner: Map<string, number> } {
  const sorted = [...shots].sort((a, b) => a.startS - b.startS)
  const joinBelow = Math.max(2 * o.handleS + o.gapS, o.bridgeS ?? 0)
  const groups: PresenterShot[][] = []
  for (const s of sorted) {
    const last = groups[groups.length - 1]
    const head = last?.[0]
    const prev = last?.[last.length - 1]
    if (last && head && prev && s.startS - prev.endS <= joinBelow + 1e-9 && s.endS - head.startS + 2 * o.handleS <= o.maxCallS + 1e-9) last.push(s)
    else groups.push([s])
  }
  const stretches: Stretch[] = []
  const owner = new Map<string, number>()
  for (const g of groups) {
    const a = (g[0] as PresenterShot).startS
    const b = (g[g.length - 1] as PresenterShot).endS
    if (b - a > o.maxCallS + 1e-9) throw new Error(`a presenter shot of ${r3(b - a)} s is longer than the engine's longest generation (${o.maxCallS} s)`)
    // the handles shrink when the stretch would not fit in one call with them
    const h = Math.max(0, Math.min(o.handleS, (o.maxCallS - (b - a)) / 2))
    for (const s of g) owner.set(s.id, stretches.length)
    stretches.push({ shots: g.map((s) => s.id), fromS: r3(Math.max(0, a - h)), toS: r3(Math.min(o.voiceS, b + h)) })
  }
  return { stretches, owner }
}

/** The plan of one video's presenter: stretches, calls per picture, and where each shot is cut. */
export function planBatches(shots: readonly PresenterShot[], o: BatchOptions): BatchPlan {
  for (const s of shots) if (!(s.endS > s.startS)) throw new Error(`the presenter shot ${s.id} has no length`)
  const sources = [...new Set(shots.map((s) => s.source ?? 'medium'))]
  const stretches: Stretch[] = []
  const calls: CallPlan[] = []
  const cuts: Cut[] = []
  for (const source of sources) {
    const mine = shots.filter((s) => (s.source ?? 'medium') === source)
    const { stretches: own, owner } = stretchesOf(mine, o)
    const first = stretches.length
    stretches.push(...own)
    let call: CallPlan | undefined
    const placed = new Map<number, { call: number; atS: number }>()
    for (const [i, st] of own.entries()) {
      const len = st.toS - st.fromS
      if (!call || call.seconds + o.gapS + len > o.maxCallS + 1e-9) {
        call = { source, pieces: [], seconds: 0 }
        calls.push(call)
      }
      const atS = call.pieces.length === 0 ? 0 : r3(call.seconds + o.gapS)
      call.pieces.push({ stretch: first + i, fromS: st.fromS, toS: st.toS, atS })
      call.seconds = r3(atS + len)
      placed.set(i, { call: calls.length - 1, atS })
    }
    for (const s of mine) {
      const i = owner.get(s.id) as number
      const st = own[i] as Stretch
      const p = placed.get(i) as { call: number; atS: number }
      cuts.push({ shotId: s.id, call: p.call, offsetS: r3(p.atS + (s.startS - st.fromS)), durationS: r3(s.endS - s.startS) })
    }
  }
  const order = new Map(shots.map((s, i) => [s.id, i]))
  cuts.sort((a, b) => (order.get(a.shotId) as number) - (order.get(b.shotId) as number))
  return {
    stretches,
    calls,
    cuts,
    generatedS: r3(calls.reduce((n, c) => n + c.seconds, 0)),
    shownS: r3(shots.reduce((n, s) => n + (s.endS - s.startS), 0))
  }
}

/** The tightest re-crop of a generation (production-17): beyond 1.15× a 1080p presenter is a soft digital zoom. */
export const MAX_RECROP = 1.15
/** Re-crops of the one generation (option « recadrages »): how much of the frame each framing keeps, centred on the face
 *  (close = 1 / MAX_RECROP, medium half way). */
export const RECROP_ZOOM: Record<Framing, number> = { wide: 1, medium: 1 / 1.075, close: 1 / MAX_RECROP }

/**
 * The framing of each presenter shot. `single`: all the portrait. `recrops`: the one generation shown wide, medium or close,
 * two neighbours never alike, the opening wide. `multi`: the presenter's pictures (the portrait and its angles) in turn, two
 * neighbours never alike.
 */
export function framingsOf(count: number, mode: 'single' | 'recrops' | 'multi', pictures: readonly Framing[] = ['medium']): Framing[] {
  if (mode === 'single' || count === 0) return Array.from({ length: count }, () => 'medium')
  const cycle: readonly Framing[] = mode === 'recrops' ? ['wide', 'medium', 'close', 'medium'] : pictures.length > 0 ? pictures : ['medium']
  return Array.from({ length: count }, (_, i) => cycle[i % cycle.length] as Framing)
}
