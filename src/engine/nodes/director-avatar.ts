// The presenter in the edit plan (docs/ENGINE-SPEC.md §21.1, §21.2 step 5): which stretches of the film a talking avatar
// speaks (by default the hook and the outro, so the cost stays low, research note BUSINESS-INFRA (old repository) §3.2), as shots and as
// items of the generation list that `avatar.speak` fulfils. Two layouts:
//   - `full`: the avatar IS the base shot; it takes the place of the base shots it covers (the span is cut on the base track's own
//     cuts, so the join stays a copy) and their items leave the list;
//   - `pip`: a small picture over the base shot, on the overlay track; the base track is untouched.
// Pure: same inputs, same shots. The budget pass (`dropAvatar`) can give an avatar back as plain footage, voice over stock.
import { FPS, type Aspect } from '../formats/timing'
import type { GenItem, Shot } from '../formats/editplan'

export type AvatarLayout = 'full' | 'pip'
export interface AvatarPlacement {
  segments: readonly ('hook' | 'outro')[]
  layout: AvatarLayout
  hookS: number
  outroS: number
  creditsPerSecond: number
}

/** One avatar clip is at most this long (§21.1: 4–20 s); a span that would be longer is not placed. */
export const AVATAR_MAX_S = 20
/** The presenter speaks at most this share of the film, hook and outro together (they must not swallow it). */
const AVATAR_MAX_SHARE = 0.5

const idOf = (name: string): string => `avatar-${name}`

interface Span {
  name: 'hook' | 'outro'
  /** Indexes of the base shots covered (first..last, inclusive). */
  first: number
  last: number
  startFrame: number
  endFrame: number
}

/** The base shots whose cuts bound a span closest to the wanted one: `[0, want]` for the hook, `[D - want, D]` for the outro. */
function spanFor(name: Span['name'], base: readonly Shot[], want: number, frames: number, notBefore: number, maxFrames: number): Span | null {
  const longest = Math.min(AVATAR_MAX_S * FPS, maxFrames)
  const wantFrames = Math.round(want * FPS)
  if (name === 'hook') {
    let best = -1
    for (const [i, s] of base.entries()) {
      if (s.endFrame > longest) break
      if (best < 0 || Math.abs(s.endFrame - wantFrames) < Math.abs((base[best] as Shot).endFrame - wantFrames)) best = i
    }
    return best < 0 ? null : { name, first: 0, last: best, startFrame: 0, endFrame: (base[best] as Shot).endFrame }
  }
  let best = -1
  for (const [i, s] of base.entries()) {
    if (s.startFrame < notBefore) continue
    if (frames - s.startFrame > longest) continue
    if (best < 0 || Math.abs(frames - s.startFrame - wantFrames) < Math.abs(frames - (base[best] as Shot).startFrame - wantFrames)) best = i
  }
  return best < 0 ? null : { name, first: best, last: base.length - 1, startFrame: (base[best] as Shot).startFrame, endFrame: frames }
}

/**
 * Puts the presenter in the plan. `shots` and `items` are edited in place (shots stay in time order, items in the order of
 * their shots). Returns the diagnostics lines. Nothing happens when the film is too short for a span or `cfg` asks for none.
 */
export function placeAvatar(
  shots: Shot[],
  items: GenItem[],
  cfg: AvatarPlacement,
  o: { frames: number; aspect: Aspect; /** What the narration says over a stretch of frames: its text and key terms. */ describe: (startFrame: number, endFrame: number) => { text: string; terms: string[] } }
): string[] {
  const diag: string[] = []
  const base = shots.filter((s) => s.track === 'base')
  const spans: Span[] = []
  // together the two stretches take at most half of the film
  const room = Math.floor(o.frames * AVATAR_MAX_SHARE)
  if (cfg.segments.includes('hook')) {
    const s = spanFor('hook', base, cfg.hookS, o.frames, 0, room)
    if (s) spans.push(s)
    else diag.push('avatar: no hook span fits the first shots')
  }
  if (cfg.segments.includes('outro')) {
    // after the hook, with at least two seconds of film between them
    const s = spanFor('outro', base, cfg.outroS, o.frames, (spans[0]?.endFrame ?? 0) + 2 * FPS, room - (spans[0] ? spans[0].endFrame - spans[0].startFrame : 0))
    if (s) spans.push(s)
    else diag.push('avatar: no outro span fits the last shots')
  }
  for (const span of spans) {
    const covered = base.slice(span.first, span.last + 1)
    const firstShot = covered[0] as Shot
    const seconds = (span.endFrame - span.startFrame) / FPS
    const id = `av-${span.name}`
    const said = o.describe(span.startFrame, span.endFrame)
    const item: GenItem = {
      id: idOf(span.name),
      kind: 'avatar',
      constraints: { durationS: Math.round(seconds * 1000) / 1000, aspect: o.aspect },
      context: { beatText: said.text, subject: span.name === 'hook' ? 'Présentateur (accroche)' : 'Présentateur (conclusion)', keyTerms: said.terms },
      unitPrice: cfg.creditsPerSecond,
      units: Math.ceil(seconds),
      // a presenter on the hook is what the viewer sees first: it is the last thing the budget gives up
      priority: span.name === 'hook' ? 8 : 6,
      shotIds: [id],
      voiceRange: { startFrame: span.startFrame, endFrame: span.endFrame },
      layout: cfg.layout
    }
    const shot: Shot = {
      id,
      track: cfg.layout === 'full' ? 'base' : 'overlay',
      startFrame: span.startFrame,
      endFrame: span.endFrame,
      kind: 'avatar',
      genItem: item.id,
      transitionIn: cfg.layout === 'full' ? firstShot.transitionIn : 'cut',
      role: 'scene',
      beat: firstShot.beat,
      layout: cfg.layout
    }
    if (cfg.layout === 'full') {
      // the presenter replaces the base shots (and their items) it covers
      const gone = new Set(covered.map((s) => s.id))
      const at = shots.indexOf(firstShot)
      for (const s of covered) shots.splice(shots.indexOf(s), 1)
      shots.splice(at, 0, shot)
      const itemAt = items.findIndex((it) => it.shotIds.every((sid) => gone.has(sid)))
      for (let k = items.length - 1; k >= 0; k--) if ((items[k] as GenItem).shotIds.every((sid) => gone.has(sid))) items.splice(k, 1)
      items.splice(Math.max(0, itemAt), 0, item)
    } else {
      shots.push(shot)
      items.push(item)
    }
    diag.push(`avatar: ${span.name} ${seconds.toFixed(1)} s, ${cfg.layout}`)
  }
  return diag
}

/**
 * The budget pass gives an avatar back (§21.2 step 5: `avatar` → voice over stock): a `full` shot becomes one stock picture
 * (the item keeps its place, with a query from the film's subject), a `pip` shot and its item are removed.
 */
export function dropAvatar(it: GenItem, shots: Shot[], items: GenItem[], fallbackQuery: string, stockPrice: number): void {
  const shot = shots.find((s) => s.genItem === it.id)
  if (!shot) return
  if (shot.track === 'overlay') {
    shots.splice(shots.indexOf(shot), 1)
    items.splice(items.indexOf(it), 1)
    return
  }
  // a split shot keeps its picture, now on the whole frame
  const beside = shot.beside ? items.find((x) => x.id === shot.beside?.genItem) : undefined
  if (beside) {
    shot.kind = beside.kind
    shot.genItem = beside.id
    delete shot.layout
    delete shot.beside
    items.splice(items.indexOf(it), 1)
    return
  }
  shot.kind = 'stock.photo'
  delete shot.layout
  shot.motion = { kind: 'push', from: 1.02, to: 1.1 }
  const query = (it.context.keyTerms.slice(0, 3).join(' ') || fallbackQuery).slice(0, 80)
  it.kind = 'stock.photo'
  it.query = query
  it.prompt = query
  it.units = 1
  it.unitPrice = stockPrice
  delete it.voiceRange
  delete it.layout
}
