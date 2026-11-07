// reverse-pipeline: the bricks graph of a reverse-engineered pipeline, from the P5 plan (one node per plan brick, its settings
// with their source and evidence read on the Style Definition fields they cite) and the compiled recipe's wiring
// (src/engine/technologies/graph.ts). Pure.
import { atPath, isSourced, type Evidence, type Feasibility, type PipelinePlan, type PlanSetting, type Sourced, type StyleDefinition } from '../../../../shared/clone'
import type { PipelineEdge, PipelineNode, PipelineSetting } from '../../../../shared/reverse/pipeline'
import type { z } from 'zod'
import { pipelineGraph } from '../../../../engine/technologies/graph'
import { RECIPE_SCHEMA, type RecipeDoc } from '../../../../engine/technologies/recipe'
import { technologyRegistry } from '../../../../engine/technologies/registry'
import { latestOf, techOf } from '../pipeline/compile'

/** Evidence items kept per cited field (the definition keeps them all). */
export const EVIDENCE_PER_FIELD = 3

/** The pseudo-node that carries the recipe document's own settings (format, language, mix). */
export const RECIPE_NODE = 'recipe'

/** Setting keys that are base option ids or short names: the brick they belong to. */
const OWNER_OF: Readonly<Record<string, string>> = {
  captions: 'captions.make',
  music: 'sound.music',
  presenterShots: 'avatar.speak',
  presenterLayouts: 'avatar.speak',
  chapters: 'script.write',
  clipShare: 'clip.make',
  presenter: 'avatar.speak',
  sound: 'sound.music'
}

type Edge = z.infer<typeof PipelineEdge>

/** A setting with where its value came from: `measured` only when every cited field was measured, `default` when any is a
 *  default, else `user`; its evidence is the cited fields' evidence (a few items each). */
export function sourcedSetting(s: PlanSetting, def: StyleDefinition | null): PipelineSetting {
  const fields = s.fields.map((p) => atPath(def, p)).map((f) => (isSourced(f) ? f : null))
  const known = fields.filter((f): f is Sourced => f !== null)
  const source: PipelineSetting['source'] =
    known.length === 0 || fields.some((f) => f === null || f.source === 'default') ? 'default'
      : known.every((f) => f.source === 'measured') ? 'measured' : 'user'
  const evidence: Evidence[] = known.flatMap((f) => f.evidence.slice(0, EVIDENCE_PER_FIELD))
  const notes: Evidence[] = source === 'user' && evidence.length === 0 ? known.flatMap((f) => (f.source === 'user' && f.note ? [{ frames: [], note: f.note }] : [])).slice(0, EVIDENCE_PER_FIELD) : []
  return { key: s.key, value: s.value, source, fields: [...s.fields], evidence: [...evidence, ...notes] }
}

/** The plan brick a setting key belongs to (`<node>.<name>`, the node's family `director.*`, a base option id), else the
 *  recipe pseudo-node. */
export function ownerOf(key: string, nodes: readonly string[]): string {
  if (key.startsWith(`${RECIPE_NODE}.`)) return RECIPE_NODE
  const exact = nodes.filter((n) => key.startsWith(`${n}.`)).sort((a, b) => b.length - a.length)[0]
  if (exact) return exact
  const head = key.split('.')[0]!
  const alias = OWNER_OF[key] ?? OWNER_OF[head]
  if (alias && nodes.includes(alias)) return alias
  const family = nodes.find((n) => n.split('.')[0] === head)
  return family ?? RECIPE_NODE
}

/** Node ids: the node type, `<type>#n` from its second appearance. */
function nodeIds(bricks: readonly { node: string }[]): string[] {
  const seen = new Map<string, number>()
  return bricks.map((b) => {
    const n = (seen.get(b.node) ?? 0) + 1
    seen.set(b.node, n)
    return n === 1 ? b.node : `${b.node}#${n}`
  })
}

/** The status of a brick: `stand-in` when it stands in for an impossible element, `built` when it was made for this kind of
 *  style (P5's missing bricks), else ready. */
function statusOf(node: string, plan: PipelinePlan): PipelineNode['status'] {
  const by = (m: PipelinePlan['missingBricks'][number]): boolean => !!m.by && m.by.split(/[@\s]/)[0] === node
  if (plan.missingBricks.some((m) => m.status === 'stand-in' && by(m))) return 'stand-in'
  if (plan.missingBricks.some((m) => m.status === 'built' && by(m))) return 'built'
  return 'ready'
}

export function nodesOf(plan: PipelinePlan, def: StyleDefinition | null): PipelineNode[] {
  const ids = nodeIds(plan.bricks)
  const bricks = plan.bricks.map((b) => b.node)
  const settings = new Map<string, PipelineSetting[]>()
  for (const s of plan.settings) {
    const owner = ownerOf(s.key, bricks)
    settings.set(owner, [...(settings.get(owner) ?? []), sourcedSetting(s, def)])
  }
  const nodes: PipelineNode[] = plan.bricks.map((b, i) => ({
    id: ids[i]!,
    tech: techOf(b),
    role: b.role,
    status: statusOf(b.node, plan),
    // a node type that appears twice gets its settings once, on its first node
    settings: ids[i] === b.node ? settings.get(b.node) ?? [] : []
  }))
  const recipe = settings.get(RECIPE_NODE) ?? []
  if (recipe.length) nodes.push({ id: RECIPE_NODE, tech: RECIPE_SCHEMA, role: 'the recipe document: format, language, picture mix and the settings no single brick holds', status: 'ready', settings: recipe })
  return nodes
}

/** The edges the compiled recipe wires between bricks (what each carries); the stage order when it does not compile. */
export function edgesOf(plan: PipelinePlan, nodes: readonly PipelineNode[]): Edge[] {
  const bricks = nodes.filter((n) => n.id !== RECIPE_NODE)
  const ids = new Set(bricks.map((n) => n.id))
  if (plan.recipe) {
    try {
      const g = pipelineGraph(plan.recipe as RecipeDoc, technologyRegistry())
      if (g.ok) {
        const out = g.edges.filter((e) => !e.off && ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, carries: e.slot }))
        if (out.length) return out
      }
    } catch {
      // an unreadable recipe: the stage order below
    }
  }
  return bricks.slice(1).map((n, i) => ({ from: bricks[i]!.id, to: n.id, carries: 'stage order' }))
}

/** The graph when no plan was built (P3 said the style cannot be reproduced): the bricks the feasibility map names, and a
 *  `missing` node per impossible element (its missing technology). */
export function feasibilityNodes(f: Feasibility): PipelineNode[] {
  const out: PipelineNode[] = []
  for (const e of f.elements) {
    if (e.how === 'brick' && e.brick && !out.some((n) => n.id === e.brick)) out.push({ id: e.brick, tech: e.brick.includes('@') ? e.brick : latestOf(e.brick) ?? `${e.brick}@1`, role: e.description, status: 'ready', settings: [] })
    if (e.how === 'impossible') out.push({ id: `missing:${e.id}`, tech: e.missing?.technology ?? 'missing technology', role: `${e.description}: no engine brick makes it`, status: 'missing', settings: [] })
  }
  return out
}
