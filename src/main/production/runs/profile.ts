// A channel's style profile and the outliers of its competitors become the run's style and params when the run starts
// (lot "eyes"): `script.write` gets the tone, the order of the parts and the hook pattern, `director.plan` the cuts per minute,
// the picture mix and the shot types, `captions.make` the preset and its position, `thumbnail.make` the traits, and
// `research.topic` the competitors' outliers as inspiration. Pure: a run without a profile and without inspiration gets back
// the very same document and style, so it behaves exactly as it did before.
//
// Rule: the pipeline's own params win. A key the pipeline already sets on a node (a drawn pipeline that fixes `cpm`, a template
// that reads `$style.captions`) is never overwritten; the profile only fills what the pipeline left open. The run's style fields
// come in under the owner's own overrides (`RunStyle`) and over the engine defaults.
import type { Pipeline } from '../../../engine/pipeline-schema'
import type { PresenterRef } from '../../../engine/presenter/talk'
import { placementOf, type Brick, type BrickPlacement } from '../../../engine/formats/brick'
import { profileToRunParams, type StyleProfile } from '../../../shared/style-profile'

export interface RunInspiration {
  title: string
  why: string
  channel: string
}

export interface RunContext {
  profile: StyleProfile | null
  inspiration: RunInspiration[]
  /** The channel's validated custom bricks it uses in its films (« Briques sur mesure », ENGINE-SPEC §25.2). */
  bricks?: Brick[]
  /** The channel's voice (production-5): `voice` and its clones per engine, wired to the voice node as `$style.voices`. */
  voice?: { voice: string; voices: Record<string, string> }
  /** The channel's presenter (production-7): its pictures and registrations, wired to the presenter node as `$style.presenter`. */
  presenter?: PresenterRef
  /** The channel's own script words (its standards and script style): every script writer gets them as `channelStyle` (issue #107). */
  channelStyle?: string
}

export const NO_CONTEXT: RunContext = { profile: null, inspiration: [] }

/** A run's context from what the channel has; NO_CONTEXT when it has nothing (the run starts exactly as before). */
export function contextOf(profile: StyleProfile | null, inspiration: RunInspiration[], bricks: Brick[], voice: RunContext['voice'] | null, presenter: PresenterRef | null = null, channelStyle = ''): RunContext {
  if (!profile && inspiration.length === 0 && bricks.length === 0 && !voice && !presenter && !channelStyle) return NO_CONTEXT
  return { profile, inspiration, ...(channelStyle ? { channelStyle } : {}), ...(bricks.length > 0 ? { bricks } : {}), ...(voice ? { voice } : {}), ...(presenter ? { presenter } : {}) }
}

const baseType = (type: string): string => type.split('@')[0] ?? type

/** The engine defaults with the profile's style fields over them (the owner's overrides go over both, in `mergeStyle`). */
export function styleWithProfile(defaults: Record<string, unknown>, ctx: RunContext): Record<string, unknown> {
  const withVoice = ctx.voice ? { ...defaults, voice: ctx.voice.voice, voices: ctx.voice.voices } : defaults
  const withPresenter = ctx.presenter ? { ...withVoice, presenter: ctx.presenter } : withVoice
  if (!ctx.profile) return withPresenter
  return { ...withPresenter, ...profileToRunParams(ctx.profile).style }
}

/** What to add to the nodes of each type; empty values are not added (an empty thumbnail style says nothing). */
function patches(ctx: RunContext): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  if (ctx.profile) {
    const n = profileToRunParams(ctx.profile).nodes
    out['script.write'] = { style: n['script.write@1'].style, ctaMode: n['script.write@1'].ctaMode }
    const d = n['director.plan@1']
    out['director.plan'] = { cpm: d.cpm, mix: d.mix, videoShare: d.videoShare, minShotS: d.minShotS, maxShotS: d.maxShotS, ...(d.shotTypes.length > 0 ? { shotTypes: d.shotTypes } : {}) }
    out['captions.make'] = n['captions.make@1']
    const th = n['thumbnail.make@1']
    out['thumbnail.make'] = { withFace: th.withFace, layout: th.layout, ...(th.style ? { style: th.style } : {}) }
  }
  if (ctx.channelStyle) out['script.write'] = { ...(out['script.write'] ?? {}), channelStyle: ctx.channelStyle }
  if (ctx.inspiration.length > 0) out['research.topic'] = { inspiration: ctx.inspiration.slice(0, 8) }
  // the channel's own bricks: their content goes to the node that draws them, their placement to the director
  const bricks = (ctx.bricks ?? []).slice(0, 8)
  if (bricks.length > 0) {
    out['motion.render'] = { bricks }
    const placed = bricks.map(placementOf).filter((x): x is BrickPlacement => x !== null)
    if (placed.length > 0) out['director.plan'] = { ...(out['director.plan'] ?? {}), bricks: placed }
  }
  return out
}

/** The pipeline with the context's params added where the pipeline left them open. Returns `doc` itself when there is nothing to add. */
export function applyRunContext(doc: Pipeline, ctx: RunContext): Pipeline {
  const add = patches(ctx)
  // a pipeline without the node that draws animations does not get bricks placed in its plan
  const director = add['director.plan']
  if (director && 'bricks' in director && !doc.nodes.some((n) => baseType(n.type) === 'motion.render')) {
    const rest = { ...director }
    delete rest.bricks
    if (Object.keys(rest).length > 0) add['director.plan'] = rest
    else delete add['director.plan']
  }
  if (Object.keys(add).length === 0) return doc
  let touched = false
  const nodes = doc.nodes.map((node) => {
    const patch = add[baseType(node.type)]
    if (!patch) return node
    const params = { ...(node.params ?? {}) }
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in params)) {
        params[key] = structuredClone(value)
        touched = true
      }
    }
    return { ...node, params }
  })
  return touched ? { ...doc, nodes } : doc
}
