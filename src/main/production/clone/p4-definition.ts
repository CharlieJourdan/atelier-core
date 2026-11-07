// P4 — the Style Definition (spec §2 P4): start from the definition's own defaults, write every field the whole-video
// analyses measured (definition/derive.ts: the v1-level richness), then every field the cross-video synthesis measured
// (it wins), each with its evidence; then pick the presenter and the voice: the user's own clones for his own channel, a
// look-alike placeholder of the same type otherwise (never a third party's own face or voice). Chantier B owns it.
import { isDeepStrictEqual } from 'node:util'
import { StyleDefinition, VideoAnalysis, atPath, isSourced, sourcedFields, withAtPath, type Brief, type Evidence, type Feasibility, type Sourced, type Synthesis } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { definitionDefaults } from './definition-defaults'
import { deriveFields, type Derived } from './definition/derive'
import { READY_BASES, type ReadyBase } from './definition/base-registry'
import { baseStartAccepts, baseStartProblems, startFromBase } from './definition/base-start'
import { lookAlikeSpec, packIdentity, safeDescriptors, type Identity } from './definition/lookalike'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

/** Fields the analysis must have measured before a definition is accepted (a definition of defaults is no clone). */
export const MIN_MEASURED_FIELDS = ['presenter.kind', 'voice.kind', 'script.wordsPerMinute', 'editing.meanShotS', 'sourcing.originShares'] as const

/** The corpus analyses saved by P2 (the orchestrator does not pass them to P4). */
function savedAnalyses(ctx: PhaseContext): VideoAnalysis[] {
  return ctx.store.list('p2-analysis-').flatMap((f) => {
    try { return [ctx.store.load(f, VideoAnalysis)!] } catch (e) { ctx.decide('p4', `analysis ${f} unreadable`, String(e)); return [] }
  })
}

/** The measured fields of a corpus that the synthesis does not already name (synthesis constants win). */
export function analysisMeasures(analyses: readonly VideoAnalysis[], synthesis: Synthesis): Derived[] {
  const named = new Set(synthesis.constants.map((c) => c.field))
  return deriveFields(analyses).filter((d) => !named.has(d.field))
}

/** The default cost targets ($ per finished minute; targets, not caps): found-media documentaries near zero, a presenter
 *  channel ≈ 0.5–0.6, most others under ≈ 1. Nothing measured them on this channel: saved `default`, the note says so. */
export const DEFAULT_COST_TARGETS = { presenter: 0.6, foundMedia: 0.05, other: 1 } as const

export function costTarget(def: Pick<StyleDefinition, 'presenter' | 'sourcing'>): { usd: number; why: string } {
  const found = def.sourcing.originShares.value.found ?? 0
  const t = DEFAULT_COST_TARGETS
  if (def.presenter.kind.value !== 'none') return { usd: t.presenter, why: `default target for a presenter channel: ≈ 0.5–${t.presenter} $ per finished minute (not measured on this channel)` }
  if (found >= 0.6) return { usd: t.foundMedia, why: 'default target for found-media documentaries: near zero per minute (not measured on this channel)' }
  return { usd: t.other, why: `default target: most videos under ≈ ${t.other} $ per finished minute (not measured on this channel)` }
}

export async function runP4(ctx: PhaseContext, brief: Brief, synthesis: Synthesis, feasibility: Feasibility, analyses: readonly VideoAnalysis[] = savedAnalyses(ctx)): Promise<StyleDefinition> {
  const ref = brief.references[0]!
  let def: StyleDefinition = {
    ...artefactHead(ctx, 'style-definition'),
    version: 1,
    channel: { name: '', url: ref.url, ownChannel: brief.ownChannel, language: brief.language, styleId: synthesis.chosenStyle },
    ...definitionDefaults(),
    analysisMeasures: []
  }
  const derived = analysisMeasures(analyses, synthesis)
  for (const d of derived) if (isSourced(atPath(def, d.field))) def = withAtPath(def, d.field, { value: d.value, source: 'measured', evidence: d.evidence } satisfies Sourced)
  for (const c of synthesis.constants) {
    def = withAtPath(def, c.field, { value: c.value, source: 'measured', evidence: c.evidence } satisfies Sourced)
  }
  def = completeConfigurations(def, deriveFields(analyses))
  // start from a ready base when one fits: its settings kept only where measured equal here (decision 0112)
  const start = startFromBase(def, ctx.services.readyBases ?? READY_BASES)
  if (start.definition.version !== def.version) ctx.store.save(`p4-style-definition.v${def.version}.json`, { ...def, baseStart: start.record }) // the measured definition before the earned rounds stays saved
  def = start.definition
  const s = start.record
  ctx.decide('p4', s.from === 'base' ? `started from base ${s.baseId}` : 'built from zero', s.from === 'base'
    ? `score ${s.candidates[0]?.score}: ${s.candidates[0]?.why.join(', ')}; ${s.kept.length} settings measured equal and kept, ${s.replaced.length} replaced by the measurement (${s.replaced.map((r) => r.field).join(', ') || 'none'}), ${s.dropped.length} not measured here dropped, ${s.earned.length} earned improvements applied`
    : s.candidates.map((c) => `${c.id} ${c.score}: ${c.why.join(', ')}`).join('; ') || 'no ready base')
  def = withAtPath(def, 'voice.language', { value: brief.language, source: 'user', evidence: [], note: brief.sourceLanguage && brief.sourceLanguage !== brief.language ? `translated from ${brief.sourceLanguage}: the voice speaks ${brief.language}` : `the brief's language ${brief.language}` } satisfies Sourced)
  def = { ...def, analysisMeasures: derived.map((d) => ({ field: d.field, value: d.value })) }
  const cost = costTarget(def)
  def = withAtPath(def, 'cost.usdPerMinute', { value: cost.usd, source: 'default', evidence: [], note: cost.why } satisfies Sourced)
  def = await choosePresenterAndVoice(ctx, brief, def, feasibility)
  ctx.decide('p4', `definition v1`, `${synthesis.constants.length} fields from the synthesis, ${derived.length} more measured on the analyses, presenter ${def.presenter.mode.value}, voice ${def.voice.mode.value}`)
  return def
}

/** The configurations completed with the angles the synthesis did not agree on (completeConfigurations): the measured list
 *  first, unchanged, then only configurations of other angles. */
function completedFrom(field: string, def: StyleDefinition, measured: unknown, analyses: readonly VideoAnalysis[]): boolean {
  if (field !== 'presenter.configurations' || !Array.isArray(measured)) return false
  if (analyses.length) {
    // exactly the completion P4 makes from these analyses, nothing else
    const base = withAtPath(def, field, { value: measured, source: 'measured', evidence: [] } satisfies Sourced)
    return isDeepStrictEqual(completeConfigurations(base, deriveFields(analyses)).presenter.configurations.value, def.presenter.configurations.value)
  }
  const value = def.presenter.configurations.value
  const angles = new Set(measured.map((c: Configuration) => c.angle))
  return isDeepStrictEqual(value.slice(0, measured.length), measured) && value.slice(measured.length).every((c) => !angles.has(c.angle) && c.angle < def.presenter.angleCount.value)
}

type Configuration = StyleDefinition['presenter']['configurations']['value'][number]

/** Every measured angle gets a configuration: the synthesis agrees on the frequent ones (Finary: 2), the per-video median
 *  counts more angles (3); the configurations the analyses saw for the missing angles are added, with their evidence. */
export function completeConfigurations(def: StyleDefinition, derived: readonly { field: string; value: unknown; evidence: Evidence[] }[]): StyleDefinition {
  const field = def.presenter.configurations
  if (field.source === 'user') return def // what the user said is never completed
  const seen = derived.find((d) => d.field === 'presenter.configurations')
  if (!seen || !Array.isArray(seen.value)) return def
  const have = new Set(field.value.map((c) => c.angle))
  const extra: Configuration[] = []
  for (const c of seen.value as Configuration[]) {
    if (have.has(c.angle) || c.angle >= def.presenter.angleCount.value) continue
    have.add(c.angle)
    extra.push(c)
  }
  if (extra.length === 0) return def
  const evidence = field.source === 'measured' ? [...field.evidence, ...seen.evidence] : seen.evidence
  return withAtPath(def, 'presenter.configurations', { value: [...field.value, ...extra], source: 'measured', evidence, note: `${extra.length} configuration(s) of angles the synthesis did not agree on, as the analyses saw them` } satisfies Sourced)
}

async function choosePresenterAndVoice(ctx: PhaseContext, brief: Brief, def: StyleDefinition, f: Feasibility): Promise<StyleDefinition> {
  const own = brief.ownChannel
  const user = (value: unknown, note: string): Sourced => ({ value, source: 'user', evidence: [], note })
  const url = def.channel.url
  if (def.presenter.kind.value !== 'none') {
    const ownRef = own ? await ctx.services.presenters.own(url) : null
    if (ownRef) {
      def = withAtPath(def, 'presenter.mode', user('own', 'his own channel: his existing presenter'))
      def = withAtPath(def, 'presenter.presenterRef', user(ownRef, 'his existing presenter clone'))
    } else if (own) {
      // His channel but no clone connected yet: never a look-alike of himself; P4's check asks him to connect it.
      def = withAtPath(def, 'presenter.mode', user('own', 'his own channel: his presenter clone must be connected'))
    } else {
      const id = (def.presenter.identity.value ?? {}) as Partial<Identity>
      const identity: Identity = { age: id.age ?? '', gender: id.gender ?? '', face: '', hair: id.hair ?? '', wardrobe: id.wardrobe ?? '', setting: id.setting ?? '', lighting: id.lighting ?? '' }
      const slot = f.elements.find((e) => e.slot && (e.slot.kind === 'presenter-footage' || e.slot.kind === 'presenter-avatar'))?.slot?.what ?? 'the presenter'
      const spec = lookAlikeSpec(identity, def.presenter.configurations.value, def.presenter.angleCount.value, slot)
      const look = await ctx.services.presenters.lookAlike(packIdentity(spec))
      const idEvidence = def.presenter.identity.source === 'measured' ? def.presenter.identity.evidence : []
      def = withAtPath(def, 'presenter.mode', user('look-alike-placeholder', 'not his channel: a provisional presenter of the same type'))
      def = withAtPath(def, 'presenter.presenterRef', user(look.ref, `placeholder: ${look.description}`))
      def = withAtPath(def, 'presenter.placeholder', { value: spec, source: idEvidence.length ? 'measured' : 'user', evidence: idEvidence, note: idEvidence.length ? 'built from the measured type, words only: never the third party\'s face' : 'the presenter type was not measured: a neutral placeholder, words only' } satisfies Sourced)
    }
  }
  if (def.voice.kind.value !== 'none') {
    const ownVoice = own ? await ctx.services.voices.own(url) : null
    if (ownVoice) {
      def = withAtPath(def, 'voice.mode', user('user-clone', 'his own voice clone'))
      def = withAtPath(def, 'voice.voiceRef', user(ownVoice, 'his voice clone'))
    } else {
      const voice = await ctx.services.voices.sameKind(def.voice.descriptors.value, brief.language)
      def = withAtPath(def, 'voice.mode', user('same-kind', 'a voice of the same kind'))
      def = withAtPath(def, 'voice.voiceRef', user(voice.ref, voice.description))
    }
  }
  return def
}

/** Refuses a definition that marks `default` a field the analysis measured (the synthesis' constants and, when the
 *  analyses are given, every field they measure), drops a measured value (unless an improvement round changed it:
 *  `improved` lists those paths), measures too little, gives a third party's channel the user's own presenter/voice (or
 *  his own channel a look-alike), lists fewer presenter configurations than angles, or a placeholder that is not marked. */
export function checkP4(def: StyleDefinition, synthesis: Synthesis, brief: Brief, improved: readonly string[] = [], analyses: readonly VideoAnalysis[] = [], bases: readonly ReadyBase[] = READY_BASES): ExitCheck {
  const p = schemaProblems(StyleDefinition, def)
  if (p.length) return verdict(p)
  const fromAnalyses = analyses.length ? analysisMeasures(analyses, synthesis) : def.analysisMeasures.filter((m) => !synthesis.constants.some((c) => c.field === m.field))
  const measures: { field: string; value: unknown }[] = [...synthesis.constants, ...fromAnalyses]
  const named = new Set(measures.map((m) => m.field))
  for (const c of measures) {
    const f = atPath(def, c.field)
    if (!isSourced(f)) { p.push(`${c.field} is not a definition field`); continue }
    if (f.source === 'default') p.push(`${c.field} is marked default although the analysis measured it`)
    else if (f.source === 'measured' && !improved.includes(c.field) && !isDeepStrictEqual(f.value, c.value) && !completedFrom(c.field, def, c.value, analyses) && !baseStartAccepts(def, c.field, c.value)) p.push(`${c.field} differs from the measured value`)
  }
  p.push(...baseStartProblems(def, named, bases))
  for (const m of MIN_MEASURED_FIELDS) if (!named.has(m)) p.push(`${m} was not measured: a definition of defaults is not a clone`)
  for (const { path, field } of sourcedFields(def)) if (field.source === 'user' && !field.note) p.push(`${path} is marked user without saying what he said`)
  const pr = def.presenter
  if (pr.kind.value === 'none' && pr.mode.value !== 'none') p.push('no presenter measured but a presenter mode is set')
  if (pr.kind.value !== 'none') {
    if (pr.mode.value === 'none') p.push('a presenter was measured but none is planned')
    if (!brief.ownChannel && pr.mode.value === 'own') p.push('not his channel: the presenter must be a look-alike placeholder, never the third party')
    if (!pr.presenterRef.value) p.push('no presenter chosen')
    const angles = new Set(pr.configurations.value.map((c) => c.angle))
    if (angles.size < pr.angleCount.value) p.push(`${angles.size} presenter angles configured, ${pr.angleCount.value} measured`)
    if (pr.layoutCurve.value.length === 0) p.push('no per-part layout curve for the presenter')
    const ph = pr.placeholder.value
    if (pr.mode.value === 'look-alike-placeholder') {
      if (!ph) p.push('a look-alike placeholder without its spec (who stands in, marked placeholder, with the measured angles)')
      else {
        if (ph.angles.length < pr.angleCount.value) p.push(`the placeholder has ${ph.angles.length} angles, ${pr.angleCount.value} measured`)
        if (!safeDescriptors(ph.type)) p.push('the placeholder descriptors point at a real person or a picture')
      }
    }
    if (pr.mode.value === 'own' && ph) p.push('his own presenter is used: no placeholder may stand in')
  }
  if (brief.ownChannel && pr.kind.value !== 'none' && pr.mode.value !== 'own') p.push('his own channel: his existing presenter must be used (ask him to connect it), not a look-alike')
  if (def.voice.kind.value !== 'none' && !def.voice.voiceRef.value) p.push('no voice chosen')
  if (brief.ownChannel && def.voice.kind.value !== 'none' && def.voice.mode.value !== 'user-clone') p.push('his own channel: his own voice clone must be used')
  if (!brief.ownChannel && def.voice.mode.value === 'user-clone') p.push('not his channel: the voice must be of the same kind, never a clone')
  if (!brief.ownChannel && typeof def.voice.voiceRef.value === 'string' && def.voice.voiceRef.value.startsWith('clone_')) p.push('not his channel: a cloned voice may not speak for it')
  if (def.voice.language.source !== 'default' && def.voice.language.value !== brief.language) p.push(`the voice speaks ${def.voice.language.value}, the brief asks ${brief.language}`)
  return verdict(p)
}
