// What the editing kit adds to a plan (motion-montage, docs/ENGINE-SPEC.md §21.11): cut-ins on stills held too long (the same picture,
// then a closer framing on its subject, cut on a word) and the numbers the voice says set as kinetic type on their word. Pure.
import type { EditKit } from '../formats/edit-kit'
import type { Motion, Shot } from '../formats/editplan'
import { MOTION_SECONDS } from '../formats/motion'
import { FPS, type Word } from '../formats/timing'
import { spokenNumbers, type SpokenNumber } from './numbers'

/** Kinds of base shot drawn from a still (they take a camera move, punch-ins and cut-ins). */
export const STILL_KINDS: readonly Shot['kind'][] = ['stock.photo', 'image.gen', 'hold']

/** The subject's box when the plan gives none: the upper middle of a picture, where a print's or a painting's subject usually is. */
export const DEFAULT_FOCUS = { x: 0.3, y: 0.15, w: 0.4, h: 0.55 } as const

/**
 * Consecutive base shots that show the same picture without a reason: the same item twice in a row reads as an editing error (Charlie,
 * showcase v2, 0:18–0:20). A `match` joins two framings of one picture on purpose; a cut-in the kit made itself is allowed.
 * In French (the lines go to the run's log); empty: nothing repeats.
 */
export function repeatedPictures(base: readonly Shot[], allowed: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = []
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1] as Shot
    const b = base[i] as Shot
    if (a.genItem === undefined || a.genItem !== b.genItem || b.transitionIn === 'match' || allowed.has(b.id)) continue
    const t = b.startFrame / FPS
    out.push(`le plan ${b.id} (${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}) montre la même image que le plan ${a.id}`)
  }
  return out
}

/** The closer framing of a cut-in: a push from `zoom` towards the subject, gliding. */
export function cutInMotion(zoom: number, seconds: number, speedPerS: number, focus: Motion['focus']): Motion {
  return { kind: 'push', from: zoom, to: Math.min(1.6, zoom + Math.max(0.03, speedPerS * seconds)), focus: focus ?? { ...DEFAULT_FOCUS }, ease: 'glide' }
}

/**
 * The base track with every still longer than `kit.camera.maxHoldS` cut in two on the word nearest its middle (each part at least 2 s):
 * the first part keeps the shot, the second is the same picture closer on its subject. Shots with a pan of their own are left alone.
 * Returns the new base shots in order and the ids of the cut-ins (their boundary stays a cut).
 */
export function cutIns(base: readonly Shot[], words: readonly Word[], kit: EditKit): { base: Shot[]; added: Set<string> } {
  const out: Shot[] = []
  const added = new Set<string>()
  const most = kit.camera.maxHoldS
  for (const s of base) {
    const seconds = (s.endFrame - s.startFrame) / FPS
    if (most === null || seconds <= most || !STILL_KINDS.includes(s.kind) || s.motion?.kind === 'pan' || s.layout === 'split') {
      out.push(s)
      continue
    }
    const a = s.startFrame / FPS + 2
    const b = s.endFrame / FPS - 2
    const mid = (s.startFrame + s.endFrame) / 2 / FPS
    const cut = words.filter((w) => w.start >= a && w.start <= b).sort((x, y) => Math.abs(x.start - mid) - Math.abs(y.start - mid))[0]
    if (!cut) {
      out.push(s)
      continue
    }
    const at = Math.round(cut.start * FPS)
    const first: Shot = { ...s, endFrame: at }
    const punches = s.punches?.filter((p) => p.atS * FPS < at - s.startFrame)
    if (punches) first.punches = punches
    const later = s.punches?.filter((p) => p.atS * FPS >= at - s.startFrame).map((p) => ({ ...p, atS: Math.round((p.atS - (at - s.startFrame) / FPS) * FPS) / FPS }))
    const second: Shot = {
      ...s,
      id: `${s.id}c`,
      startFrame: at,
      transitionIn: 'cut',
      motion: cutInMotion(kit.camera.cutInZoom, (s.endFrame - at) / FPS, kit.camera.speedPerS, s.motion?.focus),
      ...(later?.length ? { punches: later } : {})
    }
    if (!later?.length) delete second.punches
    delete second.transitionDir
    out.push(first, second)
    added.add(second.id)
  }
  return { base: out, added }
}

/** May a number be set over this card: its template is allowed and the card does not already show that figure (its value in its props)? */
function overCard(s: Shot, n: SpokenNumber, allowed: readonly string[]): boolean {
  const g = s.graphic as { template?: unknown; props?: unknown } | undefined
  if (s.kind !== 'motion' || typeof g?.template !== 'string' || !allowed.includes(g.template)) return false
  const shown = JSON.stringify(g.props ?? {})
  return !new RegExp(`(^|[^0-9.])${n.value}([^0-9]|$)`).test(shown)
}

/**
 * Kinetic overlays for the numbers the voice says (kit `numbers`): on their word, over a still (or a card the kit allows that does not
 * show that figure), never
 * over another overlay, at most `perMinute`, `minGapS` apart; each stays `holdS` after its phrase, inside its still.
 */
export function numberOverlays(o: { base: readonly Shot[]; overlays: readonly Shot[]; words: readonly Word[]; kit: EditKit; durationS: number; accent: string; theme: 'dark' | 'light' }): { shots: Shot[]; found: SpokenNumber[] } {
  const k = o.kit.numbers
  if (!k.show) return { shots: [], found: [] }
  const found = spokenNumbers(o.words, k.language).filter((n) => k.kinds.includes(n.kind))
  const most = Math.floor((k.perMinute * o.durationS) / 60)
  const shots: Shot[] = []
  const taken = o.overlays.map((s) => [s.startFrame, s.endFrame] as const)
  let last = -Infinity
  for (const n of found) {
    if (shots.length >= most || n.atS - last < k.minGapS) continue
    const fits = (s: Shot | undefined): s is Shot => s !== undefined && (STILL_KINDS.includes(s.kind) || overCard(s, n, k.overCards))
    const under = o.base.find((s) => n.atS * FPS >= s.startFrame && n.atS * FPS < s.endFrame)
    if (!fits(under)) continue
    // a number said at the end of a shot may run on over the next one when that one takes it too
    const next = o.base.find((s) => s.startFrame === under.endFrame)
    const limit = fits(next) ? next.endFrame : under.endFrame
    const start = Math.max(under.startFrame, Math.round((n.atS - 0.15) * FPS))
    const least = Math.ceil(MOTION_SECONDS.kinetic.min * FPS) + 1
    const end = Math.min(limit, Math.max(start + least, Math.round((n.endS + k.holdS) * FPS)))
    if (end - start < least || taken.some(([a, b]) => start < b && end > a)) continue
    const atS = Math.max(0, Math.round((n.atS * FPS - start)) / FPS)
    shots.push({
      id: `num${String(shots.length + 1).padStart(2, '0')}`,
      track: 'overlay',
      startFrame: start,
      endFrame: end,
      kind: 'motion',
      graphic: { template: 'kinetic', accent: o.accent, theme: o.theme, props: { style: k.style, position: k.position, background: k.background, case: 'as-is', words: [{ text: n.text, atS, emphasis: true }] } } as Shot['graphic'],
      transitionIn: 'cut',
      role: 'scene',
      beat: under.beat
    })
    taken.push([start, end])
    last = n.atS
  }
  return { shots, found }
}
