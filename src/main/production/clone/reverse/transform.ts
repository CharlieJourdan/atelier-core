// reverse-pipeline: translate / adapt / bend / mix a finished pipeline into a NEW one (a new clone folder). The reference's
// corpus, analyses, synthesis and feasibility map are copied (nothing is analysed or paid again); a new Style Definition
// version carries the change; P5 compiles its plan again (runP5). The new pipeline says what it derives from and is « not
// proven » until `reverse.prove` runs the rounds on it.
//   translate: the voice speaks the new language (a voice of the same kind re-picked for it, unless it is his own clone), the
//              script and on-screen text follow the recipe's language (`recipe.language` ← `voice.language`).
//   adapt:     same style, his topic and instructions: kept in the brief (`said`), which the script phase reads.
//   bend:      each `{ field, value }` sets a definition field (the path must exist), source `user` with a note.
//   mix:       per axis, the other pipeline's definition section replaces this one's (source `user`, its evidence kept); the
//              feasibility stays this reference's (its screen time).
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Brief, Corpus, Feasibility, StyleDefinition, Synthesis, VideoAnalysis, atPath, isSourced, sourcedFields, withAtPath, type Sourced } from '../../../../shared/clone'
import { ReverseRequest, type ReverseTransform } from '../../../../shared/reverse/pipeline'
import { phaseContext } from '../context'
import { checkP4 } from '../p4-definition'
import { runP5 } from '../p5-plan'
import type { IntakeAnswers } from '../p0-intake'
import type { CloneServices } from '../services'
import { ARTEFACTS, CloneStore } from '../store'
import { REVERSE_FILES, loadReverseInputs } from './load'

export interface TransformDeps {
  dataDir: string
  services(cloneId: string): CloneServices
  now(): Date
}

/** A new clone id for a transform of `from`, unique in the folder. */
export function transformId(from: string, action: string, taken: (id: string) => boolean): string {
  const base = `${from.slice(0, 50)}-${action}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  let id = base
  for (let n = 2; taken(id); n++) id = `${base}-${n}`
  return id
}

const user = (value: unknown, note: string, evidence: Sourced['evidence'] = []): Sourced => ({ value, source: 'user', evidence, note })

/** The files of the source clone a transform reuses: the corpus and what was read on it (no analysis is paid again). */
const REUSED = /^p[123]-/

function copyReused(from: CloneStore, to: CloneStore): void {
  for (const e of readdirSync(from.dir, { withFileTypes: true })) {
    if (!REUSED.test(e.name)) continue
    const src = from.file(e.name)
    if (e.isDirectory()) { cpSync(src, to.file(e.name), { recursive: true }); continue }
    if (!e.name.endsWith('.json')) continue
    // the artefact belongs to the new clone now (its head names it)
    const doc = JSON.parse(readFileSync(src, 'utf8')) as Record<string, unknown>
    if (typeof doc['cloneId'] === 'string') doc['cloneId'] = to.cloneId
    writeFileSync(to.file(e.name), JSON.stringify(doc, null, 2) + '\n', 'utf8')
  }
}

/** The changed definition (pure but for the voice re-pick, which asks the voices service). */
async function changedDefinition(t: ReverseTransform, def: StyleDefinition, brief: Brief, s: CloneServices, other: StyleDefinition | null, otherId: string | null): Promise<StyleDefinition> {
  let d = def
  const said = t.instructions.trim()
  if (t.action === 'translate') {
    const language = t.language!
    d = withAtPath(d, 'voice.language', user(language, `translated from ${brief.language}: the voice, the script and the on-screen text are in ${language}`))
    d = { ...d, channel: { ...d.channel, language } }
    if (d.voice.kind.value !== 'none' && d.voice.mode.value !== 'user-clone') {
      const voice = await s.voices.sameKind(d.voice.descriptors.value, language)
      d = withAtPath(d, 'voice.voiceRef', user(voice.ref, `${voice.description} (re-picked for ${language})`))
    }
  }
  if (t.action === 'bend') {
    for (const b of t.bend) {
      const field = b.field.replace(/\.value$/, '')
      const was = atPath(d, field)
      if (!isSourced(was)) throw new Error(`bend: ${b.field} is not a Style Definition field`)
      d = withAtPath(d, field, user(b.value, `bent by the user${said ? ` (« ${said.slice(0, 200)} »)` : ''}: was ${JSON.stringify(was.value).slice(0, 120)}`))
    }
  }
  if (t.action === 'mix' && other && otherId) {
    for (const axis of t.mixWith!.axes) {
      let section: unknown = other[axis]
      for (const { path: p, field } of sourcedFields(other[axis])) {
        const note = `mix: taken from pipeline ${otherId}${field.source === 'measured' ? ' (measured there)' : ''}`
        section = withAtPath(section, p, user(field.value, note, field.evidence))
      }
      d = { ...d, [axis]: section }
    }
  }
  const parsed = StyleDefinition.safeParse(d)
  if (!parsed.success) throw new Error(`${t.action}: the changed definition is not valid: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).slice(0, 3).join('; ')}`)
  return parsed.data
}

/** The fields the source's rounds improved (measured, but no longer the measured value): said as such, so the new clone's P4
 *  check (which has no rounds behind it) accepts them. */
function keepImproved(d: StyleDefinition, synthesis: Synthesis, brief: Brief, analyses: readonly VideoAnalysis[], s: CloneServices, from: string): StyleDefinition {
  const check = checkP4(d, synthesis, brief, [], analyses, s.readyBases)
  let out = d
  for (const p of check.ok ? [] : check.problems) {
    const m = /^(\S+) differs from the measured value$/.exec(p)
    const f = m ? atPath(out, m[1]!) : undefined
    if (m && isSourced(f)) out = withAtPath(out, m[1]!, user(f.value, `improved by the rounds of pipeline ${from}: kept`, f.evidence))
  }
  return out
}

/** Makes the transformed pipeline's clone folder and returns its id (the caller proves it when money is allowed). */
export async function transformPipeline(deps: TransformDeps, fromId: string, t: ReverseTransform): Promise<{ id: string }> {
  const from = new CloneStore(deps.dataDir, fromId)
  const brief = from.load(ARTEFACTS.brief, Brief)
  const corpus = from.load(ARTEFACTS.corpus, Corpus)
  const synthesis = from.load(ARTEFACTS.synthesis, Synthesis)
  const feasibility = from.load(ARTEFACTS.feasibility, Feasibility)
  const def = from.load(ARTEFACTS.definition, StyleDefinition)
  if (!brief || !corpus || !synthesis || !feasibility || !def) throw new Error(`pipeline ${fromId} is not finished: nothing to ${t.action} yet`)
  if (t.action === 'translate') {
    if (!t.language) throw new Error('translate: the target language is missing')
    if (t.language === brief.language) throw new Error(`translate: pipeline ${fromId} is already in ${t.language}`)
  }
  if (t.action === 'bend' && t.bend.length === 0) throw new Error('bend: no field change given')
  if (t.action === 'adapt' && !t.instructions.trim()) throw new Error('adapt: the instructions are missing')
  let other: StyleDefinition | null = null
  if (t.action === 'mix') {
    if (!t.mixWith) throw new Error('mix: the other pipeline is missing')
    if (t.mixWith.pipelineId === fromId) throw new Error('mix: a pipeline cannot be mixed with itself')
    other = new CloneStore(deps.dataDir, t.mixWith.pipelineId).load(ARTEFACTS.definition, StyleDefinition)
    if (!other) throw new Error(`mix: pipeline ${t.mixWith.pipelineId} has no Style Definition`)
  }
  const root = path.join(deps.dataDir, 'clones')
  const id = transformId(fromId, t.action, (x) => existsSync(path.join(root, x)))
  const to = new CloneStore(deps.dataDir, id)
  const services = deps.services(id)
  const at = deps.now().toISOString()
  const said = t.instructions.trim()
  const newBrief: Brief = {
    ...brief,
    cloneId: id,
    createdAt: at,
    ...(t.action === 'translate' ? { intent: 'translate' as const, language: t.language!, sourceLanguage: brief.language } : {}),
    testBudgetUsd: t.testBudgetUsd > 0 ? t.testBudgetUsd : brief.testBudgetUsd,
    said: [...brief.said, `${t.action} of pipeline ${fromId}${said ? `: ${said.slice(0, 280)}` : ''}`]
  }
  copyReused(from, to)
  const analyses = corpus.videos.flatMap((v) => to.load(ARTEFACTS.analysis(v.id), VideoAnalysis) ?? [])
  const changed = await changedDefinition(t, def, newBrief, services, other, t.mixWith?.pipelineId ?? null)
  const next = keepImproved({ ...changed, cloneId: id, createdAt: at, version: def.version + 1 }, synthesis, newBrief, analyses, services, fromId)
  const { schema: _s, cloneId: _c, createdAt: _a, ...answers } = newBrief
  to.save(REVERSE_FILES.request, requestOf(deps.dataDir, from, t, newBrief))
  to.save(REVERSE_FILES.derived, { pipelineId: fromId, transform: t })
  to.save(ARTEFACTS.brief, newBrief)
  to.save('p0-answers.json', answers satisfies IntakeAnswers)
  to.save(ARTEFACTS.definition, next)
  to.save(ARTEFACTS.definitionVersion(next.version), next)
  const ctx = phaseContext(to, services, newBrief.testBudgetUsd)
  ctx.decide('reverse', `${t.action} of ${fromId}`, `definition v${def.version} → v${next.version}; corpus, analyses and feasibility reused (nothing analysed again)`)
  const plan = await runP5(ctx, newBrief, next, feasibility)
  to.save(ARTEFACTS.plan, plan)
  const left = checkP4(next, synthesis, newBrief, [], analyses, services.readyBases)
  if (!left.ok) ctx.decide('reverse', 'definition check', left.problems.join('; '))
  return { id }
}

/** The request of the new pipeline: the source's, with the transform's action, language and words (a mix adds the other
 *  pipeline's links, each with the axes taken from it). */
function requestOf(dataDir: string, from: CloneStore, t: ReverseTransform, brief: Brief): ReverseRequest {
  const source = loadReverseInputs(from).request
  const mixed = t.action === 'mix' && t.mixWith
    ? loadReverseInputs(new CloneStore(dataDir, t.mixWith.pipelineId)).request.links.map((l) => ({ ...l, axes: [...t.mixWith!.axes] }))
    : []
  return ReverseRequest.parse({
    ...source,
    action: t.action,
    instructions: t.instructions || source.instructions,
    language: brief.language,
    testBudgetUsd: brief.testBudgetUsd,
    links: [...source.links, ...mixed].slice(0, 6)
  })
}
