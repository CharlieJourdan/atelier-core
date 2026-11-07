// The technologies of the code registry as the renderer sees them (`TechnologyInfo`): their settings become editor
// fields read from the zod schema (JSON Schema of the input side), with whether a recipe or a channel may set each one.
import { z } from 'zod'
import { techName, technologyRegistry, type AnyTechnology, type TechnologyRegistry } from '../../../engine/technologies'
import type { TechField, TechnologyInfo } from '../../../shared/recipes'

let shared: TechnologyRegistry | null = null

/** The app's registry, built once from the code (0010: no technology is data). */
export function appTechnologies(): TechnologyRegistry {
  shared ??= technologyRegistry()
  return shared
}

interface JsonProp {
  type?: string
  enum?: unknown[]
  minimum?: number
  maximum?: number
  default?: unknown
  items?: JsonProp
}

function fieldOf(key: string, p: JsonProp, t: AnyTechnology): TechField {
  const type: TechField['type'] = p.enum
    ? 'enum'
    : p.type === 'integer'
      ? 'integer'
      : p.type === 'number'
        ? 'number'
        : p.type === 'boolean'
          ? 'boolean'
          : p.type === 'array'
            ? 'list'
            : 'string'
  const options = p.enum ?? p.items?.enum
  return {
    key,
    type,
    ...(options ? { options: options.map(String) } : {}),
    ...(p.minimum !== undefined ? { min: p.minimum } : {}),
    ...(p.maximum !== undefined ? { max: p.maximum } : {}),
    ...(p.default !== undefined ? { default: p.default } : {}),
    recipe: (t.overridable.recipe as readonly string[]).includes(key),
    channel: (t.overridable.channel as readonly string[]).includes(key)
  }
}

export function technologyInfo(t: AnyTechnology, all: readonly AnyTechnology[]): TechnologyInfo {
  const schema = z.toJSONSchema(t.params, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, JsonProp> }
  const name = techName(t.id)
  const version = Number(t.id.slice(name.length + 1))
  return {
    id: t.id,
    name,
    version,
    labelKey: t.labelKey,
    stage: t.stage,
    kind: t.kind,
    nodeTypes: [...new Set(t.nodes.map((n) => n.type))],
    fields: Object.entries(schema.properties ?? {}).map(([k, p]) => fieldOf(k, p, t)),
    inputs: (t.inputs ?? []).map((i) => ({ id: i.id, label: i.label, required: i.required === true })),
    cloudUsages: [...t.cloudUsages],
    agentTools: [...t.agentTools],
    access: t.access,
    status: t.status,
    engineFamily: t.engineFamily ?? null,
    styleFamily: t.styleFamily ?? null,
    superseded: all.some((o) => o !== t && techName(o.id) === name && Number(o.id.slice(name.length + 1)) > version)
  }
}

export function listTechnologies(reg: TechnologyRegistry = appTechnologies()): TechnologyInfo[] {
  const all = reg.list()
  return all.map((t) => technologyInfo(t, all))
}

/** The latest version of a technology name (what a channel's settings are checked against). */
export function latestOf(reg: TechnologyRegistry, name: string): AnyTechnology | undefined {
  return reg
    .list()
    .filter((t) => techName(t.id) === name)
    .sort((a, b) => Number(b.id.split('@')[1]) - Number(a.id.split('@')[1]))[0]
}
