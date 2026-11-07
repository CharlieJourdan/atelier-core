// Two passes the mix director runs on its finished generation list for the pictures bricks (production-8, decision 0035):
// - `markRecurring`: the recurring objects of the scene pass (`json.directives`' `recurring`) each picture shows, so the
//   pictures brick can give a recurring object's later pictures its first picture as a reference;
// - `shareClips`: with `clipShotsPerGeneration` 2 (option « Qualité des clips » éco), a generated-video shot and the next one
//   close after it share ONE generation: the first shows the clip's wide part, the second a tight crop of the rest (pipeline-
//   avatar §2.7). The second item points at the first (`sameAs`), shows the same scene and is priced 0: the pair is billed once.
//   `pairShare` 0.5 (production-10) pairs only half the shots: one pair, then two single shots, and so on.
// Pure: same plan and list, same result.
import type { Recurring } from './director-scenes'
import type { EditPlan, GenItem, GenList } from '../formats/editplan'
import { GENERATED_CLIP_MAX_SECONDS } from '../../shared/cloud-api'
import { FPS } from '../formats/timing'
import { sameAction } from './director-needs-motion'

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Each picture's recurring objects: those whose fixed description heads its scene (the director writes it there), or whose name it says. */
export function markRecurring(list: GenList, recurring: readonly Recurring[]): GenList {
  if (recurring.length === 0) return list
  const items = list.items.map((it): GenItem => {
    if (it.kind !== 'image.gen' && it.kind !== 'video.gen') return it
    const scene = norm(it.shot?.scene ?? it.prompt ?? '')
    const names = recurring.filter((r) => scene.startsWith(norm(r.description)) || new RegExp(`\\b${norm(r.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(scene)).map((r) => r.name)
    return names.length > 0 ? { ...it, recurring: names.slice(0, 5) } : it
  })
  return { ...list, items }
}

export interface ShareOptions {
  /** The longest clip one generation makes (Veo: 8 s); a pair longer than this stays two generations. */
  maxSeconds: number
  /** The second shot starts at most this long after the first ends (the crop repeats a scene seen seconds ago). */
  windowS: number
  /** The share of the generated-video shots to pair (0.5: half the clips give two shots); absent: as many as possible. Pairs
   *  are spread along the video: a shot opens a pair only while the pairs so far are under the share of the shots seen. */
  pairShare?: number
  /** Pair only two shots of one continuous action (their subjects match): a cut to a new subject keeps its own clip (vrais-tests). */
  sameAction?: boolean
}

export const SHARE_DEFAULTS: ShareOptions = { maxSeconds: 8, windowS: 12 }

/** Pairs generated-video shots two by two (time order); returns the new list and how many pairs were made. */
export function shareClips(plan: EditPlan, list: GenList, o: ShareOptions = SHARE_DEFAULTS): { list: GenList; pairs: number } {
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const order = new Map(list.items.map((it, i) => [it.id, i]))
  const items = list.items.map((it) => ({ ...it }))
  const itemOf = new Map(items.map((it) => [it.id, it]))
  // the generated-video shots of the base track, in time order, each with its own item
  const shots = plan.tracks.base
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined && s.kind === 'video.gen' && s.genItem !== undefined)
    .filter((s) => {
      const it = itemOf.get(s.genItem as string)
      return it !== undefined && it.kind === 'video.gen' && it.shotIds.length === 1
    })
  const used = new Set<string>()
  let pairs = 0
  for (let i = 0; i < shots.length; i++) {
    const a = shots[i] as (typeof shots)[number]
    if (used.has(a.id)) continue
    const b = shots.slice(i + 1).find((s) => !used.has(s.id))
    if (!b) break
    if (o.pairShare !== undefined && pairs + 1 > Math.floor((o.pairShare * (i + 2)) / 2 + 1e-9)) continue
    const seconds = (a.endFrame - a.startFrame + b.endFrame - b.startFrame) / FPS
    const gap = (b.startFrame - a.endFrame) / FPS
    const head = itemOf.get(a.genItem as string) as GenItem
    const tail = itemOf.get(b.genItem as string) as GenItem
    if (seconds > o.maxSeconds + 1e-9 || gap > o.windowS + 1e-9 || (order.get(head.id) ?? 0) > (order.get(tail.id) ?? 0)) continue
    if (o.sameAction && !sameAction(head.context.subject, tail.context.subject)) continue
    used.add(a.id)
    used.add(b.id)
    // the second shot is a tight crop of the first one's generation: same scene, nothing to pay; the first one's generation is
    // as long as both (its units are seconds)
    head.units = Math.min(GENERATED_CLIP_MAX_SECONDS, Math.ceil(head.constraints.durationS + tail.constraints.durationS - 1e-9))
    tail.sameAs = head.id
    tail.units = 0
    if (head.prompt !== undefined) tail.prompt = head.prompt
    if (head.shot) tail.shot = { ...head.shot }
    else delete tail.shot
    if (head.recurring) tail.recurring = [...head.recurring]
    else delete tail.recurring
    pairs++
  }
  if (pairs === 0) return { list, pairs }
  const credits = Math.round(items.reduce((sum, it) => sum + it.unitPrice * it.units, 0) * 1e6) / 1e6
  return { list: { ...list, items, totals: { ...list.totals, credits } }, pairs }
}
