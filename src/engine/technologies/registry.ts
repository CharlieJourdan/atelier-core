// The technology registry (decision 0010): generated from the manifests in code, like `productionRegistry()` for nodes.
// `register` refuses a malformed manifest (unknown node, port or output, a slot that does not exist, an overridable
// setting the schema does not have, settings without full defaults), so a broken technology never ships. Versions of
// one technology live side by side (`voice.tts@1`, `voice.tts@2`); a recipe pins the version it names.
import { z } from 'zod'
import { productionRegistry } from '../nodes'
import type { NodeRegistry } from '../registry'
import { NODE_TYPE_PATTERN } from '../pipeline-schema'
import { backgroundClips, avatarSpeak, captionsMake, cardIntro, clipMake, motionRender, packageYoutube, qcCheck, renderAssemble, soundMusic, thumbnailMake, visualsFulfil } from './catalog-make'
import { directorPlan, directorPov, ideaResearch, scriptPasted, scriptTranslate, scriptWrite, voiceOwn, voiceTts, wordsAlign } from './catalog-write'
import { ideaBrief, ideaSupport, scriptFactcheck, scriptImport, scriptSponsor, scriptWrite2 } from './catalog-script'
import { editChapters, editFx, editSponsor } from './catalog-edit'
import { SLOTS, STAGES, TECH_ACCESS, TECH_KINDS, TECH_STATUSES, type AnyTechnology, type Slot, type Stage } from './types'

/** Every technology Atelier ships, in stage order. Add a new one here (docs/ENGINE-SPEC.md §42). */
export const TECHNOLOGIES: readonly AnyTechnology[] = [
  ideaResearch,
  ideaBrief,
  ideaSupport,
  scriptWrite,
  scriptWrite2,
  scriptPasted,
  scriptImport,
  scriptSponsor,
  scriptFactcheck,
  scriptTranslate,
  voiceTts,
  voiceOwn,
  wordsAlign,
  directorPlan,
  directorPov,
  visualsFulfil,
  clipMake,
  avatarSpeak,
  motionRender,
  backgroundClips,
  cardIntro,
  captionsMake,
  editChapters,
  editSponsor,
  soundMusic,
  editFx,
  renderAssemble,
  qcCheck,
  thumbnailMake,
  packageYoutube
]

const TYPE_ID = new RegExp(NODE_TYPE_PATTERN)
const NODE_ID = /^[a-z][a-z0-9]*$/
const LABEL_KEY = /^tech\.[a-z0-9]+(?:\.[a-z0-9]+)*$/
const SLOT_REF = /^@([a-z]+)(\?)?$/

export class TechnologyError extends Error {
  override name = 'TechnologyError'
}

export const isSlot = (v: string): v is Slot => (SLOTS as readonly string[]).includes(v)

/** The keys of a technology's settings (its schema is a `z.object`). */
export function settingKeys(t: AnyTechnology): string[] {
  return t.params instanceof z.ZodObject ? Object.keys(t.params.shape) : []
}

export class TechnologyRegistry {
  private readonly techs = new Map<string, AnyTechnology>()
  readonly nodes: NodeRegistry

  constructor(nodes: NodeRegistry, list: readonly AnyTechnology[] = []) {
    this.nodes = nodes
    for (const t of list) this.register(t)
  }

  register(t: AnyTechnology): void {
    const problems: string[] = []
    if (!TYPE_ID.test(t.id)) problems.push(`id "${t.id}" is not name@version`)
    if (this.techs.has(t.id)) problems.push(`${t.id} is already registered`)
    if (!LABEL_KEY.test(t.labelKey)) problems.push(`label key "${t.labelKey}" is not tech.<name>`)
    if (!STAGES.includes(t.stage)) problems.push(`unknown stage "${t.stage}"`)
    if (!TECH_KINDS.includes(t.kind)) problems.push(`unknown kind "${t.kind}"`)
    if (!TECH_ACCESS.includes(t.access)) problems.push(`unknown access "${t.access}"`)
    if (!TECH_STATUSES.includes(t.status)) problems.push(`unknown status "${t.status}"`)
    if (t.nodes.length === 0) problems.push('a technology runs at least one node')
    const own = new Map(t.nodes.map((n) => [n.id, n]))
    if (own.size !== t.nodes.length) problems.push('two nodes share an id')
    const outputOf = (ref: string): boolean => {
      const [node, out] = ref.split('.')
      const def = node ? this.nodes.get(own.get(node)?.type ?? '') : undefined
      return !!def && !!out && out in def.outputs
    }
    for (const n of t.nodes) {
      if (!NODE_ID.test(n.id)) problems.push(`node id "${n.id}" is not lower-case letters and digits`)
      const def = this.nodes.get(n.type)
      if (!def) {
        problems.push(`node ${n.type} is not registered`)
        continue
      }
      for (const [port, ref] of Object.entries(n.in)) {
        if (!(port in def.inputs)) problems.push(`${n.type} has no input "${port}"`)
        const slot = SLOT_REF.exec(ref)
        if (slot) {
          if (!isSlot(slot[1] as string)) problems.push(`"${ref}" names no slot`)
        } else if (!ref.startsWith('$inputs.') && !ref.startsWith('$style.') && !outputOf(ref)) {
          problems.push(`"${ref}" is not a slot, an input or an output of this technology`)
        }
      }
    }
    for (const [slot, ref] of Object.entries(t.provides)) {
      if (!isSlot(slot)) problems.push(`provides unknown slot "${slot}"`)
      if (!outputOf(ref)) problems.push(`provides "${slot}" from "${ref}", not an output of this technology`)
    }
    const keys = settingKeys(t)
    for (const k of [...t.overridable.recipe, ...t.overridable.channel]) if (!keys.includes(k)) problems.push(`overridable "${k}" is not a setting`)
    if (!t.params.safeParse({}).success) problems.push('every setting needs a default or must be optional')
    if (problems.length > 0) throw new TechnologyError(`${t.id}: ${problems.join('; ')}`)
    this.techs.set(t.id, t)
  }

  get(id: string): AnyTechnology | undefined {
    return this.techs.get(id)
  }

  /** Every registered version, in stage order then by id. */
  list(): AnyTechnology[] {
    const rank = (s: Stage): number => STAGES.indexOf(s)
    return [...this.techs.values()].sort((a, b) => rank(a.stage) - rank(b.stage) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}

/** The catalogue the app, the agents and the panel read (one source: the code). */
export function technologyRegistry(nodes: NodeRegistry = productionRegistry()): TechnologyRegistry {
  return new TechnologyRegistry(nodes, TECHNOLOGIES)
}
