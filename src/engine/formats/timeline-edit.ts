// Actions on the timeline (production-model §7.3 R7.2, production-9): what the user or the agent does to one shot after the director,
// as a new edit plan and generation list. Pure: no file, no run. Each action says which base segments it touches (the render re-makes
// only those, the others come from the segment cache, ENGINE-SPEC R7.6), which items must be generated again and what that costs,
// before anything runs (R7.2: priced first). Built: change the presenter's layout (full, split, pip), delete a shot (its neighbour
// stretches), regenerate a picture with a new prompt. Replacing a source with an uploaded file and animating a still need the
// pictures brick to take a user's file: later (docs/ETAT.md).
import type { EditPlan, GenItem, GenList, Shot } from './editplan'

export type TimelineAction =
  | { op: 'layout'; shot: string; layout: 'full' | 'split' | 'pip'; side?: 'left' | 'right' }
  | { op: 'delete'; shot: string }
  | { op: 'regenerate'; shot: string; prompt?: string }

export interface TimelineEditResult {
  plan: EditPlan
  list: GenList
  /** Base shots whose segment changes (the others are reused from the cache). */
  touched: string[]
  /** Items to generate again, and what they cost (credits, from their own price). */
  regenerate: string[]
  credits: number
}

export class TimelineEditError extends Error {
  override name = 'TimelineEditError'
}

const PICTURE_KINDS = new Set<Shot['kind']>(['stock.video', 'stock.photo', 'image.gen', 'video.gen', 'user.footage'])

function clone<T>(v: T): T {
  return structuredClone(v)
}

/** The list with its totals summed again (an item used by no shot is dropped: nothing generates it). */
function retotal(plan: EditPlan, list: GenList): GenList {
  const used = new Set<string>()
  for (const s of plan.shots) {
    if (s.genItem) used.add(s.genItem)
    if (s.beside) used.add(s.beside.genItem)
  }
  // an item another kept item shares its clip with stays
  for (const it of list.items) if (it.sameAs && used.has(it.id)) used.add(it.sameAs)
  const items = list.items.filter((it) => used.has(it.id))
  const byKind: Record<string, number> = {}
  for (const it of items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1
  return { ...list, items, totals: { credits: Math.round(items.reduce((n, it) => n + it.unitPrice * it.units, 0) * 1e6) / 1e6, items: items.length, byKind } }
}

const baseShots = (plan: EditPlan): Shot[] => plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id) as Shot)

/** The picture item nearest to a base shot (the one before it, else the one after): what a presenter may stand beside. */
function nearestPicture(plan: EditPlan, at: number): string | undefined {
  const base = baseShots(plan)
  for (let d = 1; d < base.length; d++) {
    for (const k of [at - d, at + d]) {
      const s = base[k]
      if (s && PICTURE_KINDS.has(s.kind) && s.genItem) return s.genItem
      if (s?.beside) return s.beside.genItem
    }
  }
  return undefined
}

function setItemLayout(list: GenList, itemId: string | undefined, layout: 'full' | 'split' | 'pip', shotId: string): void {
  const it = list.items.find((x) => x.id === itemId)
  if (it) {
    it.layout = layout
    it.shotIds = [shotId]
  }
}

/** Puts a presenter overlay (pip) back on the base track over its own frames: the base shots under it are trimmed or dropped. */
function pipToBase(plan: EditPlan, pip: Shot, touched: Set<string>): Shot {
  const shot: Shot = { ...pip, track: 'base', layout: 'full', transitionIn: 'cut' }
  const kept: Shot[] = []
  for (const s of baseShots(plan)) {
    if (s.endFrame <= pip.startFrame || s.startFrame >= pip.endFrame) kept.push(s)
    else if (s.startFrame < pip.startFrame && s.endFrame > pip.endFrame) {
      // the presenter falls inside one shot: it is cut in two around it
      kept.push({ ...s, endFrame: pip.startFrame }, shot, { ...s, id: `${s.id}b`, startFrame: pip.endFrame, transitionIn: 'cut' })
      touched.add(s.id).add(`${s.id}b`)
    } else if (s.startFrame < pip.startFrame) {
      kept.push({ ...s, endFrame: pip.startFrame })
      touched.add(s.id)
    } else if (s.endFrame > pip.endFrame) {
      kept.push({ ...s, startFrame: pip.endFrame, transitionIn: 'cut' })
      touched.add(s.id)
    } else touched.delete(s.id)
  }
  if (!kept.includes(shot)) kept.push(shot)
  kept.sort((x, y) => x.startFrame - y.startFrame)
  plan.shots = [...kept, ...plan.shots.filter((s) => s.track !== 'base' && s.id !== pip.id)]
  plan.tracks = { ...plan.tracks, base: kept.map((s) => s.id), overlay: plan.tracks.overlay.filter((id) => id !== pip.id) }
  touched.add(shot.id)
  return shot
}

/** Applies one action; throws `TimelineEditError` (French, for the user) when it cannot be done. */
export function applyTimelineAction(plan0: EditPlan, list0: GenList, a: TimelineAction): TimelineEditResult {
  const plan = clone(plan0)
  const list = clone(list0)
  const touched = new Set<string>()
  const regenerate: string[] = []
  let shot = plan.shots.find((s) => s.id === a.shot)
  if (!shot) throw new TimelineEditError(`Le plan « ${a.shot} » n’existe pas.`)

  if (a.op === 'layout') {
    if (shot.kind !== 'avatar') throw new TimelineEditError('Seul un plan du présentateur change de mise en page.')
    const from = shot.layout ?? (shot.track === 'overlay' ? 'pip' : 'full')
    if (from === a.layout) return { plan, list, touched: [], regenerate: [], credits: 0 }
    const avatarItem = shot.genItem
    if (from === 'pip') shot = pipToBase(plan, shot, touched)
    const at = plan.tracks.base.indexOf(shot.id)
    if (a.layout === 'full') {
      delete shot.beside
      shot.layout = 'full'
    } else if (a.layout === 'split') {
      const beside = shot.beside?.genItem ?? nearestPicture(plan, at)
      if (!beside) throw new TimelineEditError('Aucune image à mettre à côté du présentateur.')
      shot.layout = 'split'
      shot.beside = { genItem: beside, side: a.side ?? shot.beside?.side ?? 'right' }
    } else {
      // the picture beside it (or the nearest one) becomes the base shot, the presenter a small picture over it
      const picture = shot.beside?.genItem ?? nearestPicture(plan, at)
      const item = list.items.find((x) => x.id === picture)
      if (!picture || !item) throw new TimelineEditError('Aucune image à mettre sous le présentateur incrusté.')
      const pip: Shot = { ...shot, id: `${shot.id}p`, track: 'overlay', layout: 'pip', transitionIn: 'cut' }
      delete pip.beside
      const base: Shot = { ...shot, kind: item.kind, genItem: picture, ...(item.kind === 'image.gen' || item.kind === 'stock.photo' ? { motion: { kind: 'push', from: 1.02, to: 1.12 } } : {}) }
      delete base.layout
      delete base.beside
      plan.shots = plan.shots.map((s) => (s.id === base.id ? base : s)).concat(pip)
      plan.tracks = { ...plan.tracks, overlay: [...plan.tracks.overlay, pip.id] }
      setItemLayout(list, avatarItem, 'pip', pip.id)
      touched.add(base.id)
      return finish(plan, list, touched, regenerate)
    }
    setItemLayout(list, avatarItem, a.layout, shot.id)
    touched.add(shot.id)
    return finish(plan, list, touched, regenerate)
  }

  if (a.op === 'delete') {
    if (shot.track !== 'base') {
      plan.shots = plan.shots.filter((s) => s.id !== shot?.id)
      plan.tracks = { base: plan.tracks.base, overlay: plan.tracks.overlay.filter((id) => id !== a.shot), labels: plan.tracks.labels.filter((id) => id !== a.shot) }
      return finish(plan, list, touched, regenerate)
    }
    const base = baseShots(plan)
    if (base.length < 2) throw new TimelineEditError('Le film n’a qu’un plan : il ne peut pas être supprimé.')
    const i = base.findIndex((s) => s.id === a.shot)
    const gone = base[i] as Shot
    // its neighbour stretches over it (R7.2): the one before, else the one after; never a presenter shot, whose clip is as long
    // as its stretch of the voice (stretched, it would freeze while the voice goes on)
    const stretchable = (s: Shot | undefined): s is Shot => s !== undefined && s.kind !== 'avatar'
    const prev = base[i - 1]
    const next = base[i + 1]
    if (stretchable(prev)) {
      prev.endFrame = gone.endFrame
      touched.add(prev.id)
    } else if (stretchable(next)) {
      next.startFrame = gone.startFrame
      touched.add(next.id)
    } else throw new TimelineEditError('Ce plan est entre deux plans du présentateur : change plutôt son image, ou supprime un plan du présentateur.')
    plan.shots = plan.shots.filter((s) => s.id !== gone.id)
    plan.tracks = { ...plan.tracks, base: plan.tracks.base.filter((id) => id !== gone.id) }
    return finish(plan, list, touched, regenerate)
  }

  // regenerate: a new item id (new files, new cache keys), the new prompt, the same price
  const id = shot.genItem
  const item = list.items.find((x) => x.id === id)
  if (!item || item.kind === 'avatar') throw new TimelineEditError('Seule une image ou un clip se régénère ici.')
  const n = Number(/-r(\d+)$/.exec(item.id)?.[1] ?? '1') + 1
  const fresh: GenItem = { ...item, id: `${item.id.replace(/-r\d+$/, '')}-r${n}`.slice(-64), ...(a.prompt ? { prompt: a.prompt.trim().slice(0, 2000) } : {}) }
  if (a.prompt && fresh.shot) fresh.shot = { ...fresh.shot, scene: a.prompt.trim().slice(0, 1200) }
  list.items = list.items.map((x) => (x.id === item.id ? fresh : x.sameAs === item.id ? { ...x, sameAs: fresh.id } : x))
  // the shots that share its clip (eco: one generation, two shots) are made again with it
  const sharers = new Set(list.items.filter((x) => x.sameAs === fresh.id).map((x) => x.id))
  for (const s of plan.shots) {
    if (s.genItem && sharers.has(s.genItem) && s.track === 'base') touched.add(s.id)
    if (s.genItem === item.id) {
      s.genItem = fresh.id
      if (s.track === 'base') touched.add(s.id)
    }
    if (s.beside?.genItem === item.id) {
      s.beside = { ...s.beside, genItem: fresh.id }
      touched.add(s.id)
    }
  }
  regenerate.push(fresh.id)
  return finish(plan, list, touched, regenerate)
}

function finish(plan: EditPlan, list: GenList, touched: Set<string>, regenerate: string[]): TimelineEditResult {
  const next = retotal(plan, list)
  const credits = regenerate.reduce((n, id) => {
    const it = next.items.find((x) => x.id === id)
    return n + (it ? it.unitPrice * it.units : 0)
  }, 0)
  return { plan, list: next, touched: [...touched].filter((id) => plan.tracks.base.includes(id)), regenerate, credits: Math.round(credits * 100) / 100 }
}
