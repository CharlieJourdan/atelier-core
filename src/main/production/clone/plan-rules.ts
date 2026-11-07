// The rule « bricks from bases, style from the definition » (spec §1, decision 0095), enforced in code. A pipeline plan
// may take only BRICKS from base pipelines; every setting is computed from Style Definition fields through SETTING_MAP
// and cites them. A setting equal to a base pipeline's default option value is allowed only when every field it comes
// from was measured (or said by the user), or is the definition's own untouched default (definition-defaults.ts). Pure.
import { isDeepStrictEqual } from 'node:util'
import { atPath, isSourced, type PipelinePlan, type PlanSetting, type Sourced, type StyleDefinition } from '../../../shared/clone'
import type { BasePipeline } from '../../../engine/technologies/bases'
import { definitionDefaults } from './definition-defaults'
import { BRICK_SETTINGS } from './pipeline/settings'

export interface SettingRule {
  /** Engine option / setting key (base option ids where one exists: `music`, `captions`, `presenterShots`…). */
  key: string
  fields: readonly string[]
  from(def: StyleDefinition): unknown
}

const v = <T>(def: StyleDefinition, path: string): T => (atPath(def, path) as Sourced<T>).value

/** How each setting is computed from the definition. Chantier C extends this table (and only this table). Keys: a base option id
 *  (`music`, `captions`…: what the plan says, compared with the bases' option defaults), `<node>.<setting>` (written by the compiler
 *  into that brick of the recipe, pipeline/compile.ts), or `recipe.<field>` (the recipe document itself). A null value: the definition
 *  says nothing there, the brick keeps its OWN engine default (never a base pipeline's setting). */
export const SETTING_MAP: readonly SettingRule[] = [
  { key: 'captions', fields: ['captions.burnIn'], from: (d) => v<boolean>(d, 'captions.burnIn') },
  { key: 'music', fields: ['sound.music', 'sound.musicGenre'], from: (d) => (v<boolean>(d, 'sound.music') ? v<string>(d, 'sound.musicGenre') || 'measured' : 'none') },
  { key: 'presenterShots', fields: ['presenter.angleCount'], from: (d) => (v<number>(d, 'presenter.angleCount') > 1 ? 'multi' : 'single') },
  {
    key: 'presenterLayouts',
    fields: ['presenter.configurations'],
    from: (d) => [...new Set(d.presenter.configurations.value.map((c) => c.layout))].sort()
  },
  { key: 'chapters', fields: ['script.chapters'], from: (d) => v<boolean>(d, 'script.chapters') },
  { key: 'clipShare', fields: ['sourcing.originShares'], from: (d) => d.sourcing.originShares.value.generated ?? 0 },
  { key: 'script.wordsPerMinute', fields: ['script.wordsPerMinute'], from: (d) => v<number>(d, 'script.wordsPerMinute') },
  { key: 'voice.ref', fields: ['voice.voiceRef'], from: (d) => v<string | null>(d, 'voice.voiceRef') },
  { key: 'presenter.ref', fields: ['presenter.presenterRef'], from: (d) => v<string | null>(d, 'presenter.presenterRef') },
  { key: 'director.layoutCurve', fields: ['presenter.layoutCurve'], from: (d) => d.presenter.layoutCurve.value },
  { key: 'director.presence', fields: ['presenter.presenceByPart'], from: (d) => d.presenter.presenceByPart.value },
  { key: 'director.meanShotS', fields: ['editing.meanShotS'], from: (d) => v<number>(d, 'editing.meanShotS') },
  { key: 'director.hookMeanShotS', fields: ['editing.hookMeanShotS'], from: (d) => v<number>(d, 'editing.hookMeanShotS') },
  { key: 'director.holdMaxS', fields: ['editing.holdMaxS'], from: (d) => v<number>(d, 'editing.holdMaxS') },
  { key: 'motion.elements', fields: ['motion.elements'], from: (d) => d.motion.elements.value },
  { key: 'motion.palette', fields: ['motion.palette'], from: (d) => d.motion.palette.value },
  { key: 'motion.fonts', fields: ['motion.fonts'], from: (d) => d.motion.fonts.value },
  { key: 'sound.levelUnderVoiceDb', fields: ['sound.musicLevelUnderVoiceDb'], from: (d) => v<number>(d, 'sound.musicLevelUnderVoiceDb') },
  { key: 'sound.loudnessLufs', fields: ['sound.loudnessLufs'], from: (d) => v<number>(d, 'sound.loudnessLufs') },
  { key: 'captions.maxWordsPerCue', fields: ['captions.maxWordsPerCue'], from: (d) => v<number>(d, 'captions.maxWordsPerCue') },
  ...BRICK_SETTINGS
]

/** The settings of a definition: every SETTING_MAP entry, computed. */
export function settingsFromDefinition(def: StyleDefinition): PlanSetting[] {
  return SETTING_MAP.map((r) => ({ key: r.key, value: r.from(def), fields: [...r.fields] }))
}

/** The default option values of the base pipelines, by option id (several bases may declare the same id). */
export function baseDefaults(bases: readonly BasePipeline[]): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>()
  for (const b of bases) for (const o of b.options) out.set(o.id, [...(out.get(o.id) ?? []), o.default])
  return out
}

/** True when a definition field is still the definition's own untouched default. */
function isOwnDefault(path: string, field: Sourced): boolean {
  const own = atPath(definitionDefaults(), path)
  return field.source === 'default' && isSourced(own) && isDeepStrictEqual(own.value, field.value)
}

/** Problems of a plan's settings against its definition and the base pipelines' defaults (empty = the rule holds). */
export function settingProblems(plan: Pick<PipelinePlan, 'settings'>, def: StyleDefinition, bases: readonly BasePipeline[]): string[] {
  const problems: string[] = []
  const defaults = baseDefaults(bases)
  const seen = new Set<string>()
  for (const s of plan.settings) {
    if (seen.has(s.key)) problems.push(`setting ${s.key} appears twice`)
    seen.add(s.key)
    const rule = SETTING_MAP.find((r) => r.key === s.key)
    if (!rule) { problems.push(`setting ${s.key} is not computed from the Style Definition (not in SETTING_MAP)`); continue }
    if (!isDeepStrictEqual([...rule.fields], s.fields)) problems.push(`setting ${s.key} cites ${s.fields.join(',')} instead of ${rule.fields.join(',')}`)
    const fields = rule.fields.map((p) => ({ p, f: atPath(def, p) }))
    const missing = fields.filter((x) => !isSourced(x.f))
    if (missing.length) { problems.push(`setting ${s.key}: field ${missing.map((x) => x.p).join(',')} is not in the definition`); continue }
    if (!isDeepStrictEqual(s.value, rule.from(def))) problems.push(`setting ${s.key} = ${JSON.stringify(s.value)} is not the definition's value ${JSON.stringify(rule.from(def))}`)
    for (const { p, f } of fields) {
      const field = f as Sourced
      if (field.source === 'default' && !isOwnDefault(p, field)) problems.push(`field ${p} is marked default but is not the definition's own default`)
    }
    // (a value equal to a base default is fine when measured / said, or when nothing was measured: the definition's own default)
    const baseValues = defaults.get(s.key) ?? []
    const backed = fields.every(({ p, f }) => (f as Sourced).source !== 'default' || isOwnDefault(p, f as Sourced))
    if (!backed && baseValues.some((b) => isDeepStrictEqual(b, s.value))) problems.push(`setting ${s.key} = ${JSON.stringify(s.value)} is a base pipeline default not measured on the reference`)
  }
  for (const r of SETTING_MAP) if (!seen.has(r.key)) problems.push(`setting ${r.key} is missing: every style setting comes from the definition`)
  return problems
}
