// Canonical look values for the cross-video synthesis (moteur-briques): the look pass writes fonts as free descriptions and
// colours as exact hex codes, so no two videos ever agreed word for word or code for code and the channel's fonts and palette
// came out empty (Le Monde en POV, 2026-11-04). Fonts become `<shape> <role>` items plus a `capitals` / `underlined` token;
// colours become the real colour nearest the centre of the cluster they fall in across the corpus. Pure.
import type { VideoAnalysis } from '../../../../shared/clone'

const SHAPES: [RegExp, string][] = [
  [/script|cursive|calligraph|handwrit|serif italic|italic serif/, 'serif italic'],
  [/rounded/, 'rounded sans'],
  [/geometric/, 'geometric sans'],
  [/condensed|narrow|compressed/, 'condensed sans'],
  [/grotesque|grotesk|neo-grot|humanist/, 'grotesque sans'],
  [/mono/, 'mono'],
  [/serif(?!.*sans)/, 'serif']
]
const ROLES: [RegExp, string][] = [
  [/title|heading|headline|titre/, 'title'],
  [/amount|number|numeral|counter|figure|price|balance|chiffre/, 'amount'],
  [/label|caption|tag|chip|callout/, 'label']
]

/** The canonical items of one font description: `<shape> <role>` (role when said), `capitals`, `underlined`. */
export function fontItems(desc: string): string[] {
  const d = desc.toLowerCase()
  const shape = SHAPES.find(([re]) => re.test(d))?.[1] ?? 'sans'
  const role = ROLES.find(([re]) => re.test(d))?.[1]
  return [role ? `${shape} ${role}` : shape, ...(/capital|upper|majuscule/.test(d) ? ['capitals'] : []), ...(/underlin|soulign/.test(d) ? ['underlined'] : [])]
}

export const canonFonts = (fonts: readonly string[]): string[] => [...new Set(fonts.flatMap(fontItems))]

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

/** Every colour of the corpus mapped to its cluster's member nearest the centre (colours closer than `within` in RGB join one cluster). */
export function paletteMap(palettes: readonly (readonly string[])[], within = 56): Map<string, string> {
  const all = [...new Set(palettes.flat().filter((c) => HEX.test(c)).map((c) => c.toUpperCase()))]
  const clusters: { sum: [number, number, number]; n: number; members: string[] }[] = []
  for (const c of all) {
    const v = rgb(c)
    const near = clusters.find((k) => dist(k.sum.map((s) => s / k.n), v) <= within)
    if (near) {
      near.sum = [near.sum[0] + v[0], near.sum[1] + v[1], near.sum[2] + v[2]]
      near.n++
      near.members.push(c)
    } else clusters.push({ sum: [...v], n: 1, members: [c] })
  }
  const out = new Map<string, string>()
  // each cluster is named by its member nearest its centre: a colour a video really uses (P3 refuses an invented one)
  for (const k of clusters) {
    const c = k.sum.map((s) => s / k.n)
    const medoid = [...k.members].sort((a, b) => dist(rgb(a), c) - dist(rgb(b), c))[0] as string
    for (const m of k.members) out.set(m, medoid)
  }
  return out
}

/** The analyses with their fonts and palette in canonical form (only for the synthesis's agreement; nothing is saved). */
export function canonLooks(analyses: readonly VideoAnalysis[]): VideoAnalysis[] {
  const map = paletteMap(analyses.map((a) => a.motion.palette))
  return analyses.map((a) => ({
    ...a,
    motion: {
      ...a.motion,
      fonts: canonFonts(a.motion.fonts),
      palette: [...new Set(a.motion.palette.map((c) => map.get(c.toUpperCase()) ?? c.toUpperCase()))]
    }
  }))
}
