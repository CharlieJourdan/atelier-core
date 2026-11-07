// Pure helpers behind the Cerveau screens: the radial layout of the competitor map, the niche filters and bubble labels,
// the idea board operations and the research agent's canned answers. No React, no clock: the unit tests pin everything.
import type { ProtoAgent, ProtoChannel } from '@/proto/types'
import type { Scope } from '@/proto/store'
import {
  COMPETITORS,
  IDEA_POOL,
  NICHES,
  type Competitor,
  type Idea,
  type IdeaColumn,
  type Lang,
  type Niche,
  type NicheFormat,
  type StyleId
} from '@/proto/data-brain'

/* ---------- competitor map ---------- */

export interface Placed {
  c: Competitor
  x: number
  y: number
  /** Radius of the circle, from the subscribers (square-root scale). */
  r: number
  /** Where the name is shown by default (the bigger channels, when there is room), or null. */
  label: 'below' | 'above' | null
}

/** Radius in px from subscribers: sqrt scale between 8 and 28. */
export function nodeRadius(subs: number, maxSubs: number): number {
  return 7 + Math.sqrt(Math.max(0, subs) / Math.max(1, maxSubs)) * 17
}

/** Styles present in a list, the most frequent first (stable), at most four colours: the rest fall into the last one. */
export function styleClusters(list: Competitor[]): { style: StyleId; count: number; slot: 1 | 2 | 3 | 4 }[] {
  const counts = new Map<StyleId, number>()
  for (const c of list) counts.set(c.style, (counts.get(c.style) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([style, count], i) => ({ style, count, slot: (Math.min(i, 3) + 1) as 1 | 2 | 3 | 4 }))
}

const TAU = Math.PI * 2

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

function rectsHit(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function wrap(a: number): number {
  let d = a % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

/**
 * Lays the competitors out around the centre of a w × h canvas: distance from the centre = 1 − similarity, one angular
 * sector per style, circles never overlap. Deterministic.
 */
export function layoutMap(list: Competitor[], w: number, h: number, centre = 34): Placed[] {
  if (list.length === 0) return []
  const cx = w / 2
  const cy = h / 2
  const rx = Math.max(80, w / 2 - 44)
  const ry = Math.max(80, h / 2 - 36)
  const maxSubs = Math.max(...list.map((c) => c.subscribers))
  const clusters = styleClusters(list)
  const total = list.length

  // Sectors proportional to the number of channels in each style, the first one starting at the top.
  const nodes: { c: Competitor; a: number; n: number; r: number }[] = []
  let cursor = -Math.PI / 2 - 0.35
  for (const cl of clusters) {
    const members = list.filter((c) => c.style === cl.style).sort((a, b) => b.similarity - a.similarity)
    const slice = (TAU * cl.count) / total
    members.forEach((c, k) => {
      const r = nodeRadius(c.subscribers, maxSubs)
      const a = cursor + slice * ((k + 0.5) / members.length)
      const norm = ringNorm(c.similarity)
      const minNorm = (centre + r + 14) / Math.min(rx, ry)
      nodes.push({ c, a, n: Math.min(0.97, Math.max(norm, minNorm)), r })
    })
    cursor += slice
  }

  const pos = (nd: { a: number; n: number }) => ({ x: cx + Math.cos(nd.a) * rx * nd.n, y: cy + Math.sin(nd.a) * ry * nd.n })

  // 1. Relax along the circle: only the angle moves, so the distance (the meaning) is kept.
  for (let it = 0; it < 80; it++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i]!
        const B = nodes[j]!
        const pa = pos(A)
        const pb = pos(B)
        const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y)
        const need = A.r + B.r + 10
        if (dist >= need) continue
        moved = true
        const sign = wrap(B.a - A.a) >= 0 ? 1 : -1
        const arm = Math.max(40, ((A.n + B.n) / 2) * Math.min(rx, ry))
        const delta = ((need - dist) / 2 / arm) * 1.15
        A.a -= sign * delta
        B.a += sign * delta
      }
    }
    if (!moved) break
  }

  // 2. Whatever still touches is pushed apart along the line between the centres, then kept inside the canvas.
  const pts = nodes.map((nd) => ({ ...pos(nd), r: nd.r }))
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const A = pts[i]!
        const B = pts[j]!
        let dx = B.x - A.x
        let dy = B.y - A.y
        let dist = Math.hypot(dx, dy)
        const need = A.r + B.r + 8
        if (dist >= need) continue
        if (dist < 0.001) {
          dx = 1
          dy = 0
          dist = 1
        }
        const push = (need - dist) / 2
        A.x -= (dx / dist) * push
        A.y -= (dy / dist) * push
        B.x += (dx / dist) * push
        B.y += (dy / dist) * push
      }
    }
    for (const p of pts) {
      // The name of our channel sits under its avatar: nothing may cover it.
      if (Math.abs(p.x - cx) < 74 + p.r && p.y > cy + 30 - p.r && p.y < cy + 76 + p.r) p.y = cy + 78 + p.r
      p.x = Math.min(w - p.r - 6, Math.max(p.r + 6, p.x))
      p.y = Math.min(h - p.r - 6, Math.max(p.r + 6, p.y))
    }
  }

  // Names of the bigger channels, where they touch no circle and no other name.
  const centreBox: Box = { x: cx - 74, y: cy + 34, w: 148, h: 40 }
  const taken: Box[] = [centreBox]
  const labels = new Map<string, 'below' | 'above'>()
  const bySubs = [...list].sort((a, b) => b.subscribers - a.subscribers).slice(0, 7)
  for (const c of bySubs) {
    const i = nodes.findIndex((n) => n.c.id === c.id)
    const p = pts[i]!
    const wTxt = c.name.length * 6.7 + 10
    const sides: ('below' | 'above')[] = p.y >= cy ? ['below', 'above'] : ['above', 'below']
    for (const side of sides) {
      const box: Box = { x: p.x - wTxt / 2, y: side === 'below' ? p.y + p.r + 3 : p.y - p.r - 19, w: wTxt, h: 16 }
      const free =
        box.x >= 2 &&
        box.x + box.w <= w - 2 &&
        box.y >= 2 &&
        box.y + box.h <= h - 2 &&
        !taken.some((t) => rectsHit(t, box)) &&
        !pts.some((q, k) => k !== i && rectsHit({ x: q.x - q.r - 2, y: q.y - q.r - 2, w: q.r * 2 + 4, h: q.r * 2 + 4 }, box))
      if (free) {
        taken.push(box)
        labels.set(c.id, side)
        break
      }
    }
  }
  return nodes.map((nd, i) => ({ c: nd.c, x: pts[i]!.x, y: pts[i]!.y, r: nd.r, label: labels.get(nd.c.id) ?? null }))
}

/** Similarity as a word bucket for the rings. */
export function ringLevels(): number[] {
  return [0.9, 0.75, 0.6]
}

/** Normalised radius of a similarity (same formula as the layout), for drawing the rings. */
export function ringNorm(similarity: number): number {
  return Math.min(0.97, Math.max(0.3, 0.34 + ((0.95 - similarity) / 0.47) * 0.62))
}

/* ---------- niche map ---------- */

/** The visible part of the 0–100 scales: the niches live in the middle, so the plot zooms on it. */
export const DOMAIN = { x0: 15, x1: 96, y0: 38, y1: 96 } as const

export const IDEAL_ZONE = { xMax: 38, yMin: 62 } as const

export interface NicheView {
  niche: Niche
  x: number
  y: number
  rpm: number
  growth30: number
  channels: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** A niche as seen in a language and a format: English is richer and more crowded, Spanish quieter and cheaper. */
export function nicheView(n: Niche, lang: Lang, format: NicheFormat): NicheView {
  let { x, y, rpm, growth30, channels } = n
  if (lang === 'en') {
    x += 10
    y += 4
    rpm *= 1.45
    channels = Math.round(channels * 2.6)
  } else if (lang === 'es') {
    x -= 8
    y -= 3
    rpm *= 0.62
    growth30 += 3
    channels = Math.round(channels * 0.55)
  }
  if (format === 'short') {
    x += 5
    y += 3
    rpm *= 0.1
    channels = Math.round(channels * 1.4)
  }
  return {
    niche: n,
    x: clamp(x, DOMAIN.x0 + 2, DOMAIN.x1 - 1),
    y: clamp(y, DOMAIN.y0 + 3, DOMAIN.y1 - 1),
    rpm: Math.round(rpm * 100) / 100,
    growth30,
    channels
  }
}

export interface NicheFilters {
  lang: Lang
  format: NicheFormat
  facelessOnly: boolean
}

export function visibleNiches(f: NicheFilters): NicheView[] {
  return NICHES.filter((n) => n.formats.includes(f.format) && (!f.facelessOnly || n.faceless)).map((n) => nicheView(n, f.lang, f.format))
}

export function inIdealZone(v: Pick<NicheView, 'x' | 'y'>): boolean {
  return v.x <= IDEAL_ZONE.xMax && v.y >= IDEAL_ZONE.yMin
}

/** The five niches that grow the most. */
export function risingNiches(views: NicheView[], n = 5): NicheView[] {
  return [...views].sort((a, b) => b.growth30 - a.growth30).slice(0, n)
}

export interface LabelSpot {
  id: string
  x: number
  y: number
  anchor: 'start' | 'end' | 'middle'
}

/**
 * Puts each bubble's label on the right, then the left, above or below, the first spot that touches no other label or
 * bubble and stays in the plot. Bigger bubbles choose first.
 */
export function placeLabels(items: { id: string; label: string; x: number; y: number; r: number; prio?: number }[], plot: Box): LabelSpot[] {
  const bubbles: Box[] = items.map((b) => ({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 }))
  const taken: Box[] = []
  const out: LabelSpot[] = []
  for (const it of [...items].sort((a, b) => (b.prio ?? 0) - (a.prio ?? 0) || b.r - a.r)) {
    const wTxt = it.label.length * 6.2 + 4
    const hTxt = 16
    const options: { box: Box; spot: LabelSpot }[] = [
      { box: { x: it.x + it.r + 6, y: it.y - hTxt / 2, w: wTxt, h: hTxt }, spot: { id: it.id, x: it.x + it.r + 8, y: it.y + 4, anchor: 'start' } },
      { box: { x: it.x - it.r - 6 - wTxt, y: it.y - hTxt / 2, w: wTxt, h: hTxt }, spot: { id: it.id, x: it.x - it.r - 8, y: it.y + 4, anchor: 'end' } },
      { box: { x: it.x - wTxt / 2, y: it.y - it.r - 6 - hTxt, w: wTxt, h: hTxt }, spot: { id: it.id, x: it.x, y: it.y - it.r - 10, anchor: 'middle' } },
      { box: { x: it.x - wTxt / 2, y: it.y + it.r + 6, w: wTxt, h: hTxt }, spot: { id: it.id, x: it.x, y: it.y + it.r + 18, anchor: 'middle' } },
      {
        box: { x: it.x + it.r * 0.7, y: it.y - it.r - 14, w: wTxt, h: hTxt },
        spot: { id: it.id, x: it.x + it.r * 0.7 + 2, y: it.y - it.r - 2, anchor: 'start' }
      },
      {
        box: { x: it.x + it.r * 0.7, y: it.y + it.r - 2, w: wTxt, h: hTxt },
        spot: { id: it.id, x: it.x + it.r * 0.7 + 2, y: it.y + it.r + 10, anchor: 'start' }
      },
      {
        box: { x: it.x - it.r * 0.7 - wTxt, y: it.y - it.r - 14, w: wTxt, h: hTxt },
        spot: { id: it.id, x: it.x - it.r * 0.7 - 2, y: it.y - it.r - 2, anchor: 'end' }
      },
      {
        box: { x: it.x - it.r * 0.7 - wTxt, y: it.y + it.r - 2, w: wTxt, h: hTxt },
        spot: { id: it.id, x: it.x - it.r * 0.7 - 2, y: it.y + it.r + 10, anchor: 'end' }
      }
    ]
    const own = items.indexOf(it)
    const free = options.find(
      (o) =>
        o.box.x >= plot.x &&
        o.box.x + o.box.w <= plot.x + plot.w &&
        o.box.y >= plot.y &&
        o.box.y + o.box.h <= plot.y + plot.h &&
        !taken.some((t) => rectsHit(t, o.box)) &&
        !bubbles.some((b, k) => k !== own && rectsHit(b, o.box))
    )
    // The niches of the sweet spot are always named, even if the name has to overlap a neighbour.
    const chosen = free ?? ((it.prio ?? 0) >= 2 ? options[0] : undefined)
    if (!chosen) continue
    taken.push(chosen.box)
    out.push(chosen.spot)
  }
  return out
}

/* ---------- ideas ---------- */

export function ideasInScope(ideas: Idea[], scope: Scope): Idea[] {
  return scope === 'all' ? ideas : ideas.filter((i) => i.channelId === scope)
}

export function moveIdea(ideas: Idea[], id: string, column: IdeaColumn): Idea[] {
  return ideas.map((i) => (i.id === id ? { ...i, column } : i))
}

/**
 * Five new proposals: from the channel in scope, or one after the other from every channel when the scope is all.
 * Titles already on the board are skipped; when a pool runs dry, the next channel's pool gives more.
 */
export function generateIdeas(existing: Idea[], scope: Scope, channelIds: string[], count = 5, stamp = 0): Idea[] {
  const used = new Set(existing.map((i) => i.title))
  const order = scope === 'all' ? channelIds : [scope]
  const queues = order.map((id) => (IDEA_POOL[id] ?? []).filter((p) => !used.has(p.title)))
  const out: Idea[] = []
  let guard = 0
  while (out.length < count && queues.some((q) => q.length > 0) && guard++ < 100) {
    for (const q of queues) {
      const next = q.shift()
      if (next && out.length < count) out.push({ ...next, id: `id-new-${stamp}-${out.length}`, column: 'proposed' })
    }
  }
  return out
}

/* ---------- the research agent ---------- */

/** The researcher of the channel in scope (or its competitor analyst, or its lead); the main agent when the scope is all. */
export function researchAgent(agents: ProtoAgent[], scope: Scope): ProtoAgent | undefined {
  if (scope === 'all') return agents.find((a) => a.role === 'principal')
  const mine = agents.filter((a) => a.channelId === scope)
  return mine.find((a) => a.role === 'researcher') ?? mine.find((a) => a.role === 'competitor-analyst') ?? mine.find((a) => a.role === 'channel-manager')
}

export interface ReplyContext {
  scope: Scope
  channel?: ProtoChannel | undefined
  nicheName: (id: string) => string
}

const pct = (n: number): string => `${n} %`

export function brainReply(text: string, ctx: ReplyContext): string {
  const q = text.toLowerCase()
  const views = NICHES.map((n) => nicheView(n, 'fr', 'long'))
  const rising = risingNiches(views, 3)
  const names = (list: NicheView[]): string => list.map((v) => `${ctx.nicheName(v.niche.id)} (+${v.growth30} %)`).join(', ')
  if (/(faceless|sans visage|sans montrer)/.test(q)) {
    const fl = risingNiches(
      views.filter((v) => v.niche.faceless),
      3
    )
    return `Parmi les niches qui montent, ${views.filter((v) => v.niche.faceless).length} sur ${views.length} se font sans visage. Les trois meilleures : ${names(fl)}. Je les ai surlignées sur la carte.`
  }
  if (/(traduire|traduction|anglais|espagnol|langue)/.test(q)) {
    const best = [...COMPETITORS].filter((c) => c.channelId === 'ch-enigmes' || c.channelId === ctx.scope).sort((a, b) => b.outlier - a.outlier)[0]
    return `En anglais le RPM de ces niches est environ 1,45× plus élevé, mais il y a 2,6× plus de chaînes. La meilleure à traduire serait ${best?.name ?? 'la plus forte de ta niche'} (score ${best?.outlier.toLocaleString('fr-FR') ?? '2,4'}). Je prépare le devis de traduction ?`
  }
  if (/(rpm|revenu|gagn|monétis|monetis|argent)/.test(q)) {
    const rich = [...views].sort((a, b) => b.rpm - a.rpm).slice(0, 3)
    return `Les RPM estimés les plus hauts : ${rich.map((v) => `${ctx.nicheName(v.niche.id)} (${v.rpm.toLocaleString('fr-FR')} €)`).join(', ')}. Attention : les niches très chères sont aussi les plus disputées.`
  }
  if (/(concurren|rival|compar|surveill|autour)/.test(q)) {
    const list = COMPETITORS.filter((c) => (ctx.scope === 'all' ? c.rising : c.channelId === ctx.scope && c.rising))
      .sort((a, b) => b.outlier - a.outlier)
      .slice(0, 3)
    if (list.length === 0) return 'Aucune chaîne ne décolle autour de la tienne cette semaine. Je continue de surveiller.'
    return `Autour ${ctx.channel ? `de ${ctx.channel.name}` : 'de tes chaînes'}, trois chaînes décollent : ${list.map((c) => `${c.name} (score ${c.outlier.toLocaleString('fr-FR')})`).join(', ')}. Clique sur l’une d’elles sur la carte pour voir ce qu’elle fait mieux.`
  }
  if (/(id[ée]e|sujet|vidéo|propos)/.test(q)) {
    return `J’ai de quoi remplir ton tableau : cinq idées de plus sont prêtes. Ouvre l’onglet Idées et demande-m’en cinq, je garde les mieux notées en tête.`
  }
  if (/(niche|monte|tendance|récent|recent|lancer|créer|creer|chaîne|chaine)/.test(q)) {
    const best = rising[0]!
    return `Depuis 30 jours : ${names(rising)}. ${ctx.nicheName(best.niche.id)} n’a que ${best.channels.toLocaleString('fr-FR')} chaînes et un RPM de ${best.rpm.toLocaleString('fr-FR')} €. Nos modèles la répliquent à ${pct(best.niche.replic.pct)} (${best.niche.replic.model}).`
  }
  return 'Je regarde. Je croise les chaînes qui montent, leurs formats et leur RPM, et je te donne les trois plus intéressantes avec un devis de lancement.'
}

/** The answer when the user asks for a competitor's style from its card. */
export function styleAnalysis(c: Competitor, styleLabel: string): string {
  return `${c.name} : style « ${styleLabel.toLowerCase()} ». ${c.better} Dernière vidéo : « ${c.lastVideo.title} ». Je peux reprendre ce rythme dans ton pipeline sans toucher à ton identité visuelle.`
}
