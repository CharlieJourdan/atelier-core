// P5 — Build the pipeline (spec §2 P5): compose bricks to execute the definition, fill human-input slots with
// placeholders so it runs end to end now. Bricks may come from bases; settings come only from the definition
// (plan-rules.ts). A missing brick is built in the engine first (chantier C, decision 0099), never replaced by the nearest
// template; the plan is compiled into a recipe (pipeline/compile.ts) that carries no base and no base option.
import { INSPIRATION_AXES, PipelinePlan, type Brief, type Feasibility, type StyleDefinition } from '../../../shared/clone'
import { BASE_PIPELINES, type BasePipeline } from '../../../engine/technologies/bases'
import { artefactHead, type PhaseContext } from './context'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'
import { settingProblems, settingsFromDefinition } from './plan-rules'
import { compilePlan, composeBricks, drawnShareOf, impossibleOf, inStageOrder, knownTechnologies, recipeProblems, techOf, latestOf } from './pipeline/compile'
import { cardStyleFrom } from './pipeline/values'
import { startedFromLine, startedFromOf } from './definition/base-start-plan'

/** Bricks the composition decides (the mix of screen time; motion only in a measured card style): when it did not pick one a
 *  measured element names, the brick is kept unless the composition has a reason, and that reason is recorded (`leftOut`). */
const MIX_DECIDES = new Set(['clip.make', 'visuals.fulfil', 'motion.render'])

type LeftOut = NonNullable<PipelinePlan['leftOut']>[number]

/** Why the composition leaves a MIX_DECIDES brick out (null: nothing stands in, the measured element keeps its brick). Pure. */
export function mixReason(brick: string, axis: string, def: StyleDefinition, brief: Pick<Brief, 'references'>): string | null {
  const taken = new Set(brief.references.flatMap((r) => r.axes))
  if (taken.size > 0 && (INSPIRATION_AXES as readonly string[]).includes(axis) && !taken.has(axis as (typeof INSPIRATION_AXES)[number])) return `the ${axis} axis is not taken from the references (the brief takes ${[...taken].join(', ')})`
  if (drawnShareOf(def) >= 0.5 && brick !== 'motion.render') return 'the channel is drawn: director.pov draws these scenes in its own universe'
  if (brick === 'motion.render' && drawnShareOf(def) < 0.5 && !cardStyleFrom(def)) return 'no card style was measured (palette, face, easing): motion cards would take the templates’ own look, never the channel’s'
  return null
}

/** The base pipeline whose recipe already uses a node, if any (only to record where the brick comes from). */
function baseOf(node: string, bases: readonly BasePipeline[]): string | null {
  const bare = node.split('@')[0]!
  return bases.find((b) => b.doc.bricks.some((x) => x.tech === node || x.tech.split('@')[0] === bare))?.id ?? null
}

/** Impossible elements this small IN ALL (share of the screen, measured) never block a clone: the channel's own main pictures stand in
 *  and the report says so (Finary: 2.6 % of 3D shots in a presenter + motion design channel). */
export const MINOR_IMPOSSIBLE_SHARE = 0.05

/** The bricks built in the engine for what the analysis measured (decision 0099), and the impossible elements stood in or left to build. */
export function missingBricksOf(def: StyleDefinition, feasibility: Feasibility): PipelinePlan['missingBricks'] {
  const out: PipelinePlan['missingBricks'] = []
  if (cardStyleFrom(def)) out.push({ id: 'motion.styled-cards', description: 'motion cards in the channel’s measured palette, face, easing, texture and coverage (not the templates’ own look)', status: 'built', by: 'motion.render@1 style' })
  if (def.presenter.kind.value !== 'none' && def.presenter.angleCount.value > 1)
    out.push({ id: 'presenter.multi-angle', description: `the presenter switching between his ${def.presenter.angleCount.value} measured angles (the placeholder’s or the user’s pictures)`, status: 'built', by: 'avatar.speak@1 framing multi + presenter' })
  // the channel's main made pictures (its largest element a brick makes), for a minor impossible element to fall back on
  const main = [...feasibility.elements].filter((e) => e.how === 'brick' && e.brick && e.axis !== 'presenter').sort((a, b) => b.screenShare.value - a.screenShare.value)[0]
  let stoodIn = 0
  for (const e of impossibleOf(feasibility)) {
    const drawnStandIn = e.origin === '3d' || /3d/i.test(`${e.id} ${e.description}`)
    if (drawnStandIn && drawnShareOf(def) >= 0.5) out.push({ id: e.id, description: `${e.description}: drawn 2D scenes of the channel’s own universe stand in (${e.missing?.technology ?? 'missing technology'})`, status: 'stand-in', by: 'director.pov@1' })
    else if (main && e.screenShare.evidence.length > 0 && stoodIn + e.screenShare.value <= MINOR_IMPOSSIBLE_SHARE && (stoodIn += e.screenShare.value) >= 0) out.push({ id: e.id, description: `${e.description} (${Math.round(e.screenShare.value * 100)} % of the screen): the channel’s own ${main.description} stand in (${e.missing?.technology ?? 'missing technology'})`, status: 'stand-in', by: main.brick! })
    else out.push({ id: e.id, description: `${e.description}: ${e.missing?.technology ?? 'missing technology'}`, status: 'to-build' })
  }
  return out
}

export function buildPlan(ctx: PhaseContext, brief: Brief, def: StyleDefinition, feasibility: Feasibility, bases: readonly BasePipeline[] = BASE_PIPELINES): PipelinePlan {
  const composed = composeBricks(def)
  // a feasibility brick the composition did not pick (a measured element) is kept, at the engine's version: nothing measured is
  // dropped. The picture bricks are the mix's decision; one it leaves out is said with its reason, never dropped silently.
  const leftOut: LeftOut[] = []
  const extra = [...new Set(feasibility.elements.flatMap((e) => (e.how === 'brick' && e.brick ? [e.brick] : [])))]
    .filter((n) => !composed.some((c) => c.tech.split('@')[0] === n.split('@')[0]))
    .filter((n) => {
      const bare = n.split('@')[0]!
      if (!MIX_DECIDES.has(bare)) return true
      const elements = feasibility.elements.filter((e) => e.brick === n)
      const reasons = elements.map((e) => ({ e, why: mixReason(bare, e.axis, def, brief) }))
      if (reasons.some((r) => r.why === null)) return true
      for (const r of reasons) leftOut.push({ brick: bare, element: r.e.id, why: r.why! })
      return false
    })
    .map((n) => ({ n, tech: n.includes('@') ? n : latestOf(n) ?? n }))
  const bricks = inStageOrder([
    ...composed.map((c) => ({ node: c.tech.split('@')[0]!, tech: c.tech, fromBase: baseOf(c.tech, bases), role: c.role })),
    ...extra.map(({ n, tech }) => ({ node: n.split('@')[0]!, tech, fromBase: baseOf(tech, bases), role: feasibility.elements.find((e) => e.brick === n)!.description }))
  ])
  const slots = feasibility.elements.flatMap((e) => {
    if (e.how !== 'human-input' || !e.slot) return []
    const isPresenter = e.slot.kind === 'presenter-footage' || e.slot.kind === 'presenter-avatar'
    const isVoice = e.slot.kind === 'voice'
    const field = isPresenter ? 'presenter.presenterRef' : isVoice ? 'voice.voiceRef' : `sourcing.originShares`
    const own = isPresenter ? def.presenter.mode.value === 'own' : isVoice ? def.voice.mode.value === 'user-clone' : false
    const ref = isPresenter ? def.presenter.presenterRef : isVoice ? def.voice.voiceRef : null
    // a filmed-footage slot runs now on FOUND footage of the same subject (visuals.fulfil), until the user imports his own
    const standIn = !isPresenter && !isVoice ? { ref: `found-footage:${e.id}`, description: `found footage of the same subject stands in for ${e.slot.what}` } : null
    return [{
      id: e.id,
      kind: e.slot.kind,
      what: e.slot.what,
      filledBy: own ? ('own-clone' as const) : e.slot.userSupplies ? ('user' as const) : ('placeholder' as const),
      placeholder: own ? null : standIn ?? { ref: ref?.value ?? `placeholder-${e.id}`, description: ref?.note ?? `stand-in for ${e.slot.what}` },
      field
    }]
  })
  const settings = settingsFromDefinition(def)
  const plan = { bricks, settings }
  const startedFrom = startedFromOf(def, plan)
  return {
    ...artefactHead(ctx, 'pipeline-plan'),
    definitionVersion: def.version,
    bricks,
    settings,
    slots,
    missingBricks: missingBricksOf(def, feasibility),
    recipe: compilePlan(plan, def),
    ...(startedFrom ? { startedFrom } : {}),
    ...(leftOut.length ? { leftOut } : {})
  }
}

export async function runP5(ctx: PhaseContext, brief: Brief, def: StyleDefinition, feasibility: Feasibility): Promise<PipelinePlan> {
  const plan = buildPlan(ctx, brief, def, feasibility)
  const built = plan.missingBricks.filter((m) => m.status !== 'to-build').map((m) => `${m.id} (${m.status})`)
  const left = (plan.leftOut ?? []).map((l) => `${l.brick} for ${l.element} left out: ${l.why}`)
  ctx.decide('p5', `plan for definition v${def.version}`, `${plan.bricks.length} bricks (${plan.bricks.map((b) => b.node).join(', ')}), ${plan.slots.length} slots${built.length ? `; ${built.join(', ')}` : ''}${left.length ? `; ${left.join('; ')}` : ''}; ${startedFromLine(def, plan.startedFrom)}`)
  return plan
}

/** Refuses a plan whose settings do not come from the definition (or carry a base default not measured), a slot left
 *  empty, a brick still to build or unknown to the engine, a recipe that does not compile or carries a base's settings, or a
 *  plan built for another definition version. */
export function checkP5(plan: PipelinePlan, def: StyleDefinition, bases: readonly BasePipeline[] = BASE_PIPELINES): ExitCheck {
  const p = schemaProblems(PipelinePlan, plan)
  if (p.length) return verdict(p)
  if (plan.definitionVersion !== def.version) p.push(`plan built for definition v${plan.definitionVersion}, current is v${def.version}`)
  p.push(...settingProblems(plan, def, bases))
  for (const s of plan.slots) if (s.filledBy === 'placeholder' && !s.placeholder) p.push(`slot ${s.id} has no placeholder: the pipeline cannot run end to end`)
  for (const m of plan.missingBricks) if (m.status === 'to-build') p.push(`brick ${m.id} is still to build`)
  const known = knownTechnologies()
  for (const b of plan.bricks) {
    const ok = known.has(techOf(b))
    if (!ok) p.push(`brick ${b.node} does not exist in the engine`)
  }
  if (plan.recipe === null) p.push('the plan has no compiled recipe')
  else p.push(...recipeProblems(plan.recipe, plan, bases, def))
  return verdict(p)
}
